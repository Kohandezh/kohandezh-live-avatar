from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _split_list(value: str) -> list[str]:
    """Read a comma separated environment value. Empty entries are dropped."""
    return [item.strip() for item in value.split(",") if item.strip()]


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
    # "managed": LiveAvatar provisions the LiveKit room and returns its URL and a browser token.
    # Works from a laptop because nothing of ours has to be reachable from the internet, but the
    # room is theirs, so our Egress worker cannot record it.
    # "byo": we create the room in our own LiveKit and hand LiveAvatar a publisher token. Needs a
    # public wss:// endpoint and reachable media ports, and is the only mode that can record.
    liveavatar_transport: Literal["managed", "byo"] = "managed"

    # Assistant: LiveAvatar FULL mode. LiveAvatar runs the whole conversation (STT, LLM, TTS,
    # avatar video) and we only mint the session token.
    # The context id is the persona the avatar answers with. Without it FULL mode is "restricted"
    # and the avatar stays silent, so the assistant refuses to start when it is empty.
    liveavatar_context_id: str = ""
    liveavatar_assistant_voice_id: str = ""
    liveavatar_assistant_language: str = "fa"
    # Production avatar. Sandbox cannot use a custom avatar, so this is ignored while sandbox is on.
    liveavatar_assistant_avatar_id: str = ""
    liveavatar_assistant_max_session_seconds: int = 60

    # Public key the website widget sends in X-Embed-Key. It is not a secret (it ships in the
    # widget script), so the origin allowlist and the rate limit are what actually protect us.
    assistant_embed_key: SecretStr = SecretStr("")
    assistant_embed_allowed_origins: str = ""
    assistant_rate_limit_per_hour: int = 20

    # Phone login. "console" writes the code to the log instead of sending an SMS.
    otp_delivery: Literal["console"] = "console"
    otp_code_length: int = 6
    otp_ttl_seconds: int = 120
    # Comma separated E.164 phones that get the admin role on every successful login.
    admin_phones: str = ""
    session_ttl_days: int = 30

    # Comma separated browser origins allowed to call the API with credentials.
    cors_allowed_origins: str = (
        "http://localhost:5173,http://localhost:5174,http://localhost:5175,"
        "http://localhost:5176,http://localhost:8088,capacitor://localhost,http://localhost"
    )

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
    def is_development(self) -> bool:
        return self.app_env == "development"

    @property
    def cors_origin_list(self) -> list[str]:
        """Browser origins allowed to call the API with credentials.

        The websites that embed the widget are included. Their pages call the assistant endpoints
        from their own origin, so CORS has to name them as well. A "*" entry is dropped, because
        a browser refuses a wildcard together with credentials.
        """
        origins = _split_list(self.cors_allowed_origins)
        for origin in self.embed_allowed_origin_list:
            if origin != "*" and origin not in origins:
                origins.append(origin)
        return origins

    @property
    def admin_phone_list(self) -> list[str]:
        return _split_list(self.admin_phones)

    @property
    def embed_allowed_origin_list(self) -> list[str]:
        return _split_list(self.assistant_embed_allowed_origins)

    @property
    def session_ttl_seconds(self) -> int:
        return self.session_ttl_days * 24 * 3600

    @property
    def real_livekit_ready(self) -> bool:
        return self.public_livekit_url.startswith("wss://") and "localhost" not in self.public_livekit_url

    @property
    def managed_livekit(self) -> bool:
        return self.liveavatar_transport == "managed"

    def ensure_media_dirs(self) -> None:
        for path in (self.audio_cache_dir, self.video_cache_dir, self.metadata_dir):
            path.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()
