"""POST /avatar/session refuses a session longer than LiveAvatar production allows (300 seconds).
The refusal is the API's own 422, so a paid provider call never starts."""

import pytest

from .conftest import ADMIN_PHONE


async def _create_session(api, body: dict):
    await api.login(ADMIN_PHONE)
    return await api.client.post("/avatar/session", json=body)


def _create_calls(api) -> list[dict]:
    return [payload for name, payload in api.avatar.calls if name == "create"]


@pytest.mark.asyncio
@pytest.mark.parametrize("seconds", [301, 3600, 14])
async def test_a_session_length_outside_the_limits_is_refused(api, seconds):
    response = await _create_session(api, {"max_session_duration": seconds})

    assert response.status_code == 422, response.text
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["details"][0]["loc"][-1] == "max_session_duration"
    assert api.provider_calls() == []


@pytest.mark.asyncio
@pytest.mark.parametrize("seconds", [300, 15])
async def test_a_session_length_on_the_limits_is_passed_to_the_provider(api, seconds):
    response = await _create_session(api, {"max_session_duration": seconds})

    assert response.status_code == 200, response.text
    assert [call["max_session_duration"] for call in _create_calls(api)] == [seconds]


@pytest.mark.asyncio
async def test_an_omitted_session_length_uses_the_configured_default(api):
    response = await _create_session(api, {})

    assert response.status_code == 200, response.text
    assert [call["max_session_duration"] for call in _create_calls(api)] == [
        api.settings.liveavatar_max_session_seconds
    ]
