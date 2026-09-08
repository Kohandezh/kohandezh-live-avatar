import asyncio
import base64
import json
from collections.abc import AsyncIterator
from urllib.parse import urlencode

import httpx
import websockets

from services.orchestrator.src.errors import ConfigurationError, ProviderError


class ElevenLabsClient:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        websocket_url: str,
        timeout_seconds: float = 30,
        http_client: httpx.AsyncClient | None = None,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.websocket_url = websocket_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self._owned_client = http_client is None
        self.http = http_client or httpx.AsyncClient(timeout=timeout_seconds)

    async def close(self) -> None:
        if self._owned_client:
            await self.http.aclose()

    def _require_credentials(self, voice_id: str) -> None:
        if not self.api_key:
            raise ConfigurationError("ELEVENLABS_API_KEY is not configured")
        if not voice_id:
            raise ConfigurationError("ELEVENLABS_VOICE_ID is not configured")

    @staticmethod
    def _voice_settings(params: dict) -> dict:
        return {
            "stability": params["stability"],
            "similarity_boost": params["similarity"],
            "style": params["style"],
            "speed": params["speed"],
            "use_speaker_boost": True,
        }

    @staticmethod
    def _dialogue_settings(params: dict) -> dict:
        """Text-to-Dialogue v3 accepts stability only."""
        return {"stability": params["stability"]}

    async def generate(self, params: dict) -> tuple[bytes, dict[str, str]]:
        self._require_credentials(params["voice_id"])
        if params["model_id"].startswith("eleven_v3"):
            url = f"{self.base_url}/v1/text-to-dialogue"
            body = {
                "inputs": [{"text": params["text"], "voice_id": params["voice_id"]}],
                "model_id": params["model_id"],
                "language_code": params["language"],
                "settings": self._dialogue_settings(params),
            }
        else:
            url = f"{self.base_url}/v1/text-to-speech/{params['voice_id']}"
            body = {
                "text": params["text"],
                "model_id": params["model_id"],
                "language_code": params["language"],
                "voice_settings": self._voice_settings(params),
            }
        query = {"output_format": params["output_format"]}
        response = await self._request_with_backoff(url, query, body)
        return response.content, dict(response.headers)

    async def _request_with_backoff(self, url: str, query: dict, body: dict) -> httpx.Response:
        for attempt in range(3):
            try:
                response = await self.http.post(
                    url,
                    params=query,
                    json=body,
                    headers={"xi-api-key": self.api_key, "Accept": "audio/pcm"},
                )
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                if attempt == 2:
                    raise ProviderError(
                        "elevenlabs_timeout", "ElevenLabs did not respond after 3 bounded attempts", 504, True
                    ) from exc
                await asyncio.sleep(0.25 * (2**attempt))
                continue
            if response.status_code < 400:
                return response
            if response.status_code in {401, 403}:
                raise ProviderError(
                    "elevenlabs_auth", "ElevenLabs rejected the server credentials", 502, False
                )
            if response.status_code == 429:
                raise ProviderError(
                    "elevenlabs_quota", "ElevenLabs quota or concurrency limit was reached", 429, True
                )
            if response.status_code >= 500 and attempt < 2:
                await asyncio.sleep(0.25 * (2**attempt))
                continue
            raise ProviderError(
                "elevenlabs_error",
                f"ElevenLabs generation failed with provider status {response.status_code}",
                502,
                response.status_code >= 500,
            )
        raise AssertionError("unreachable")

    async def stream_websocket(self, params: dict) -> AsyncIterator[bytes]:
        self._require_credentials(params["voice_id"])
        if params["model_id"].startswith("eleven_v3"):
            async for chunk in self._stream_dialogue(params):
                yield chunk
        else:
            async for chunk in self._stream_tts(params):
                yield chunk

    async def _stream_dialogue(self, params: dict) -> AsyncIterator[bytes]:
        query = urlencode(
            {
                "model_id": params["model_id"],
                "output_format": params["output_format"],
                "language_code": params["language"],
            }
        )
        uri = f"{self.websocket_url}/v1/text-to-dialogue/stream-input?{query}"
        try:
            async with websockets.connect(uri, open_timeout=self.timeout_seconds) as socket:
                await socket.send(
                    json.dumps(
                        {
                            "voices": [params["voice_id"]],
                            "voice_settings": self._dialogue_settings(params),
                            "xi_api_key": self.api_key,
                        }
                    )
                )
                await socket.send(
                    json.dumps(
                        {
                            "inputs": [
                                {"text": params["text"], "voice_id": params["voice_id"], "new_turn": True}
                            ],
                            "flush": True,
                        }
                    )
                )
                await socket.send(json.dumps({"close_socket": True}))
                while True:
                    raw = await asyncio.wait_for(socket.recv(), timeout=self.timeout_seconds)
                    message = json.loads(raw)
                    if message.get("error"):
                        raise ProviderError(
                            "elevenlabs_stream_error", "ElevenLabs dialogue stream failed", 502, False
                        )
                    if message.get("audio"):
                        yield base64.b64decode(message["audio"])
                    if message.get("is_final"):
                        return
        except ProviderError:
            raise
        except TimeoutError as exc:
            raise ProviderError("elevenlabs_timeout", "ElevenLabs WebSocket timed out", 504, True) from exc
        except websockets.WebSocketException as exc:
            raise ProviderError("elevenlabs_stream_error", "ElevenLabs WebSocket failed", 502, True) from exc

    async def _stream_tts(self, params: dict) -> AsyncIterator[bytes]:
        query = urlencode(
            {
                "model_id": params["model_id"],
                "output_format": params["output_format"],
                "language_code": params["language"],
            }
        )
        uri = f"{self.websocket_url}/v1/text-to-speech/{params['voice_id']}/stream-input?{query}"
        try:
            async with websockets.connect(uri, open_timeout=self.timeout_seconds) as socket:
                await socket.send(
                    json.dumps(
                        {
                            "text": " ",
                            "voice_settings": self._voice_settings(params),
                            "generation_config": {"chunk_length_schedule": [120, 160, 250, 290]},
                            "xi_api_key": self.api_key,
                        }
                    )
                )
                await socket.send(json.dumps({"text": params["text"] + " ", "flush": True}))
                await socket.send(json.dumps({"text": ""}))
                while True:
                    raw = await asyncio.wait_for(socket.recv(), timeout=self.timeout_seconds)
                    message = json.loads(raw)
                    if message.get("error"):
                        raise ProviderError(
                            "elevenlabs_stream_error", "ElevenLabs TTS stream failed", 502, False
                        )
                    if message.get("audio"):
                        yield base64.b64decode(message["audio"])
                    if message.get("is_final"):
                        return
        except ProviderError:
            raise
        except TimeoutError as exc:
            raise ProviderError("elevenlabs_timeout", "ElevenLabs WebSocket timed out", 504, True) from exc
        except websockets.WebSocketException as exc:
            raise ProviderError("elevenlabs_stream_error", "ElevenLabs WebSocket failed", 502, True) from exc
