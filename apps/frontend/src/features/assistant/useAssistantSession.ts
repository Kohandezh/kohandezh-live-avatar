import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { LiveAvatarSession } from '@heygen/liveavatar-web-sdk';
import {
  closeAssistantSession,
  createAssistantSession,
  toAssistantSessionInfo,
  type AssistantLanguage,
} from '@/entities/assistant-session';
import { useOnline } from '@/shared/hooks';
import {
  assistantReducer,
  classifyAssistantError,
  endReasonFromProvider,
  initialAssistantState,
  isAssistantBusy,
  remainingSeconds,
} from './state';
import type { AssistantMode, AssistantState } from './types';

/** The provider extends a session by this much, so ask again a little before it runs out. */
const KEEP_ALIVE_INTERVAL_MS = 60_000;

type LiveAvatarSdk = typeof import('@heygen/liveavatar-web-sdk');

export interface UseAssistantSessionOptions {
  /** Language for the avatar persona. The backend falls back to its own default. */
  language?: AssistantLanguage;
}

/**
 * Drives one LiveAvatar FULL conversation:
 *
 *   start -> POST /api/assistant/session (our backend mints the provider token)
 *         -> new LiveAvatarSession(token) -> start() -> attach(<video>)
 *   stop  -> SDK stop + POST /api/assistant/session/{id}/close
 *
 * The provider token stays in a local variable. It never reaches Redux, storage, or a log.
 * The SDK is imported on demand because it pulls in LiveKit, which is large and is only
 * needed once the user actually starts a conversation.
 */
export function useAssistantSession(options: UseAssistantSessionOptions = {}) {
  const { language } = options;
  const [state, dispatch] = useReducer(assistantReducer, initialAssistantState);
  const online = useOnline();

  const sessionRef = useRef<LiveAvatarSession | null>(null);
  const backendIdRef = useRef<string | null>(null);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const keepAliveRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  // Read during callbacks, so it must hold the status of the current render, not of the
  // render that created the callback.
  const statusRef = useRef<AssistantState['status']>(state.status);
  statusRef.current = state.status;

  const [now, setNow] = useState(() => Date.now());

  // The countdown only has to tick while the provider has a deadline for us.
  useEffect(() => {
    if (state.endsAt === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.endsAt]);

  const playAttachedMedia = useCallback(async () => {
    const element = mediaRef.current;
    if (!element) return;
    try {
      await element.play();
      dispatch({ type: 'audioBlocked', isBlocked: false });
    } catch {
      // Browsers refuse playback that did not follow a user gesture. The UI offers a button.
      dispatch({ type: 'audioBlocked', isBlocked: true });
    }
  }, []);

  const attachMedia = useCallback((element: HTMLMediaElement | null) => {
    mediaRef.current = element;
    if (element && sessionRef.current) sessionRef.current.attach(element);
  }, []);

  const stopKeepAlive = useCallback(() => {
    if (keepAliveRef.current !== null) {
      window.clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
  }, []);

  /**
   * Stops the SDK and closes the backend row. Safe to call twice and on unmount.
   * The backend row is closed even when the SDK stop fails, so a session is never leaked.
   */
  const releaseSession = useCallback(async () => {
    const session = sessionRef.current;
    const backendId = backendIdRef.current;
    sessionRef.current = null;
    backendIdRef.current = null;
    stopKeepAlive();

    if (session) {
      // We no longer care about its events; this also keeps a provider "disconnected" event
      // from overwriting the reason the user actually sees.
      session.voiceChat.removeAllListeners();
      session.removeAllListeners();
      try {
        await session.stop();
      } catch {
        // The provider may have dropped the session already (time limit, network).
      }
    }

    if (backendId) {
      try {
        await closeAssistantSession(backendId);
      } catch {
        // Nothing the user can do about it, and the conversation is over either way.
        // The backend expires the row on its own.
      }
    }
  }, [stopKeepAlive]);

  const subscribe = useCallback(
    (session: LiveAvatarSession, sdk: LiveAvatarSdk) => {
      const {
        AgentEventsEnum,
        ConnectionQuality,
        SessionEvent,
        SessionState,
        VoiceChatEvent,
      } = sdk;

      session.on(SessionEvent.SESSION_STATE_CHANGED, (next) => {
        if (next === SessionState.DISCONNECTED) {
          dispatch({ type: 'ended', reason: 'provider' });
        }
      });
      session.on(SessionEvent.SESSION_STREAM_READY, () => {
        dispatch({ type: 'streamReady' });
        void playAttachedMedia();
      });
      session.on(SessionEvent.SESSION_CONNECTION_QUALITY_CHANGED, (quality) => {
        dispatch({
          type: 'qualityChanged',
          quality:
            quality === ConnectionQuality.GOOD
              ? 'good'
              : quality === ConnectionQuality.BAD
                ? 'bad'
                : 'unknown',
        });
      });
      session.on(SessionEvent.SESSION_DISCONNECTED, () => {
        dispatch({ type: 'ended', reason: 'provider' });
      });

      session.on(AgentEventsEnum.SESSION_STOPPED, (event) => {
        dispatch({
          type: 'ended',
          reason: endReasonFromProvider(event.stop_reason),
        });
      });
      session.on(AgentEventsEnum.USER_SPEAK_STARTED, () =>
        dispatch({ type: 'userSpeaking', isSpeaking: true }),
      );
      session.on(AgentEventsEnum.USER_SPEAK_ENDED, () =>
        dispatch({ type: 'userSpeaking', isSpeaking: false }),
      );
      session.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, () =>
        dispatch({ type: 'avatarSpeaking', isSpeaking: true }),
      );
      session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, () =>
        dispatch({ type: 'avatarSpeaking', isSpeaking: false }),
      );

      // Only the final transcription is kept. The chunk events carry the same words again
      // while they stream, which would duplicate every turn.
      session.on(AgentEventsEnum.USER_TRANSCRIPTION, (event) => {
        if (!event.text.trim()) return;
        dispatch({
          type: 'transcriptAppended',
          turn: { id: event.event_id, speaker: 'user', text: event.text },
        });
      });
      session.on(AgentEventsEnum.AVATAR_TRANSCRIPTION, (event) => {
        if (!event.text.trim()) return;
        dispatch({
          type: 'transcriptAppended',
          turn: { id: event.event_id, speaker: 'avatar', text: event.text },
        });
      });

      session.voiceChat.on(VoiceChatEvent.MUTED, () =>
        dispatch({ type: 'micChanged', isMuted: true }),
      );
      session.voiceChat.on(VoiceChatEvent.UNMUTED, () =>
        dispatch({ type: 'micChanged', isMuted: false }),
      );
    },
    [playAttachedMedia],
  );

  const start = useCallback(async () => {
    // Pressing Start twice must not open a second conversation.
    if (isAssistantBusy(statusRef.current)) return;
    if (!navigator.onLine) {
      dispatch({ type: 'failed', error: { kind: 'offline' } });
      return;
    }

    dispatch({ type: 'requesting' });

    try {
      const created = await createAssistantSession(
        language ? { language } : {},
      );
      backendIdRef.current = created.id;
      if (!mountedRef.current) {
        await releaseSession();
        return;
      }
      dispatch({ type: 'created', session: toAssistantSessionInfo(created) });

      const sdk = await import('@heygen/liveavatar-web-sdk');
      const session = new sdk.LiveAvatarSession(created.sessionToken, {
        voiceChat: { defaultMuted: false },
      });
      sessionRef.current = session;
      subscribe(session, sdk);

      dispatch({ type: 'connecting' });
      await session.start();

      if (!mountedRef.current) {
        await releaseSession();
        return;
      }

      if (mediaRef.current) session.attach(mediaRef.current);
      await playAttachedMedia();
      dispatch({ type: 'micChanged', isMuted: session.voiceChat.isMuted });
      dispatch({ type: 'connected', at: Date.now() });

      // Sandbox sessions last about a minute, so a keep-alive would never land in time.
      // Only ask for more time when the provider allows a longer session.
      const maxSeconds = session.maxSessionDuration ?? 0;
      if (maxSeconds * 1000 > KEEP_ALIVE_INTERVAL_MS) {
        keepAliveRef.current = window.setInterval(() => {
          void session.keepAlive().catch(() => undefined);
        }, KEEP_ALIVE_INTERVAL_MS);
      }
    } catch (error) {
      // The backend row exists even when the SDK never connected. Close it here so the
      // provider session is not left running.
      await releaseSession();
      if (mountedRef.current) {
        dispatch({ type: 'failed', error: classifyAssistantError(error) });
      }
    }
  }, [language, playAttachedMedia, releaseSession, subscribe]);

  const stop = useCallback(async () => {
    if (!sessionRef.current && !backendIdRef.current) return;
    dispatch({ type: 'ending' });
    await releaseSession();
    if (mountedRef.current) dispatch({ type: 'ended', reason: 'user' });
  }, [releaseSession]);

  const toggleMic = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    const shouldMute = !session.voiceChat.isMuted;
    try {
      if (shouldMute) await session.voiceChat.mute();
      else await session.voiceChat.unmute();
      dispatch({ type: 'micChanged', isMuted: session.voiceChat.isMuted });
    } catch (error) {
      // Unmuting asks the browser for the microphone again, so a denied permission lands here.
      dispatch({ type: 'controlFailed', error: classifyAssistantError(error) });
    }
  }, []);

  const interrupt = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      session.interrupt();
    } catch (error) {
      dispatch({ type: 'controlFailed', error: classifyAssistantError(error) });
    }
  }, []);

  const sendText = useCallback((text: string) => {
    const session = sessionRef.current;
    const trimmed = text.trim();
    if (!session || !trimmed) return;
    try {
      const eventId = session.message(trimmed);
      // A typed turn produces no speech transcription, so record it here.
      dispatch({
        type: 'transcriptAppended',
        turn: { id: eventId, speaker: 'user', text: trimmed },
      });
    } catch (error) {
      dispatch({ type: 'controlFailed', error: classifyAssistantError(error) });
    }
  }, []);

  const setMode = useCallback((mode: AssistantMode) => {
    // Both modes share the same live session; switching never reconnects.
    dispatch({ type: 'modeChanged', mode });
  }, []);

  const enableAudio = useCallback(() => {
    void playAttachedMedia();
  }, [playAttachedMedia]);

  // When the provider ends the conversation (time limit, disconnect) the SDK object and the
  // backend row are still open. Release them here so nothing is left running.
  useEffect(() => {
    if (state.status !== 'ended') return;
    if (!sessionRef.current && !backendIdRef.current) return;
    void releaseSession();
  }, [state.status, releaseSession]);

  const stopRef = useRef(stop);
  stopRef.current = stop;

  useEffect(() => {
    mountedRef.current = true;
    // `pagehide` also covers the mobile case where the tab is frozen instead of unloaded.
    const handlePageHide = () => void stopRef.current();
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      mountedRef.current = false;
      window.removeEventListener('pagehide', handlePageHide);
      void releaseSession();
    };
  }, [releaseSession]);

  return {
    ...state,
    online,
    remainingSeconds: remainingSeconds(state.endsAt, now),
    canStart:
      online &&
      (state.status === 'idle' ||
        state.status === 'ended' ||
        state.status === 'error'),
    canControl: state.status === 'connected',
    start,
    stop,
    toggleMic,
    interrupt,
    sendText,
    setMode,
    attachMedia,
    enableAudio,
  };
}

export type AssistantController = ReturnType<typeof useAssistantSession>;
