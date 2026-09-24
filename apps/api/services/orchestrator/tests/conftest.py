"""Fakes that let the API be tested without Postgres, Redis, or LiveAvatar."""

import json
import time
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
from pydantic import SecretStr

from services.orchestrator.src.assistant.service import AssistantSessionService
from services.orchestrator.src.auth.otp import OtpService
from services.orchestrator.src.auth.sessions import SessionService
from services.orchestrator.src.config import Settings
from services.orchestrator.src.coordination import Coordinator
from services.orchestrator.src.database import new_answers_that_fit
from services.orchestrator.src.main import app

ADMIN_PHONE = "+989120000001"
EMBED_KEY = "embed-public-key"  # noqa: S105 - the embed key is public by design
EMBED_ORIGIN = "https://client.example"
# Left out of the default settings on purpose: an empty voice agent id keeps the FULL mode
# (persona) path as the default under test. A test that wants the Persian path sets it.
VOICE_AGENT_ID = "voice-agent-id"


class FakeRedis:
    """The handful of Redis commands the Coordinator uses, with real expiry behaviour."""

    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.expiry: dict[str, float] = {}

    def _drop_if_expired(self, key: str) -> None:
        deadline = self.expiry.get(key)
        if deadline is not None and deadline <= time.monotonic():
            self.values.pop(key, None)
            self.expiry.pop(key, None)

    async def set(self, key, value, ex=None, nx=False, keepttl=False):
        self._drop_if_expired(key)
        if nx and key in self.values:
            return None
        self.values[key] = str(value)
        if ex is not None:
            self.expiry[key] = time.monotonic() + ex
        elif not keepttl:
            self.expiry.pop(key, None)
        return True

    async def get(self, key):
        self._drop_if_expired(key)
        return self.values.get(key)

    async def delete(self, key):
        self.values.pop(key, None)
        self.expiry.pop(key, None)

    async def incr(self, key):
        self._drop_if_expired(key)
        value = int(self.values.get(key, 0)) + 1
        self.values[key] = str(value)
        return value

    async def expire(self, key, seconds):
        self._drop_if_expired(key)
        if key in self.values:
            self.expiry[key] = time.monotonic() + seconds

    async def ttl(self, key):
        self._drop_if_expired(key)
        if key not in self.values:
            return -2
        deadline = self.expiry.get(key)
        if deadline is None:
            return -1
        return max(1, int(deadline - time.monotonic()))


class FakeDatabase:
    """In-memory stand-in for the tables the auth and assistant endpoints touch."""

    def __init__(self) -> None:
        self.users: list[dict[str, Any]] = []
        self.sessions: dict[UUID, dict[str, Any]] = {}
        self.usage: list[dict[str, Any]] = []

    async def get_user(self, user_id: UUID):
        return next((user for user in self.users if user["id"] == user_id), None)

    async def get_user_by_phone(self, phone: str):
        return next((user for user in self.users if user["phone"] == phone), None)

    async def create_user(self, phone: str, role: str):
        existing = await self.get_user_by_phone(phone)
        if existing:
            return existing
        user = {
            "id": uuid4(),
            "phone": phone,
            "first_name": "",
            "last_name": "",
            "email": None,
            "birth_date": None,
            "role": role,
            "status": "active",
            "created_at": datetime.now(UTC),
            "updated_at": datetime.now(UTC),
        }
        self.users.append(user)
        return user

    async def set_user_role(self, user_id: UUID, role: str):
        user = await self.get_user(user_id)
        if user:
            user["role"] = role
        return user

    async def set_user_status(self, user_id: UUID, status: str):
        user = await self.get_user(user_id)
        if user:
            user["status"] = status
        return user

    async def update_user_profile(
        self, user_id: UUID, *, first_name: str, last_name: str, birth_date: date | None
    ):
        user = await self.get_user(user_id)
        if user:
            user["first_name"] = first_name
            user["last_name"] = last_name
            user["birth_date"] = birth_date
        return user

    async def list_users(self, *, search: str | None, page: int, page_size: int):
        rows = self.users
        if search and search.strip():
            needle = search.strip().lower()
            rows = [
                user
                for user in rows
                if needle
                in " ".join(
                    str(user[field] or "") for field in ("phone", "first_name", "last_name", "email")
                ).lower()
            ]
        rows = sorted(rows, key=lambda user: user["created_at"], reverse=True)
        start = (page - 1) * page_size
        return rows[start : start + page_size], len(rows)

    async def user_counts(self):
        week_ago = datetime.now(UTC) - timedelta(days=7)
        return {
            "total_users": len(self.users),
            "active_users": len([u for u in self.users if u["status"] == "active"]),
            "disabled_users": len([u for u in self.users if u["status"] == "disabled"]),
            "new_users_this_week": len([u for u in self.users if u["created_at"] >= week_ago]),
        }

    async def create_assistant_session(self, data: dict[str, Any]):
        row = {
            "id": uuid4(),
            "provider_session_id": data["provider_session_id"],
            "avatar_id": data["avatar_id"],
            "room_name": data["room_name"],
            "mode": "FULL",
            "sandbox": data["sandbox"],
            "status": "TOKEN_ISSUED",
            "user_id": data.get("user_id"),
            "session_token_hash": data["session_token_hash"],
            "started_at": datetime.now(UTC),
            # asyncpg hands jsonb back as text, so the fake stores text too.
            "metadata": json.dumps(data.get("metadata", {})),
        }
        self.sessions[row["id"]] = row
        return row

    async def get_session(self, session_id: UUID):
        return self.sessions.get(session_id)

    async def close_session(self, session_id: UUID, status: str = "CLOSED"):
        row = self.sessions.get(session_id)
        if row:
            row["status"] = status

    async def record_usage(self, data: dict[str, Any]):
        self.usage.append(data)

    async def record_assistant_answers(
        self, provider_resource_id: str, rows: list[dict[str, Any]], *, max_count: int, max_duration_ms: int
    ):
        # One step with no await inside: in memory that is what the advisory lock and the
        # transaction give the real method.
        stored = [
            item
            for item in self.usage
            if item["provider"] == "liveavatar"
            and item["operation"] == "assistant_answer"
            and item.get("provider_resource_id") == provider_resource_id
        ]
        fresh = new_answers_that_fit(
            rows,
            stored_indexes={item["metadata"]["answer_index"] for item in stored},
            stored_count=len(stored),
            stored_duration_ms=sum(item.get("estimated_duration_ms") or 0 for item in stored),
            max_count=max_count,
            max_duration_ms=max_duration_ms,
        )
        if fresh is None:
            return None
        self.usage.extend(fresh)
        return len(fresh)

    def operations(self) -> list[str]:
        return [item["operation"] for item in self.usage]


class FakeLiveAvatarClient:
    """Records what the assistant asked for. It never reaches the network."""

    def __init__(self) -> None:
        self.token_calls: list[dict[str, Any]] = []
        self.voice_agent_calls: list[dict[str, Any]] = []
        self.stop_calls: list[tuple[str, str]] = []
        self.token_error: Exception | None = None
        self.stop_error: Exception | None = None
        self.counter = 0

    async def create_full_token(self, **kwargs):
        self.token_calls.append(kwargs)
        return self._token()

    async def create_voice_agent_token(self, **kwargs):
        self.voice_agent_calls.append(kwargs)
        return self._token()

    def _token(self) -> dict[str, str]:
        if self.token_error:
            raise self.token_error
        self.counter += 1
        return {
            "session_id": f"provider-{self.counter}",
            "session_token": f"provider-token-{self.counter}",
        }

    async def stop_session(self, session_token: str, session_id: str, *, reason: str):
        self.stop_calls.append((session_token, session_id))
        if self.stop_error:
            raise self.stop_error


@dataclass
class ApiContext:
    client: httpx.AsyncClient
    settings: Settings
    database: FakeDatabase
    coordinator: Coordinator
    redis: FakeRedis
    liveavatar: FakeLiveAvatarClient
    sender: "RecordingOtpSender"

    async def login(self, phone: str, *, platform: str = "web") -> str | None:
        """Walk the whole login flow and return the bearer token native clients receive."""
        await self.client.post("/auth/otp/request", json={"phone": phone})
        response = await self.client.post(
            "/auth/otp/verify",
            json={"phone": phone, "code": self.sender.codes[-1]},
            headers={"X-Client-Platform": platform},
        )
        assert response.status_code == 200, response.text
        return response.json().get("accessToken")


@dataclass
class RecordingOtpSender:
    codes: list[str] = field(default_factory=list)

    async def send(self, phone: str, code: str) -> None:
        self.codes.append(code)


@pytest.fixture(autouse=True)
def isolate_settings_from_environment(monkeypatch):
    """Drop every Settings variable from the process environment for the test.

    CI runs pytest inside the Compose container with .env.example loaded as real environment
    variables, and a developer may have a real .env exported in the shell. Either would silently
    change which code path a test exercises (for example a voice agent id turns the persona tests
    into voice agent tests). Tests get only what build_settings passes explicitly.
    """
    for name in Settings.model_fields:
        monkeypatch.delenv(name.upper(), raising=False)
    monkeypatch.delenv("APP_ENV", raising=False)


def build_settings(**overrides: Any) -> Settings:
    """Settings the tests control. Values passed here win over the environment."""
    values: dict[str, Any] = {
        "app_env": "development",
        "otp_ttl_seconds": 120,
        "liveavatar_assistant_language": "fa",
        "liveavatar_api_key": SecretStr("server-api-key"),
        "liveavatar_context_id": "context-id",
        "liveavatar_avatar_id": "sandbox-avatar",
        "liveavatar_assistant_avatar_id": "custom-avatar",
        "liveavatar_sandbox": True,
        # Deliberately higher than the sandbox limit, so the clamp is visible in the tests.
        "liveavatar_assistant_max_session_seconds": 300,
        "assistant_embed_key": SecretStr(EMBED_KEY),
        "assistant_embed_allowed_origins": EMBED_ORIGIN,
        "assistant_rate_limit_per_hour": 2,
        "admin_phones": ADMIN_PHONE,
    }
    values.update(overrides)
    # _env_file=None: the developer's real .env must never leak into a test.
    return Settings(_env_file=None, **values)


@pytest.fixture
async def api():
    """The real app with fake infrastructure behind it."""
    settings = build_settings()
    database = FakeDatabase()
    redis = FakeRedis()
    coordinator = Coordinator("redis://unused", redis=redis)
    liveavatar = FakeLiveAvatarClient()
    sender = RecordingOtpSender()

    app.state.settings = settings
    app.state.database = database
    app.state.coordinator = coordinator
    app.state.sessions = SessionService(coordinator=coordinator, ttl_seconds=settings.session_ttl_seconds)
    app.state.otp = OtpService(coordinator=coordinator, sender=sender, settings=settings)
    app.state.assistant = AssistantSessionService(client=liveavatar, database=database, settings=settings)

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield ApiContext(
            client=client,
            settings=settings,
            database=database,
            coordinator=coordinator,
            redis=redis,
            liveavatar=liveavatar,
            sender=sender,
        )
