import { useCallback, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useDispatch, useSelector } from 'react-redux';
import { avatarApi, describeError, isApiError } from '@/shared/api';
import { useOnline } from '@/shared/hooks';
import { sessionFromDto, type AvatarSession } from '@/entities/session';
import { useDiagnosticsLog } from '@/features/diagnostics';
import { connectRoom, disconnectRoom, startRoomAudio } from './livekitRoom';
import {
  audioPlaybackChanged,
  mediaChanged,
  selectAvatarSession,
  sessionClosed,
  sessionClosing,
  sessionConnected,
  sessionConnecting,
  sessionCreated,
  sessionDisconnected,
  sessionFailed,
  sessionReconnecting,
  sessionStarting,
  speakingChanged,
} from './sessionSlice';
import type { RoomCallbacks } from './types';

/**
 * LiveAvatar production ends a session after 300 seconds, and one answer must fit one session
 * (REQ-035). The request schema allows up to 3600, so the cap is set here.
 */
const MAX_SESSION_SECONDS = 300;

/**
 * Drives the avatar session lifecycle:
 *   Start  -> POST /avatar/session -> LiveKit connect with the scoped browser token
 *   Speak  -> POST /avatar/speak (server: ElevenLabs -> LiveAvatar; waits for speak_ended)
 *   Interrupt -> POST /avatar/interrupt
 *   Close  -> POST /avatar/close + LiveKit disconnect
 * The hook is meant to be instantiated once per panel; child components receive its result.
 */
export function useAvatarSession() {
  const dispatch = useDispatch();
  const state = useSelector(selectAvatarSession);
  const log = useDiagnosticsLog();
  const online = useOnline();

  const callbacks = useMemo<RoomCallbacks>(
    () => ({
      onConnection: (event) => {
        switch (event.type) {
          case 'connected':
            log.info('livekit', 'LiveKit room connected');
            break;
          case 'reconnecting':
            dispatch(sessionReconnecting());
            log.warn('livekit', 'LiveKit reconnecting');
            break;
          case 'reconnected':
            dispatch(sessionConnected());
            log.info('livekit', 'LiveKit reconnected');
            break;
          case 'disconnected':
            dispatch(sessionDisconnected(event.reason));
            log.warn('livekit', 'LiveKit disconnected', { reason: event.reason });
            break;
        }
      },
      onTrack: (kind, attached, detail) => {
        dispatch(mediaChanged({ kind, attached }));
        log.info('livekit', `${kind} track ${attached ? 'attached' : 'detached'}`, detail);
      },
      onAudioPlayback: (canPlay) => {
        dispatch(audioPlaybackChanged({ blocked: !canPlay }));
        if (!canPlay) log.warn('livekit', 'Audio playback blocked by browser autoplay policy');
      },
      onEvent: (level, message, data) => log[level]('livekit', message, data),
    }),
    [dispatch, log],
  );

  const start = useMutation({
    mutationFn: async (): Promise<AvatarSession> => {
      dispatch(sessionStarting());
      const dto = await avatarApi.createSession({ max_session_duration: MAX_SESSION_SECONDS });
      const session = sessionFromDto(dto);
      dispatch(sessionCreated(session));
      log.info('avatar', 'Session created; scoped browser token received (not logged)', {
        session_id: session.id,
        provider_session_id: session.providerSessionId,
        room: session.roomName,
        livekit_url: session.livekitUrl,
        sandbox: session.sandbox,
      });
      dispatch(sessionConnecting());
      try {
        await connectRoom(dto.livekit_url, dto.livekit_client_token, callbacks);
      } catch (error) {
        // The server session exists but the browser cannot join: release it so keep-alive and
        // provider usage are not leaked, then surface the LiveKit failure.
        log.error('livekit', 'LiveKit connect failed; closing server session', {
          error: describeError(error),
        });
        await avatarApi.close(session.id).catch(() => undefined);
        throw error;
      }
      dispatch(sessionConnected());
      return session;
    },
    onError: (error) => {
      dispatch(sessionFailed(describeError(error)));
      log.error('avatar', 'Session start failed', {
        error: describeError(error),
        server_code: isApiError(error) ? error.serverCode : undefined,
        correlation_id: isApiError(error) ? error.correlationId : undefined,
      });
    },
  });

  const sessionId = state.session?.id ?? null;

  const speak = useMutation({
    mutationFn: async (text: string) => {
      if (!sessionId) throw new Error('No active session');
      dispatch(speakingChanged(true));
      return avatarApi.speak(sessionId, text);
    },
    onSuccess: (result) => {
      log.info('avatar', result.interrupted ? 'Speech interrupted' : 'Speech completed', result);
    },
    onError: (error) => log.error('avatar', 'Speak failed', { error: describeError(error) }),
    onSettled: () => dispatch(speakingChanged(false)),
  });

  const interrupt = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error('No active session');
      return avatarApi.interrupt(sessionId);
    },
    onSuccess: () => log.info('avatar', 'Avatar interrupted'),
    onError: (error) => log.error('avatar', 'Interrupt failed', { error: describeError(error) }),
  });

  const close = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error('No active session');
      dispatch(sessionClosing());
      try {
        await avatarApi.close(sessionId);
      } finally {
        await disconnectRoom();
      }
    },
    onSuccess: () => {
      dispatch(sessionClosed());
      log.info('avatar', 'Session closed');
    },
    onError: (error) => {
      // The server may already have dropped it (timeout, restart). Local state is reset either way.
      dispatch(sessionClosed());
      log.warn('avatar', 'Close reported an error; local state reset', {
        error: describeError(error),
      });
    },
  });

  const enableAudio = useCallback(async () => {
    try {
      await startRoomAudio();
      dispatch(audioPlaybackChanged({ blocked: false }));
      log.info('livekit', 'Audio playback enabled by user gesture');
    } catch (error) {
      log.error('livekit', 'Enabling audio failed', { error: describeError(error) });
    }
  }, [dispatch, log]);

  return {
    ...state,
    online,
    start,
    speak,
    interrupt,
    close,
    enableAudio,
    canStart:
      online && state.session === null && (state.status === 'idle' || state.status === 'error'),
    canSpeak: online && state.status === 'connected' && !speak.isPending,
    canInterrupt: online && state.status === 'connected',
  };
}

export type AvatarSessionController = ReturnType<typeof useAvatarSession>;
