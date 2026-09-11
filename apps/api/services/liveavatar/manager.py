import asyncio
import logging
from dataclasses import dataclass
from uuid import UUID

from services.orchestrator.src.coordination import Coordinator
from services.orchestrator.src.database import Database
from services.orchestrator.src.errors import ConfigurationError, NotFoundError, ProviderError
from services.orchestrator.src.livekit_gateway import LiveKitGateway

from .client import LiveAvatarClient
from .connection import LiveAvatarConnection

logger = logging.getLogger(__name__)
PROVIDER_STOP_REASON = "USER_DISCONNECTED"


@dataclass
class ManagedSession:
    id: UUID
    provider_session_id: str
    provider_token: str
    room_name: str
    browser_token: str
    livekit_url: str
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
        managed_livekit: bool,
    ):
        self.client = client
        self.livekit = livekit
        self.database = database
        self.coordinator = coordinator
        self.default_avatar_id = default_avatar_id
        self.public_livekit_ready = public_livekit_ready
        self.connect_timeout = connect_timeout
        self.managed_livekit = managed_livekit
        self.sessions: dict[UUID, ManagedSession] = {}
        self._lock = asyncio.Lock()

    async def create(
        self,
        *,
        avatar_id: str | None,
        sandbox: bool,
        max_session_duration: int,
    ) -> ManagedSession:
        selected_avatar = avatar_id or self.default_avatar_id
        room = None
        if self.managed_livekit:
            # LiveAvatar provisions the room, so nothing of ours needs to be publicly reachable.
            token_data = await self.client.create_token(
                avatar_id=selected_avatar,
                sandbox=sandbox,
                max_session_duration=max_session_duration,
            )
        else:
            if not self.public_livekit_ready:
                raise ConfigurationError(
                    "PUBLIC_LIVEKIT_URL must be a trusted public wss:// endpoint before "
                    "LiveAvatar cloud can join BYO LiveKit",
                    {
                        "required": "wss:// URL plus reachable advertised WebRTC TCP/UDP ports",
                        "alternative": "set LIVEAVATAR_TRANSPORT=managed to let LiveAvatar host the room",
                    },
                )
            room = await self.livekit.create_avatar_room()
            token_data = await self.client.create_token(
                avatar_id=selected_avatar,
                sandbox=sandbox,
                max_session_duration=max_session_duration,
                livekit_url=self.livekit.public_url,
                livekit_room=room.room_name,
                livekit_client_token=room.avatar_token,
            )
        provider_token: str | None = None
        provider_session_id: str | None = None
        connection: LiveAvatarConnection | None = None
        row = None
        managed = None
        try:
            provider_token = self._required_provider_value(token_data, "session_token")
            provider_session_id = self._required_provider_value(token_data, "session_id")
            start_data = await self.client.start_session(provider_token)
            ws_url = self._required_provider_value(start_data, "ws_url")
            provider_session_id = start_data.get("session_id") or provider_session_id
            if self.managed_livekit:
                livekit_url = self._required_provider_value(start_data, "livekit_url")
                browser_token = self._required_provider_value(start_data, "livekit_client_token")
                # LiveAvatar does not return a room name. Their session id names the room for our records.
                room_name = f"liveavatar-{provider_session_id}"
            else:
                assert room is not None
                livekit_url = self.livekit.public_url
                browser_token = room.browser_token
                room_name = room.room_name
            connection = LiveAvatarConnection(ws_url, self.connect_timeout)
            await connection.connect()
            row = await self.database.create_session(
                {
                    "provider_session_id": provider_session_id,
                    "avatar_id": selected_avatar,
                    "room_name": room_name,
                    "sandbox": sandbox,
                    "metadata": {
                        "max_session_duration": max_session_duration,
                        "transport": "managed" if self.managed_livekit else "byo",
                    },
                }
            )
            managed = ManagedSession(
                id=row["id"],
                provider_session_id=row["provider_session_id"],
                provider_token=provider_token,
                room_name=room_name,
                browser_token=browser_token,
                livekit_url=livekit_url,
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
                    "metadata": {
                        "avatar_id": selected_avatar,
                        "sandbox": sandbox,
                        "transport": "managed" if self.managed_livekit else "byo",
                    },
                }
            )
        except Exception:
            if managed:
                async with self._lock:
                    self.sessions.pop(managed.id, None)
                if managed.keepalive_task:
                    managed.keepalive_task.cancel()
                    await asyncio.gather(managed.keepalive_task, return_exceptions=True)
            if connection:
                await connection.close()
            if provider_token and provider_session_id:
                try:
                    await self.client.stop_session(
                        provider_token, provider_session_id, reason=PROVIDER_STOP_REASON
                    )
                except Exception:
                    logger.exception(
                        "liveavatar_session_start_cleanup_failed",
                        extra={"session_id": provider_session_id},
                    )
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
                await self.client.stop_session(
                    session.provider_token, session.provider_session_id, reason=PROVIDER_STOP_REASON
                )
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

    @staticmethod
    def _required_provider_value(data: dict, key: str) -> str:
        value = data.get(key)
        if not isinstance(value, str) or not value:
            raise ProviderError(
                "liveavatar_protocol", f"LiveAvatar response is missing a valid {key}", 502, False
            )
        return value
