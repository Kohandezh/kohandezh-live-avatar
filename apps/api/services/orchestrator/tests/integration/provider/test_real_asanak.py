"""Sends one real login code by SMS through Asanak, so a human can confirm it arrives.

Why this file exists: every other Asanak test answers the HTTP call with a fake, so a green suite
still says nothing about whether a phone rings. This one uses the real credentials and really
spends one SMS. It is opt-in for that reason.

Run it from the repository root, because `Settings` reads the `.env` next to the working
directory:

    REAL_PROVIDER_TESTS=true CONFIRM_CREDIT_USAGE=YES \
    pytest apps/api/services/orchestrator/tests/integration/provider/test_real_asanak.py -s

`-s` matters. The report is printed, and pytest hides output without it.

The destination comes from `OTP_TEST_PHONE` in `.env`. Set it in the shell instead to send one
run somewhere else. The two switches above stay on the command line on purpose: a plain `pytest`
run must never spend money by accident.

The test does not edit `.env`. It forces `OTP_DELIVERY=asanak` on its own copy of the settings,
so the repository can keep `console` for local development.

Asanak's API only answers Iranian addresses. From a blocked address the request never reaches
their application and comes back as an HTML `403 Access Denied` page from the CDN. The report
below names that case directly, because it looks exactly like a credentials problem otherwise.
"""

import os
import re
import secrets

import httpx
import pytest
from pydantic_settings import BaseSettings, SettingsConfigDict

from services.orchestrator.src.auth.asanak import AsanakOtpSender, build_otp_sender, to_asanak_destination
from services.orchestrator.src.auth.phone import normalize_phone
from services.orchestrator.src.config import Settings
from services.orchestrator.src.errors import AppError

# The failure codes Asanak returns in `meta.status`. Only the ones this project has actually seen
# documented are listed; anything else is reported with its number so it can be looked up.
PROVIDER_STATUS_MEANINGS = {
    1006: "the account is out of credit. Top it up in the Asanak panel.",
    1008: "the web service username or password was rejected. Note this is not the panel login.",
    1010: "Asanak rejected the destination number.",
}

_HTML_TAGS = re.compile(r"<[^>]*>")


class _TestPhoneSetting(BaseSettings):
    """Reads OTP_TEST_PHONE the way the app reads its own settings.

    pydantic-settings prefers a real environment variable over the `.env` line, so the phone can
    sit in `.env` for every day and still be overridden for a single run. It is kept out of
    `Settings` because the application must never depend on a test-only value.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    otp_test_phone: str = ""


def _opt_in_or_skip() -> str:
    """Skip unless the operator asked for a real send and named a phone to send it to.

    The same two switches guard every real provider test, so one command runs the whole
    opt-in suite the same way.
    """
    if os.getenv("REAL_PROVIDER_TESTS", "false").lower() != "true":
        pytest.skip("REAL_PROVIDER_TESTS is false; no SMS sent and no credit spent")
    if os.getenv("CONFIRM_CREDIT_USAGE") != "YES":
        pytest.skip("CONFIRM_CREDIT_USAGE is not YES; this test spends one real SMS")
    raw = _TestPhoneSetting().otp_test_phone.strip()
    if not raw:
        pytest.skip("OTP_TEST_PHONE is not set in .env or the shell; it names the phone to send to")
    # The same normalizer the login endpoint uses, so "09...", "0098..." and "+98..." all work.
    return normalize_phone(raw)


def _asanak_settings() -> Settings:
    """Load the real `.env` and force the SMS path on this copy only."""
    settings = Settings()
    if not settings.asanak_username or not settings.asanak_password.get_secret_value():
        pytest.fail("ASANAK_USERNAME and ASANAK_PASSWORD are missing. Run pytest from the repository root.")
    return settings.model_copy(update={"otp_delivery": "asanak"})


def _capture_responses(sender: AsanakOtpSender) -> list[httpx.Response]:
    """Keep the raw provider answers, which the client itself deliberately throws away.

    `AsanakClient` turns any failure into one safe message, which is right for the login screen
    and useless for a human trying to fix the setup. The hook reads the body while it is still
    available so the report can quote it.
    """
    seen: list[httpx.Response] = []

    async def capture(response: httpx.Response) -> None:
        await response.aread()
        seen.append(response)

    sender.client.http.event_hooks["response"].append(capture)
    return seen


def _body_snippet(response: httpx.Response, limit: int = 240) -> str:
    """One readable line out of the answer, whether it is JSON or a CDN error page."""
    text = _HTML_TAGS.sub(" ", response.text)
    text = " ".join(text.split())
    return text[:limit] + ("..." if len(text) > limit else "")


def _diagnose(responses: list[httpx.Response]) -> str:
    """Say what actually went wrong, in the words of the person who has to fix it."""
    if not responses:
        return (
            "No answer came back at all. The request timed out or the network refused it. "
            "Check that this machine can reach sms.asanak.ir on port 443."
        )
    response = responses[-1]
    snippet = _body_snippet(response)
    if "Access Denied" in response.text or "دسترسی" in response.text:
        blocked_ip = re.search(r"Your IP:\s*([0-9a-fA-F.:]+)", response.text)
        address = blocked_ip.group(1) if blocked_ip else "this machine"
        return (
            f"Asanak blocked the address of this machine ({address}). The request never reached "
            "their application, so the credentials were never checked. Their API answers Iranian "
            "addresses only. Run this test from an allowed network, or ask Asanak support to "
            f"allow the address.\nProvider page: {snippet}"
        )
    try:
        body = response.json()
    except ValueError:
        return f"HTTP {response.status_code}, and the body was not JSON.\nBody: {snippet}"
    meta = body.get("meta") if isinstance(body, dict) else None
    provider_status = meta.get("status") if isinstance(meta, dict) else None
    meaning = PROVIDER_STATUS_MEANINGS.get(provider_status)
    if meaning:
        return f"HTTP {response.status_code}, Asanak status {provider_status}: {meaning}\nBody: {snippet}"
    return (
        f"HTTP {response.status_code}, Asanak status {provider_status}. "
        f"Look the status up in the Asanak panel documentation.\nBody: {snippet}"
    )


@pytest.mark.provider
@pytest.mark.asyncio
async def test_asanak_delivers_a_real_login_code():
    """Send one code and report the result. A pass means Asanak accepted the message.

    Asanak accepting it is not the same as the phone ringing, so the printed code is there to be
    compared with the SMS by hand. That last step is the only real proof of delivery.
    """
    phone = _opt_in_or_skip()
    settings = _asanak_settings()
    # A real looking code, generated the same length as a login code. It is not a login code and
    # opens nothing, so printing it is safe and is the whole point of the test.
    code = "".join(secrets.choice("0123456789") for _ in range(settings.otp_code_length))

    sender = build_otp_sender(settings)
    assert isinstance(sender, AsanakOtpSender), "OTP_DELIVERY=asanak should build the SMS sender"
    responses = _capture_responses(sender)

    print("\n--- Asanak real send ---")
    print(f"  endpoint    {settings.asanak_base_url}/template")
    parameter = settings.asanak_template_code_parameter
    print(f"  template    {settings.asanak_template_id} (parameter {parameter!r})")
    print(f"  sender line {settings.asanak_source}")
    print(f"  to          {phone} (sent as {to_asanak_destination(phone)})")
    print(f"  code        {code}")

    try:
        await sender.send(phone, code)
    except AppError as error:
        print(f"  result      FAILED ({error.code})")
        pytest.fail(f"Asanak did not accept the message.\n\n{_diagnose(responses)}")
    finally:
        await sender.close()

    print("  result      ACCEPTED by Asanak")
    print(f"  Now check the phone. The SMS should contain {code}.")


# A trimmed copy of the page ArvanCloud really returned for this project on 2026-09-18. The
# wording is what `_diagnose` matches on, so a change here should follow a change at the provider.
BLOCKED_PAGE = (
    "<!DOCTYPE html><html><body><section><h1>Error 403 &nbsp;|&nbsp; Access Denied</h1>"
    "<p>The request has been blocked from your IP or your location! This is due to some security "
    "settings of the website. Contact sms.asanak.ir support!</p>"
    "<div>Time: 2026-09-18 18:25:21 UTC | Error Code: 403 | Server Code: 5700 | "
    "Domain: sms.asanak.ir | Your IP: 178.156.194.38</div></section></body></html>"
)


def provider_answer(status_code: int, provider_status: int) -> httpx.Response:
    return httpx.Response(status_code, json={"meta": {"status": provider_status}, "data": []})


def test_the_report_names_the_blocked_address_instead_of_blaming_the_credentials():
    """The failure that cost this project the most time has to read as itself.

    A blocked address and a wrong password both surface as one generic error on the login screen.
    Here they must not, or the next person spends the afternoon rotating a password that works.
    """
    report = _diagnose([httpx.Response(403, text=BLOCKED_PAGE)])

    assert "blocked" in report
    assert "178.156.194.38" in report
    assert "credentials were never checked" in report
    assert "password" not in report.split("Provider page:")[0]


def test_the_report_explains_a_rejected_web_service_password():
    report = _diagnose([provider_answer(400, 1008)])

    assert "1008" in report
    assert "username or password" in report
    assert "not the panel login" in report


def test_the_report_explains_an_empty_account():
    report = _diagnose([provider_answer(200, 1006)])

    assert "out of credit" in report


def test_an_unknown_provider_status_is_still_reported_with_its_number():
    """An unknown code must not become a shrug. The number is what gets looked up."""
    report = _diagnose([provider_answer(400, 1099)])

    assert "1099" in report


def test_the_report_says_when_nothing_answered_at_all():
    """What a blocked network looks like from inside Docker: no answer, not a status."""
    report = _diagnose([])

    assert "timed out" in report
    assert "port 443" in report
