import json
import logging
from datetime import date
from pathlib import Path
from typing import Any
from uuid import UUID

import asyncpg

logger = logging.getLogger(__name__)

_USAGE_INSERT = """
    INSERT INTO provider_usage
      (provider,operation,provider_resource_id,model,characters,estimated_duration_ms,cache_hit,metadata)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
"""


def _usage_values(data: dict[str, Any]) -> tuple[Any, ...]:
    """The columns of one usage row. Keys that are not named here never reach the table."""
    return (
        data["provider"],
        data["operation"],
        data.get("provider_resource_id"),
        data.get("model"),
        data.get("characters"),
        data.get("estimated_duration_ms"),
        data.get("cache_hit", False),
        json.dumps(data.get("metadata", {})),
    )


def new_answers_that_fit(
    rows: list[dict[str, Any]],
    *,
    stored_indexes: set[int],
    stored_count: int,
    stored_duration_ms: int,
    max_count: int,
    max_duration_ms: int,
) -> list[dict[str, Any]] | None:
    """The answer rows of a report that are new, or None when they do not fit the session's caps.

    A row whose answer_index the session already holds, or that repeats an earlier row of the same
    report, is a re-sent answer and is dropped. A report of only such rows writes nothing, so it
    always fits. Shared with the test fake, so both decide the same way.
    """
    seen = set(stored_indexes)
    fresh = []
    for row in rows:
        index = row["metadata"]["answer_index"]
        if index not in seen:
            seen.add(index)
            fresh.append(row)
    count = stored_count + len(fresh)
    duration_ms = stored_duration_ms + sum(row["estimated_duration_ms"] for row in fresh)
    if fresh and (count > max_count or duration_ms > max_duration_ms):
        return None
    return fresh


class Database:
    def __init__(self, url: str, migrations_dir: Path):
        self.url = url
        self.migrations_dir = migrations_dir
        self.pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        self.pool = await asyncpg.create_pool(self.url, min_size=1, max_size=10, command_timeout=30)
        await self.migrate()

    async def close(self) -> None:
        if self.pool:
            await self.pool.close()
            self.pool = None

    def _pool(self) -> asyncpg.Pool:
        if self.pool is None:
            raise RuntimeError("database is not connected")
        return self.pool

    async def migrate(self) -> None:
        pool = self._pool()
        async with pool.acquire() as conn:
            await conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations "
                "(version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            )
            for migration in sorted(self.migrations_dir.glob("*.sql")):
                version = migration.stem
                exists = await conn.fetchval("SELECT 1 FROM schema_migrations WHERE version=$1", version)
                if exists:
                    continue
                async with conn.transaction():
                    await conn.execute(migration.read_text(encoding="utf-8"))
                    await conn.execute(
                        "INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING",
                        version,
                    )
                logger.info("database_migration_applied", extra={"version": version})

    async def ping(self) -> None:
        await self._pool().fetchval("SELECT 1")

    async def create_audio_asset(self, data: dict[str, Any]) -> asyncpg.Record:
        return await self._pool().fetchrow(
            """
            INSERT INTO audio_assets
              (cache_key,text,voice_id,model_id,language,settings,file_path,duration_ms,status)
            VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'AUDIO_GENERATED')
            ON CONFLICT (cache_key) DO UPDATE SET updated_at=now()
            RETURNING *
            """,
            data["cache_key"],
            data["text"],
            data["voice_id"],
            data["model_id"],
            data["language"],
            json.dumps(data["settings"]),
            data["file_path"],
            data["duration_ms"],
        )

    async def get_audio_asset(self, asset_id: UUID) -> asyncpg.Record | None:
        return await self._pool().fetchrow("SELECT * FROM audio_assets WHERE id=$1", asset_id)

    async def get_audio_by_cache_key(self, cache_key: str) -> asyncpg.Record | None:
        return await self._pool().fetchrow("SELECT * FROM audio_assets WHERE cache_key=$1", cache_key)

    async def create_session(self, data: dict[str, Any]) -> asyncpg.Record:
        return await self._pool().fetchrow(
            """
            INSERT INTO sessions
              (provider_session_id,avatar_id,room_name,mode,sandbox,status,metadata)
            VALUES ($1,$2,$3,'LITE',$4,'CONNECTED',$5::jsonb)
            RETURNING *
            """,
            data["provider_session_id"],
            data["avatar_id"],
            data["room_name"],
            data["sandbox"],
            json.dumps(data.get("metadata", {})),
        )

    async def create_assistant_session(self, data: dict[str, Any]) -> asyncpg.Record:
        """Store a FULL mode session. The browser drives it, so there is no connection of ours."""
        return await self._pool().fetchrow(
            """
            INSERT INTO sessions
              (provider_session_id,avatar_id,room_name,mode,sandbox,status,metadata,
               user_id,session_token_hash)
            VALUES ($1,$2,$3,'FULL',$4,'TOKEN_ISSUED',$5::jsonb,$6,$7)
            RETURNING *
            """,
            data["provider_session_id"],
            data["avatar_id"],
            data["room_name"],
            data["sandbox"],
            json.dumps(data.get("metadata", {})),
            data.get("user_id"),
            data["session_token_hash"],
        )

    async def get_session(self, session_id: UUID) -> asyncpg.Record | None:
        return await self._pool().fetchrow("SELECT * FROM sessions WHERE id=$1", session_id)

    async def close_session(self, session_id: UUID, status: str = "CLOSED") -> None:
        await self._pool().execute(
            """
            UPDATE sessions SET status=$2, ended_at=now(),
              duration_ms=(extract(epoch from (now()-started_at))*1000)::bigint
            WHERE id=$1
            """,
            session_id,
            status,
        )

    async def create_video_asset(self, data: dict[str, Any]) -> asyncpg.Record:
        return await self._pool().fetchrow(
            """
            INSERT INTO video_assets
              (external_id,text,audio_asset_id,avatar_id,voice_id,video_path,egress_id,status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT')
            ON CONFLICT (external_id) DO UPDATE SET updated_at=now()
            RETURNING *
            """,
            data["external_id"],
            data["text"],
            data.get("audio_asset_id"),
            data["avatar_id"],
            data["voice_id"],
            data["video_path"],
            data.get("egress_id"),
        )

    async def get_video_by_external_id(self, external_id: str) -> asyncpg.Record | None:
        return await self._pool().fetchrow("SELECT * FROM video_assets WHERE external_id=$1", external_id)

    async def mark_video_recording(self, asset_id: UUID, egress_id: str) -> asyncpg.Record:
        return await self._pool().fetchrow(
            "UPDATE video_assets SET egress_id=$2,updated_at=now() WHERE id=$1 RETURNING *",
            asset_id,
            egress_id,
        )

    async def complete_video_asset(
        self, asset_id: UUID, duration_ms: int, probe: dict[str, Any]
    ) -> asyncpg.Record:
        return await self._pool().fetchrow(
            "UPDATE video_assets SET status='VIDEO_GENERATED',duration_ms=$2,metadata=$3::jsonb,"
            "updated_at=now() WHERE id=$1 RETURNING *",
            asset_id,
            duration_ms,
            json.dumps({"ffprobe": probe}),
        )

    async def get_video_asset(self, asset_id: UUID) -> asyncpg.Record | None:
        return await self._pool().fetchrow("SELECT * FROM video_assets WHERE id=$1", asset_id)

    async def set_asset_status(self, table: str, asset_id: UUID, status: str) -> asyncpg.Record | None:
        queries = {
            "audio_assets": ("UPDATE audio_assets SET status=$2,updated_at=now() WHERE id=$1 RETURNING *"),
            "video_assets": ("UPDATE video_assets SET status=$2,updated_at=now() WHERE id=$1 RETURNING *"),
        }
        if table not in queries:
            raise ValueError("invalid asset table")
        return await self._pool().fetchrow(
            queries[table],
            asset_id,
            status,
        )

    async def get_user(self, user_id: UUID) -> asyncpg.Record | None:
        return await self._pool().fetchrow("SELECT * FROM users WHERE id=$1", user_id)

    async def get_user_by_phone(self, phone: str) -> asyncpg.Record | None:
        return await self._pool().fetchrow("SELECT * FROM users WHERE phone=$1", phone)

    async def create_user(self, phone: str, role: str) -> asyncpg.Record:
        """Create the user of a first successful login.

        Two parallel logins with the same phone can both reach this point, so the conflict clause
        returns the existing row instead of failing.
        """
        return await self._pool().fetchrow(
            """
            INSERT INTO users (phone, role) VALUES ($1,$2)
            ON CONFLICT (phone) DO UPDATE SET updated_at=now()
            RETURNING *
            """,
            phone,
            role,
        )

    async def set_user_role(self, user_id: UUID, role: str) -> asyncpg.Record | None:
        return await self._pool().fetchrow(
            "UPDATE users SET role=$2, updated_at=now() WHERE id=$1 RETURNING *",
            user_id,
            role,
        )

    async def set_user_status(self, user_id: UUID, status: str) -> asyncpg.Record | None:
        return await self._pool().fetchrow(
            "UPDATE users SET status=$2, updated_at=now() WHERE id=$1 RETURNING *",
            user_id,
            status,
        )

    async def update_user_profile(
        self, user_id: UUID, *, first_name: str, last_name: str, birth_date: date | None
    ) -> asyncpg.Record | None:
        """Full replace. `birth_date=None` clears the column, it does not leave it untouched."""
        return await self._pool().fetchrow(
            "UPDATE users SET first_name=$2, last_name=$3, birth_date=$4, updated_at=now() "
            "WHERE id=$1 RETURNING *",
            user_id,
            first_name,
            last_name,
            birth_date,
        )

    async def list_users(
        self, *, search: str | None, page: int, page_size: int
    ) -> tuple[list[asyncpg.Record], int]:
        # One pattern for every searchable column. ILIKE keeps the search case insensitive.
        pattern = f"%{search.strip()}%" if search and search.strip() else None
        offset = (page - 1) * page_size
        if pattern:
            total = await self._pool().fetchval(
                "SELECT count(*) FROM users WHERE phone ILIKE $1 OR first_name ILIKE $1 "
                "OR last_name ILIKE $1 OR email ILIKE $1",
                pattern,
            )
            rows = await self._pool().fetch(
                "SELECT * FROM users WHERE phone ILIKE $1 OR first_name ILIKE $1 "
                "OR last_name ILIKE $1 OR email ILIKE $1 "
                "ORDER BY created_at DESC, id LIMIT $2 OFFSET $3",
                pattern,
                page_size,
                offset,
            )
        else:
            total = await self._pool().fetchval("SELECT count(*) FROM users")
            rows = await self._pool().fetch(
                "SELECT * FROM users ORDER BY created_at DESC, id LIMIT $1 OFFSET $2",
                page_size,
                offset,
            )
        return list(rows), int(total or 0)

    async def user_counts(self) -> dict[str, int]:
        row = await self._pool().fetchrow(
            """
            SELECT count(*) AS total_users,
              count(*) FILTER (WHERE status='active') AS active_users,
              count(*) FILTER (WHERE status='disabled') AS disabled_users,
              count(*) FILTER (WHERE created_at >= now() - interval '7 days') AS new_users_this_week
            FROM users
            """
        )
        return {key: int(value) for key, value in dict(row).items()}

    async def record_usage(self, data: dict[str, Any]) -> None:
        await self._pool().execute(_USAGE_INSERT, *_usage_values(data))

    async def record_assistant_answers(
        self,
        provider_resource_id: str,
        rows: list[dict[str, Any]],
        *,
        max_count: int,
        max_duration_ms: int,
    ) -> int | None:
        """Write the answer rows of one assistant session that are new and still fit its caps.

        Everything runs in one transaction under an advisory lock on the session, so two
        concurrent reports cannot both read the old totals and both pass the caps. Returns how
        many rows were written, or None when the new rows do not fit; then nothing is written.
        """
        async with self._pool().acquire() as conn:
            async with conn.transaction():
                # Held until the transaction ends. A second report for the same session waits here.
                await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", provider_resource_id)
                totals = await conn.fetchrow(
                    """
                    SELECT count(*) AS count,
                      coalesce(sum(estimated_duration_ms),0)::bigint AS duration_ms,
                      coalesce(
                        array_agg((metadata->>'answer_index')::int)
                          FILTER (WHERE metadata ? 'answer_index'),
                        '{}'::int[]
                      ) AS indexes
                    FROM provider_usage
                    WHERE provider='liveavatar' AND operation='assistant_answer'
                      AND provider_resource_id=$1
                    """,
                    provider_resource_id,
                )
                fresh = new_answers_that_fit(
                    rows,
                    stored_indexes=set(totals["indexes"]),
                    stored_count=int(totals["count"]),
                    stored_duration_ms=int(totals["duration_ms"]),
                    max_count=max_count,
                    max_duration_ms=max_duration_ms,
                )
                if fresh is None:
                    return None
                if fresh:
                    await conn.executemany(_USAGE_INSERT, [_usage_values(row) for row in fresh])
                return len(fresh)

    async def usage_summary(self) -> list[dict[str, Any]]:
        rows = await self._pool().fetch(
            """
            SELECT provider,operation,count(*) AS calls,
              coalesce(sum(characters),0)::bigint AS characters,
              coalesce(sum(estimated_duration_ms),0)::bigint AS duration_ms,
              count(*) FILTER (WHERE cache_hit) AS cache_hits
            FROM provider_usage GROUP BY provider,operation ORDER BY provider,operation
            """
        )
        return [dict(row) for row in rows]
