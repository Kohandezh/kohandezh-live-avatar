import logging

import pytest
from fastapi import Response

from services.orchestrator.src.auth.otp import ConsoleOtpSender, OtpService
from services.orchestrator.src.auth.sessions import COOKIE_NAME, set_session_cookie
from services.orchestrator.src.coordination import Coordinator

from .conftest import ADMIN_PHONE, FakeRedis, build_settings

PHONE = "09123456789"
E164 = "+989123456789"


async def _forget_resend_guard(api, phone: str) -> None:
    """Drop the one-per-minute marker so a test can reach the hourly limits."""
    await api.redis.delete(f"once:otp:resend:{phone}")


@pytest.mark.asyncio
async def test_a_code_request_normalizes_the_phone_and_answers_with_the_limits(api):
    response = await api.client.post("/auth/otp/request", json={"phone": PHONE})

    assert response.status_code == 202
    body = response.json()
    assert body["phone"] == E164
    assert body["expiresInSeconds"] == 120
    assert body["resendAfterSeconds"] == 60
    # Development returns the code so the flow can be finished without an SMS provider.
    assert body["devCode"] == api.sender.codes[-1]


@pytest.mark.asyncio
async def test_the_answer_carries_no_code_outside_development(api):
    api.settings.app_env = "production"

    body = (await api.client.post("/auth/otp/request", json={"phone": PHONE})).json()

    assert "devCode" not in body
    assert api.sender.codes  # the code was still created and handed to the sender


@pytest.mark.asyncio
async def test_an_invalid_phone_is_refused_before_a_code_is_created(api):
    response = await api.client.post("/auth/otp/request", json={"phone": "123"})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert api.sender.codes == []


@pytest.mark.asyncio
async def test_a_second_code_within_a_minute_is_refused(api):
    await api.client.post("/auth/otp/request", json={"phone": PHONE})
    response = await api.client.post("/auth/otp/request", json={"phone": PHONE})

    assert response.status_code == 429
    error = response.json()["error"]
    assert error["code"] == "otp_rate_limited"
    assert 0 < error["details"]["retryAfterSeconds"] <= 60
    assert len(api.sender.codes) == 1


@pytest.mark.asyncio
async def test_one_phone_gets_five_codes_per_hour(api):
    for _ in range(5):
        await _forget_resend_guard(api, E164)
        assert (await api.client.post("/auth/otp/request", json={"phone": PHONE})).status_code == 202

    await _forget_resend_guard(api, E164)
    response = await api.client.post("/auth/otp/request", json={"phone": PHONE})

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "otp_rate_limited"
    assert len(api.sender.codes) == 5


@pytest.mark.asyncio
async def test_one_address_gets_twenty_codes_per_hour(api):
    for index in range(20):
        phone = f"+9891300{index:05d}"
        assert (await api.client.post("/auth/otp/request", json={"phone": phone})).status_code == 202

    response = await api.client.post("/auth/otp/request", json={"phone": "+9891300099999"})

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "otp_rate_limited"


@pytest.mark.asyncio
async def test_a_wrong_code_does_not_create_a_session(api):
    await api.client.post("/auth/otp/request", json={"phone": PHONE})

    response = await api.client.post("/auth/otp/verify", json={"phone": PHONE, "code": "000000"})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_code"
    assert api.database.users == []
    assert COOKIE_NAME not in api.client.cookies


@pytest.mark.asyncio
async def test_five_wrong_codes_burn_the_code_and_lock_the_number(api):
    await api.client.post("/auth/otp/request", json={"phone": PHONE})
    correct = api.sender.codes[-1]

    for _ in range(4):
        wrong = await api.client.post("/auth/otp/verify", json={"phone": PHONE, "code": "000000"})
        assert wrong.status_code == 401

    locked = await api.client.post("/auth/otp/verify", json={"phone": PHONE, "code": "000000"})
    assert locked.status_code == 429
    assert locked.json()["error"]["code"] == "otp_locked"
    assert locked.json()["error"]["details"]["retryAfterSeconds"] > 0

    # Even the correct code is worthless now: the record was deleted.
    after_lock = await api.client.post("/auth/otp/verify", json={"phone": PHONE, "code": correct})
    assert after_lock.status_code == 429
    assert after_lock.json()["error"]["code"] == "otp_locked"


@pytest.mark.asyncio
async def test_verifying_without_a_pending_code_reports_expired(api):
    response = await api.client.post("/auth/otp/verify", json={"phone": PHONE, "code": "123456"})

    assert response.status_code == 410
    assert response.json()["error"]["code"] == "otp_expired"


@pytest.mark.asyncio
async def test_a_code_works_once(api):
    await api.client.post("/auth/otp/request", json={"phone": PHONE})
    code = api.sender.codes[-1]

    assert (await api.client.post("/auth/otp/verify", json={"phone": PHONE, "code": code})).status_code == 200
    replay = await api.client.post("/auth/otp/verify", json={"phone": PHONE, "code": code})

    assert replay.status_code == 410


@pytest.mark.asyncio
async def test_web_login_puts_the_session_in_a_cookie_and_not_in_the_body(api):
    await api.client.post("/auth/otp/request", json={"phone": PHONE})

    response = await api.client.post(
        "/auth/otp/verify",
        json={"phone": PHONE, "code": api.sender.codes[-1]},
        headers={"X-Client-Platform": "web"},
    )

    assert response.status_code == 200
    body = response.json()
    # The web answer carries no token at all. The cookie is the whole session.
    assert "accessToken" not in body
    assert body["user"]["phone"] == E164
    assert body["user"]["role"] == "user"
    assert body["user"]["status"] == "active"
    assert set(body["user"]) == {
        "id",
        "phone",
        "firstName",
        "lastName",
        "email",
        "role",
        "status",
        "createdAt",
    }
    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{COOKIE_NAME}=")
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    # Development runs on http, so the cookie cannot require https.
    assert "Secure" not in cookie

    me = await api.client.get("/me")
    assert me.status_code == 200
    assert me.json()["phone"] == E164


@pytest.mark.asyncio
async def test_native_login_returns_a_bearer_token_and_no_cookie(api):
    await api.client.post("/auth/otp/request", json={"phone": PHONE})

    response = await api.client.post(
        "/auth/otp/verify",
        json={"phone": PHONE, "code": api.sender.codes[-1]},
        headers={"X-Client-Platform": "native"},
    )

    assert response.status_code == 200
    token = response.json()["accessToken"]
    assert token
    assert "set-cookie" not in response.headers

    me = await api.client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200


def test_the_cookie_requires_https_outside_development():
    settings = build_settings(app_env="production")
    response = Response()

    set_session_cookie(response, "token", settings)  # noqa: S106 - inert test value

    assert "Secure" in response.headers["set-cookie"]
    assert "HttpOnly" in response.headers["set-cookie"]


@pytest.mark.asyncio
async def test_a_listed_phone_becomes_an_admin(api):
    await api.login(ADMIN_PHONE)

    me = await api.client.get("/me")
    assert me.json()["role"] == "admin"


@pytest.mark.asyncio
async def test_me_needs_a_session(api):
    response = await api.client.get("/me")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


@pytest.mark.asyncio
async def test_a_made_up_token_is_not_a_session(api):
    response = await api.client.get("/me", headers={"Authorization": "Bearer not-a-real-token"})

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_logout_revokes_the_session(api):
    await api.login(PHONE)

    logout = await api.client.post("/auth/logout")

    assert logout.status_code == 204
    assert (await api.client.get("/me")).status_code == 401


@pytest.mark.asyncio
async def test_logout_of_a_native_session_revokes_the_bearer_token(api):
    token = await api.login(PHONE, platform="native")
    headers = {"Authorization": f"Bearer {token}"}

    assert (await api.client.post("/auth/logout", headers=headers)).status_code == 204
    assert (await api.client.get("/me", headers=headers)).status_code == 401


@pytest.mark.asyncio
async def test_a_disabled_account_loses_access(api):
    await api.login(PHONE)
    await api.database.set_user_status(api.database.users[0]["id"], "disabled")

    me = await api.client.get("/me")
    assert me.status_code == 403
    assert me.json()["error"]["code"] == "account_disabled"

    await _forget_resend_guard(api, E164)
    await api.client.post("/auth/otp/request", json={"phone": PHONE})
    login = await api.client.post("/auth/otp/verify", json={"phone": PHONE, "code": api.sender.codes[-1]})
    assert login.status_code == 403
    assert login.json()["error"]["code"] == "account_disabled"


@pytest.mark.asyncio
async def test_admin_endpoints_are_closed_to_a_normal_user(api):
    await api.login(PHONE)

    users = await api.client.get("/admin/users")
    dashboard = await api.client.get("/admin/dashboard")

    assert users.status_code == 403
    assert users.json()["error"]["code"] == "forbidden"
    assert dashboard.status_code == 403


@pytest.mark.asyncio
async def test_admin_endpoints_are_closed_to_anonymous_visitors(api):
    assert (await api.client.get("/admin/users")).status_code == 401
    assert (await api.client.get("/admin/dashboard")).status_code == 401


@pytest.mark.asyncio
async def test_the_admin_user_list_pages_and_searches(api):
    for index in range(3):
        await api.database.create_user(f"+9891400{index:05d}", "user")
    await api.login(ADMIN_PHONE)

    page = await api.client.get("/admin/users", params={"page": 1, "pageSize": 2})
    assert page.status_code == 200
    body = page.json()
    assert body["total"] == 4
    assert body["page"] == 1
    assert body["pageSize"] == 2
    assert len(body["items"]) == 2

    found = await api.client.get("/admin/users", params={"q": "9891400000"})
    assert found.json()["total"] == 3

    empty = await api.client.get("/admin/users", params={"q": "nobody"})
    assert empty.json() == {"items": [], "total": 0, "page": 1, "pageSize": 10}


@pytest.mark.asyncio
async def test_an_impossible_page_size_is_refused(api):
    await api.login(ADMIN_PHONE)

    response = await api.client.get("/admin/users", params={"pageSize": 5000})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_the_dashboard_counts_users(api):
    await api.database.create_user("+989140000001", "user")
    await api.database.set_user_status(api.database.users[0]["id"], "disabled")
    await api.login(ADMIN_PHONE)

    response = await api.client.get("/admin/dashboard")

    assert response.status_code == 200
    assert response.json() == {
        "totalUsers": 2,
        "activeUsers": 1,
        "disabledUsers": 1,
        "newUsersThisWeek": 2,
    }


@pytest.mark.asyncio
async def test_the_code_is_never_returned_or_logged_outside_development(caplog):
    settings = build_settings(app_env="production")
    service = OtpService(
        coordinator=Coordinator("redis://unused", redis=FakeRedis()),
        sender=ConsoleOtpSender(log_codes=settings.is_development),
        settings=settings,
    )

    with caplog.at_level(logging.DEBUG):
        challenge = await service.request(E164, "127.0.0.1")

    assert challenge.dev_code is None
    assert "otp_delivery_not_configured" in caplog.text
    assert E164 not in caplog.text
