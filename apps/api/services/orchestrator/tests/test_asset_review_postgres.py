"""The asset review SQL against a real PostgreSQL: the guarded UPDATE, the audit row in the same
transaction, and the 004 migration. A fake cannot show that two reviews at once stay correct.

These tests need a disposable database. They apply every migration to it and write rows, so
never point them at a database whose data matters. Without the variable below they skip.

    docker run -d --rm --name orchestrator-test-pg -e POSTGRES_PASSWORD=test \\
      -e POSTGRES_DB=test -p 127.0.0.1:55433:5432 postgres:16-alpine
    ORCHESTRATOR_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55433/test \\
      pytest services/orchestrator/tests/test_asset_review_postgres.py
"""

import asyncio
import os
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pytest

from services.orchestrator.src.database import Database
from services.orchestrator.src.main import app

from .conftest import ADMIN_PHONE

DATABASE_URL = os.environ.get("ORCHESTRATOR_TEST_DATABASE_URL")
MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"

pytestmark = pytest.mark.skipif(
    not DATABASE_URL, reason="needs ORCHESTRATOR_TEST_DATABASE_URL, a disposable PostgreSQL"
)

GENERATED = {"audio": "AUDIO_GENERATED", "video": "VIDEO_GENERATED"}
APPROVED = {"audio": "AUDIO_APPROVED", "video": "VIDEO_APPROVED"}
ASSET_TEXT = "متن خصوصی یک پاسخ"
SET_STATUS = {
    "audio": "UPDATE audio_assets SET status=$2 WHERE id=$1",
    "video": "UPDATE video_assets SET status=$2 WHERE id=$1",
}
READ_ROW = {
    "audio": "SELECT status, updated_at FROM audio_assets WHERE id=$1",
    "video": "SELECT status, updated_at FROM video_assets WHERE id=$1",
}


@pytest.fixture
async def database():
    db = Database(DATABASE_URL, MIGRATIONS)
    await db.connect()
    try:
        yield db
    finally:
        await db.close()


async def _reviewer(db: Database) -> UUID:
    user = await db.create_user(f"+98913{uuid4().int % 10**7:07d}", "admin")
    return user["id"]


async def _asset(db: Database, kind: str, status: str) -> UUID:
    if kind == "audio":
        row = await db.create_audio_asset(
            {
                "cache_key": uuid4().hex + uuid4().hex,
                "text": ASSET_TEXT,
                "voice_id": "voice",
                "model_id": "model",
                "language": "fa",
                "settings": {},
                "file_path": "media/audio.pcm",
                "duration_ms": 1000,
            }
        )
    else:
        row = await db.create_video_asset(
            {
                "external_id": f"clip-{uuid4().hex}",
                "text": ASSET_TEXT,
                "avatar_id": "avatar",
                "voice_id": "voice",
                "video_path": "media/clip.mp4",
            }
        )
    await db.pool.execute(SET_STATUS[kind], row["id"], status)
    return row["id"]


async def _status(db: Database, kind: str, asset_id: UUID) -> str:
    return (await db.pool.fetchrow(READ_ROW[kind], asset_id))["status"]


async def _reviews(db: Database, asset_id: UUID) -> list[dict]:
    rows = await db.pool.fetch("SELECT * FROM asset_reviews WHERE asset_id=$1 ORDER BY created_at", asset_id)
    return [dict(row) for row in rows]


async def _warm_pool(db: Database, size: int) -> None:
    """Open the connections first. With a cold pool the requests run one after another, and a race
    test would pass even for a read-then-write update."""
    connections = [await db.pool.acquire() for _ in range(size)]
    for connection in connections:
        await db.pool.release(connection)


async def test_the_migration_adds_the_review_table_with_no_text_column(database):
    columns = await database.pool.fetch(
        "SELECT column_name, data_type, is_nullable FROM information_schema.columns "
        "WHERE table_name='asset_reviews' ORDER BY ordinal_position"
    )
    indexes = await database.pool.fetch("SELECT indexdef FROM pg_indexes WHERE tablename='asset_reviews'")
    applied = await database.pool.fetchval(
        "SELECT count(*) FROM schema_migrations WHERE version='004_asset_reviews'"
    )

    assert [(row["column_name"], row["data_type"], row["is_nullable"]) for row in columns] == [
        ("id", "uuid", "NO"),
        ("asset_kind", "text", "NO"),
        ("asset_id", "uuid", "NO"),
        ("reviewer_user_id", "uuid", "NO"),
        ("decision", "text", "NO"),
        ("previous_status", "text", "NO"),
        ("created_at", "timestamp with time zone", "NO"),
    ]
    assert any("(asset_kind, asset_id)" in row["indexdef"] for row in indexes)
    assert applied == 1


async def test_the_review_table_only_takes_audio_or_video(database):
    reviewer = await _reviewer(database)

    with pytest.raises(asyncpg.CheckViolationError):
        await database.pool.execute(
            "INSERT INTO asset_reviews (asset_kind, asset_id, reviewer_user_id, decision, previous_status) "
            "VALUES ('image', $1, $2, 'REJECTED', 'DRAFT')",
            uuid4(),
            reviewer,
        )


@pytest.mark.parametrize("kind", ["audio", "video"])
async def test_approving_generated_media_moves_it_and_writes_one_audit_row(database, kind):
    reviewer = await _reviewer(database)
    asset_id = await _asset(database, kind, GENERATED[kind])

    row = await database.review_asset(
        kind,
        asset_id,
        decision=APPROVED[kind],
        allowed_from=[GENERATED[kind]],
        reviewer_user_id=reviewer,
    )

    assert row["status"] == APPROVED[kind]
    assert row["previous_status"] == GENERATED[kind]
    assert await _status(database, kind, asset_id) == APPROVED[kind]
    [review] = await _reviews(database, asset_id)
    assert review["asset_kind"] == kind
    assert review["reviewer_user_id"] == reviewer
    assert review["decision"] == APPROVED[kind]
    assert review["previous_status"] == GENERATED[kind]
    assert review["created_at"] is not None
    assert ASSET_TEXT not in str(review.values())


@pytest.mark.parametrize("kind", ["audio", "video"])
async def test_rejecting_approved_media_records_the_approved_status(database, kind):
    reviewer = await _reviewer(database)
    asset_id = await _asset(database, kind, APPROVED[kind])

    row = await database.review_asset(
        kind,
        asset_id,
        decision="REJECTED",
        allowed_from=[GENERATED[kind], APPROVED[kind]],
        reviewer_user_id=reviewer,
    )

    assert row["status"] == "REJECTED"
    [review] = await _reviews(database, asset_id)
    assert review["previous_status"] == APPROVED[kind]


@pytest.mark.parametrize(
    ("kind", "current"), [("audio", "REJECTED"), ("video", "DRAFT"), ("video", "REJECTED")]
)
async def test_a_status_outside_the_allowed_ones_changes_nothing(database, kind, current):
    reviewer = await _reviewer(database)
    asset_id = await _asset(database, kind, current)
    before = await database.pool.fetchrow(READ_ROW[kind], asset_id)

    row = await database.review_asset(
        kind,
        asset_id,
        decision=APPROVED[kind],
        allowed_from=[GENERATED[kind]],
        reviewer_user_id=reviewer,
    )

    assert row is None
    assert await database.pool.fetchrow(READ_ROW[kind], asset_id) == before
    assert before["status"] == current
    assert await _reviews(database, asset_id) == []


async def test_an_unknown_asset_changes_nothing(database):
    reviewer = await _reviewer(database)
    missing = uuid4()

    row = await database.review_asset(
        "video", missing, decision="REJECTED", allowed_from=["VIDEO_GENERATED"], reviewer_user_id=reviewer
    )

    assert row is None
    assert await _reviews(database, missing) == []


async def test_a_failed_audit_row_rolls_the_decision_back(database):
    """The audit row is written in the same transaction: a reviewer who is not a user fails the
    insert, and the status stays as it was."""
    asset_id = await _asset(database, "video", "VIDEO_GENERATED")

    with pytest.raises(asyncpg.ForeignKeyViolationError):
        await database.review_asset(
            "video",
            asset_id,
            decision="VIDEO_APPROVED",
            allowed_from=["VIDEO_GENERATED"],
            reviewer_user_id=uuid4(),
        )

    assert await _status(database, "video", asset_id) == "VIDEO_GENERATED"
    assert await _reviews(database, asset_id) == []


async def test_two_approvals_at_once_accept_exactly_one(database):
    reviewer = await _reviewer(database)
    await _warm_pool(database, 10)
    assets = [await _asset(database, "video", "VIDEO_GENERATED") for _ in range(5)]

    results = await asyncio.gather(
        *[
            database.review_asset(
                "video",
                asset_id,
                decision="VIDEO_APPROVED",
                allowed_from=["VIDEO_GENERATED"],
                reviewer_user_id=reviewer,
            )
            for asset_id in assets
            for _ in range(2)
        ]
    )

    for index, asset_id in enumerate(assets):
        pair = results[2 * index : 2 * index + 2]
        assert sum(row is not None for row in pair) == 1
        assert len(await _reviews(database, asset_id)) == 1


async def test_an_approval_and_a_rejection_at_once_record_the_real_previous_status(database):
    """Whichever review commits second must see the status the first one left, not the status the
    row had when its statement started."""
    reviewer = await _reviewer(database)
    await _warm_pool(database, 10)
    assets = [await _asset(database, "video", "VIDEO_GENERATED") for _ in range(5)]

    await asyncio.gather(
        *[
            call
            for asset_id in assets
            for call in (
                database.review_asset(
                    "video",
                    asset_id,
                    decision="VIDEO_APPROVED",
                    allowed_from=["VIDEO_GENERATED"],
                    reviewer_user_id=reviewer,
                ),
                database.review_asset(
                    "video",
                    asset_id,
                    decision="REJECTED",
                    allowed_from=["VIDEO_GENERATED", "VIDEO_APPROVED"],
                    reviewer_user_id=reviewer,
                ),
            )
        ]
    )

    for asset_id in assets:
        history = {(row["previous_status"], row["decision"]) for row in await _reviews(database, asset_id)}
        # Approve first then reject, or reject first and the approval is refused.
        assert history in (
            {("VIDEO_GENERATED", "VIDEO_APPROVED"), ("VIDEO_APPROVED", "REJECTED")},
            {("VIDEO_GENERATED", "REJECTED")},
        )
        assert await _status(database, "video", asset_id) == "REJECTED"


async def test_the_endpoint_audits_the_signed_in_admin(api, database):
    app.state.database = database
    await api.login(ADMIN_PHONE)
    admin = await database.get_user_by_phone(ADMIN_PHONE)
    ready = await _asset(database, "video", "VIDEO_GENERATED")
    recording = await _asset(database, "video", "DRAFT")

    approved = await api.client.patch(f"/assets/video/{ready}/status", json={"status": "VIDEO_APPROVED"})
    refused = await api.client.patch(f"/assets/video/{recording}/status", json={"status": "VIDEO_APPROVED"})

    assert approved.status_code == 200
    assert approved.json() == {"id": str(ready), "status": "VIDEO_APPROVED"}
    [review] = await _reviews(database, ready)
    assert review["reviewer_user_id"] == admin["id"]
    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "invalid_status_transition"
    assert await _status(database, "video", recording) == "DRAFT"
    assert await _reviews(database, recording) == []
