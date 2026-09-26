"""The answer library (docs/features/response-caching/SPEC.md, group A): migration 006, the admin
routes, the three signed-in user routes, the transition table and the playback usage row.

The auth tests run on the fakes. Everything else needs a disposable PostgreSQL: the transition
table is a guarded UPDATE in a transaction, and a fake cannot show that two changes at once leave
exactly one. The fixture deletes every library row, so never point it at a database whose data
matters. Without the variable below those tests skip.

    docker run -d --rm --name orchestrator-test-pg -e POSTGRES_PASSWORD=test \\
      -e POSTGRES_DB=test -p 127.0.0.1:55433:5432 postgres:16-alpine
    ORCHESTRATOR_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55433/test \\
      pytest services/orchestrator/tests/test_library_api.py
"""

import asyncio
import gc
import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pytest
from fastapi.middleware.cors import CORSMiddleware

from services.orchestrator.src.database import Database
from services.orchestrator.src.errors import AppError
from services.orchestrator.src.library import service
from services.orchestrator.src.library.service import change_entry_status
from services.orchestrator.src.main import app

from .conftest import ADMIN_PHONE, EMBED_KEY, EMBED_ORIGIN, ApiContext

DATABASE_URL = os.environ.get("ORCHESTRATOR_TEST_DATABASE_URL")
MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"

needs_database = pytest.mark.skipif(
    not DATABASE_URL, reason="needs ORCHESTRATOR_TEST_DATABASE_URL, a disposable PostgreSQL"
)

USER_PHONE = "09123456789"
OTHER_PHONE = "09123456780"
QUESTION = "پرسش خصوصی آزمون کتابخانه"
ANSWER = "پاسخ گفتاری تأییدشده آزمون کتابخانه"
ORIGINAL = "پاسخ اصلی و بلند آزمون کتابخانه"
VIDEO_BYTES = b"\x00\x00\x00\x18ftypmp42library-test-bytes"
EXTERNAL_PREFIX = "libtest-"

ADMIN_ENTRY_FIELDS = {
    "id",
    "key",
    "question",
    "answerText",
    "answerOriginal",
    "language",
    "category",
    "categoryTitle",
    "sectionType",
    "technical",
    "status",
    "position",
    "videoAssetId",
    "videoStatus",
    "durationMs",
    "createdAt",
    "publishedAt",
    "withdrawnAt",
}
SUGGESTION_FIELDS = {"id", "question", "answerText", "durationMs"}
STATUSES = ["pending", "ready", "draft", "published", "withdrawn"]

# The REQ-065 table as (from, to, review decision). The import-only row is tested on its own.
TRANSITIONS = [
    ("pending", "ready", "ready"),
    ("ready", "pending", "reopened"),
    ("ready", "draft", "video_attached"),
    ("draft", "ready", "video_rejected"),
    ("draft", "published", "published"),
    ("published", "draft", "unpublished"),
    ("pending", "withdrawn", "withdrawn"),
    ("ready", "withdrawn", "withdrawn"),
    ("draft", "withdrawn", "withdrawn"),
    ("published", "withdrawn", "withdrawn"),
]
REFUSED = [
    (current, target)
    for current in STATUSES
    for target in STATUSES
    if (current, target) not in {(row[0], row[1]) for row in TRANSITIONS}
]


# --- Auth: runs on the fakes, no database needed ----------------------------------------------

ADMIN_ROUTES = [
    ("get", "/admin/library/entries", None),
    ("post", "/admin/library/entries", {"question": "q"}),
    ("patch", f"/admin/library/entries/{uuid4()}", {"question": "q"}),
    ("patch", f"/admin/library/entries/{uuid4()}/status", {"status": "ready"}),
    ("get", "/admin/library/recordings", None),
]
USER_ROUTES = [
    "/library/suggestions?language=fa",
    f"/library/answers/{uuid4()}/video",
    f"/library/answers/{uuid4()}/follow-ups",
]


async def _call(api: ApiContext, method: str, path: str, body=None, headers=None):
    kwargs = {"headers": headers or {}}
    if body is not None:
        kwargs["json"] = body
    return await getattr(api.client, method)(path, **kwargs)


@pytest.mark.parametrize(("method", "path", "body"), ADMIN_ROUTES)
async def test_an_admin_library_route_needs_a_session(api, method, path, body):
    response = await _call(api, method, path, body)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


@pytest.mark.parametrize(("method", "path", "body"), ADMIN_ROUTES)
async def test_an_admin_library_route_refuses_a_user(api, method, path, body):
    token = await api.login(USER_PHONE, platform="native")

    response = await _call(api, method, path, body, {"Authorization": f"Bearer {token}"})

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


@pytest.mark.parametrize("path", USER_ROUTES)
async def test_a_user_library_route_refuses_the_embed_key(api, path):
    response = await api.client.get(path, headers={"X-Embed-Key": EMBED_KEY, "Origin": EMBED_ORIGIN})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


@pytest.mark.parametrize("path", USER_ROUTES)
async def test_a_user_library_route_refuses_a_disabled_account(api, path):
    token = await api.login(USER_PHONE, platform="native")
    user = await api.database.get_user_by_phone("+989123456789")
    await api.database.set_user_status(user["id"], "disabled")

    response = await api.client.get(path, headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "account_disabled"


# --- Real database --------------------------------------------------------------------------


@pytest.fixture
async def database():
    if not DATABASE_URL:
        pytest.skip("needs ORCHESTRATOR_TEST_DATABASE_URL, a disposable PostgreSQL")
    db = Database(DATABASE_URL, MIGRATIONS)
    await db.connect()
    # The library is one shared list (suggestions, recordings), so every test starts it empty.
    await db.pool.execute("DELETE FROM library_entry_reviews")
    await db.pool.execute("DELETE FROM library_entries")
    await db.pool.execute("DELETE FROM video_assets WHERE external_id LIKE $1", f"{EXTERNAL_PREFIX}%")
    try:
        yield db
    finally:
        await db.close()


@dataclass
class Library:
    api: ApiContext
    db: Database
    media: Path
    tokens: dict[str, str] = field(default_factory=dict)

    async def headers(self, phone: str) -> dict[str, str]:
        # One login per phone: a second code request inside a minute is refused.
        if phone not in self.tokens:
            self.tokens[phone] = await self.api.login(phone, platform="native")
        return {"Authorization": f"Bearer {self.tokens[phone]}"}

    async def admin(self) -> dict[str, str]:
        return await self.headers(ADMIN_PHONE)

    async def user(self) -> dict[str, str]:
        return await self.headers(USER_PHONE)

    async def video(
        self,
        *,
        status: str = "VIDEO_APPROVED",
        text: str = ANSWER,
        content: bytes | None = VIDEO_BYTES,
        duration_ms: int = 4200,
    ) -> UUID:
        """A video row. `content` None leaves the file missing; b"" leaves it empty."""
        external_id = f"{EXTERNAL_PREFIX}{uuid4().hex}"
        path = self.media / f"{external_id}.mp4"
        if content is not None:
            path.write_bytes(content)
        return await self.db.pool.fetchval(
            "INSERT INTO video_assets (external_id,text,avatar_id,voice_id,video_path,status,duration_ms) "
            "VALUES ($1,$2,'avatar','voice',$3,$4,$5) RETURNING id",
            external_id,
            text,
            str(path),
            status,
            duration_ms,
        )

    async def entry(
        self,
        status: str = "published",
        *,
        language: str = "fa",
        category: str = "1",
        section_type: str = "identity",
        technical: str = "non-technical",
        question: str = QUESTION,
        answer_text: str | None = ANSWER,
        video_id: UUID | None = None,
        video_status: str | None = None,
        file: bool = True,
        duration_ms: int = 4200,
        auto_video: bool = True,
    ) -> UUID:
        """An entry written straight into the table. A draft or published entry gets a video of
        its own unless `auto_video` is False."""
        if status in ("draft", "published") and video_id is None and auto_video:
            default = "VIDEO_APPROVED" if status == "published" else "VIDEO_GENERATED"
            video_id = await self.video(
                status=video_status or default,
                text=answer_text or ANSWER,
                content=VIDEO_BYTES if file else None,
                duration_ms=duration_ms,
            )
        return await self.db.pool.fetchval(
            """
            INSERT INTO library_entries
              (key,question,answer_text,answer_original,language,category,category_title,
               section_type,technical,video_asset_id,status,position)
            VALUES ($1,$2,$3,$4,$5,$6,'عنوان دسته',$7,$8,$9,$10,
                    (SELECT coalesce(max(position),0)+1 FROM library_entries))
            RETURNING id
            """,
            f"K{uuid4().hex[:12]}",
            question,
            answer_text,
            ORIGINAL,
            language,
            category,
            section_type,
            technical,
            video_id,
            status,
        )

    async def row(self, entry_id: UUID) -> dict:
        return dict(await self.db.pool.fetchrow("SELECT * FROM library_entries WHERE id=$1", entry_id))

    async def reviews(self, entry_id: UUID) -> list[dict]:
        rows = await self.db.pool.fetch(
            "SELECT * FROM library_entry_reviews WHERE entry_id=$1 ORDER BY created_at", entry_id
        )
        return [dict(row) for row in rows]

    async def asset_reviews(self, video_id: UUID) -> list[dict]:
        rows = await self.db.pool.fetch("SELECT * FROM asset_reviews WHERE asset_id=$1", video_id)
        return [dict(row) for row in rows]

    async def video_status(self, video_id: UUID) -> str:
        return await self.db.pool.fetchval("SELECT status FROM video_assets WHERE id=$1", video_id)

    async def usage_rows(self, entry_id: UUID) -> list[dict]:
        rows = await self.db.pool.fetch(
            "SELECT * FROM provider_usage WHERE metadata->>'library_entry_id' = $1", str(entry_id)
        )
        return [dict(row) for row in rows]


@pytest.fixture
async def library(api, database, tmp_path):
    app.state.database = database
    return Library(api, database, tmp_path)


async def _warm_pool(db: Database, size: int) -> None:
    """Open the connections first. With a cold pool the requests run one after another, and a race
    test would pass even for a read-then-write update."""
    connections = [await db.pool.acquire() for _ in range(size)]
    for connection in connections:
        await db.pool.release(connection)


def _log_text(records: list[logging.LogRecord]) -> str:
    return "\n".join(json.dumps(record.__dict__, default=str, ensure_ascii=False) for record in records)


# --- Migration (SC-001) ---------------------------------------------------------------------


async def test_the_migration_adds_both_tables_with_the_spec_columns(library):
    def columns(table: str):
        return library.db.pool.fetch(
            "SELECT column_name, data_type, is_nullable FROM information_schema.columns "
            "WHERE table_name=$1 ORDER BY ordinal_position",
            table,
        )

    entries = {
        row["column_name"]: (row["data_type"], row["is_nullable"]) for row in await columns("library_entries")
    }
    reviews = [row["column_name"] for row in await columns("library_entry_reviews")]
    applied = await library.db.pool.fetchval(
        "SELECT count(*) FROM schema_migrations WHERE version LIKE '006_%'"
    )

    assert entries == {
        "id": ("uuid", "NO"),
        "key": ("text", "NO"),
        "question": ("text", "NO"),
        "answer_text": ("text", "YES"),
        "answer_original": ("text", "YES"),
        "language": ("text", "NO"),
        "category": ("text", "NO"),
        "category_title": ("text", "NO"),
        "section_type": ("text", "NO"),
        "technical": ("text", "NO"),
        "import_metadata": ("jsonb", "NO"),
        "video_asset_id": ("uuid", "YES"),
        "status": ("text", "NO"),
        "position": ("integer", "NO"),
        "created_by": ("uuid", "YES"),
        "created_at": ("timestamp with time zone", "NO"),
        "updated_at": ("timestamp with time zone", "NO"),
        "published_at": ("timestamp with time zone", "YES"),
        "withdrawn_at": ("timestamp with time zone", "YES"),
    }
    # ADR 0014 item 5: reviewer, decision, time, and no text column.
    assert reviews == ["id", "entry_id", "reviewer_id", "decision", "video_asset_id", "created_at"]
    assert applied == 1


@pytest.mark.parametrize(
    ("status", "with_video", "answer_text"),
    [
        ("pending", True, ANSWER),
        ("ready", True, ANSWER),
        ("draft", False, ANSWER),
        ("published", False, ANSWER),
        ("ready", False, None),
        ("draft", True, None),
        ("archived", False, ANSWER),
    ],
)
async def test_the_table_refuses_a_row_its_status_does_not_allow(library, status, with_video, answer_text):
    video_id = await library.video() if with_video else None

    with pytest.raises(asyncpg.CheckViolationError):
        await library.entry(status, video_id=video_id, answer_text=answer_text, auto_video=False)


@pytest.mark.parametrize(
    ("column", "value"),
    [
        ("key", "bad key!"),
        ("question", ""),
        ("answer_text", "ا" * 481),
        ("language", "de"),
        ("section_type", "sales"),
        ("technical", "maybe"),
    ],
)
async def test_the_table_checks_each_value(library, column, value):
    values = {
        "key": "C1Q1",
        "question": QUESTION,
        "answer_text": ANSWER,
        "language": "fa",
        "section_type": "identity",
        "technical": "technical",
    }
    values[column] = value

    with pytest.raises(asyncpg.CheckViolationError):
        await library.db.pool.execute(
            "INSERT INTO library_entries (key,question,answer_text,language,category,category_title,"
            "section_type,technical,status,position) VALUES ($1,$2,$3,$4,'1','t',$5,$6,'pending',1)",
            values["key"],
            values["question"],
            values["answer_text"],
            values["language"],
            values["section_type"],
            values["technical"],
        )


async def test_a_review_row_takes_only_the_known_decisions(library):
    entry_id = await library.entry("pending")

    with pytest.raises(asyncpg.CheckViolationError):
        await library.db.pool.execute(
            "INSERT INTO library_entry_reviews (entry_id, decision) VALUES ($1, 'approved')", entry_id
        )


# --- Suggestions (REQ-011, REQ-012, SC-003, SC-008) ------------------------------------------


async def test_the_suggestions_list_only_servable_entries_in_the_language(library):
    servable = await library.entry("published")
    await library.entry("pending")
    await library.entry("ready")
    await library.entry("draft")
    await library.entry("published", file=False)
    await library.entry("withdrawn", answer_text=None)
    english = await library.entry("published", language="en")
    headers = await library.user()

    results = {}
    for sandbox in (True, False):
        library.api.settings.liveavatar_sandbox = sandbox
        fa = await library.api.client.get("/library/suggestions?language=fa", headers=headers)
        en = await library.api.client.get("/library/suggestions?language=en", headers=headers)
        results[sandbox] = (fa.json(), en.json())

    assert results[True] == results[False]
    fa_body, en_body = results[True]
    assert [item["id"] for item in fa_body["items"]] == [str(servable)]
    assert [item["id"] for item in en_body["items"]] == [str(english)]


async def test_a_suggestion_item_is_the_four_field_allowlist(library):
    entry_id = await library.entry("published", duration_ms=42000)

    response = await library.api.client.get("/library/suggestions?language=fa", headers=await library.user())

    assert response.status_code == 200
    assert response.json() == {
        "items": [{"id": str(entry_id), "question": QUESTION, "answerText": ANSWER, "durationMs": 42000}]
    }


async def test_a_video_that_is_not_approved_is_not_servable(library):
    await library.entry("published", video_status="VIDEO_GENERATED")

    response = await library.api.client.get("/library/suggestions?language=fa", headers=await library.user())

    assert response.json() == {"items": []}


async def test_the_suggestions_open_with_the_first_funnel_stage(library):
    meeting = await library.entry("published", section_type="meeting")
    sizing = await library.entry("published", section_type="sizing")
    knowledge = await library.entry("published", section_type="knowledge")
    commercial = await library.entry("published", section_type="commercial")
    casual = await library.entry("published", section_type="casual")
    identity = await library.entry("published", section_type="identity")

    response = await library.api.client.get("/library/suggestions?language=fa", headers=await library.user())

    assert [item["id"] for item in response.json()["items"]] == [
        str(knowledge),
        str(casual),
        str(identity),
        str(sizing),
        str(meeting),
        str(commercial),
    ]


async def test_the_limit_caps_the_list_and_defaults_to_six(library):
    for _ in range(8):
        await library.entry("published")
    headers = await library.user()

    default = await library.api.client.get("/library/suggestions?language=fa", headers=headers)
    two = await library.api.client.get("/library/suggestions?language=fa&limit=2", headers=headers)
    twenty = await library.api.client.get("/library/suggestions?language=fa&limit=20", headers=headers)

    assert len(default.json()["items"]) == 6
    assert len(two.json()["items"]) == 2
    assert len(twenty.json()["items"]) == 8


async def test_entries_with_a_missing_file_do_not_shorten_the_list(library):
    for _ in range(3):
        await library.entry("published", file=False)
    first = await library.entry("published")
    second = await library.entry("published")

    response = await library.api.client.get(
        "/library/suggestions?language=fa&limit=2", headers=await library.user()
    )

    assert [item["id"] for item in response.json()["items"]] == [str(first), str(second)]


@pytest.mark.parametrize(
    "query", ["", "?language=de", "?language=fa&limit=0", "?language=fa&limit=21", "?language=fa&limit=x"]
)
async def test_a_bad_suggestions_parameter_is_a_validation_error(library, query):
    response = await library.api.client.get(f"/library/suggestions{query}", headers=await library.user())

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


# --- Video and the usage row (REQ-013 to REQ-015, SC-004 to SC-006) --------------------------


async def test_the_video_of_a_servable_entry_is_the_mp4(library):
    entry_id = await library.entry("published")

    response = await library.api.client.get(
        f"/library/answers/{entry_id}/video", headers=await library.user()
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "video/mp4"
    assert response.headers["content-length"] == str(len(VIDEO_BYTES))
    assert response.content == VIDEO_BYTES


async def test_the_video_is_never_stored_by_a_cache(library):
    entry_id = await library.entry("published")

    response = await library.api.client.get(
        f"/library/answers/{entry_id}/video", headers=await library.user()
    )

    assert response.headers["cache-control"] == "private, no-store"


@pytest.mark.parametrize("byte_range", ["bytes=0-0", "bytes=99999999-", "pages=1"])
async def test_a_range_request_still_gets_the_whole_file_and_one_usage_row(library, byte_range):
    """Every client downloads the whole MP4 as a blob, so the route has no partial answer: a 206, a
    416 or a 400 would each have written a usage row for a file nobody received."""
    entry_id = await library.entry("published")

    response = await library.api.client.get(
        f"/library/answers/{entry_id}/video",
        headers={**await library.user(), "Range": byte_range},
    )

    assert response.status_code == 200
    assert response.content == VIDEO_BYTES
    assert "accept-ranges" not in response.headers
    assert "content-range" not in response.headers
    assert len(await library.usage_rows(entry_id)) == 1


async def test_a_file_that_vanishes_before_it_opens_writes_no_row(library, monkeypatch):
    entry_id = await library.entry("published")
    servable_entry = service.servable_entry

    async def servable_then_deleted(database, wanted):
        row = await servable_entry(database, wanted)
        Path(row["video_path"]).unlink()
        return row

    monkeypatch.setattr(service, "servable_entry", servable_then_deleted)

    response = await library.api.client.get(
        f"/library/answers/{entry_id}/video", headers=await library.user()
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert await library.usage_rows(entry_id) == []


async def _play_and_leave(entry_id: UUID, headers: dict[str, str], spec_version: str) -> list[dict]:
    """Drive the real app the way a server does, and leave after the first chunk of the body.

    Before ASGI 2.4 the server reports the leave as an `http.disconnect` message; from 2.4 on the
    next `send` raises OSError. Returns the messages the app sent.
    """
    first_chunk = asyncio.Event()
    sent: list[dict] = []
    calls = 0

    async def receive() -> dict:
        nonlocal calls
        calls += 1
        if calls == 1:
            return {"type": "http.request", "body": b"", "more_body": False}
        await first_chunk.wait()
        return {"type": "http.disconnect"}

    async def send(message: dict) -> None:
        if first_chunk.is_set():
            if spec_version >= "2.4":
                raise OSError("the client went away")
            # A stalled socket: the disconnect message cancels the response while it waits here.
            await asyncio.sleep(1)
        sent.append(message)
        if message["type"] == "http.response.body" and message.get("more_body"):
            first_chunk.set()

    path = f"/library/answers/{entry_id}/video"
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": spec_version},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [(b"host", b"test"), *[(k.lower().encode(), v.encode()) for k, v in headers.items()]],
        "client": ("127.0.0.1", 50000),
        "server": ("test", 80),
    }
    try:
        await app(scope, receive, send)
    except Exception as exc:  # noqa: BLE001 - a server swallows the disconnect the same way
        if spec_version < "2.4":
            raise
        assert isinstance(exc, OSError) or type(exc).__name__ == "ClientDisconnect", exc
    return sent


@pytest.mark.parametrize("spec_version", ["2.3", "2.4"])
async def test_a_client_that_leaves_mid_download_leaves_the_file_closed(library, monkeypatch, spec_version):
    """The file closes when the response ends, not at the next garbage collection: a server that
    serves many aborted downloads must not run out of file handles."""
    entry_id = await library.entry("published")
    video_id = (await library.row(entry_id))["video_asset_id"]
    video_path = await library.db.pool.fetchval("SELECT video_path FROM video_assets WHERE id=$1", video_id)
    size = 4 * service.VIDEO_CHUNK_BYTES
    Path(video_path).write_bytes(b"\x00" * size)
    headers = await library.user()
    opened = []
    open_video = service.open_video

    async def spy(entry):
        result = await open_video(entry)
        opened.append(result[0])
        return result

    monkeypatch.setattr(service, "open_video", spy)

    gc.disable()
    try:
        sent = await _play_and_leave(entry_id, headers, spec_version)
        [handle] = opened
        is_closed = handle.closed
    finally:
        gc.enable()

    assert sent[0]["type"] == "http.response.start" and sent[0]["status"] == 200
    delivered = sum(len(message.get("body", b"")) for message in sent[1:])
    assert 0 < delivered < size
    assert is_closed


async def test_a_finished_download_leaves_the_file_closed(library, monkeypatch):
    entry_id = await library.entry("published")
    headers = await library.user()
    opened = []
    open_video = service.open_video

    async def spy(entry):
        result = await open_video(entry)
        opened.append(result[0])
        return result

    monkeypatch.setattr(service, "open_video", spy)

    gc.disable()
    try:
        response = await library.api.client.get(f"/library/answers/{entry_id}/video", headers=headers)
        [handle] = opened
        is_closed = handle.closed
    finally:
        gc.enable()

    assert response.content == VIDEO_BYTES
    assert is_closed


async def test_every_entry_that_is_not_servable_answers_the_same_404(library):
    others = [
        await library.entry("pending"),
        await library.entry("ready"),
        await library.entry("draft"),
        await library.entry("published", file=False),
        await library.entry("published", video_status="VIDEO_GENERATED"),
        await library.entry("withdrawn", answer_text=None),
        uuid4(),
    ]
    headers = await library.user()

    bodies = []
    for entry_id in others:
        response = await library.api.client.get(f"/library/answers/{entry_id}/video", headers=headers)
        assert response.status_code == 404
        bodies.append(response.json()["error"])
        assert await library.usage_rows(entry_id) == []

    assert bodies[0]["code"] == "not_found"
    assert all(body == bodies[0] for body in bodies)


async def test_a_played_answer_writes_one_usage_row_with_no_user(library):
    entry_id = await library.entry("published", duration_ms=42000)
    headers = await library.user()

    await library.api.client.get(f"/library/answers/{entry_id}/video", headers=headers)
    await library.api.client.get(f"/library/answers/{entry_id}/video", headers=headers)

    rows = await library.usage_rows(entry_id)
    assert len(rows) == 2
    row = rows[0]
    assert row["provider"] == "liveavatar"
    assert row["operation"] == "assistant_answer"
    assert row["provider_resource_id"] is None
    assert row["model"] is None
    assert row["characters"] is None
    assert row["estimated_duration_ms"] == 42000
    assert row["cache_hit"] is True
    assert row["occurred_at"] is not None
    assert json.loads(row["metadata"]) == {"library_entry_id": str(entry_id), "source": "library"}


async def test_the_usage_summary_counts_a_played_answer_as_a_cache_hit(library):
    entry_id = await library.entry("published")
    admin = await library.admin()

    async def cache_hits() -> int:
        items = (await library.api.client.get("/usage", headers=admin)).json()["items"]
        return next(
            (
                item["cache_hits"]
                for item in items
                if (item["provider"], item["operation"]) == ("liveavatar", "assistant_answer")
            ),
            0,
        )

    before = await cache_hits()
    await library.api.client.get(f"/library/answers/{entry_id}/video", headers=await library.user())

    assert await cache_hits() == before + 1


async def test_the_61st_play_in_an_hour_is_rate_limited(library):
    entry_id = await library.entry("published")
    headers = await library.user()

    for _ in range(60):
        response = await library.api.client.get(f"/library/answers/{entry_id}/video", headers=headers)
        assert response.status_code == 200
    limited = await library.api.client.get(f"/library/answers/{entry_id}/video", headers=headers)

    assert limited.status_code == 429
    error = limited.json()["error"]
    assert error["code"] == "library_rate_limited"
    assert error["retryable"] is True
    wait = error["details"]["retryAfterSeconds"]
    assert 0 < wait <= 3600
    assert limited.headers["Retry-After"] == str(wait)
    assert len(await library.usage_rows(entry_id)) == 60


async def test_the_play_limit_counts_each_user_on_their_own(library):
    library.api.settings.library_playback_rate_limit_per_hour = 1
    entry_id = await library.entry("published")
    user = await library.user()
    other = await library.headers(OTHER_PHONE)

    first = await library.api.client.get(f"/library/answers/{entry_id}/video", headers=user)
    second = await library.api.client.get(f"/library/answers/{entry_id}/video", headers=user)
    other_first = await library.api.client.get(f"/library/answers/{entry_id}/video", headers=other)

    assert (first.status_code, second.status_code, other_first.status_code) == (200, 429, 200)
    user_id = (await library.db.get_user_by_phone("+989123456789"))["id"]
    assert await library.api.redis.get(f"ratelimit:library:user:{user_id}") == "2"


# --- Follow-ups (REQ-077, SC-035) -----------------------------------------------------------


async def _follow_ups(library: Library, entry_id: UUID):
    return await library.api.client.get(
        f"/library/answers/{entry_id}/follow-ups", headers=await library.user()
    )


async def test_a_first_stage_answer_is_followed_by_second_stage_answers(library):
    played = await library.entry("published", section_type="identity", category="3")
    sizing = [await library.entry("published", section_type="sizing", category="3") for _ in range(4)]
    await library.entry("published", section_type="identity", category="3")
    await library.entry("published", section_type="meeting", category="3")
    await library.entry("published", section_type="sizing", category="4")
    await library.entry("published", section_type="sizing", category="3", language="en")
    await library.entry("draft", section_type="sizing", category="3")

    response = await _follow_ups(library, played)

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body["items"]] == [str(entry) for entry in sizing[:3]]
    assert all(set(item) == SUGGESTION_FIELDS for item in body["items"])


async def test_a_casual_answer_counts_as_the_first_stage(library):
    played = await library.entry("published", section_type="casual")
    sizing = await library.entry("published", section_type="sizing")
    await library.entry("published", section_type="knowledge")

    response = await _follow_ups(library, played)

    assert [item["id"] for item in response.json()["items"]] == [str(sizing)]


async def test_a_second_stage_answer_is_followed_by_third_stage_answers(library):
    played = await library.entry("published", section_type="sizing")
    meeting = await library.entry("published", section_type="meeting")
    commercial = await library.entry("published", section_type="commercial")
    await library.entry("published", section_type="sizing")

    response = await _follow_ups(library, played)

    assert [item["id"] for item in response.json()["items"]] == [str(meeting), str(commercial)]


async def test_a_third_stage_answer_is_followed_by_other_third_stage_answers(library):
    played = await library.entry("published", section_type="commercial")
    meeting = await library.entry("published", section_type="meeting")
    await library.entry("published", section_type="sizing")

    response = await _follow_ups(library, played)

    assert [item["id"] for item in response.json()["items"]] == [str(meeting)]


async def test_technical_never_changes_the_follow_ups(library):
    played = await library.entry("published", section_type="identity", technical="technical")
    technical = await library.entry("published", section_type="sizing", technical="technical")
    plain = await library.entry("published", section_type="sizing", technical="non-technical")
    unsure = await library.entry("published", section_type="sizing", technical="classify")

    response = await _follow_ups(library, played)

    assert [item["id"] for item in response.json()["items"]] == [str(technical), str(plain), str(unsure)]


async def test_no_deeper_answer_is_an_empty_list(library):
    played = await library.entry("published", section_type="identity")

    response = await _follow_ups(library, played)

    assert response.status_code == 200
    assert response.json() == {"items": []}


async def test_the_follow_ups_of_an_entry_that_is_not_servable_are_404(library):
    draft = await library.entry("draft", section_type="identity")
    await library.entry("published", section_type="sizing")

    for entry_id in (draft, uuid4()):
        response = await _follow_ups(library, entry_id)
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"


async def test_the_follow_ups_write_no_usage_row(library):
    played = await library.entry("published", section_type="identity")

    await _follow_ups(library, played)

    assert await library.usage_rows(played) == []


# --- Admin list (REQ-009) -------------------------------------------------------------------


async def test_the_admin_list_pages_newest_first_with_the_full_entry(library):
    ids = [await library.entry("pending") for _ in range(3)]
    published = await library.entry("published", duration_ms=5100)
    admin = await library.admin()

    first = await library.api.client.get("/admin/library/entries?pageSize=2", headers=admin)
    second = await library.api.client.get("/admin/library/entries?pageSize=2&page=2", headers=admin)

    assert first.status_code == 200
    body = first.json()
    assert (body["total"], body["page"], body["pageSize"]) == (4, 1, 2)
    assert [item["id"] for item in body["items"]] == [str(published), str(ids[2])]
    assert [item["id"] for item in second.json()["items"]] == [str(ids[1]), str(ids[0])]
    item = body["items"][0]
    assert set(item) == ADMIN_ENTRY_FIELDS
    assert item["status"] == "published"
    assert item["videoStatus"] == "VIDEO_APPROVED"
    assert item["durationMs"] == 5100
    assert item["answerOriginal"] == ORIGINAL
    assert item["categoryTitle"] == "عنوان دسته"
    pending = body["items"][1]
    assert (pending["videoAssetId"], pending["videoStatus"], pending["durationMs"]) == (None, None, None)


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("status=ready", "ready"),
        ("language=en", "english"),
        ("category=7", "category"),
        ("sectionType=sizing", "sizing"),
        ("technical=classify", "classify"),
        ("q=FINDME", "by_key"),
    ],
)
async def test_the_admin_list_filters(library, query, expected):
    entries = {
        "ready": await library.entry("ready"),
        "english": await library.entry("pending", language="en"),
        "category": await library.entry("pending", category="7"),
        "sizing": await library.entry("pending", section_type="sizing"),
        "classify": await library.entry("pending", technical="classify"),
        "by_key": await library.entry("pending"),
    }
    await library.db.pool.execute("UPDATE library_entries SET key='FINDME_1' WHERE id=$1", entries["by_key"])

    response = await library.api.client.get(f"/admin/library/entries?{query}", headers=await library.admin())

    assert [item["id"] for item in response.json()["items"]] == [str(entries[expected])]
    # The count runs its own query with the same filters.
    assert response.json()["total"] == 1


async def test_the_admin_search_also_matches_the_question(library):
    wanted = await library.entry("pending", question="چطور نوبت بگیرم؟")
    await library.entry("pending")

    response = await library.api.client.get("/admin/library/entries?q=نوبت", headers=await library.admin())

    assert [item["id"] for item in response.json()["items"]] == [str(wanted)]


@pytest.mark.parametrize(
    "query",
    ["status=archived", "language=de", "sectionType=sales", "technical=maybe", "pageSize=101", "page=0"],
)
async def test_a_bad_admin_list_parameter_is_a_validation_error(library, query):
    response = await library.api.client.get(f"/admin/library/entries?{query}", headers=await library.admin())

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


# --- Create (REQ-004) -----------------------------------------------------------------------


def _new_entry(**overrides) -> dict:
    body = {
        "question": QUESTION,
        "language": "fa",
        "category": "18",
        "categoryTitle": "عنوان دسته",
        "sectionType": "knowledge",
        "technical": "technical",
        "key": "C18Q05",
    }
    body.update(overrides)
    return body


async def test_creating_with_text_makes_a_pending_entry_at_the_end(library, caplog):
    await library.entry("pending")
    admin = await library.admin()
    caplog.set_level(logging.INFO)

    response = await library.api.client.post(
        "/admin/library/entries",
        json=_new_entry(answerText=f"  {ANSWER}  \n", answerOriginal=ORIGINAL),
        headers=admin,
    )

    assert response.status_code == 201
    body = response.json()
    assert set(body) == ADMIN_ENTRY_FIELDS
    assert body["status"] == "pending"
    assert body["answerText"] == ANSWER
    assert body["answerOriginal"] == ORIGINAL
    assert (body["key"], body["category"], body["sectionType"]) == ("C18Q05", "18", "knowledge")
    assert body["position"] == 2
    row = await library.row(UUID(body["id"]))
    admin_user = await library.db.get_user_by_phone(ADMIN_PHONE)
    assert row["created_by"] == admin_user["id"]
    assert await library.reviews(row["id"]) == []
    [created] = [record for record in caplog.records if record.getMessage() == "library_entry_created"]
    assert created.entry_id == body["id"]
    assert created.admin_id == str(admin_user["id"])
    assert QUESTION not in _log_text(caplog.records)
    assert ANSWER not in _log_text(caplog.records)


async def test_creating_without_an_answer_leaves_it_empty(library):
    response = await library.api.client.post(
        "/admin/library/entries", json=_new_entry(), headers=await library.admin()
    )

    assert response.status_code == 201
    assert (response.json()["answerText"], response.json()["answerOriginal"]) == (None, None)


async def test_creating_from_a_recording_makes_a_draft_with_its_text_and_name(library):
    video_id = await library.video(status="VIDEO_GENERATED", text=f"{ANSWER}\n  ", duration_ms=3300)
    external_id = await library.db.pool.fetchval("SELECT external_id FROM video_assets WHERE id=$1", video_id)
    body = _new_entry(videoAssetId=str(video_id))
    del body["key"]

    response = await library.api.client.post(
        "/admin/library/entries", json=body, headers=await library.admin()
    )

    assert response.status_code == 201
    entry = response.json()
    assert entry["status"] == "draft"
    assert entry["key"] == external_id
    assert entry["answerText"] == ANSWER
    assert entry["videoAssetId"] == str(video_id)
    assert (entry["videoStatus"], entry["durationMs"]) == ("VIDEO_GENERATED", 3300)


@pytest.mark.parametrize(
    ("video", "status", "code"),
    [
        ({"status": "DRAFT"}, 409, "library_video_not_ready"),
        ({"status": "VIDEO_APPROVED"}, 409, "library_video_not_ready"),
        ({"status": "VIDEO_GENERATED", "content": None}, 409, "library_video_not_ready"),
        ({"status": "VIDEO_GENERATED", "content": b""}, 409, "library_video_not_ready"),
        ({"status": "VIDEO_GENERATED", "text": "ب" * 481}, 422, "validation_error"),
    ],
)
async def test_a_recording_that_cannot_join_is_refused(library, video, status, code):
    video_id = await library.video(**video)

    response = await library.api.client.post(
        "/admin/library/entries", json=_new_entry(videoAssetId=str(video_id)), headers=await library.admin()
    )

    assert response.status_code == status
    assert response.json()["error"]["code"] == code
    assert await library.db.pool.fetchval("SELECT count(*) FROM library_entries") == 0


async def test_a_recording_another_entry_uses_is_refused(library):
    draft = await library.entry("draft")
    used = (await library.row(draft))["video_asset_id"]
    await library.db.pool.execute("UPDATE video_assets SET status='VIDEO_GENERATED' WHERE id=$1", used)

    response = await library.api.client.post(
        "/admin/library/entries", json=_new_entry(videoAssetId=str(used)), headers=await library.admin()
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "library_video_in_use"


async def test_an_unknown_recording_is_404(library):
    response = await library.api.client.post(
        "/admin/library/entries", json=_new_entry(videoAssetId=str(uuid4())), headers=await library.admin()
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


async def test_a_taken_key_is_refused(library):
    admin = await library.admin()
    await library.api.client.post("/admin/library/entries", json=_new_entry(), headers=admin)

    response = await library.api.client.post("/admin/library/entries", json=_new_entry(), headers=admin)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "library_key_taken"


@pytest.mark.parametrize(
    "body",
    [
        {k: v for k, v in _new_entry().items() if k != "key"},
        _new_entry(key="bad key"),
        _new_entry(question=" "),
        _new_entry(question="پ" * 301),
        _new_entry(answerText="ا" * 481),
        _new_entry(answerText="   "),
        _new_entry(answerText=ANSWER, videoAssetId=str(uuid4())),
        _new_entry(language="de"),
        _new_entry(sectionType="sales"),
        _new_entry(technical="maybe"),
        _new_entry(category=""),
        _new_entry(status="published"),
        _new_entry(section_type="knowledge"),
        {k: v for k, v in _new_entry().items() if k != "question"},
    ],
)
async def test_a_bad_create_body_is_a_validation_error(library, body):
    response = await library.api.client.post(
        "/admin/library/entries", json=body, headers=await library.admin()
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert await library.db.pool.fetchval("SELECT count(*) FROM library_entries") == 0


async def test_the_answer_length_is_counted_after_normalizing_whitespace(library):
    spaced = "  ".join(["ا" * 240, "ب" * 239])

    response = await library.api.client.post(
        "/admin/library/entries", json=_new_entry(answerText=f"\n{spaced} "), headers=await library.admin()
    )

    assert response.status_code == 201
    assert len(response.json()["answerText"]) == 480


# --- Edit in place (REQ-005, SC-028) --------------------------------------------------------


async def test_every_text_field_of_a_pending_entry_can_change(library, caplog):
    entry_id = await library.entry("pending", answer_text=None)
    caplog.set_level(logging.INFO)
    changes = {
        "question": "پرسش تازه",
        "answerText": "  پاسخ   تازه ",
        "language": "en",
        "category": "9",
        "categoryTitle": "دسته تازه",
        "sectionType": "meeting",
        "technical": "classify",
    }

    response = await library.api.client.patch(
        f"/admin/library/entries/{entry_id}", json=changes, headers=await library.admin()
    )

    assert response.status_code == 200
    body = response.json()
    assert body["answerText"] == "پاسخ تازه"
    assert (body["question"], body["language"], body["category"]) == ("پرسش تازه", "en", "9")
    assert (body["categoryTitle"], body["sectionType"], body["technical"]) == (
        "دسته تازه",
        "meeting",
        "classify",
    )
    assert body["status"] == "pending"
    [edited] = [record for record in caplog.records if record.getMessage() == "library_entry_edited"]
    assert sorted(edited.fields) == sorted(
        ["question", "answer_text", "language", "category", "category_title", "section_type", "technical"]
    )
    assert "پرسش تازه" not in _log_text(caplog.records)
    assert "پاسخ تازه" not in _log_text(caplog.records)


async def test_a_pending_answer_can_be_cleared(library):
    entry_id = await library.entry("pending")

    response = await library.api.client.patch(
        f"/admin/library/entries/{entry_id}", json={"answerText": None}, headers=await library.admin()
    )

    assert response.status_code == 200
    assert response.json()["answerText"] is None


@pytest.mark.parametrize("status", ["ready", "draft"])
async def test_the_question_and_category_fields_stay_editable_with_the_text_locked(library, status):
    entry_id = await library.entry(status)
    before = await library.row(entry_id)

    response = await library.api.client.patch(
        f"/admin/library/entries/{entry_id}",
        json={"question": "پرسش اصلاح‌شده", "sectionType": "sizing"},
        headers=await library.admin(),
    )

    assert response.status_code == 200
    after = await library.row(entry_id)
    assert (after["question"], after["section_type"]) == ("پرسش اصلاح‌شده", "sizing")
    assert (after["status"], after["video_asset_id"]) == (before["status"], before["video_asset_id"])
    assert await library.reviews(entry_id) == []


@pytest.mark.parametrize(
    ("status", "change"),
    [
        ("ready", {"answerText": "متن دیگر"}),
        ("ready", {"language": "en"}),
        ("draft", {"answerText": "متن دیگر"}),
        ("draft", {"question": "پرسش", "language": "en"}),
        ("published", {"question": "پرسش"}),
        ("published", {"technical": "technical"}),
        ("withdrawn", {"question": "پرسش"}),
    ],
)
async def test_a_locked_field_is_refused_with_the_current_status(library, status, change):
    entry_id = await library.entry(status, answer_text=None if status == "withdrawn" else ANSWER)
    before = await library.row(entry_id)

    response = await library.api.client.patch(
        f"/admin/library/entries/{entry_id}", json=change, headers=await library.admin()
    )

    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "invalid_status_transition"
    assert error["details"] == {"currentStatus": status}
    assert await library.row(entry_id) == before


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"question": None},
        {"language": None},
        {"answerText": "ا" * 481},
        {"status": "ready"},
        {"answer_text": ANSWER},
        {"key": "OTHER"},
    ],
)
async def test_a_bad_edit_is_a_validation_error(library, body):
    entry_id = await library.entry("pending")

    response = await library.api.client.patch(
        f"/admin/library/entries/{entry_id}", json=body, headers=await library.admin()
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


async def test_editing_an_unknown_entry_is_404(library):
    response = await library.api.client.patch(
        f"/admin/library/entries/{uuid4()}", json={"question": "x"}, headers=await library.admin()
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


# --- The status route (REQ-006 to REQ-008, REQ-065 to REQ-069, SC-002, SC-027, SC-029) --------


async def _status(library: Library, entry_id: UUID, body: dict, headers=None):
    return await library.api.client.patch(
        f"/admin/library/entries/{entry_id}/status", json=body, headers=headers or await library.admin()
    )


@pytest.mark.parametrize(("current", "target", "decision"), TRANSITIONS)
async def test_every_row_of_the_transition_table_moves_and_writes_one_review(
    library, current, target, decision
):
    entry_id = await library.entry(current)
    body = {"status": target}
    video_id = None
    if decision == "video_attached":
        video_id = await library.video(status="VIDEO_GENERATED")
        body["videoAssetId"] = str(video_id)
    before = await library.row(entry_id)

    response = await _status(library, entry_id, body)

    assert response.status_code == 200, response.text
    assert set(response.json()) == ADMIN_ENTRY_FIELDS
    assert response.json()["status"] == target
    after = await library.row(entry_id)
    assert after["status"] == target
    [review] = await library.reviews(entry_id)
    admin = await library.db.get_user_by_phone(ADMIN_PHONE)
    assert (review["decision"], review["reviewer_id"]) == (decision, admin["id"])
    if decision == "video_attached":
        assert after["video_asset_id"] == video_id == review["video_asset_id"]
    elif decision == "video_rejected":
        assert after["video_asset_id"] is None
        assert review["video_asset_id"] == before["video_asset_id"]
    else:
        assert review["video_asset_id"] is None
        assert after["video_asset_id"] == before["video_asset_id"]
    if target == "published":
        assert after["published_at"] is not None
    if target == "withdrawn":
        assert after["withdrawn_at"] is not None


@pytest.mark.parametrize(("current", "target"), REFUSED)
async def test_every_other_pair_is_refused_and_changes_nothing(library, current, target):
    entry_id = await library.entry(current, answer_text=None if current == "withdrawn" else ANSWER)
    body = {"status": target}
    if target == "draft" and current == "pending":
        # The import-only row: the status route refuses it even with a video.
        body["videoAssetId"] = str(await library.video(status="VIDEO_GENERATED"))
    before = await library.row(entry_id)

    response = await _status(library, entry_id, body)

    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "invalid_status_transition"
    assert error["details"] == {"currentStatus": current}
    assert await library.row(entry_id) == before
    assert await library.reviews(entry_id) == []


async def test_two_changes_at_once_leave_exactly_one(library):
    await _warm_pool(library.db, 10)
    entries = [await library.entry("draft") for _ in range(4)]
    admin = await library.admin()

    responses = await asyncio.gather(
        *[
            _status(library, entry_id, {"status": "published"}, admin)
            for entry_id in entries
            for _ in range(2)
        ]
    )

    for index, entry_id in enumerate(entries):
        pair = responses[2 * index : 2 * index + 2]
        assert sorted(response.status_code for response in pair) == [200, 409]
        assert len(await library.reviews(entry_id)) == 1
        video_id = (await library.row(entry_id))["video_asset_id"]
        assert len(await library.asset_reviews(video_id)) == 1


async def test_publishing_approves_a_generated_video_with_both_audit_rows(library):
    entry_id = await library.entry("draft")
    video_id = (await library.row(entry_id))["video_asset_id"]

    response = await _status(library, entry_id, {"status": "published"})

    assert response.status_code == 200
    assert response.json()["videoStatus"] == "VIDEO_APPROVED"
    assert await library.video_status(video_id) == "VIDEO_APPROVED"
    [asset_review] = await library.asset_reviews(video_id)
    admin = await library.db.get_user_by_phone(ADMIN_PHONE)
    assert (asset_review["decision"], asset_review["previous_status"]) == (
        "VIDEO_APPROVED",
        "VIDEO_GENERATED",
    )
    assert asset_review["reviewer_user_id"] == admin["id"]
    assert [review["decision"] for review in await library.reviews(entry_id)] == ["published"]


async def test_publishing_an_approved_video_approves_nothing_again(library):
    entry_id = await library.entry("draft", video_status="VIDEO_APPROVED")
    video_id = (await library.row(entry_id))["video_asset_id"]

    response = await _status(library, entry_id, {"status": "published"})

    assert response.status_code == 200
    assert await library.asset_reviews(video_id) == []


@pytest.mark.parametrize(
    ("video_status", "file"), [("DRAFT", True), ("REJECTED", True), ("VIDEO_GENERATED", False)]
)
async def test_publishing_without_a_ready_video_changes_nothing(library, video_status, file):
    entry_id = await library.entry("draft", video_status=video_status, file=file)
    video_id = (await library.row(entry_id))["video_asset_id"]
    before = await library.row(entry_id)

    response = await _status(library, entry_id, {"status": "published"})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "library_video_not_ready"
    assert await library.row(entry_id) == before
    assert await library.video_status(video_id) == video_status
    assert await library.asset_reviews(video_id) == []
    assert await library.reviews(entry_id) == []


async def test_unpublishing_keeps_the_approval_so_a_new_publish_needs_none(library):
    entry_id = await library.entry("draft")
    video_id = (await library.row(entry_id))["video_asset_id"]

    for target in ("published", "draft", "published"):
        assert (await _status(library, entry_id, {"status": target})).status_code == 200

    assert await library.video_status(video_id) == "VIDEO_APPROVED"
    assert len(await library.asset_reviews(video_id)) == 1
    assert [row["decision"] for row in await library.reviews(entry_id)] == [
        "published",
        "unpublished",
        "published",
    ]


@pytest.mark.parametrize("video_status", ["VIDEO_GENERATED", "VIDEO_APPROVED"])
async def test_rejecting_the_video_rejects_it_and_keeps_the_text(library, video_status):
    entry_id = await library.entry("draft", video_status=video_status)
    video_id = (await library.row(entry_id))["video_asset_id"]

    response = await _status(library, entry_id, {"status": "ready"})

    assert response.status_code == 200
    after = await library.row(entry_id)
    assert (after["status"], after["video_asset_id"], after["answer_text"]) == ("ready", None, ANSWER)
    assert await library.video_status(video_id) == "REJECTED"
    [asset_review] = await library.asset_reviews(video_id)
    assert (asset_review["decision"], asset_review["previous_status"]) == ("REJECTED", video_status)


async def test_marking_ready_needs_an_answer_text(library):
    entry_id = await library.entry("pending", answer_text=None)

    response = await _status(library, entry_id, {"status": "ready"})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert (await library.row(entry_id))["status"] == "pending"
    assert await library.reviews(entry_id) == []


async def test_attaching_needs_a_video_id(library):
    entry_id = await library.entry("ready")

    response = await _status(library, entry_id, {"status": "draft"})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


async def test_attaching_accepts_the_same_text_with_other_whitespace(library):
    entry_id = await library.entry("ready")
    video_id = await library.video(status="VIDEO_GENERATED", text=f"  {ANSWER.replace(' ', '   ')}\n")

    response = await _status(library, entry_id, {"status": "draft", "videoAssetId": str(video_id)})

    assert response.status_code == 200
    assert response.json()["videoAssetId"] == str(video_id)


@pytest.mark.parametrize(
    ("video", "code"),
    [
        ({"status": "VIDEO_GENERATED", "text": "متن دیگری که گفته شد"}, "library_text_mismatch"),
        ({"status": "DRAFT"}, "library_video_not_ready"),
        ({"status": "VIDEO_APPROVED"}, "library_video_not_ready"),
        ({"status": "REJECTED"}, "library_video_not_ready"),
        ({"status": "VIDEO_GENERATED", "content": None}, "library_video_not_ready"),
        ({"status": "VIDEO_GENERATED", "content": b""}, "library_video_not_ready"),
    ],
)
async def test_a_video_that_cannot_join_the_entry_is_refused(library, video, code):
    entry_id = await library.entry("ready")
    video_id = await library.video(**video)
    before = await library.row(entry_id)

    response = await _status(library, entry_id, {"status": "draft", "videoAssetId": str(video_id)})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == code
    assert await library.row(entry_id) == before
    assert await library.reviews(entry_id) == []


async def test_attaching_a_video_another_entry_uses_is_refused(library):
    other = await library.entry("draft")
    used = (await library.row(other))["video_asset_id"]
    entry_id = await library.entry("ready")

    response = await _status(library, entry_id, {"status": "draft", "videoAssetId": str(used)})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "library_video_in_use"


async def test_attaching_an_unknown_video_is_404(library):
    entry_id = await library.entry("ready")

    response = await _status(library, entry_id, {"status": "draft", "videoAssetId": str(uuid4())})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"status": "archived"},
        {"status": "published", "videoAssetId": str(uuid4())},
        {"status": "ready", "video_asset_id": str(uuid4())},
        {"status": "ready", "note": "x"},
        {"status": "ready", "fromStatus": "archived"},
        {"status": "ready", "from_status": "pending"},
    ],
)
async def test_a_bad_status_body_is_a_validation_error(library, body):
    entry_id = await library.entry("pending")

    response = await _status(library, entry_id, body)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


async def test_a_video_id_is_refused_when_unpublishing(library):
    entry_id = await library.entry("published")

    response = await _status(library, entry_id, {"status": "draft", "videoAssetId": str(uuid4())})

    assert response.status_code == 422
    assert (await library.row(entry_id))["status"] == "published"


async def test_a_stale_mark_ready_with_its_from_status_leaves_the_video_alone(library):
    """Target `ready` means "mark ready" from pending and "reject the video" from draft. An admin
    whose screen still shows pending must not reject a video another admin attached meanwhile."""
    entry_id = await library.entry("pending")
    video_id = await library.video(status="VIDEO_GENERATED")
    other_admin = await library.headers(OTHER_PHONE)
    other = await library.db.get_user_by_phone("+989123456780")
    await library.db.set_user_role(other["id"], "admin")
    await _status(library, entry_id, {"status": "ready", "fromStatus": "pending"}, other_admin)
    await _status(library, entry_id, {"status": "draft", "videoAssetId": str(video_id)}, other_admin)
    before = await library.row(entry_id)

    stale = await _status(library, entry_id, {"status": "ready", "fromStatus": "pending"})

    assert stale.status_code == 409
    error = stale.json()["error"]
    assert error["code"] == "invalid_status_transition"
    assert error["details"] == {"currentStatus": "draft"}
    assert await library.row(entry_id) == before
    assert await library.video_status(video_id) == "VIDEO_GENERATED"
    assert await library.asset_reviews(video_id) == []
    assert [row["decision"] for row in await library.reviews(entry_id)] == ["ready", "video_attached"]


async def test_without_from_status_a_stale_mark_ready_still_rejects_the_video(library):
    """Without fromStatus the route keeps its old meaning: the target and the current status."""
    entry_id = await library.entry("draft")
    video_id = (await library.row(entry_id))["video_asset_id"]

    response = await _status(library, entry_id, {"status": "ready"})

    assert response.status_code == 200
    assert await library.video_status(video_id) == "REJECTED"


async def test_a_matching_from_status_changes_the_entry(library):
    entry_id = await library.entry("draft")

    response = await _status(library, entry_id, {"status": "published", "fromStatus": "draft"})

    assert response.status_code == 200
    assert response.json()["status"] == "published"


@pytest.mark.parametrize("from_status", ["pending", "ready", "published", "withdrawn"])
async def test_a_wrong_from_status_changes_nothing(library, from_status):
    entry_id = await library.entry("draft")
    before = await library.row(entry_id)

    response = await _status(library, entry_id, {"status": "withdrawn", "fromStatus": from_status})

    assert response.status_code == 409
    assert response.json()["error"]["details"] == {"currentStatus": "draft"}
    assert await library.row(entry_id) == before
    assert await library.reviews(entry_id) == []


async def test_the_review_rows_keep_the_order_the_changes_happened_in(library, monkeypatch):
    """A change whose transaction began first, but that waited for the row, happened second: its
    review row and its withdrawn_at must say so."""
    entry_id = await library.entry("pending")
    await library.admin()
    admin = await library.db.get_user_by_phone(ADMIN_PHONE)
    waiting, go = asyncio.Event(), asyncio.Event()
    lock_library_entry = library.db.lock_library_entry
    calls = 0

    async def slow_first_lock(conn, wanted):
        nonlocal calls
        calls += 1
        if calls == 1:
            waiting.set()
            await go.wait()
        return await lock_library_entry(conn, wanted)

    monkeypatch.setattr(library.db, "lock_library_entry", slow_first_lock)

    # The withdraw starts its transaction first, then waits before it locks the entry.
    withdraw = asyncio.create_task(
        change_entry_status(library.db, entry_id, "withdrawn", reviewer_id=admin["id"])
    )
    await waiting.wait()
    await asyncio.sleep(0.05)
    await change_entry_status(library.db, entry_id, "ready", reviewer_id=admin["id"])
    go.set()
    await withdraw

    reviews = sorted(await library.reviews(entry_id), key=lambda row: row["created_at"])
    assert [row["decision"] for row in reviews] == ["ready", "withdrawn"]
    assert (await library.row(entry_id))["withdrawn_at"] >= reviews[0]["created_at"]


def test_the_browser_may_read_the_retry_after_header():
    """The web and admin targets call the API from their own origin, so a header the browser must
    read has to be exposed by CORS."""
    cors = next(middleware for middleware in app.user_middleware if middleware.cls is CORSMiddleware)

    assert "Retry-After" in cors.kwargs["expose_headers"]


async def test_the_status_of_an_unknown_entry_is_404(library):
    response = await _status(library, uuid4(), {"status": "withdrawn"})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


async def test_a_status_change_logs_ids_and_statuses_only(library, caplog):
    entry_id = await library.entry("pending")
    caplog.set_level(logging.INFO)

    await _status(library, entry_id, {"status": "ready"})

    [changed] = [record for record in caplog.records if record.getMessage() == "library_entry_status_changed"]
    admin = await library.db.get_user_by_phone(ADMIN_PHONE)
    assert (changed.entry_id, changed.admin_id) == (str(entry_id), str(admin["id"]))
    assert (changed.from_status, changed.to_status) == ("pending", "ready")
    assert QUESTION not in _log_text(caplog.records)
    assert ANSWER not in _log_text(caplog.records)


async def test_a_playback_logs_no_text(library, caplog):
    entry_id = await library.entry("published", section_type="identity")
    headers = await library.user()
    caplog.set_level(logging.DEBUG)

    await library.api.client.get("/library/suggestions?language=fa", headers=headers)
    await library.api.client.get(f"/library/answers/{entry_id}/video", headers=headers)
    await library.api.client.get(f"/library/answers/{entry_id}/follow-ups", headers=headers)

    assert QUESTION not in _log_text(caplog.records)
    assert ANSWER not in _log_text(caplog.records)


# --- The import-only row, through the same function (REQ-028 uses it later) ------------------


async def test_the_import_may_move_a_pending_entry_to_draft_with_no_reviewer(library):
    entry_id = await library.entry("pending", answer_text=None)
    video_id = await library.video(status="VIDEO_GENERATED", text=f" {ANSWER} ")

    await change_entry_status(
        library.db, entry_id, "draft", reviewer_id=None, video_asset_id=video_id, importing=True
    )

    after = await library.row(entry_id)
    assert (after["status"], after["video_asset_id"], after["answer_text"]) == ("draft", video_id, ANSWER)
    [review] = await library.reviews(entry_id)
    assert (review["decision"], review["reviewer_id"], review["video_asset_id"]) == (
        "video_attached",
        None,
        video_id,
    )


async def test_the_import_never_replaces_an_answer_an_admin_wrote(library):
    entry_id = await library.entry("pending", answer_text="متنی که مدیر نوشت")
    video_id = await library.video(status="VIDEO_GENERATED")

    with pytest.raises(AppError) as raised:
        await change_entry_status(
            library.db, entry_id, "draft", reviewer_id=None, video_asset_id=video_id, importing=True
        )

    assert raised.value.code == "library_text_mismatch"
    assert (await library.row(entry_id))["status"] == "pending"


# --- Unsaved recordings (REQ-042, SC-024) ---------------------------------------------------


async def _only_our_recordings(library: Library) -> None:
    """Other test files leave VIDEO_GENERATED rows behind, some with a file. The fixture already
    emptied library_entries, so no row references them."""
    await library.db.pool.execute("DELETE FROM video_assets WHERE status='VIDEO_GENERATED'")


async def test_a_finished_recording_is_listed_until_an_entry_uses_it(library):
    await _only_our_recordings(library)
    older = await library.video(status="VIDEO_GENERATED", duration_ms=1000)
    newer = await library.video(status="VIDEO_GENERATED", text="متن ضبط تازه", duration_ms=2000)
    await library.video(status="VIDEO_GENERATED", content=None)
    await library.video(status="VIDEO_APPROVED")
    await library.video(status="DRAFT")
    await library.db.pool.execute(
        "UPDATE video_assets SET created_at = now() - interval '1 minute' WHERE id=$1", older
    )
    admin = await library.admin()

    listed = await library.api.client.get("/admin/library/recordings", headers=admin)
    entry = await library.entry("ready")
    await _status(library, entry, {"status": "draft", "videoAssetId": str(older)}, admin)
    after = await library.api.client.get("/admin/library/recordings", headers=admin)

    assert listed.status_code == 200
    body = listed.json()
    assert (body["total"], body["page"], body["pageSize"]) == (2, 1, 10)
    assert [item["videoAssetId"] for item in body["items"]] == [str(newer), str(older)]
    assert set(body["items"][0]) == {"videoAssetId", "answerText", "durationMs", "createdAt"}
    assert (body["items"][0]["answerText"], body["items"][0]["durationMs"]) == ("متن ضبط تازه", 2000)
    assert [item["videoAssetId"] for item in after.json()["items"]] == [str(newer)]


async def test_the_recordings_list_pages(library):
    await _only_our_recordings(library)
    videos = [await library.video(status="VIDEO_GENERATED") for _ in range(3)]
    for index, video_id in enumerate(videos):
        await library.db.pool.execute(
            "UPDATE video_assets SET created_at = now() - make_interval(mins => $2) WHERE id=$1",
            video_id,
            index,
        )
    admin = await library.admin()

    second = await library.api.client.get("/admin/library/recordings?page=2&pageSize=2", headers=admin)
    too_big = await library.api.client.get("/admin/library/recordings?pageSize=101", headers=admin)

    assert second.json()["total"] == 3
    assert [item["videoAssetId"] for item in second.json()["items"]] == [str(videos[2])]
    assert too_big.status_code == 422
