"""Import answers into the library (docs/features/response-caching/SPEC.md, REQ-020 to REQ-029).

Runs inside the orchestrator container, with that install's settings and database:

    python -m services.orchestrator.src.library_import --results <file> [--results <file> ...] \\
        --media-dir <dir> --avatar-id <id> --voice-id <id> [--dry-run]
    python -m services.orchestrator.src.library_import --source <file> --language fa|en \\
        [--verdicts <file> ...] [--dry-run]

`--results` reads the render run's results JSON and its MP4 files into `draft` entries. `--source`
reads the not-rendered answers of the source JSON into `pending` entries. A run is all or nothing:
phase 1 checks every row and writes nothing; phase 2 runs only when every row passed, and writes
every row in one transaction. `--dry-run` stops after phase 1.

The report names rows by file, key and reason code only, never by question or answer text
(REQ-029), and so do the logs. One line per reported row, tab separated, then a summary line.
"""

import argparse
import asyncio
import json
import logging
import re
import shutil
import sys
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, TextIO
from uuid import UUID

import asyncpg

from .config import get_settings
from .database import Database
from .errors import ProviderError
from .library.service import change_entry_status
from .logging import configure_logging
from .media_probe import probe_avatar_mp4
from .schemas import (
    LIBRARY_ANSWER_MAX,
    LIBRARY_KEY_PATTERN,
    LIBRARY_ORIGINAL_MAX,
    LIBRARY_QUESTION_MAX,
    AssetStatus,
    normalize_whitespace,
)

logger = logging.getLogger(__name__)

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"

SECTION_TYPES = {"knowledge", "identity", "sizing", "meeting", "commercial", "casual"}
TECHNICAL = {"technical", "non-technical", "classify"}
VERDICTS = {"technical", "non-technical"}
LANGUAGES = {"fa", "en"}
# How far the probed duration may be from the row's duration_ms (REQ-024).
DURATION_TOLERANCE_MS = 1000
# The prefix of an imported video's external_id and file name (REQ-024).
IMPORTED_PREFIX = "LIB_"

# Codes that report a row without failing the run (section 8).
NOT_RENDERED = "not_rendered"
ALREADY_IMPORTED = "already_imported"
ATTACHED = "attached"
NOTICES = frozenset({NOT_RENDERED, ALREADY_IMPORTED, ATTACHED})

# A JSON value of each type. bool is an int in Python, so it is refused apart.
_STR: tuple[type, ...] = (str,)
_STR_OR_INT: tuple[type, ...] = (str, int)
_INT: tuple[type, ...] = (int,)

# The fields a rendered results row must hold (REQ-021), and their JSON types. batch, bridge_type
# and answer_original may be absent or null: the export writes null when an entry has none, and
# its rows must import again. audio_asset_id is always written and may be null (render_answers.py
# reads it with .get).
_RENDERED_FIELDS: dict[str, tuple[type, ...]] = {
    "key": _STR,
    "question": _STR,
    "answer": _STR,
    "category": _STR_OR_INT,
    "category_title": _STR,
    "section_type": _STR,
    "technical": _STR,
    "language": _STR,
    "video_asset_id": _STR,
    "external_id": _STR,
    "status": _STR,
    "duration_ms": _INT,
    "file": _STR,
}
_RENDERED_NULLABLE: dict[str, tuple[type, ...]] = {"audio_asset_id": _STR}
_RENDERED_OPTIONAL: dict[str, tuple[type, ...]] = {
    "batch": _STR_OR_INT,
    "bridge_type": _STR,
    "answer_original": _STR,
}
_SOURCE_FIELDS: dict[str, tuple[type, ...]] = {
    "key": _STR,
    "question": _STR,
    "answer_original": _STR,
    "category": _STR_OR_INT,
    "category_title": _STR,
    "section": _STR,
    "section_type": _STR,
    "technical": _STR,
}


class _BadFormat(Exception):
    """The file cannot be used at all (REQ-021). `key` names the row that broke it, if any."""

    def __init__(self, key: str = "-") -> None:
        super().__init__(key)
        self.key = key


class _Failed(Exception):
    """One row fails with a reason code."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass
class _Row:
    file: str
    key: str
    code: str | None = None  # the reason code, once the row is failed or skipped
    values: dict[str, Any] = field(default_factory=dict)  # the entry's columns
    render: dict[str, Any] = field(default_factory=dict)  # results only: the render's own fields
    entry: asyncpg.Record | None = None  # the existing entry a results row attaches to (REQ-028)
    source: Path | None = None
    probe: dict[str, Any] | None = None

    @property
    def target_name(self) -> str:
        return f"{IMPORTED_PREFIX}{self.render['external_id']}"

    @property
    def reported(self) -> str | None:
        if self.code is None and self.entry is not None:
            return ATTACHED
        return self.code


@dataclass
class _Report:
    rows: list[_Row] = field(default_factory=list)
    bad_files: list[str] = field(default_factory=list)

    @property
    def failed(self) -> bool:
        return bool(self.bad_files) or any(row.code and row.code not in NOTICES for row in self.rows)

    @property
    def writable(self) -> list[_Row]:
        return [row for row in self.rows if row.code is None]


# --- Checks shared by both inputs (REQ-022) ---------------------------------------------------


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise _BadFormat() from exc


def _of_type(value: Any, types: tuple[type, ...]) -> bool:
    return isinstance(value, types) and not isinstance(value, bool)


def _check_types(row: dict[str, Any], key: str, required, nullable=None, optional=None) -> None:
    """A missing field or a wrong type fails the whole file (REQ-021)."""
    for name, types in required.items():
        if name not in row or not _of_type(row[name], types):
            raise _BadFormat(key)
    for name, types in (nullable or {}).items():
        if name not in row or (row[name] is not None and not _of_type(row[name], types)):
            raise _BadFormat(key)
    for name, types in (optional or {}).items():
        if row.get(name) is not None and not _of_type(row[name], types):
            raise _BadFormat(key)


def _label_values(row: dict[str, Any]) -> dict[str, Any]:
    """The checked key, question, original answer and category fields, as an entry stores them."""
    if not re.fullmatch(LIBRARY_KEY_PATTERN, row["key"]):
        raise _Failed("bad_key")
    question = row["question"].strip()
    if not 1 <= len(question) <= LIBRARY_QUESTION_MAX:
        raise _Failed("bad_question")
    values: dict[str, Any] = {"key": row["key"], "question": question}
    if "answer" in row:
        answer = normalize_whitespace(row["answer"])
        if not 1 <= len(answer) <= LIBRARY_ANSWER_MAX:
            raise _Failed("bad_answer")
        values["answer_text"] = answer
    original = row.get("answer_original")
    if original is not None:
        original = original.strip()
        if not 1 <= len(original) <= LIBRARY_ORIGINAL_MAX:
            raise _Failed("bad_answer_original")
    values["answer_original"] = original
    category = row["category"]
    category = str(category) if isinstance(category, int) else category.strip()
    title = row["category_title"].strip()
    if not category or not title:
        raise _Failed("bad_category")
    if row["section_type"] not in SECTION_TYPES:
        raise _Failed("bad_section_type")
    if row["technical"] not in TECHNICAL:
        raise _Failed("bad_technical")
    values |= {
        "category": category,
        "category_title": title,
        "section_type": row["section_type"],
        "technical": row["technical"],
    }
    return values


def _mark_duplicates(rows: list[_Row], value_of: Callable[[_Row], str], code: str) -> None:
    """Every row that shares a value with another row of the run fails with `code` (REQ-024)."""
    counts = Counter(value_of(row) for row in rows)
    for row in rows:
        if row.code is None and counts[value_of(row)] > 1:
            row.code = code


def _key(row: _Row) -> str:
    return row.key


# --- Results (REQ-021 to REQ-028) --------------------------------------------------------------


def _parse_results(path: Path, name: str) -> list[_Row]:
    data = _read_json(path)
    if not isinstance(data, dict):
        raise _BadFormat()
    rows = []
    for key, raw in data.items():
        if not isinstance(raw, dict) or "error" not in raw:
            raise _BadFormat(key)
        if raw["error"] is not None:
            # A failed render: only key and error are promised. Reported, never checked further.
            rows.append(_Row(name, key, NOT_RENDERED))
            continue
        _check_types(raw, key, {"status": _STR})
        missing = set(_RENDERED_FIELDS) | set(_RENDERED_NULLABLE)
        if not missing <= set(raw):
            raise _BadFormat(key)
        if raw["status"] != AssetStatus.VIDEO_GENERATED:
            rows.append(_Row(name, key, NOT_RENDERED))
            continue
        _check_types(raw, key, _RENDERED_FIELDS, _RENDERED_NULLABLE, _RENDERED_OPTIONAL)
        rows.append(_rendered_row(name, key, raw))
    return rows


def _rendered_row(name: str, key: str, raw: dict[str, Any]) -> _Row:
    render = {
        "external_id": raw["external_id"],
        "file": raw["file"],
        "duration_ms": raw["duration_ms"],
        "sheet_video_asset_id": raw["video_asset_id"],
        "sheet_audio_asset_id": raw["audio_asset_id"],
    }
    row = _Row(name, key, render=render)
    try:
        if raw["key"] != key:
            raise _Failed("bad_key")
        row.values = _label_values(raw)
        if raw["language"] not in LANGUAGES:
            raise _Failed("bad_language")
        try:
            UUID(raw["video_asset_id"])
        except ValueError as exc:
            raise _Failed("bad_video_asset_id") from exc
        if raw["duration_ms"] <= 0:
            raise _Failed("bad_duration")
    except _Failed as failed:
        row.code = failed.code
        return row
    metadata = {name: raw[name] for name in ("batch", "bridge_type") if raw.get(name) is not None}
    row.values |= {"language": raw["language"], "import_metadata": metadata}
    return row


async def _check_results(database: Database, paths: list[Path], media_dir: Path, video_dir: Path) -> _Report:
    """Phase 1 of a results import. Writes nothing."""
    report = _Report()
    for path in paths:
        try:
            report.rows += _parse_results(path, str(path))
        except _BadFormat as bad:
            report.bad_files.append(f"{path}\t{bad.key}")
    rendered = [row for row in report.rows if row.code != NOT_RENDERED]
    _mark_duplicates(rendered, _key, "duplicate_key")
    _mark_duplicates(rendered, lambda row: row.render["external_id"], "duplicate_external_id")

    candidates = [row for row in rendered if row.code is None]
    existing = {
        entry["key"]: entry for entry in await database.library_entries_by_key([r.key for r in candidates])
    }
    for row in candidates:
        _meet_entry(row, existing.get(row.key))
    for row in report.writable:
        await _check_file(row, media_dir, video_dir)
    names = [row.target_name for row in report.writable]
    taken = await database.taken_video_external_ids(names) if names else set()
    for row in report.writable:
        if row.target_name in taken:
            row.code = "external_id_taken"
    return report


def _meet_entry(row: _Row, entry: asyncpg.Record | None) -> None:
    """REQ-028: a row whose key has an entry attaches to a ready or pending one in the same
    language saying the same text. Another status is `already_imported`; another language or text
    fails (`language_mismatch`, `answer_text_mismatch`, section 8)."""
    if entry is None:
        return
    if entry["status"] not in ("ready", "pending"):
        row.code = ALREADY_IMPORTED
        return
    if entry["language"] != row.values["language"]:
        row.code = "language_mismatch"
        return
    text = entry["answer_text"]
    may_take_text = entry["status"] == "pending" and text is None
    if not may_take_text and (text is None or normalize_whitespace(text) != row.values["answer_text"]):
        row.code = "answer_text_mismatch"
        return
    row.entry = entry


async def _check_file(row: _Row, media_dir: Path, video_dir: Path) -> None:
    """REQ-024: the MP4 is where the row says, probes, lasts what the row says, and its target
    name is free."""
    name = Path(row.render["file"]).name
    if name != f"{row.render['external_id']}.mp4":
        row.code = "bad_file"
        return
    source = media_dir / name
    if not source.is_file():
        row.code = "file_missing"
        return
    try:
        probe = await probe_avatar_mp4(source)
    except ProviderError:
        row.code = "probe_failed"
        return
    if abs(probe["duration_ms"] - row.render["duration_ms"]) > DURATION_TOLERANCE_MS:
        row.code = "duration_mismatch"
        return
    if (video_dir / f"{row.target_name}.mp4").exists():
        row.code = "file_exists"
        return
    row.source, row.probe = source, probe


def _copy_new(source: Path, target: Path, copied: list[Path]) -> None:
    """Copy to a file that must not exist yet. The copy is not probed again; its size is checked."""
    with source.open("rb") as reader, target.open("xb") as writer:
        copied.append(target)
        shutil.copyfileobj(reader, writer)
    if target.stat().st_size != source.stat().st_size:
        raise OSError(f"the copy of {source.name} has the wrong size")


async def _write_results(
    database: Database, rows: list[_Row], video_dir: Path, avatar_id: str, voice_id: str
) -> list[tuple[str, UUID, str | None]]:
    """Phase 2: copy every file, then insert every video and write every entry in one transaction.
    Returns what changed, to log after the commit: (event, entry id, status left)."""
    copied: list[Path] = []
    try:
        video_dir.mkdir(parents=True, exist_ok=True)
        for row in rows:
            await asyncio.to_thread(_copy_new, row.source, video_dir / f"{row.target_name}.mp4", copied)
        async with database.transaction() as conn:
            return [await _write_result(database, conn, row, video_dir, avatar_id, voice_id) for row in rows]
    except BaseException:
        for path in copied:
            path.unlink(missing_ok=True)
        raise


async def _write_result(
    database: Database,
    conn: asyncpg.Connection,
    row: _Row,
    video_dir: Path,
    avatar_id: str,
    voice_id: str,
) -> tuple[str, UUID, str | None]:
    video_id = await database.insert_imported_video(
        conn,
        {
            "external_id": row.target_name,
            "text": row.values["answer_text"],
            "avatar_id": avatar_id,
            "voice_id": voice_id,
            "video_path": str((video_dir / f"{row.target_name}.mp4").absolute()),
            "duration_ms": row.probe["duration_ms"],
            "metadata": {
                "ffprobe": row.probe,
                "imported_from": {
                    "sheet_video_asset_id": row.render["sheet_video_asset_id"],
                    "sheet_external_id": row.render["external_id"],
                    "sheet_audio_asset_id": row.render["sheet_audio_asset_id"],
                },
            },
        },
    )
    if row.entry is None:
        entry_id = await database.insert_library_entry(
            conn, row.values | {"video_asset_id": video_id, "status": "draft", "created_by": None}
        )
        return "library_entry_created", entry_id, None
    entry_id, status = row.entry["id"], row.entry["status"]
    await change_entry_status(
        database,
        entry_id,
        "draft",
        reviewer_id=None,
        video_asset_id=video_id,
        importing=True,
        from_status=status,
        conn=conn,
    )
    if status == "pending":
        # The rendered row is the later, approved version of the same question (REQ-028).
        labels = {
            name: row.values[name] for name in ("category", "category_title", "section_type", "technical")
        }
        if not await database.update_library_entry_fields(
            entry_id, labels, allowed_statuses=["draft"], conn=conn
        ):
            raise RuntimeError("the attached entry is no longer a draft")
    return "library_entry_status_changed", entry_id, status


# --- Source (REQ-021, REQ-026, REQ-028) --------------------------------------------------------


def _parse_verdicts(path: Path) -> list[tuple[str, str, str]]:
    """(file, key, technical) for each row. The import reads only key and technical."""
    data = _read_json(path)
    if not isinstance(data, list):
        raise _BadFormat()
    rows = []
    for raw in data:
        if not isinstance(raw, dict) or not _of_type(raw.get("key"), _STR):
            raise _BadFormat()
        if not _of_type(raw.get("technical"), _STR):
            raise _BadFormat(raw["key"])
        rows.append((str(path), raw["key"], raw["technical"]))
    return rows


def _parse_source(path: Path, language: str) -> list[_Row]:
    data = _read_json(path)
    if not isinstance(data, list):
        raise _BadFormat()
    rows = []
    for raw in data:
        if not isinstance(raw, dict):
            raise _BadFormat()
        key = raw["key"] if _of_type(raw.get("key"), _STR) else "-"
        _check_types(raw, key, _SOURCE_FIELDS)
        row = _Row(str(path), key)
        try:
            row.values = _label_values(raw)
        except _Failed as failed:
            row.code = failed.code
        row.values |= {
            "language": language,
            "import_metadata": {"section": raw["section"], "source_technical": raw["technical"]},
        }
        rows.append(row)
    return rows


async def _check_source(database: Database, path: Path, language: str, verdict_paths: list[Path]) -> _Report:
    """Phase 1 of a source import: no files to check. Writes nothing."""
    report = _Report()
    verdicts: dict[str, str] = {}
    verdict_rows: list[_Row] = []
    for verdict_path in verdict_paths:
        try:
            for file, key, technical in _parse_verdicts(verdict_path):
                row = _Row(file, key, None if technical in VERDICTS else "bad_technical")
                row.values["technical"] = technical
                verdict_rows.append(row)
                verdicts[key] = technical
        except _BadFormat as bad:
            report.bad_files.append(f"{verdict_path}\t{bad.key}")
    # The same key in two verdict rows is fine when they agree, since both settle it the same way.
    verdict_values: dict[str, set[str]] = {}
    for row in verdict_rows:
        verdict_values.setdefault(row.key, set()).add(row.values["technical"])
    for row in verdict_rows:
        if row.code is None and len(verdict_values[row.key]) > 1:
            row.code = "duplicate_key"
    report.rows += [row for row in verdict_rows if row.code is not None]
    try:
        rows = _parse_source(path, language)
    except _BadFormat as bad:
        report.bad_files.append(f"{path}\t{bad.key}")
        return report
    _mark_duplicates(rows, _key, "duplicate_key")
    existing = {entry["key"] for entry in await database.library_entries_by_key([row.key for row in rows])}
    for row in rows:
        if row.code is None and row.key in existing:
            row.code = ALREADY_IMPORTED
        if row.code is None and row.values["technical"] == "classify" and verdicts.get(row.key) in VERDICTS:
            row.values["technical"] = verdicts[row.key]
    report.rows += rows
    return report


async def _write_source(database: Database, rows: list[_Row]) -> list[tuple[str, UUID, str | None]]:
    async with database.transaction() as conn:
        created = []
        for row in rows:
            entry = row.values | {
                "answer_text": None,
                "video_asset_id": None,
                "status": "pending",
                "created_by": None,
            }
            created.append(("library_entry_created", await database.insert_library_entry(conn, entry), None))
        return created


# --- The command ------------------------------------------------------------------------------


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m services.orchestrator.src.library_import",
        description="Import rendered (--results) or not-rendered (--source) answers into the library.",
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument(
        "--results", action="append", type=Path, help="a render run's results JSON (repeatable)"
    )
    source.add_argument("--source", type=Path, help="the source JSON of the not-rendered answers")
    parser.add_argument("--media-dir", type=Path, help="with --results: the folder of the MP4 files")
    parser.add_argument("--avatar-id", help="with --results: the avatar the render used")
    parser.add_argument("--voice-id", help="with --results: the voice the render used")
    parser.add_argument(
        "--language", choices=sorted(LANGUAGES), help="with --source: the language of its rows"
    )
    parser.add_argument(
        "--verdicts", action="append", type=Path, help="with --source: a verdict file (repeatable)"
    )
    parser.add_argument("--dry-run", action="store_true", help="check every row and write nothing")
    args = parser.parse_args(argv)
    if args.results:
        needed = {"--media-dir": args.media_dir, "--avatar-id": args.avatar_id, "--voice-id": args.voice_id}
        missing = [name for name, value in needed.items() if not value]
        if missing:
            parser.error(f"--results also needs {', '.join(missing)}")
        if args.language or args.verdicts:
            parser.error("--language and --verdicts go with --source")
    else:
        if not args.language:
            parser.error("--source also needs --language")
        if args.media_dir or args.avatar_id or args.voice_id:
            parser.error("--media-dir, --avatar-id and --voice-id go with --results")
    return args


async def run(args: argparse.Namespace, *, database: Database, video_dir: Path, out: TextIO) -> int:
    """One import. Returns the exit status: 0 when every row passed, 1 otherwise."""
    kind = "results" if args.results else "source"
    try:
        if args.results:
            report = await _check_results(database, args.results, args.media_dir, video_dir)
        else:
            report = await _check_source(database, args.source, args.language, args.verdicts or [])
    except OSError as exc:
        print(f"cannot read an input file: {exc.strerror} ({exc.filename})", file=out)
        return 1
    for bad in report.bad_files:
        print(f"{bad}\tbad_format", file=out)
    for row in report.rows:
        if row.reported:
            print(f"{row.file}\t{row.key}\t{row.reported}", file=out)

    counts = Counter(row.reported for row in report.rows if row.reported)
    if report.bad_files:
        counts["bad_format"] += len(report.bad_files)
    created = 0 if report.failed else sum(1 for row in report.writable if row.entry is None)
    outcome = (
        "failed, nothing written" if report.failed else "dry run, nothing written" if args.dry_run else ""
    )
    if report.failed or args.dry_run:
        _summary(out, kind, created, counts, outcome)
        return 1 if report.failed else 0

    rows = report.writable
    try:
        if args.results:
            changes = await _write_results(database, rows, video_dir, args.avatar_id, args.voice_id)
        else:
            changes = await _write_source(database, rows)
    except Exception as exc:  # the boundary: report it, and say nothing of the rows' text
        print("-\t-\twrite_failed", file=out)
        counts["write_failed"] += 1
        _summary(out, kind, 0, counts, f"failed ({type(exc).__name__}), nothing written")
        logger.error("library_import_failed", extra={"kind": kind, "error_type": type(exc).__name__})
        return 1
    for event, entry_id, left in changes:
        extra: dict[str, Any] = {"entry_id": str(entry_id), "admin_id": None}
        if left is not None:
            extra |= {"from_status": left, "to_status": "draft"}
        logger.info(event, extra=extra)
    _summary(out, kind, created, counts, "written")
    return 0


def _summary(out: TextIO, kind: str, created: int, counts: Counter, outcome: str) -> None:
    parts = [f"created={created}"] + [f"{code}={counts[code]}" for code in sorted(counts)]
    print(f"summary: {kind} import, {' '.join(parts)}: {outcome}", file=out)
    logger.info(
        "library_import_finished", extra={"kind": kind, "entries_created": created, "codes": dict(counts)}
    )


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    settings = get_settings()
    configure_logging(settings.log_level)

    async def import_once() -> int:
        database = Database(settings.database_url, MIGRATIONS)
        await database.connect()
        try:
            return await run(args, database=database, video_dir=settings.video_cache_dir, out=sys.stdout)
        finally:
            await database.close()

    return asyncio.run(import_once())


if __name__ == "__main__":
    sys.exit(main())
