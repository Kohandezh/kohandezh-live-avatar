"""The finalize_video job (ADR 0015, item 4).

POST /assets/video/{id}/finalize calls start_finalize: it enqueues this job and stops Egress. The
job waits for the MP4 without sleeping: while the file is missing it answers Reschedule, which
frees the runner and does not count an attempt. Once the file is there it probes it and marks the
row VIDEO_GENERATED.
"""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

import asyncpg

from ..database import Database
from ..errors import AppError, NotFoundError
from ..livekit_gateway import LiveKitGateway
from .runner import JobContext, Reschedule, error_message, log_job_failed

FINALIZE_JOB_TYPE = "finalize_video"
FINALIZE_MAX_ATTEMPTS = 3
# How often the job looks for the file again while it waits.
FILE_CHECK_SECONDS = 2.0
# A new job is not due until its Egress has stopped. This is only the fallback for a process that
# dies during the stop: longer than LiveKit's 60 s request timeout, so a slow stop still finishes
# first. That job then runs, finds its wait long over, and fails, which frees the asset for a new
# finalize.
STOP_GRACE = timedelta(seconds=120)


def finalize_dedupe_key(asset_id: UUID) -> str:
    return f"{FINALIZE_JOB_TYPE}:{asset_id}"


async def start_finalize(
    database: Database, livekit: LiveKitGateway, *, asset_id: UUID, egress_id: str, created_by: UUID
) -> asyncpg.Record:
    """Enqueue the finalize job of a video and stop its Egress. Returns the job.

    The job row is the lock: the dedupe index lets one call create it, and every other call while
    it is queued or running joins it and returns at once, so Egress is stopped once. No database
    connection is held during the LiveKit call.
    """
    dedupe_key = finalize_dedupe_key(asset_id)
    job, created = await database.enqueue_or_join_job(
        FINALIZE_JOB_TYPE,
        dedupe_key,
        {"asset_id": str(asset_id)},
        created_by=created_by,
        max_attempts=FINALIZE_MAX_ATTEMPTS,
        run_after=datetime.now(UTC) + STOP_GRACE,
    )
    if not created:
        return job
    try:
        await livekit.stop_egress(egress_id)
    except Exception as exc:
        # LiveKit refuses to stop an Egress that already ended. When an earlier finalize job of
        # this asset ran, its own stop had succeeded, so the refusal means "stopped": the late MP4
        # can still be finalized. ADR 0015, item 3 counts a failed stop the same way.
        stopped_before = isinstance(exc, AppError) and await database.has_started_job(
            dedupe_key, other_than=job["id"]
        )
        if not stopped_before:
            # Egress may still run, so the job must not wait for a file. It never ran: no attempt.
            failed = await database.fail_queued_job(
                job["id"], error_code="egress_failure", error_message=error_message("egress_failure")
            )
            if failed is not None:
                log_job_failed(failed, "egress_failure")
            raise
    # The wait for the MP4 starts now that Egress has stopped, so a slow stop does not use it up.
    await database.make_job_due(job["id"], input_update={"file_wait_from": datetime.now(UTC).isoformat()})
    return job


def _has_content(path: Path) -> bool:
    return path.is_file() and path.stat().st_size > 0


def _file_wait_started(job: asyncpg.Record, job_input: dict[str, Any]) -> datetime:
    """When the wait for the MP4 began: when start_finalize made the job due, after the stop. A job
    never made due (its process died during the stop) counts from enqueue, so once its grace is
    over it fails at once and frees the asset for a new finalize."""
    started = job_input.get("file_wait_from")
    return datetime.fromisoformat(started) if started else job["created_at"]


def _not_a_draft() -> AppError:
    return AppError("invalid_status_transition", "the video asset is no longer a draft", 409, False)


async def finalize_video(job: asyncpg.Record, ctx: JobContext) -> dict[str, Any] | Reschedule:
    job_input = json.loads(job["input"])
    asset_id = UUID(job_input["asset_id"])
    row = await ctx.database.get_video_asset(asset_id)
    if row is None:
        raise NotFoundError("video asset")
    # A reviewer may reject the draft while the job waits. Waiting on would change nothing.
    if row["status"] != "DRAFT":
        raise _not_a_draft()

    path = Path(row["video_path"])
    if not _has_content(path):
        waited = (datetime.now(UTC) - _file_wait_started(job, job_input)).total_seconds()
        remaining = ctx.settings.finalize_file_wait_seconds - waited
        if remaining > 0:
            return Reschedule(min(FILE_CHECK_SECONDS, remaining))
        # Final: Egress had the whole wait to write the file.
        raise AppError("egress_failure", "the MP4 did not appear in the media cache", 502, False)

    probe = await ctx.probe(path)

    async def mark_generated(conn: asyncpg.Connection) -> None:
        if not await ctx.database.mark_video_generated(asset_id, probe["duration_ms"], probe, conn=conn):
            raise _not_a_draft()

    ctx.on_done(mark_generated)
    return {
        "id": str(asset_id),
        "status": "VIDEO_GENERATED",
        "media_url": f"/api/assets/video/{asset_id}",
        "probe": probe,
    }
