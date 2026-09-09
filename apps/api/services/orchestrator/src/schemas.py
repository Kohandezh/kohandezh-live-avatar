from datetime import datetime
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class AssetStatus(StrEnum):
    DRAFT = "DRAFT"
    AUDIO_GENERATED = "AUDIO_GENERATED"
    AUDIO_APPROVED = "AUDIO_APPROVED"
    VIDEO_GENERATED = "VIDEO_GENERATED"
    VIDEO_APPROVED = "VIDEO_APPROVED"
    REJECTED = "REJECTED"


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    voice_id: str | None = None
    model_id: str | None = None
    language: str = "fa"
    speed: float = Field(default=1.0, ge=0.7, le=1.2)
    stability: float = Field(default=0.5, ge=0, le=1)
    similarity: float = Field(default=0.75, ge=0, le=1)
    style: float = Field(default=0.0, ge=0, le=1)
    output_format: str = "pcm_24000"

    @field_validator("text")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("text cannot be blank")
        return normalized

    @field_validator("output_format")
    @classmethod
    def require_pcm24(cls, value: str) -> str:
        if value != "pcm_24000":
            raise ValueError("only pcm_24000 is accepted by the Phase 1 avatar pipeline")
        return value


class AudioAssetResponse(BaseModel):
    id: UUID
    cache_key: str
    status: AssetStatus
    duration_ms: int
    sample_rate: int = 24000
    format: str = "pcm_s16le"
    media_url: str
    cache_hit: bool


class AvatarSessionRequest(BaseModel):
    avatar_id: UUID | None = None
    sandbox: bool | None = None
    max_session_duration: int | None = Field(default=None, ge=15, le=3600)


class AvatarSessionResponse(BaseModel):
    id: UUID
    provider_session_id: str
    room_name: str
    livekit_url: str
    livekit_client_token: str
    sandbox: bool
    # "managed" means LiveAvatar hosts the room, so recording is unavailable.
    transport: Literal["managed", "byo"]


class AvatarSpeakRequest(BaseModel):
    session_id: UUID
    text: str = Field(min_length=1, max_length=5000)


class AvatarActionRequest(BaseModel):
    session_id: UUID


class GenerateVideoRequest(BaseModel):
    session_id: UUID
    asset_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")
    text: str = Field(min_length=1, max_length=5000)
    audio_asset_id: UUID | None = None


class ApprovalRequest(BaseModel):
    status: AssetStatus

    @field_validator("status")
    @classmethod
    def manual_states_only(cls, value: AssetStatus) -> AssetStatus:
        if value not in {AssetStatus.AUDIO_APPROVED, AssetStatus.VIDEO_APPROVED, AssetStatus.REJECTED}:
            raise ValueError("manual review can only approve the current media stage or reject it")
        return value


class HealthComponent(BaseModel):
    status: str
    latency_ms: float | None = None
    detail: str | None = None


class HealthResponse(BaseModel):
    status: str
    timestamp: datetime
    dependencies: dict[str, HealthComponent]


class ErrorResponse(BaseModel):
    error: dict[str, Any]
    correlation_id: str
