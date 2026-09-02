from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from services.liveavatar import manager as manager_module
from services.liveavatar.manager import LiveAvatarManager
from services.orchestrator.src.errors import ProviderError


class FakeConnection:
    instances = []

    def __init__(self, *_args, **_kwargs):
        self.connect = AsyncMock()
        self.close = AsyncMock()
        self.__class__.instances.append(self)


@pytest.mark.asyncio
async def test_provider_session_is_stopped_when_local_persistence_fails(monkeypatch):
    monkeypatch.setattr(manager_module, "LiveAvatarConnection", FakeConnection)
    client = SimpleNamespace(
        create_token=AsyncMock(return_value={"session_token": "jwt", "session_id": "provider"}),
        start_session=AsyncMock(return_value={"session_id": "provider", "ws_url": "wss://events"}),
        stop_session=AsyncMock(),
    )
    livekit = SimpleNamespace(
        public_url="wss://livekit.example",
        create_avatar_room=AsyncMock(
            return_value=SimpleNamespace(
                room_name="room",
                avatar_token="publisher",  # noqa: S106 - inert fixture credential
                browser_token="subscriber",  # noqa: S106 - inert fixture credential
            )
        ),
    )
    database = SimpleNamespace(create_session=AsyncMock(side_effect=RuntimeError("database down")))
    avatar = LiveAvatarManager(
        client=client,
        livekit=livekit,
        database=database,
        coordinator=SimpleNamespace(),
        default_avatar_id="avatar",
        public_livekit_ready=True,
        connect_timeout=1,
    )

    with pytest.raises(RuntimeError, match="database down"):
        await avatar.create(avatar_id=None, sandbox=True, max_session_duration=60)

    client.stop_session.assert_awaited_once_with("jwt", "provider", reason="USER_DISCONNECTED")
    FakeConnection.instances[-1].close.assert_awaited_once()
    assert avatar.sessions == {}


@pytest.mark.asyncio
async def test_invalid_start_response_is_cleaned_up_before_a_websocket_is_created(monkeypatch):
    monkeypatch.setattr(manager_module, "LiveAvatarConnection", FakeConnection)
    instances_before = len(FakeConnection.instances)
    client = SimpleNamespace(
        create_token=AsyncMock(return_value={"session_token": "jwt", "session_id": "provider"}),
        start_session=AsyncMock(return_value={"session_id": "provider"}),
        stop_session=AsyncMock(),
    )
    livekit = SimpleNamespace(
        public_url="wss://livekit.example",
        create_avatar_room=AsyncMock(
            return_value=SimpleNamespace(
                room_name="room",
                avatar_token="publisher",  # noqa: S106 - inert fixture credential
                browser_token="subscriber",  # noqa: S106 - inert fixture credential
            )
        ),
    )
    avatar = LiveAvatarManager(
        client=client,
        livekit=livekit,
        database=SimpleNamespace(),
        coordinator=SimpleNamespace(),
        default_avatar_id="avatar",
        public_livekit_ready=True,
        connect_timeout=1,
    )

    with pytest.raises(ProviderError, match="ws_url"):
        await avatar.create(avatar_id=None, sandbox=True, max_session_duration=60)

    client.stop_session.assert_awaited_once_with("jwt", "provider", reason="USER_DISCONNECTED")
    assert len(FakeConnection.instances) == instances_before
