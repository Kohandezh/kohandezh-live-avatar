import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { VideoAsset, VideoRecording } from '@entities/video-asset';

// CLIENT STATE: the Egress recording this tab started. The orchestrator owns the video asset and
// Egress job; there is no query endpoint for them in Phase 1, so the client keeps the handle.
export type RecordingStatus = 'idle' | 'starting' | 'recording' | 'finalizing' | 'done' | 'error';

export interface RecordingState {
  status: RecordingStatus;
  active: VideoRecording | null;
  result: VideoAsset | null;
  error: string | null;
}

const initialState: RecordingState = { status: 'idle', active: null, result: null, error: null };

const slice = createSlice({
  name: 'recording',
  initialState,
  reducers: {
    recordingStarting(state) {
      state.status = 'starting';
      state.error = null;
      state.result = null;
    },
    recordingStarted(state, action: PayloadAction<VideoRecording>) {
      state.status = 'recording';
      state.active = action.payload;
    },
    recordingFinalizing(state) {
      state.status = 'finalizing';
    },
    recordingDone(state, action: PayloadAction<VideoAsset>) {
      state.status = 'done';
      state.active = null;
      state.result = action.payload;
    },
    recordingFailed(state, action: PayloadAction<{ message: string; keepActive: boolean }>) {
      state.status = 'error';
      state.error = action.payload.message;
      if (!action.payload.keepActive) state.active = null;
    },
    recordingReset() {
      return initialState;
    },
  },
});

export const {
  recordingStarting,
  recordingStarted,
  recordingFinalizing,
  recordingDone,
  recordingFailed,
  recordingReset,
} = slice.actions;
export const recordingReducer = slice.reducer;

export interface WithRecording {
  recording: RecordingState;
}
export const selectRecording = (state: WithRecording) => state.recording;
export const selectRecordingActive = (state: WithRecording) =>
  state.recording.active !== null &&
  (state.recording.status === 'recording' ||
    state.recording.status === 'finalizing' ||
    state.recording.status === 'error');
