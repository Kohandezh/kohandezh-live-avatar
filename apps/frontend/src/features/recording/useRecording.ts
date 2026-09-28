import { useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useDispatch, useSelector } from 'react-redux';
import { assetsApi, describeError, isApiError } from '@/shared/api';
import { isJobUnreadable, jobAcceptedSchema, useJob } from '@/entities/job';
import { recordingFromDto, videoAssetFromDto, videoFinalizeSchema } from '@/entities/video-asset';
import { useDiagnosticsLog } from '@/features/diagnostics';
import {
  recordingDone,
  recordingFailed,
  recordingFinalizing,
  recordingJobCheckAgain,
  recordingJobQueued,
  recordingReset,
  recordingStarted,
  recordingStarting,
  selectRecording,
} from './recordingSlice';

/** How often the finalize job is polled, and for how long before the screen stops (REQ-041). */
const FINALIZE_POLL_INTERVAL_MS = 2000;
const FINALIZE_POLL_WINDOW_MS = 180_000;

// The `admin` i18n keys of the recording steps (section 8, "Admin recording flow").
const ERRORS = 'library.record.errors';

const START_ERROR_KEYS: Record<string, string> = {
  recording_unavailable: `${ERRORS}.recordingUnavailable`,
  duplicate_generation: `${ERRORS}.recordingDuplicate`,
};

const FINALIZE_JOB_ERROR_KEYS: Record<string, string> = {
  egress_failure: `${ERRORS}.finalizeFileMissing`,
  egress_invalid_mp4: `${ERRORS}.finalizeInvalid`,
  worker_lost: `${ERRORS}.finalizeLost`,
};

const FINALIZE_FAILED = `${ERRORS}.finalizeFailed`;

/** The backend's code of a failed request, when it sent one. */
function serverCodeOf(error: unknown): string | null {
  return isApiError(error) ? (error.serverCode ?? error.code ?? null) : null;
}

export interface StartRecordingInput {
  sessionId: string;
  text: string;
  audioAssetId: string | null;
}

/**
 * Egress recording of the active session's room: start, then stop, whose finalize answers a job
 * that `useJob` polls until the MP4 is ready. The job id lives in the recording slice, so the
 * poll stops when the screen unmounts and resumes when it mounts again in the same tab.
 */
export function useRecording() {
  const dispatch = useDispatch();
  const state = useSelector(selectRecording);
  const log = useDiagnosticsLog();
  const job = useJob(state.jobId, {
    intervalMs: FINALIZE_POLL_INTERVAL_MS,
    pollUntil: state.jobPollSince === null ? null : state.jobPollSince + FINALIZE_POLL_WINDOW_MS,
  });

  const start = useMutation({
    mutationFn: async ({ sessionId, text, audioAssetId }: StartRecordingInput) => {
      dispatch(recordingStarting(text));
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
      const code = serverCodeOf(error);
      dispatch(
        recordingFailed({
          message: describeError(error),
          messageKey: (code && START_ERROR_KEYS[code]) || `${ERRORS}.recordingFailed`,
          code,
          keepActive: false,
        }),
      );
      log.error('egress', 'Starting the recording failed', { error: describeError(error) });
    },
  });

  // Finalize answers at once with a job id; a backend job waits for the MP4. A repeated
  // finalize while that job is queued or running gets the same job.
  const stop = useMutation({
    mutationFn: async () => {
      if (!state.active) throw new Error('No active recording');
      dispatch(recordingFinalizing());
      return jobAcceptedSchema.parse(await assetsApi.finalizeVideo(state.active.id)).jobId;
    },
    onSuccess: (jobId) => {
      dispatch(recordingJobQueued({ jobId, at: Date.now() }));
      log.info('egress', 'Finalize job queued', { jobId });
    },
    onError: (error) => {
      // Keep the handle so the operator can retry finalization instead of orphaning the Egress.
      dispatch(
        recordingFailed({
          message: describeError(error),
          messageKey: FINALIZE_FAILED,
          code: serverCodeOf(error),
          keepActive: true,
        }),
      );
      log.error('egress', 'Finalizing the recording failed', { error: describeError(error) });
    },
  });

  const { data: jobData, error: jobError } = job;
  const { jobId } = state;

  useEffect(() => {
    if (!jobId || !jobData) return;
    if (jobData.status === 'done') {
      const parsed = videoFinalizeSchema.safeParse(jobData.result);
      if (parsed.success) {
        const asset = videoAssetFromDto(parsed.data);
        dispatch(recordingDone(asset));
        log.info('egress', 'MP4 finalized; manual approval still required', {
          id: asset.id,
          status: asset.status,
          media_url: asset.mediaUrl,
          probe: asset.probe.raw,
        });
      } else {
        dispatch(
          recordingFailed({
            message: 'The finalize job answered a result that is not a video',
            messageKey: FINALIZE_FAILED,
            code: null,
            keepActive: false,
          }),
        );
      }
    } else if (jobData.status === 'failed') {
      const { code, message } = jobData.error;
      // Egress already stopped, so finalizing again cannot help: the admin records again.
      dispatch(
        recordingFailed({
          message: `${code}: ${message}`,
          messageKey: FINALIZE_JOB_ERROR_KEYS[code] ?? FINALIZE_FAILED,
          code,
          keepActive: false,
        }),
      );
      log.error('egress', 'The finalize job failed', { jobId, code });
    }
  }, [dispatch, jobData, jobId, log]);

  useEffect(() => {
    // Only a job that cannot be read ends the wait; any other failed poll is tried again.
    if (!jobId || !isJobUnreadable(jobError)) return;
    dispatch(
      recordingFailed({
        message: describeError(jobError),
        messageKey: FINALIZE_FAILED,
        code: serverCodeOf(jobError),
        keepActive: true,
      }),
    );
    log.error('egress', 'Reading the finalize job failed', { error: describeError(jobError) });
  }, [dispatch, jobError, jobId, log]);

  return {
    ...state,
    start,
    stop,
    reset: () => dispatch(recordingReset()),
    isActive: state.active !== null,
    job: {
      status: jobId ? (jobData?.status ?? null) : null,
      isSlow: job.hasTimedOut,
      checkAgain: () => dispatch(recordingJobCheckAgain(Date.now())),
    },
  };
}
