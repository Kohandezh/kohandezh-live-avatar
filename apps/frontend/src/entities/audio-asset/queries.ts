import { useQuery } from '@tanstack/react-query';
import { assetsApi } from '@/shared/api';

export const audioAssetKeys = {
  all: ['audio-assets'] as const,
  pcm: (id: string) => [...audioAssetKeys.all, 'pcm', id] as const,
};

/** Raw PCM bytes of an immutable, content-addressed asset: never stale once fetched. */
export function useAudioPcm(assetId: string | undefined) {
  return useQuery({
    queryKey: audioAssetKeys.pcm(assetId ?? ''),
    queryFn: () => assetsApi.fetchAudioPcm(assetId as string),
    enabled: !!assetId,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  });
}
