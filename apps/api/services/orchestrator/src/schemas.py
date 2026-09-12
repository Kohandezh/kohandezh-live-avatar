from datetime import datetime
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base for the starter-style endpoints (/auth, /me, /admin, /assistant).

    They speak camelCase because that is what docs/API.md promises the frontend. The Phase 1
    workbench endpoints keep their snake_case bodies.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


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


# Request bodies stay plain models. Every field they carry is one lowercase word, so camelCase
# would change nothing, and FastAPI plus pydantic warn about an alias generator on a body model.
class OtpRequestBody(BaseModel):
    phone: str = Field(min_length=3, max_length=32)


class OtpRequestResponse(CamelModel):
    phone: str
    expires_in_seconds: int
    resend_after_seconds: int
    # Only filled when APP_ENV=development, so the flow can be tested without an SMS provider.
    dev_code: str | None = None


class OtpVerifyBody(BaseModel):
    phone: str = Field(min_length=3, max_length=32)
    code: str = Field(min_length=4, max_length=10)


# CamelModel, not a plain BaseModel like the other request bodies above: firstName and
# lastName are two-word fields, and docs/API.md mandates camelCase on the wire.
class UpdateProfileBody(CamelModel):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)

    @field_validator("first_name", "last_name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("name cannot be blank")
        return normalized


class PublicUser(CamelModel):
    """The allowlist of user fields that may leave the backend."""

    id: UUID
    phone: str
    first_name: str
    last_name: str
    email: str | None
    role: Literal["user", "admin"]
    status: Literal["active", "disabled"]
    created_at: datetime


class LoginResponse(CamelModel):
    user: PublicUser
    # Native clients get the token in the body. Web gets the kd_session cookie instead.
    access_token: str | None = None


class UserPage(CamelModel):
    items: list[PublicUser]
    total: int
    page: int
    page_size: int


class DashboardSummary(CamelModel):
    total_users: int
    active_users: int
    disabled_users: int
    new_users_this_week: int


class AssistantSessionBody(BaseModel):
    language: Literal["fa", "en"] | None = None


class AssistantSessionResponse(CamelModel):
    id: UUID
    session_token: str
    provider_session_id: str
    sandbox: bool
    avatar_id: str
    # The language the session actually started in. May differ from requestedLanguage: FULL mode
    # does not support every language, and the voice agent ignores the request and uses its own.
    language: str
    requested_language: str
    max_session_duration_seconds: int
    # Which SDK session class can drive this token. "elevenlabs" needs ElevenLabsAgentSession,
    # "full" needs LiveAvatarSession.
    agent_type: Literal["elevenlabs", "full"]
