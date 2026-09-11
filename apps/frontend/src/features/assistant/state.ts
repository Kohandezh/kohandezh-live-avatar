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
  | { type: 'ending' }
  | { type: 'ended'; reason: AssistantEndReason }
  | { type: 'micChanged'; isMuted: boolean }
  | { type: 'userSpeaking'; isSpeaking: boolean }
  | { type: 'avatarSpeaking'; isSpeaking: boolean }
  | { type: 'transcriptAppended'; turn: TranscriptTurn }
  | { type: 'streamReady' }
  | { type: 'audioBlocked'; isBlocked: boolean }
  | { type: 'qualityChanged'; quality: AssistantConnectionQuality };

/** Statuses where a provider or SDK event can still change the conversation. */
const LIVE_STATUSES: ReadonlySet<AssistantState['status']> = new Set([
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
      return { ...state, isUserSpeaking: action.isSpeaking };

    case 'avatarSpeaking':
      return { ...state, isAvatarSpeaking: action.isSpeaking };

    case 'transcriptAppended':
      return state.transcript.some((turn) => turn.id === action.turn.id)
        ? state
        : { ...state, transcript: [...state.transcript, action.turn] };

    case 'streamReady':
      return { ...state, isStreamReady: true };

    case 'audioBlocked':
      return { ...state, isAudioBlocked: action.isBlocked };

    case 'qualityChanged':
      return { ...state, connectionQuality: action.quality };
  }
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
