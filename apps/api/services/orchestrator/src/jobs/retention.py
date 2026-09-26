"""The retention sweep (ADR 0015, item 5): a daily job that deletes data past its period.

It never deletes a failed job, so the failure history is kept.
"""

from datetime import timedelta
from typing import TYPE_CHECKING, Any

import asyncpg

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
    """Delete done jobs older than 30 days. Each kind of data it deletes is one count in the output.

    The Option B code adds the deletion of withdrawn or replaced library media (ADR 0014) here, as
    one more step and one more count.
    """
    deleted_jobs = await ctx.database.delete_done_jobs(older_than_days=DONE_JOB_RETENTION_DAYS)
    return {"deleted_done_jobs": deleted_jobs}
