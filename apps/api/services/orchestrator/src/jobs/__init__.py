"""Background jobs (ADR 0015): the runner, its handlers, and GET /jobs/{job_id}."""

from .retention import SWEEP_JOB_TYPE, retention_sweep
from .runner import JobContext, JobRunner, Reschedule, new_worker_id

# Handler names equal job types. The app builds its runner with this dict.
HANDLERS = {
    SWEEP_JOB_TYPE: retention_sweep,
}

__all__ = ["HANDLERS", "JobContext", "JobRunner", "Reschedule", "new_worker_id"]
