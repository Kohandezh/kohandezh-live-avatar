import { useMutation } from '@tanstack/react-query';
import { useDispatch } from 'react-redux';
import { assetsApi, describeError } from '@/shared/api';
import { audioAssetFromDto, type AudioAsset } from '@/entities/audio-asset';
import { useDiagnosticsLog } from '@/features/diagnostics';
import { setLastAudio } from './composerSlice';

/**
 * Generate Audio: text -> POST /tts/generate -> AudioAsset. The server deduplicates identical
 * requests through its cache, so repeating a request does not consume ElevenLabs credits.
 */
export function useTtsGeneration() {
  const dispatch = useDispatch();
  const log = useDiagnosticsLog();

  const mutation = useMutation({
    mutationFn: async (text: string): Promise<AudioAsset> => {
      const dto = await assetsApi.generateTts({ text });
      return audioAssetFromDto(dto);
    },
    onSuccess: (asset, text) => {
      dispatch(setLastAudio({ id: asset.id, durationMs: asset.durationMs, text }));
      log.info('tts', asset.cacheHit ? 'Audio served from cache' : 'ElevenLabs audio generated', {
        asset_id: asset.id,
        duration_ms: asset.durationMs,
        cache_hit: asset.cacheHit,
        status: asset.status,
      });
    },
    onError: (error) =>
      log.error('tts', 'Audio generation failed', { error: describeError(error) }),
  });

  return {
    generate: (text: string) => mutation.mutate(text),
    asset: mutation.data,
    error: mutation.error,
    isPending: mutation.isPending,
    reset: mutation.reset,
  };
}
