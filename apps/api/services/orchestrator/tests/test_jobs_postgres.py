"""The background job runner (ADR 0015) against a real PostgreSQL: migration 005, the claim, the
lease, retries, the failure logs, the retention sweep, and GET /jobs/{job_id}. A fake cannot show
that two runners never run the same job, or that a lease runs out.

These tests need a disposable database. They apply every migration to it, create a scratch
database next to it, and delete every row of generation_jobs, so never point them at a database
whose data matters. Without the variable below they skip.

    docker run -d --rm --name orchestrator-test-pg -e POSTGRES_PASSWORD=test \\
      -e POSTGRES_DB=test -p 127.0.0.1:55433:5432 postgres:16-alpine
    ORCHESTRATOR_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55433/test \\
      pytest services/orchestrator/tests/test_jobs_postgres.py
"""

import asyncio
import json
import logging
import os
import shutil
import socket
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID, uuid4

import asyncpg
import pytest
from pydantic import SecretStr

from services.orchestrator.src import main
from services.orchestrator.src.database import Database
from services.orchestrator.src.errors import AppError
from services.orchestrator.src.jobs import HANDLERS, JobRunner, Reschedule
from services.orchestrator.src.main import app

from .conftest import ADMIN_PHONE, build_settings

DATABASE_URL = os.environ.get("ORCHESTRATOR_TEST_DATABASE_URL")
MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"

pytestmark = pytest.mark.skipif(
    not DATABASE_URL, reason="needs ORCHESTRATOR_TEST_DATABASE_URL, a disposable PostgreSQL"
)

LOG_KEYS = {"job_id", "job_type", "attempt", "max_attempts", "error_code", "will_retry"}
PRIVATE_TEXT = "متن خصوصی کاربر"
USER_PHONE = "09123456789"
OTHER_PHONE = "09123456780"


@pytest.fixture
async def database():
    db = Database(DATABASE_URL, MIGRATIONS)
    await db.connect()
    await db.pool.execute("DELETE FROM generation_jobs")
    try:
        yield db
    finally:
        await db.close()


def _runner(db: Database, handlers, **options) -> JobRunner:
    return JobRunner(
        db, handlers=handlers, worker_id=f"test-{uuid4().hex[:8]}", settings=build_settings(), **options
    )


async def _enqueue(db: Database, job_type: str = "echo", *, max_attempts: int = 3, **options):
    return await db.enqueue_job(
        job_type,
        options.pop("dedupe_key", f"{job_type}:{uuid4()}"),
        options.pop("input", {"asset_id": str(uuid4())}),
        created_by=options.pop("created_by", None),
        max_attempts=max_attempts,
        **options,
    )


async def _row(db: Database, job_id: UUID) -> asyncpg.Record:
    return await db.pool.fetchrow("SELECT * FROM generation_jobs WHERE id=$1", job_id)


async def _warm_pool(db: Database, size: int) -> None:
    """Open the connections first. With a cold pool the calls run one after another, and a race
    test would pass even for a claim that is not atomic."""
    connections = [await db.pool.acquire() for _ in range(size)]
    for connection in connections:
        await db.pool.release(connection)


async def _expire_lease(db: Database, job_id: UUID) -> None:
    """What a dead worker leaves behind: a running job whose lease nobody renews."""
    await db.pool.execute(
        "UPDATE generation_jobs SET lease_expires_at = now() - interval '1 second' WHERE id=$1", job_id
    )


async def _count_key(db: Database, dedupe_key: str) -> int:
    return await db.pool.fetchval("SELECT count(*) FROM generation_jobs WHERE dedupe_key=$1", dedupe_key)


async def _make_due(db: Database, job_id: UUID) -> None:
    await db.pool.execute("UPDATE generation_jobs SET run_after = now() WHERE id=$1", job_id)


def _job_logs(caplog) -> list[logging.LogRecord]:
    events = {"job_attempt_failed", "job_failed"}
    return [record for record in caplog.records if record.getMessage() in events]


def _extra(record: logging.LogRecord) -> dict:
    return {key: getattr(record, key) for key in LOG_KEYS}


async def _echo(job, ctx):
    return {"input": json.loads(job["input"])}


# Migration 005 (A-1)


async def test_the_migration_adds_the_runner_columns(database):
    columns = {
        row["column_name"]: (row["data_type"], row["is_nullable"], row["column_default"])
        for row in await database.pool.fetch(
            "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns "
            "WHERE table_name='generation_jobs'"
        )
    }

    assert columns["attempt_count"] == ("integer", "NO", "0")
    assert columns["max_attempts"][:2] == ("integer", "NO")
    assert columns["run_after"][:2] == ("timestamp with time zone", "NO")
    assert columns["lease_expires_at"][:2] == ("timestamp with time zone", "YES")
    assert columns["worker_id"][:2] == ("text", "YES")
    assert columns["created_by"][:2] == ("uuid", "YES")
    assert columns["updated_at"][:2] == ("timestamp with time zone", "NO")


async def test_the_migration_keeps_the_old_index_and_adds_the_active_dedupe_index(database):
    indexes = {
        row["indexname"]: row["indexdef"]
        for row in await database.pool.fetch(
            "SELECT indexname, indexdef FROM pg_indexes WHERE tablename='generation_jobs'"
        )
    }

    assert "generation_jobs_dedupe_idx" in indexes
    [active] = [text for text in indexes.values() if "UNIQUE" in text and "dedupe_key" in text]
    assert "'queued'" in active and "'running'" in active


async def test_created_by_must_be_a_user(database):
    with pytest.raises(asyncpg.ForeignKeyViolationError):
        await _enqueue(database, created_by=uuid4())


async def test_the_migration_applies_on_a_table_with_old_rows(tmp_path):
    """Apply 001 to 004, write rows in the old shape, then apply 005 on top of them."""
    scratch = f"jobs_migration_{uuid4().hex[:12]}"
    parts = urlsplit(DATABASE_URL)
    scratch_url = urlunsplit(parts._replace(path=f"/{scratch}"))
    admin = await asyncpg.connect(DATABASE_URL)
    await admin.execute(f'CREATE DATABASE "{scratch}"')
    try:
        old = tmp_path / "old"
        old.mkdir()
        for migration in sorted(MIGRATIONS.glob("00[1-4]_*.sql")):
            shutil.copy(migration, old / migration.name)
        db = Database(scratch_url, old)
        await db.connect()
        await db.pool.execute(
            "INSERT INTO generation_jobs (job_type, dedupe_key, status, input) VALUES "
            "('finalize_video', 'old-1', 'done', '{}'), ('finalize_video', 'old-2', 'queued', '{}')"
        )
        await db.close()

        db = Database(scratch_url, MIGRATIONS)
        await db.connect()
        rows = await db.pool.fetch("SELECT * FROM generation_jobs ORDER BY dedupe_key")
        applied = await db.pool.fetchval("SELECT count(*) FROM schema_migrations WHERE version LIKE '005_%'")
        await db.close()
    finally:
        await admin.execute(f'DROP DATABASE IF EXISTS "{scratch}" WITH (FORCE)')
        await admin.close()

    assert applied == 1
    assert [row["dedupe_key"] for row in rows] == ["old-1", "old-2"]
    for row in rows:
        assert row["attempt_count"] == 0
        assert row["max_attempts"] >= 1
        assert row["run_after"] is not None
        assert row["updated_at"] is not None
        assert row["lease_expires_at"] is None and row["worker_id"] is None and row["created_by"] is None


# Enqueue and dedupe (A-6)


async def test_a_second_enqueue_of_an_active_key_returns_the_first_job(database):
    first = await _enqueue(database, dedupe_key="same-key")
    second = await _enqueue(database, dedupe_key="same-key")

    assert second["id"] == first["id"]
    assert first["status"] == "queued"
    assert first["attempt_count"] == 0
    assert first["max_attempts"] == 3
    assert await _count_key(database, "same-key") == 1


async def test_a_finished_job_does_not_block_a_new_one_with_its_key(database):
    first = await _enqueue(database, dedupe_key="same-key")
    await _runner(database, {"echo": _echo}).run_once()

    second = await _enqueue(database, dedupe_key="same-key")

    assert second["id"] != first["id"]
    assert (await _row(database, first["id"]))["status"] == "done"


async def test_parallel_enqueues_of_one_key_create_one_job(database):
    await _warm_pool(database, 10)

    rows = await asyncio.gather(*[_enqueue(database, dedupe_key="race-key") for _ in range(10)])

    assert len({row["id"] for row in rows}) == 1
    assert await _count_key(database, "race-key") == 1


async def test_the_index_refuses_a_second_active_row_written_directly(database):
    await _enqueue(database, dedupe_key="same-key")

    with pytest.raises(asyncpg.UniqueViolationError):
        await database.pool.execute(
            "INSERT INTO generation_jobs (job_type, dedupe_key, status) "
            "VALUES ('echo', 'same-key', 'running')"
        )


async def test_get_job_returns_the_row_or_none(database):
    job = await _enqueue(database)

    assert (await database.get_job(job["id"]))["id"] == job["id"]
    assert await database.get_job(uuid4()) is None


# The claim and two workers (A-2)


async def test_run_once_runs_a_due_job_and_records_the_output(database):
    job = await _enqueue(database, input={"asset_id": "a-1"})
    runner = _runner(database, {"echo": _echo})

    assert await runner.run_once() is True
    assert await runner.run_once() is False

    row = await _row(database, job["id"])
    assert row["status"] == "done"
    assert json.loads(row["output"]) == {"input": {"asset_id": "a-1"}}
    assert row["attempt_count"] == 1
    assert row["worker_id"] == runner.worker_id
    assert row["started_at"] is not None and row["completed_at"] is not None
    assert row["lease_expires_at"] is None


async def test_a_job_that_is_not_due_yet_is_not_claimed(database):
    job = await _enqueue(database, run_after=datetime.now(UTC) + timedelta(hours=1))

    assert await _runner(database, {"echo": _echo}).run_once() is False
    assert (await _row(database, job["id"]))["status"] == "queued"


async def test_a_runner_claims_only_the_job_types_it_has_handlers_for(database):
    job = await _enqueue(database, "other")

    assert await _runner(database, {"echo": _echo}).run_once() is False
    assert (await _row(database, job["id"]))["status"] == "queued"


async def test_the_claim_sets_the_lease_while_the_handler_runs(database):
    job = await _enqueue(database)
    seen = {}

    async def look(row, ctx):
        seen.update(dict(await _row(database, row["id"])))
        return {}

    runner = _runner(database, {"echo": look})
    await runner.run_once()

    assert seen["status"] == "running"
    assert seen["worker_id"] == runner.worker_id
    lease = (seen["lease_expires_at"] - seen["started_at"]).total_seconds()
    assert 59 <= lease <= 61
    assert seen["attempt_count"] == 1
    assert seen["id"] == job["id"]


async def test_two_runners_never_run_the_same_job(database):
    await _warm_pool(database, 10)
    jobs = [await _enqueue(database) for _ in range(20)]
    runs: list[UUID] = []

    async def slow(job, ctx):
        runs.append(job["id"])
        await asyncio.sleep(0.02)
        return {}

    async def drain(runner: JobRunner) -> None:
        while await runner.run_once():
            pass

    await asyncio.gather(drain(_runner(database, {"echo": slow})), drain(_runner(database, {"echo": slow})))

    assert sorted(runs) == sorted(job["id"] for job in jobs)
    statuses = await database.pool.fetch("SELECT status, attempt_count FROM generation_jobs")
    assert {(row["status"], row["attempt_count"]) for row in statuses} == {("done", 1)}


# Leases and dead workers (A-3)


async def test_a_job_whose_worker_died_runs_again_and_counts_the_attempt(database, caplog):
    job = await _enqueue(database, max_attempts=3)
    await database.claim_job(["echo"], worker_id="dead-worker", lease_seconds=60)
    await _expire_lease(database, job["id"])
    runner = _runner(database, {"echo": _echo})

    assert await runner.run_once() is True

    row = await _row(database, job["id"])
    assert row["status"] == "done"
    assert row["attempt_count"] == 2
    assert row["worker_id"] == runner.worker_id
    [record] = _job_logs(caplog)
    assert record.getMessage() == "job_attempt_failed"
    assert _extra(record) == {
        "job_id": str(job["id"]),
        "job_type": "echo",
        "attempt": 1,
        "max_attempts": 3,
        "error_code": "worker_lost",
        "will_retry": True,
    }


async def test_a_dead_worker_on_the_last_attempt_fails_the_job_with_worker_lost(database, caplog):
    job = await _enqueue(database, max_attempts=1)
    await database.claim_job(["echo"], worker_id="dead-worker", lease_seconds=60)
    await _expire_lease(database, job["id"])
    calls = []

    async def record(row, ctx):
        calls.append(row["id"])
        return {}

    assert await _runner(database, {"echo": record}).run_once() is True

    row = await _row(database, job["id"])
    assert calls == []
    assert row["status"] == "failed"
    assert row["error_code"] == "worker_lost"
    assert row["error_message"] and "worker" in row["error_message"]
    assert row["attempt_count"] == 1
    assert row["completed_at"] is not None
    assert [(r.getMessage(), r.will_retry, r.attempt) for r in _job_logs(caplog)] == [
        ("job_attempt_failed", False, 1),
        ("job_failed", False, 1),
    ]


async def test_a_job_with_a_live_lease_is_not_taken_over(database):
    job = await _enqueue(database)
    await database.claim_job(["echo"], worker_id="busy-worker", lease_seconds=60)

    assert await _runner(database, {"echo": _echo}).run_once() is False
    assert (await _row(database, job["id"]))["worker_id"] == "busy-worker"


async def _outlive_the_lease(database, *, renew_seconds: float) -> tuple[bool, asyncpg.Record]:
    """Runner one holds a job for 1.5 s on a 1 s lease. Runner two tries to take it after 1.2 s,
    and when it does, it finishes only after runner one has tried to record its late result."""
    job = await _enqueue(database)
    started = asyncio.Event()
    first_finished = asyncio.Event()

    async def slow(row, ctx):
        started.set()
        await asyncio.sleep(1.5)
        return {"by": "first"}

    async def after_first(row, ctx):
        await first_finished.wait()
        return {"by": "second"}

    first = _runner(database, {"echo": slow}, lease_seconds=1, renew_seconds=renew_seconds)
    second = _runner(database, {"echo": after_first})

    async def run_first() -> None:
        await first.run_once()
        first_finished.set()

    async def take_over() -> bool:
        await started.wait()
        await asyncio.sleep(1.2)
        return await second.run_once()

    _, taken = await asyncio.gather(run_first(), take_over())
    return taken, await _row(database, job["id"])


async def test_the_lease_is_renewed_while_the_handler_runs(database):
    taken, row = await _outlive_the_lease(database, renew_seconds=0.2)

    assert taken is False
    assert row["status"] == "done"
    assert json.loads(row["output"]) == {"by": "first"}
    assert row["attempt_count"] == 1


async def test_a_lapsed_lease_is_taken_over_and_the_late_result_is_dropped(database):
    """The control for the renewal test: without renewal the lease runs out. The first worker's
    late result must not overwrite the result of the worker that took the job over."""
    taken, row = await _outlive_the_lease(database, renew_seconds=100)

    assert taken is True
    assert row["status"] == "done"
    assert json.loads(row["output"]) == {"by": "second"}
    assert row["attempt_count"] == 2


async def test_a_renewal_error_never_replaces_the_handler_result(database, monkeypatch, caplog):
    """Postgres can fail a renewal. The handler's result must still be recorded, and the log must
    carry no exception text."""
    job = await _enqueue(database)

    async def broken_renewal(row, lease_seconds):
        raise RuntimeError(f"connection lost {PRIVATE_TEXT}")

    monkeypatch.setattr(database, "renew_job_lease", broken_renewal)

    async def slow(row, ctx):
        await asyncio.sleep(0.3)
        return {"ok": True}

    assert await _runner(database, {"echo": slow}, renew_seconds=0.05).run_once() is True

    row = await _row(database, job["id"])
    assert row["status"] == "done"
    assert json.loads(row["output"]) == {"ok": True}
    failures = [record for record in caplog.records if record.getMessage() == "job_lease_renew_failed"]
    assert failures
    for record in failures:
        assert (record.job_id, record.job_type) == (str(job["id"]), "echo")
        assert record.exc_info is None
    assert "connection lost" not in caplog.text and PRIVATE_TEXT not in caplog.text


async def test_the_renewal_keeps_trying_after_an_error(database, monkeypatch):
    """One failed renewal does not give the lease up: the next one extends it again."""
    real_renewal = database.renew_job_lease
    calls = 0

    async def fails_once(row, lease_seconds):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("connection lost")
        return await real_renewal(row, lease_seconds)

    monkeypatch.setattr(database, "renew_job_lease", fails_once)

    taken, row = await _outlive_the_lease(database, renew_seconds=0.2)

    assert calls > 1
    assert taken is False
    assert row["status"] == "done"
    assert json.loads(row["output"]) == {"by": "first"}


# Retries and failure logs (A-4)


async def test_a_retryable_error_requeues_the_job_with_a_later_run_after(database, caplog):
    job = await _enqueue(database, max_attempts=3, input={"text": PRIVATE_TEXT})

    async def flaky(row, ctx):
        raise AppError("egress_failure", PRIVATE_TEXT, 502, True)

    before = datetime.now(UTC)
    await _runner(database, {"echo": flaky}).run_once()

    row = await _row(database, job["id"])
    assert row["status"] == "queued"
    assert row["attempt_count"] == 1
    assert row["run_after"] > before + timedelta(seconds=1)
    assert row["error_code"] == "egress_failure"
    assert row["error_message"] and PRIVATE_TEXT not in row["error_message"]
    assert row["lease_expires_at"] is None
    [record] = _job_logs(caplog)
    assert record.getMessage() == "job_attempt_failed"
    assert _extra(record) == {
        "job_id": str(job["id"]),
        "job_type": "echo",
        "attempt": 1,
        "max_attempts": 3,
        "error_code": "egress_failure",
        "will_retry": True,
    }


async def test_a_retried_job_runs_again_once_it_is_due(database):
    job = await _enqueue(database, max_attempts=3)
    calls = []

    async def once_flaky(row, ctx):
        calls.append(row["attempt_count"])
        if len(calls) == 1:
            raise AppError("egress_failure", "later", 502, True)
        return {"ok": True}

    runner = _runner(database, {"echo": once_flaky})
    await runner.run_once()
    assert await runner.run_once() is False
    await _make_due(database, job["id"])
    await runner.run_once()

    row = await _row(database, job["id"])
    assert calls == [1, 2]
    assert row["status"] == "done"
    assert row["attempt_count"] == 2


async def test_a_retryable_error_on_the_last_attempt_fails_the_job(database, caplog):
    job = await _enqueue(database, max_attempts=1)

    async def flaky(row, ctx):
        raise AppError("egress_failure", "later", 502, True)

    await _runner(database, {"echo": flaky}).run_once()

    row = await _row(database, job["id"])
    assert row["status"] == "failed"
    assert row["error_code"] == "egress_failure"
    assert [(r.getMessage(), r.will_retry) for r in _job_logs(caplog)] == [
        ("job_attempt_failed", False),
        ("job_failed", False),
    ]


async def test_a_non_retryable_error_fails_the_job_at_once(database, caplog):
    job = await _enqueue(database, max_attempts=3)

    async def broken(row, ctx):
        raise AppError("egress_invalid_mp4", PRIVATE_TEXT, 502, False)

    await _runner(database, {"echo": broken}).run_once()

    row = await _row(database, job["id"])
    assert row["status"] == "failed"
    assert row["attempt_count"] == 1
    assert row["error_code"] == "egress_invalid_mp4"
    assert row["error_message"] and PRIVATE_TEXT not in row["error_message"]
    [attempt, failed] = _job_logs(caplog)
    assert failed.getMessage() == "job_failed"
    assert _extra(failed) == {
        "job_id": str(job["id"]),
        "job_type": "echo",
        "attempt": 1,
        "max_attempts": 3,
        "error_code": "egress_invalid_mp4",
        "will_retry": False,
    }
    assert attempt.will_retry is False


async def test_an_unexpected_exception_fails_the_job_with_no_exception_text(database, caplog):
    caplog.set_level(logging.DEBUG)
    job = await _enqueue(database, max_attempts=3, input={"text": PRIVATE_TEXT})

    async def crash(row, ctx):
        raise RuntimeError(f"boom {PRIVATE_TEXT}")

    await _runner(database, {"echo": crash}).run_once()

    row = await _row(database, job["id"])
    assert row["status"] == "failed"
    assert row["error_code"] == "internal_error"
    assert row["error_message"] and "boom" not in row["error_message"]
    assert [r.getMessage() for r in _job_logs(caplog)] == ["job_attempt_failed", "job_failed"]
    for record in caplog.records:
        assert record.exc_info is None
        assert "boom" not in record.getMessage() and PRIVATE_TEXT not in record.getMessage()
        assert "boom" not in str(record.__dict__) and PRIVATE_TEXT not in str(record.__dict__)


async def test_the_error_message_is_fixed_per_code(database):
    first = await _enqueue(database, max_attempts=1)
    second = await _enqueue(database, max_attempts=1)
    messages = iter(["first text", "second text"])

    async def broken(row, ctx):
        raise AppError("egress_invalid_mp4", next(messages), 502, False)

    runner = _runner(database, {"echo": broken})
    await runner.run_once()
    await runner.run_once()

    assert (await _row(database, first["id"]))["error_message"] == (await _row(database, second["id"]))[
        "error_message"
    ]


async def test_a_reschedule_releases_the_job_without_counting_an_attempt(database, caplog):
    job = await _enqueue(database, max_attempts=1)
    answers = iter([Reschedule(0.05), {"ok": True}])

    async def wait_then_finish(row, ctx):
        return next(answers)

    runner = _runner(database, {"echo": wait_then_finish})
    await runner.run_once()
    row = await _row(database, job["id"])
    assert row["status"] == "queued"
    assert row["attempt_count"] == 0
    assert row["lease_expires_at"] is None

    await asyncio.sleep(0.1)
    await runner.run_once()

    row = await _row(database, job["id"])
    assert row["status"] == "done"
    assert row["attempt_count"] == 1
    assert _job_logs(caplog) == []


async def test_a_write_that_fails_rolls_back_with_the_job_result(database):
    """A handler's on_done write runs in the transaction that marks the job done, so a write that
    fails leaves nothing behind and the job fails with the write's error."""
    job = await _enqueue(database, max_attempts=3)
    user = await database.create_user(f"+98913{uuid4().int % 10**7:07d}", "user")

    async def write(conn):
        await conn.execute("UPDATE users SET first_name='written' WHERE id=$1", user["id"])
        raise AppError("invalid_status_transition", "no longer a draft", 409, False)

    async def handler(row, ctx):
        ctx.on_done(write)
        return {"ok": True}

    await _runner(database, {"echo": handler}).run_once()

    row = await _row(database, job["id"])
    assert row["status"] == "failed"
    assert row["error_code"] == "invalid_status_transition"
    assert (await database.get_user(user["id"]))["first_name"] == ""


# GET /jobs/{job_id} (A-5)


@pytest.fixture
async def jobs_api(api, database):
    app.state.database = database
    return api


async def _user_id(db: Database, phone: str) -> UUID:
    return (await db.get_user_by_phone(phone))["id"]


async def test_the_owner_reads_a_queued_job(jobs_api, database):
    await jobs_api.login(USER_PHONE)
    job = await _enqueue(database, created_by=await _user_id(database, "+989123456789"))

    response = await jobs_api.client.get(f"/jobs/{job['id']}")

    assert response.status_code == 200
    assert response.json() == {"status": "queued"}


async def test_the_owner_reads_the_result_of_a_done_job(jobs_api, database):
    await jobs_api.login(USER_PHONE)
    job = await _enqueue(
        database, created_by=await _user_id(database, "+989123456789"), input={"asset_id": "a-1"}
    )
    await _runner(database, {"echo": _echo}).run_once()

    response = await jobs_api.client.get(f"/jobs/{job['id']}")

    assert response.status_code == 200
    assert response.json() == {"status": "done", "result": {"input": {"asset_id": "a-1"}}}


async def test_the_owner_reads_the_error_of_a_failed_job(jobs_api, database):
    await jobs_api.login(USER_PHONE)
    job = await _enqueue(database, created_by=await _user_id(database, "+989123456789"), max_attempts=1)

    async def broken(row, ctx):
        raise AppError("egress_invalid_mp4", PRIVATE_TEXT, 502, False)

    await _runner(database, {"echo": broken}).run_once()
    response = await jobs_api.client.get(f"/jobs/{job['id']}")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"status", "error"}
    assert body["status"] == "failed"
    assert body["error"]["code"] == "egress_invalid_mp4"
    assert body["error"]["message"] == (await _row(database, job["id"]))["error_message"]
    assert PRIVATE_TEXT not in response.text


async def test_an_admin_reads_another_users_job_and_a_system_job(jobs_api, database):
    await jobs_api.login(USER_PHONE)
    users_job = await _enqueue(database, created_by=await _user_id(database, "+989123456789"))
    system_job = await _enqueue(database, created_by=None)
    jobs_api.client.cookies.clear()
    await jobs_api.login(ADMIN_PHONE)

    for job in (users_job, system_job):
        response = await jobs_api.client.get(f"/jobs/{job['id']}")
        assert response.status_code == 200
        assert response.json() == {"status": "queued"}


async def test_another_user_a_system_job_and_an_unknown_id_all_answer_the_same_404(jobs_api, database):
    await jobs_api.login(OTHER_PHONE)
    jobs_api.client.cookies.clear()
    await jobs_api.login(USER_PHONE)
    others_job = await _enqueue(database, created_by=await _user_id(database, "+989123456780"))
    system_job = await _enqueue(database, created_by=None)

    bodies = []
    for job_id in (others_job["id"], system_job["id"], uuid4()):
        response = await jobs_api.client.get(f"/jobs/{job_id}")
        assert response.status_code == 404
        body = response.json()
        body.pop("correlation_id")
        bodies.append(body)

    assert bodies[0]["error"]["code"] == "not_found"
    assert bodies[0] == bodies[1] == bodies[2]


async def test_reading_a_job_needs_a_session(jobs_api, database):
    job = await _enqueue(database)

    response = await jobs_api.client.get(f"/jobs/{job['id']}")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


# The retention sweep (A-7)


async def _aged(db: Database, status: str, days: int) -> UUID:
    job = await _enqueue(db, "old_work")
    await db.pool.execute(
        "UPDATE generation_jobs SET status=$2, completed_at = now() - make_interval(days => $3) WHERE id=$1",
        job["id"],
        status,
        days,
    )
    return job["id"]


async def _enqueue_sweep(db: Database, **options) -> asyncpg.Record:
    return await db.enqueue_job(
        "retention_sweep", "retention_sweep", {}, created_by=None, max_attempts=1, **options
    )


async def _sweeps(db: Database) -> list[asyncpg.Record]:
    return await db.pool.fetch(
        "SELECT * FROM generation_jobs WHERE job_type='retention_sweep' ORDER BY created_at"
    )


async def test_the_sweep_deletes_old_done_jobs_and_keeps_the_rest(database):
    old_done = await _aged(database, "done", 31)
    young_done = await _aged(database, "done", 29)
    old_failed = await _aged(database, "failed", 400)
    sweep = await _enqueue_sweep(database)

    await _runner(database, HANDLERS).run_once()

    assert await _row(database, old_done) is None
    assert await _row(database, young_done) is not None
    assert await _row(database, old_failed) is not None
    assert (await _row(database, sweep["id"]))["status"] == "done"


async def test_the_sweep_enqueues_the_next_run_one_day_ahead(database):
    sweep = await _enqueue_sweep(database)

    before = datetime.now(UTC)
    await _runner(database, HANDLERS).run_once()

    [done, following] = await _sweeps(database)
    assert done["id"] == sweep["id"] and done["status"] == "done"
    assert following["status"] == "queued"
    assert following["dedupe_key"] == "retention_sweep"
    assert following["max_attempts"] == 1
    assert following["created_by"] is None
    assert before + timedelta(hours=23) < following["run_after"] < before + timedelta(hours=25)


async def test_a_failed_sweep_is_failed_logged_and_still_enqueues_the_next_run(database, caplog):
    await _enqueue_sweep(database)

    async def broken(row, ctx):
        raise RuntimeError("disk full")

    await _runner(database, {"retention_sweep": broken}).run_once()

    [failed, following] = await _sweeps(database)
    assert failed["status"] == "failed"
    assert following["status"] == "queued"
    assert following["run_after"] > datetime.now(UTC) + timedelta(hours=23)
    assert "job_failed" in [r.getMessage() for r in _job_logs(caplog)]


async def test_a_lost_sweep_still_enqueues_the_next_run(database):
    sweep = await _enqueue_sweep(database)
    await database.claim_job(["retention_sweep"], worker_id="dead-worker", lease_seconds=60)
    await _expire_lease(database, sweep["id"])

    await _runner(database, HANDLERS).run_once()

    [lost, following] = await _sweeps(database)
    assert (lost["status"], lost["error_code"]) == ("failed", "worker_lost")
    assert following["status"] == "queued"


# The library media steps of the sweep (REQ-016, REQ-017, REQ-072; SC-009, SC-011, SC-026)

MEDIA_PREFIX = "sweep-test-"


@pytest.fixture
async def media(database, tmp_path):
    """A clean library and a reviewer. Every library row goes, so the sweep sees only this test's."""

    async def clean() -> None:
        await database.pool.execute("DELETE FROM library_entry_reviews")
        await database.pool.execute("DELETE FROM library_entries")
        await database.pool.execute("DELETE FROM video_assets WHERE external_id LIKE $1", f"{MEDIA_PREFIX}%")

    await clean()
    reviewer = await database.create_user(f"+98913{uuid4().int % 10**7:07d}", "admin")
    try:
        yield Media(database, tmp_path, reviewer["id"])
    finally:
        await clean()


class Media:
    def __init__(self, db: Database, folder: Path, reviewer_id: UUID):
        self.db = db
        self.folder = folder
        self.reviewer_id = reviewer_id

    async def video(self, status: str, *, with_file: bool = True) -> tuple[UUID, Path]:
        name = f"{MEDIA_PREFIX}{uuid4().hex}"
        path = self.folder / f"{name}.mp4"
        if with_file:
            path.write_bytes(b"mp4 bytes")
        video_id = await self.db.pool.fetchval(
            "INSERT INTO video_assets (external_id,text,avatar_id,voice_id,video_path,status) "
            "VALUES ($1,$2,'avatar','voice',$3,$4) RETURNING id",
            name,
            PRIVATE_TEXT,
            str(path),
            status,
        )
        await self.db.pool.execute(
            "INSERT INTO asset_reviews (asset_kind, asset_id, reviewer_user_id, decision, previous_status) "
            "VALUES ('video', $1, $2, $3, 'VIDEO_GENERATED')",
            video_id,
            self.reviewer_id,
            status,
        )
        return video_id, path

    async def entry(self, status: str, video_id: UUID | None = None) -> UUID:
        return await self.db.pool.fetchval(
            """
            INSERT INTO library_entries
              (key,question,answer_text,language,category,category_title,section_type,technical,
               video_asset_id,status,position)
            VALUES ($1,$2,$3,'fa','1','category','knowledge','technical',$4,$5,1)
            RETURNING id
            """,
            f"K{uuid4().hex[:12]}",
            PRIVATE_TEXT,
            PRIVATE_TEXT,
            video_id,
            status,
        )

    async def review(self, entry_id: UUID, decision: str, video_id: UUID | None = None) -> None:
        await self.db.pool.execute(
            "INSERT INTO library_entry_reviews (entry_id, reviewer_id, decision, video_asset_id) "
            "VALUES ($1,$2,$3,$4)",
            entry_id,
            self.reviewer_id,
            decision,
            video_id,
        )

    async def withdrawn_with_video(self) -> tuple[UUID, UUID, Path]:
        video_id, path = await self.video("VIDEO_APPROVED")
        entry_id = await self.entry("withdrawn", video_id)
        await self.review(entry_id, "video_attached", video_id)
        await self.review(entry_id, "withdrawn")
        return entry_id, video_id, path

    async def rejected_video(self) -> tuple[UUID, UUID, Path]:
        """What REQ-069 leaves: a ready entry, and a REJECTED video that a video_rejected row names."""
        video_id, path = await self.video("REJECTED")
        entry_id = await self.entry("ready")
        await self.review(entry_id, "video_attached", video_id)
        await self.review(entry_id, "video_rejected", video_id)
        return entry_id, video_id, path

    async def entry_row(self, entry_id: UUID) -> asyncpg.Record:
        return await self.db.pool.fetchrow("SELECT * FROM library_entries WHERE id=$1", entry_id)

    async def video_exists(self, video_id: UUID) -> bool:
        return await self.db.pool.fetchval("SELECT EXISTS (SELECT 1 FROM video_assets WHERE id=$1)", video_id)

    async def asset_review_ids(self, video_id: UUID) -> list[UUID]:
        rows = await self.db.pool.fetch(
            "SELECT id FROM asset_reviews WHERE asset_kind='video' AND asset_id=$1 ORDER BY id", video_id
        )
        return [row["id"] for row in rows]

    async def entry_review_ids(self, entry_id: UUID) -> list[UUID]:
        rows = await self.db.pool.fetch(
            "SELECT id FROM library_entry_reviews WHERE entry_id=$1 ORDER BY id", entry_id
        )
        return [row["id"] for row in rows]

    async def sweep(self) -> asyncpg.Record:
        """Run one sweep now and return its job row. A sweep closes by queueing the next one a day
        ahead, so a second call makes that one due."""
        sweep = await _enqueue_sweep(self.db)
        await _make_due(self.db, sweep["id"])
        await _runner(self.db, HANDLERS).run_once()
        return await _row(self.db, sweep["id"])


async def test_the_sweep_deletes_a_withdrawn_entrys_media_and_keeps_its_history(media):
    entry_id, video_id, path = await media.withdrawn_with_video()
    entry_reviews = await media.entry_review_ids(entry_id)
    asset_reviews = await media.asset_review_ids(video_id)

    sweep = await media.sweep()

    assert sweep["status"] == "done"
    assert json.loads(sweep["output"]) == {
        "deleted_done_jobs": 0,
        "deleted_withdrawn_media": 1,
        "deleted_rejected_media": 0,
        "skipped_media": 0,
    }
    entry = await media.entry_row(entry_id)
    assert (entry["status"], entry["video_asset_id"]) == ("withdrawn", None)
    assert not await media.video_exists(video_id)
    assert not path.exists()
    assert await media.entry_review_ids(entry_id) == entry_reviews
    assert await media.asset_review_ids(video_id) == asset_reviews


async def test_the_sweep_deletes_a_rejected_video_no_entry_uses_and_keeps_its_history(media):
    entry_id, video_id, path = await media.rejected_video()
    entry_reviews = await media.entry_review_ids(entry_id)
    asset_reviews = await media.asset_review_ids(video_id)

    sweep = await media.sweep()

    assert sweep["status"] == "done"
    assert json.loads(sweep["output"])["deleted_rejected_media"] == 1
    assert not await media.video_exists(video_id)
    assert not path.exists()
    assert (await media.entry_row(entry_id))["status"] == "ready"
    assert await media.entry_review_ids(entry_id) == entry_reviews
    assert await media.asset_review_ids(video_id) == asset_reviews


async def test_a_missing_file_is_not_an_error_so_a_crash_after_the_file_delete_heals(media):
    """A sweep that died after the file delete and before the row delete leaves this state: the
    rows without their file. The next run finishes the job."""
    entry_id, withdrawn_video, withdrawn_path = await media.withdrawn_with_video()
    _, rejected_video, rejected_path = await media.rejected_video()
    withdrawn_path.unlink()
    rejected_path.unlink()

    sweep = await media.sweep()

    assert sweep["status"] == "done"
    output = json.loads(sweep["output"])
    assert (output["deleted_withdrawn_media"], output["deleted_rejected_media"]) == (1, 1)
    assert (await media.entry_row(entry_id))["video_asset_id"] is None
    assert not await media.video_exists(withdrawn_video)
    assert not await media.video_exists(rejected_video)


async def test_a_second_sweep_finds_nothing_left_to_delete(media):
    await media.withdrawn_with_video()
    await media.rejected_video()
    await media.sweep()

    output = json.loads((await media.sweep())["output"])

    assert (output["deleted_withdrawn_media"], output["deleted_rejected_media"]) == (0, 0)


async def test_the_sweep_keeps_every_video_and_entry_it_must_not_delete(media):
    """ADR 0015 item 5: no RENDER_FAILED row, no draft or unpublished recording, and nothing an
    entry still uses. Only REQ-069's rejection counts, not a rejection through the asset route."""
    kept_videos: list[tuple[UUID, Path]] = []
    kept_entries: dict[UUID, tuple[str, UUID | None]] = {}

    for status in ("draft", "published"):
        video = await media.video("VIDEO_APPROVED")
        kept_videos.append(video)
        kept_entries[await media.entry(status, video[0])] = (status, video[0])
    for status in ("pending", "ready"):
        kept_entries[await media.entry(status)] = (status, None)
    kept_videos.append(await media.video("VIDEO_GENERATED"))  # a recording not yet saved (REQ-042)
    kept_videos.append(await media.video("DRAFT"))  # a recording in progress
    kept_videos.append(await media.video("REJECTED"))  # rejected through the asset route
    failed = await media.video("RENDER_FAILED", with_file=False)
    kept_videos.append(failed)
    kept_entries[await media.entry("withdrawn", failed[0])] = ("withdrawn", failed[0])
    rejected_but_used = await media.video("REJECTED")
    kept_videos.append(rejected_but_used)
    using_entry = await media.entry("draft", rejected_but_used[0])
    kept_entries[using_entry] = ("draft", rejected_but_used[0])
    await media.review(await media.entry("ready"), "video_rejected", rejected_but_used[0])
    not_rejected = await media.video("VIDEO_GENERATED")  # named by a video_rejected row, not REJECTED
    kept_videos.append(not_rejected)
    await media.review(await media.entry("ready"), "video_rejected", not_rejected[0])
    asset_reviews = await media.db.pool.fetchval("SELECT count(*) FROM asset_reviews")
    entry_reviews = await media.db.pool.fetchval("SELECT count(*) FROM library_entry_reviews")

    sweep = await media.sweep()

    output = json.loads(sweep["output"])
    assert (output["deleted_withdrawn_media"], output["deleted_rejected_media"]) == (0, 0)
    for video_id, path in kept_videos:
        assert await media.video_exists(video_id)
        assert path.exists() or video_id == failed[0]
    for entry_id, (status, video_id) in kept_entries.items():
        entry = await media.entry_row(entry_id)
        assert (entry["status"], entry["video_asset_id"]) == (status, video_id)
    assert await media.db.pool.fetchval("SELECT count(*) FROM asset_reviews") == asset_reviews
    assert await media.db.pool.fetchval("SELECT count(*) FROM library_entry_reviews") == entry_reviews


async def test_each_delete_checks_its_conditions_again_when_it_runs(media):
    """The sweep lists first and deletes later, so each delete repeats the list's conditions."""
    route_rejected, _ = await media.video("REJECTED")  # no video_rejected row names it
    used, _ = await media.video("REJECTED")
    await media.entry("draft", used)
    await media.review(await media.entry("ready"), "video_rejected", used)
    render_failed, _ = await media.video("RENDER_FAILED", with_file=False)
    holder = await media.entry("withdrawn", render_failed)
    published, _ = await media.video("VIDEO_APPROVED")
    other = await media.entry("published", published)
    not_rejected, _ = await media.video("VIDEO_GENERATED")
    await media.review(await media.entry("ready"), "video_rejected", not_rejected)

    assert not await media.db.delete_rejected_library_video(route_rejected)
    assert not await media.db.delete_rejected_library_video(used)
    assert not await media.db.delete_rejected_library_video(not_rejected)
    assert not await media.db.delete_withdrawn_library_video(holder, render_failed)
    assert not await media.db.delete_withdrawn_library_video(other, published)
    for video_id in (route_rejected, used, not_rejected, render_failed, published):
        assert await media.video_exists(video_id)
    assert (await media.entry_row(holder))["video_asset_id"] == render_failed
    assert (await media.entry_row(other))["video_asset_id"] == published


async def test_each_deleted_media_logs_its_ids_and_no_text(media, caplog):
    caplog.set_level(logging.INFO)
    withdrawn_entry, withdrawn_video, _ = await media.withdrawn_with_video()
    rejected_entry, rejected_video, _ = await media.rejected_video()

    await media.sweep()

    events = [r for r in caplog.records if r.getMessage() == "library_media_deleted"]
    logged = sorted((r.entry_id, r.video_asset_id, r.admin_id) for r in events)
    assert logged == sorted(
        [
            (str(withdrawn_entry), str(withdrawn_video), None),
            (str(rejected_entry), str(rejected_video), None),
        ]
    )
    everything = "\n".join(json.dumps(r.__dict__, default=str, ensure_ascii=False) for r in caplog.records)
    assert PRIVATE_TEXT not in everything


async def test_a_file_that_cannot_be_deleted_is_skipped_and_retried_by_the_next_run(media, caplog):
    """One file the sweep cannot delete does not fail the run. Its rows stay with
    their file, the other media are still deleted, the run counts it as skipped and ends done, and
    the next run tries it again."""
    stuck_entry, stuck_video, stuck_path = await media.withdrawn_with_video()
    stuck_path.unlink()
    stuck_path.mkdir()  # unlink() of a folder raises an OSError
    other_entry, other_video, _ = await media.withdrawn_with_video()

    sweep = await media.sweep()

    assert (sweep["status"], sweep["error_code"]) == ("done", None)
    output = json.loads(sweep["output"])
    assert (output["deleted_withdrawn_media"], output["skipped_media"]) == (1, 1)
    assert await media.video_exists(stuck_video)
    assert (await media.entry_row(stuck_entry))["video_asset_id"] == stuck_video
    assert not await media.video_exists(other_video)
    assert (await media.entry_row(other_entry))["video_asset_id"] is None
    [failure] = [r for r in caplog.records if r.getMessage() == "media_delete_failed"]
    assert failure.entry_id == str(stuck_entry)
    assert not hasattr(failure, "video_asset_id")
    assert failure.exc_info is None
    assert str(stuck_path) not in json.dumps(failure.__dict__, default=str)
    assert _job_logs(caplog) == []

    stuck_path.rmdir()
    retry = await media.sweep()

    assert retry["status"] == "done"
    output = json.loads(retry["output"])
    assert (output["deleted_withdrawn_media"], output["skipped_media"]) == (1, 0)
    assert not await media.video_exists(stuck_video)
    assert (await media.entry_row(stuck_entry))["video_asset_id"] is None


# start() and stop() (A-8)


async def test_start_enqueues_one_sweep_even_when_called_twice(database):
    runner = _runner(database, {})
    try:
        await runner.start()
        await runner.start()
    finally:
        await runner.stop()

    [sweep] = await _sweeps(database)
    assert sweep["status"] == "queued"
    assert sweep["dedupe_key"] == "retention_sweep"
    assert sweep["max_attempts"] == 1
    assert sweep["created_by"] is None


async def test_start_leaves_an_already_queued_sweep_alone(database):
    tomorrow = datetime.now(UTC) + timedelta(days=1)
    queued = await _enqueue_sweep(database, run_after=tomorrow)
    runner = _runner(database, HANDLERS)
    try:
        await runner.start()
    finally:
        await runner.stop()

    [sweep] = await _sweeps(database)
    assert sweep["id"] == queued["id"]
    assert sweep["run_after"] == queued["run_after"]


async def test_the_started_runner_runs_due_jobs_and_stop_waits_for_the_handler(database):
    job = await _enqueue(database)
    started = asyncio.Event()
    release = asyncio.Event()

    async def held(row, ctx):
        started.set()
        await release.wait()
        return {"ok": True}

    runner = _runner(database, {"echo": held})
    await runner.start()
    await asyncio.wait_for(started.wait(), timeout=5)
    stopping = asyncio.create_task(runner.stop())
    await asyncio.sleep(0.1)
    assert not stopping.done()
    release.set()
    await asyncio.wait_for(stopping, timeout=5)

    assert (await _row(database, job["id"]))["status"] == "done"


async def test_the_app_lifespan_starts_and_stops_the_runner(database, monkeypatch, tmp_path):
    config = build_settings(
        database_url=DATABASE_URL,
        livekit_api_secret=SecretStr("test-secret"),  # noqa: S106 - a fake value, never a real secret
        audio_cache_dir=tmp_path / "audio",
        video_cache_dir=tmp_path / "video",
        metadata_dir=tmp_path / "metadata",
    )
    monkeypatch.setattr(main, "settings", config)

    async with main.lifespan(app):
        runner = app.state.jobs
        assert isinstance(runner, JobRunner)
        assert runner.is_running
        assert runner.worker_id.startswith(socket.gethostname())
        active = [row for row in await _sweeps(database) if row["status"] in ("queued", "running")]
        assert len(active) == 1
    assert not runner.is_running


async def test_each_boot_gets_its_own_worker_id():
    from services.orchestrator.src.jobs import new_worker_id

    first, second = new_worker_id(), new_worker_id()

    assert first != second
    assert first.startswith(socket.gethostname()) and second.startswith(socket.gethostname())
