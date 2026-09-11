import hashlib
import json
import logging
import time
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from services.liveavatar.client import LiveAvatarClient

from ..config import Settings
from ..database import Database
from ..errors import ConfigurationError, NotFoundError, ProviderError

logger = logging.getLogger(__name__)

# LiveAvatar ends a sandbox session after a minute and only lends the public sandbox avatar.
SANDBOX_MAX_SESSION_SECONDS = 60
PROVIDER_STOP_REASON = "USER_DISCONNECTED"
# A token is kept this long after the session could still be running, then it is useless.
TOKEN_GRACE_SECONDS = 300


@dataclass
class AssistantSession:
    id: UUID
    provider_session_id: str
    session_token: str
    sandbox: bool
    avatar_id: str
    language: str
    requested_language: str
    max_session_duration_seconds: int


class AssistantSessionService:
    """Mints FULL mode session tokens and keeps the record of who owns which session.

    The browser drives the conversation with the official SDK, so the only server side state is
    the raw provider token, which stays in memory and is needed to stop the session early.
    """

    def __init__(self, *, client: LiveAvatarClient, database: Database, settings: Settings):
        self.client = client
        self.database = database
        self.settings = settings
        # Session id to (provider token, when it was issued). Memory only, never persisted.
        self._tokens: dict[UUID, tuple[str, float]] = {}

    async def create(self, *, principal: str, user_id: UUID | None, language: str) -> AssistantSession:
        settings = self.settings
        if not settings.liveavatar_api_key.get_secret_value() or not settings.liveavatar_context_id:
            raise ConfigurationError(
                "the assistant needs LIVEAVATAR_API_KEY and LIVEAVATAR_CONTEXT_ID",
                {"missing": self._missing_configuration()},
            )
        sandbox = settings.liveavatar_sandbox
        avatar_id = self._avatar_id(sandbox)
        duration = settings.liveavatar_assistant_max_session_seconds
        if sandbox:
            duration = min(duration, SANDBOX_MAX_SESSION_SECONDS)

        requested_language = language
        effective_language = self._resolve_language(requested_language)

        data = await self.client.create_full_token(
            avatar_id=avatar_id,
            context_id=settings.liveavatar_context_id,
            language=effective_language,
            sandbox=sandbox,
            max_session_duration=duration,
            voice_id=settings.liveavatar_assistant_voice_id or None,
        )
        token = _required(data, "session_token")
        provider_session_id = _required(data, "session_id")
        row = None
        try:
            row = await self.database.create_assistant_session(
                {
                    "provider_session_id": provider_session_id,
                    "avatar_id": avatar_id,
                    # LiveAvatar owns the room. Their session id names it in our records.
                    "room_name": f"liveavatar-{provider_session_id}",
                    "sandbox": sandbox,
                    "user_id": user_id,
                    "session_token_hash": hashlib.sha256(token.encode()).hexdigest(),
                    "metadata": {
                        "principal": principal,
                        "language": effective_language,
                        "requested_language": requested_language,
                        "transport": "managed",
                        "max_session_duration": duration,
                    },
                }
            )
            await self.database.record_usage(
                {
                    "provider": "liveavatar",
                    "operation": "assistant_token",
                    "provider_resource_id": provider_session_id,
                    "cache_hit": False,
                    "metadata": {
                        "avatar_id": avatar_id,
                        "sandbox": sandbox,
                        "language": effective_language,
                        "requested_language": requested_language,
                        "principal": principal,
                    },
                }
            )
        except Exception:
            # Nobody will ever receive this token, so the session at the provider has to end here.
            # Otherwise it runs, and counts, until its own timeout.
            await self._stop_at_provider(token, provider_session_id)
            if row is not None:
                await self.database.close_session(row["id"], "START_FAILED")
            raise

        session_id: UUID = row["id"]
        self._tokens[session_id] = (token, time.monotonic())
        self._forget_old_tokens()
        logger.info(
            "assistant_session_created",
            extra={
                "session_id": str(session_id),
                "provider_session_id": provider_session_id,
                "sandbox": sandbox,
            },
        )
        return AssistantSession(
            id=session_id,
            provider_session_id=provider_session_id,
            session_token=token,
            sandbox=sandbox,
            avatar_id=avatar_id,
            language=effective_language,
            requested_language=requested_language,
            max_session_duration_seconds=duration,
        )

    async def close(self, session_id: UUID, principal: str) -> None:
        """Stop a session. Calling it twice is fine and still answers 200."""
        row = await self.database.get_session(session_id)
        if not row or _metadata(row).get("principal") != principal:
            # Someone else's session looks the same as a session that does not exist.
            raise NotFoundError("assistant session")
        if row["status"] == "CLOSED":
            return
        held = self._tokens.pop(session_id, None)
        if held:
            await self._stop_at_provider(held[0], row["provider_session_id"])
        else:
            # The process restarted, or the session is long over. The provider ends a session on
            # its own timeout, so only our record is left to close.
            logger.info("assistant_provider_stop_skipped", extra={"session_id": str(session_id)})
        await self.database.close_session(session_id, "CLOSED")
        await self.database.record_usage(
            {
                "provider": "liveavatar",
                "operation": "assistant_close",
                "provider_resource_id": row["provider_session_id"],
                "cache_hit": False,
                "metadata": {"principal": principal, "provider_stop": bool(held)},
            }
        )

    def _forget_old_tokens(self) -> None:
        """Drop tokens of sessions that cannot be running any more, so the map stays small."""
        lifetime = self.settings.liveavatar_assistant_max_session_seconds + TOKEN_GRACE_SECONDS
        deadline = time.monotonic() - lifetime
        for session_id in [key for key, (_, at) in self._tokens.items() if at < deadline]:
            del self._tokens[session_id]

    def _resolve_language(self, requested: str) -> str:
        """Pick a language the provider will actually accept at session start.

        The requested language wins when the provider supports it. Otherwise the configured
        preferred language wins, if that is itself supported. Otherwise the first supported
        language is used, so the assistant can always start.
        """
        supported = self.settings.assistant_language_list
        if requested in supported:
            return requested
        preferred = self.settings.liveavatar_assistant_language
        if preferred in supported:
            return preferred
        return supported[0]

    def _avatar_id(self, sandbox: bool) -> str:
        # Sandbox cannot use a custom avatar, so the client never gets to pick one.
        if sandbox:
            return self.settings.liveavatar_avatar_id
        return self.settings.liveavatar_assistant_avatar_id or self.settings.liveavatar_avatar_id

    def _missing_configuration(self) -> list[str]:
        missing = []
        if not self.settings.liveavatar_api_key.get_secret_value():
            missing.append("LIVEAVATAR_API_KEY")
        if not self.settings.liveavatar_context_id:
            missing.append("LIVEAVATAR_CONTEXT_ID")
        return missing

    async def _stop_at_provider(self, token: str, provider_session_id: str) -> None:
        try:
            await self.client.stop_session(token, provider_session_id, reason=PROVIDER_STOP_REASON)
        except ProviderError as exc:
            # A session that already ended (timeout, user closed the tab) answers with an error.
            # Our record must still close, so this is logged and not raised.
            logger.warning(
                "assistant_provider_stop_failed",
                extra={"provider_session_id": provider_session_id, "provider_code": exc.code},
            )


def _metadata(row: Any) -> dict[str, Any]:
    """asyncpg hands jsonb back as text."""
    raw = row["metadata"]
    if isinstance(raw, str):
        return json.loads(raw)
    return raw or {}


def _required(data: dict[str, Any], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value:
        raise ProviderError(
            "liveavatar_protocol", f"LiveAvatar response is missing a valid {key}", 502, False
        )
    return value
