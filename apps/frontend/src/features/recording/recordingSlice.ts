import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { VideoAsset, VideoRecording } from '@/entities/video-asset';

// CLIENT STATE: the Egress recording this tab started. The orchestrator owns the video asset and
// Egress job; there is no query endpoint for them in Phase 1, so the client keeps the handle.
// `jobId` is the finalize job being polled, kept here so leaving the screen and coming back in
// the same tab resumes the poll (REQ-041). The job's status itself stays server state.
export type RecordingStatus = 'idle' | 'starting' | 'recording' | 'finalizing' | 'done' | 'error';

export interface RecordingState {
  status: RecordingStatus;
  active: VideoRecording | null;
  result: VideoAsset | null;
  /** The raw error text: the server's code and message, for the diagnostics log only. */
  error: string | null;
  /** The `admin` i18n key of the message the screen shows (section 8). */
  errorKey: string | null;
  /** The backend's error code, shown under the message so an admin can quote it. */
  errorCode: string | null;
  /** The text the current recording speaks, so a screen can tell whose recording it is. */
  recordedText: string | null;
  jobId: string | null;
  /** When the current 180 s poll window started (epoch ms). Check again starts a new one. */
  jobPollSince: number | null;
}

const initialState: RecordingState = {
  status: 'idle',
  active: null,
  result: null,
  error: null,
  errorKey: null,
  errorCode: null,
  recordedText: null,
  jobId: null,
  jobPollSince: null,
};

const slice = createSlice({
  name: 'recording',
  initialState,
  reducers: {
    recordingStarting(state, action: PayloadAction<string>) {
      state.status = 'starting';
      state.recordedText = action.payload;
      state.error = null;
      state.errorKey = null;
      state.errorCode = null;
      state.result = null;
      state.jobId = null;
      state.jobPollSince = null;
    },
    recordingStarted(state, action: PayloadAction<VideoRecording>) {
      state.status = 'recording';
      state.active = action.payload;
    },
    recordingFinalizing(state) {
      state.status = 'finalizing';
      state.error = null;
      state.errorKey = null;
      state.errorCode = null;
      // A retry gets its job id from the new finalize answer, never the previous job's.
      state.jobId = null;
      state.jobPollSince = null;
    },
    recordingJobQueued(state, action: PayloadAction<{ jobId: string; at: number }>) {
      state.jobId = action.payload.jobId;
      state.jobPollSince = action.payload.at;
    },
    recordingJobCheckAgain(state, action: PayloadAction<number>) {
      if (state.jobId) state.jobPollSince = action.payload;
    },
    recordingDone(state, action: PayloadAction<VideoAsset>) {
      state.status = 'done';
      state.active = null;
      state.result = action.payload;
      state.jobId = null;
      state.jobPollSince = null;
    },
    recordingFailed(
      state,
      action: PayloadAction<{
        message: string;
        messageKey: string;
        code: string | null;
        keepActive: boolean;
      }>,
    ) {
      state.status = 'error';
      state.error = action.payload.message;
      state.errorKey = action.payload.messageKey;
      state.errorCode = action.payload.code;
      state.jobId = null;
      state.jobPollSince = null;
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
  recordingJobCheckAgain,
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
