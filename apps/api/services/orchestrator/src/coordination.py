import secrets
from contextlib import asynccontextmanager

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
    def __init__(self, url: str):
        self.redis = Redis.from_url(url, decode_responses=True)

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
