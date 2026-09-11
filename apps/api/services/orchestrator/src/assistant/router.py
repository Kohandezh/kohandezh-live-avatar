import secrets
from dataclasses import dataclass
from uuid import UUID

from fastapi import APIRouter, Depends, Request

from ..auth.dependencies import client_ip, resolve_optional_user
from ..config import Settings
from ..errors import ForbiddenError, RateLimitedError, UnauthorizedError
from ..schemas import AssistantSessionBody, AssistantSessionResponse

HOUR_SECONDS = 3600

router = APIRouter(tags=["assistant"])


@dataclass
class Principal:
    """Who is asking for a session: a signed in user, or the widget on an allowed website."""

    key: str  # stored on the session row, and checked again on close
    rate_key: str  # what the hourly limit counts
    user_id: UUID | None


def origin_allowed(origin: str, settings: Settings) -> bool:
    allowed = settings.embed_allowed_origin_list
    if "*" in allowed:
        # The wildcard is a development convenience. In any other environment it means nothing.
        return settings.is_development
    return bool(origin) and origin in allowed


async def get_principal(request: Request) -> Principal:
    """A session belongs to a user, or to the embed key on an allowed origin. Nothing else."""
    user = await resolve_optional_user(request)
    if user:
        return Principal(key=f"user:{user['id']}", rate_key=f"user:{user['id']}", user_id=user["id"])

    settings: Settings = request.app.state.settings
    configured = settings.assistant_embed_key.get_secret_value()
    provided = request.headers.get("X-Embed-Key", "")
    if not configured or not provided or not secrets.compare_digest(provided, configured):
        raise UnauthorizedError()
    origin = request.headers.get("Origin", "").strip()
    if not origin_allowed(origin, settings):
        raise ForbiddenError("this website may not use the assistant embed key", "embed_origin_not_allowed")
    # The embed key is public, so the limit counts each visitor address, not the key alone.
    return Principal(key=f"embed:{origin}", rate_key=f"embed:{client_ip(request) or 'unknown'}", user_id=None)


@router.post("/assistant/session", response_model=AssistantSessionResponse)
async def create_assistant_session(
    payload: AssistantSessionBody,
    request: Request,
    principal: Principal = Depends(get_principal),
) -> AssistantSessionResponse:
    settings: Settings = request.app.state.settings
    wait = await request.app.state.coordinator.rate_limit(
        f"assistant:{principal.rate_key}", settings.assistant_rate_limit_per_hour, HOUR_SECONDS
    )
    if wait:
        raise RateLimitedError("assistant_rate_limited", "too many assistant sessions in the last hour", wait)
    session = await request.app.state.assistant.create(
        principal=principal.key,
        user_id=principal.user_id,
        language=payload.language or settings.liveavatar_assistant_language,
    )
    return AssistantSessionResponse(
        id=session.id,
        session_token=session.session_token,
        provider_session_id=session.provider_session_id,
        sandbox=session.sandbox,
        avatar_id=session.avatar_id,
        language=session.language,
        requested_language=session.requested_language,
        max_session_duration_seconds=session.max_session_duration_seconds,
        agent_type=session.agent_type,
    )


@router.post("/assistant/session/{session_id}/close")
async def close_assistant_session(
    session_id: UUID,
    request: Request,
    principal: Principal = Depends(get_principal),
) -> dict[str, str]:
    await request.app.state.assistant.close(session_id, principal.key)
    return {"status": "closed"}
