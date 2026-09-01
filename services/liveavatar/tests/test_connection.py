import json
import struct

import pytest

from services.elevenlabs.audio import REQUIRED_PCM
from services.liveavatar.connection import FIRST_CHUNK_BYTES, LiveAvatarConnection
from services.liveavatar.events import LiveAvatarEventType


class FakeSocket:
    def __init__(self, connection=None):
        self.messages = []
        self.connection = connection

    async def send(self, message):
        payload = json.loads(message)
        self.messages.append(payload)
        if payload["type"] == "agent.speak_end":
            key = (LiveAvatarEventType.AGENT_SPEAK_ENDED, payload["event_id"])
            self.connection._event_waiters[key].set_result(payload)

    async def close(self):
        return None


@pytest.mark.asyncio
async def test_speak_chunks_share_event_id_and_end_once():
    connection = LiveAvatarConnection("wss://unused")
    connection.socket = FakeSocket(connection)
    connection.connected.set()
    audio = struct.pack("<h", 1) * (REQUIRED_PCM.sample_rate * 2)
    event_id = await connection.speak_bytes(audio)
    speaks = [item for item in connection.socket.messages if item["type"] == "agent.speak"]
    ends = [item for item in connection.socket.messages if item["type"] == "agent.speak_end"]
    assert len(speaks) == 3
    assert len(ends) == 1
    assert {item["event_id"] for item in speaks + ends} == {event_id}
    assert len(__import__("base64").b64decode(speaks[0]["audio"])) == FIRST_CHUNK_BYTES


@pytest.mark.asyncio
async def test_transport_chunks_may_split_pcm_samples_without_corrupting_output():
    connection = LiveAvatarConnection("wss://unused")
    connection.socket = FakeSocket(connection)
    connection.connected.set()
    pcm = struct.pack("<h", 7) * REQUIRED_PCM.sample_rate

    async def fragmented():
        yield pcm[:1]
        yield pcm[1:]

    await connection.speak_stream(fragmented())
    speaks = [item for item in connection.socket.messages if item["type"] == "agent.speak"]
    decoded = b"".join(__import__("base64").b64decode(item["audio"]) for item in speaks)
    assert decoded == pcm


@pytest.mark.asyncio
async def test_interrupt_sets_cancellation_and_sends_exact_event():
    connection = LiveAvatarConnection("wss://unused")
    connection.socket = FakeSocket()
    connection.connected.set()
    await connection.interrupt()
    assert connection.interrupted.is_set()
    assert connection.socket.messages == [{"type": "agent.interrupt"}]


@pytest.mark.asyncio
async def test_listening_state_events_have_ids():
    connection = LiveAvatarConnection("wss://unused")
    connection.socket = FakeSocket()
    connection.connected.set()
    start_id = await connection.listening(True)
    stop_id = await connection.listening(False)
    assert connection.socket.messages == [
        {"type": "agent.start_listening", "event_id": start_id},
        {"type": "agent.stop_listening", "event_id": stop_id},
    ]
