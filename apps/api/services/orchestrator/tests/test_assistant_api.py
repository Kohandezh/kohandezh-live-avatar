import json
import logging

import pytest
from pydantic import SecretStr

from services.orchestrator.src.assistant.service import AssistantSessionService
from services.orchestrator.src.errors import ConfigurationError, ProviderError
from services.orchestrator.src.main import app

from .conftest import EMBED_KEY, EMBED_ORIGIN, build_settings

PHONE = "09123456789"
EMBED_HEADERS = {"X-Embed-Key": EMBED_KEY, "Origin": EMBED_ORIGIN}


@pytest.mark.asyncio
async def test_a_user_gets_a_sandbox_session(api):
    await api.login(PHONE)

    response = await api.client.post("/assistant/session", json={})

    assert response.status_code == 200
    body = response.json()
    assert body["sandbox"] is True
    # Sandbox forces the public avatar and one minute, whatever the configuration says.
    assert body["avatarId"] == "sandbox-avatar"
    assert body["maxSessionDurationSeconds"] == 60
    assert body["language"] == "fa"
    assert body["sessionToken"] == "provider-token-1"
    assert body["providerSessionId"] == "provider-1"

    call = api.liveavatar.token_calls[0]
    assert call["avatar_id"] == "sandbox-avatar"
    assert call["sandbox"] is True
    assert call["max_session_duration"] == 60
    assert call["context_id"] == "context-id"
    assert call["language"] == "fa"

    row = api.database.sessions[list(api.database.sessions)[0]]
    assert row["mode"] == "FULL"
    assert row["status"] == "TOKEN_ISSUED"
    assert row["user_id"] == api.database.users[0]["id"]
    # The raw token never reaches the database.
    assert row["session_token_hash"] != "provider-token-1"  # noqa: S105 - inert fixture value
    assert json.loads(row["metadata"])["principal"] == f"user:{api.database.users[0]['id']}"
    assert api.database.operations() == ["assistant_token"]


@pytest.mark.asyncio
async def test_the_caller_can_ask_for_english(api):
    await api.login(PHONE)

    response = await api.client.post("/assistant/session", json={"language": "en"})

    assert response.json()["language"] == "en"
    assert api.liveavatar.token_calls[0]["language"] == "en"


@pytest.mark.asyncio
async def test_an_unknown_language_is_refused(api):
    await api.login(PHONE)

    response = await api.client.post("/assistant/session", json={"language": "de"})

    assert response.status_code == 422
    assert api.liveavatar.token_calls == []


@pytest.mark.asyncio
async def test_the_production_avatar_is_used_when_sandbox_is_off(api):
    api.settings.liveavatar_sandbox = False
    await api.login(PHONE)

    response = await api.client.post("/assistant/session", json={})

    body = response.json()
    assert body["sandbox"] is False
    assert body["avatarId"] == "custom-avatar"
    assert body["maxSessionDurationSeconds"] == 300


@pytest.mark.asyncio
async def test_the_widget_needs_the_key_and_an_allowed_origin(api):
    allowed = await api.client.post("/assistant/session", json={}, headers=EMBED_HEADERS)
    assert allowed.status_code == 200

    other_site = await api.client.post(
        "/assistant/session",
        json={},
        headers={"X-Embed-Key": EMBED_KEY, "Origin": "https://copycat.example"},
    )
    assert other_site.status_code == 403
    assert other_site.json()["error"]["code"] == "embed_origin_not_allowed"

    no_origin = await api.client.post("/assistant/session", json={}, headers={"X-Embed-Key": EMBED_KEY})
    assert no_origin.status_code == 403


@pytest.mark.asyncio
async def test_a_request_without_a_user_or_a_key_is_unauthorized(api):
    anonymous = await api.client.post("/assistant/session", json={})
    wrong_key = await api.client.post(
        "/assistant/session", json={}, headers={"X-Embed-Key": "guess", "Origin": EMBED_ORIGIN}
    )

    assert anonymous.status_code == 401
    assert wrong_key.status_code == 401
    assert api.liveavatar.token_calls == []


@pytest.mark.asyncio
async def test_the_wildcard_origin_only_works_in_development(api):
    api.settings.assistant_embed_allowed_origins = "*"

    development = await api.client.post(
        "/assistant/session",
        json={},
        headers={"X-Embed-Key": EMBED_KEY, "Origin": "https://anywhere.example"},
    )
    assert development.status_code == 200

    api.settings.app_env = "production"
    production = await api.client.post(
        "/assistant/session",
        json={},
        headers={"X-Embed-Key": EMBED_KEY, "Origin": "https://anywhere.example"},
    )
    assert production.status_code == 403


@pytest.mark.asyncio
async def test_sessions_are_limited_per_hour(api):
    await api.login(PHONE)

    for _ in range(api.settings.assistant_rate_limit_per_hour):
        assert (await api.client.post("/assistant/session", json={})).status_code == 200

    response = await api.client.post("/assistant/session", json={})

    assert response.status_code == 429
    error = response.json()["error"]
    assert error["code"] == "assistant_rate_limited"
    assert error["details"]["retryAfterSeconds"] > 0


@pytest.mark.asyncio
async def test_the_widget_limit_is_counted_per_visitor(api):
    for _ in range(api.settings.assistant_rate_limit_per_hour):
        assert (
            await api.client.post("/assistant/session", json={}, headers=EMBED_HEADERS)
        ).status_code == 200

    response = await api.client.post("/assistant/session", json={}, headers=EMBED_HEADERS)

    assert response.status_code == 429


@pytest.mark.asyncio
async def test_closing_stops_the_provider_session_and_repeats_safely(api):
    await api.login(PHONE)
    session_id = (await api.client.post("/assistant/session", json={})).json()["id"]

    first = await api.client.post(f"/assistant/session/{session_id}/close")
    second = await api.client.post(f"/assistant/session/{session_id}/close")

    assert first.status_code == 200
    assert first.json() == {"status": "closed"}
    assert second.status_code == 200
    # The provider is told once. The second close only sees an already closed row.
    assert api.liveavatar.stop_calls == [("provider-token-1", "provider-1")]
    assert api.database.sessions[list(api.database.sessions)[0]]["status"] == "CLOSED"
    assert api.database.operations() == ["assistant_token", "assistant_close"]


@pytest.mark.asyncio
async def test_a_session_can_only_be_closed_by_its_owner(api):
    await api.login(PHONE)
    session_id = (await api.client.post("/assistant/session", json={})).json()["id"]
    # Drop the session cookie, so the next call arrives as the widget and not as the owner.
    api.client.cookies.clear()

    response = await api.client.post(f"/assistant/session/{session_id}/close", headers=EMBED_HEADERS)

    assert response.status_code == 404
    assert api.liveavatar.stop_calls == []


@pytest.mark.asyncio
async def test_closing_an_unknown_session_is_a_not_found(api):
    await api.login(PHONE)

    response = await api.client.post("/assistant/session/2f7f4a1e-0d2f-4c3a-9a0a-5c9bdb4d1f00/close")

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_a_session_that_already_ended_at_the_provider_still_closes(api):
    await api.login(PHONE)
    session_id = (await api.client.post("/assistant/session", json={})).json()["id"]
    api.liveavatar.stop_error = ProviderError("liveavatar_error", "session already stopped", 502, False)

    response = await api.client.post(f"/assistant/session/{session_id}/close")

    assert response.status_code == 200
    assert api.database.sessions[list(api.database.sessions)[0]]["status"] == "CLOSED"


@pytest.mark.asyncio
async def test_missing_provider_configuration_answers_503(api):
    api.settings.liveavatar_context_id = ""
    await api.login(PHONE)

    response = await api.client.post("/assistant/session", json={})

    assert response.status_code == 503
    body = response.json()
    assert body["error"]["code"] == "configuration_error"
    assert body["error"]["details"]["missing"] == ["LIVEAVATAR_CONTEXT_ID"]
    assert api.liveavatar.token_calls == []


@pytest.mark.asyncio
async def test_a_provider_failure_reaches_the_client_unchanged(api):
    api.liveavatar.token_error = ProviderError(
        "liveavatar_quota", "LiveAvatar credits or concurrency are exhausted", 429, False
    )
    await api.login(PHONE)

    response = await api.client.post("/assistant/session", json={})

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "liveavatar_quota"
    assert api.database.sessions == {}


@pytest.mark.asyncio
async def test_a_failed_insert_does_not_leak_a_live_provider_session(api):
    async def explode(_data):
        raise RuntimeError("database down")

    api.database.create_assistant_session = explode
    await api.login(PHONE)

    with pytest.raises(RuntimeError, match="database down"):
        await api.client.post("/assistant/session", json={})

    assert api.liveavatar.stop_calls == [("provider-token-1", "provider-1")]


@pytest.mark.asyncio
async def test_a_restarted_process_can_still_close_the_row(api):
    """The raw token lives in memory only. After a restart the row closes without the provider."""
    await api.login(PHONE)
    session_id = (await api.client.post("/assistant/session", json={})).json()["id"]
    # A new service has an empty token map, exactly like the process after a restart.
    app.state.assistant = AssistantSessionService(
        client=api.liveavatar, database=api.database, settings=api.settings
    )

    response = await api.client.post(f"/assistant/session/{session_id}/close")

    assert response.status_code == 200
    assert api.liveavatar.stop_calls == []
    assert api.database.sessions[list(api.database.sessions)[0]]["status"] == "CLOSED"


@pytest.mark.asyncio
async def test_the_session_token_is_never_logged(api, caplog):
    await api.login(PHONE)

    with caplog.at_level(logging.DEBUG):
        session_id = (await api.client.post("/assistant/session", json={})).json()["id"]
        await api.client.post(f"/assistant/session/{session_id}/close")

    assert "provider-token-1" not in caplog.text


@pytest.mark.asyncio
async def test_both_missing_settings_are_named(api):
    settings = build_settings(liveavatar_api_key=SecretStr(""), liveavatar_context_id="")
    service = AssistantSessionService(client=api.liveavatar, database=api.database, settings=settings)

    with pytest.raises(ConfigurationError) as error:
        await service.create(principal="user:1", user_id=None, language="fa")

    assert error.value.details["missing"] == ["LIVEAVATAR_API_KEY", "LIVEAVATAR_CONTEXT_ID"]
