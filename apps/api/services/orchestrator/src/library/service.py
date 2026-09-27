"""The rules of the answer library (docs/features/response-caching/SPEC.md, group A).

Every status change goes through change_entry_status and its one table, LIBRARY_TRANSITIONS
(REQ-065), for the status route and for the import alike. Every user route decides what a user may
see with `servable_*` (REQ-011). No log line carries question or answer text (REQ-017): events log
ids, field names and statuses only.
"""

import asyncio
import logging
import os
import re
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO
from uuid import UUID

import asyncpg

from ..database import Database
from ..errors import AppError, NotFoundError, ValidationError
from ..schemas import (
    LIBRARY_ANSWER_MAX,
    LIBRARY_KEY_PATTERN,
    AssetStatus,
    LibraryEntryCreateBody,
    LibraryEntryPatchBody,
    normalize_whitespace,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Transition:
    decision: str  # the library_entry_reviews row it writes
    video: str | None = None  # what it does to a video: "attach", "approve" or "reject"
    import_only: bool = False


# Target status -> current status -> transition (REQ-065). The status route and the import call
# the same function with the transition they want; only the import may use an import_only row.
LIBRARY_TRANSITIONS: dict[str, dict[str, Transition]] = {
    "ready": {
        "pending": Transition("ready"),  # REQ-066, the admin approved the spoken text
        "draft": Transition("video_rejected", video="reject"),  # REQ-069
    },
    "pending": {"ready": Transition("reopened")},  # REQ-067
    "draft": {
        "ready": Transition("video_attached", video="attach"),  # REQ-068
        "pending": Transition("video_attached", video="attach", import_only=True),  # REQ-028
        "published": Transition("unpublished"),  # REQ-007
    },
    "published": {"draft": Transition("published", video="approve")},  # REQ-006
    "withdrawn": {  # REQ-008, final
        current: Transition("withdrawn") for current in ("pending", "ready", "draft", "published")
    },
}

# The fields an admin may edit in place, per status (REQ-005). The answer text and the language tie
# to the audio, so they change only before the text is approved. Published and withdrawn entries
# are not edited in place.
_LABEL_FIELDS = frozenset({"question", "category", "category_title", "section_type", "technical"})
EDITABLE_FIELDS: dict[str, frozenset[str]] = {
    "pending": _LABEL_FIELDS | {"answer_text", "language"},
    "ready": _LABEL_FIELDS,
    "draft": _LABEL_FIELDS,
}

FOLLOW_UP_LIMIT = 3
# The deepest funnel stage (REQ-077). After it, the follow-ups stay on it.
FINAL_STAGE = 3


def _invalid_transition(current: str, message: str) -> AppError:
    return AppError("invalid_status_transition", message, 409, False, {"currentStatus": current})


def _conflict(code: str, message: str) -> AppError:
    return AppError(code, message, 409, False)


def _video_not_ready() -> AppError:
    return _conflict("library_video_not_ready", "the video is not a finished recording with its file")


def _video_in_use() -> AppError:
    return _conflict("library_video_in_use", "the video already belongs to another library entry")


def _unique_conflict(exc: asyncpg.UniqueViolationError) -> AppError:
    """The two unique columns, for the case where a concurrent write took the value first."""
    if exc.constraint_name == "library_entries_video_unique":
        return _video_in_use()
    if exc.constraint_name == "library_entries_key_unique":
        return _conflict("library_key_taken", "another library entry has this key")
    raise exc


def _is_file(path: str) -> bool:
    return Path(path).is_file()


def _has_content(path: str) -> bool:
    return _is_file(path) and Path(path).stat().st_size > 0


def _spoken_text(text: str) -> str:
    """A video's text as an entry would store it (REQ-003), or 422 when an entry cannot hold it."""
    spoken = normalize_whitespace(text)
    if not 1 <= len(spoken) <= LIBRARY_ANSWER_MAX:
        raise ValidationError(f"the recording's text must be 1 to {LIBRARY_ANSWER_MAX} characters")
    return spoken


async def _joinable_video(database: Database, conn: asyncpg.Connection, video_id: UUID) -> asyncpg.Record:
    """Lock a video that may join an entry: a finished recording with its file, used by no entry
    (REQ-004, REQ-068)."""
    video = await database.lock_video_asset(conn, video_id)
    if video is None:
        raise NotFoundError("video asset")
    if video["status"] != AssetStatus.VIDEO_GENERATED or not _has_content(video["video_path"]):
        raise _video_not_ready()
    if await database.library_uses_video(conn, video_id):
        raise _video_in_use()
    return video


async def create_entry(database: Database, body: LibraryEntryCreateBody, *, admin_id: UUID) -> asyncpg.Record:
    """A pending entry from text, or a draft entry from a finished recording (REQ-004)."""
    try:
        async with database.transaction() as conn:
            status, answer_text, key = "pending", body.answer_text, body.key
            if body.video_asset_id is not None:
                video = await _joinable_video(database, conn, body.video_asset_id)
                status, answer_text = "draft", _spoken_text(video["text"])
                key = key or video["external_id"]
                if not re.fullmatch(LIBRARY_KEY_PATTERN, key):
                    raise ValidationError("the recording's name is not a valid key, so send a key")
            entry_id = await database.insert_library_entry(
                conn,
                {
                    "key": key,
                    "question": body.question,
                    "answer_text": answer_text,
                    "answer_original": body.answer_original,
                    "language": body.language,
                    "category": body.category,
                    "category_title": body.category_title,
                    "section_type": body.section_type,
                    "technical": body.technical,
                    "video_asset_id": body.video_asset_id,
                    "status": status,
                    "created_by": admin_id,
                },
            )
            entry = await database.get_library_entry(entry_id, conn=conn)
    except asyncpg.UniqueViolationError as exc:
        raise _unique_conflict(exc) from exc
    logger.info("library_entry_created", extra={"entry_id": str(entry_id), "admin_id": str(admin_id)})
    return entry


async def edit_entry(
    database: Database, entry_id: UUID, body: LibraryEntryPatchBody, *, admin_id: UUID
) -> asyncpg.Record:
    """Change fields in place (REQ-005). The status check is part of the UPDATE, so an entry that
    moved meanwhile is refused, not edited."""
    fields = {name: getattr(body, name) for name in body.model_fields_set}
    allowed = [status for status, editable in EDITABLE_FIELDS.items() if set(fields) <= editable]
    if not await database.update_library_entry_fields(entry_id, fields, allowed_statuses=allowed):
        current = await database.get_library_entry(entry_id)
        if current is None:
            raise NotFoundError("library entry")
        locked = ", ".join(sorted(fields))
        raise _invalid_transition(
            current["status"], f"a library entry in {current['status']} cannot change {locked}"
        )
    logger.info(
        "library_entry_edited",
        extra={"entry_id": str(entry_id), "admin_id": str(admin_id), "fields": sorted(fields)},
    )
    return await database.get_library_entry(entry_id)


async def change_entry_status(
    database: Database,
    entry_id: UUID,
    target: str,
    *,
    reviewer_id: UUID | None,
    video_asset_id: UUID | None = None,
    importing: bool = False,
    from_status: str | None = None,
    conn: asyncpg.Connection | None = None,
) -> asyncpg.Record:
    """Move an entry along one row of LIBRARY_TRANSITIONS, with its video step and its review row,
    in one transaction. Returns the entry as the admin list shows it.

    The entry row is locked first, so a second change of the same entry waits and then finds the
    new status. `reviewer_id` is None only for the import (`importing`), which is also the only
    caller allowed an import_only row. `from_status`, when given, must be the status found under
    the lock: the target `ready` means "mark ready" from pending and "reject the video" from
    draft, and a caller that expected one must never run the other.

    `conn` runs the change inside a transaction the caller holds: the import writes all its rows in
    one (REQ-024). The change then commits or rolls back with the caller's writes, so the caller
    logs it after its own commit.
    """
    held = conn is not None
    try:
        async with _held_or_own(database, conn) as conn:
            entry = await database.lock_library_entry(conn, entry_id)
            if entry is None:
                raise NotFoundError("library entry")
            current = entry["status"]
            if from_status is not None and from_status != current:
                raise _invalid_transition(current, f"the library entry is in {current}, not in {from_status}")
            transition = LIBRARY_TRANSITIONS[target].get(current)
            if transition is None or (transition.import_only and not importing):
                raise _invalid_transition(current, f"a library entry in {current} cannot move to {target}")
            if video_asset_id is not None and transition.video != "attach":
                raise ValidationError("videoAssetId is only sent to attach a video to a ready entry")

            video_id, answer_text = entry["video_asset_id"], entry["answer_text"]
            reviewed_video = None
            if current == "pending" and target == "ready":
                _require_answer(answer_text)
            elif transition.video == "attach":
                video_id, answer_text = await _attach(database, conn, entry, video_asset_id)
                reviewed_video = video_id
            elif transition.video == "approve":
                await _approve_video(database, conn, video_id, reviewer_id)
            elif transition.video == "reject":
                # REQ-069. A video that is already REJECTED changes nothing and writes no audit row;
                # the entry still lets it go.
                await database.review_asset(
                    "video",
                    video_id,
                    decision=AssetStatus.REJECTED.value,
                    allowed_from=[AssetStatus.VIDEO_GENERATED.value, AssetStatus.VIDEO_APPROVED.value],
                    reviewer_user_id=reviewer_id,
                    conn=conn,
                )
                reviewed_video, video_id = video_id, None

            allowed_from = [
                name for name, row in LIBRARY_TRANSITIONS[target].items() if importing or not row.import_only
            ]
            if not await database.set_library_entry_status(
                conn,
                entry_id,
                status=target,
                allowed_from=allowed_from,
                video_asset_id=video_id,
                answer_text=answer_text,
            ):
                raise _invalid_transition(current, f"a library entry in {current} cannot move to {target}")
            await database.insert_library_review(
                conn,
                entry_id,
                reviewer_id=reviewer_id,
                decision=transition.decision,
                video_asset_id=reviewed_video,
            )
            changed = await database.get_library_entry(entry_id, conn=conn)
    except asyncpg.UniqueViolationError as exc:
        raise _unique_conflict(exc) from exc
    if held:
        return changed
    logger.info(
        "library_entry_status_changed",
        extra={
            "entry_id": str(entry_id),
            "admin_id": str(reviewer_id) if reviewer_id else None,
            "from_status": current,
            "to_status": target,
        },
    )
    return changed


@asynccontextmanager
async def _held_or_own(
    database: Database, conn: asyncpg.Connection | None
) -> AsyncIterator[asyncpg.Connection]:
    """The caller's connection, whose transaction the caller commits, or a new transaction."""
    if conn is not None:
        yield conn
        return
    async with database.transaction() as own:
        yield own


def _require_answer(answer_text: str | None) -> None:
    """REQ-066: ready needs a spoken text of 1 to 480 characters, counted after normalization."""
    if answer_text is None or not 1 <= len(normalize_whitespace(answer_text)) <= LIBRARY_ANSWER_MAX:
        raise ValidationError(
            f"an entry needs an answer text of 1 to {LIBRARY_ANSWER_MAX} characters to be ready"
        )


async def _attach(
    database: Database, conn: asyncpg.Connection, entry: asyncpg.Record, video_asset_id: UUID | None
) -> tuple[UUID, str]:
    """REQ-068, and REQ-028 for the import: the video must say the entry's text (REQ-003). An
    imported pending entry with no text yet takes the video's text."""
    if video_asset_id is None:
        raise ValidationError("videoAssetId is required to attach a video")
    video = await _joinable_video(database, conn, video_asset_id)
    spoken = _spoken_text(video["text"])
    answer_text = entry["answer_text"]
    if answer_text is None and entry["status"] == "pending":
        return video["id"], spoken
    if answer_text is None or normalize_whitespace(answer_text) != spoken:
        raise _conflict("library_text_mismatch", "the video does not say the answer text of this entry")
    return video["id"], answer_text


async def _approve_video(
    database: Database, conn: asyncpg.Connection, video_id: UUID, reviewer_id: UUID | None
) -> None:
    """REQ-006: a generated video is approved with the asset review's own update and audit row; an
    approved one is left as it is; anything else, or a missing file, cannot be published."""
    video = await database.lock_video_asset(conn, video_id)
    if video is None or not _is_file(video["video_path"]):
        raise _video_not_ready()
    if video["status"] == AssetStatus.VIDEO_APPROVED:
        return
    if video["status"] != AssetStatus.VIDEO_GENERATED or reviewer_id is None:
        raise _video_not_ready()
    await database.review_asset(
        "video",
        video_id,
        decision=AssetStatus.VIDEO_APPROVED.value,
        allowed_from=[AssetStatus.VIDEO_GENERATED.value],
        reviewer_user_id=reviewer_id,
        conn=conn,
    )


# --- What a signed-in user may see (REQ-011) --------------------------------------------------

Page = Callable[[int, int], Awaitable[list[asyncpg.Record]]]


def _servable(rows: list[asyncpg.Record]) -> list[asyncpg.Record]:
    """The file half of "servable". The database half is in the query."""
    return [row for row in rows if _is_file(row["video_path"])]


async def _first_servable(fetch_page: Page, limit: int) -> list[asyncpg.Record]:
    """Up to `limit` servable rows, in query order. Pages on while rows lack their file, so a
    missing file never shortens the list."""
    found: list[asyncpg.Record] = []
    offset = 0
    while len(found) < limit:
        rows = await fetch_page(limit, offset)
        found.extend(_servable(rows))
        if len(rows) < limit:
            break
        offset += limit
    return found[:limit]


async def servable_suggestions(database: Database, language: str, limit: int) -> list[asyncpg.Record]:
    return await _first_servable(
        lambda size, offset: database.servable_library_suggestions(language, limit=size, offset=offset), limit
    )


async def servable_entry(database: Database, entry_id: UUID) -> asyncpg.Record | None:
    row = await database.servable_library_entry(entry_id)
    return row if row is not None and _servable([row]) else None


async def servable_follow_ups(database: Database, entry: asyncpg.Record) -> list[asyncpg.Record]:
    """REQ-077: same category and language, one funnel stage deeper, the last stage on itself."""
    stage = min(entry["stage"] + 1, FINAL_STAGE)
    return await _first_servable(
        lambda size, offset: database.servable_library_follow_ups(
            language=entry["language"],
            category=entry["category"],
            stage=stage,
            exclude_id=entry["id"],
            limit=size,
            offset=offset,
        ),
        FOLLOW_UP_LIMIT,
    )


# How much of an MP4 the video route reads and sends at a time.
VIDEO_CHUNK_BYTES = 256 * 1024


def _open_with_size(path: str) -> tuple[BinaryIO, int]:
    # Not a `with` block: the caller hands the open file to the response, which closes it.
    handle = open(path, "rb")
    try:
        return handle, os.fstat(handle.fileno()).st_size
    except BaseException:
        handle.close()
        raise


async def open_video(entry: asyncpg.Record) -> tuple[BinaryIO, int] | None:
    """Open the MP4 of a servable entry and return it with its size, or None when the file is gone
    since the servable check. An open file stays readable even if it is deleted now, so from here
    the whole file can be sent."""
    try:
        return await asyncio.to_thread(_open_with_size, entry["video_path"])
    except OSError:
        return None


def read_chunks(handle: BinaryIO) -> Iterator[bytes]:
    """The whole file in chunks. The response that sends them owns the handle and closes it."""
    while chunk := handle.read(VIDEO_CHUNK_BYTES):
        yield chunk


async def record_play(database: Database, entry: asyncpg.Record) -> None:
    """The usage row of one delivered answer (REQ-015). No user, principal or session id: a row
    that joined a person to a health question would record which person chose which topic."""
    usage: dict[str, Any] = {
        "provider": "liveavatar",
        "operation": "assistant_answer",
        "provider_resource_id": None,
        "model": None,
        "characters": None,
        "estimated_duration_ms": entry["duration_ms"],
        "cache_hit": True,
        "metadata": {"library_entry_id": str(entry["id"]), "source": "library"},
    }
    await database.record_usage(usage)


async def unused_recordings(
    database: Database, *, page: int, page_size: int
) -> tuple[list[asyncpg.Record], int]:
    """REQ-042: finished recordings with a file that no entry uses, newest first. The file must be
    one an entry could take (REQ-004), so an empty file is left out too."""
    rows = [row for row in await database.unused_video_recordings() if _has_content(row["video_path"])]
    start = (page - 1) * page_size
    return rows[start : start + page_size], len(rows)
