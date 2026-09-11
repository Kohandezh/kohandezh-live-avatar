import json

import httpx
import pytest

from services.liveavatar.client import LiveAvatarClient
from services.orchestrator.src.errors import ProviderError


@pytest.mark.asyncio
async def test_session_creation_is_explicit_lite_byo_livekit():
    requests = []

    async def handler(request: httpx.Request):
        requests.append(request)
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"data": {"session_id": "provider", "session_token": "jwt"}})
        return httpx.Response(201, json={"data": {"session_id": "provider", "ws_url": "wss://events"}})

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client = LiveAvatarClient(api_key="key", base_url="https://live.test", http_client=http)
    data = await client.create_token(
        avatar_id="avatar",
        sandbox=True,
        max_session_duration=60,
        livekit_url="wss://livekit.example",
        livekit_room="avatar-room",
        livekit_client_token="publisher-jwt",  # noqa: S106 - inert fixture credential
    )
    assert data["session_token"] == "jwt"  # noqa: S105 - provider fixture response
    body = json.loads(requests[0].content)
    assert body["mode"] == "LITE"
    assert body["video_settings"]["encoding"] == "H264"
    assert body["livekit_config"] == {
        "livekit_url": "wss://livekit.example",
        "livekit_room": "avatar-room",
        "livekit_client_token": "publisher-jwt",
    }
    await client.start_session("jwt")
    assert requests[1].headers["authorization"] == "Bearer jwt"
    await http.aclose()


@pytest.mark.asyncio
async def test_full_mode_sends_the_persona_and_no_livekit_config():
    """FULL mode runs the conversation at LiveAvatar, so we never hand them a room of ours."""
    requests = []

    async def handler(request: httpx.Request):
        requests.append(request)
        return httpx.Response(200, json={"data": {"session_id": "provider", "session_token": "jwt"}})

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client = LiveAvatarClient(api_key="key", base_url="https://live.test", http_client=http)

    await client.create_full_token(
        avatar_id="avatar",
        context_id="context",
        language="fa",
        sandbox=True,
        max_session_duration=60,
        voice_id="voice",
    )

    body = json.loads(requests[0].content)
    assert requests[0].headers["x-api-key"] == "key"
    assert body["mode"] == "FULL"
    assert body["interactivity_type"] == "CONVERSATIONAL"
    assert body["is_sandbox"] is True
    assert body["avatar_persona"] == {"context_id": "context", "language": "fa", "voice_id": "voice"}
    assert "voice_agent" not in body
    assert "livekit_config" not in body
    await http.aclose()


@pytest.mark.asyncio
async def test_full_mode_omits_an_empty_voice():
    async def handler(request: httpx.Request):
        return httpx.Response(200, json={"data": {"session_id": "provider", "session_token": "jwt"}})

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client = LiveAvatarClient(api_key="key", base_url="https://live.test", http_client=http)

    data = await client.create_full_token(
        avatar_id="avatar",
        context_id="context",
        language="fa",
        sandbox=True,
        max_session_duration=60,
    )

    assert data["session_id"] == "provider"
    await http.aclose()


@pytest.mark.asyncio
async def test_a_voice_agent_token_carries_no_mode_and_no_persona():
    """LiveAvatar refuses "mode" for an elevenlabs_agent voice agent and derives it itself."""
    requests = []

    async def handler(request: httpx.Request):
        requests.append(request)
        return httpx.Response(200, json={"data": {"session_id": "provider", "session_token": "jwt"}})

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client = LiveAvatarClient(api_key="key", base_url="https://live.test", http_client=http)

    data = await client.create_voice_agent_token(
        avatar_id="avatar",
        voice_agent_id="voice-agent",
        sandbox=True,
        max_session_duration=60,
    )

    assert data["session_token"] == "jwt"  # noqa: S105 - provider fixture response
    body = json.loads(requests[0].content)
    assert "mode" not in body
    assert body["voice_agent"] == {"id": "voice-agent"}
    assert body["avatar_id"] == "avatar"
    assert body["is_sandbox"] is True
    assert body["max_session_duration"] == 60
    assert body["video_settings"] == {"quality": "high", "encoding": "H264"}
    # avatar_persona and voice_agent are mutually exclusive, and the agent owns the language.
    assert "avatar_persona" not in body
    assert "language" not in body
    assert "livekit_config" not in body
    await http.aclose()


@pytest.mark.asyncio
async def test_quota_failure_is_classified_without_retry():
    calls = 0

    async def handler(_: httpx.Request):
        nonlocal calls
        calls += 1
        return httpx.Response(429, json={"message": "credits exhausted"})

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client = LiveAvatarClient(api_key="key", base_url="https://live.test", http_client=http)
    with pytest.raises(ProviderError) as error:
        await client.create_token(
            avatar_id="avatar",
            sandbox=False,
            max_session_duration=60,
            livekit_url="wss://livekit.example",
            livekit_room="avatar-room",
            livekit_client_token="token",  # noqa: S106 - inert fixture credential
        )
    assert error.value.code == "liveavatar_quota"
    assert calls == 1
    await http.aclose()


@pytest.mark.asyncio
async def test_session_teardown_uses_current_canonical_contract():
    requests = []

    async def handler(request: httpx.Request):
        requests.append(request)
        return httpx.Response(200, json={"data": {}})

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client = LiveAvatarClient(api_key="key", base_url="https://live.test", http_client=http)
    await client.stop_session("session-jwt", "provider-session", reason="USER_DISCONNECTED")
    assert requests[0].method == "POST"
    assert requests[0].url.path == "/v1/sessions/stop"
    assert requests[0].headers["authorization"] == "Bearer session-jwt"
    assert json.loads(requests[0].content) == {
        "session_id": "provider-session",
        "reason": "USER_DISCONNECTED",
    }
    await http.aclose()
