from collections.abc import Mapping
from typing import Any

from fastapi import Depends, Request

from ..errors import ForbiddenError, UnauthorizedError
from .sessions import COOKIE_NAME

UserRow = Mapping[str, Any]


def client_ip(request: Request) -> str | None:
    """The browser address, used for the per address rate limits."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        # nginx appends the real client, so the first entry is the browser. The orchestrator is
        # only reachable through that proxy, so this header can be trusted in this deployment.
        return forwarded.split(",")[0].strip() or None
    return request.client.host if request.client else None


def session_token(request: Request) -> str | None:
    """Native sends a bearer token, web sends the kd_session cookie."""
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return request.cookies.get(COOKIE_NAME) or None


async def resolve_optional_user(request: Request) -> UserRow | None:
    """The signed in user, or None when the request carries no session at all.

    A session that is present but no longer valid raises 401 instead of falling through to
    anonymous, so a stale cookie can never be mistaken for a widget visitor.
    """
    token = session_token(request)
    if not token:
        return None
    user_id = await request.app.state.sessions.resolve(token)
    if not user_id:
        raise UnauthorizedError()
    user = await request.app.state.database.get_user(user_id)
    if not user:
        raise UnauthorizedError()
    if user["status"] != "active":
        raise ForbiddenError("this account is disabled", "account_disabled")
    return user


async def get_current_user(request: Request) -> UserRow:
    user = await resolve_optional_user(request)
    if not user:
        raise UnauthorizedError()
    return user


async def require_admin(user: UserRow = Depends(get_current_user)) -> UserRow:
    """UI guards are cosmetic. This is where the admin role is actually enforced."""
    if user["role"] != "admin":
        raise ForbiddenError("this endpoint needs the admin role")
    return user
