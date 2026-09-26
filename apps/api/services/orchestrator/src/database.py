import json
import logging
from collections.abc import Awaitable, Callable, Iterable
from datetime import date, datetime
from pathlib import Path
from typing import Any
from uuid import UUID

import asyncpg

logger = logging.getLogger(__name__)

# How long an answer report waits for another report of the same session to commit. Past it,
# Postgres raises LockNotAvailableError, so waiting reports cannot hold every pool connection.
ANSWER_LOCK_TIMEOUT_SECONDS = 2

_USAGE_INSERT = """
    INSERT INTO provider_usage
      (provider,operation,provider_resource_id,model,characters,estimated_duration_ms,cache_hit,metadata)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
"""


# Move one asset to a review decision, only from an allowed status ($3), and return the status it
# had. The check is part of the UPDATE, so two reviews of the same asset cannot both pass it. The
# subquery locks the row before the update, so `previous_status` is the status this update
# replaced, even when another review committed while this one waited for the lock.
_REVIEW_UPDATES = {
    "audio": """
        UPDATE audio_assets AS asset SET status=$2, updated_at=now()
        FROM (SELECT id, status FROM audio_assets WHERE id=$1 FOR UPDATE) AS previous
        WHERE asset.id=$1 AND asset.id=previous.id AND asset.status = ANY($3::text[])
        RETURNING asset.*, previous.status AS previous_status
    """,
    "video": """
        UPDATE video_assets AS asset SET status=$2, updated_at=now()
        FROM (SELECT id, status FROM video_assets WHERE id=$1 FOR UPDATE) AS previous
        WHERE asset.id=$1 AND asset.id=previous.id AND asset.status = ANY($3::text[])
        RETURNING asset.*, previous.status AS previous_status
    """,
}

_REVIEW_INSERT = """
    INSERT INTO asset_reviews (asset_kind, asset_id, reviewer_user_id, decision, previous_status)
    VALUES ($1,$2,$3,$4,$5)
"""

# Background jobs (ADR 0015). The partial unique index of migration 005 allows one queued or
# running job per dedupe_key. A conflict inserts nothing, and the caller reads the existing job.
_JOB_INSERT = """
    INSERT INTO generation_jobs (job_type, dedupe_key, status, input, created_by, max_attempts, run_after)
    VALUES ($1, $2, 'queued', $3::jsonb, $4, $5, coalesce($6, now()))
    ON CONFLICT (dedupe_key) WHERE status IN ('queued', 'running') DO NOTHING
    RETURNING *
"""

_JOB_ACTIVE = "SELECT * FROM generation_jobs WHERE dedupe_key=$1 AND status IN ('queued', 'running')"

# Claim the next due job in one statement: a queued job whose run_after has come, or a running job
# whose lease ran out because its worker died. SKIP LOCKED makes a second worker take the next job
# instead of waiting for this one, so two workers never claim the same job.
#
# Every claim counts an attempt, except the reclaim of a job whose lost attempt was its last one:
# the runner fails that job with worker_lost and does not run it. `claimed_from` and `exhausted`
# tell the runner which case it has.
_JOB_CLAIM = """
    WITH next AS (
        SELECT id, status, attempt_count >= max_attempts AS exhausted
        FROM generation_jobs
        WHERE job_type = ANY($1::text[])
          AND (
            (status = 'queued' AND run_after <= now())
            OR (status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at < now()))
          )
        ORDER BY run_after, created_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    UPDATE generation_jobs AS job SET
        status = 'running',
        worker_id = $2,
        lease_expires_at = now() + make_interval(secs => $3),
        started_at = now(),
        attempt_count = CASE WHEN next.status = 'running' AND next.exhausted
                             THEN job.attempt_count ELSE job.attempt_count + 1 END,
        updated_at = now()
    FROM next
    WHERE job.id = next.id
    RETURNING job.*, next.status AS claimed_from, (next.status = 'running' AND next.exhausted) AS exhausted
"""

# Renew and close change a job only while the claim ($2 worker_id, $3 started_at) still holds it.
# A worker whose lease ran out, and whose job another claim took over, matches no row and changes
# nothing.
_JOB_RENEW = """
    UPDATE generation_jobs SET lease_expires_at = now() + make_interval(secs => $4), updated_at = now()
    WHERE id=$1 AND status='running' AND worker_id=$2 AND started_at=$3
    RETURNING id
"""

# One statement for every outcome of a run: done, failed, queued again for a retry, or queued again
# without counting the attempt (a handler that is waiting for something). The error and the output
# keep their old value when this outcome has none, so the row keeps the last error.
_JOB_CLOSE = """
    UPDATE generation_jobs SET
        status = $4,
        output = coalesce($5::jsonb, output),
        error_code = coalesce($6, error_code),
        error_message = coalesce($7, error_message),
        completed_at = CASE WHEN $4 IN ('done', 'failed') THEN now() END,
        run_after = CASE WHEN $4 = 'queued' THEN now() + make_interval(secs => $8) ELSE run_after END,
        attempt_count = attempt_count - $9,
        lease_expires_at = NULL,
        updated_at = now()
    WHERE id=$1 AND status='running' AND worker_id=$2 AND started_at=$3
    RETURNING *
"""

# A write that runs inside the transaction closing a job (see close_job).
JobWrite = Callable[[asyncpg.Connection], Awaitable[Any]]


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

    async def mark_video_generated(
        self,
        asset_id: UUID,
        duration_ms: int,
        probe: dict[str, Any],
        *,
        conn: asyncpg.Connection | None = None,
    ) -> bool:
        """Move a DRAFT video to VIDEO_GENERATED with its probe. False when the row is no longer a
        draft: the status check is part of the UPDATE, so a rejection that landed first wins."""
        row = await (conn or self._pool()).fetchrow(
            "UPDATE video_assets SET status='VIDEO_GENERATED',duration_ms=$2,metadata=$3::jsonb,"
            "updated_at=now() WHERE id=$1 AND status='DRAFT' RETURNING id",
            asset_id,
            duration_ms,
            json.dumps({"ffprobe": probe}),
        )
        return row is not None

    async def get_video_asset(self, asset_id: UUID) -> asyncpg.Record | None:
        return await self._pool().fetchrow("SELECT * FROM video_assets WHERE id=$1", asset_id)

    async def review_asset(
        self,
        kind: str,
        asset_id: UUID,
        *,
        decision: str,
        allowed_from: list[str],
        reviewer_user_id: UUID,
    ) -> asyncpg.Record | None:
        """Move an asset to a review decision and write its audit row, in one transaction.

        Returns the updated row plus `previous_status`, or None when no asset with this id is in
        one of the `allowed_from` statuses; then nothing is written. If the audit row cannot be
        written, the status change rolls back with it.
        """
        if kind not in _REVIEW_UPDATES:
            raise ValueError("invalid asset kind")
        async with self._pool().acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(_REVIEW_UPDATES[kind], asset_id, decision, allowed_from)
                if row is None:
                    return None
                await conn.execute(
                    _REVIEW_INSERT, kind, asset_id, reviewer_user_id, decision, row["previous_status"]
                )
                return row

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
        Raises asyncpg's LockNotAvailableError when the lock stays taken for longer than
        ANSWER_LOCK_TIMEOUT_SECONDS; the transaction then rolls back and the connection goes back.
        """
        async with self._pool().acquire() as conn:
            async with conn.transaction():
                # SET LOCAL ends with the transaction. Without it a waiting report would hold its
                # pool connection until command_timeout.
                await conn.execute(f"SET LOCAL lock_timeout = '{ANSWER_LOCK_TIMEOUT_SECONDS}s'")
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

    async def enqueue_job(
        self,
        job_type: str,
        dedupe_key: str,
        input: dict[str, Any],
        *,
        created_by: UUID | None,
        max_attempts: int,
        run_after: datetime | None = None,
        conn: asyncpg.Connection | None = None,
    ) -> asyncpg.Record:
        """Add a queued job, or return the queued or running job that already has `dedupe_key`.

        `input` references rows by id and carries no user text (ADR 0015). `run_after` None means
        now. `conn` runs the enqueue inside a transaction the caller holds.
        """
        job, _ = await self.enqueue_or_join_job(
            job_type,
            dedupe_key,
            input,
            created_by=created_by,
            max_attempts=max_attempts,
            run_after=run_after,
            conn=conn,
        )
        return job

    async def enqueue_or_join_job(
        self,
        job_type: str,
        dedupe_key: str,
        input: dict[str, Any],
        *,
        created_by: UUID | None,
        max_attempts: int,
        run_after: datetime | None = None,
        conn: asyncpg.Connection | None = None,
    ) -> tuple[asyncpg.Record, bool]:
        """Like enqueue_job, and also says whether this call created the job (True) or joined the
        queued or running job that already had `dedupe_key` (False)."""
        executor = conn or self._pool()
        # The existing job can finish between the refused insert and the read. Then the key is
        # free again and the next insert goes through, so a few rounds are always enough.
        for _ in range(3):
            row = await executor.fetchrow(
                _JOB_INSERT, job_type, dedupe_key, json.dumps(input), created_by, max_attempts, run_after
            )
            if row is not None:
                return row, True
            row = await executor.fetchrow(_JOB_ACTIVE, dedupe_key)
            if row is not None:
                return row, False
        raise RuntimeError("the job could not be enqueued")

    async def get_job(self, job_id: UUID) -> asyncpg.Record | None:
        return await self._pool().fetchrow("SELECT * FROM generation_jobs WHERE id=$1", job_id)

    async def make_job_due(self, job_id: UUID, *, input_update: dict[str, Any] | None = None) -> bool:
        """Set a queued job's run_after to now and merge `input_update` into its input. False when
        the job is no longer queued."""
        row = await self._pool().fetchrow(
            "UPDATE generation_jobs SET run_after=now(), input = input || $2::jsonb, updated_at=now() "
            "WHERE id=$1 AND status='queued' RETURNING id",
            job_id,
            json.dumps(input_update or {}),
        )
        return row is not None

    async def has_started_job(self, dedupe_key: str, *, other_than: UUID) -> bool:
        """Whether a job with `dedupe_key`, other than `other_than`, was ever claimed by a worker."""
        return await self._pool().fetchval(
            "SELECT EXISTS (SELECT 1 FROM generation_jobs "
            "WHERE dedupe_key=$1 AND id<>$2 AND started_at IS NOT NULL)",
            dedupe_key,
            other_than,
        )

    async def fail_queued_job(
        self, job_id: UUID, *, error_code: str, error_message: str
    ) -> asyncpg.Record | None:
        """Fail a job that no worker has claimed yet. None when a worker claimed it meanwhile."""
        return await self._pool().fetchrow(
            "UPDATE generation_jobs SET status='failed', error_code=$2, error_message=$3, "
            "completed_at=now(), updated_at=now() "
            "WHERE id=$1 AND status='queued' AND started_at IS NULL RETURNING *",
            job_id,
            error_code,
            error_message,
        )

    async def claim_job(
        self, job_types: list[str], *, worker_id: str, lease_seconds: float
    ) -> asyncpg.Record | None:
        """Claim the next due job of one of `job_types` for `worker_id`, or None when none is due.

        The row carries two more fields: `claimed_from` (`queued`, or `running` for a job whose
        worker died) and `exhausted` (that dead worker used the last attempt).
        """
        return await self._pool().fetchrow(_JOB_CLAIM, job_types, worker_id, lease_seconds)

    async def renew_job_lease(self, job: asyncpg.Record, lease_seconds: float) -> bool:
        """Extend the lease of a claim. False when the claim is no longer held."""
        row = await self._pool().fetchrow(
            _JOB_RENEW, job["id"], job["worker_id"], job["started_at"], lease_seconds
        )
        return row is not None

    async def close_job(
        self,
        job: asyncpg.Record,
        *,
        status: str,
        output: dict[str, Any] | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
        delay_seconds: float = 0,
        refund_attempt: bool = False,
        writes: Iterable[JobWrite] = (),
    ) -> asyncpg.Record | None:
        """Record the outcome of a claim, and run `writes` in the same transaction.

        Returns the updated row, or None when the claim is no longer held (its lease ran out and
        another claim took the job over). Then nothing is written. If a write raises, the
        transaction rolls back and the error reaches the caller.
        """
        async with self._pool().acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    _JOB_CLOSE,
                    job["id"],
                    job["worker_id"],
                    job["started_at"],
                    status,
                    None if output is None else json.dumps(output),
                    error_code,
                    error_message,
                    delay_seconds,
                    1 if refund_attempt else 0,
                )
                if row is None:
                    return None
                for write in writes:
                    await write(conn)
                return row

    async def delete_done_jobs(self, *, older_than_days: int) -> int:
        """Delete done jobs finished more than `older_than_days` ago. Failed jobs are never
        deleted (ADR 0015, item 5)."""
        result = await self._pool().execute(
            "DELETE FROM generation_jobs "
            "WHERE status='done' AND completed_at < now() - make_interval(days => $1)",
            older_than_days,
        )
        return int(result.split()[-1])
