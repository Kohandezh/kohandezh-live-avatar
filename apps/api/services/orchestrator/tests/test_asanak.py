"""Asanak SMS delivery of the one-time login code. No test ever reaches the network."""

import json
import logging

import httpx
import pytest
from pydantic import SecretStr

from services.orchestrator.src.auth.asanak import (
    AsanakClient,
    AsanakOtpSender,
    build_otp_sender,
    to_asanak_destination,
)
from services.orchestrator.src.auth.otp import ConsoleOtpSender
from services.orchestrator.src.errors import AppError, ConfigurationError
from services.orchestrator.src.main import app

from .conftest import build_settings

BASE_URL = "https://sms.asanak.ir/webservice/v2rest"
USERNAME = "panel-user"
PASSWORD = "panel-password"  # noqa: S105 - a fake credential for the tests
CODE = "483920"
E164 = "+989123456789"

SUCCESS_BODY = {"meta": {"status": 200, "message": "success"}, "data": [123456]}


def build_sender(handler) -> tuple[AsanakOtpSender, list[httpx.Request]]:
    """An Asanak sender whose HTTP calls are answered by `handler` instead of the provider."""
    requests: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    client = AsanakClient(
        username=USERNAME,
        password=PASSWORD,
        base_url=BASE_URL,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(record)),
    )
    sender = AsanakOtpSender(client=client, template_id=1654, code_parameter="code", source="9821700021")
    return sender, requests


def ok(_request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json=SUCCESS_BODY)


def status(code: int, provider_status: int) -> httpx.Response:
    return httpx.Response(code, json={"meta": {"status": provider_status, "message": "failed"}, "data": []})


@pytest.mark.parametrize(
    ("phone", "expected"),
    [
        # Asanak documents Iranian destinations in the local 09... form, never with a "+".
        ("+989123456789", "09123456789"),
        ("+989901234567", "09901234567"),
        # Any other country keeps its country code and only loses the "+".
        ("+4915112345678", "4915112345678"),
    ],
)
def test_the_destination_uses_the_format_asanak_documents(phone, expected):
    assert to_asanak_destination(phone) == expected


@pytest.mark.asyncio
async def test_the_request_carries_the_template_the_destination_and_the_code():
    sender, requests = build_sender(ok)

    await sender.send(E164, CODE)

    assert len(requests) == 1
    request = requests[0]
    assert request.method == "POST"
    assert str(request.url) == f"{BASE_URL}/template"
    body = json.loads(request.content)
    assert body["username"] == USERNAME
    assert body["password"] == PASSWORD
    assert body["template_id"] == 1654
    assert body["destination"] == "09123456789"
    assert body["parameters"] == {"code": CODE}


@pytest.mark.asyncio
async def test_the_code_parameter_name_follows_the_setting():
    sender, requests = build_sender(ok)
    sender.code_parameter = "otp"

    await sender.send(E164, CODE)

    assert json.loads(requests[0].content)["parameters"] == {"otp": CODE}


@pytest.mark.asyncio
async def test_a_successful_send_raises_nothing():
    sender, requests = build_sender(ok)

    assert await sender.send(E164, CODE) is None
    assert len(requests) == 1


@pytest.mark.asyncio
async def test_a_rejected_request_is_not_retried_and_is_not_retryable():
    # 1008 is Asanak's validation and authentication failure. Sending it again changes nothing.
    sender, requests = build_sender(lambda _request: status(400, 1008))

    with pytest.raises(AppError) as raised:
        await sender.send(E164, CODE)

    assert raised.value.code == "otp_delivery_failed"
    assert raised.value.status_code == 502
    assert raised.value.retryable is False
    assert len(requests) == 1


@pytest.mark.asyncio
async def test_an_accepted_http_status_with_a_provider_error_still_fails():
    sender, _requests = build_sender(lambda _request: httpx.Response(200, json={"meta": {"status": 1006}}))

    with pytest.raises(AppError) as raised:
        await sender.send(E164, CODE)

    assert raised.value.code == "otp_delivery_failed"
    assert raised.value.retryable is False


@pytest.mark.asyncio
async def test_a_provider_outage_is_retried_three_times_and_stays_retryable():
    sender, requests = build_sender(lambda _request: status(500, 1004))

    with pytest.raises(AppError) as raised:
        await sender.send(E164, CODE)

    assert raised.value.code == "otp_delivery_failed"
    assert raised.value.retryable is True
    assert len(requests) == 3


@pytest.mark.asyncio
async def test_a_timeout_is_retried_three_times_and_stays_retryable():
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("asanak did not answer", request=request)

    sender, requests = build_sender(timeout)

    with pytest.raises(AppError) as raised:
        await sender.send(E164, CODE)

    assert raised.value.retryable is True
    assert len(requests) == 3


@pytest.mark.asyncio
async def test_a_recovered_outage_succeeds_on_the_second_attempt():
    answers = [status(500, 1004), httpx.Response(200, json=SUCCESS_BODY)]
    sender, requests = build_sender(lambda _request: answers.pop(0))

    await sender.send(E164, CODE)

    assert len(requests) == 2


@pytest.mark.asyncio
async def test_a_failure_leaks_no_credential_no_code_and_no_full_phone(caplog):
    sender, _requests = build_sender(lambda _request: status(400, 1008))

    with caplog.at_level(logging.INFO):
        with pytest.raises(AppError) as raised:
            await sender.send(E164, CODE)

    secrets = (USERNAME, PASSWORD, CODE, E164, "989123456789")
    assert not any(secret in raised.value.message for secret in secrets)
    for record in caplog.records:
        line = record.getMessage() + json.dumps(record.__dict__, default=str)
        assert not any(secret in line for secret in secrets)
    warnings = [record for record in caplog.records if record.message == "otp_sms_failed"]
    assert len(warnings) == 1
    assert warnings[0].phone == "***789"
    assert warnings[0].asanak_status == 1008
    assert warnings[0].http_status == 400


@pytest.mark.asyncio
async def test_a_successful_send_leaks_no_credential_and_no_code(caplog):
    sender, _requests = build_sender(ok)

    with caplog.at_level(logging.INFO):
        await sender.send(E164, CODE)

    for record in caplog.records:
        line = record.getMessage() + json.dumps(record.__dict__, default=str)
        assert not any(secret in line for secret in (USERNAME, PASSWORD, CODE, E164))
    sent = [record for record in caplog.records if record.message == "otp_sms_sent"]
    assert len(sent) == 1
    assert sent[0].phone == "***789"
    assert sent[0].message_id == 123456


@pytest.mark.asyncio
async def test_missing_credentials_fail_the_call_even_if_startup_was_skipped():
    client = AsanakClient(username="", password="", base_url=BASE_URL)

    with pytest.raises(ConfigurationError):
        await client.send_template(template_id=1654, destination="09123456789", parameters={"code": CODE})

    await client.close()


@pytest.mark.asyncio
async def test_the_login_endpoint_answers_502_when_the_sms_is_rejected(api):
    """The whole path: a provider rejection reaches the client as the documented envelope."""
    sender, _requests = build_sender(lambda _request: status(400, 1008))
    # The api fixture rebuilds app.state.otp for every test, so this swap cannot leak.
    app.state.otp.sender = sender

    response = await api.client.post("/auth/otp/request", json={"phone": "09123456789"})

    assert response.status_code == 502
    error = response.json()["error"]
    assert error["code"] == "otp_delivery_failed"
    assert error["retryable"] is False
    # The answer must not hand the caller the code or anything about the provider account.
    assert not any(secret in response.text for secret in (USERNAME, PASSWORD))


def test_the_default_delivery_is_the_console_sender():
    assert isinstance(build_otp_sender(build_settings()), ConsoleOtpSender)


@pytest.mark.parametrize(
    ("username", "password"),
    [("", PASSWORD), (USERNAME, ""), ("", "")],
)
def test_asanak_without_credentials_stops_the_process_at_startup(username, password):
    settings = build_settings(
        otp_delivery="asanak",
        asanak_username=username,
        asanak_password=SecretStr(password),
    )

    with pytest.raises(ConfigurationError) as raised:
        build_otp_sender(settings)

    assert "ASANAK_USERNAME" in raised.value.message


@pytest.mark.asyncio
async def test_asanak_with_credentials_builds_the_sms_sender():
    settings = build_settings(
        otp_delivery="asanak",
        asanak_username=USERNAME,
        asanak_password=SecretStr(PASSWORD),
    )

    sender = build_otp_sender(settings)

    assert isinstance(sender, AsanakOtpSender)
    assert sender.template_id == 1654
    assert sender.code_parameter == "code"
    assert sender.source == "9821700021"
    assert sender.client.base_url == BASE_URL
    await sender.close()
