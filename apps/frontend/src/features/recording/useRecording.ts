import { useMutation } from '@tanstack/react-query';
import { useDispatch, useSelector } from 'react-redux';
import { assetsApi, describeError } from '@/shared/api';
import {
  JobFailedError,
  JobTimeoutError,
  jobAcceptedSchema,
  useWaitForJob,
} from '@/entities/job';
import { recordingFromDto, videoAssetFromDto, videoFinalizeSchema } from '@/entities/video-asset';
import { useDiagnosticsLog } from '@/features/diagnostics';
import {
  recordingDone,
  recordingFailed,
  recordingFinalizing,
  recordingJobQueued,
  recordingReset,
  recordingStarted,
  recordingStarting,
  selectRecording,
} from './recordingSlice';

/** How often the finalize job is polled, and how long before the workbench stops waiting. */
const FINALIZE_POLL_INTERVAL_MS = 2000;
const FINALIZE_TIMEOUT_MS = 180_000;

// The translated text of each finalize job error code (docs/API.md). A code missing here shows
// the server's own text.
const FINALIZE_JOB_ERROR_KEYS: Record<string, string> = {
  egress_failure: 'recording.errors.egress_failure',
  egress_invalid_mp4: 'recording.errors.egress_invalid_mp4',
  invalid_status_transition: 'recording.errors.invalid_status_transition',
  not_found: 'recording.errors.not_found',
  worker_lost: 'recording.errors.worker_lost',
  internal_error: 'recording.errors.generic',
};

/** The raw text of a finalize failure, and the i18n key to show instead, if there is one. */
function describeFinalizeError(error: unknown): { message: string; messageKey?: string } {
  if (error instanceof JobTimeoutError) {
    return { message: error.message, messageKey: 'recording.timeout' };
  }
  if (error instanceof JobFailedError) {
    return {
      message: `${error.code}: ${error.message}`,
      messageKey: FINALIZE_JOB_ERROR_KEYS[error.code],
    };
  }
  return { message: describeError(error) };
}

export interface StartRecordingInput {
  sessionId: string;
  text: string;
  audioAssetId: string | null;
}

/** Egress recording of the active session's room: start -> stop/finalize -> MP4 link + probe. */
export function useRecording() {
  const dispatch = useDispatch();
  const state = useSelector(selectRecording);
  const log = useDiagnosticsLog();
  const waitForJob = useWaitForJob();

  const start = useMutation({
    mutationFn: async ({ sessionId, text, audioAssetId }: StartRecordingInput) => {
      dispatch(recordingStarting());
      const externalId = `AVATAR_${new Date()
        .toISOString()
        .replace(/[-:.TZ]/g, '')
        .slice(0, 14)}`;
      const dto = await assetsApi.generateVideo({
        session_id: sessionId,
        asset_id: externalId,
        text,
        audio_asset_id: audioAssetId,
      });
      return recordingFromDto(dto, externalId);
    },
    onSuccess: (recording) => {
      dispatch(recordingStarted(recording));
      log.info('egress', 'Egress recording started', recording);
    },
    onError: (error) => {
      dispatch(recordingFailed({ message: describeError(error), keepActive: false }));
      log.error('egress', 'Starting the recording failed', { error: describeError(error) });
    },
  });

  // Finalize answers at once with a job id; a backend job waits for the MP4. A repeated
  // finalize while that job is queued or running gets the same job, so a retry after a timeout
  // checks the same job again instead of stopping Egress twice.
  const stop = useMutation({
    mutationFn: async () => {
      if (!state.active) throw new Error('No active recording');
      dispatch(recordingFinalizing());
      const { jobId } = jobAcceptedSchema.parse(await assetsApi.finalizeVideo(state.active.id));
      dispatch(recordingJobQueued(jobId));
      log.info('egress', 'Finalize job queued', { jobId });
      const job = await waitForJob(jobId, {
        intervalMs: FINALIZE_POLL_INTERVAL_MS,
        timeoutMs: FINALIZE_TIMEOUT_MS,
      });
      if (job.status === 'failed') {
        throw new JobFailedError(jobId, job.error.code, job.error.message);
      }
      return videoAssetFromDto(videoFinalizeSchema.parse(job.result));
    },
    onSuccess: (asset) => {
      dispatch(recordingDone(asset));
      log.info('egress', 'MP4 finalized; manual approval still required', {
        id: asset.id,
        status: asset.status,
        media_url: asset.mediaUrl,
        probe: asset.probe.raw,
      });
    },
    onError: (error) => {
      const { message, messageKey } = describeFinalizeError(error);
      // Keep the handle so the operator can retry finalization instead of orphaning the Egress.
      dispatch(recordingFailed({ message, messageKey, keepActive: true }));
      log.error('egress', 'Finalizing the recording failed', { error: message });
    },
  });

  return {
    ...state,
    start,
    stop,
    reset: () => dispatch(recordingReset()),
    isActive: state.active !== null,
  };
}
