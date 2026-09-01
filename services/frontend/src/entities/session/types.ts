import type { AvatarSessionDto } from '@shared/api';

/**
 * Client-side view of an orchestrator-managed avatar session.
 * The LiveKit browser token is deliberately NOT part of this type: it is handed to the LiveKit SDK
 * once at connect time and never stored in Redux, persisted, or logged.
 */
export interface AvatarSession {
  id: string;
  providerSessionId: string;
  roomName: string;
  livekitUrl: string;
  sandbox: boolean;
}

export function sessionFromDto(dto: AvatarSessionDto): AvatarSession {
  return {
    id: dto.id,
    providerSessionId: dto.provider_session_id,
    roomName: dto.room_name,
    livekitUrl: dto.livekit_url,
    sandbox: dto.sandbox,
  };
}
