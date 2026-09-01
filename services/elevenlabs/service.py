import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from services.orchestrator.src.coordination import Coordinator
from services.orchestrator.src.database import Database
from services.orchestrator.src.schemas import TTSRequest

from .audio import validate_pcm
from .cache import AudioCache, deterministic_cache_key
from .client import ElevenLabsClient

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class GenerationResult:
    asset: Any
    path: Path
    cache_key: str
    duration_ms: int
    cache_hit: bool


class ElevenLabsService:
    def __init__(
        self,
        *,
        client: ElevenLabsClient,
        cache: AudioCache,
        database: Database,
        coordinator: Coordinator,
        default_voice_id: str,
        default_model_id: str,
    ):
        self.client = client
        self.cache = cache
        self.database = database
        self.coordinator = coordinator
        self.default_voice_id = default_voice_id
        self.default_model_id = default_model_id

    def parameters(self, request: TTSRequest) -> dict[str, Any]:
        return {
            "text": request.text,
            "voice_id": request.voice_id or self.default_voice_id,
            "model_id": request.model_id or self.default_model_id,
            "speed": request.speed,
            "stability": request.stability,
            "similarity": request.similarity,
            "style": request.style,
            "language": request.language,
            "output_format": request.output_format,
        }

    async def generate(self, request: TTSRequest) -> GenerationResult:
        params = self.parameters(request)
        cache_key = deterministic_cache_key(params)
        cached = await self.cache.get(cache_key)
        if cached:
            asset = await self.ensure_asset(params, cache_key, cached.audio_path, cached.duration_ms)
            await self.record_usage(params, cached.duration_ms, True)
            logger.info("elevenlabs_cache_hit", extra={"cache_key": cache_key})
            return GenerationResult(asset, cached.audio_path, cache_key, cached.duration_ms, True)

        async with self.coordinator.lock(f"tts:{cache_key}", ttl_seconds=90):
            cached = await self.cache.get(cache_key)
            if cached:
                asset = await self.ensure_asset(params, cache_key, cached.audio_path, cached.duration_ms)
                await self.record_usage(params, cached.duration_ms, True)
                return GenerationResult(asset, cached.audio_path, cache_key, cached.duration_ms, True)
            logger.info("elevenlabs_cache_miss", extra={"cache_key": cache_key, "model": params["model_id"]})
            audio, headers = await self.client.generate(params)
            duration_ms = validate_pcm(audio)
            cached = await self.cache.put(cache_key, audio, params)
            asset = await self.ensure_asset(params, cache_key, cached.audio_path, duration_ms)
            await self.record_usage(
                params,
                duration_ms,
                False,
                provider_resource_id=headers.get("request-id") or headers.get("x-request-id"),
                character_cost=headers.get("character-cost"),
            )
            return GenerationResult(asset, cached.audio_path, cache_key, duration_ms, False)

    async def ensure_asset(self, params: dict, key: str, path: Path, duration_ms: int):
        existing = await self.database.get_audio_by_cache_key(key)
        if existing:
            return existing
        return await self.database.create_audio_asset(
            {
                "cache_key": key,
                "text": params["text"],
                "voice_id": params["voice_id"],
                "model_id": params["model_id"],
                "language": params["language"],
                "settings": params,
                "file_path": str(path),
                "duration_ms": duration_ms,
            }
        )

    async def record_usage(
        self,
        params: dict,
        duration_ms: int,
        cache_hit: bool,
        provider_resource_id: str | None = None,
        character_cost: str | None = None,
    ) -> None:
        await self.database.record_usage(
            {
                "provider": "elevenlabs",
                "operation": "tts",
                "provider_resource_id": provider_resource_id,
                "model": params["model_id"],
                "characters": len(params["text"]),
                "estimated_duration_ms": duration_ms,
                "cache_hit": cache_hit,
                "metadata": {"character_cost": character_cost} if character_cost else {},
            }
        )
