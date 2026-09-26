import pytest
from livekit import api

from services.orchestrator.src.livekit_gateway import LiveKitGateway


@pytest.mark.asyncio
async def test_livekit_tokens_are_room_scoped_and_least_privilege():
    secret = "x" * 32
    gateway = LiveKitGateway(
        url="http://livekit.invalid",
        api_key="devkey",
        api_secret=secret,
        public_url="ws://localhost:7880",
        egress_dir="/out",
    )
    verifier = api.TokenVerifier("devkey", secret)
    publisher = verifier.verify(
        gateway.token(identity="avatar", room_name="room-one", can_publish=True, can_subscribe=False)
    )
    subscriber = verifier.verify(
        gateway.token(identity="browser", room_name="room-one", can_publish=False, can_subscribe=True)
    )

    assert publisher.video.room == subscriber.video.room == "room-one"
    assert publisher.video.can_publish is True
    assert publisher.video.can_subscribe is False
    assert publisher.video.can_publish_data is False
    assert subscriber.video.can_publish is False
    assert subscriber.video.can_subscribe is True
    assert subscriber.video.can_publish_data is False
    await gateway.close()


@pytest.mark.asyncio
async def test_liveavatar_token_can_publish_data_for_lite_events():
    secret = "x" * 32
    gateway = LiveKitGateway(
        url="http://livekit.invalid",
        api_key="devkey",
        api_secret=secret,
        public_url="ws://localhost:7880",
        egress_dir="/out",
    )
    verifier = api.TokenVerifier("devkey", secret)
    publisher = verifier.verify(
        gateway.token(
            identity="avatar",
            room_name="room-one",
            can_publish=True,
            can_subscribe=False,
            can_publish_data=True,
        )
    )
    assert publisher.video.can_publish_data is True
    await gateway.close()


@pytest.mark.asyncio
async def test_the_avatar_room_token_lets_liveavatar_subscribe(monkeypatch):
    """LiveAvatar refuses a BYO token without canSubscribe (422, render sprint 2026-09-25)."""
    secret = "x" * 32
    gateway = LiveKitGateway(
        url="http://livekit.invalid",
        api_key="devkey",
        api_secret=secret,
        public_url="wss://livekit.example",
        egress_dir="/out",
    )
    created = []

    async def create_room(request):
        created.append(request.name)

    # No request reaches LiveKit: the room service only records the room it was asked for.
    monkeypatch.setattr(gateway.client.room, "create_room", create_room)

    credentials = await gateway.create_avatar_room()

    verifier = api.TokenVerifier("devkey", secret)
    avatar = verifier.verify(credentials.avatar_token)
    browser = verifier.verify(credentials.browser_token)
    assert created == [credentials.room_name]
    assert avatar.video.room == browser.video.room == credentials.room_name
    assert avatar.video.can_subscribe is True
    assert avatar.video.can_publish is True
    assert avatar.video.can_publish_data is True
    assert browser.video.can_publish is False
    assert browser.video.can_subscribe is True
    assert browser.video.can_publish_data is False
    await gateway.close()
