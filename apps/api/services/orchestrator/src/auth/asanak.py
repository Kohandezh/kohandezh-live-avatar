"""SMS delivery of the one-time login code through Asanak.

Asanak is an Iranian SMS provider. The login code is sent with their template service
(`POST /template`), because Iranian operators only accept a pre-approved template for an OTP.
The template id and the sender line are registered in the customer's Asanak panel.

Nothing here ever logs the code, the username, or the password. A failed send raises
`otp_delivery_failed` with a message that is safe to show to the user.
"""

import asyncio
import logging
from typing import Any

import httpx

from ..config import Settings
from ..errors import AppError, ConfigurationError
from .otp import ConsoleOtpSender, OtpSender
from .phone import mask_phone

logger = logging.getLogger(__name__)

# Three bounded attempts, same shape as the LiveAvatar client. A timeout or a 5xx is worth one
# more try; a 4xx is the provider telling us the request itself is wrong, so retrying it only
# burns time while the user waits on the login screen.
ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = 0.25

_FAILURE_MESSAGE = "the login code could not be sent by SMS"


def to_asanak_destination(phone: str) -> str:
    """Turn our E.164 phone into the number format Asanak's examples use.

    Asanak documents destinations as `09123456789` (local Iranian form), never with a `+`.
    So `+989123456789` becomes `09123456789`. A number from any other country keeps its country
    code and only loses the `+` (`+4915112345678` becomes `4915112345678`), because Asanak
    documents no international form. If they reject it, the caller sees `otp_delivery_failed`
    with provider status 1010.
    """
    digits = phone.removeprefix("+")
    if digits.startswith("98"):
        return "0" + digits[2:]
    return digits


class AsanakClient:
    """HTTP client for the Asanak REST web service."""

    def __init__(
        self,
        *,
        username: str,
        password: str,
        base_url: str,
        timeout_seconds: float = 10.0,
        http_client: httpx.AsyncClient | None = None,
    ):
        self.username = username
        self.password = password
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self._owned_client = http_client is None
        self.http = http_client or httpx.AsyncClient(timeout=timeout_seconds)

    async def close(self) -> None:
        if self._owned_client:
            await self.http.aclose()

    async def send_template(
        self,
        *,
        template_id: int,
        destination: str,
        parameters: dict[str, str],
    ) -> int | None:
        """Send one template SMS. Returns the provider message id when it reports one.

        The credentials travel in the body, which is what Asanak's API expects. That is why the
        payload is never logged.
        """
        if not self.username or not self.password:
            raise ConfigurationError("ASANAK_USERNAME and ASANAK_PASSWORD are not configured")
        payload: dict[str, Any] = {
            "username": self.username,
            "password": self.password,
            "template_id": template_id,
            "destination": destination,
            # Asanak types this field as "json". With a JSON request body it is a nested object
            # of template variable names and their values.
            "parameters": parameters,
        }
        response = await self._post("/template", payload, destination)
        return self._message_id(response, destination)

    async def _post(self, path: str, payload: dict[str, Any], destination: str) -> httpx.Response:
        url = f"{self.base_url}{path}"
        for attempt in range(ATTEMPTS):
            try:
                response = await self.http.post(url, json=payload)
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                if attempt == ATTEMPTS - 1:
                    failure = self._failure(
                        destination, http_status=None, provider_status=None, retryable=True
                    )
                    raise failure from exc
                await asyncio.sleep(RETRY_BACKOFF_SECONDS * (2**attempt))
                continue
            if response.status_code >= 500 and attempt < ATTEMPTS - 1:
                await asyncio.sleep(RETRY_BACKOFF_SECONDS * (2**attempt))
                continue
            return response
        raise AssertionError("unreachable")

    def _message_id(self, response: httpx.Response, destination: str) -> int | None:
        body = self._body(response)
        provider_status = body.get("meta", {}).get("status") if isinstance(body.get("meta"), dict) else None
        # Asanak answers a failure both ways: an HTTP error status, and meta.status carrying its
        # own code (1008 credentials, 1006 no credit, 1010 bad destination, and so on).
        if response.status_code >= 400 or provider_status != 200:
            raise self._failure(
                destination,
                http_status=response.status_code,
                provider_status=provider_status,
                retryable=response.status_code >= 500,
            )
        data = body.get("data")
        if isinstance(data, list) and data:
            try:
                return int(data[0])
            except (TypeError, ValueError):
                return None
        return None

    @staticmethod
    def _body(response: httpx.Response) -> dict[str, Any]:
        try:
            body = response.json()
        except ValueError:
            return {}
        return body if isinstance(body, dict) else {}

    @staticmethod
    def _failure(
        destination: str,
        *,
        http_status: int | None,
        provider_status: int | None,
        retryable: bool,
    ) -> AppError:
        """Build the error and leave a trail the operator can read.

        The log line carries the masked phone and the two status codes, never the credentials,
        never the code, and never the request body.
        """
        logger.warning(
            "otp_sms_failed",
            extra={
                "phone": mask_phone(destination),
                "asanak_status": provider_status,
                "http_status": http_status,
                "retryable": retryable,
            },
        )
        return AppError("otp_delivery_failed", _FAILURE_MESSAGE, 502, retryable)


class AsanakOtpSender:
    """Delivers the one-time login code as an Asanak template SMS."""

    def __init__(self, *, client: AsanakClient, template_id: int, code_parameter: str, source: str = ""):
        self.client = client
        self.template_id = template_id
        self.code_parameter = code_parameter
        # Asanak takes the sender line from the template itself, so it is not part of the request.
        # It is kept here so the operator can see in the log which line the template belongs to.
        self.source = source

    async def close(self) -> None:
        await self.client.close()

    async def send(self, phone: str, code: str) -> None:
        message_id = await self.client.send_template(
            template_id=self.template_id,
            destination=to_asanak_destination(phone),
            parameters={self.code_parameter: code},
        )
        logger.info(
            "otp_sms_sent",
            extra={"phone": mask_phone(phone), "message_id": message_id, "source": self.source},
        )


def build_otp_sender(config: Settings) -> OtpSender:
    """Pick the delivery channel for the login code.

    A missing Asanak credential stops the process at startup. Finding it during a deploy is much
    cheaper than finding it when the first user cannot log in.
    """
    if config.otp_delivery != "asanak":
        # The code reaches the log only in development. See ConsoleOtpSender.
        return ConsoleOtpSender(log_codes=config.is_development)
    if not config.asanak_username or not config.asanak_password.get_secret_value():
        raise ConfigurationError("OTP_DELIVERY=asanak needs ASANAK_USERNAME and ASANAK_PASSWORD to be set")
    return AsanakOtpSender(
        client=AsanakClient(
            username=config.asanak_username,
            password=config.asanak_password.get_secret_value(),
            base_url=config.asanak_base_url,
            timeout_seconds=config.asanak_timeout_seconds,
        ),
        template_id=config.asanak_template_id,
        code_parameter=config.asanak_template_code_parameter,
        source=config.asanak_source,
    )
