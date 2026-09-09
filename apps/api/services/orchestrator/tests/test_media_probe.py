import asyncio

import pytest

from services.orchestrator.src.errors import ProviderError
from services.orchestrator.src.media_probe import probe_avatar_mp4


@pytest.mark.asyncio
async def test_probe_accepts_nonempty_h264_mp4_with_audio(tmp_path):
    path = tmp_path / "synthetic.mp4"
    process = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=320x180:d=1",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-shortest",
        str(path),
    )
    assert await process.wait() == 0
    report = await probe_avatar_mp4(path)
    assert report["video_codec"] == "h264"
    assert report["audio_codec"] == "aac"
    assert report["duration_ms"] > 0
    assert (report["width"], report["height"]) == (320, 180)


@pytest.mark.asyncio
async def test_probe_rejects_corrupt_mp4(tmp_path):
    path = tmp_path / "corrupt.mp4"
    path.write_bytes(b"not an mp4")
    with pytest.raises(ProviderError) as error:
        await probe_avatar_mp4(path)
    assert error.value.code == "egress_invalid_mp4"
