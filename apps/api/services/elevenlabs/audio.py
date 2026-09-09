import asyncio
from dataclasses import dataclass

from services.orchestrator.src.errors import AudioFormatError


@dataclass(frozen=True)
class PCMContract:
    sample_rate: int = 24000
    channels: int = 1
    sample_width: int = 2
    encoding: str = "pcm_s16le"

    @property
    def bytes_per_second(self) -> int:
        return self.sample_rate * self.channels * self.sample_width


REQUIRED_PCM = PCMContract()


def validate_pcm(
    data: bytes,
    *,
    sample_rate: int = 24000,
    channels: int = 1,
    sample_width: int = 2,
) -> int:
    problems: list[str] = []
    if sample_rate != REQUIRED_PCM.sample_rate:
        problems.append(f"sample_rate={sample_rate}")
    if channels != REQUIRED_PCM.channels:
        problems.append(f"channels={channels}")
    if sample_width != REQUIRED_PCM.sample_width:
        problems.append(f"sample_width={sample_width}")
    if not data:
        problems.append("audio is empty")
    if len(data) % (channels * sample_width) != 0:
        problems.append("byte length is not aligned to complete PCM frames")
    if problems:
        raise AudioFormatError(
            "audio must be raw signed 16-bit little-endian PCM at 24 kHz mono",
            {"problems": problems},
        )
    return round(len(data) / REQUIRED_PCM.bytes_per_second * 1000)


async def convert_to_pcm24(
    data: bytes,
    *,
    input_format: str,
    input_sample_rate: int | None = None,
    input_channels: int | None = None,
) -> bytes:
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error"]
    if input_format == "pcm_s16le":
        if not input_sample_rate or not input_channels:
            raise AudioFormatError("raw PCM conversion requires explicit input sample rate and channels")
        command += ["-f", "s16le", "-ar", str(input_sample_rate), "-ac", str(input_channels)]
    command += ["-i", "pipe:0", "-f", "s16le", "-acodec", "pcm_s16le", "-ar", "24000", "-ac", "1", "pipe:1"]
    process = await asyncio.create_subprocess_exec(
        *command,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    output, error = await process.communicate(data)
    if process.returncode != 0:
        raise AudioFormatError("ffmpeg audio conversion failed", {"ffmpeg": error.decode()[-500:]})
    validate_pcm(output)
    return output
