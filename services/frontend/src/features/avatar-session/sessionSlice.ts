import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { AvatarSession } from '@entities/session';
import type { AvatarSessionState } from './types';

// CLIENT STATE: which server session this tab is attached to and what the LiveKit connection is
// doing. The orchestrator owns the session itself (no list endpoint exists in Phase 1); this
// slice only mirrors what the client observed. Tokens are never stored here.
const initialState: AvatarSessionState = {
  status: 'idle',
  session: null,
  media: { audio: false, video: false },
  audioBlocked: false,
  speaking: false,
  error: null,
};

const slice = createSlice({
  name: 'avatarSession',
  initialState,
  reducers: {
    sessionStarting(state) {
      state.status = 'starting';
      state.error = null;
      state.media = { audio: false, video: false };
      state.audioBlocked = false;
    },
    sessionCreated(state, action: PayloadAction<AvatarSession>) {
      state.session = action.payload;
    },
    sessionConnecting(state) {
      state.status = 'connecting';
    },
    sessionConnected(state) {
      state.status = 'connected';
      state.error = null;
    },
    sessionReconnecting(state) {
      state.status = 'reconnecting';
    },
    sessionDisconnected(state, action: PayloadAction<string | undefined>) {
      if (state.status === 'closing' || state.status === 'idle') return;
      state.status = 'disconnected';
      state.media = { audio: false, video: false };
      state.speaking = false;
      state.error = action.payload ?? null;
    },
    sessionClosing(state) {
      state.status = 'closing';
    },
    sessionClosed() {
      return initialState;
    },
    sessionFailed(state, action: PayloadAction<string>) {
      state.status = 'error';
      state.error = action.payload;
      state.session = null;
      state.media = { audio: false, video: false };
      state.speaking = false;
    },
    mediaChanged(state, action: PayloadAction<{ kind: 'audio' | 'video'; attached: boolean }>) {
      state.media[action.payload.kind] = action.payload.attached;
    },
    audioPlaybackChanged(state, action: PayloadAction<{ blocked: boolean }>) {
      state.audioBlocked = action.payload.blocked;
    },
    speakingChanged(state, action: PayloadAction<boolean>) {
      state.speaking = action.payload;
    },
  },
});

export const {
  sessionStarting,
  sessionCreated,
  sessionConnecting,
  sessionConnected,
  sessionReconnecting,
  sessionDisconnected,
  sessionClosing,
  sessionClosed,
  sessionFailed,
  mediaChanged,
  audioPlaybackChanged,
  speakingChanged,
} = slice.actions;
export const avatarSessionReducer = slice.reducer;

export interface WithAvatarSession {
  avatarSession: AvatarSessionState;
}
export const selectAvatarSession = (state: WithAvatarSession) => state.avatarSession;
export const selectActiveSessionId = (state: WithAvatarSession) =>
  state.avatarSession.status === 'connected' ? (state.avatarSession.session?.id ?? null) : null;
