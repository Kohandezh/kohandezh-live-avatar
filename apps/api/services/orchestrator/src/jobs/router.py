import json
from uuid import UUID

from fastapi import APIRouter, Depends, Request

from ..auth.dependencies import UserRow, get_current_user
from ..errors import NotFoundError

router = APIRouter(tags=["jobs"])


def _may_read(user: UserRow, job) -> bool:
    """The user who asked for the job, or an admin. A system job (no created_by) is admin only."""
    return user["role"] == "admin" or (job["created_by"] is not None and job["created_by"] == user["id"])


@router.get("/jobs/{job_id}")
async def get_job(job_id: UUID, request: Request, user: UserRow = Depends(get_current_user)) -> dict:
    """The poll for a long operation (docs/API.md, conventions)."""
    job = await request.app.state.database.get_job(job_id)
    # Someone else's job answers exactly like an unknown id, so a job id reveals nothing.
    if job is None or not _may_read(user, job):
        raise NotFoundError("job")
    body: dict = {"status": job["status"]}
    if job["status"] == "done":
        body["result"] = json.loads(job["output"])
    elif job["status"] == "failed":
        body["error"] = {"code": job["error_code"], "message": job["error_message"]}
    return body
