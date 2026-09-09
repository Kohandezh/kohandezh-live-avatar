import asyncio
import json
from pathlib import Path

from .errors import ProviderError


async def probe_avatar_mp4(path: Path) -> dict:
    process = await asyncio.create_subprocess_exec(
        "ffprobe",
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    output, error = await process.communicate()
    if process.returncode != 0:
        raise ProviderError(
            "egress_invalid_mp4",
            f"ffprobe could not read the Egress MP4: {error.decode()[-300:]}",
            502,
            False,
        )
    report = json.loads(output)
    streams = report.get("streams", [])
    videos = [stream for stream in streams if stream.get("codec_type") == "video"]
    audios = [stream for stream in streams if stream.get("codec_type") == "audio"]
    duration = float(report.get("format", {}).get("duration") or 0)
    if not videos or videos[0].get("codec_name") != "h264" or not audios or duration <= 0:
        raise ProviderError(
            "egress_invalid_mp4",
            "Egress MP4 must contain non-empty H.264 video and audio streams",
            502,
            False,
            {
                "video_codec": videos[0].get("codec_name") if videos else None,
                "audio_present": bool(audios),
                "duration_seconds": duration,
            },
        )
    video = videos[0]
    return {
        "container": report.get("format", {}).get("format_name"),
        "video_codec": video.get("codec_name"),
        "audio_codec": audios[0].get("codec_name"),
        "duration_ms": round(duration * 1000),
        "width": video.get("width"),
        "height": video.get("height"),
        "frame_rate": video.get("avg_frame_rate"),
    }
