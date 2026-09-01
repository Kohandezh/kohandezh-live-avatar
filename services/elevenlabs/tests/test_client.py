import struct

import httpx
import pytest

from services.elevenlabs.client import ElevenLabsClient
from services.orchestrator.src.errors import ConfigurationError, ProviderError

PARAMS = {
    "text": "سلام",
    "voice_id": "voice-id",
    "model_id": "eleven_v3_conversational",
    "speed": 1.0,
    "stability": 0.5,
    "similarity": 0.75,
    "style": 0.0,
    "language": "fa",
    "output_format": "pcm_24000",
}


@pytest.mark.asyncio
async def test_v3_generation_uses_text_to_dialogue_contract():
    async def handler(request: httpx.Request):
        assert request.url.path == "/v1/text-to-dialogue"
        assert request.url.params["output_format"] == "pcm_24000"
        assert request.headers["xi-api-key"] == "secret"
        body = __import__("json").loads(request.content)
        assert body["inputs"] == [{"text": "سلام", "voice_id": "voice-id"}]
        assert body["settings"] == {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.0,
            "speed": 1.0,
            "use_speaker_boost": True,
        }
        return httpx.Response(200, content=struct.pack("<h", 0) * 24)

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://api.test")
    client = ElevenLabsClient(
        api_key="secret", base_url="https://api.test", websocket_url="wss://api.test", http_client=http
    )
    audio, _ = await client.generate(PARAMS)
    assert len(audio) == 48
    await http.aclose()


@pytest.mark.asyncio
async def test_invalid_credentials_are_actionable_and_not_retried():
    calls = 0

    async def handler(_: httpx.Request):
        nonlocal calls
        calls += 1
        return httpx.Response(401, json={"detail": "invalid key"})

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client = ElevenLabsClient(
        api_key="bad", base_url="https://api.test", websocket_url="wss://api.test", http_client=http
    )
    with pytest.raises(ProviderError) as error:
        await client.generate(PARAMS)
    assert error.value.code == "elevenlabs_auth"
    assert calls == 1
    await http.aclose()


@pytest.mark.asyncio
async def test_missing_credentials_never_make_a_provider_request():
    client = ElevenLabsClient(api_key="", base_url="https://api.test", websocket_url="wss://api.test")
    with pytest.raises(ConfigurationError):
        await client.generate(PARAMS)
    await client.close()
