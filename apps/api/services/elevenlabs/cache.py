import asyncio
import hashlib
import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .audio import validate_pcm


def deterministic_cache_key(parameters: dict[str, Any]) -> str:
    canonical = json.dumps(parameters, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class CachedAudio:
    cache_key: str
    audio_path: Path
    metadata_path: Path
    duration_ms: int


class AudioCache:
    def __init__(self, audio_dir: Path, metadata_dir: Path):
        self.audio_dir = audio_dir
        self.metadata_dir = metadata_dir

    def paths(self, cache_key: str) -> tuple[Path, Path]:
        return self.audio_dir / f"{cache_key}.pcm", self.metadata_dir / f"audio-{cache_key}.json"

    async def get(self, cache_key: str) -> CachedAudio | None:
        audio_path, metadata_path = self.paths(cache_key)
        if not audio_path.is_file() or not metadata_path.is_file():
            return None
        metadata = json.loads(await asyncio.to_thread(metadata_path.read_text, encoding="utf-8"))
        audio = await asyncio.to_thread(audio_path.read_bytes)
        duration_ms = validate_pcm(audio)
        if duration_ms != metadata.get("duration_ms"):
            return None
        return CachedAudio(cache_key, audio_path, metadata_path, duration_ms)

    async def put(self, cache_key: str, audio: bytes, parameters: dict[str, Any]) -> CachedAudio:
        duration_ms = validate_pcm(audio)
        audio_path, metadata_path = self.paths(cache_key)
        self.audio_dir.mkdir(parents=True, exist_ok=True)
        self.metadata_dir.mkdir(parents=True, exist_ok=True)
        metadata = {
            "cache_key": cache_key,
            "text": parameters["text"],
            "voice_id": parameters["voice_id"],
            "model_id": parameters["model_id"],
            "created_at": datetime.now(UTC).isoformat(),
            "duration_ms": duration_ms,
            "sample_rate": 24000,
            "channels": 1,
            "bit_depth": 16,
            "format": "pcm_s16le",
            "parameters": parameters,
        }

        def atomic_write() -> None:
            audio_tmp = audio_path.with_suffix(f".tmp-{os.getpid()}")
            meta_tmp = metadata_path.with_suffix(f".tmp-{os.getpid()}")
            audio_tmp.write_bytes(audio)
            meta_tmp.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(audio_tmp, audio_path)
            os.replace(meta_tmp, metadata_path)

        await asyncio.to_thread(atomic_write)
        return CachedAudio(cache_key, audio_path, metadata_path, duration_ms)
