import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { VideoAsset, VideoRecording } from '@/entities/video-asset';

// CLIENT STATE: the Egress recording this tab started. The orchestrator owns the video asset and
// Egress job; there is no query endpoint for them in Phase 1, so the client keeps the handle.
// `jobId` is the finalize job being polled: the job's state itself stays server state.
export type RecordingStatus = 'idle' | 'starting' | 'recording' | 'finalizing' | 'done' | 'error';

export interface RecordingState {
  status: RecordingStatus;
  active: VideoRecording | null;
  result: VideoAsset | null;
  /** The raw error text: the server's code and message, for logs and as a fallback. */
  error: string | null;
  /** An i18n key the UI shows instead of `error`, when the failure has a translation. */
  errorKey: string | null;
  jobId: string | null;
}

const initialState: RecordingState = {
  status: 'idle',
  active: null,
  result: null,
  error: null,
  errorKey: null,
  jobId: null,
};

const slice = createSlice({
  name: 'recording',
  initialState,
  reducers: {
    recordingStarting(state) {
      state.status = 'starting';
      state.error = null;
      state.errorKey = null;
      state.result = null;
      state.jobId = null;
    },
    recordingStarted(state, action: PayloadAction<VideoRecording>) {
      state.status = 'recording';
      state.active = action.payload;
    },
    recordingFinalizing(state) {
      state.status = 'finalizing';
      // A retry gets its job id from the new finalize answer, never the previous job's.
      state.jobId = null;
    },
    recordingJobQueued(state, action: PayloadAction<string>) {
      state.jobId = action.payload;
    },
    recordingDone(state, action: PayloadAction<VideoAsset>) {
      state.status = 'done';
      state.active = null;
      state.result = action.payload;
      state.jobId = null;
    },
    recordingFailed(
      state,
      action: PayloadAction<{ message: string; messageKey?: string; keepActive: boolean }>,
    ) {
      state.status = 'error';
      state.error = action.payload.message;
      state.errorKey = action.payload.messageKey ?? null;
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
  recordingJobQueued,
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
