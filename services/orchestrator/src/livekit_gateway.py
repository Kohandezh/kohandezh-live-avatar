import logging
from dataclasses import dataclass
from pathlib import PurePosixPath
from uuid import uuid4

from livekit import api

from .errors import ProviderError

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RoomCredentials:
    room_name: str
    avatar_token: str
    browser_token: str


class LiveKitGateway:
    def __init__(self, *, url: str, api_key: str, api_secret: str, public_url: str, egress_dir: str):
        self.url = url
        self.api_key = api_key
        self.api_secret = api_secret
        self.public_url = public_url
        self.egress_dir = egress_dir
        self.client = api.LiveKitAPI(url, api_key, api_secret)

    async def close(self) -> None:
        await self.client.aclose()

    async def ping(self) -> None:
        await self.client.room.list_rooms(api.ListRoomsRequest())

    def token(
        self,
        *,
        identity: str,
        room_name: str,
        can_publish: bool,
        can_subscribe: bool,
        can_publish_data: bool = False,
    ) -> str:
        return (
            api.AccessToken(self.api_key, self.api_secret)
            .with_identity(identity)
            .with_name(identity)
            .with_grants(
                api.VideoGrants(
                    room_join=True,
                    room=room_name,
                    can_publish=can_publish,
                    can_subscribe=can_subscribe,
                    can_publish_data=can_publish_data,
                )
            )
            .to_jwt()
        )

    async def create_avatar_room(self) -> RoomCredentials:
        suffix = uuid4().hex[:12]
        room_name = f"avatar-{suffix}"
        await self.client.room.create_room(
            api.CreateRoomRequest(name=room_name, empty_timeout=300, departure_timeout=20)
        )
        avatar_token = self.token(
            identity=f"liveavatar-{suffix}",
            room_name=room_name,
            can_publish=True,
            can_subscribe=False,
            can_publish_data=True,
        )
        browser_token = self.token(
            identity=f"browser-{suffix}",
            room_name=room_name,
            can_publish=False,
            can_subscribe=True,
        )
        return RoomCredentials(room_name, avatar_token, browser_token)

    async def start_mp4_egress(self, room_name: str, asset_name: str) -> str:
        output_path = str(PurePosixPath(self.egress_dir) / f"{asset_name}.mp4")
        try:
            info = await self.client.egress.start_room_composite_egress(
                api.RoomCompositeEgressRequest(
                    room_name=room_name,
                    layout="speaker",
                    file_outputs=[
                        api.EncodedFileOutput(
                            file_type=api.EncodedFileType.MP4,
                            filepath=output_path,
                        )
                    ],
                )
            )
            return info.egress_id
        except Exception as exc:
            logger.error("livekit_egress_start_failed", extra={"error_category": type(exc).__name__})
            raise ProviderError(
                "egress_failure", "LiveKit Egress could not start the MP4 recording", 502, True
            ) from exc

    async def stop_egress(self, egress_id: str) -> None:
        try:
            await self.client.egress.stop_egress(api.StopEgressRequest(egress_id=egress_id))
        except Exception as exc:
            raise ProviderError(
                "egress_failure", "LiveKit Egress could not finalize the MP4 recording", 502, True
            ) from exc
