import hashlib
import json
import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from services.liveavatar.client import LiveAvatarClient

from ..config import Settings
from ..database import Database
from ..errors import AppError, ConfigurationError, NotFoundError, ProviderError, ValidationError
from ..schemas import AssistantAnswerItem

logger = logging.getLogger(__name__)

# LiveAvatar ends a sandbox session after a minute and only lends the public sandbox avatar.
SANDBOX_MAX_SESSION_SECONDS = 60
PROVIDER_STOP_REASON = "USER_DISCONNECTED"
# A token is kept this long after the session could still be running, then it is useless.
TOKEN_GRACE_SECONDS = 300

# How the conversation is produced at the provider. The configuration picks one (PLAN D9).
# "voice_agent": a stored LiveAvatar Voice Agent wrapping the customer's ElevenLabs agent. The
#   agent owns the language, the prompt and the voice. This is the only Persian-capable path.
# "persona": FULL mode with a LiveAvatar context. English only, until LiveAvatar supports Persian.
PROVIDER_MODE_VOICE_AGENT = "voice_agent"
PROVIDER_MODE_PERSONA = "persona"
# What the browser needs to know: which SDK session class can drive this token.
AGENT_TYPE_BY_PROVIDER_MODE = {
    PROVIDER_MODE_VOICE_AGENT: "elevenlabs",
    PROVIDER_MODE_PERSONA: "full",
}


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
    agent_type: str


@dataclass
class AnswerReport:
    recorded: int
    duplicates: int


class AssistantSessionService:
    """Mints assistant session tokens and keeps the record of who owns which session.

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
        missing = self._missing_configuration()
        if missing:
            raise ConfigurationError(
                "the assistant needs an API key and either a voice agent or a context",
                {"missing": missing},
            )
        sandbox = settings.liveavatar_sandbox
        avatar_id = self._avatar_id(sandbox)
        duration = settings.liveavatar_assistant_max_session_seconds
        if sandbox:
            duration = min(duration, SANDBOX_MAX_SESSION_SECONDS)

        requested_language = language
        voice_agent_id = settings.liveavatar_voice_agent_id
        provider_mode = PROVIDER_MODE_VOICE_AGENT if voice_agent_id else PROVIDER_MODE_PERSONA

        if provider_mode == PROVIDER_MODE_VOICE_AGENT:
            # The agent carries its own language, prompt and voice. LiveAvatar rejects a
            # per-session override for this agent type, so the request's language is ignored and
            # only echoed back as requestedLanguage.
            effective_language = settings.liveavatar_voice_agent_language
            data = await self.client.create_voice_agent_token(
                avatar_id=avatar_id,
                voice_agent_id=voice_agent_id,
                sandbox=sandbox,
                max_session_duration=duration,
            )
        else:
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
                        "provider_mode": provider_mode,
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
                        "provider_mode": provider_mode,
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
                "provider_mode": provider_mode,
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
            agent_type=AGENT_TYPE_BY_PROVIDER_MODE[provider_mode],
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

    async def record_answers(
        self, session_id: UUID, principal: str, answers: list[AssistantAnswerItem]
    ) -> AnswerReport:
        """Write one usage row per avatar answer the browser measured.

        The backend never sees an answer: the browser drives the conversation. So the browser
        reports each speech segment's index and duration, and nothing else of the request reaches
        a row. The duration is taken as given, within the bounds of the session.
        """
        row = await self.database.get_session(session_id)
        metadata = _metadata(row) if row else {}
        if not row or metadata.get("principal") != principal:
            # Someone else's session looks the same as a session that does not exist.
            raise NotFoundError("assistant session")
        max_seconds = int(metadata["max_session_duration"])
        # A tab that dies never calls close, so the row can stay TOKEN_ISSUED for ever. The
        # session's own length plus the token grace closes it here as well.
        deadline = row["started_at"] + timedelta(seconds=max_seconds + TOKEN_GRACE_SECONDS)
        if row["status"] != "TOKEN_ISSUED" or datetime.now(UTC) > deadline:
            raise AppError("assistant_session_closed", "assistant session is not open", 409, False)
        limit_ms = max_seconds * 1000
        if any(answer.duration_ms > limit_ms for answer in answers):
            raise ValidationError("an answer cannot be longer than the session", {"limitMs": limit_ms})

        totals = await self.database.assistant_answer_totals(row["provider_session_id"])
        seen = set(totals["indexes"])
        fresh: list[AssistantAnswerItem] = []
        for answer in answers:
            # A repeated index is a re-sent report. The first one wins, the rest are dropped.
            if answer.index not in seen:
                seen.add(answer.index)
                fresh.append(answer)
        duplicates = len(answers) - len(fresh)
        count = totals["count"] + len(fresh)
        duration_ms = totals["duration_ms"] + sum(answer.duration_ms for answer in fresh)
        # A batch of only duplicates writes nothing, so it has nothing to refuse.
        if fresh and (count > self.settings.assistant_answers_per_session_max or duration_ms > limit_ms):
            raise AppError(
                "assistant_answers_limit", "assistant session has no room for more answers", 409, False
            )

        if fresh:
            await self.database.record_usage_batch(
                [
                    {
                        "provider": "liveavatar",
                        "operation": "assistant_answer",
                        "provider_resource_id": row["provider_session_id"],
                        # No text reaches the backend, and the backend picks no speech model.
                        "model": None,
                        "characters": None,
                        "estimated_duration_ms": answer.duration_ms,
                        # Only the playback of a stored answer can know it was a hit.
                        "cache_hit": False,
                        "metadata": {
                            "principal": principal,
                            "sandbox": row["sandbox"],
                            "provider_mode": metadata.get("provider_mode"),
                            "answer_index": answer.index,
                            "source": "browser",
                        },
                    }
                    for answer in fresh
                ]
            )
        logger.info(
            "assistant_answers_recorded",
            extra={"session_id": str(session_id), "recorded": len(fresh), "duplicates": duplicates},
        )
        return AnswerReport(recorded=len(fresh), duplicates=duplicates)

    def _forget_old_tokens(self) -> None:
        """Drop tokens of sessions that cannot be running any more, so the map stays small."""
        lifetime = self.settings.liveavatar_assistant_max_session_seconds + TOKEN_GRACE_SECONDS
        deadline = time.monotonic() - lifetime
        for session_id in [key for key, (_, at) in self._tokens.items() if at < deadline]:
            del self._tokens[session_id]

    def _resolve_language(self, requested: str) -> str:
        """Pick a language FULL mode will actually accept at session start.

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
        """What has to be set before a session can be minted. Empty means the assistant is ready.

        Either provider mode is enough, so only the pair is required, not both ids.
        """
        missing = []
        if not self.settings.liveavatar_api_key.get_secret_value():
            missing.append("LIVEAVATAR_API_KEY")
        if not self.settings.liveavatar_voice_agent_id and not self.settings.liveavatar_context_id:
            missing.append("LIVEAVATAR_VOICE_AGENT_ID or LIVEAVATAR_CONTEXT_ID")
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
