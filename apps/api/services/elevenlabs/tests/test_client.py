import json
import struct

import httpx
import pytest
from websockets.exceptions import ConnectionClosedError
from websockets.frames import Close

import services.elevenlabs.client as client_module
from services.elevenlabs.client import _PAYMENT_ERROR_MESSAGE, ElevenLabsClient
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

TTS_PARAMS = {**PARAMS, "model_id": "eleven_multilingual_v2"}


class _FakeSocket:
    def __init__(self, frames):
        self._frames = iter(frames)

    async def send(self, _message):
        return None

    async def recv(self):
        item = next(self._frames)
        if isinstance(item, BaseException):
            raise item
        return item


class _FakeConnect:
    def __init__(self, frames):
        self._socket = _FakeSocket(frames)

    async def __aenter__(self):
        return self._socket

    async def __aexit__(self, *_exc):
        return False


def _fake_connect(frames):
    def _connect(_uri, **_kwargs):
        return _FakeConnect(frames)

    return _connect


@pytest.mark.asyncio
async def test_v3_generation_uses_text_to_dialogue_contract():
    async def handler(request: httpx.Request):
        assert request.url.path == "/v1/text-to-dialogue"
        assert request.url.params["output_format"] == "pcm_24000"
        assert request.headers["xi-api-key"] == "secret"
        body = __import__("json").loads(request.content)
        assert body["inputs"] == [{"text": "سلام", "voice_id": "voice-id"}]
        assert body["settings"] == {"stability": 0.5}
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


@pytest.mark.asyncio
async def test_dialogue_stream_maps_payment_issue_message_to_elevenlabs_payment(monkeypatch):
    frames = [json.dumps({"message": "please pay", "error": "payment_issue", "code": 1008})]
    monkeypatch.setattr(client_module.websockets, "connect", _fake_connect(frames))
    client = ElevenLabsClient(api_key="secret", base_url="https://api.test", websocket_url="wss://api.test")

    with pytest.raises(ProviderError) as error:
        async for _ in client.stream_websocket(PARAMS):
            pass

    assert error.value.code == "elevenlabs_payment"
    assert error.value.status_code == 502
    assert error.value.retryable is False
    assert "please pay" not in error.value.message
    await client.close()


@pytest.mark.asyncio
async def test_dialogue_stream_maps_ivc_not_permitted_with_code_1008_to_elevenlabs_payment(monkeypatch):
    """Pay-as-you-go plans reject an instant-cloned voice with a different error string, same code."""
    frames = [json.dumps({"error": "ivc_not_permitted", "code": 1008})]
    monkeypatch.setattr(client_module.websockets, "connect", _fake_connect(frames))
    client = ElevenLabsClient(api_key="secret", base_url="https://api.test", websocket_url="wss://api.test")

    with pytest.raises(ProviderError) as error:
        async for _ in client.stream_websocket(PARAMS):
            pass

    assert error.value.code == "elevenlabs_payment"
    await client.close()


@pytest.mark.asyncio
async def test_dialogue_stream_maps_payment_issue_without_a_code_field_to_elevenlabs_payment(
    monkeypatch,
):
    """REQ-040 maps on payment_issue OR code 1008, not only when both are present."""
    frames = [json.dumps({"message": "please pay", "error": "payment_issue"})]
    monkeypatch.setattr(client_module.websockets, "connect", _fake_connect(frames))
    client = ElevenLabsClient(api_key="secret", base_url="https://api.test", websocket_url="wss://api.test")

    with pytest.raises(ProviderError) as error:
        async for _ in client.stream_websocket(PARAMS):
            pass

    assert error.value.code == "elevenlabs_payment"
    assert error.value.message == _PAYMENT_ERROR_MESSAGE
    assert "please pay" not in error.value.message
    await client.close()


@pytest.mark.asyncio
async def test_dialogue_stream_other_error_keeps_generic_stream_error(monkeypatch):
    frames = [json.dumps({"error": "some_other_problem", "code": 500})]
    monkeypatch.setattr(client_module.websockets, "connect", _fake_connect(frames))
    client = ElevenLabsClient(api_key="secret", base_url="https://api.test", websocket_url="wss://api.test")

    with pytest.raises(ProviderError) as error:
        async for _ in client.stream_websocket(PARAMS):
            pass

    assert error.value.code == "elevenlabs_stream_error"
    assert error.value.message == "ElevenLabs dialogue stream failed"
    await client.close()


@pytest.mark.asyncio
async def test_dialogue_stream_close_code_1008_maps_to_elevenlabs_payment(monkeypatch):
    close = ConnectionClosedError(rcvd=Close(1008, "payment required"), sent=None)
    monkeypatch.setattr(client_module.websockets, "connect", _fake_connect([close]))
    client = ElevenLabsClient(api_key="secret", base_url="https://api.test", websocket_url="wss://api.test")

    with pytest.raises(ProviderError) as error:
        async for _ in client.stream_websocket(PARAMS):
            pass

    assert error.value.code == "elevenlabs_payment"
    assert "payment required" not in error.value.message
    await client.close()


@pytest.mark.asyncio
async def test_dialogue_stream_close_code_other_keeps_generic_stream_error(monkeypatch):
    close = ConnectionClosedError(rcvd=Close(1011, "internal error"), sent=None)
    monkeypatch.setattr(client_module.websockets, "connect", _fake_connect([close]))
    client = ElevenLabsClient(api_key="secret", base_url="https://api.test", websocket_url="wss://api.test")

    with pytest.raises(ProviderError) as error:
        async for _ in client.stream_websocket(PARAMS):
            pass

    assert error.value.code == "elevenlabs_stream_error"
    await client.close()


@pytest.mark.asyncio
async def test_tts_stream_maps_payment_issue_message_to_elevenlabs_payment(monkeypatch):
    frames = [json.dumps({"message": "please pay", "error": "payment_issue", "code": 1008})]
    monkeypatch.setattr(client_module.websockets, "connect", _fake_connect(frames))
    client = ElevenLabsClient(api_key="secret", base_url="https://api.test", websocket_url="wss://api.test")

    with pytest.raises(ProviderError) as error:
        async for _ in client.stream_websocket(TTS_PARAMS):
            pass

    assert error.value.code == "elevenlabs_payment"
    assert "please pay" not in error.value.message
    await client.close()


@pytest.mark.asyncio
async def test_tts_stream_maps_payment_issue_without_a_code_field_to_elevenlabs_payment(monkeypatch):
    """REQ-040 maps on payment_issue OR code 1008, not only when both are present."""
    frames = [json.dumps({"message": "please pay", "error": "payment_issue"})]
    monkeypatch.setattr(client_module.websockets, "connect", _fake_connect(frames))
    client = ElevenLabsClient(api_key="secret", base_url="https://api.test", websocket_url="wss://api.test")

    with pytest.raises(ProviderError) as error:
        async for _ in client.stream_websocket(TTS_PARAMS):
            pass

    assert error.value.code == "elevenlabs_payment"
    assert error.value.message == _PAYMENT_ERROR_MESSAGE
    assert "please pay" not in error.value.message
    await client.close()


@pytest.mark.asyncio
async def test_tts_stream_close_code_1008_maps_to_elevenlabs_payment(monkeypatch):
    close = ConnectionClosedError(rcvd=Close(1008, "payment required"), sent=None)
    monkeypatch.setattr(client_module.websockets, "connect", _fake_connect([close]))
    client = ElevenLabsClient(api_key="secret", base_url="https://api.test", websocket_url="wss://api.test")

    with pytest.raises(ProviderError) as error:
        async for _ in client.stream_websocket(TTS_PARAMS):
            pass

    assert error.value.code == "elevenlabs_payment"
    await client.close()


@pytest.mark.asyncio
async def test_tts_stream_other_error_keeps_generic_stream_error(monkeypatch):
    frames = [json.dumps({"error": "some_other_problem", "code": 500})]
    monkeypatch.setattr(client_module.websockets, "connect", _fake_connect(frames))
    client = ElevenLabsClient(api_key="secret", base_url="https://api.test", websocket_url="wss://api.test")

    with pytest.raises(ProviderError) as error:
        async for _ in client.stream_websocket(TTS_PARAMS):
            pass

    assert error.value.code == "elevenlabs_stream_error"
    assert error.value.message == "ElevenLabs TTS stream failed"
    await client.close()


@pytest.mark.asyncio
async def test_dialogue_and_tts_payment_errors_use_the_same_fixed_message(monkeypatch):
    frames = [json.dumps({"error": "payment_issue", "code": 1008})]
    monkeypatch.setattr(client_module.websockets, "connect", _fake_connect(frames))
    client = ElevenLabsClient(api_key="secret", base_url="https://api.test", websocket_url="wss://api.test")

    with pytest.raises(ProviderError) as dialogue_error:
        async for _ in client.stream_websocket(PARAMS):
            pass

    monkeypatch.setattr(client_module.websockets, "connect", _fake_connect(list(frames)))

    with pytest.raises(ProviderError) as tts_error:
        async for _ in client.stream_websocket(TTS_PARAMS):
            pass

    assert dialogue_error.value.message == tts_error.value.message
    await client.close()
