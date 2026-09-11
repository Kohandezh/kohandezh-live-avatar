import json
import secrets
from contextlib import asynccontextmanager
from typing import Any

from redis.asyncio import Redis

from .errors import ConflictError

_RELEASE_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
"""


class Coordinator:
    def __init__(self, url: str, redis: Redis | None = None):
        # The client is injectable so tests can drive the real logic against a fake Redis.
        self.redis = redis or Redis.from_url(url, decode_responses=True)

    async def close(self) -> None:
        await self.redis.aclose()

    async def ping(self) -> None:
        await self.redis.ping()

    @asynccontextmanager
    async def lock(self, key: str, ttl_seconds: int = 60):
        token = secrets.token_urlsafe(24)
        redis_key = f"lock:{key}"
        acquired = await self.redis.set(redis_key, token, nx=True, ex=ttl_seconds)
        if not acquired:
            raise ConflictError("an identical generation is already in progress; retry shortly")
        try:
            yield
        finally:
            await self.redis.eval(_RELEASE_SCRIPT, 1, redis_key, token)

    async def set_session(self, session_id: str, value: str, ttl_seconds: int) -> None:
        await self.redis.set(f"session:{session_id}", value, ex=ttl_seconds)

    async def delete_session(self, session_id: str) -> None:
        await self.redis.delete(f"session:{session_id}")

    async def rate_limit(self, key: str, limit: int, window_seconds: int) -> int:
        """Count one hit in a fixed window.

        Returns 0 while the caller is inside the limit, otherwise the seconds left in the window.
        """
        redis_key = f"ratelimit:{key}"
        count = await self.redis.incr(redis_key)
        if count == 1:
            await self.redis.expire(redis_key, window_seconds)
        if count <= limit:
            return 0
        return await self._remaining_ttl(redis_key, window_seconds)

    async def claim_once(self, key: str, ttl_seconds: int) -> int:
        """Take a marker that only one caller can hold.

        Returns 0 when the caller took it, otherwise the seconds until it is free again.
        """
        redis_key = f"once:{key}"
        taken = await self.redis.set(redis_key, "1", nx=True, ex=ttl_seconds)
        if taken:
            return 0
        return await self._remaining_ttl(redis_key, ttl_seconds)

    async def release_once(self, key: str) -> None:
        """Give a marker back before its TTL ends, so the caller may try again at once."""
        await self.redis.delete(f"once:{key}")

    async def once_ttl(self, key: str) -> int:
        """Seconds left on a marker taken with claim_once. 0 when nobody holds it."""
        ttl = await self.redis.ttl(f"once:{key}")
        return ttl if ttl and ttl > 0 else 0

    async def store_otp(self, phone: str, record: dict[str, Any], ttl_seconds: int) -> None:
        await self.redis.set(f"otp:{phone}", json.dumps(record), ex=ttl_seconds)

    async def update_otp(self, phone: str, record: dict[str, Any]) -> None:
        """Overwrite the record but keep the original expiry, so a wrong try cannot extend it."""
        await self.redis.set(f"otp:{phone}", json.dumps(record), keepttl=True)

    async def load_otp(self, phone: str) -> dict[str, Any] | None:
        raw = await self.redis.get(f"otp:{phone}")
        return json.loads(raw) if raw else None

    async def delete_otp(self, phone: str) -> None:
        await self.redis.delete(f"otp:{phone}")

    async def set_auth_session(self, token_hash: str, user_id: str, ttl_seconds: int) -> None:
        await self.redis.set(f"auth:session:{token_hash}", user_id, ex=ttl_seconds)

    async def get_auth_session(self, token_hash: str) -> str | None:
        return await self.redis.get(f"auth:session:{token_hash}")

    async def delete_auth_session(self, token_hash: str) -> None:
        await self.redis.delete(f"auth:session:{token_hash}")

    async def _remaining_ttl(self, redis_key: str, fallback_seconds: int) -> int:
        ttl = await self.redis.ttl(redis_key)
        # -1 means the key has no expiry and -2 means it disappeared between the two calls.
        return ttl if ttl and ttl > 0 else fallback_seconds
