"""POST /assets/video/{id}/finalize as a background job (ADR 0015, item 4), against a real
PostgreSQL. The endpoint stops Egress and answers 202 with a job id. The finalize_video job waits
for the MP4, probes it, and marks the row VIDEO_GENERATED.

Needs ORCHESTRATOR_TEST_DATABASE_URL, a disposable database, like test_jobs_postgres.py. The probe
is a fake here, so ffprobe is not needed.
"""

import asyncio
import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from services.orchestrator.src.database import Database
from services.orchestrator.src.errors import ProviderError
from services.orchestrator.src.jobs import HANDLERS, JobRunner
from services.orchestrator.src.main import app

from .conftest import ADMIN_PHONE, build_settings

DATABASE_URL = os.environ.get("ORCHESTRATOR_TEST_DATABASE_URL")
MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"

pytestmark = pytest.mark.skipif(
    not DATABASE_URL, reason="needs ORCHESTRATOR_TEST_DATABASE_URL, a disposable PostgreSQL"
)

PROBE = {
    "container": "mov,mp4,m4a,3gp,3g2,mj2",
    "video_codec": "h264",
    "audio_codec": "aac",
    "duration_ms": 4200,
    "width": 1280,
    "height": 720,
    "frame_rate": "25/1",
}


@pytest.fixture
async def database():
    db = Database(DATABASE_URL, MIGRATIONS)
    await db.connect()
    await db.pool.execute("DELETE FROM generation_jobs")
    try:
        yield db
    finally:
        await db.close()


@pytest.fixture
async def admin_api(api, database):
    app.state.database = database
    await api.login(ADMIN_PHONE)
    return api


async def fake_probe(path: Path) -> dict:
    return dict(PROBE)


def _runner(db: Database, *, wait_seconds: float = 30, probe=fake_probe) -> JobRunner:
    return JobRunner(
        db,
        handlers=HANDLERS,
        worker_id=f"test-{uuid4().hex[:8]}",
        settings=build_settings(finalize_file_wait_seconds=wait_seconds),
        probe=probe,
    )


async def _video(
    db: Database, tmp_path: Path, *, status: str = "DRAFT", egress_id: str | None = "EG_1"
) -> UUID:
    external_id = f"clip-{uuid4().hex}"
    row = await db.create_video_asset(
        {
            "external_id": external_id,
            "text": "متن یک پاسخ",
            "avatar_id": "avatar",
            "voice_id": "voice",
            "video_path": str(tmp_path / f"{external_id}.mp4"),
        }
    )
    if egress_id:
        await db.mark_video_recording(row["id"], egress_id)
    await db.pool.execute("UPDATE video_assets SET status=$2 WHERE id=$1", row["id"], status)
    return row["id"]


async def _write_mp4(db: Database, asset_id: UUID, content: bytes = b"mp4-bytes") -> None:
    row = await db.get_video_asset(asset_id)
    Path(row["video_path"]).write_bytes(content)


async def _job(db: Database, job_id: str | UUID):
    return await db.pool.fetchrow("SELECT * FROM generation_jobs WHERE id=$1", UUID(str(job_id)))


async def _status(db: Database, asset_id: UUID) -> str:
    return (await db.get_video_asset(asset_id))["status"]


async def _make_due(db: Database, job_id: UUID) -> None:
    await db.pool.execute("UPDATE generation_jobs SET run_after = now() WHERE id=$1", job_id)


async def _enqueue_finalize(db: Database, asset_id: UUID):
    return await db.enqueue_job(
        "finalize_video",
        f"finalize_video:{asset_id}",
        {"asset_id": str(asset_id)},
        created_by=None,
        max_attempts=3,
    )


def _stops(api) -> list:
    return [call for call in api.livekit.calls if call[0] == "stop_egress"]


# The endpoint (B-1)


async def test_finalize_stops_egress_and_answers_202_with_a_job(admin_api, database, tmp_path):
    asset_id = await _video(database, tmp_path)
    admin = await database.get_user_by_phone(ADMIN_PHONE)

    before = datetime.now(UTC)
    response = await admin_api.client.post(f"/assets/video/{asset_id}/finalize")
    after = datetime.now(UTC)

    assert response.status_code == 202
    assert set(response.json()) == {"jobId"}
    job = await _job(database, response.json()["jobId"])
    assert job["job_type"] == "finalize_video"
    assert job["status"] == "queued"
    assert job["dedupe_key"] == f"finalize_video:{asset_id}"
    assert job["created_by"] == admin["id"]
    assert job["max_attempts"] == 3
    job_input = json.loads(job["input"])
    assert set(job_input) == {"asset_id", "file_wait_from"}
    assert job_input["asset_id"] == str(asset_id)
    assert before <= datetime.fromisoformat(job_input["file_wait_from"]) <= after
    assert _stops(admin_api) == [("stop_egress", "EG_1")]
    assert await _status(database, asset_id) == "DRAFT"


async def test_a_repeated_finalize_returns_the_same_job_and_stops_egress_once(admin_api, database, tmp_path):
    asset_id = await _video(database, tmp_path)

    first = await admin_api.client.post(f"/assets/video/{asset_id}/finalize")
    second = await admin_api.client.post(f"/assets/video/{asset_id}/finalize")

    assert (first.status_code, second.status_code) == (202, 202)
    assert first.json()["jobId"] == second.json()["jobId"]
    assert len(_stops(admin_api)) == 1


async def test_two_finalize_calls_at_once_share_one_job_and_one_egress_stop(admin_api, database, tmp_path):
    connections = [await database.pool.acquire() for _ in range(10)]
    for connection in connections:
        await database.pool.release(connection)
    assets = [await _video(database, tmp_path, egress_id=f"EG_{index}") for index in range(3)]

    responses = await asyncio.gather(
        *[
            admin_api.client.post(f"/assets/video/{asset_id}/finalize")
            for asset_id in assets
            for _ in range(2)
        ]
    )

    assert [response.status_code for response in responses] == [202] * 6
    for index in range(3):
        pair = responses[2 * index : 2 * index + 2]
        assert pair[0].json()["jobId"] == pair[1].json()["jobId"]
    assert sorted(_stops(admin_api)) == [("stop_egress", f"EG_{index}") for index in range(3)]


async def _until(condition, *, seconds: float = 5) -> None:
    """Wait until `condition()` holds. Fails the test instead of hanging when it never does."""
    for _ in range(int(seconds * 100)):
        if condition():
            return
        await asyncio.sleep(0.01)
    raise AssertionError(f"the condition did not hold within {seconds} s")


async def _cancel(tasks: list[asyncio.Task]) -> None:
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


async def test_finalize_calls_beyond_the_pool_size_all_answer_and_leave_the_api_responsive(
    admin_api, database, tmp_path
):
    """No database connection is held while LiveKit stops Egress. More finalize calls than the
    pool has connections, all waiting on LiveKit at once, must not starve other requests."""
    size = database.pool.get_max_size() + 2
    assets = [await _video(database, tmp_path, egress_id=f"EG_{index}") for index in range(size)]
    admin_api.livekit.stop_gate = asyncio.Event()

    calls = [
        asyncio.create_task(admin_api.client.post(f"/assets/video/{asset_id}/finalize"))
        for asset_id in assets
    ]
    try:
        await _until(lambda: len(_stops(admin_api)) == size)
        me = await asyncio.wait_for(admin_api.client.get("/me"), timeout=5)
        admin_api.livekit.stop_gate.set()
        responses = await asyncio.wait_for(asyncio.gather(*calls), timeout=10)
    finally:
        # A stuck call holds pool connections, and the fixture could not close the pool.
        await _cancel(calls)

    assert me.status_code == 200
    assert [response.status_code for response in responses] == [202] * size
    assert len({response.json()["jobId"] for response in responses}) == size


async def test_the_job_is_not_due_before_egress_has_stopped(admin_api, database, tmp_path):
    asset_id = await _video(database, tmp_path)
    await _write_mp4(database, asset_id)
    admin_api.livekit.stop_gate = asyncio.Event()
    runner = _runner(database)

    call = asyncio.create_task(admin_api.client.post(f"/assets/video/{asset_id}/finalize"))
    try:
        await _until(lambda: len(_stops(admin_api)) == 1)
        claimed_while_stopping = await runner.run_once()
        admin_api.livekit.stop_gate.set()
        response = await asyncio.wait_for(call, timeout=5)
    finally:
        await _cancel([call])

    assert claimed_while_stopping is False
    assert response.status_code == 202
    assert await runner.run_once() is True
    assert (await _job(database, response.json()["jobId"]))["status"] == "done"


async def test_a_second_call_during_the_stop_joins_the_same_job(admin_api, database, tmp_path):
    asset_id = await _video(database, tmp_path)
    admin_api.livekit.stop_gate = asyncio.Event()

    call = asyncio.create_task(admin_api.client.post(f"/assets/video/{asset_id}/finalize"))
    try:
        await _until(lambda: len(_stops(admin_api)) == 1)
        second = await asyncio.wait_for(admin_api.client.post(f"/assets/video/{asset_id}/finalize"), 5)
        admin_api.livekit.stop_gate.set()
        first = await asyncio.wait_for(call, timeout=5)
    finally:
        await _cancel([call])

    assert (first.status_code, second.status_code) == (202, 202)
    assert first.json()["jobId"] == second.json()["jobId"]
    assert len(_stops(admin_api)) == 1


async def test_a_refused_first_stop_answers_502_and_fails_its_job(admin_api, database, tmp_path, caplog):
    asset_id = await _video(database, tmp_path)
    admin_api.livekit.stop_error = ProviderError(
        "egress_failure", "LiveKit Egress could not finalize the MP4 recording", 502, True
    )

    refused = await admin_api.client.post(f"/assets/video/{asset_id}/finalize")

    assert refused.status_code == 502
    assert refused.json()["error"]["code"] == "egress_failure"
    [job] = await database.pool.fetch("SELECT * FROM generation_jobs")
    assert (job["status"], job["error_code"], job["attempt_count"]) == ("failed", "egress_failure", 0)
    assert job["started_at"] is None
    [failed] = [record for record in caplog.records if record.getMessage() == "job_failed"]
    assert (failed.job_id, failed.attempt, failed.error_code) == (str(job["id"]), 0, "egress_failure")

    admin_api.livekit.stop_error = None
    retried = await admin_api.client.post(f"/assets/video/{asset_id}/finalize")

    assert retried.status_code == 202
    assert retried.json()["jobId"] != str(job["id"])
    assert len(_stops(admin_api)) == 2


async def test_finalize_after_a_failed_job_starts_a_new_one(admin_api, database, tmp_path):
    asset_id = await _video(database, tmp_path)
    first = (await admin_api.client.post(f"/assets/video/{asset_id}/finalize")).json()["jobId"]
    await _runner(database, wait_seconds=0).run_once()
    assert (await _job(database, first))["status"] == "failed"

    second = await admin_api.client.post(f"/assets/video/{asset_id}/finalize")

    assert second.status_code == 202
    assert second.json()["jobId"] != first


async def test_after_a_failed_job_a_refused_stop_counts_as_stopped(admin_api, database, tmp_path):
    """The first finalize ended the Egress, and its job failed because the MP4 came late. LiveKit
    refuses to stop that Egress again, so a new finalize must still start a job for the late file."""
    admin_api.livekit.refuse_repeated_stop = True
    asset_id = await _video(database, tmp_path)
    first = (await admin_api.client.post(f"/assets/video/{asset_id}/finalize")).json()["jobId"]
    await _runner(database, wait_seconds=0).run_once()
    assert (await _job(database, first))["status"] == "failed"
    await _write_mp4(database, asset_id)

    second = await admin_api.client.post(f"/assets/video/{asset_id}/finalize")

    assert second.status_code == 202
    assert second.json()["jobId"] != first
    assert _stops(admin_api) == [("stop_egress", "EG_1"), ("stop_egress", "EG_1")]
    assert await _runner(database).run_once() is True
    assert (await _job(database, second.json()["jobId"]))["status"] == "done"
    assert await _status(database, asset_id) == "VIDEO_GENERATED"


async def test_a_refused_stop_still_fails_when_no_earlier_job_ran(admin_api, database, tmp_path):
    """A job that failed at its own stop never ran, so it proves nothing about the Egress."""
    asset_id = await _video(database, tmp_path)
    admin_api.livekit.stop_error = ProviderError(
        "egress_failure", "LiveKit Egress could not finalize the MP4 recording", 502, True
    )

    first = await admin_api.client.post(f"/assets/video/{asset_id}/finalize")
    second = await admin_api.client.post(f"/assets/video/{asset_id}/finalize")

    assert (first.status_code, second.status_code) == (502, 502)
    statuses = await database.pool.fetch("SELECT status, started_at FROM generation_jobs")
    assert [(row["status"], row["started_at"]) for row in statuses] == [("failed", None)] * 2


async def test_finalize_of_an_unknown_asset_is_404(admin_api, database):
    response = await admin_api.client.post(f"/assets/video/{uuid4()}/finalize")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert _stops(admin_api) == []


async def test_finalize_without_an_egress_is_409(admin_api, database, tmp_path):
    asset_id = await _video(database, tmp_path, egress_id=None)

    response = await admin_api.client.post(f"/assets/video/{asset_id}/finalize")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "egress_failure"
    assert _stops(admin_api) == []
    assert await database.pool.fetchval("SELECT count(*) FROM generation_jobs") == 0


@pytest.mark.parametrize("status", ["REJECTED", "VIDEO_GENERATED", "VIDEO_APPROVED"])
async def test_finalize_of_a_video_that_is_not_a_draft_is_409(admin_api, database, tmp_path, status):
    asset_id = await _video(database, tmp_path, status=status)

    response = await admin_api.client.post(f"/assets/video/{asset_id}/finalize")

    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "invalid_status_transition"
    assert error["details"] == {"currentStatus": status}
    assert _stops(admin_api) == []
    assert await database.pool.fetchval("SELECT count(*) FROM generation_jobs") == 0
    assert await _status(database, asset_id) == status


async def test_finalize_is_closed_to_a_normal_user_and_to_no_session(api, database, tmp_path):
    app.state.database = database
    asset_id = await _video(database, tmp_path)

    anonymous = await api.client.post(f"/assets/video/{asset_id}/finalize")
    await api.login("09123456789")
    user = await api.client.post(f"/assets/video/{asset_id}/finalize")

    assert anonymous.status_code == 401
    assert user.status_code == 403
    assert _stops(api) == []
    assert await database.pool.fetchval("SELECT count(*) FROM generation_jobs") == 0


# The finalize_video job (B-2, B-3)


async def test_the_job_marks_the_video_generated_when_the_file_is_there(database, tmp_path):
    asset_id = await _video(database, tmp_path)
    await _write_mp4(database, asset_id)
    job = await _enqueue_finalize(database, asset_id)

    await _runner(database).run_once()

    row = await _job(database, job["id"])
    assert row["status"] == "done"
    assert row["attempt_count"] == 1
    assert json.loads(row["output"]) == {
        "id": str(asset_id),
        "status": "VIDEO_GENERATED",
        "media_url": f"/api/assets/video/{asset_id}",
        "probe": PROBE,
    }
    video = await database.get_video_asset(asset_id)
    assert video["status"] == "VIDEO_GENERATED"
    assert video["duration_ms"] == 4200
    assert json.loads(video["metadata"]) == {"ffprobe": PROBE}


async def test_the_job_waits_for_a_late_file_without_counting_attempts(database, tmp_path):
    asset_id = await _video(database, tmp_path)
    job = await _enqueue_finalize(database, asset_id)
    runner = _runner(database)

    before = datetime.now(UTC)
    await runner.run_once()
    waiting = await _job(database, job["id"])
    assert waiting["status"] == "queued"
    assert waiting["attempt_count"] == 0
    assert before + timedelta(seconds=1) < waiting["run_after"] < before + timedelta(seconds=4)

    await _write_mp4(database, asset_id, b"")
    await _make_due(database, job["id"])
    await runner.run_once()
    assert (await _job(database, job["id"]))["status"] == "queued"

    await _write_mp4(database, asset_id)
    await _make_due(database, job["id"])
    await runner.run_once()

    row = await _job(database, job["id"])
    assert row["status"] == "done"
    assert row["attempt_count"] == 1
    assert await _status(database, asset_id) == "VIDEO_GENERATED"


async def test_a_file_that_never_appears_fails_the_job_after_the_wait(database, tmp_path, caplog):
    asset_id = await _video(database, tmp_path)
    job = await _enqueue_finalize(database, asset_id)
    runner = _runner(database, wait_seconds=0.3)

    await runner.run_once()
    assert (await _job(database, job["id"]))["status"] == "queued"
    await asyncio.sleep(0.4)
    await runner.run_once()

    row = await _job(database, job["id"])
    assert row["status"] == "failed"
    assert row["error_code"] == "egress_failure"
    assert row["attempt_count"] == 1
    assert await _status(database, asset_id) == "DRAFT"
    assert await runner.run_once() is False
    failed = [record for record in caplog.records if record.getMessage() == "job_failed"]
    assert [(record.error_code, record.will_retry) for record in failed] == [("egress_failure", False)]


async def test_the_wait_comes_from_the_setting(database, tmp_path):
    asset_id = await _video(database, tmp_path)
    job = await _enqueue_finalize(database, asset_id)

    await _runner(database, wait_seconds=30).run_once()
    assert (await _job(database, job["id"]))["status"] == "queued"

    await _make_due(database, job["id"])
    await _runner(database, wait_seconds=0).run_once()
    assert (await _job(database, job["id"]))["status"] == "failed"


async def test_a_slow_egress_stop_does_not_use_up_the_file_wait(admin_api, database, tmp_path):
    """The wait for the MP4 starts when Egress has stopped and the job is due, not when the job
    row was created before the stop."""
    asset_id = await _video(database, tmp_path)
    admin_api.livekit.stop_gate = asyncio.Event()
    runner = _runner(database, wait_seconds=0.5)

    call = asyncio.create_task(admin_api.client.post(f"/assets/video/{asset_id}/finalize"))
    try:
        await _until(lambda: len(_stops(admin_api)) == 1)
        await asyncio.sleep(0.8)  # the stop takes longer than the whole wait
        admin_api.livekit.stop_gate.set()
        response = await asyncio.wait_for(call, timeout=5)
    finally:
        await _cancel([call])
    job_id = response.json()["jobId"]

    await runner.run_once()
    waiting = await _job(database, job_id)
    assert (waiting["status"], waiting["attempt_count"]) == ("queued", 0)

    await asyncio.sleep(0.6)
    await _make_due(database, UUID(job_id))
    await runner.run_once()
    row = await _job(database, job_id)
    assert (row["status"], row["error_code"]) == ("failed", "egress_failure")


async def test_a_job_that_was_never_made_due_counts_its_wait_from_enqueue(database, tmp_path):
    """A process that died during the stop never made its job due. After the grace that job runs,
    finds its wait long over, and fails, which frees the asset for a new finalize."""
    asset_id = await _video(database, tmp_path)
    job = await _enqueue_finalize(database, asset_id)
    await database.pool.execute(
        "UPDATE generation_jobs SET created_at = now() - interval '200 seconds' WHERE id=$1", job["id"]
    )

    await _runner(database, wait_seconds=30).run_once()

    row = await _job(database, job["id"])
    assert (row["status"], row["error_code"]) == ("failed", "egress_failure")


async def test_a_probe_failure_fails_the_job_and_keeps_the_draft(database, tmp_path):
    asset_id = await _video(database, tmp_path)
    await _write_mp4(database, asset_id)
    job = await _enqueue_finalize(database, asset_id)

    async def bad_probe(path: Path) -> dict:
        raise ProviderError("egress_invalid_mp4", "ffprobe could not read it", 502, False)

    await _runner(database, probe=bad_probe).run_once()

    row = await _job(database, job["id"])
    assert (row["status"], row["error_code"], row["attempt_count"]) == ("failed", "egress_invalid_mp4", 1)
    assert await _status(database, asset_id) == "DRAFT"


async def test_a_video_rejected_while_the_job_waits_fails_the_job(database, tmp_path):
    asset_id = await _video(database, tmp_path)
    job = await _enqueue_finalize(database, asset_id)
    runner = _runner(database)
    await runner.run_once()

    await database.pool.execute("UPDATE video_assets SET status='REJECTED' WHERE id=$1", asset_id)
    await _write_mp4(database, asset_id)
    await _make_due(database, job["id"])
    await runner.run_once()

    row = await _job(database, job["id"])
    assert (row["status"], row["error_code"]) == ("failed", "invalid_status_transition")
    assert await _status(database, asset_id) == "REJECTED"


async def test_a_video_rejected_while_the_file_is_missing_fails_without_waiting(database, tmp_path):
    asset_id = await _video(database, tmp_path)
    job = await _enqueue_finalize(database, asset_id)
    await database.pool.execute("UPDATE video_assets SET status='REJECTED' WHERE id=$1", asset_id)

    await _runner(database).run_once()

    row = await _job(database, job["id"])
    assert (row["status"], row["error_code"]) == ("failed", "invalid_status_transition")
    assert await _status(database, asset_id) == "REJECTED"


async def test_a_video_rejected_during_the_probe_stays_rejected(database, tmp_path):
    """The status guard is part of the final UPDATE: a rejection that lands after the job read the
    row still wins."""
    asset_id = await _video(database, tmp_path)
    await _write_mp4(database, asset_id)
    job = await _enqueue_finalize(database, asset_id)

    async def probe_while_rejected(path: Path) -> dict:
        await database.pool.execute("UPDATE video_assets SET status='REJECTED' WHERE id=$1", asset_id)
        return dict(PROBE)

    await _runner(database, probe=probe_while_rejected).run_once()

    row = await _job(database, job["id"])
    assert (row["status"], row["error_code"]) == ("failed", "invalid_status_transition")
    assert await _status(database, asset_id) == "REJECTED"


async def test_finalize_then_poll_shows_the_result(admin_api, database, tmp_path):
    asset_id = await _video(database, tmp_path)
    job_id = (await admin_api.client.post(f"/assets/video/{asset_id}/finalize")).json()["jobId"]

    queued = await admin_api.client.get(f"/jobs/{job_id}")
    await _write_mp4(database, asset_id)
    await _runner(database).run_once()
    done = await admin_api.client.get(f"/jobs/{job_id}")

    assert queued.json() == {"status": "queued"}
    assert done.status_code == 200
    assert done.json() == {
        "status": "done",
        "result": {
            "id": str(asset_id),
            "status": "VIDEO_GENERATED",
            "media_url": f"/api/assets/video/{asset_id}",
            "probe": PROBE,
        },
    }
