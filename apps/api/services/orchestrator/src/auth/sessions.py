import hashlib
import secrets
from uuid import UUID

from fastapi import Response

from ..config import Settings
from ..coordination import Coordinator

COOKIE_NAME = "kd_session"


def _token_hash(token: str) -> str:
    """Redis stores the hash of the token. A dump of Redis then holds no usable session."""
    return hashlib.sha256(token.encode()).hexdigest()


class SessionService:
    """Opaque session tokens. The same token is used as a web cookie and as a native bearer."""

    def __init__(self, *, coordinator: Coordinator, ttl_seconds: int):
        self.coordinator = coordinator
        self.ttl_seconds = ttl_seconds

    async def issue(self, user_id: UUID) -> str:
        token = secrets.token_urlsafe(32)
        await self.coordinator.set_auth_session(_token_hash(token), str(user_id), self.ttl_seconds)
        return token

    async def resolve(self, token: str) -> UUID | None:
        user_id = await self.coordinator.get_auth_session(_token_hash(token))
        if not user_id:
            return None
        try:
            return UUID(user_id)
        except ValueError:
            # A value we did not write. Treat it as no session instead of failing the request.
            return None

    async def revoke(self, token: str) -> None:
        await self.coordinator.delete_auth_session(_token_hash(token))


def set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        # Lax keeps the cookie on normal navigation but not on cross-site requests, which is
        # the CSRF protection for this session. Secure is off in development so http works.
        samesite="lax",
        secure=not settings.is_development,
        path="/",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        COOKIE_NAME,
        httponly=True,
        samesite="lax",
        secure=not settings.is_development,
        path="/",
    )
