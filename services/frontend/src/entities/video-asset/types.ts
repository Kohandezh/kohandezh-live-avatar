import type { AssetStatusDto, VideoFinalizeDto, VideoRecordingDto } from '@shared/api';

export interface VideoRecording {
  id: string;
  egressId: string;
  externalId: string;
}

export interface VideoProbe {
  durationMs?: number;
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  raw: Record<string, unknown>;
}

export interface VideoAsset {
  id: string;
  status: AssetStatusDto;
  mediaUrl: string;
  probe: VideoProbe;
}

export function recordingFromDto(dto: VideoRecordingDto, externalId: string): VideoRecording {
  return { id: dto.id, egressId: dto.egress_id, externalId };
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** The orchestrator's probe payload is ffprobe-derived and not strictly typed; pick known keys. */
export function videoAssetFromDto(dto: VideoFinalizeDto): VideoAsset {
  const raw = dto.probe ?? {};
  const probe: VideoProbe = { raw };
  const durationMs = num(raw['duration_ms']);
  const videoCodec = str(raw['video_codec']);
  const audioCodec = str(raw['audio_codec']);
  const width = num(raw['width']);
  const height = num(raw['height']);
  if (durationMs !== undefined) probe.durationMs = durationMs;
  if (videoCodec !== undefined) probe.videoCodec = videoCodec;
  if (audioCodec !== undefined) probe.audioCodec = audioCodec;
  if (width !== undefined) probe.width = width;
  if (height !== undefined) probe.height = height;
  return { id: dto.id, status: dto.status, mediaUrl: dto.media_url, probe };
}
