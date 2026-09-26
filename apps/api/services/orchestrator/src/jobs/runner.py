"""The in-process background job runner (ADR 0015, items 1 to 3).

`generation_jobs` in PostgreSQL is the only owner of job state. A runner claims one due job at a
time with a lease, runs its handler, and records the outcome. A job whose worker died is found by
its expired lease and claimed again, so a crash loses at most one attempt.
"""

import asyncio
import contextlib
import logging
import secrets
import socket
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import asyncpg

from ..config import Settings, get_settings
from ..database import Database, JobWrite
from ..errors import AppError
from ..media_probe import probe_avatar_mp4
from .retention import SWEEP_DEDUPE_KEY, SWEEP_INTERVAL, SWEEP_JOB_TYPE, SWEEP_MAX_ATTEMPTS

logger = logging.getLogger(__name__)

# How long an idle runner waits before it looks for a due job again.
POLL_SECONDS = 1.0

# A retryable failure waits 10 s, then 20 s, 40 s, and so on, never more than five minutes.
RETRY_BASE_SECONDS = 10
RETRY_MAX_SECONDS = 300

# `error_message` is a fixed text per `error_code`, never user text and never an exception string
# (ADR 0015). An admin reads it through GET /jobs/{job_id}.
ERROR_MESSAGES = {
    "worker_lost": "The worker running this job stopped before the job finished.",
    "egress_failure": "The recording file did not appear in time.",
    "egress_invalid_mp4": "The recording is not an MP4 with H.264 video and audio.",
    "invalid_status_transition": "The video asset is no longer a draft.",
    "not_found": "A record this job needs no longer exists.",
    "internal_error": "The job failed with an unexpected error.",
}
OTHER_ERROR_MESSAGE = "The job failed."


@dataclass(frozen=True)
class Reschedule:
    """A handler's answer for "not yet": the job runs again in `seconds`, and this run does not
    count as an attempt. The finalize job uses it while it waits for the MP4 file."""

    seconds: float


@dataclass
class JobContext:
    """What a handler gets besides its job row."""

    database: Database
    settings: Settings
    probe: Callable[[Path], Awaitable[dict[str, Any]]]
    writes: list[JobWrite] = field(default_factory=list)

    def on_done(self, write: JobWrite) -> None:
        """Run `write(conn)` in the transaction that marks the job done.

        The write and the job's result are kept together or not at all: a worker that crashed
        after the write cannot leave a job that runs again. If the write raises, nothing of it is
        kept and the job fails with that error.
        """
        self.writes.append(write)


# A handler gets its job row and the context, and answers with the job's output or a Reschedule.
Handler = Callable[[asyncpg.Record, JobContext], Awaitable[dict[str, Any] | Reschedule]]


def new_worker_id() -> str:
    """The host name plus a random id per boot, so two processes on one host differ too."""
    return f"{socket.gethostname()}-{secrets.token_hex(4)}"


def error_message(code: str) -> str:
    return ERROR_MESSAGES.get(code, OTHER_ERROR_MESSAGE)


def _log_fields(job: asyncpg.Record, code: str, attempt: int, will_retry: bool) -> dict[str, Any]:
    # Ids and counts only. Never the payload, the output, or an exception string.
    return {
        "job_id": str(job["id"]),
        "job_type": job["job_type"],
        "attempt": attempt,
        "max_attempts": job["max_attempts"],
        "error_code": code,
        "will_retry": will_retry,
    }


def log_job_failed(job: asyncpg.Record, code: str) -> None:
    """The `job_failed` event for a job that ended `failed` (ADR 0015, item 3)."""
    logger.error("job_failed", extra=_log_fields(job, code, job["attempt_count"], False))


def retry_delay_seconds(attempt: int) -> float:
    return min(RETRY_BASE_SECONDS * 2 ** (attempt - 1), RETRY_MAX_SECONDS)


class JobRunner:
    def __init__(
        self,
        database: Database,
        *,
        handlers: dict[str, Handler],
        worker_id: str,
        lease_seconds: float = 60,
        renew_seconds: float = 20,
        settings: Settings | None = None,
        probe: Callable[[Path], Awaitable[dict[str, Any]]] | None = None,
    ):
        self.database = database
        self.handlers = handlers
        self.worker_id = worker_id
        self.lease_seconds = lease_seconds
        self.renew_seconds = renew_seconds
        self.settings = settings if settings is not None else get_settings()
        self.probe = probe or probe_avatar_mp4
        self._stopping = asyncio.Event()
        self._loop_task: asyncio.Task[None] | None = None

    @property
    def is_running(self) -> bool:
        return self._loop_task is not None and not self._loop_task.done()

    async def start(self) -> None:
        """Enqueue the retention sweep unless one is queued or running, then run the loop."""
        await self.database.enqueue_job(
            SWEEP_JOB_TYPE, SWEEP_DEDUPE_KEY, {}, created_by=None, max_attempts=SWEEP_MAX_ATTEMPTS
        )
        if not self.is_running:
            self._stopping.clear()
            self._loop_task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        """Stop the loop. A handler that is running finishes first."""
        if self._loop_task is None:
            return
        self._stopping.set()
        await self._loop_task
        self._loop_task = None

    async def _loop(self) -> None:
        while not self._stopping.is_set():
            try:
                claimed = await self.run_once()
            except Exception:
                # Postgres is down or a write failed. No exception text: it can carry row data.
                logger.error("job_runner_failed")
                claimed = False
            if not claimed:
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._stopping.wait(), POLL_SECONDS)

    async def run_once(self) -> bool:
        """Claim at most one due job, run it, and record the outcome. True when a job was claimed."""
        job = await self.database.claim_job(
            list(self.handlers), worker_id=self.worker_id, lease_seconds=self.lease_seconds
        )
        if job is None:
            return False
        if job["claimed_from"] == "running":
            # The worker that held this job stopped renewing its lease: that attempt failed.
            if job["exhausted"]:
                await self._fail(job, "worker_lost")
                return True
            self._log_attempt_failed(job, "worker_lost", attempt=job["attempt_count"] - 1, will_retry=True)
        await self._run(job)
        return True

    async def _run(self, job: asyncpg.Record) -> None:
        ctx = JobContext(database=self.database, settings=self.settings, probe=self.probe)
        renewal = asyncio.create_task(self._renew(job))
        try:
            result: dict[str, Any] | Reschedule | Exception = await self.handlers[job["job_type"]](job, ctx)
        except Exception as exc:
            result = exc
        finally:
            # Stopped before the outcome is written, so a renewal never races the close.
            renewal.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await renewal

        if isinstance(result, Exception):
            await self._record_failure(job, result)
            return
        if isinstance(result, Reschedule):
            closed = await self.database.close_job(
                job, status="queued", delay_seconds=result.seconds, refund_attempt=True
            )
        else:
            try:
                closed = await self.database.close_job(
                    job, status="done", output=result, writes=[*ctx.writes, *self._follow_up(job)]
                )
            except Exception as exc:
                await self._record_failure(job, exc)
                return
        if closed is None:
            self._log_lease_lost(job)

    async def _renew(self, job: asyncpg.Record) -> None:
        """Extend the lease every `renew_seconds` until the claim is lost or the task is cancelled.

        An error never leaves this task, so it can never replace the handler's outcome. A failed
        renewal is tried again at the next tick: the lease outlives a few missed renewals, and if
        Postgres stays away the lease lapses and the fenced close refuses a late result anyway.
        """
        while True:
            await asyncio.sleep(self.renew_seconds)
            try:
                held = await self.database.renew_job_lease(job, self.lease_seconds)
            except Exception:
                # No exception text: it can carry row data.
                logger.warning(
                    "job_lease_renew_failed", extra={"job_id": str(job["id"]), "job_type": job["job_type"]}
                )
                continue
            if not held:
                self._log_lease_lost(job)
                return

    async def _record_failure(self, job: asyncpg.Record, exc: Exception) -> None:
        code = exc.code if isinstance(exc, AppError) else "internal_error"
        retryable = isinstance(exc, AppError) and exc.retryable
        if not retryable or job["attempt_count"] >= job["max_attempts"]:
            await self._fail(job, code)
            return
        closed = await self.database.close_job(
            job,
            status="queued",
            error_code=code,
            error_message=error_message(code),
            delay_seconds=retry_delay_seconds(job["attempt_count"]),
        )
        if closed is None:
            self._log_lease_lost(job)
            return
        self._log_attempt_failed(job, code, attempt=job["attempt_count"], will_retry=True)

    async def _fail(self, job: asyncpg.Record, code: str) -> None:
        closed = await self.database.close_job(
            job,
            status="failed",
            error_code=code,
            error_message=error_message(code),
            writes=self._follow_up(job),
        )
        if closed is None:
            self._log_lease_lost(job)
            return
        self._log_attempt_failed(job, code, attempt=job["attempt_count"], will_retry=False)
        log_job_failed(job, code)

    def _follow_up(self, job: asyncpg.Record) -> list[JobWrite]:
        """The writes that close a job of this type, whatever its outcome. The retention sweep
        enqueues its next run here, in the transaction that closes the current one."""
        if job["job_type"] != SWEEP_JOB_TYPE:
            return []

        async def enqueue_next_sweep(conn: asyncpg.Connection) -> None:
            await self.database.enqueue_job(
                SWEEP_JOB_TYPE,
                SWEEP_DEDUPE_KEY,
                {},
                created_by=None,
                max_attempts=SWEEP_MAX_ATTEMPTS,
                run_after=datetime.now(UTC) + SWEEP_INTERVAL,
                conn=conn,
            )

        return [enqueue_next_sweep]

    def _log_attempt_failed(self, job: asyncpg.Record, code: str, *, attempt: int, will_retry: bool) -> None:
        logger.warning("job_attempt_failed", extra=_log_fields(job, code, attempt, will_retry))

    @staticmethod
    def _log_lease_lost(job: asyncpg.Record) -> None:
        # Another claim took the job over. Its worker records the outcome.
        logger.warning("job_lease_lost", extra={"job_id": str(job["id"]), "job_type": job["job_type"]})

