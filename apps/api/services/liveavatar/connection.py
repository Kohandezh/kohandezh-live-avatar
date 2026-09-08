import asyncio
import base64
import json
import logging
from collections.abc import AsyncIterator
from uuid import uuid4

import websockets
from websockets.asyncio.client import ClientConnection

from services.elevenlabs.audio import REQUIRED_PCM, validate_pcm
from services.orchestrator.src.errors import ProviderError

from .events import RESPONSE_EVENTS, IncomingEvent, LiveAvatarEventType

logger = logging.getLogger(__name__)
FIRST_CHUNK_BYTES = int(REQUIRED_PCM.bytes_per_second * 0.6)
NEXT_CHUNK_BYTES = REQUIRED_PCM.bytes_per_second
SPEECH_COMPLETION_TIMEOUT_SECONDS = 120


class LiveAvatarConnection:
    def __init__(self, ws_url: str, connect_timeout: float = 30):
        self.ws_url = ws_url
        self.connect_timeout = connect_timeout
        self.socket: ClientConnection | None = None
        self.connected = asyncio.Event()
        self.closed = asyncio.Event()
        self.interrupted = asyncio.Event()
        self._send_lock = asyncio.Lock()
        self._reader_task: asyncio.Task | None = None
        self._event_waiters: dict[tuple[LiveAvatarEventType, str], asyncio.Future] = {}

    async def connect(self) -> None:
        try:
            self.socket = await websockets.connect(self.ws_url, open_timeout=self.connect_timeout)
            self._reader_task = asyncio.create_task(self._read_events())
            await asyncio.wait_for(self.connected.wait(), timeout=self.connect_timeout)
        except TimeoutError as exc:
            await self.close()
            raise ProviderError(
                "liveavatar_session_failure",
                "LiveAvatar WebSocket did not reach session.state_updated=connected",
                504,
                True,
            ) from exc
        except (OSError, websockets.WebSocketException) as exc:
            await self.close()
            raise ProviderError(
                "liveavatar_session_failure", "LiveAvatar WebSocket connection failed", 502, True
            ) from exc

    async def close(self) -> None:
        if self.socket:
            await self.socket.close()
            self.socket = None
        if self._reader_task and self._reader_task is not asyncio.current_task():
            self._reader_task.cancel()
            await asyncio.gather(self._reader_task, return_exceptions=True)
        self.closed.set()

    async def _read_events(self) -> None:
        assert self.socket
        try:
            async for raw in self.socket:
                try:
                    event = IncomingEvent.model_validate_json(raw)
                except Exception:
                    logger.warning("liveavatar_unknown_event", extra={"event_preview": str(raw)[:120]})
                    continue
                if event.type not in RESPONSE_EVENTS:
                    continue
                logger.info(
                    "liveavatar_event",
                    extra={"event_type": event.type.value, "event_id": event.event_id, "state": event.state},
                )
                if event.type == LiveAvatarEventType.SESSION_STATE_UPDATED:
                    if event.state == "connected":
                        self.connected.set()
                    elif event.state == "closed":
                        self.closed.set()
                if event.event_id:
                    waiter = self._event_waiters.pop((event.type, event.event_id), None)
                    if waiter and not waiter.done():
                        waiter.set_result(event)
        except websockets.ConnectionClosed:
            self.closed.set()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("liveavatar_event_reader_failed", extra={"error_category": type(exc).__name__})
            self.closed.set()

    async def send(self, payload: dict) -> None:
        if not self.socket or not self.connected.is_set() or self.closed.is_set():
            raise ProviderError(
                "liveavatar_session_failure", "LiveAvatar session is not connected", 409, False
            )
        async with self._send_lock:
            await self.socket.send(json.dumps(payload))

    async def interrupt(self) -> None:
        self.interrupted.set()
        await self.send({"type": LiveAvatarEventType.AGENT_INTERRUPT.value})

    async def listening(self, active: bool) -> str:
        event_id = f"listen-{uuid4()}"
        event_type = (
            LiveAvatarEventType.AGENT_START_LISTENING if active else LiveAvatarEventType.AGENT_STOP_LISTENING
        )
        await self.send({"type": event_type.value, "event_id": event_id})
        return event_id

    async def keep_alive(self) -> None:
        await self.send(
            {
                "type": LiveAvatarEventType.SESSION_KEEP_ALIVE.value,
                "event_id": f"keepalive-{uuid4()}",
            }
        )

    async def speak_bytes(self, audio: bytes) -> str:
        validate_pcm(audio)

        async def one_chunk() -> AsyncIterator[bytes]:
            yield audio

        return await self.speak_stream(one_chunk())

    async def speak_stream(self, chunks: AsyncIterator[bytes]) -> str:
        event_id = f"speak-{uuid4()}"
        self.interrupted.clear()
        completion_key = (LiveAvatarEventType.AGENT_SPEAK_ENDED, event_id)
        completion = asyncio.get_running_loop().create_future()
        self._event_waiters[completion_key] = completion
        buffer = bytearray()
        first = True
        all_audio = bytearray()
        try:
            async for provider_chunk in chunks:
                if self.interrupted.is_set():
                    break
                buffer.extend(provider_chunk)
                all_audio.extend(provider_chunk)
                target = FIRST_CHUNK_BYTES if first else NEXT_CHUNK_BYTES
                while len(buffer) >= target and not self.interrupted.is_set():
                    packet = bytes(buffer[:target])
                    del buffer[:target]
                    await self._send_audio(event_id, packet)
                    first = False
                    target = NEXT_CHUNK_BYTES
            if not self.interrupted.is_set() and buffer:
                await self._send_audio(event_id, bytes(buffer))
            if self.interrupted.is_set():
                return event_id
            validate_pcm(bytes(all_audio))
            await self.send({"type": LiveAvatarEventType.AGENT_SPEAK_END.value, "event_id": event_id})
            try:
                await asyncio.wait_for(completion, timeout=SPEECH_COMPLETION_TIMEOUT_SECONDS)
            except TimeoutError as exc:
                raise ProviderError(
                    "liveavatar_speech_timeout",
                    "LiveAvatar did not confirm agent.speak_ended",
                    504,
                    True,
                ) from exc
            return event_id
        finally:
            waiter = self._event_waiters.pop(completion_key, None)
            if waiter and not waiter.done():
                waiter.cancel()

    async def _send_audio(self, event_id: str, audio: bytes) -> None:
        validate_pcm(audio)
        await self.send(
            {
                "type": LiveAvatarEventType.AGENT_SPEAK.value,
                "event_id": event_id,
                "audio": base64.b64encode(audio).decode("ascii"),
            }
        )
