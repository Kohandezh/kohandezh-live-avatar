from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    app_env: str = "development"
    log_level: str = "INFO"
    real_provider_tests: bool = False

    elevenlabs_api_key: SecretStr = SecretStr("")
    elevenlabs_voice_id: str = ""
    elevenlabs_model_id: str = "eleven_v3_conversational"
    elevenlabs_language_code: str = "fa"
    elevenlabs_base_url: str = "https://api.elevenlabs.io"
    elevenlabs_ws_url: str = "wss://api.elevenlabs.io"
    elevenlabs_output_format: str = "pcm_24000"
    elevenlabs_timeout_seconds: float = 30.0
    elevenlabs_stability: float = 0.5
    elevenlabs_similarity: float = 0.75
    elevenlabs_style: float = 0.0
    elevenlabs_speed: float = 1.0

    liveavatar_api_key: SecretStr = SecretStr("")
    liveavatar_avatar_id: str = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a"
    liveavatar_base_url: str = "https://api.liveavatar.com"
    liveavatar_sandbox: bool = True
    liveavatar_max_session_seconds: int = 60
    liveavatar_connect_timeout_seconds: float = 30.0

    livekit_url: str = "http://livekit:7880"
    livekit_ws_url: str = "ws://livekit:7880"
    livekit_egress_health_url: str = "http://livekit-egress:8080"
    public_livekit_url: str = "ws://localhost:7880"
    livekit_api_key: str = "devkey"
    livekit_api_secret: SecretStr = SecretStr("")

    database_url: str = "postgresql://kohandezh:password@postgres:5432/kohandezh_avatar"
    redis_url: str = "redis://redis:6379/0"
    media_root: Path = Path("/media")
    audio_cache_dir: Path = Path("/media/audio")
    video_cache_dir: Path = Path("/media/video")
    metadata_dir: Path = Path("/media/metadata")
    egress_output_dir: str = "/out"

    @field_validator("elevenlabs_output_format")
    @classmethod
    def pcm_24k_only(cls, value: str) -> str:
        if value != "pcm_24000":
            raise ValueError("Phase 1 requires ELEVENLABS_OUTPUT_FORMAT=pcm_24000")
        return value

    @property
    def real_livekit_ready(self) -> bool:
        return self.public_livekit_url.startswith("wss://") and "localhost" not in self.public_livekit_url

    def ensure_media_dirs(self) -> None:
        for path in (self.audio_cache_dir, self.video_cache_dir, self.metadata_dir):
            path.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()
