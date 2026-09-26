"""The answer library routes (docs/features/response-caching/SPEC.md, section 6).

Two doors. The user routes need a signed-in user (`get_current_user`), never the widget's embed
key: the widget plays no library entries until it signs users in (ADR 0014, item 3). The admin
routes sit on a router that needs the admin role.
"""

from typing import BinaryIO
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from starlette.types import Receive, Scope, Send

from ..auth.dependencies import UserRow, get_current_user, require_admin
from ..errors import NotFoundError, RateLimitedError
from ..schemas import (
    AdminLibraryEntry,
    AdminLibraryEntryPage,
    LibraryEntryCreateBody,
    LibraryEntryPatchBody,
    LibraryLanguage,
    LibraryRecording,
    LibraryRecordingPage,
    LibraryStatus,
    LibraryStatusBody,
    LibrarySuggestion,
    LibrarySuggestionList,
    SectionType,
    Technical,
)
from . import service

HOUR_SECONDS = 3600

# The router dependency guarantees the door for every route here; a route that needs the user
# asks for it again and gets the same resolved user.
router = APIRouter(tags=["library"], dependencies=[Depends(get_current_user)])
admin_router = APIRouter(tags=["library"], dependencies=[Depends(require_admin)])


class _WholeVideoResponse(StreamingResponse):
    """The whole MP4 with 200, and the file closed when the response ends, however it ends.

    A client that leaves mid-download stops the stream while the body generator waits at a yield,
    so a `finally` in the generator, or a background task, would wait for the garbage collector or
    not run at all. The `finally` here runs when the response itself returns or is cancelled.
    """

    def __init__(self, handle: BinaryIO, size: int) -> None:
        super().__init__(
            service.read_chunks(handle),
            media_type="video/mp4",
            headers={"Content-Length": str(size), "Cache-Control": "private, no-store"},
        )
        self._handle = handle

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            self._handle.close()


def _not_found() -> NotFoundError:
    # One body for a missing entry and for one the user may not see (SEC-004).
    return NotFoundError("library answer")


def _suggestions(rows) -> LibrarySuggestionList:
    return LibrarySuggestionList(
        items=[
            LibrarySuggestion(
                id=row["id"],
                question=row["question"],
                answer_text=row["answer_text"],
                duration_ms=row["duration_ms"],
            )
            for row in rows
        ]
    )


def _admin_entry(row) -> AdminLibraryEntry:
    return AdminLibraryEntry.model_validate({**dict(row), "duration_ms": row["video_duration_ms"]})


@router.get("/library/suggestions", response_model=LibrarySuggestionList)
async def list_suggestions(
    request: Request,
    language: LibraryLanguage = Query(),
    limit: int = Query(default=6, ge=1, le=20),
) -> LibrarySuggestionList:
    return _suggestions(await service.servable_suggestions(request.app.state.database, language, limit))


@router.get("/library/answers/{entry_id}/video")
async def play_answer(
    entry_id: UUID, request: Request, user: UserRow = Depends(get_current_user)
) -> StreamingResponse:
    settings = request.app.state.settings
    # Counted before the lookup, so an unknown id costs the same as a real one.
    wait = await request.app.state.coordinator.rate_limit(
        f"library:user:{user['id']}", settings.library_playback_rate_limit_per_hour, HOUR_SECONDS
    )
    if wait:
        raise RateLimitedError(
            "library_rate_limited",
            "too many recorded answers in the last hour",
            wait,
            retry_after_header=True,
        )
    database = request.app.state.database
    entry = await service.servable_entry(database, entry_id)
    if entry is None:
        raise _not_found()
    opened = await service.open_video(entry)
    if opened is None:
        raise _not_found()
    handle, size = opened
    # The file is open, so the 200 is certain: only now is the play counted (REQ-015).
    try:
        await service.record_play(database, entry)
    except BaseException:
        handle.close()
        raise
    # Always the whole file with 200, never a Range answer: every client downloads the MP4 as a
    # blob (ADR 0014, item 6), so a 206, 416 or 400 would count a play nobody received. No filename
    # either: the file's name is the recording's external id, which users never see.
    return _WholeVideoResponse(handle, size)


@router.get("/library/answers/{entry_id}/follow-ups", response_model=LibrarySuggestionList)
async def list_follow_ups(entry_id: UUID, request: Request) -> LibrarySuggestionList:
    database = request.app.state.database
    entry = await service.servable_entry(database, entry_id)
    if entry is None:
        raise _not_found()
    return _suggestions(await service.servable_follow_ups(database, entry))


@admin_router.get("/admin/library/entries", response_model=AdminLibraryEntryPage)
async def list_entries(
    request: Request,
    status: LibraryStatus | None = Query(default=None),
    language: LibraryLanguage | None = Query(default=None),
    category: str | None = Query(default=None, max_length=100),
    section_type: SectionType | None = Query(default=None, alias="sectionType"),
    technical: Technical | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100, alias="pageSize"),
) -> AdminLibraryEntryPage:
    rows, total = await request.app.state.database.list_library_entries(
        status=status,
        language=language,
        category=category,
        section_type=section_type,
        technical=technical,
        search=q,
        page=page,
        page_size=page_size,
    )
    return AdminLibraryEntryPage(
        items=[_admin_entry(row) for row in rows], total=total, page=page, page_size=page_size
    )


@admin_router.post("/admin/library/entries", response_model=AdminLibraryEntry, status_code=201)
async def create_entry(
    payload: LibraryEntryCreateBody, request: Request, admin: UserRow = Depends(require_admin)
) -> AdminLibraryEntry:
    return _admin_entry(await service.create_entry(request.app.state.database, payload, admin_id=admin["id"]))


@admin_router.patch("/admin/library/entries/{entry_id}", response_model=AdminLibraryEntry)
async def edit_entry(
    entry_id: UUID, payload: LibraryEntryPatchBody, request: Request, admin: UserRow = Depends(require_admin)
) -> AdminLibraryEntry:
    return _admin_entry(
        await service.edit_entry(request.app.state.database, entry_id, payload, admin_id=admin["id"])
    )


@admin_router.patch("/admin/library/entries/{entry_id}/status", response_model=AdminLibraryEntry)
async def change_status(
    entry_id: UUID, payload: LibraryStatusBody, request: Request, admin: UserRow = Depends(require_admin)
) -> AdminLibraryEntry:
    entry = await service.change_entry_status(
        request.app.state.database,
        entry_id,
        payload.status,
        reviewer_id=admin["id"],
        video_asset_id=payload.video_asset_id,
        from_status=payload.from_status,
    )
    return _admin_entry(entry)


@admin_router.get("/admin/library/recordings", response_model=LibraryRecordingPage)
async def list_recordings(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100, alias="pageSize"),
) -> LibraryRecordingPage:
    rows, total = await service.unused_recordings(request.app.state.database, page=page, page_size=page_size)
    return LibraryRecordingPage(
        items=[
            LibraryRecording(
                video_asset_id=row["id"],
                answer_text=row["text"],
                duration_ms=row["duration_ms"],
                created_at=row["created_at"],
            )
            for row in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )
