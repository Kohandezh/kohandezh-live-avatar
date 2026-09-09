from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from services.liveavatar import manager as manager_module
from services.liveavatar.manager import LiveAvatarManager
from services.orchestrator.src.errors import ConfigurationError, ProviderError


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
        managed_livekit=False,
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
        managed_livekit=False,
    )

    with pytest.raises(ProviderError, match="ws_url"):
        await avatar.create(avatar_id=None, sandbox=True, max_session_duration=60)

    client.stop_session.assert_awaited_once_with("jwt", "provider", reason="USER_DISCONNECTED")
    assert len(FakeConnection.instances) == instances_before


@pytest.mark.asyncio
async def test_managed_transport_uses_the_room_liveavatar_returns(monkeypatch):
    """Managed mode sends no livekit_config and joins the browser to LiveAvatar's room."""
    monkeypatch.setattr(manager_module, "LiveAvatarConnection", FakeConnection)
    client = SimpleNamespace(
        create_token=AsyncMock(return_value={"session_token": "jwt", "session_id": "provider"}),
        start_session=AsyncMock(
            return_value={
                "session_id": "provider",
                "ws_url": "wss://events",
                "livekit_url": "wss://livekit.liveavatar.com",
                "livekit_client_token": "viewer",
            }
        ),
        stop_session=AsyncMock(),
    )
    livekit = SimpleNamespace(
        public_url="ws://localhost:7880",
        create_avatar_room=AsyncMock(),
    )
    database = SimpleNamespace(
        create_session=AsyncMock(return_value={"id": uuid4(), "provider_session_id": "provider"}),
        record_usage=AsyncMock(),
    )
    avatar = LiveAvatarManager(
        client=client,
        livekit=livekit,
        database=database,
        coordinator=SimpleNamespace(set_session=AsyncMock()),
        default_avatar_id="avatar",
        # Deliberately not ready: managed mode must not need a public endpoint.
        public_livekit_ready=False,
        connect_timeout=1,
        managed_livekit=True,
    )

    session = await avatar.create(avatar_id=None, sandbox=True, max_session_duration=60)

    livekit.create_avatar_room.assert_not_awaited()
    assert "livekit_url" not in client.create_token.await_args.kwargs
    assert session.livekit_url == "wss://livekit.liveavatar.com"
    assert session.browser_token == "viewer"  # noqa: S105 - inert fixture credential
    assert session.room_name == "liveavatar-provider"
    await avatar.close_all()


@pytest.mark.asyncio
async def test_byo_transport_refuses_a_local_livekit_url():
    """BYO mode still fails fast, and the error points at the managed alternative."""
    avatar = LiveAvatarManager(
        client=SimpleNamespace(create_token=AsyncMock()),
        livekit=SimpleNamespace(public_url="ws://localhost:7880", create_avatar_room=AsyncMock()),
        database=SimpleNamespace(),
        coordinator=SimpleNamespace(),
        default_avatar_id="avatar",
        public_livekit_ready=False,
        connect_timeout=1,
        managed_livekit=False,
    )

    with pytest.raises(ConfigurationError) as excinfo:
        await avatar.create(avatar_id=None, sandbox=True, max_session_duration=60)

    assert "managed" in str(excinfo.value.details)
