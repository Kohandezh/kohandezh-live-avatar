import asyncio
import logging
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Depends, FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from services.elevenlabs.audio import validate_pcm
from services.elevenlabs.cache import AudioCache, deterministic_cache_key
from services.elevenlabs.client import ElevenLabsClient
from services.elevenlabs.service import ElevenLabsService
from services.liveavatar.client import LiveAvatarClient
from services.liveavatar.manager import LiveAvatarManager

from .assistant.router import router as assistant_router
from .assistant.service import AssistantSessionService
from .auth.admin import router as admin_router
from .auth.asanak import AsanakOtpSender, build_otp_sender
from .auth.dependencies import UserRow, require_admin
from .auth.otp import OtpService
from .auth.router import router as auth_router
from .auth.sessions import SessionService
from .config import Settings, get_settings
from .coordination import Coordinator
from .database import Database
from .errors import AppError, NotFoundError
from .jobs import HANDLERS, JobRunner, new_worker_id
from .jobs.finalize import start_finalize
from .jobs.router import router as jobs_router
from .library.router import admin_router as library_admin_router
from .library.router import router as library_router
from .livekit_gateway import LiveKitGateway
from .logging import configure_logging, correlation_id_var
from .schemas import (
    ApprovalRequest,
    AssetStatus,
    AudioAssetResponse,
    AvatarActionRequest,
    AvatarSessionRequest,
    AvatarSessionResponse,
    AvatarSpeakRequest,
    GenerateVideoRequest,
    HealthComponent,
    HealthResponse,
    TTSRequest,
)

settings = get_settings()
configure_logging(settings.log_level)
logger = logging.getLogger(__name__)


def build_services(app: FastAPI, config: Settings) -> None:
    # First, so a missing SMS credential stops the process before anything else is built.
    otp_sender = build_otp_sender(config)
    config.ensure_media_dirs()
    migrations = Path(__file__).resolve().parents[1] / "migrations"
    database = Database(config.database_url, migrations)
    coordinator = Coordinator(config.redis_url)
    livekit = LiveKitGateway(
        url=config.livekit_url,
        api_key=config.livekit_api_key,
        api_secret=config.livekit_api_secret.get_secret_value(),
        public_url=config.public_livekit_url,
        egress_dir=config.egress_output_dir,
    )
    eleven_client = ElevenLabsClient(
        api_key=config.elevenlabs_api_key.get_secret_value(),
        base_url=config.elevenlabs_base_url,
        websocket_url=config.elevenlabs_ws_url,
        timeout_seconds=config.elevenlabs_timeout_seconds,
    )
    tts = ElevenLabsService(
        client=eleven_client,
        cache=AudioCache(config.audio_cache_dir, config.metadata_dir),
        database=database,
        coordinator=coordinator,
        default_voice_id=config.elevenlabs_voice_id,
        default_model_id=config.elevenlabs_model_id,
    )
    liveavatar_client = LiveAvatarClient(
        api_key=config.liveavatar_api_key.get_secret_value(),
        base_url=config.liveavatar_base_url,
        timeout_seconds=config.liveavatar_connect_timeout_seconds,
    )
    avatar = LiveAvatarManager(
        client=liveavatar_client,
        livekit=livekit,
        database=database,
        coordinator=coordinator,
        default_avatar_id=config.liveavatar_avatar_id,
        public_livekit_ready=config.real_livekit_ready,
        connect_timeout=config.liveavatar_connect_timeout_seconds,
        managed_livekit=config.managed_livekit,
    )
    assistant = AssistantSessionService(client=liveavatar_client, database=database, settings=config)
    sessions = SessionService(coordinator=coordinator, ttl_seconds=config.session_ttl_seconds)
    otp = OtpService(coordinator=coordinator, sender=otp_sender, settings=config)
    jobs = JobRunner(database, handlers=HANDLERS, worker_id=new_worker_id(), settings=config)
    app.state.settings = config
    app.state.database = database
    app.state.coordinator = coordinator
    app.state.livekit = livekit
    app.state.tts = tts
    app.state.avatar = avatar
    app.state.liveavatar_client = liveavatar_client
    app.state.assistant = assistant
    app.state.sessions = sessions
    app.state.otp = otp
    app.state.otp_sender = otp_sender
    app.state.jobs = jobs


@asynccontextmanager
async def lifespan(app: FastAPI):
    build_services(app, settings)
    await app.state.database.connect()
    await app.state.jobs.start()
    logger.info("orchestrator_started", extra={"environment": settings.app_env})
    try:
        yield
    finally:
        # First, so a running job still has its database and its providers while it finishes.
        await app.state.jobs.stop()
        await app.state.avatar.close_all()
        if isinstance(app.state.otp_sender, AsanakOtpSender):
            await app.state.otp_sender.close()
        await app.state.liveavatar_client.close()
        await app.state.tts.client.close()
        await app.state.livekit.close()
        await app.state.coordinator.close()
        await app.state.database.close()


app = FastAPI(
    title="Dr.Kohandezh Live Avatar Phase 1",
    version="0.1.0",
    lifespan=lifespan,
)


# Browsers send the session cookie only to an origin we name here, so the list is explicit and
# never "*". allow_credentials is what makes the cookie and the bearer header work at all.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-Client-Platform",
        "X-Embed-Key",
        "X-Correlation-ID",
    ],
    # Retry-After tells a client of a rate-limited route when to try again.
    expose_headers=["X-Correlation-ID", "Retry-After"],
)


@app.middleware("http")
async def correlation_middleware(request: Request, call_next):
    correlation_id = request.headers.get("X-Correlation-ID") or str(uuid4())
    token = correlation_id_var.set(correlation_id)
    try:
        response = await call_next(request)
        response.headers["X-Correlation-ID"] = correlation_id
        return response
    finally:
        correlation_id_var.reset(token)


@app.exception_handler(AppError)
async def app_error_handler(_: Request, exc: AppError):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
                "retryable": exc.retryable,
                "details": exc.details,
            },
            "correlation_id": correlation_id_var.get(),
        },
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError):
    details = []
    for error in exc.errors():
        clean_error = dict(error)
        if clean_error.get("ctx"):
            clean_error["ctx"] = {key: str(value) for key, value in clean_error["ctx"].items()}
        details.append(clean_error)
    return JSONResponse(
        status_code=422,
        content={
            "error": {"code": "validation_error", "message": "request validation failed", "details": details},
            "correlation_id": correlation_id_var.get(),
        },
    )


app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(assistant_router)
app.include_router(jobs_router)
app.include_router(library_router)
app.include_router(library_admin_router)


@app.get("/health/live")
async def liveness():
    return {"status": "ok"}


async def _check(name: str, operation) -> tuple[str, HealthComponent]:
    started = time.perf_counter()
    try:
        await asyncio.wait_for(operation(), timeout=2)
        return name, HealthComponent(status="ok", latency_ms=round((time.perf_counter() - started) * 1000, 2))
    except Exception as exc:
        return name, HealthComponent(status="error", detail=type(exc).__name__)


async def _check_egress(url: str) -> None:
    async with httpx.AsyncClient(timeout=2) as client:
        response = await client.get(url)
        response.raise_for_status()


@app.get("/health", response_model=HealthResponse)
async def health(request: Request):
    checks = await asyncio.gather(
        _check("postgres", request.app.state.database.ping),
        _check("redis", request.app.state.coordinator.ping),
        _check("livekit", request.app.state.livekit.ping),
        _check(
            "livekit_egress",
            lambda: _check_egress(request.app.state.settings.livekit_egress_health_url),
        ),
    )
    dependencies = dict(checks)
    overall = "ok" if all(item.status == "ok" for item in dependencies.values()) else "degraded"
    return HealthResponse(status=overall, timestamp=datetime.now(UTC), dependencies=dependencies)


# The recording (authoring) workbench. Every route here starts paid provider work or serves media
# that is not published yet, so the whole router needs the admin role. It is included after its
# last route, further down.
authoring = APIRouter(tags=["authoring"], dependencies=[Depends(require_admin)])


def _audio_response(result) -> AudioAssetResponse:
    return AudioAssetResponse(
        id=result.asset["id"],
        cache_key=result.cache_key,
        status=AssetStatus(result.asset["status"]),
        duration_ms=result.duration_ms,
        media_url=f"/api/assets/audio/{result.asset['id']}",
        cache_hit=result.cache_hit,
    )


@authoring.post("/tts/generate", response_model=AudioAssetResponse)
async def generate_tts(payload: TTSRequest, request: Request):
    result = await request.app.state.tts.generate(payload)
    return _audio_response(result)


@authoring.post("/avatar/session", response_model=AvatarSessionResponse)
async def create_avatar_session(payload: AvatarSessionRequest, request: Request):
    config: Settings = request.app.state.settings
    sandbox = config.liveavatar_sandbox if payload.sandbox is None else payload.sandbox
    managed = await request.app.state.avatar.create(
        avatar_id=str(payload.avatar_id) if payload.avatar_id else None,
        sandbox=sandbox,
        max_session_duration=payload.max_session_duration or config.liveavatar_max_session_seconds,
    )
    return AvatarSessionResponse(
        id=managed.id,
        provider_session_id=managed.provider_session_id,
        room_name=managed.room_name,
        livekit_url=managed.livekit_url,
        livekit_client_token=managed.browser_token,
        sandbox=managed.sandbox,
        transport=config.liveavatar_transport,
    )


@authoring.post("/avatar/speak")
async def avatar_speak(payload: AvatarSpeakRequest, request: Request):
    manager: LiveAvatarManager = request.app.state.avatar
    tts: ElevenLabsService = request.app.state.tts
    managed = manager.get(payload.session_id)
    tts_request = TTSRequest(text=payload.text)
    params = tts.parameters(tts_request)
    cache_key = deterministic_cache_key(params)
    cached = await tts.cache.get(cache_key)
    if cached:
        audio = await asyncio.to_thread(cached.audio_path.read_bytes)
        event_id = await managed.connection.speak_bytes(audio)
        asset = await tts.ensure_asset(params, cache_key, cached.audio_path, cached.duration_ms)
        await tts.record_usage(params, cached.duration_ms, True)
        return {
            "event_id": event_id,
            "audio_asset_id": str(asset["id"]),
            "cache_hit": True,
            "interrupted": False,
        }

    async with request.app.state.coordinator.lock(f"tts:{cache_key}", ttl_seconds=90):
        cached = await tts.cache.get(cache_key)
        if cached:
            audio = await asyncio.to_thread(cached.audio_path.read_bytes)
            event_id = await managed.connection.speak_bytes(audio)
            asset = await tts.ensure_asset(params, cache_key, cached.audio_path, cached.duration_ms)
            await tts.record_usage(params, cached.duration_ms, True)
            return {
                "event_id": event_id,
                "audio_asset_id": str(asset["id"]),
                "cache_hit": True,
                "interrupted": False,
            }

        generated = bytearray()

        async def tapped_stream():
            async for chunk in tts.client.stream_websocket(params):
                generated.extend(chunk)
                yield chunk

        event_id = await managed.connection.speak_stream(tapped_stream())
        if managed.connection.interrupted.is_set():
            return {"event_id": event_id, "audio_asset_id": None, "cache_hit": False, "interrupted": True}
        duration_ms = validate_pcm(bytes(generated))
        cached = await tts.cache.put(cache_key, bytes(generated), params)
        asset = await tts.ensure_asset(params, cache_key, cached.audio_path, duration_ms)
        await tts.record_usage(params, duration_ms, False)
        return {
            "event_id": event_id,
            "audio_asset_id": str(asset["id"]),
            "cache_hit": False,
            "interrupted": False,
        }


@authoring.post("/avatar/interrupt")
async def avatar_interrupt(payload: AvatarActionRequest, request: Request):
    managed = request.app.state.avatar.get(payload.session_id)
    await managed.connection.interrupt()
    return {"status": "interrupted"}


@authoring.post("/avatar/listening/{state}")
async def avatar_listening(state: str, payload: AvatarActionRequest, request: Request):
    if state not in {"start", "stop"}:
        raise AppError("validation_error", "state must be start or stop", 422)
    managed = request.app.state.avatar.get(payload.session_id)
    event_id = await managed.connection.listening(state == "start")
    return {"event_id": event_id, "state": state}


@authoring.post("/avatar/close")
async def avatar_close(payload: AvatarActionRequest, request: Request):
    await request.app.state.avatar.close(payload.session_id)
    return {"status": "closed"}


@authoring.post("/assets/generate-video")
async def generate_video(payload: GenerateVideoRequest, request: Request):
    if request.app.state.settings.managed_livekit:
        raise AppError(
            "recording_unavailable",
            "Recording needs a room in our own LiveKit. LIVEAVATAR_TRANSPORT=managed puts the "
            "session in LiveAvatar's room, which our Egress worker cannot join. Use "
            "LIVEAVATAR_TRANSPORT=byo with a public LiveKit endpoint to record.",
            409,
            False,
        )
    managed = request.app.state.avatar.get(payload.session_id)
    video_path = request.app.state.settings.video_cache_dir / f"{payload.asset_id}.mp4"
    async with request.app.state.coordinator.lock(f"video:{payload.asset_id}", ttl_seconds=60):
        row = await request.app.state.database.get_video_by_external_id(payload.asset_id)
        if row and row["egress_id"]:
            raise AppError(
                "duplicate_generation",
                "this video asset already has an Egress recording",
                409,
                False,
            )
        if not row:
            row = await request.app.state.database.create_video_asset(
                {
                    "external_id": payload.asset_id,
                    "text": payload.text,
                    "audio_asset_id": payload.audio_asset_id,
                    "avatar_id": managed.avatar_id,
                    "voice_id": request.app.state.settings.elevenlabs_voice_id,
                    "video_path": str(video_path),
                }
            )
        egress_id = await request.app.state.livekit.start_mp4_egress(managed.room_name, payload.asset_id)
        await request.app.state.database.mark_video_recording(row["id"], egress_id)
        return {"id": str(row["id"]), "egress_id": egress_id, "status": "RECORDING"}


@authoring.post("/assets/video/{asset_id}/finalize", status_code=202)
async def finalize_video(asset_id: UUID, request: Request, admin: UserRow = Depends(require_admin)):
    """Stop Egress and hand the wait for the MP4 to a finalize_video job (ADR 0015, item 4)."""
    database = request.app.state.database
    row = await database.get_video_asset(asset_id)
    if not row:
        raise NotFoundError("video asset")
    if not row["egress_id"]:
        raise AppError("egress_failure", "video asset has no active egress", 409)
    if row["status"] != AssetStatus.DRAFT.value:
        raise AppError(
            "invalid_status_transition",
            f"a video asset in {row['status']} cannot be finalized",
            409,
            False,
            {"currentStatus": row["status"]},
        )
    job = await start_finalize(
        database,
        request.app.state.livekit,
        asset_id=asset_id,
        egress_id=row["egress_id"],
        created_by=admin["id"],
    )
    return {"jobId": str(job["id"])}


@authoring.get("/assets/audio/{asset_id}")
async def get_audio(asset_id: UUID, request: Request):
    row = await request.app.state.database.get_audio_asset(asset_id)
    if not row or not Path(row["file_path"]).is_file():
        raise NotFoundError("audio asset")
    return FileResponse(
        row["file_path"],
        media_type="audio/L16;rate=24000;channels=1",
        filename=f"{row['cache_key']}.pcm",
    )


@authoring.get("/assets/video/{asset_id}")
async def get_video(asset_id: UUID, request: Request):
    row = await request.app.state.database.get_video_asset(asset_id)
    if not row or not Path(row["video_path"]).is_file():
        raise NotFoundError("video asset")
    return FileResponse(row["video_path"], media_type="video/mp4", filename=f"{row['external_id']}.mp4")


# The statuses each review decision may start from. Approval needs the generated media (a DRAFT
# video is still recording). A rejection can also withdraw an approval. A rejection is final.
REVIEW_TRANSITIONS: dict[str, dict[AssetStatus, list[AssetStatus]]] = {
    "audio": {
        AssetStatus.AUDIO_APPROVED: [AssetStatus.AUDIO_GENERATED],
        AssetStatus.REJECTED: [AssetStatus.AUDIO_GENERATED, AssetStatus.AUDIO_APPROVED],
    },
    "video": {
        AssetStatus.VIDEO_APPROVED: [AssetStatus.VIDEO_GENERATED],
        AssetStatus.REJECTED: [AssetStatus.VIDEO_GENERATED, AssetStatus.VIDEO_APPROVED],
    },
}


@authoring.patch("/assets/{kind}/{asset_id}/status")
async def review_asset(
    kind: str,
    asset_id: UUID,
    payload: ApprovalRequest,
    request: Request,
    admin: UserRow = Depends(require_admin),
):
    transitions = REVIEW_TRANSITIONS.get(kind)
    if not transitions:
        raise AppError("validation_error", "kind must be audio or video", 422)
    allowed_from = transitions.get(payload.status)
    if allowed_from is None:
        raise AppError("validation_error", f"{payload.status.value} is not valid for {kind}", 422)
    database = request.app.state.database
    row = await database.review_asset(
        kind,
        asset_id,
        decision=payload.status.value,
        allowed_from=[status.value for status in allowed_from],
        reviewer_user_id=admin["id"],
    )
    if row:
        return {"id": str(asset_id), "status": row["status"]}
    current = await (database.get_audio_asset if kind == "audio" else database.get_video_asset)(asset_id)
    if not current:
        raise NotFoundError(f"{kind} asset")
    raise AppError(
        "invalid_status_transition",
        f"a {kind} asset in {current['status']} cannot move to {payload.status.value}",
        409,
        False,
        {"currentStatus": current["status"]},
    )


@authoring.get("/usage")
async def usage(request: Request):
    return {"items": await request.app.state.database.usage_summary()}


# include_router copies the routes the router holds at this point, so this stays after the last
# authoring route.
app.include_router(authoring)


@app.websocket("/ws/status")
async def websocket_status(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            await websocket.send_json(
                {
                    "type": "system.status",
                    "active_sessions": len(websocket.app.state.avatar.sessions),
                    "timestamp": datetime.now(UTC).isoformat(),
                }
            )
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=5)
            except TimeoutError:
                pass
    except WebSocketDisconnect:
        return
