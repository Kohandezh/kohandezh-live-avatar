import type { AssetStatusDto, AudioAssetDto } from '@shared/api';

export interface AudioAsset {
  id: string;
  cacheKey: string;
  status: AssetStatusDto;
  durationMs: number;
  sampleRate: number;
  format: string;
  mediaUrl: string;
  cacheHit: boolean;
}

export function audioAssetFromDto(dto: AudioAssetDto): AudioAsset {
  return {
    id: dto.id,
    cacheKey: dto.cache_key,
    status: dto.status,
    durationMs: dto.duration_ms,
    sampleRate: dto.sample_rate,
    format: dto.format,
    mediaUrl: dto.media_url,
    cacheHit: dto.cache_hit,
  };
}
