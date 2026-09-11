import asyncio
import json
import struct

import pytest

from services.elevenlabs.audio import REQUIRED_PCM
from services.liveavatar.connection import FIRST_CHUNK_BYTES, LiveAvatarConnection
from services.liveavatar.events import IncomingEvent, LiveAvatarEventType
from services.orchestrator.src.errors import AudioFormatError


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
async def test_speak_bytes_rejects_unaligned_pcm_before_sending():
    connection = LiveAvatarConnection("wss://unused")
    connection.socket = FakeSocket(connection)
    connection.connected.set()

    with pytest.raises(AudioFormatError):
        await connection.speak_bytes(b"x")

    assert connection.socket.messages == []


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


class ReplaySocket:
    """A socket that replays raw provider frames into the reader, then ends the stream."""

    def __init__(self, frames):
        self.frames = frames

    def __aiter__(self):
        async def gen():
            for frame in self.frames:
                yield frame

        return gen()

    async def send(self, message):
        return None

    async def close(self):
        return None


@pytest.mark.asyncio
async def test_speak_ended_is_matched_on_source_event_id():
    """LiveAvatar stamps replies with a fresh event_id and echoes ours in source_event_id.

    Correlating on event_id leaves the waiter unresolved, so /avatar/speak hangs until its
    120s timeout even though the avatar already finished speaking.
    """
    connection = LiveAvatarConnection("wss://unused")
    our_event_id = "speak-98abeea9-7466-4000-9000-000000000000"
    key = (LiveAvatarEventType.AGENT_SPEAK_ENDED, our_event_id)
    completion = asyncio.get_running_loop().create_future()
    connection._event_waiters[key] = completion
    connection.socket = ReplaySocket(
        [
            json.dumps(
                {
                    "type": "agent.speak_ended",
                    "event_id": "9ebf2eda-c029-45d4-956b-c93272be3ba3",
                    "source_event_id": our_event_id,
                }
            )
        ]
    )

    await connection._read_events()

    assert completion.done(), "agent.speak_ended did not resolve the waiter for our event id"


@pytest.mark.asyncio
async def test_progress_events_are_parsed_rather_than_logged_as_unknown():
    """The buffer/state events LiveAvatar streams are known types we deliberately ignore."""
    connection = LiveAvatarConnection("wss://unused")
    connection.socket = ReplaySocket(
        [
            json.dumps({"type": "agent.audio_buffer_appended", "event_id": "a", "source_event_id": "s"}),
            json.dumps({"type": "agent.audio_buffer_committed", "event_id": "b", "source_event_id": "s"}),
            json.dumps({"type": "agent.state_updated", "event_id": "c", "source_event_id": None}),
        ]
    )

    for frame in connection.socket.frames:
        IncomingEvent.model_validate_json(frame)

    await connection._read_events()
    assert connection._event_waiters == {}
