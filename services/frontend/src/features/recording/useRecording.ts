import { useMutation } from '@tanstack/react-query';
import { useDispatch, useSelector } from 'react-redux';
import { assetsApi, describeError } from '@shared/api';
import { recordingFromDto, videoAssetFromDto } from '@entities/video-asset';
import { useDiagnosticsLog } from '@features/diagnostics';
import {
  recordingDone,
  recordingFailed,
  recordingFinalizing,
  recordingReset,
  recordingStarted,
  recordingStarting,
  selectRecording,
} from './recordingSlice';

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

  const stop = useMutation({
    mutationFn: async () => {
      if (!state.active) throw new Error('No active recording');
      dispatch(recordingFinalizing());
      const dto = await assetsApi.finalizeVideo(state.active.id);
      return videoAssetFromDto(dto);
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
      // Keep the handle so the operator can retry finalization instead of orphaning the Egress.
      dispatch(recordingFailed({ message: describeError(error), keepActive: true }));
      log.error('egress', 'Finalizing the recording failed', { error: describeError(error) });
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
