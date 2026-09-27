"""The retention sweep (ADR 0015, item 5): a daily job that deletes data past its period.

It never deletes a failed job, a RENDER_FAILED video row, an audit row, or a draft or unpublished
recorded answer, so the failure and review history is kept.
"""

from datetime import timedelta
from typing import TYPE_CHECKING, Any

import asyncpg

from ..library.service import sweep_rejected_media, sweep_withdrawn_media

if TYPE_CHECKING:
    from .runner import JobContext

SWEEP_JOB_TYPE = "retention_sweep"
# One fixed key, so at most one sweep is queued or running at a time.
SWEEP_DEDUPE_KEY = "retention_sweep"
SWEEP_MAX_ATTEMPTS = 1
# The runner enqueues the next run this far ahead when it closes the current one.
SWEEP_INTERVAL = timedelta(days=1)
DONE_JOB_RETENTION_DAYS = 30


async def retention_sweep(job: asyncpg.Record, ctx: "JobContext") -> dict[str, Any]:
    """Run each step. Each kind of data it deletes is one count in the output.

    1. Done jobs older than 30 days (ADR 0015, item 2).
    2. The media of withdrawn library entries (REQ-016).
    3. Library videos REQ-069 rejected that no entry uses (REQ-072).

    A media file that cannot be deleted is skipped and counted in `skipped_media`: its rows stay,
    the other media are still deleted, the run ends done, and the next run tries that file again.
    """
    deleted_jobs = await ctx.database.delete_done_jobs(older_than_days=DONE_JOB_RETENTION_DAYS)
    withdrawn, withdrawn_skipped = await sweep_withdrawn_media(ctx.database)
    rejected, rejected_skipped = await sweep_rejected_media(ctx.database)
    return {
        "deleted_done_jobs": deleted_jobs,
        "deleted_withdrawn_media": withdrawn,
        "deleted_rejected_media": rejected,
        "skipped_media": withdrawn_skipped + rejected_skipped,
    }
