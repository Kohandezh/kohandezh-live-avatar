from fastapi import APIRouter, Depends, Query, Request

from ..schemas import DashboardSummary, UserPage
from .dependencies import require_admin
from .users import public_user

router = APIRouter(tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("/admin/users", response_model=UserPage)
async def list_users(
    request: Request,
    q: str | None = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100, alias="pageSize"),
) -> UserPage:
    rows, total = await request.app.state.database.list_users(search=q, page=page, page_size=page_size)
    return UserPage(
        items=[public_user(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/admin/dashboard", response_model=DashboardSummary)
async def dashboard(request: Request) -> DashboardSummary:
    counts = await request.app.state.database.user_counts()
    return DashboardSummary(**counts)
