"""The recording (authoring) routes start paid provider work and publish media, so only an admin
may call them. The checks run before the body and the path are validated, so a refused request
never reaches a provider. A body that is not valid JSON is the exception: FastAPI parses it first
and answers 422."""

from typing import Any, NamedTuple
from uuid import UUID

import pytest
from fastapi.routing import APIRoute

from services.orchestrator.src.main import app

from .conftest import ADMIN_PHONE

PHONE = "09123456789"
SESSION_ID = "11111111-1111-4111-8111-111111111111"
ASSET_ID = "22222222-2222-4222-8222-222222222222"


class Route(NamedTuple):
    method: str
    template: str
    url: str
    body: dict[str, Any] | None
    # What the route itself answers an admin with the fakes in conftest.py.
    admin_status: int


ROUTES = [
    Route("POST", "/tts/generate", "/tts/generate", {"text": "سلام"}, 200),
    Route("POST", "/avatar/session", "/avatar/session", {}, 200),
    Route("POST", "/avatar/speak", "/avatar/speak", {"session_id": SESSION_ID, "text": "سلام"}, 404),
    Route("POST", "/avatar/interrupt", "/avatar/interrupt", {"session_id": SESSION_ID}, 404),
    Route("POST", "/avatar/listening/{state}", "/avatar/listening/start", {"session_id": SESSION_ID}, 404),
    Route("POST", "/avatar/close", "/avatar/close", {"session_id": SESSION_ID}, 404),
    # The default transport is managed, and a managed session cannot be recorded.
    Route(
        "POST",
        "/assets/generate-video",
        "/assets/generate-video",
        {"session_id": SESSION_ID, "asset_id": "clip-1", "text": "سلام"},
        409,
    ),
    Route("POST", "/assets/video/{asset_id}/finalize", f"/assets/video/{ASSET_ID}/finalize", None, 404),
    Route("GET", "/assets/audio/{asset_id}", f"/assets/audio/{ASSET_ID}", None, 404),
    Route("GET", "/assets/video/{asset_id}", f"/assets/video/{ASSET_ID}", None, 404),
    Route(
        "PATCH",
        "/assets/{kind}/{asset_id}/status",
        f"/assets/video/{ASSET_ID}/status",
        {"status": "VIDEO_APPROVED"},
        404,
    ),
    Route("GET", "/usage", "/usage", None, 200),
]

# One request per route that the route would refuse as invalid, if it ever read it.
INVALID_REQUESTS = [
    ("POST", "/tts/generate", {}),
    ("POST", "/avatar/session", {"max_session_duration": 1}),
    ("POST", "/avatar/speak", {"session_id": "not-a-uuid", "text": "سلام"}),
    ("POST", "/avatar/interrupt", {}),
    ("POST", "/avatar/listening/sideways", {"session_id": SESSION_ID}),
    ("POST", "/avatar/close", {"session_id": "not-a-uuid"}),
    ("POST", "/assets/generate-video", {"session_id": SESSION_ID, "asset_id": "no spaces", "text": "x"}),
    ("POST", "/assets/video/not-a-uuid/finalize", None),
    ("GET", "/assets/audio/not-a-uuid", None),
    ("GET", "/assets/video/not-a-uuid", None),
    ("PATCH", f"/assets/image/{ASSET_ID}/status", {"status": "VIDEO_APPROVED"}),
]

AUTHORING_PREFIXES = ("/tts/", "/avatar/", "/assets/", "/usage")


def _ids(routes):
    return [f"{route[0]} {route[1]}" for route in routes]


async def _send(api, method: str, url: str, body: dict[str, Any] | None):
    return await api.client.request(method, url, json=body)


async def _disable(api, phone: str) -> None:
    user = await api.database.get_user_by_phone(phone)
    await api.database.set_user_status(user["id"], "disabled")


def test_the_table_covers_every_authoring_route():
    """A new recording route must be added to ROUTES, so the checks below cover it too."""
    served = {
        (method, route.path)
        for route in app.routes
        if isinstance(route, APIRoute) and route.path.startswith(AUTHORING_PREFIXES)
        for method in route.methods
    }

    assert served == {(route.method, route.template) for route in ROUTES}


@pytest.mark.asyncio
@pytest.mark.parametrize("route", ROUTES, ids=_ids(ROUTES))
async def test_an_authoring_route_needs_a_session(api, route):
    response = await _send(api, route.method, route.url, route.body)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"
    assert api.provider_calls() == []


@pytest.mark.asyncio
@pytest.mark.parametrize("route", ROUTES, ids=_ids(ROUTES))
async def test_an_authoring_route_is_closed_to_a_normal_user(api, route):
    await api.login(PHONE)

    response = await _send(api, route.method, route.url, route.body)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"
    assert api.provider_calls() == []


@pytest.mark.asyncio
@pytest.mark.parametrize("route", ROUTES, ids=_ids(ROUTES))
async def test_an_authoring_route_is_closed_to_a_disabled_admin(api, route):
    await api.login(ADMIN_PHONE)
    await _disable(api, ADMIN_PHONE)

    response = await _send(api, route.method, route.url, route.body)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "account_disabled"
    assert api.provider_calls() == []


@pytest.mark.asyncio
@pytest.mark.parametrize("route", ROUTES, ids=_ids(ROUTES))
async def test_an_active_admin_reaches_the_route_itself(api, route):
    await api.login(ADMIN_PHONE)

    response = await _send(api, route.method, route.url, route.body)

    assert response.status_code == route.admin_status, response.text


@pytest.mark.asyncio
async def test_an_admin_bearer_token_works_like_the_cookie(api):
    token = await api.login(ADMIN_PHONE, platform="native")
    api.client.cookies.clear()

    response = await api.client.get("/usage", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json() == {"items": []}


@pytest.mark.asyncio
@pytest.mark.parametrize(("method", "url", "body"), INVALID_REQUESTS, ids=_ids(INVALID_REQUESTS))
async def test_an_invalid_request_without_a_session_is_refused_before_validation(api, method, url, body):
    response = await _send(api, method, url, body)

    assert response.status_code == 401
    assert api.provider_calls() == []


@pytest.mark.asyncio
@pytest.mark.parametrize(("method", "url", "body"), INVALID_REQUESTS, ids=_ids(INVALID_REQUESTS))
async def test_an_invalid_request_from_an_admin_is_still_a_validation_error(api, method, url, body):
    await api.login(ADMIN_PHONE)

    response = await _send(api, method, url, body)

    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "validation_error"
    assert api.provider_calls() == []


@pytest.mark.asyncio
async def test_the_admin_generation_reaches_the_provider(api):
    """The allow-control for the provider checks above: the same fake does see an admin's call."""
    await api.login(ADMIN_PHONE)

    response = await api.client.post("/tts/generate", json={"text": "سلام"})

    assert response.status_code == 200
    assert UUID(response.json()["id"])
    assert len(api.tts.calls) == 1
