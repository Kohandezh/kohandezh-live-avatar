import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type {
  ElevenLabsAgentSession,
  LiveAvatarSession,
} from '@heygen/liveavatar-web-sdk';
import {
  closeAssistantSession,
  createAssistantSession,
  toAssistantSessionInfo,
  type AssistantLanguage,
} from '@/entities/assistant-session';
import { useOnline } from '@/shared/hooks';
import { createAnswerReporter, type AnswerReporter } from './answerReporter';
import {
  assistantReducer,
  classifyAssistantError,
  elevenLabsEventActions,
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
  /**
   * Which view the conversation opens in. Only the first render reads it; after that the
   * user owns the mode. The website widget uses it to honour its `mode` option.
   */
  initialMode?: AssistantMode;
}

/**
 * Drives one LiveAvatar conversation:
 *
 *   start -> POST /api/assistant/session (our backend mints the provider token)
 *         -> new <session class>(token) -> start() -> attach(<video>)
 *   talk  -> each avatar speech segment -> POST /api/assistant/session/{id}/answers
 *   stop  -> SDK stop + the last answers + POST /api/assistant/session/{id}/close
 *
 * The token itself says which session class can drive it, so the SDK decides, not our backend
 * response: `ElevenLabsAgentSession` for a LiveAvatar Voice Agent (the Persian path) and
 * `LiveAvatarSession` for FULL mode. Both share the same lifecycle and the same events; only
 * the way a typed turn is sent differs.
 *
 * The provider token stays in a local variable. It never reaches Redux, storage, or a log.
 * The SDK is imported on demand because it pulls in LiveKit, which is large and is only
 * needed once the user actually starts a conversation.
 */
export function useAssistantSession(options: UseAssistantSessionOptions = {}) {
  const { language, initialMode } = options;
  const [state, dispatch] = useReducer(
    assistantReducer,
    initialAssistantState,
    (base) => (initialMode ? { ...base, mode: initialMode } : base),
  );
  const online = useOnline();

  const sessionRef = useRef<LiveAvatarSession | null>(null);
  // The same object as `sessionRef` when the token belongs to an ElevenLabs agent, null
  // otherwise. It is what tells `sendText` which outbound command the session understands.
  const elevenLabsRef = useRef<ElevenLabsAgentSession | null>(null);
  // The loaded SDK module. The controls need its enums, and it is imported on demand.
  const sdkRef = useRef<LiveAvatarSdk | null>(null);
  const backendIdRef = useRef<string | null>(null);
  /** Reports the avatar's answers of the backend session in `backendIdRef`. */
  const answerReporterRef = useRef<AnswerReporter | null>(null);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  /**
   * The session whose stream is already on the media element.
   *
   * Attaching assigns `srcObject`, and assigning it again interrupts a `play()` that has not
   * resolved yet. The browser rejects that call with `AbortError`, which used to be reported
   * as a blocked autoplay: the user was told to tap the circle to hear audio that was never
   * blocked in the first place.
   */
  const attachedSessionRef = useRef<LiveAvatarSession | null>(null);
  const keepAliveRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  /**
   * Which start attempt is the current one.
   *
   * `start()` is a chain of awaits: the backend POST, the SDK import, then `session.start()`.
   * Without this, a `stop()` in the middle closes the backend row and nulls the refs, and then
   * the still-running `start()` assigns `sessionRef.current` again and connects a provider
   * session whose backend row is already closed. Nothing is left to close it, and the status
   * never leaves `requesting`.
   *
   * A counter, not a boolean. Each `start()` takes the next number and keeps it; `stop()` and
   * any later `start()` move the counter on, which abandons every attempt still parked on an
   * await. A boolean broke on End then Restart: the second start reset the shared flag to
   * false, so the first start woke up believing it was still wanted and connected a second
   * paid session that nothing would ever close.
   */
  const startGenerationRef = useRef(0);

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
    // Already running, so there is nothing to unblock. A second `play()` would at best do
    // nothing and at worst abort the one that is still resolving.
    if (!element.paused) {
      dispatch({ type: 'audioBlocked', isBlocked: false });
      return;
    }
    try {
      await element.play();
      dispatch({ type: 'audioBlocked', isBlocked: false });
    } catch (error) {
      /*
        One rejection is excluded, not one included.

        `AbortError` means a new stream replaced the old one while `play()` was still
        resolving. Nothing is blocked, so telling the user to tap a circle sends them after a
        problem they do not have. That was the bug.

        Everything else still offers the tap, including an error this code has never seen.
        Browsers agree on `NotAllowedError` for the autoplay policy today, but matching only
        that name would take the recovery button away from any browser that picks another one,
        and a user who cannot hear the doctor and has nothing to press is the worse failure.
      */
      const wasInterrupted =
        error instanceof DOMException && error.name === 'AbortError';
      dispatch({ type: 'audioBlocked', isBlocked: !wasInterrupted });
    }
  }, []);

  /** Puts the session's stream on the media element, once per session. See `attachedSessionRef`. */
  const attachSessionMedia = useCallback((session: LiveAvatarSession) => {
    const element = mediaRef.current;
    if (!element || attachedSessionRef.current === session) return;
    session.attach(element);
    attachedSessionRef.current = session;
  }, []);

  const attachMedia = useCallback((element: HTMLMediaElement | null) => {
    mediaRef.current = element;
    if (!element) {
      attachedSessionRef.current = null;
      return;
    }
    const session = sessionRef.current;
    if (session) {
      session.attach(element);
      attachedSessionRef.current = session;
    }
  }, []);

  const stopKeepAlive = useCallback(() => {
    if (keepAliveRef.current !== null) {
      window.clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
  }, []);

  /**
   * Stops the SDK, reports the last answers, and closes the backend row. Safe to call twice and
   * on unmount. The backend row is closed even when the SDK stop fails, so a session is never
   * leaked.
   */
  const releaseSession = useCallback(async () => {
    const session = sessionRef.current;
    const backendId = backendIdRef.current;
    const answerReporter = answerReporterRef.current;
    sessionRef.current = null;
    elevenLabsRef.current = null;
    backendIdRef.current = null;
    answerReporterRef.current = null;
    attachedSessionRef.current = null;
    stopKeepAlive();

    if (session) {
      // We no longer care about its events; this also keeps a provider "disconnected" event
      // from overwriting the reason the user actually sees.
      session.voiceChat.removeAllListeners();
      session.removeAllListeners();
      // Measured now, so the time the SDK takes to stop is not added to the last answer.
      answerReporter?.segmentEnded();
      try {
        await session.stop();
      } catch {
        // The provider may have dropped the session already (time limit, network).
      }
    }

    // Before close, because the backend refuses a report for a closed session. The report's own
    // timeout bounds the wait, and it never throws.
    await answerReporter?.finish();

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
    (
      session: LiveAvatarSession,
      sdk: LiveAvatarSdk,
      answerReporter: AnswerReporter,
    ) => {
      const {
        AgentEventsEnum,
        ConnectionQuality,
        SessionEvent,
        SessionState,
        VoiceChatEvent,
      } = sdk;

      session.on(SessionEvent.SESSION_STATE_CHANGED, (next) => {
        if (next === SessionState.CONNECTED) {
          dispatch({ type: 'connected', at: Date.now() });
        }
        if (next === SessionState.DISCONNECTED) {
          answerReporter.segmentEnded();
          dispatch({ type: 'ended', reason: 'provider' });
        }
      });
      session.on(SessionEvent.SESSION_STREAM_READY, () => {
        // `start()` only resolves after the SDK has waited for the LiveAvatar participants,
        // which in FULL mode happens well after the avatar is already speaking. Waiting for it
        // left the UI on "Connecting…" during a live conversation, so the stream decides.
        dispatch({ type: 'streamReady' });
        dispatch({ type: 'connected', at: Date.now() });
        attachSessionMedia(session);
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
        answerReporter.segmentEnded();
        dispatch({ type: 'ended', reason: 'provider' });
      });

      session.on(AgentEventsEnum.SESSION_STOPPED, (event) => {
        answerReporter.segmentEnded();
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
      session.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, () => {
        answerReporter.segmentStarted();
        dispatch({ type: 'avatarSpeaking', isSpeaking: true });
      });
      session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, () => {
        answerReporter.segmentEnded();
        dispatch({ type: 'avatarSpeaking', isSpeaking: false });
      });

      // An ElevenLabs agent reports the conversation on its own event stream instead of (or in
      // addition to) the generic transcription events. The reducer drops a sentence that
      // repeats the previous turn of the same speaker, so both paths can stay subscribed.
      session.on(AgentEventsEnum.ELEVENLABS_AGENT_EVENT, (event) => {
        // The user cut in: the agent stops talking, and may never send its speak-ended event.
        if (event.elevenlabs_event_type === 'interruption') {
          answerReporter.segmentEnded();
        }
        for (const action of elevenLabsEventActions(event)) dispatch(action);
      });

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
    [attachSessionMedia, playAttachedMedia],
  );

  const start = useCallback(async () => {
    // Pressing Start twice must not open a second conversation.
    if (isAssistantBusy(statusRef.current)) return;
    if (!navigator.onLine) {
      dispatch({ type: 'failed', error: { kind: 'offline' } });
      return;
    }

    // This attempt's number, taken once and held. Anything that moves the counter on after
    // this point (an End, or another Start) makes every check below fail.
    const generation = ++startGenerationRef.current;
    dispatch({ type: 'requesting' });

    /** True once this attempt was superseded, or the screen went away, during an await. */
    const abandoned = () =>
      generation !== startGenerationRef.current || !mountedRef.current;

    /**
     * Tears down a start nobody is waiting for any more.
     *
     * `releaseSession()` reads the refs, and `stop()` may already have nulled them, so the
     * session goes back under its ref first. Otherwise the session this call owns stays
     * connected with nothing left to close it.
     */
    const abandon = async (session?: LiveAvatarSession) => {
      if (session && !sessionRef.current) sessionRef.current = session;
      await releaseSession();
    };

    try {
      const created = await createAssistantSession(
        language ? { language } : {},
      );
      backendIdRef.current = created.id;
      // A new reporter per backend session, so the answer index starts at 0 again.
      const answerReporter = createAnswerReporter(
        created.id,
        created.maxSessionDurationSeconds * 1000,
      );
      answerReporterRef.current = answerReporter;
      if (abandoned()) {
        await abandon();
        return;
      }
      dispatch({ type: 'created', session: toAssistantSessionInfo(created) });

      const sdk = await import('@heygen/liveavatar-web-sdk');
      // Checked before the session is constructed: connecting one we are about to throw
      // away is what left an orphan session running.
      if (abandoned()) {
        await abandon();
        return;
      }
      sdkRef.current = sdk;
      // The token carries the agent type, so the SDK picks the class, not our own field.
      const config = { voiceChat: { defaultMuted: false } };
      let session: LiveAvatarSession;
      if (
        sdk.parseAgentTypeFromToken(created.sessionToken) ===
        sdk.AgentType.ELEVENLABS_AGENT
      ) {
        const agentSession = new sdk.ElevenLabsAgentSession(
          created.sessionToken,
          config,
        );
        elevenLabsRef.current = agentSession;
        session = agentSession;
      } else {
        elevenLabsRef.current = null;
        session = new sdk.LiveAvatarSession(created.sessionToken, config);
      }
      sessionRef.current = session;
      subscribe(session, sdk, answerReporter);

      dispatch({ type: 'connecting' });
      await session.start();

      if (abandoned()) {
        await abandon(session);
        return;
      }

      attachSessionMedia(session);
      await playAttachedMedia();
      dispatch({ type: 'micChanged', isMuted: session.voiceChat.isMuted });
      // A fallback for a session that connected without ever reporting a ready stream.
      dispatch({ type: 'connected', at: Date.now() });

      // The SDK only writes a console warning when the microphone fails to start, so a denied
      // permission would look like a working conversation the avatar cannot hear. The avatar
      // still plays, so this is a warning next to the video, not a failed start.
      if (session.voiceChat.state !== sdk.VoiceChatState.ACTIVE) {
        dispatch({ type: 'controlFailed', error: { kind: 'micPermission' } });
      }

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
      // A start that was cancelled or replaced is not a failure. `stop()` has already moved
      // the status to `ended`, and the throw is usually the released session tearing down
      // mid-connect. Without this guard the error card would replace the ended screen after
      // End, or an abandoned first attempt would fail the restart that replaced it.
      if (!abandoned()) {
        dispatch({ type: 'failed', error: classifyAssistantError(error) });
      }
    }
  }, [attachSessionMedia, language, playAttachedMedia, releaseSession, subscribe]);

  const stop = useCallback(async () => {
    // Always first, so a start that is mid-await sees the counter move at its next check even
    // when there is nothing to release yet.
    startGenerationRef.current += 1;
    // `requesting` has neither ref set for as long as the backend POST is in flight, which
    // is exactly when End used to do nothing at all.
    if (
      !sessionRef.current &&
      !backendIdRef.current &&
      statusRef.current !== 'requesting'
    ) {
      return;
    }
    dispatch({ type: 'ending' });
    await releaseSession();
    if (mountedRef.current) dispatch({ type: 'ended', reason: 'user' });
  }, [releaseSession]);

  const toggleMic = useCallback(async () => {
    const session = sessionRef.current;
    const sdk = sdkRef.current;
    if (!session || !sdk) return;
    const { voiceChat } = session;
    try {
      if (voiceChat.state !== sdk.VoiceChatState.ACTIVE) {
        // The microphone never started, usually because the user denied it. `unmute()` is a
        // no-op in that state, so the only way back is to ask for the device again.
        await voiceChat.start({ defaultMuted: false });
        dispatch({ type: 'controlRecovered' });
      } else if (voiceChat.isMuted) {
        await voiceChat.unmute();
      } else {
        await voiceChat.mute();
      }
      dispatch({ type: 'micChanged', isMuted: voiceChat.isMuted });
    } catch (error) {
      // Asking for the microphone again can be denied again, and that lands here.
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
      // An ElevenLabs agent owns the answer, so a typed turn is a user message to the agent.
      // `message()` throws on that session class, and `sendUserMessage()` does not exist on
      // the FULL one, so the class decides which call is right.
      const elevenLabs = elevenLabsRef.current;
      const eventId = elevenLabs
        ? elevenLabs.sendUserMessage(trimmed)
        : session.message(trimmed);
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
