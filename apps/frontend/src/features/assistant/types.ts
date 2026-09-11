import type { AssistantSessionInfo } from '@/entities/assistant-session';

/**
 * idle       nothing started yet
 * requesting waiting for our backend to mint a session token
 * connecting the SDK is joining the provider room
 * connected  audio and video are flowing
 * ending     the user pressed End; the SDK and the backend row are being closed
 * ended      the conversation is over (by the user, by the provider, or by the time limit)
 * error      the session could not start
 */
export type AssistantStatus =
  | 'idle'
  | 'requesting'
  | 'connecting'
  | 'connected'
  | 'ending'
  | 'ended'
  | 'error';

/** Same session in both modes. Video mode shows the avatar, voice mode hides it (D5). */
export type AssistantMode = 'voice' | 'video';

export type AssistantConnectionQuality = 'unknown' | 'good' | 'bad';

/** Why the conversation stopped. Drives which message the user sees. */
export type AssistantEndReason = 'user' | 'timeLimit' | 'provider';

/** One kind per user-facing message in `assistant.errors.*`. */
export type AssistantErrorKind =
  | 'offline'
  | 'unauthorized'
  | 'forbidden'
  | 'rateLimited'
  | 'micPermission'
  | 'micUnavailable'
  | 'provider'
  | 'network'
  | 'timeout'
  | 'unknown';

export interface AssistantError {
  kind: AssistantErrorKind;
  /** The backend's own code (for example `liveavatar_quota`), shown as a code line only. */
  code?: string;
}

export interface TranscriptTurn {
  id: string;
  speaker: 'user' | 'avatar';
  text: string;
}

export interface AssistantState {
  status: AssistantStatus;
  mode: AssistantMode;
  session: AssistantSessionInfo | null;
  transcript: TranscriptTurn[];
  isMicMuted: boolean;
  isUserSpeaking: boolean;
  isAvatarSpeaking: boolean;
  /** True once the provider reports the media stream is ready to play. */
  isStreamReady: boolean;
  /** True when the browser refused to play the audio without a user gesture. */
  isAudioBlocked: boolean;
  connectionQuality: AssistantConnectionQuality;
  /** Wall-clock time the provider will stop the session, set when the session connects. */
  endsAt: number | null;
  endReason: AssistantEndReason | null;
  error: AssistantError | null;
}
