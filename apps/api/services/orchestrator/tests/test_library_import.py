"""The library import and export (docs/features/response-caching/SPEC.md, group B, REQ-020 to
REQ-029 and REQ-071): SC-010, SC-011 for the import and the export, SC-030 to SC-032.

Needs a disposable PostgreSQL, like test_library_api.py, and ffmpeg to make the fixture MP4. The
fixture deletes every library row and every imported video row, so never point it at a database
whose data matters. Without the variable below the tests skip.

    ORCHESTRATOR_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55433/test \\
      pytest services/orchestrator/tests/test_library_import.py
"""

import asyncio
import io
import json
import logging
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from services.orchestrator.src import library_export, library_import
from services.orchestrator.src.database import Database
from services.orchestrator.src.errors import AppError
from services.orchestrator.src.library.service import change_entry_status
from services.orchestrator.src.media_probe import probe_avatar_mp4

DATABASE_URL = os.environ.get("ORCHESTRATOR_TEST_DATABASE_URL")
MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"

pytestmark = [
    pytest.mark.skipif(
        not DATABASE_URL, reason="needs ORCHESTRATOR_TEST_DATABASE_URL, a disposable PostgreSQL"
    ),
    pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg for the fixture MP4"),
]

QUESTION = "پرسش آزمون درون‌ریزی کتابخانه"
ANSWER = "پاسخ گفتاری   آزمون درون‌ریزی کتابخانه"
SPOKEN = "پاسخ گفتاری آزمون درون‌ریزی کتابخانه"  # ANSWER after whitespace normalization
ORIGINAL = "پاسخ اصلی و بلند آزمون درون‌ریزی کتابخانه"
OTHER_ANSWER = "متن دیگری که مدیر نوشته است"
SECTION = "سوالات دانشی آزمون"
AVATAR_ID = "avatar-import-test"
VOICE_ID = "voice-import-test"


# --- Fixtures -----------------------------------------------------------------------------------


@pytest.fixture(scope="module")
def base_mp4(tmp_path_factory) -> Path:
    """One short H.264 and AAC MP4 that probe_avatar_mp4 accepts. Every row copies it."""
    path = tmp_path_factory.mktemp("mp4") / "base.mp4"
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "color=c=blue:s=160x90:d=2",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
        "-c:v", "libx264", "-c:a", "aac", "-shortest", str(path),
    ]  # fmt: skip
    assert __import__("subprocess").run(command, check=False).returncode == 0
    return path


@pytest.fixture
async def database():
    db = Database(DATABASE_URL, MIGRATIONS)
    await db.connect()
    await db.pool.execute("DELETE FROM library_entry_reviews")
    await db.pool.execute("DELETE FROM library_entries")
    await db.pool.execute("DELETE FROM video_assets WHERE external_id LIKE 'LIB_%'")
    try:
        yield db
    finally:
        await db.close()


@dataclass
class Sprint:
    """A render sprint in small: results and source files, the MP4s beside them, and the target
    install's video folder."""

    db: Database
    root: Path
    media: Path
    video_dir: Path
    base_mp4: Path
    duration_ms: int

    def mp4(self, external_id: str) -> Path:
        path = self.media / f"{external_id}.mp4"
        shutil.copyfile(self.base_mp4, path)
        return path

    def rendered(self, key: str, *, with_file: bool = True, **overrides) -> dict:
        """A rendered row as render_answers.py writes it, with the extra fields of the export."""
        external_id = overrides.pop("external_id", f"ANS_{key}_{uuid4().hex[:10]}")
        row = {
            "key": key,
            "batch": 1,
            "question": QUESTION,
            "category": 18,
            "category_title": "هویت و سوابق",
            "section_type": "identity",
            "technical": "non-technical",
            "bridge_type": "identity",
            "language": "fa",
            "answer_original": ORIGINAL,
            "answer": ANSWER,
            "video_asset_id": str(uuid4()),
            "external_id": external_id,
            "audio_asset_id": str(uuid4()),
            "status": "VIDEO_GENERATED",
            "duration_ms": self.duration_ms,
            "file": f"/media/video/{external_id}.mp4",
            "error": None,
        }
        row.update(overrides)
        if with_file:
            self.mp4(external_id)
        return row

    def source_row(self, key: str, **overrides) -> dict:
        row = {
            "key": key,
            "category": 2,
            "category_title": "امنیت شبکه",
            "section": SECTION,
            "section_type": "knowledge",
            "technical": "technical",
            "question": QUESTION,
            "answer_original": ORIGINAL,
        }
        row.update(overrides)
        return row

    def write(self, name: str, content) -> Path:
        path = self.root / name
        text = content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)
        path.write_text(text, encoding="utf-8")
        return path

    def results_file(self, name: str, rows: list[dict]) -> Path:
        return self.write(name, {row["key"]: row for row in rows})

    async def import_results(self, *files: Path, dry_run: bool = False) -> "Report":
        argv = [part for path in files for part in ("--results", str(path))]
        argv += ["--media-dir", str(self.media), "--avatar-id", AVATAR_ID, "--voice-id", VOICE_ID]
        return await self._run(argv + (["--dry-run"] if dry_run else []))

    async def import_source(self, path: Path, *verdicts: Path, language: str = "fa", dry_run: bool = False):
        argv = ["--source", str(path), "--language", language]
        argv += [part for verdict in verdicts for part in ("--verdicts", str(verdict))]
        return await self._run(argv + (["--dry-run"] if dry_run else []))

    async def _run(self, argv: list[str]) -> "Report":
        out = io.StringIO()
        args = library_import.parse_args(argv)
        code = await library_import.run(args, database=self.db, video_dir=self.video_dir, out=out)
        return Report(code, out.getvalue())

    async def entries(self) -> dict[str, dict]:
        rows = await self.db.pool.fetch("SELECT * FROM library_entries ORDER BY position")
        return {row["key"]: dict(row) for row in rows}

    async def entry(self, key: str) -> dict:
        return dict(await self.db.pool.fetchrow("SELECT * FROM library_entries WHERE key=$1", key))

    async def videos(self) -> list[dict]:
        rows = await self.db.pool.fetch("SELECT * FROM video_assets WHERE external_id LIKE 'LIB_%'")
        return [dict(row) for row in rows]

    async def reviews(self, entry_id: UUID) -> list[dict]:
        rows = await self.db.pool.fetch(
            "SELECT * FROM library_entry_reviews WHERE entry_id=$1 ORDER BY created_at", entry_id
        )
        return [dict(row) for row in rows]

    async def add_entry(self, key: str, status: str, *, answer_text: str | None = SPOKEN, **columns) -> UUID:
        """An entry written straight into the table, as an admin would have left it."""
        values = {
            "question": "پرسش ویرایش‌شده مدیر",
            "language": "fa",
            "category": "7",
            "category_title": "دسته قدیمی",
            "section_type": "knowledge",
            "technical": "classify",
        } | columns
        return await self.db.pool.fetchval(
            """
            INSERT INTO library_entries
              (key,question,answer_text,language,category,category_title,section_type,technical,
               status,position)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,(SELECT coalesce(max(position),0)+1 FROM library_entries))
            RETURNING id
            """,
            key,
            values["question"],
            answer_text,
            values["language"],
            values["category"],
            values["category_title"],
            values["section_type"],
            values["technical"],
            status,
        )

    def target_files(self) -> list[Path]:
        return sorted(self.video_dir.glob("*.mp4")) if self.video_dir.exists() else []


@dataclass
class Report:
    code: int
    text: str

    @property
    def lines(self) -> list[tuple[str, str, str]]:
        """The row lines: (file, key, reason code). The summary line has no tabs."""
        return [tuple(line.split("\t")) for line in self.text.splitlines() if line.count("\t") == 2]

    def codes(self) -> dict[str, str]:
        return {key: code for _, key, code in self.lines}


@pytest.fixture
async def sprint(database, tmp_path, base_mp4):
    media = tmp_path / "media"
    media.mkdir()
    probe = await probe_avatar_mp4(base_mp4)
    return Sprint(database, tmp_path, media, tmp_path / "video", base_mp4, probe["duration_ms"])


def _log_text(records: list[logging.LogRecord]) -> str:
    return "\n".join(json.dumps(record.__dict__, default=str, ensure_ascii=False) for record in records)


# --- Results import: the happy path (SC-010, REQ-023, REQ-024, REQ-026) -----------------------


async def test_a_results_import_creates_a_draft_entry_and_a_new_video_per_row(sprint):
    first = sprint.rendered("C18Q05")
    second = sprint.rendered("C18Q06", category="3", technical="classify")
    results = sprint.results_file("results-wave1.json", [first, second])
    sources_before = {path: path.read_bytes() for path in sprint.media.iterdir()}

    report = await sprint.import_results(results)

    assert report.code == 0, report.text
    assert report.lines == []
    assert "created=2" in report.text
    entries = await sprint.entries()
    assert list(entries) == ["C18Q05", "C18Q06"]
    entry = entries["C18Q05"]
    assert entry["status"] == "draft"
    assert entry["question"] == QUESTION
    assert entry["answer_text"] == SPOKEN
    assert entry["answer_original"] == ORIGINAL
    assert entry["language"] == "fa"
    assert (entry["category"], entry["category_title"]) == ("18", "هویت و سوابق")
    assert (entry["section_type"], entry["technical"]) == ("identity", "non-technical")
    assert entry["created_by"] is None
    assert json.loads(entry["import_metadata"]) == {"batch": 1, "bridge_type": "identity"}
    assert entries["C18Q06"]["category"] == "3"
    assert entries["C18Q06"]["technical"] == "classify"
    # A new entry is not a transition: no review row, like an entry created from a recording.
    assert await sprint.reviews(entry["id"]) == []

    videos = {video["id"]: video for video in await sprint.videos()}
    assert len(videos) == 2
    video = videos[entry["video_asset_id"]]
    assert str(video["id"]) != first["video_asset_id"]
    assert video["external_id"] == f"LIB_{first['external_id']}"
    target = sprint.video_dir / f"LIB_{first['external_id']}.mp4"
    assert video["video_path"] == str(target.absolute())
    assert target.read_bytes() == sprint.base_mp4.read_bytes()
    assert video["text"] == SPOKEN
    assert (video["avatar_id"], video["voice_id"]) == (AVATAR_ID, VOICE_ID)
    assert video["status"] == "VIDEO_GENERATED"
    assert video["audio_asset_id"] is None
    assert video["duration_ms"] == sprint.duration_ms
    metadata = json.loads(video["metadata"])
    assert metadata["ffprobe"]["video_codec"] == "h264"
    assert metadata["imported_from"] == {
        "sheet_video_asset_id": first["video_asset_id"],
        "sheet_external_id": first["external_id"],
        "sheet_audio_asset_id": first["audio_asset_id"],
    }
    # REQ-025: the source files are only read.
    assert {path: path.read_bytes() for path in sprint.media.iterdir()} == sources_before


async def test_optional_batch_bridge_type_and_original_may_be_absent_or_null(sprint):
    absent = sprint.rendered("K_ABSENT")
    for name in ("batch", "bridge_type", "answer_original"):
        del absent[name]
    null = sprint.rendered("K_NULL", batch=None, bridge_type=None, answer_original=None)
    results = sprint.results_file("results.json", [absent, null])

    report = await sprint.import_results(results)

    assert report.code == 0, report.text
    for key in ("K_ABSENT", "K_NULL"):
        entry = await sprint.entry(key)
        assert entry["status"] == "draft"
        assert entry["answer_original"] is None
        assert json.loads(entry["import_metadata"]) == {}


async def test_a_second_run_reports_every_row_already_imported_and_changes_nothing(sprint):
    rows = [sprint.rendered("C01Q01"), sprint.rendered("C01Q02")]
    results = sprint.results_file("results.json", rows)
    assert (await sprint.import_results(results)).code == 0
    entries_before, videos_before = await sprint.entries(), await sprint.videos()
    files_before = sprint.target_files()

    report = await sprint.import_results(results)

    assert report.code == 0, report.text
    assert report.lines == [
        (str(results), "C01Q01", "already_imported"),
        (str(results), "C01Q02", "already_imported"),
    ]
    assert await sprint.entries() == entries_before
    assert await sprint.videos() == videos_before
    assert sprint.target_files() == files_before


async def test_a_failed_render_row_is_not_rendered_and_does_not_fail_the_file(sprint):
    failed = {"key": "C02Q01", "question": QUESTION, "answer": ANSWER, "error": "POST /avatar/session -> 502"}
    draft = sprint.rendered("C02Q02", status="DRAFT")
    good = sprint.rendered("C02Q03")
    results = sprint.results_file("results.json", [failed, draft, good])

    report = await sprint.import_results(results)

    assert report.code == 0, report.text
    assert report.codes() == {"C02Q01": "not_rendered", "C02Q02": "not_rendered"}
    assert list(await sprint.entries()) == ["C02Q03"]


async def test_a_dry_run_checks_every_row_and_writes_nothing(sprint):
    results = sprint.results_file("results.json", [sprint.rendered("C03Q01"), sprint.rendered("C03Q02")])

    report = await sprint.import_results(results, dry_run=True)

    assert report.code == 0, report.text
    assert "created=2" in report.text
    assert "dry run" in report.text
    assert await sprint.entries() == {}
    assert await sprint.videos() == []
    assert sprint.target_files() == []


# --- Results import: every failure writes nothing (SC-010, REQ-022, REQ-024, REQ-027) --------


async def _assert_nothing_written(sprint: Sprint) -> None:
    assert await sprint.entries() == {}
    assert await sprint.videos() == []
    assert sprint.target_files() == []


async def test_one_bad_row_fails_the_run_and_the_fixed_file_then_imports(sprint):
    good = sprint.rendered("C04Q01")
    bad = sprint.rendered("C04Q02", section_type="funnel")
    results = sprint.results_file("results.json", [good, bad])

    report = await sprint.import_results(results)

    assert report.code == 1
    assert report.lines == [(str(results), "C04Q02", "bad_section_type")]
    await _assert_nothing_written(sprint)

    bad["section_type"] = "meeting"
    sprint.results_file("results.json", [good, bad])
    fixed = await sprint.import_results(results)

    assert fixed.code == 0, fixed.text
    assert {key: entry["status"] for key, entry in (await sprint.entries()).items()} == {
        "C04Q01": "draft",
        "C04Q02": "draft",
    }
    assert len(await sprint.videos()) == 2


FIELD_FAILURES = [
    ({"key": "C05 Q01"}, "bad_key"),
    ({"question": "   "}, "bad_question"),
    ({"question": "س" * 301}, "bad_question"),
    ({"answer": " \n "}, "bad_answer"),
    ({"answer": "پ " * 240 + "پ"}, "bad_answer"),
    ({"answer_original": ""}, "bad_answer_original"),
    ({"answer_original": "a" * 5001}, "bad_answer_original"),
    ({"category": ""}, "bad_category"),
    ({"category_title": " "}, "bad_category"),
    ({"section_type": "funnel"}, "bad_section_type"),
    ({"technical": "maybe"}, "bad_technical"),
    ({"language": "de"}, "bad_language"),
    ({"video_asset_id": "not-a-uuid"}, "bad_video_asset_id"),
    ({"duration_ms": 0}, "bad_duration"),
]


@pytest.mark.parametrize(("change", "code"), FIELD_FAILURES)
async def test_each_field_check_fails_the_row_with_its_code(sprint, change, code):
    key = "C05Q01"
    row = sprint.rendered(key) | change
    results = sprint.write("results.json", {key: row})  # the object key stays valid

    report = await sprint.import_results(results)

    assert report.code == 1
    assert report.lines == [(str(results), key, code)]
    await _assert_nothing_written(sprint)


async def test_an_answer_of_480_characters_after_normalization_passes(sprint):
    row = sprint.rendered("C05Q02", answer="  " + "پ  " * 239 + "پ\n")
    results = sprint.results_file("results.json", [row])

    report = await sprint.import_results(results)

    assert report.code == 0, report.text
    assert len((await sprint.entry("C05Q02"))["answer_text"]) == 479


async def test_a_row_key_that_differs_from_its_object_key_is_bad_key(sprint):
    row = sprint.rendered("C05Q03")
    results = sprint.write("results.json", {"C05Q04": row})

    report = await sprint.import_results(results)

    assert report.code == 1
    assert report.lines == [(str(results), "C05Q04", "bad_key")]


FORMAT_FAILURES = [
    "key,question,answer\nC06Q01,q,a\n",  # CSV
    "[]",  # a list is the source shape, not the results shape
    '"text"',
    "{broken json",
]


@pytest.mark.parametrize("content", FORMAT_FAILURES)
async def test_a_wrong_top_level_shape_fails_the_file_with_bad_format(sprint, content):
    good = sprint.results_file("good.json", [sprint.rendered("C06Q02")])
    bad = sprint.write("bad.json", content)

    report = await sprint.import_results(good, bad)

    assert report.code == 1
    assert report.lines == [(str(bad), "-", "bad_format")]
    await _assert_nothing_written(sprint)


MISSING = object()


@pytest.mark.parametrize(
    "change",
    [
        {"external_id": MISSING},
        {"error": MISSING},
        {"duration_ms": "35906"},
        {"category": ["18"]},
        {"category": True},
        {"audio_asset_id": 7},
        {"batch": {"wave": 1}},
    ],
)
async def test_a_rendered_row_with_a_missing_field_or_a_wrong_type_fails_the_file(sprint, change):
    row = sprint.rendered("C06Q03")
    for name, value in change.items():
        if value is MISSING:
            del row[name]
        else:
            row[name] = value
    results = sprint.results_file("results.json", [sprint.rendered("C06Q04"), row])

    report = await sprint.import_results(results)

    assert report.code == 1
    assert report.lines == [(str(results), "C06Q03", "bad_format")]
    await _assert_nothing_written(sprint)


async def test_file_checks_name_each_row_with_its_code(sprint):
    renamed = sprint.rendered("C07Q01")
    renamed["file"] = "/media/video/another-name.mp4"
    missing = sprint.rendered("C07Q02", with_file=False)
    corrupt = sprint.rendered("C07Q03")
    (sprint.media / f"{corrupt['external_id']}.mp4").write_bytes(b"not an mp4")
    longer = sprint.rendered("C07Q04", duration_ms=sprint.duration_ms + 1001)
    close_enough = sprint.rendered("C07Q05", duration_ms=sprint.duration_ms - 1000)
    exists = sprint.rendered("C07Q06")
    sprint.video_dir.mkdir()
    (sprint.video_dir / f"LIB_{exists['external_id']}.mp4").write_bytes(b"already here")
    taken = sprint.rendered("C07Q07")
    await sprint.db.pool.execute(
        "INSERT INTO video_assets (external_id,text,avatar_id,voice_id,video_path,status) "
        "VALUES ($1,'t','a','v','/nowhere.mp4','VIDEO_GENERATED')",
        f"LIB_{taken['external_id']}",
    )
    rows = [renamed, missing, corrupt, longer, close_enough, exists, taken]
    results = sprint.results_file("results.json", rows)

    report = await sprint.import_results(results)

    assert report.code == 1
    assert report.codes() == {
        "C07Q01": "bad_file",
        "C07Q02": "file_missing",
        "C07Q03": "probe_failed",
        "C07Q04": "duration_mismatch",
        "C07Q06": "file_exists",
        "C07Q07": "external_id_taken",
    }
    assert await sprint.entries() == {}
    assert [video["external_id"] for video in await sprint.videos()] == [f"LIB_{taken['external_id']}"]
    assert [path.name for path in sprint.target_files()] == [f"LIB_{exists['external_id']}.mp4"]


async def test_a_key_or_an_external_id_twice_across_files_fails_each_row(sprint):
    first = sprint.rendered("C08Q01")
    again = sprint.rendered("C08Q01")
    shared = sprint.rendered("C08Q02")
    same_video = sprint.rendered("C08Q03", external_id=shared["external_id"], file=shared["file"])
    wave1 = sprint.results_file("wave1.json", [first, shared])
    wave2 = sprint.results_file("wave2.json", [again, same_video])

    report = await sprint.import_results(wave1, wave2)

    assert report.code == 1
    assert sorted(report.lines) == sorted(
        [
            (str(wave1), "C08Q01", "duplicate_key"),
            (str(wave1), "C08Q02", "duplicate_external_id"),
            (str(wave2), "C08Q01", "duplicate_key"),
            (str(wave2), "C08Q03", "duplicate_external_id"),
        ]
    )
    await _assert_nothing_written(sprint)


async def test_a_failed_row_in_one_wave_and_its_render_in_the_next_is_not_a_duplicate(sprint):
    failed = {"key": "C08Q04", "question": QUESTION, "answer": ANSWER, "error": "timeout"}
    wave1 = sprint.results_file("wave1.json", [failed])
    wave2 = sprint.results_file("wave2.json", [sprint.rendered("C08Q04")])

    report = await sprint.import_results(wave1, wave2)

    assert report.code == 0, report.text
    assert report.lines == [(str(wave1), "C08Q04", "not_rendered")]
    assert (await sprint.entry("C08Q04"))["status"] == "draft"


async def test_a_write_failure_removes_every_copied_file_and_writes_no_row(sprint, monkeypatch):
    results = sprint.results_file("results.json", [sprint.rendered("C09Q01"), sprint.rendered("C09Q02")])
    original = Database.insert_library_entry
    calls = 0

    async def fail_on_second(self, conn, data):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("disk full")
        return await original(self, conn, data)

    monkeypatch.setattr(Database, "insert_library_entry", fail_on_second)

    report = await sprint.import_results(results)

    assert report.code == 1
    assert [code for _, _, code in report.lines] == ["write_failed"]
    await _assert_nothing_written(sprint)


# --- Results rows meet existing entries (SC-031, REQ-028) ------------------------------------


async def test_a_results_row_attaches_its_video_to_a_ready_entry_with_the_same_text(sprint):
    entry_id = await sprint.add_entry("C10Q01", "ready")
    results = sprint.results_file("results.json", [sprint.rendered("C10Q01")])

    report = await sprint.import_results(results)

    assert report.code == 0, report.text
    assert report.lines == [(str(results), "C10Q01", "attached")]
    entry = await sprint.entry("C10Q01")
    assert entry["id"] == entry_id
    assert entry["status"] == "draft"
    assert entry["answer_text"] == SPOKEN
    # A ready entry keeps its own labels: only a pending entry takes them from the row.
    assert (entry["category"], entry["technical"]) == ("7", "classify")
    [video] = await sprint.videos()
    assert entry["video_asset_id"] == video["id"]
    [review] = await sprint.reviews(entry_id)
    assert (review["decision"], review["reviewer_id"], review["video_asset_id"]) == (
        "video_attached",
        None,
        video["id"],
    )


async def test_a_results_row_with_another_text_than_the_ready_entry_fails(sprint):
    entry_id = await sprint.add_entry("C10Q02", "ready", answer_text=OTHER_ANSWER)
    results = sprint.results_file("results.json", [sprint.rendered("C10Q02")])

    report = await sprint.import_results(results)

    assert report.code == 1
    assert report.lines == [(str(results), "C10Q02", "answer_text_mismatch")]
    entry = await sprint.entry("C10Q02")
    assert (entry["status"], entry["answer_text"]) == ("ready", OTHER_ANSWER)
    assert await sprint.reviews(entry_id) == []
    assert await sprint.videos() == []


async def test_a_results_row_moves_a_pending_entry_with_no_text_to_draft_with_its_fields(sprint):
    entry_id = await sprint.add_entry("C10Q03", "pending", answer_text=None)
    results = sprint.results_file("results.json", [sprint.rendered("C10Q03")])

    report = await sprint.import_results(results)

    assert report.code == 0, report.text
    assert report.lines == [(str(results), "C10Q03", "attached")]
    entry = await sprint.entry("C10Q03")
    assert entry["status"] == "draft"
    assert entry["answer_text"] == SPOKEN
    assert (entry["category"], entry["category_title"]) == ("18", "هویت و سوابق")
    assert (entry["section_type"], entry["technical"]) == ("identity", "non-technical")
    [review] = await sprint.reviews(entry_id)
    assert (review["decision"], review["reviewer_id"]) == ("video_attached", None)


async def test_a_results_row_moves_a_pending_entry_with_the_same_text(sprint):
    await sprint.add_entry("C10Q04", "pending", answer_text=SPOKEN)
    results = sprint.results_file("results.json", [sprint.rendered("C10Q04")])

    report = await sprint.import_results(results)

    assert report.code == 0, report.text
    assert (await sprint.entry("C10Q04"))["status"] == "draft"


async def test_a_results_row_never_replaces_the_text_an_admin_wrote_in_a_pending_entry(sprint):
    entry_id = await sprint.add_entry("C10Q05", "pending", answer_text=OTHER_ANSWER)
    before = await sprint.entry("C10Q05")
    results = sprint.results_file("results.json", [sprint.rendered("C10Q05")])

    report = await sprint.import_results(results)

    assert report.code == 1
    assert report.lines == [(str(results), "C10Q05", "answer_text_mismatch")]
    assert await sprint.entry("C10Q05") == before
    assert await sprint.reviews(entry_id) == []
    assert await sprint.videos() == []
    assert sprint.target_files() == []


@pytest.mark.parametrize("status", ["draft", "published", "withdrawn"])
async def test_a_results_row_for_an_entry_in_another_state_is_already_imported(sprint, status):
    await sprint.add_entry("C10Q06", "withdrawn" if status == "withdrawn" else "pending")
    if status != "withdrawn":
        video_id = await sprint.db.pool.fetchval(
            "INSERT INTO video_assets (external_id,text,avatar_id,voice_id,video_path,status) "
            "VALUES ('LIB_existing',$1,'a','v','/nowhere.mp4','VIDEO_APPROVED') RETURNING id",
            SPOKEN,
        )
        await sprint.db.pool.execute(
            "UPDATE library_entries SET status=$1, video_asset_id=$2 WHERE key='C10Q06'", status, video_id
        )
    before = await sprint.entry("C10Q06")
    row = sprint.rendered("C10Q06", with_file=False)  # no file needed: the row is skipped
    results = sprint.results_file("results.json", [row])

    report = await sprint.import_results(results)

    assert report.code == 0, report.text
    assert report.lines == [(str(results), "C10Q06", "already_imported")]
    assert await sprint.entry("C10Q06") == before


@pytest.mark.parametrize(
    ("status", "answer_text"), [("pending", None), ("pending", SPOKEN), ("ready", SPOKEN)]
)
async def test_a_results_row_in_another_language_than_the_entry_fails(sprint, status, answer_text):
    """A row attaches only to an entry in its own language (language_mismatch)."""
    entry_id = await sprint.add_entry("C10Q08", status, answer_text=answer_text, language="en")
    before = await sprint.entry("C10Q08")
    results = sprint.results_file("results.json", [sprint.rendered("C10Q08", language="fa")])

    report = await sprint.import_results(results)

    assert report.code == 1
    assert report.lines == [(str(results), "C10Q08", "language_mismatch")]
    assert await sprint.entry("C10Q08") == before
    assert await sprint.reviews(entry_id) == []
    assert await sprint.videos() == []
    assert sprint.target_files() == []


async def test_a_language_mismatch_is_reported_before_a_text_mismatch(sprint):
    await sprint.add_entry("C10Q09", "ready", answer_text=OTHER_ANSWER, language="en")
    results = sprint.results_file("results.json", [sprint.rendered("C10Q09", language="fa")])

    report = await sprint.import_results(results)

    assert report.lines == [(str(results), "C10Q09", "language_mismatch")]


async def test_a_results_row_attaches_to_an_entry_in_its_own_language(sprint):
    await sprint.add_entry("C10Q10", "pending", answer_text=None, language="en")
    results = sprint.results_file("results.json", [sprint.rendered("C10Q10", language="en")])

    report = await sprint.import_results(results)

    assert report.code == 0, report.text
    entry = await sprint.entry("C10Q10")
    assert (entry["status"], entry["language"]) == ("draft", "en")


async def test_the_status_route_function_refuses_pending_to_draft_outside_the_import(sprint):
    entry_id = await sprint.add_entry("C10Q07", "pending", answer_text=None)

    with pytest.raises(AppError) as refused:
        await change_entry_status(sprint.db, entry_id, "draft", reviewer_id=uuid4(), video_asset_id=uuid4())

    assert refused.value.code == "invalid_status_transition"


# --- Source import (SC-030, REQ-021, REQ-026, REQ-028) ---------------------------------------


def _verdicts(*pairs: tuple[str, str]) -> list[dict]:
    """A verdict file row has more fields; the import reads only key and technical."""
    return [
        {"key": key, "technical": technical, "question": QUESTION, "answer_spoken": ANSWER, "notes": "n"}
        for key, technical in pairs
    ]


async def test_after_the_results_import_the_source_import_creates_only_the_not_rendered_keys(sprint):
    results = sprint.results_file("results.json", [sprint.rendered("C11Q01")])
    assert (await sprint.import_results(results)).code == 0
    source = sprint.write(
        "source.json",
        [
            sprint.source_row("C11Q01", technical="classify"),
            sprint.source_row("C11Q02"),
            sprint.source_row("C11Q03", technical="classify", section_type="casual"),
            sprint.source_row("C11Q04", technical="classify"),
        ],
    )
    verdicts = sprint.write(
        "batch-1.json",
        _verdicts(("C11Q01", "non-technical"), ("C11Q02", "non-technical"), ("C11Q03", "technical")),
    )

    report = await sprint.import_source(source, verdicts)

    assert report.code == 0, report.text
    assert report.lines == [(str(source), "C11Q01", "already_imported")]
    assert "created=3" in report.text
    entries = await sprint.entries()
    assert entries["C11Q01"]["status"] == "draft"
    for key in ("C11Q02", "C11Q03", "C11Q04"):
        entry = entries[key]
        assert entry["status"] == "pending"
        assert entry["answer_text"] is None
        assert entry["answer_original"] == ORIGINAL
        assert entry["question"] == QUESTION
        assert entry["language"] == "fa"
        assert (entry["category"], entry["category_title"]) == ("2", "امنیت شبکه")
        assert entry["video_asset_id"] is None
        assert entry["created_by"] is None
        assert await sprint.reviews(entry["id"]) == []
    # A verdict settles a classify row only; a classify row with no verdict keeps classify.
    assert entries["C11Q02"]["technical"] == "technical"
    assert entries["C11Q03"]["technical"] == "technical"
    assert entries["C11Q03"]["section_type"] == "casual"
    assert entries["C11Q04"]["technical"] == "classify"
    assert json.loads(entries["C11Q03"]["import_metadata"]) == {
        "section": SECTION,
        "source_technical": "classify",
    }
    assert json.loads(entries["C11Q02"]["import_metadata"]) == {
        "section": SECTION,
        "source_technical": "technical",
    }


async def test_the_source_import_takes_the_language_argument(sprint):
    source = sprint.write("source.json", [sprint.source_row("C12Q01")])

    report = await sprint.import_source(source, language="en")

    assert report.code == 0, report.text
    assert (await sprint.entry("C12Q01"))["language"] == "en"


async def test_a_second_source_run_changes_nothing(sprint):
    source = sprint.write("source.json", [sprint.source_row("C12Q02")])
    assert (await sprint.import_source(source)).code == 0
    before = await sprint.entries()

    report = await sprint.import_source(source)

    assert report.code == 0
    assert report.lines == [(str(source), "C12Q02", "already_imported")]
    assert await sprint.entries() == before


async def test_a_source_dry_run_writes_nothing(sprint):
    source = sprint.write("source.json", [sprint.source_row("C12Q03")])

    report = await sprint.import_source(source, dry_run=True)

    assert report.code == 0, report.text
    assert "created=1" in report.text
    assert await sprint.entries() == {}


@pytest.mark.parametrize(
    "content",
    [
        "key,question\nC13Q01,q\n",
        {"C13Q01": {"key": "C13Q01"}},
        '"text"',
    ],
)
async def test_a_source_file_of_another_shape_fails_with_bad_format(sprint, content):
    source = sprint.write("source.json", content)

    report = await sprint.import_source(source)

    assert report.code == 1
    assert report.lines == [(str(source), "-", "bad_format")]
    assert await sprint.entries() == {}


async def test_a_source_row_with_a_missing_field_fails_the_file(sprint):
    broken = sprint.source_row("C13Q02")
    del broken["section"]
    source = sprint.write("source.json", [sprint.source_row("C13Q03"), broken])

    report = await sprint.import_source(source)

    assert report.code == 1
    assert report.lines == [(str(source), "C13Q02", "bad_format")]
    assert await sprint.entries() == {}


async def test_source_rows_are_checked_and_one_failure_writes_nothing(sprint):
    source = sprint.write(
        "source.json",
        [
            sprint.source_row("C13Q04"),
            sprint.source_row("C13Q05", answer_original="a" * 5001),
            sprint.source_row("C13Q06", technical="unknown"),
            sprint.source_row("C13Q07"),
            sprint.source_row("C13Q07"),
        ],
    )

    report = await sprint.import_source(source)

    assert report.code == 1
    assert report.lines == [
        (str(source), "C13Q05", "bad_answer_original"),
        (str(source), "C13Q06", "bad_technical"),
        (str(source), "C13Q07", "duplicate_key"),
        (str(source), "C13Q07", "duplicate_key"),
    ]
    assert await sprint.entries() == {}


async def test_a_verdict_that_is_not_technical_or_non_technical_fails_the_run(sprint):
    source = sprint.write("source.json", [sprint.source_row("C13Q08", technical="classify")])
    verdicts = sprint.write("batch-2.json", _verdicts(("C13Q08", "classify")))

    report = await sprint.import_source(source, verdicts)

    assert report.code == 1
    assert report.lines == [(str(verdicts), "C13Q08", "bad_technical")]
    assert await sprint.entries() == {}


async def test_the_same_verdict_for_a_key_in_two_files_is_accepted(sprint):
    """Agreeing verdicts are fine."""
    source = sprint.write("source.json", [sprint.source_row("C13Q10", technical="classify")])
    first = sprint.write("batch-1.json", _verdicts(("C13Q10", "non-technical")))
    second = sprint.write("batch-2.json", _verdicts(("C13Q10", "non-technical")))

    report = await sprint.import_source(source, first, second)

    assert report.code == 0, report.text
    assert report.lines == []
    assert (await sprint.entry("C13Q10"))["technical"] == "non-technical"


async def test_conflicting_verdicts_for_a_key_fail_each_row_with_duplicate_key(sprint):
    source = sprint.write("source.json", [sprint.source_row("C13Q11", technical="classify")])
    first = sprint.write("batch-1.json", _verdicts(("C13Q11", "technical"), ("C13Q12", "technical")))
    second = sprint.write("batch-2.json", _verdicts(("C13Q11", "non-technical"), ("C13Q12", "technical")))

    report = await sprint.import_source(source, first, second)

    assert report.code == 1
    assert report.lines == [(str(first), "C13Q11", "duplicate_key"), (str(second), "C13Q11", "duplicate_key")]
    assert await sprint.entries() == {}


async def test_a_verdict_file_that_is_not_a_list_fails_with_bad_format(sprint):
    source = sprint.write("source.json", [sprint.source_row("C13Q09")])
    verdicts = sprint.write("batch-3.json", {"C13Q09": "technical"})

    report = await sprint.import_source(source, verdicts)

    assert report.code == 1
    assert report.lines == [(str(verdicts), "-", "bad_format")]


async def test_the_results_and_the_source_imports_give_the_same_entries_in_either_order(
    database, tmp_path, base_mp4
):
    async def run(order: str) -> dict[str, dict]:
        await database.pool.execute("DELETE FROM library_entry_reviews")
        await database.pool.execute("DELETE FROM library_entries")
        await database.pool.execute("DELETE FROM video_assets WHERE external_id LIKE 'LIB_%'")
        root = tmp_path / order
        (root / "media").mkdir(parents=True)
        probe = await probe_avatar_mp4(base_mp4)
        sprint = Sprint(database, root, root / "media", root / "video", base_mp4, probe["duration_ms"])
        rendered = sprint.rendered("C14Q01", category=5, section_type="meeting", technical="non-technical")
        results = sprint.results_file("results.json", [rendered])
        source = sprint.write(
            "source.json",
            [
                sprint.source_row("C14Q01", category=5, section_type="meeting", technical="classify"),
                sprint.source_row("C14Q02", technical="classify"),
            ],
        )
        verdicts = sprint.write(
            "batch-1.json", _verdicts(("C14Q01", "non-technical"), ("C14Q02", "technical"))
        )
        steps = [sprint.import_results(results), sprint.import_source(source, verdicts)]
        for step in steps if order == "results-first" else reversed(steps):
            assert (await step).code == 0
        columns = ("status", "question", "answer_text", "answer_original", "language", "category")
        columns += ("category_title", "section_type", "technical")
        return {
            key: {name: entry[name] for name in columns} for key, entry in (await sprint.entries()).items()
        }

    assert await run("results-first") == await run("source-first")


# --- Export (SC-032, REQ-071) ----------------------------------------------------------------


async def _export(sprint: Sprint, *args: str) -> tuple[int, str, Path]:
    out_file = sprint.root / "answers.json"
    out = io.StringIO()
    parsed = library_export.parse_args(["--out", str(out_file), *args])
    code = await library_export.run(parsed, database=sprint.db, out=out)
    return code, out.getvalue(), out_file


async def test_the_export_writes_every_ready_entry_and_only_those(sprint):
    source = sprint.write(
        "source.json", [sprint.source_row("C15Q01"), sprint.source_row("C15Q02"), sprint.source_row("C15Q03")]
    )
    assert (await sprint.import_source(source)).code == 0
    await sprint.db.pool.execute(
        "UPDATE library_entries SET status='ready', answer_text=$1 WHERE key IN ('C15Q01','C15Q03')", SPOKEN
    )
    await sprint.db.pool.execute(
        'UPDATE library_entries SET import_metadata=\'{"batch": 4, "bridge_type": "meeting"}\' '
        "WHERE key='C15Q03'"
    )
    await sprint.add_entry("C15Q04", "withdrawn")

    code, printed, out_file = await _export(sprint)

    assert code == 0, printed
    exported = json.loads(out_file.read_text(encoding="utf-8"))
    assert [row["key"] for row in exported] == ["C15Q01", "C15Q03"]
    assert exported[0] == {
        "key": "C15Q01",
        "question": QUESTION,
        "answer": SPOKEN,
        "category": "2",
        "category_title": "امنیت شبکه",
        "section_type": "knowledge",
        "technical": "technical",
        "language": "fa",
        "answer_original": ORIGINAL,
        "batch": None,
        "bridge_type": None,
    }
    assert (exported[1]["batch"], exported[1]["bridge_type"]) == (4, "meeting")


async def test_the_export_takes_only_the_named_keys(sprint):
    for key in ("C16Q01", "C16Q02"):
        await sprint.add_entry(key, "ready")

    code, _, out_file = await _export(sprint, "--key", "C16Q02")

    assert code == 0
    assert [row["key"] for row in json.loads(out_file.read_text(encoding="utf-8"))] == ["C16Q02"]


async def test_the_export_refuses_a_named_key_that_is_not_a_ready_entry(sprint):
    await sprint.add_entry("C16Q03", "ready")
    await sprint.add_entry("C16Q04", "pending")

    code, printed, out_file = await _export(sprint, "--key", "C16Q03", "--key", "C16Q04", "--key", "NOPE")

    assert code == 1
    assert "C16Q04\tnot_ready" in printed
    assert "NOPE\tnot_ready" in printed
    assert not out_file.exists()


async def test_what_the_render_script_writes_from_an_export_imports_cleanly(sprint):
    """SC-032: export, render (simulated the way render_answers.py builds a result row), import."""
    with_metadata = await sprint.add_entry("C17Q01", "ready", category="4", technical="technical")
    await sprint.db.pool.execute(
        'UPDATE library_entries SET import_metadata=\'{"batch": 2, "bridge_type": "sizing"}\', '
        "answer_original=$2 WHERE id=$1",
        with_metadata,
        ORIGINAL,
    )
    await sprint.add_entry("C17Q02", "ready", answer_text=OTHER_ANSWER)  # no metadata, no original
    code, _, out_file = await _export(sprint)
    assert code == 0

    results = {}
    for item in json.loads(out_file.read_text(encoding="utf-8")):
        external_id = f"ANS_{item['key']}_20260926120000"
        sprint.mp4(external_id)
        results[item["key"]] = {
            **{name: value for name, value in item.items() if name != "answer"},
            "answer": item["answer"],
            "video_asset_id": str(uuid4()),
            "external_id": external_id,
            "audio_asset_id": str(uuid4()),
            "status": "VIDEO_GENERATED",
            "duration_ms": sprint.duration_ms,
            "file": f"/media/video/{external_id}.mp4",
            "error": None,
        }
    results_path = sprint.write("results.json", results)

    report = await sprint.import_results(results_path)

    assert report.code == 0, report.text
    assert report.codes() == {"C17Q01": "attached", "C17Q02": "attached"}
    for key in ("C17Q01", "C17Q02"):
        assert (await sprint.entry(key))["status"] == "draft"


# --- No question or answer text in a log or a report (SC-011, REQ-029, SEC-005) --------------


async def test_the_import_and_the_export_log_and_print_no_question_or_answer_text(sprint, caplog):
    caplog.set_level(logging.DEBUG)
    ready_id = await sprint.add_entry("C18Q01", "ready")
    await sprint.db.pool.execute("UPDATE library_entries SET question=$2 WHERE id=$1", ready_id, QUESTION)
    results = sprint.results_file(
        "results.json",
        [sprint.rendered("C18Q01"), sprint.rendered("C18Q02"), sprint.rendered("C18Q03", section_type="x")],
    )
    source = sprint.write("source.json", [sprint.source_row("C18Q04"), sprint.source_row("C18Q02")])

    reports = [await sprint.import_results(results, dry_run=True), await sprint.import_results(results)]
    results = sprint.results_file("results.json", [sprint.rendered("C18Q01"), sprint.rendered("C18Q02")])
    reports.append(await sprint.import_results(results))
    reports.append(await sprint.import_source(source))
    await sprint.add_entry("C18Q05", "ready")
    code, printed, _ = await _export(sprint)
    assert code == 0

    events = {record.getMessage() for record in caplog.records}
    assert {"library_entry_created", "library_entry_status_changed", "library_import_finished"} <= events
    assert "library_export_written" in events
    written = _log_text(caplog.records) + "".join(report.text for report in reports) + printed
    for text in (QUESTION, ANSWER, SPOKEN, ORIGINAL, SECTION):
        assert text not in written


# --- Arguments (REQ-020) --------------------------------------------------------------------


@pytest.mark.parametrize(
    "argv",
    [
        [],
        ["--results", "r.json", "--avatar-id", "a", "--voice-id", "v"],  # no --media-dir
        ["--results", "r.json", "--media-dir", "m", "--voice-id", "v"],  # no --avatar-id
        ["--results", "r.json", "--media-dir", "m", "--avatar-id", "a"],  # no --voice-id
        ["--source", "s.json"],  # no --language
        ["--source", "s.json", "--language", "de"],
        ["--source", "s.json", "--language", "fa", "--results", "r.json"],
        [
            "--results",
            "r.json",
            "--media-dir",
            "m",
            "--avatar-id",
            "a",
            "--voice-id",
            "v",
            "--verdicts",
            "b.json",
        ],
    ],
)
def test_the_import_refuses_an_incomplete_or_mixed_command_line(argv):
    with pytest.raises(SystemExit) as stopped:
        library_import.parse_args(argv)

    assert stopped.value.code == 2


def test_the_export_needs_an_out_file():
    with pytest.raises(SystemExit) as stopped:
        library_export.parse_args([])

    assert stopped.value.code == 2


async def test_a_results_import_takes_several_waves(sprint):
    wave1 = sprint.results_file("wave1.json", [sprint.rendered("C19Q01")])
    wave2 = sprint.results_file("wave2.json", [sprint.rendered("C19Q02")])

    report = await sprint.import_results(wave1, wave2)

    assert report.code == 0, report.text
    assert list(await sprint.entries()) == ["C19Q01", "C19Q02"]


async def test_two_imports_at_once_leave_each_key_once(sprint):
    results = sprint.results_file("results.json", [sprint.rendered("C20Q01")])

    reports = await asyncio.gather(sprint.import_results(results), sprint.import_results(results))

    # Which one loses depends on timing: a write_failed in phase 2, or already_imported in phase 1.
    assert 0 in [report.code for report in reports]
    assert list(await sprint.entries()) == ["C20Q01"]
    assert len(await sprint.videos()) == 1
    assert len(sprint.target_files()) == 1
