"""Credit-free local LiveKit + Egress infrastructure proof.

Runs entirely inside the Compose network with synthetic media. No provider
credentials are used. Proves:

1. Room creation
2. Scoped publisher token (room_join + can_publish only)
3. Scoped subscriber token (room_join + can_subscribe only)
4. Synthetic audio+video publish
5. Subscriber receives real media frames
6. Room-composite Egress produces an H.264 MP4 in EGRESS_OUTPUT_DIR

Usage (one-off container on the compose network):

  docker run --rm --network kohandezh-live-avatar_avatar \
    -e LIVEKIT_URL=ws://livekit:7880 \
    -e LIVEKIT_API_KEY=... -e LIVEKIT_API_SECRET=... \
    -v "$PWD/scripts:/scripts" -v "$PWD/services/media:/media" \
    python:3.12-slim sh -c "pip install -q livekit livekit-api && python /scripts/local_infra_check.py"
"""

from __future__ import annotations

import asyncio
import base64
import json
import math
import os
import struct
import sys
import time
from pathlib import Path

from livekit import api, rtc

LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "ws://livekit:7880")
API_KEY = os.environ["LIVEKIT_API_KEY"]
API_SECRET = os.environ["LIVEKIT_API_SECRET"]
EGRESS_LOCAL_DIR = Path(os.environ.get("EGRESS_LOCAL_DIR", "/media/video"))
EGRESS_FILE = os.environ.get("EGRESS_LOCAL_FILE", f"/out/LOCAL_INFRA_{int(time.time())}.mp4")
RECORD_SECONDS = float(os.environ.get("EGRESS_RECORD_SECONDS", "8"))
PUBLISH_SECONDS = RECORD_SECONDS + 4

WIDTH, HEIGHT, FPS = 320, 240, 12
SAMPLE_RATE, CHANNELS = 24_000, 1


def mint_token(*, identity: str, room: str, can_publish: bool, can_subscribe: bool) -> str:
    return (
        api.AccessToken(API_KEY, API_SECRET)
        .with_identity(identity)
        .with_name(identity)
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room,
                can_publish=can_publish,
                can_subscribe=can_subscribe,
                can_publish_data=False,
            )
        )
        .to_jwt()
    )


def decode_jwt_payload(token: str) -> dict:
    part = token.split(".")[1]
    part += "=" * (-len(part) % 4)
    return json.loads(base64.urlsafe_b64decode(part))


def assert_grants(token: str, *, label: str, can_publish: bool, can_subscribe: bool) -> None:
    video = decode_jwt_payload(token)["video"]
    camel = {"room_join": "roomJoin", "can_publish": "canPublish", "can_subscribe": "canSubscribe"}
    expected = {
        "room_join": True,
        "can_publish": can_publish,
        "can_subscribe": can_subscribe,
    }
    for key, want in expected.items():
        got = video.get(key, video.get(camel[key]))
        if got is not want:
            raise SystemExit(f"FAIL {label} token grant {key}={got}, expected {want}")
    print(f"TOKEN_OK {label}: room_join=true can_publish={can_publish} can_subscribe={can_subscribe}")


def tone_frame(samples: int, phase: float) -> tuple[rtc.AudioFrame, float]:
    data = bytearray()
    for _ in range(samples):
        value = int(12000 * math.sin(phase))
        data += struct.pack("<h", value)
        phase += 2 * math.pi * 440 / SAMPLE_RATE
        if phase > 2 * math.pi:
            phase -= 2 * math.pi
    frame = rtc.AudioFrame(bytes(data), SAMPLE_RATE, CHANNELS, samples)
    return frame, phase


def color_frame(width: int, height: int, r: int, g: int, b: int) -> rtc.VideoFrame:
    buf = bytearray(width * height * 4)
    for i in range(width * height):
        buf[i * 4] = r
        buf[i * 4 + 1] = g
        buf[i * 4 + 2] = b
        buf[i * 4 + 3] = 255
    return rtc.VideoFrame(width, height, rtc.VideoBufferType.RGBA, bytes(buf))


class SubscriberStats:
    def __init__(self) -> None:
        self.audio_frames = 0
        self.audio_samples = 0
        self.video_frames = 0
        self.wrote_file = False

    def ok(self) -> bool:
        return self.audio_frames > 0 and self.audio_samples > 0 and self.video_frames > 0


async def run_publisher(token: str) -> None:
    room = rtc.Room()
    await room.connect(LIVEKIT_URL, token)
    print("PUBLISHER_CONNECTED", room.local_participant.identity)
    try:
        audio_source = rtc.AudioSource(SAMPLE_RATE, CHANNELS)
        audio_track = rtc.LocalAudioTrack.create_audio_track("synthetic-tone", audio_source)
        await room.local_participant.publish_track(
            audio_track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        )
        video_source = rtc.VideoSource(WIDTH, HEIGHT)
        video_track = rtc.LocalVideoTrack.create_video_track("synthetic-color", video_source)
        await room.local_participant.publish_track(
            video_track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_CAMERA)
        )
        print("SYNTHETIC_TRACKS_PUBLISHED audio=1 video=1")

        frames_per_chunk = SAMPLE_RATE // 50
        phase = 0.0
        end = time.monotonic() + PUBLISH_SECONDS
        tick = 0
        while time.monotonic() < end:
            for _ in range(25):
                frame, phase = tone_frame(frames_per_chunk, phase)
                await audio_source.capture_frame(frame)
            video_source.capture_frame(
                color_frame(WIDTH, HEIGHT, (tick * 5) % 255, 90, 200)
            )
            tick += 1
            await asyncio.sleep(0.5)
    finally:
        await room.disconnect()
        print("PUBLISHER_DISCONNECTED")


async def run_subscriber(token: str, stats: SubscriberStats) -> None:
    room = rtc.Room()

    @room.on("track_subscribed")
    def on_track(track: rtc.Track, pub, participant) -> None:
        print("SUBSCRIBER_TRACK", track.kind, participant.identity)
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            stream = rtc.AudioStream(track)

            async def pump_audio():
                async for event in stream:
                    stats.audio_frames += 1
                    stats.audio_samples += event.frame.samples_per_channel

            asyncio.create_task(pump_audio())
        elif track.kind == rtc.TrackKind.KIND_VIDEO:
            stream = rtc.VideoStream(track)

            async def pump_video():
                async for _ in stream:
                    stats.video_frames += 1

            asyncio.create_task(pump_video())

    await room.connect(LIVEKIT_URL, token)
    print("SUBSCRIBER_CONNECTED", room.local_participant.identity)
    await asyncio.sleep(PUBLISH_SECONDS + 1)
    await room.disconnect()
    print(
        "SUBSCRIBER_STATS",
        json.dumps({
            "audio_frames": stats.audio_frames,
            "audio_samples": stats.audio_samples,
            "video_frames": stats.video_frames,
        }),
    )
    if not stats.ok():
        raise SystemExit("FAIL subscriber did not receive both audio and video media")
    print("MEDIA_RECEIVED_OK")


async def run_egress(room_name: str) -> str:
    client = api.LiveKitAPI(LIVEKIT_URL.replace("ws://", "http://").replace("wss://", "https://"), API_KEY, API_SECRET)
    try:
        info = await client.egress.start_room_composite_egress(
            api.RoomCompositeEgressRequest(
                room_name=room_name,
                layout="speaker",
                file_outputs=[
                    api.EncodedFileOutput(
                        file_type=api.EncodedFileType.MP4,
                        filepath=EGRESS_FILE,
                    )
                ],
            )
        )
        print("EGRESS_STARTED", info.egress_id)
        await asyncio.sleep(RECORD_SECONDS)
        await client.egress.stop_egress(api.StopEgressRequest(egress_id=info.egress_id))
        print("EGRESS_STOPPED", info.egress_id)
        return info.egress_id
    finally:
        await client.aclose()


async def main() -> None:
    room_name = f"local-infra-{int(time.time())}"
    client = api.LiveKitAPI(LIVEKIT_URL.replace("ws://", "http://").replace("wss://", "https://"), API_KEY, API_SECRET)
    await client.room.create_room(api.CreateRoomRequest(name=room_name, empty_timeout=120, departure_timeout=10))
    await client.aclose()
    print("ROOM_CREATED", room_name)

    publisher_token = mint_token(identity="synthetic-publisher", room=room_name, can_publish=True, can_subscribe=False)
    subscriber_token = mint_token(identity="local-subscriber", room=room_name, can_publish=False, can_subscribe=True)
    assert_grants(publisher_token, label="publisher", can_publish=True, can_subscribe=False)
    assert_grants(subscriber_token, label="subscriber(browser)", can_publish=False, can_subscribe=True)

    stats = SubscriberStats()
    subscriber_task = asyncio.create_task(run_subscriber(subscriber_token, stats))
    await asyncio.sleep(1)
    publisher_task = asyncio.create_task(run_publisher(publisher_token))
    egress_task = asyncio.create_task(run_egress(room_name))

    await publisher_task
    await subscriber_task
    await egress_task

    out = EGRESS_LOCAL_DIR / Path(EGRESS_FILE).name
    for _ in range(60):
        if out.is_file() and out.stat().st_size > 0:
            break
        await asyncio.sleep(1)
    if not out.is_file() or out.stat().st_size == 0:
        raise SystemExit(f"FAIL egress file missing or empty: {out}")
    print("EGRESS_FILE_OK", str(out), out.stat().st_size, "bytes")
    print("LOCAL_INFRA_CHECK_PASS")


if __name__ == "__main__":
    asyncio.run(main())
    sys.exit(0)
