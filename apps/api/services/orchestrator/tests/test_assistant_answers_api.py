"""POST /assistant/session/{id}/answers: one provider_usage row per avatar answer."""

import asyncio
import inspect
import logging
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import pytest

from .conftest import EMBED_KEY, EMBED_ORIGIN

PHONE = "09123456789"
OTHER_PHONE = "09120000002"
EMBED_HEADERS = {"X-Embed-Key": EMBED_KEY, "Origin": EMBED_ORIGIN}
UNKNOWN_SESSION = "2f7f4a1e-0d2f-4c3a-9a0a-5c9bdb4d1f00"
# The harness runs in sandbox, so every session is 60 seconds long while the setting says 300.
SESSION_LIMIT_MS = 60_000
TOKEN_GRACE_SECONDS = 300


def answers_url(session_id: str) -> str:
    return f"/assistant/session/{session_id}/answers"


def body(*items: tuple[int, int]) -> dict[str, Any]:
    return {"answers": [{"index": index, "durationMs": duration} for index, duration in items]}


def answer_rows(api) -> list[dict[str, Any]]:
    return [row for row in api.database.usage if row["operation"] == "assistant_answer"]


async def open_session(api, headers: dict[str, str] | None = None) -> str:
    response = await api.client.post("/assistant/session", json={}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["id"]


def session_row(api, session_id: str) -> dict[str, Any]:
    return api.database.sessions[UUID(session_id)]


def yield_on_every_database_call(database) -> None:
    """A real database hands control back to the event loop on every call. The fake never does,
    so two concurrent requests cannot interleave unless the test adds those yield points."""

    def yielding(method):
        async def call(*args, **kwargs):
            await asyncio.sleep(0)
            return await method(*args, **kwargs)

        return call

    for name, method in inspect.getmembers(database, inspect.iscoroutinefunction):
        setattr(database, name, yielding(method))


@pytest.mark.asyncio
async def test_the_owner_records_one_row_per_answer(api):
    await api.login(PHONE)
    session_id = await open_session(api)

    response = await api.client.post(answers_url(session_id), json=body((0, 4200), (1, 1800)))

    assert response.status_code == 200, response.text
    assert response.json() == {"recorded": 2, "duplicates": 0}
    assert api.database.operations() == ["assistant_token", "assistant_answer", "assistant_answer"]
    principal = f"user:{api.database.users[0]['id']}"
    rows = answer_rows(api)
    for index, (row, duration) in enumerate(zip(rows, [4200, 1800], strict=True)):
        # Exactly what the real insert reads. No text, no model: nothing of the answer itself.
        assert row == {
            "provider": "liveavatar",
            "operation": "assistant_answer",
            # LiveAvatar's id, like assistant_token and assistant_close, never our own UUID.
            "provider_resource_id": "provider-1",
            "model": None,
            "characters": None,
            "estimated_duration_ms": duration,
            "cache_hit": False,
            "metadata": {
                "principal": principal,
                "sandbox": True,
                "provider_mode": "persona",
                "answer_index": index,
                "source": "browser",
            },
        }


@pytest.mark.asyncio
async def test_the_bounds_themselves_are_accepted(api):
    await api.login(PHONE)
    session_id = await open_session(api)

    shortest = await api.client.post(answers_url(session_id), json=body((0, 1)))
    last_index = await api.client.post(answers_url(session_id), json=body((10000, 1000)))

    assert shortest.status_code == 200, shortest.text
    assert last_index.status_code == 200, last_index.text
    assert [row["estimated_duration_ms"] for row in answer_rows(api)] == [1, 1000]


@pytest.mark.asyncio
async def test_one_answer_may_be_as_long_as_the_session(api):
    await api.login(PHONE)
    session_id = await open_session(api)

    # The per-answer limit is the session length, inclusive.
    response = await api.client.post(answers_url(session_id), json=body((0, SESSION_LIMIT_MS)))

    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_a_batch_of_twenty_is_accepted(api):
    await api.login(PHONE)
    session_id = await open_session(api)

    response = await api.client.post(answers_url(session_id), json=body(*[(i, 1000) for i in range(20)]))

    assert response.status_code == 200, response.text
    assert response.json() == {"recorded": 20, "duplicates": 0}


@pytest.mark.asyncio
async def test_the_widget_reports_for_its_own_session(api):
    session_id = await open_session(api, EMBED_HEADERS)

    allowed = await api.client.post(answers_url(session_id), json=body((0, 1000)), headers=EMBED_HEADERS)
    anonymous = await api.client.post(answers_url(session_id), json=body((1, 1000)))
    other_site = await api.client.post(
        answers_url(session_id),
        json=body((2, 1000)),
        headers={"X-Embed-Key": EMBED_KEY, "Origin": "https://copycat.example"},
    )

    assert allowed.status_code == 200, allowed.text
    assert anonymous.status_code == 401
    assert anonymous.json()["error"]["code"] == "unauthorized"
    assert other_site.status_code == 403
    assert other_site.json()["error"]["code"] == "embed_origin_not_allowed"
    rows = answer_rows(api)
    assert len(rows) == 1
    # The widget row names the website, and no visitor.
    assert rows[0]["metadata"]["principal"] == f"embed:{EMBED_ORIGIN}"


@pytest.mark.asyncio
async def test_a_wrong_embed_key_is_unauthorized(api):
    session_id = await open_session(api, EMBED_HEADERS)

    response = await api.client.post(
        answers_url(session_id),
        json=body((0, 1000)),
        headers={"X-Embed-Key": "guess", "Origin": EMBED_ORIGIN},
    )

    assert response.status_code == 401
    assert answer_rows(api) == []


def assert_not_found(response) -> None:
    assert response.status_code == 404, response.text
    error = response.json()["error"]
    assert error["code"] == "not_found"
    assert error["message"] == "assistant session was not found"


@pytest.mark.asyncio
async def test_the_widget_cannot_report_for_a_user_session(api):
    await api.login(PHONE)
    session_id = await open_session(api)
    # Drop the session cookie, so the next call arrives as the widget and not as the owner.
    api.client.cookies.clear()

    response = await api.client.post(answers_url(session_id), json=body((0, 1000)), headers=EMBED_HEADERS)

    assert_not_found(response)
    assert answer_rows(api) == []


@pytest.mark.asyncio
async def test_another_user_cannot_report_for_the_session(api):
    await api.login(PHONE)
    session_id = await open_session(api)
    await api.login(OTHER_PHONE)

    response = await api.client.post(answers_url(session_id), json=body((0, 1000)))

    assert_not_found(response)
    assert answer_rows(api) == []


@pytest.mark.asyncio
async def test_a_second_allowed_website_cannot_report_for_the_first_one(api):
    api.settings.assistant_embed_allowed_origins = f"{EMBED_ORIGIN},https://second.example"
    session_id = await open_session(api, EMBED_HEADERS)

    response = await api.client.post(
        answers_url(session_id),
        json=body((0, 1000)),
        headers={"X-Embed-Key": EMBED_KEY, "Origin": "https://second.example"},
    )

    assert_not_found(response)
    assert answer_rows(api) == []


@pytest.mark.asyncio
async def test_an_unknown_session_is_a_not_found(api):
    await api.login(PHONE)

    unknown = await api.client.post(answers_url(UNKNOWN_SESSION), json=body((0, 1000)))
    not_a_uuid = await api.client.post(answers_url("not-a-uuid"), json=body((0, 1000)))

    assert_not_found(unknown)
    assert not_a_uuid.status_code == 422
    assert answer_rows(api) == []


def assert_session_closed(response) -> None:
    assert response.status_code == 409, response.text
    error = response.json()["error"]
    assert error["code"] == "assistant_session_closed"
    assert error["message"] == "assistant session is not open"
    assert error["retryable"] is False


@pytest.mark.asyncio
async def test_a_closed_session_takes_no_more_answers(api):
    await api.login(PHONE)
    session_id = await open_session(api)
    await api.client.post(f"/assistant/session/{session_id}/close")

    response = await api.client.post(answers_url(session_id), json=body((0, 1000)))
    # The session gate runs before the per-answer length check.
    too_long = await api.client.post(answers_url(session_id), json=body((0, SESSION_LIMIT_MS + 1)))

    assert_session_closed(response)
    assert_session_closed(too_long)
    assert answer_rows(api) == []


@pytest.mark.asyncio
async def test_a_disabled_account_cannot_report(api):
    await api.login(PHONE)
    session_id = await open_session(api)
    api.database.users[0]["status"] = "disabled"

    response = await api.client.post(answers_url(session_id), json=body((0, 1000)))

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "account_disabled"
    assert answer_rows(api) == []


@pytest.mark.asyncio
async def test_a_session_that_failed_to_start_takes_no_answers(api):
    await api.login(PHONE)
    session_id = await open_session(api)
    session_row(api, session_id)["status"] = "START_FAILED"

    response = await api.client.post(answers_url(session_id), json=body((0, 1000)))

    assert_session_closed(response)
    assert answer_rows(api) == []


@pytest.mark.asyncio
async def test_a_stranger_on_a_closed_session_still_gets_a_not_found(api):
    """A stranger must not learn that the session exists, open or not."""
    await api.login(PHONE)
    session_id = await open_session(api)
    await api.client.post(f"/assistant/session/{session_id}/close")
    await api.login(OTHER_PHONE)

    response = await api.client.post(answers_url(session_id), json=body((0, 1000)))

    assert_not_found(response)


@pytest.mark.asyncio
async def test_a_session_past_its_lifetime_takes_no_answers(api):
    """A tab that dies never calls close, so the row alone cannot tell that the session is over."""
    await api.login(PHONE)
    session_id = await open_session(api)
    # The row's own 60 seconds count, not the 300 of the setting: with the setting this row
    # would still be inside its window.
    session_row(api, session_id)["started_at"] = datetime.now(UTC) - timedelta(
        seconds=60 + TOKEN_GRACE_SECONDS + 1
    )

    response = await api.client.post(answers_url(session_id), json=body((0, 1000)))

    assert_session_closed(response)
    assert answer_rows(api) == []


@pytest.mark.asyncio
async def test_a_session_inside_its_lifetime_takes_answers(api):
    await api.login(PHONE)
    session_id = await open_session(api)
    session_row(api, session_id)["started_at"] = datetime.now(UTC) - timedelta(
        seconds=60 + TOKEN_GRACE_SECONDS - 5
    )

    response = await api.client.post(answers_url(session_id), json=body((0, 1000)))

    assert response.status_code == 200, response.text


def one_answer(**item: Any) -> dict[str, Any]:
    return {"answers": [item]}


INVALID_BODIES = {
    "duration zero": one_answer(index=0, durationMs=0),
    "duration negative": one_answer(index=0, durationMs=-1),
    "duration above an hour": one_answer(index=0, durationMs=3_600_001),
    "duration as a string": one_answer(index=0, durationMs="5"),
    "duration as a fraction": one_answer(index=0, durationMs=1.5),
    "duration as a boolean": one_answer(index=0, durationMs=True),
    "duration missing": one_answer(index=0),
    "index negative": one_answer(index=-1, durationMs=1000),
    "index above the range": one_answer(index=10001, durationMs=1000),
    "index missing": one_answer(durationMs=1000),
    "index null": one_answer(index=None, durationMs=1000),
    "answers empty": {"answers": []},
    "answers missing": {},
    "twenty one answers": body(*[(i, 1000) for i in range(21)]),
    "text in an answer": one_answer(index=0, durationMs=1000, text="hello"),
    "unknown top level key": {**body((0, 1000)), "transcript": "hello"},
}


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", INVALID_BODIES.values(), ids=INVALID_BODIES.keys())
async def test_a_malformed_report_is_refused(api, payload):
    await api.login(PHONE)
    session_id = await open_session(api)

    response = await api.client.post(answers_url(session_id), json=payload)

    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "validation_error"
    assert answer_rows(api) == []


@pytest.mark.asyncio
async def test_an_answer_longer_than_the_session_is_refused(api):
    await api.login(PHONE)
    session_id = await open_session(api)

    response = await api.client.post(answers_url(session_id), json=body((0, 1000), (1, SESSION_LIMIT_MS + 1)))

    assert response.status_code == 422, response.text
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["details"] == {"limitMs": SESSION_LIMIT_MS}
    # The valid item of the same batch is not written either.
    assert answer_rows(api) == []


@pytest.mark.asyncio
async def test_the_same_index_twice_in_one_batch_counts_once(api):
    await api.login(PHONE)
    session_id = await open_session(api)

    response = await api.client.post(answers_url(session_id), json=body((0, 1000), (0, 2000)))

    assert response.status_code == 200, response.text
    assert response.json() == {"recorded": 1, "duplicates": 1}
    # The earlier item wins.
    assert [row["estimated_duration_ms"] for row in answer_rows(api)] == [1000]


@pytest.mark.asyncio
async def test_a_resent_index_is_not_counted_again(api):
    await api.login(PHONE)
    session_id = await open_session(api)
    await api.client.post(answers_url(session_id), json=body((0, 1000)))

    again = await api.client.post(answers_url(session_id), json=body((0, 1000)))
    mixed = await api.client.post(answers_url(session_id), json=body((0, 1000), (1, 1500)))

    assert again.status_code == 200, again.text
    assert again.json() == {"recorded": 0, "duplicates": 1}
    assert mixed.json() == {"recorded": 1, "duplicates": 1}
    assert [row["metadata"]["answer_index"] for row in answer_rows(api)] == [0, 1]


def assert_limit(response) -> None:
    assert response.status_code == 409, response.text
    error = response.json()["error"]
    assert error["code"] == "assistant_answers_limit"
    assert error["retryable"] is False


@pytest.mark.asyncio
async def test_a_session_takes_only_so_many_answers(api):
    api.settings.assistant_answers_per_session_max = 3
    await api.login(PHONE)
    session_id = await open_session(api)
    assert (
        await api.client.post(answers_url(session_id), json=body((0, 1000), (1, 1000)))
    ).status_code == 200

    # Index 2 alone would fit, but the batch is refused as a whole.
    over = await api.client.post(answers_url(session_id), json=body((2, 1000), (3, 1000)))
    assert_limit(over)
    assert len(answer_rows(api)) == 2

    # Index 1 is a duplicate, so only one new item counts against the cap.
    third = await api.client.post(answers_url(session_id), json=body((1, 1000), (2, 1000)))
    assert third.status_code == 200, third.text
    assert third.json() == {"recorded": 1, "duplicates": 1}

    fourth = await api.client.post(answers_url(session_id), json=body((3, 1000)))
    assert_limit(fourth)
    assert len(answer_rows(api)) == 3

    # A re-sent batch at the cap is only duplicates, and still fine.
    resent = await api.client.post(answers_url(session_id), json=body((0, 1000), (1, 1000)))
    assert resent.status_code == 200, resent.text
    assert resent.json() == {"recorded": 0, "duplicates": 2}

    # A batch that writes nothing has nothing to refuse, even under a cap lowered since.
    api.settings.assistant_answers_per_session_max = 1
    lowered = await api.client.post(answers_url(session_id), json=body((0, 1000)))
    assert lowered.status_code == 200, lowered.text
    assert lowered.json() == {"recorded": 0, "duplicates": 1}


@pytest.mark.asyncio
async def test_the_answers_cannot_add_up_to_more_than_the_session(api):
    await api.login(PHONE)
    session_id = await open_session(api)
    assert (await api.client.post(answers_url(session_id), json=body((0, 40_000)))).status_code == 200

    over = await api.client.post(answers_url(session_id), json=body((1, 10_000), (2, 10_001)))
    assert_limit(over)
    assert len(answer_rows(api)) == 1

    # The duplicate of index 0 does not count again, so the sum lands exactly on the limit.
    exact = await api.client.post(answers_url(session_id), json=body((0, 40_000), (1, 20_000)))
    assert exact.status_code == 200, exact.text
    assert exact.json() == {"recorded": 1, "duplicates": 1}

    one_more = await api.client.post(answers_url(session_id), json=body((2, 1)))
    assert_limit(one_more)
    assert sum(row["estimated_duration_ms"] for row in answer_rows(api)) == SESSION_LIMIT_MS


@pytest.mark.asyncio
async def test_reports_are_limited_per_hour_without_spending_a_session(api):
    api.settings.assistant_answers_rate_limit_per_hour = 2
    await api.login(PHONE)
    session_id = await open_session(api)
    user_key = f"user:{api.database.users[0]['id']}"

    for index in range(2):
        response = await api.client.post(answers_url(session_id), json=body((index, 1000)))
        assert response.status_code == 200, response.text
    third = await api.client.post(answers_url(session_id), json=body((2, 1000)))
    # The limit runs before the lookup, so an unknown session is limited the same way.
    unknown = await api.client.post(answers_url(UNKNOWN_SESSION), json=body((0, 1000)))

    for response in (third, unknown):
        assert response.status_code == 429, response.text
        error = response.json()["error"]
        assert error["code"] == "assistant_answers_rate_limited"
        assert error["message"] == "too many answer reports in the last hour"
        assert error["retryable"] is True
        assert error["details"]["retryAfterSeconds"] > 0
    assert len(answer_rows(api)) == 2

    # A malformed body is refused before the limit is counted.
    malformed = await api.client.post(answers_url(session_id), json={"answers": []})
    assert malformed.status_code == 422, malformed.text

    # Two separate counters: the reports never touched the one for session creation.
    assert api.redis.values[f"ratelimit:assistant_answers:{user_key}"] == "4"
    assert api.redis.values[f"ratelimit:assistant:{user_key}"] == "1"
    assert (await api.client.post("/assistant/session", json={})).status_code == 200


@pytest.mark.asyncio
async def test_reports_never_call_the_provider(api):
    await api.login(PHONE)
    session_id = await open_session(api)

    await api.client.post(answers_url(session_id), json=body((0, 1000), (1, 1000)))
    await api.client.post(answers_url(session_id), json=body((1, 1000)))
    await api.client.post(answers_url(session_id), json=body((2, SESSION_LIMIT_MS + 1)))
    await api.client.post(answers_url(session_id), json=body((2, SESSION_LIMIT_MS)))

    assert api.liveavatar.stop_calls == []
    assert len(api.liveavatar.token_calls) == 1
    assert api.liveavatar.voice_agent_calls == []


# What every record carries anyway (timestamps, thread ids). Only the rest is what the code logged.
STANDARD_RECORD_KEYS = set(vars(logging.makeLogRecord({})))


def logged_content(record: logging.LogRecord) -> str:
    extras = {key: value for key, value in vars(record).items() if key not in STANDARD_RECORD_KEYS}
    return repr((record.getMessage(), record.args, extras))


@pytest.mark.asyncio
async def test_a_report_is_logged_once_and_without_its_body(api, caplog):
    await api.login(PHONE)
    session_id = await open_session(api)

    with caplog.at_level(logging.DEBUG):
        response = await api.client.post(answers_url(session_id), json=body((0, 43217), (0, 12347)))

    assert response.status_code == 200, response.text
    records = [record for record in caplog.records if record.getMessage() == "assistant_answers_recorded"]
    assert len(records) == 1
    record = records[0]
    assert record.session_id == session_id
    assert record.recorded == 1
    assert record.duplicates == 1
    for captured in caplog.records:
        logged = logged_content(captured)
        assert "durationMs" not in logged
        assert "43217" not in logged
        assert "12347" not in logged


@pytest.mark.asyncio
async def test_only_the_camel_case_duration_is_accepted(api):
    await api.login(PHONE)
    session_id = await open_session(api)

    snake_case = await api.client.post(answers_url(session_id), json=one_answer(index=0, duration_ms=1000))
    camel_case = await api.client.post(answers_url(session_id), json=one_answer(index=0, durationMs=1000))

    assert snake_case.status_code == 422, snake_case.text
    assert snake_case.json()["error"]["code"] == "validation_error"
    assert camel_case.status_code == 200, camel_case.text
    assert [row["estimated_duration_ms"] for row in answer_rows(api)] == [1000]


@pytest.mark.asyncio
async def test_concurrent_reports_cannot_pass_the_count_cap_together(api):
    api.settings.assistant_answers_per_session_max = 1
    await api.login(PHONE)
    session_id = await open_session(api)
    yield_on_every_database_call(api.database)

    responses = await asyncio.gather(
        *(api.client.post(answers_url(session_id), json=body((index, 1000))) for index in range(3))
    )

    assert sorted(response.status_code for response in responses) == [200, 409, 409]
    assert len(answer_rows(api)) == 1


@pytest.mark.asyncio
async def test_concurrent_reports_cannot_pass_the_session_length_together(api):
    await api.login(PHONE)
    session_id = await open_session(api)
    yield_on_every_database_call(api.database)

    responses = await asyncio.gather(
        api.client.post(answers_url(session_id), json=body((0, 40_000))),
        api.client.post(answers_url(session_id), json=body((1, 40_000))),
    )

    assert sorted(response.status_code for response in responses) == [200, 409]
    assert sum(row["estimated_duration_ms"] for row in answer_rows(api)) == 40_000
