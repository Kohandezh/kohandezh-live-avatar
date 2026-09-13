import type { AssistantSessionInfo } from '@/entities/assistant-session';
import { isApiError } from '@/shared/api';
import type {
  AssistantConnectionQuality,
  AssistantEndReason,
  AssistantError,
  AssistantErrorKind,
  AssistantMode,
  AssistantState,
  TranscriptTurn,
} from './types';

export const initialAssistantState: AssistantState = {
  status: 'idle',
  mode: 'video',
  session: null,
  transcript: [],
  isMicMuted: false,
  isUserSpeaking: false,
  isAvatarSpeaking: false,
  isStreamReady: false,
  isAudioBlocked: false,
  connectionQuality: 'unknown',
  endsAt: null,
  endReason: null,
  error: null,
};

export type AssistantAction =
  | { type: 'modeChanged'; mode: AssistantMode }
  | { type: 'requesting' }
  | { type: 'created'; session: AssistantSessionInfo }
  | { type: 'connecting' }
  | { type: 'connected'; at: number }
  | { type: 'failed'; error: AssistantError }
  | { type: 'controlFailed'; error: AssistantError }
  | { type: 'controlRecovered' }
  | { type: 'ending' }
  | { type: 'ended'; reason: AssistantEndReason }
  | { type: 'micChanged'; isMuted: boolean }
  | { type: 'userSpeaking'; isSpeaking: boolean }
  | { type: 'avatarSpeaking'; isSpeaking: boolean }
  | { type: 'transcriptAppended'; turn: TranscriptTurn }
  | { type: 'transcriptCorrected'; original: string; corrected: string }
  | { type: 'streamReady' }
  | { type: 'audioBlocked'; isBlocked: boolean }
  | { type: 'qualityChanged'; quality: AssistantConnectionQuality };

/**
 * Statuses where a provider or SDK event can still change the conversation.
 *
 * `requesting` is in the set because a start can be cancelled while it runs: the user
 * presses End on the "preparing" screen before anything has connected. Without it the
 * reducer drops the `ending` and `ended` that `stop()` dispatches, and the screen stays
 * on `requesting` for ever with no way out. See the cancel flag in `useAssistantSession`.
 */
const LIVE_STATUSES: ReadonlySet<AssistantState['status']> = new Set([
  'requesting',
  'connecting',
  'connected',
  'ending',
]);

export function assistantReducer(
  state: AssistantState,
  action: AssistantAction,
): AssistantState {
  switch (action.type) {
    case 'modeChanged':
      // Only the view changes. The session, the transcript and the status stay as they are.
      return state.mode === action.mode
        ? state
        : { ...state, mode: action.mode };

    case 'requesting':
      // A new conversation starts from a clean slate but keeps the chosen mode.
      return {
        ...initialAssistantState,
        mode: state.mode,
        status: 'requesting',
      };

    case 'created':
      return { ...state, session: action.session };

    case 'connecting':
      return { ...state, status: 'connecting' };

    case 'connected':
      // The stream can become ready before `start()` resolves, so this arrives twice. The first
      // one wins: a later one would push the countdown deadline forward.
      if (state.status !== 'connecting') return state;
      return {
        ...state,
        status: 'connected',
        endsAt: state.session
          ? action.at + state.session.maxSessionDurationSeconds * 1000
          : null,
      };

    case 'failed':
      return { ...state, status: 'error', error: action.error, endsAt: null };

    case 'controlFailed':
      // A failed control (mute, interrupt) does not end the conversation, so the status stays.
      return { ...state, error: action.error };

    case 'controlRecovered':
      // Clears a warning such as a denied microphone once the user fixed it. A failed start is
      // not a warning, so the error of the `error` status stays.
      return state.status === 'error' || state.error === null
        ? state
        : { ...state, error: null };

    case 'ending':
      return LIVE_STATUSES.has(state.status)
        ? { ...state, status: 'ending' }
        : state;

    case 'ended':
      // A failed start already tells the user more than "ended" would.
      return LIVE_STATUSES.has(state.status)
        ? {
            ...state,
            status: 'ended',
            endReason: action.reason,
            endsAt: null,
            isUserSpeaking: false,
            isAvatarSpeaking: false,
            isStreamReady: false,
          }
        : state;

    case 'micChanged':
      return { ...state, isMicMuted: action.isMuted };

    case 'userSpeaking':
      return state.isUserSpeaking === action.isSpeaking
        ? state
        : { ...state, isUserSpeaking: action.isSpeaking };

    case 'avatarSpeaking':
      return state.isAvatarSpeaking === action.isSpeaking
        ? state
        : { ...state, isAvatarSpeaking: action.isSpeaking };

    case 'transcriptAppended':
      return isDuplicateTurn(state.transcript, action.turn)
        ? state
        : { ...state, transcript: [...state.transcript, action.turn] };

    case 'transcriptCorrected':
      return correctLastAvatarTurn(state, action.original, action.corrected);

    case 'streamReady':
      return state.isStreamReady ? state : { ...state, isStreamReady: true };

    case 'audioBlocked':
      return { ...state, isAudioBlocked: action.isBlocked };

    case 'qualityChanged':
      return { ...state, connectionQuality: action.quality };
  }
}


/** Same words, whatever the spacing or the letter case. Used to spot a repeated turn. */
function normalizeTurnText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * True when the turn adds nothing new.
 *
 * The provider sends the same sentence twice with two different event ids: in the real sandbox
 * run the opening line arrived as two `avatar.transcription` events, and on the ElevenLabs path
 * a sentence can arrive both as a generic transcription and as an agent event. So the id alone
 * is not enough; the previous turn of the same speaker is compared by text as well.
 */
function isDuplicateTurn(
  transcript: readonly TranscriptTurn[],
  turn: TranscriptTurn,
): boolean {
  if (transcript.some((existing) => existing.id === turn.id)) return true;
  const previous = [...transcript]
    .reverse()
    .find((existing) => existing.speaker === turn.speaker);
  return (
    previous !== undefined &&
    normalizeTurnText(previous.text) === normalizeTurnText(turn.text)
  );
}

/**
 * Applies an ElevenLabs `agent_response_correction`: the agent rewrote what it had said,
 * usually because the user interrupted it. The corrected text replaces the turn it corrects.
 */
function correctLastAvatarTurn(
  state: AssistantState,
  original: string,
  corrected: string,
): AssistantState {
  const text = corrected.trim();
  if (!text) return state;
  const wanted = normalizeTurnText(original);
  // Newest first: a correction always refers to the most recent matching answer.
  for (let index = state.transcript.length - 1; index >= 0; index -= 1) {
    const turn = state.transcript[index];
    if (turn.speaker !== 'avatar' || normalizeTurnText(turn.text) !== wanted) {
      continue;
    }
    const transcript = [...state.transcript];
    transcript[index] = { ...turn, text };
    return { ...state, transcript };
  }
  return state;
}

/** True while a start is in flight or a conversation is running. */
export function isAssistantBusy(status: AssistantState['status']): boolean {
  return (
    status === 'requesting' ||
    status === 'connecting' ||
    status === 'connected' ||
    status === 'ending'
  );
}

/**
 * Seconds left when the countdown starts to warn the user.
 *
 * One shared constant on purpose. It used to be copy-pasted at 15 in four files, so changing
 * one screen made the same session warn at a different moment on another screen and in the
 * embedded widget. 30 rather than 15: fifteen seconds is not long enough to finish a medical
 * question.
 */
export const WARNING_SECONDS = 30;

/** Seconds left before the provider stops the session. Null when no limit is known. */
export function remainingSeconds(
  endsAt: number | null,
  now: number,
): number | null {
  if (endsAt === null) return null;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

/**
 * The provider sends a free-text stop reason. Only the time limit needs its own message,
 * because in sandbox every conversation ends that way after about a minute.
 */
export function endReasonFromProvider(reason: string): AssistantEndReason {
  return /timeout|duration|expire|time_limit/i.test(reason)
    ? 'timeLimit'
    : 'provider';
}

function isDomException(error: unknown, ...names: string[]): boolean {
  return (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    names.includes(error.name)
  );
}

/**
 * Turns anything thrown while starting into one user-facing kind.
 * The raw message is never shown: it is English, provider-specific, and often a stack line.
 */
export function classifyAssistantError(error: unknown): AssistantError {
  if (isDomException(error, 'NotAllowedError', 'SecurityError')) {
    return { kind: 'micPermission' };
  }
  if (isDomException(error, 'NotFoundError', 'OverconstrainedError')) {
    return { kind: 'micUnavailable' };
  }

  if (isApiError(error)) {
    const code = error.serverCode;
    if (error.status === 401) return { kind: 'unauthorized', code };
    if (error.status === 403) return { kind: 'forbidden', code };
    if (error.status === 429) return { kind: 'rateLimited', code };
    if (error.isNetworkError) return { kind: 'network' };
    if (error.category === 'TIMEOUT') return { kind: 'timeout' };
    return { kind: 'provider', code };
  }

  // The SDK rejects with a plain object such as { status, errorCode, message } instead of an
  // Error, so a thrown object carrying one of those fields comes from the provider.
  if (typeof error === 'object' && error !== null) {
    const shape = error as { status?: unknown; errorCode?: unknown };
    if (
      typeof shape.status === 'number' ||
      typeof shape.errorCode === 'number'
    ) {
      return { kind: 'provider' };
    }
  }

  return { kind: 'unknown' };
}

/**
 * One event from the ElevenLabs agent, as the LiveAvatar SDK forwards it.
 *
 * The SDK wraps the ElevenLabs client event: `elevenlabs_event_type` names it, and `data` is the
 * raw ElevenLabs payload, which nests every field under a `<type>_event` object.
 */
export interface ElevenLabsAgentEvent {
  event_id: string;
  elevenlabs_event_type: string;
  data: Record<string, unknown>;
}

/** Reads `data.<group>.<field>` when it is a string. Anything else is treated as missing. */
function readEventText(
  data: Record<string, unknown>,
  group: string,
  field: string,
): string {
  const payload = data[group];
  if (typeof payload !== 'object' || payload === null) return '';
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Turns one ElevenLabs agent event into the actions it means.
 *
 * Types we deliberately drop:
 * - `ping` is a keepalive that the SDK answers by itself.
 * - `audio` carries the speech in many small chunks. LiveAvatar plays them through the avatar
 *   and reports the speaking state with its own `avatar.speak_started` / `avatar.speak_ended`
 *   events, so handling the chunks would only cost a render each.
 * - anything else the agent may add later.
 */
export function elevenLabsEventActions(
  event: ElevenLabsAgentEvent,
): AssistantAction[] {
  const { data, event_id: eventId } = event;

  switch (event.elevenlabs_event_type) {
    case 'user_transcript': {
      const text = readEventText(
        data,
        'user_transcription_event',
        'user_transcript',
      );
      if (!text) return [];
      return [
        {
          type: 'transcriptAppended',
          turn: { id: eventId, speaker: 'user', text },
        },
      ];
    }

    case 'agent_response': {
      const text = readEventText(
        data,
        'agent_response_event',
        'agent_response',
      );
      if (!text) return [];
      return [
        {
          type: 'transcriptAppended',
          turn: { id: eventId, speaker: 'avatar', text },
        },
      ];
    }

    case 'agent_response_correction': {
      const group = 'agent_response_correction_event';
      const corrected = readEventText(data, group, 'corrected_agent_response');
      if (!corrected) return [];
      return [
        {
          type: 'transcriptCorrected',
          original: readEventText(data, group, 'original_agent_response'),
          corrected,
        },
      ];
    }

    case 'interruption':
      // The user cut in. The agent stops talking even though its audio was still arriving.
      return [{ type: 'avatarSpeaking', isSpeaking: false }];

    default:
      return [];
  }
}

/** Every kind the UI must have a message for. Used by the i18n coverage test. */
export const ASSISTANT_ERROR_KINDS = [
  'offline',
  'unauthorized',
  'forbidden',
  'rateLimited',
  'micPermission',
  'micUnavailable',
  'provider',
  'network',
  'timeout',
  'unknown',
] as const satisfies readonly AssistantErrorKind[];
