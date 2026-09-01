from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from services.liveavatar import manager as manager_module
from services.liveavatar.manager import LiveAvatarManager


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

    client.stop_session.assert_awaited_once_with("jwt")
    FakeConnection.instances[-1].close.assert_awaited_once()
    assert avatar.sessions == {}
