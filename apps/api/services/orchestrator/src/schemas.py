from datetime import date, datetime
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


# Floor for a birthday. Mirrors EARLIEST_BIRTH_YEAR in
# apps/frontend/src/features/profile/jalali.ts; change both together.
EARLIEST_BIRTH_DATE = date(1900, 1, 1)


# CamelModel, not a plain BaseModel like the other request bodies above: firstName and
# lastName are two-word fields, and docs/API.md mandates camelCase on the wire.
class UpdateProfileBody(CamelModel):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    # Optional, and part of the full replace: sending null clears a birthday that was set
    # before. The client always sends the field, so "absent" and "cleared" cannot be confused.
    birth_date: date | None = None

    @field_validator("first_name", "last_name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("name cannot be blank")
        return normalized

    @field_validator("birth_date")
    @classmethod
    def check_birth_date(cls, value: date | None) -> date | None:
        """Reject dates a living person cannot have been born on.

        The bounds are deliberately wide. They exist to catch a typo or a broken client, not to
        guess a real age. EARLIEST_BIRTH_DATE is also the floor the date picker uses, so the two
        ends of the wire agree.
        """
        if value is None:
            return None
        if value > date.today():
            raise ValueError("birth date cannot be in the future")
        if value < EARLIEST_BIRTH_DATE:
            raise ValueError("birth date is too far in the past")
        return value


class PublicUser(CamelModel):
    """The allowlist of user fields that may leave the backend."""

    id: UUID
    phone: str
    first_name: str
    last_name: str
    email: str | None
    birth_date: date | None
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


# The report is closed (extra="forbid") and strict: only these two integers may reach a usage row,
# so no text-shaped key can ever arrive, and "5", 1.5 or true is not taken for a number.
# Only the wire name durationMs is known, so duration_ms is an unknown key. validate_by_name is the
# setting that decides: pydantic resolves the parent's populate_by_name=True into
# validate_by_name=True, and the child would inherit that.
class AssistantAnswerItem(CamelModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=False, validate_by_name=False)

    # Where the speech segment sits in the session, counted by the browser. It only exists so a
    # re-sent batch is not counted twice.
    index: int = Field(strict=True, ge=0, le=10_000)
    duration_ms: int = Field(strict=True, ge=1, le=3_600_000)


# A plain BaseModel, like AssistantSessionBody: "answers" is one word, so camelCase changes
# nothing, and FastAPI warns about the generated alias on a top-level body field.
class AssistantAnswersBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answers: list[AssistantAnswerItem] = Field(min_length=1, max_length=20)


class AssistantAnswersResponse(CamelModel):
    recorded: int
    duplicates: int
