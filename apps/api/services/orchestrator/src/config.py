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
    # Languages the assistant is allowed to actually start a FULL mode session in, comma
    # separated. Verified against the real provider on 2026-09-11: a token mint
    # (POST /v1/sessions/token) accepts avatar_persona.language "fa", but the session start
    # (POST /v1/sessions/start) rejects it with "Language not supported." None of the STT
    # providers behind FULL mode (deepgram, assembly_ai, gladia, elevenlabs) support Persian, and
    # neither does the ElevenLabs TTS model FULL mode uses. So "fa" is left out of the default
    # until LiveAvatar adds a provider that supports it.
    liveavatar_assistant_languages: str = "en"
    # The LiveAvatar stored Voice Agent that wraps the customer's ElevenLabs agent. Setting it
    # switches the assistant to the voice agent provider mode, which is the only path that speaks
    # Persian today: FULL mode rejects "fa" at session start (see the comment above).
    # ElevenLabs bills those conversation minutes separately, on the customer's ElevenLabs plan,
    # so a session must never start without a user action.
    liveavatar_voice_agent_id: str = ""
    # The language the voice agent itself is configured with. LiveAvatar rejects a per-session
    # language override for this agent type, so this is only what we report back to the client.
    liveavatar_voice_agent_language: str = "fa"
    # Production avatar. Sandbox cannot use a custom avatar, so this is ignored while sandbox is on.
    liveavatar_assistant_avatar_id: str = ""
    liveavatar_assistant_max_session_seconds: int = 60

    # Public key the website widget sends in X-Embed-Key. It is not a secret (it ships in the
    # widget script), so the origin allowlist and the rate limit are what actually protect us.
    assistant_embed_key: SecretStr = SecretStr("")
    assistant_embed_allowed_origins: str = ""
    assistant_rate_limit_per_hour: int = 20

    # Phone login. "console" writes the code to the log instead of sending an SMS. It stays the
    # default so tests and CI can never send a real message. "asanak" sends the code by SMS.
    otp_delivery: Literal["console", "asanak"] = "console"
    otp_code_length: int = 6
    otp_ttl_seconds: int = 120

    # Asanak SMS (Iranian provider). Used only when OTP_DELIVERY=asanak, and then the username
    # and the password are required: the process refuses to start without them.
    asanak_username: str = ""
    asanak_password: SecretStr = SecretStr("")
    # The sender line the template is registered on. Asanak takes the line from the template, so
    # it is not sent in the request; it is configuration the operator records and sees in logs.
    # The line and the template id belong to the customer's Asanak account, so they are not
    # defaults in code: set them in .env.
    asanak_source: str = ""
    asanak_template_id: int = 0
    # The template variable that holds the code. Asanak's documentation does not name it, so it
    # is configurable: change it if the template in the panel uses another variable name.
    asanak_template_code_parameter: str = "code"
    asanak_base_url: str = "https://sms.asanak.ir/webservice/v2rest"
    asanak_timeout_seconds: float = 10.0
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

    @field_validator("asanak_template_id", mode="before")
    @classmethod
    def blank_template_id_means_unset(cls, value: object) -> object:
        # .env.example ships the line empty. An empty string is "not set", not a parse error.
        if isinstance(value, str) and not value.strip():
            return 0
        return value

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
    def assistant_language_list(self) -> list[str]:
        """Languages the assistant may start a FULL mode session in.

        Falls back to "en" when the setting is blank, so the assistant always has a language it
        can actually use even with a bad or empty override.
        """
        return _split_list(self.liveavatar_assistant_languages) or ["en"]

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
