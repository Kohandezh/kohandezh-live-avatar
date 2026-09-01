import asyncio
import logging
from dataclasses import dataclass
from uuid import UUID

from services.orchestrator.src.coordination import Coordinator
from services.orchestrator.src.database import Database
from services.orchestrator.src.errors import ConfigurationError, NotFoundError
from services.orchestrator.src.livekit_gateway import LiveKitGateway

from .client import LiveAvatarClient
from .connection import LiveAvatarConnection

logger = logging.getLogger(__name__)


@dataclass
class ManagedSession:
    id: UUID
    provider_session_id: str
    provider_token: str
    room_name: str
    browser_token: str
    avatar_id: str
    sandbox: bool
    connection: LiveAvatarConnection
    keepalive_task: asyncio.Task | None = None


class LiveAvatarManager:
    def __init__(
        self,
        *,
        client: LiveAvatarClient,
        livekit: LiveKitGateway,
        database: Database,
        coordinator: Coordinator,
        default_avatar_id: str,
        public_livekit_ready: bool,
        connect_timeout: float,
    ):
        self.client = client
        self.livekit = livekit
        self.database = database
        self.coordinator = coordinator
        self.default_avatar_id = default_avatar_id
        self.public_livekit_ready = public_livekit_ready
        self.connect_timeout = connect_timeout
        self.sessions: dict[UUID, ManagedSession] = {}
        self._lock = asyncio.Lock()

    async def create(
        self,
        *,
        avatar_id: str | None,
        sandbox: bool,
        max_session_duration: int,
    ) -> ManagedSession:
        if not self.public_livekit_ready:
            raise ConfigurationError(
                "PUBLIC_LIVEKIT_URL must be a trusted public wss:// endpoint before "
                "LiveAvatar cloud can join BYO LiveKit",
                {"required": "wss:// URL plus reachable advertised WebRTC TCP/UDP ports"},
            )
        selected_avatar = avatar_id or self.default_avatar_id
        room = await self.livekit.create_avatar_room()
        token_data = await self.client.create_token(
            avatar_id=selected_avatar,
            sandbox=sandbox,
            max_session_duration=max_session_duration,
            livekit_url=self.livekit.public_url,
            livekit_agent_token=room.avatar_token,
        )
        provider_token = token_data["session_token"]
        start_data = await self.client.start_session(provider_token)
        connection = LiveAvatarConnection(start_data["ws_url"], self.connect_timeout)
        row = None
        managed = None
        try:
            await connection.connect()
            row = await self.database.create_session(
                {
                    "provider_session_id": start_data.get("session_id") or token_data["session_id"],
                    "avatar_id": selected_avatar,
                    "room_name": room.room_name,
                    "sandbox": sandbox,
                    "metadata": {"max_session_duration": max_session_duration},
                }
            )
            managed = ManagedSession(
                id=row["id"],
                provider_session_id=row["provider_session_id"],
                provider_token=provider_token,
                room_name=room.room_name,
                browser_token=room.browser_token,
                avatar_id=selected_avatar,
                sandbox=sandbox,
                connection=connection,
            )
            managed.keepalive_task = asyncio.create_task(self._keepalive(managed))
            async with self._lock:
                self.sessions[managed.id] = managed
            await self.coordinator.set_session(str(managed.id), "CONNECTED", max_session_duration + 60)
            await self.database.record_usage(
                {
                    "provider": "liveavatar",
                    "operation": "session_start",
                    "provider_resource_id": managed.provider_session_id,
                    "cache_hit": False,
                    "metadata": {"avatar_id": selected_avatar, "sandbox": sandbox},
                }
            )
        except Exception:
            if managed:
                async with self._lock:
                    self.sessions.pop(managed.id, None)
                if managed.keepalive_task:
                    managed.keepalive_task.cancel()
                    await asyncio.gather(managed.keepalive_task, return_exceptions=True)
            await connection.close()
            try:
                await self.client.stop_session(provider_token)
            finally:
                if row:
                    await self.database.close_session(row["id"], "START_FAILED")
            raise
        logger.info(
            "liveavatar_session_started",
            extra={
                "session_id": managed.provider_session_id,
                "avatar_id": selected_avatar,
                "sandbox": sandbox,
            },
        )
        return managed

    def get(self, session_id: UUID) -> ManagedSession:
        session = self.sessions.get(session_id)
        if not session:
            raise NotFoundError("active avatar session")
        return session

    async def close(self, session_id: UUID, status: str = "CLOSED") -> None:
        async with self._lock:
            session = self.sessions.pop(session_id, None)
        if not session:
            raise NotFoundError("active avatar session")
        if session.keepalive_task:
            session.keepalive_task.cancel()
            await asyncio.gather(session.keepalive_task, return_exceptions=True)
        try:
            await session.connection.close()
        finally:
            try:
                await self.client.stop_session(session.provider_token)
            finally:
                await self.database.close_session(session_id, status)
                await self.coordinator.delete_session(str(session_id))
                await self.database.record_usage(
                    {
                        "provider": "liveavatar",
                        "operation": "session_end",
                        "provider_resource_id": session.provider_session_id,
                        "cache_hit": False,
                        "metadata": {"status": status, "avatar_id": session.avatar_id},
                    }
                )
        logger.info(
            "liveavatar_session_closed", extra={"session_id": session.provider_session_id, "status": status}
        )

    async def close_all(self) -> None:
        for session_id in list(self.sessions):
            try:
                await self.close(session_id, "SHUTDOWN")
            except Exception:
                logger.exception(
                    "liveavatar_session_shutdown_failed", extra={"local_session_id": str(session_id)}
                )

    async def _keepalive(self, session: ManagedSession) -> None:
        try:
            while True:
                await asyncio.sleep(120)
                await session.connection.keep_alive()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("liveavatar_keepalive_failed", extra={"session_id": session.provider_session_id})
