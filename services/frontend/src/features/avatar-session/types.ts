import type { AvatarSession } from '@entities/session';

export type SessionStatus =
  | 'idle'
  | 'starting'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'closing'
  | 'error';

export interface MediaAttachment {
  audio: boolean;
  video: boolean;
}

export interface AvatarSessionState {
  status: SessionStatus;
  session: AvatarSession | null;
  media: MediaAttachment;
  /** Browser autoplay policy blocked audio; the user must interact to enable playback. */
  audioBlocked: boolean;
  speaking: boolean;
  error: string | null;
}

export type RoomConnectionEvent =
  | { type: 'connected' }
  | { type: 'reconnecting' }
  | { type: 'reconnected' }
  | { type: 'disconnected'; reason?: string | undefined };

export interface RoomCallbacks {
  onConnection(event: RoomConnectionEvent): void;
  onTrack(kind: 'audio' | 'video', attached: boolean, detail?: unknown): void;
  onAudioPlayback(canPlay: boolean): void;
  onEvent(level: 'info' | 'warn' | 'error', message: string, data?: unknown): void;
}
