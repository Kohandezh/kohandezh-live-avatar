// Wire-level DTOs exactly as the FastAPI orchestrator (apps/api/services/orchestrator/src/schemas.py and
// main.py) returns them. Entities map these into domain types; shared/ never imports entities/.

export type AssetStatusDto =
  | 'DRAFT'
  | 'AUDIO_GENERATED'
  | 'AUDIO_APPROVED'
  | 'VIDEO_GENERATED'
  | 'VIDEO_APPROVED'
  | 'REJECTED';

export interface HealthComponentDto {
  status: string;
  latency_ms?: number | null;
  detail?: string | null;
}

export interface HealthDto {
  status: 'ok' | 'degraded' | string;
  timestamp: string;
  dependencies: Record<string, HealthComponentDto>;
}

export interface TtsRequestDto {
  text: string;
  voice_id?: string | null;
  model_id?: string | null;
  language?: string;
  speed?: number;
  stability?: number;
  similarity?: number;
  style?: number;
  output_format?: 'pcm_24000';
}

export interface AudioAssetDto {
  id: string;
  cache_key: string;
  status: AssetStatusDto;
  duration_ms: number;
  sample_rate: number;
  format: string;
  media_url: string;
  cache_hit: boolean;
}

export interface AvatarSessionRequestDto {
  avatar_id?: string | null;
  sandbox?: boolean | null;
  max_session_duration?: number;
}

export interface AvatarSessionDto {
  id: string;
  provider_session_id: string;
  room_name: string;
  livekit_url: string;
  /** Scoped subscribe-only LiveKit token. Consumed by the LiveKit SDK, never stored or logged. */
  livekit_client_token: string;
  sandbox: boolean;
  /** "managed" means LiveAvatar owns the room, so recording is unavailable. */
  transport: 'managed' | 'byo';
}

export interface AvatarSpeakResultDto {
  event_id: string;
  audio_asset_id: string | null;
  cache_hit: boolean;
  interrupted: boolean;
}

export interface AvatarInterruptResultDto {
  status: 'interrupted';
}

export interface AvatarListeningResultDto {
  event_id: string;
  state: 'start' | 'stop';
}

export interface AvatarCloseResultDto {
  status: 'closed';
}

export interface GenerateVideoRequestDto {
  session_id: string;
  asset_id: string;
  text: string;
  audio_asset_id?: string | null;
}

export interface VideoRecordingDto {
  id: string;
  egress_id: string;
  status: 'RECORDING';
}

export interface VideoFinalizeDto {
  id: string;
  status: AssetStatusDto;
  media_url: string;
  probe: Record<string, unknown>;
}

export interface SystemStatusEventDto {
  type: 'system.status';
  active_sessions: number;
  timestamp: string;
}
