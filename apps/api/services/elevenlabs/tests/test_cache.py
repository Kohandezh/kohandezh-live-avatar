import json
import struct

import pytest

from services.elevenlabs.audio import REQUIRED_PCM
from services.elevenlabs.cache import AudioCache, deterministic_cache_key

PARAMS = {
    "text": "سلام دنیا",
    "voice_id": "voice",
    "model_id": "eleven_v3_conversational",
    "speed": 1.0,
    "stability": 0.5,
    "similarity": 0.75,
    "style": 0.0,
    "language": "fa",
    "output_format": "pcm_24000",
}


def test_cache_key_is_stable_across_dictionary_order():
    reversed_params = dict(reversed(list(PARAMS.items())))
    assert deterministic_cache_key(PARAMS) == deterministic_cache_key(reversed_params)


def test_every_audio_parameter_changes_the_cache_key():
    original = deterministic_cache_key(PARAMS)
    for key, value in PARAMS.items():
        changed = dict(PARAMS)
        changed[key] = f"{value}-different" if isinstance(value, str) else value + 0.01
        assert deterministic_cache_key(changed) != original, key


@pytest.mark.asyncio
async def test_cache_miss_then_hit_writes_pcm_and_metadata(tmp_path):
    cache = AudioCache(tmp_path / "audio", tmp_path / "metadata")
    key = deterministic_cache_key(PARAMS)
    assert await cache.get(key) is None
    pcm = struct.pack("<h", 0) * REQUIRED_PCM.sample_rate
    stored = await cache.put(key, pcm, PARAMS)
    hit = await cache.get(key)
    assert hit == stored
    metadata = json.loads(stored.metadata_path.read_text())
    assert metadata["sample_rate"] == 24000
    assert metadata["channels"] == 1
    assert metadata["format"] == "pcm_s16le"
    assert metadata["duration_ms"] == 1000


@pytest.mark.asyncio
async def test_corrupt_cache_metadata_is_treated_as_miss(tmp_path):
    cache = AudioCache(tmp_path / "audio", tmp_path / "metadata")
    key = deterministic_cache_key(PARAMS)
    pcm = struct.pack("<h", 0) * REQUIRED_PCM.sample_rate
    stored = await cache.put(key, pcm, PARAMS)
    metadata = json.loads(stored.metadata_path.read_text())
    metadata["duration_ms"] = 3
    stored.metadata_path.write_text(json.dumps(metadata))
    assert await cache.get(key) is None
