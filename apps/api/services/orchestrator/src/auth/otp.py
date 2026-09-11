import hashlib
import hmac
import logging
import secrets
from dataclasses import dataclass
from typing import Protocol

from ..config import Settings
from ..coordination import Coordinator
from ..errors import AppError, RateLimitedError, UnauthorizedError
from .phone import mask_phone

logger = logging.getLogger(__name__)

HOUR_SECONDS = 3600
# One code per minute per phone, so a stuck client cannot send an SMS flood.
RESEND_SECONDS = 60
CODES_PER_PHONE_PER_HOUR = 5
CODES_PER_IP_PER_HOUR = 20
# Five wrong tries burn the code. Guessing a 6 digit code then needs a new SMS every 5 minutes.
MAX_ATTEMPTS = 5
LOCK_SECONDS = 300


class OtpSender(Protocol):
    """How a code reaches the user. An SMS provider plugs in here later."""

    async def send(self, phone: str, code: str) -> None: ...


class ConsoleOtpSender:
    """Delivers the code to the log. This is the development and sandbox sender.

    Outside development the code is never written anywhere, because a log line with a live code
    is a credential leak. The request still succeeds, and the operator sees a warning that no
    real delivery channel is configured.
    """

    def __init__(self, *, log_codes: bool):
        self.log_codes = log_codes

    async def send(self, phone: str, code: str) -> None:
        if self.log_codes:
            logger.info("otp_code_issued", extra={"phone": mask_phone(phone), "code": code})
            return
        logger.warning("otp_delivery_not_configured", extra={"phone": mask_phone(phone)})


@dataclass
class OtpChallenge:
    expires_in_seconds: int
    resend_after_seconds: int
    # Filled only in development, so the login flow can be finished without an SMS provider.
    dev_code: str | None


class OtpService:
    def __init__(self, *, coordinator: Coordinator, sender: OtpSender, settings: Settings):
        self.coordinator = coordinator
        self.sender = sender
        self.settings = settings

    async def request(self, phone: str, client_ip: str | None) -> OtpChallenge:
        wait = await self.coordinator.claim_once(f"otp:resend:{phone}", RESEND_SECONDS)
        if wait:
            raise RateLimitedError("otp_rate_limited", "a code was already sent to this number", wait)
        wait = await self.coordinator.rate_limit(f"otp:phone:{phone}", CODES_PER_PHONE_PER_HOUR, HOUR_SECONDS)
        if wait:
            raise RateLimitedError("otp_rate_limited", "too many codes for this number", wait)
        if client_ip:
            wait = await self.coordinator.rate_limit(
                f"otp:ip:{client_ip}", CODES_PER_IP_PER_HOUR, HOUR_SECONDS
            )
            if wait:
                raise RateLimitedError("otp_rate_limited", "too many codes from this address", wait)

        code = self._generate_code()
        await self.coordinator.store_otp(
            phone,
            {"code_hash": _hash_code(phone, code), "attempts": 0},
            self.settings.otp_ttl_seconds,
        )
        try:
            await self.sender.send(phone, code)
        except Exception:
            # The user never got this code. Drop it and free the resend guard, otherwise a
            # provider hiccup locks them out of retrying for a minute.
            await self.coordinator.delete_otp(phone)
            await self.coordinator.release_once(f"otp:resend:{phone}")
            raise
        return OtpChallenge(
            expires_in_seconds=self.settings.otp_ttl_seconds,
            resend_after_seconds=RESEND_SECONDS,
            dev_code=code if self.settings.is_development else None,
        )

    async def verify(self, phone: str, code: str) -> None:
        """Check a code. Returns nothing on success and raises the matching AppError otherwise."""
        locked_for = await self.coordinator.once_ttl(f"otp:lock:{phone}")
        if locked_for:
            raise RateLimitedError("otp_locked", "too many wrong codes for this number", locked_for)
        record = await self.coordinator.load_otp(phone)
        if not record:
            raise AppError("otp_expired", "the code expired; ask for a new one", 410, True)
        if hmac.compare_digest(record["code_hash"], _hash_code(phone, code.strip())):
            await self.coordinator.delete_otp(phone)
            return
        attempts = int(record.get("attempts", 0)) + 1
        if attempts >= MAX_ATTEMPTS:
            await self.coordinator.delete_otp(phone)
            await self.coordinator.claim_once(f"otp:lock:{phone}", LOCK_SECONDS)
            logger.warning("otp_locked", extra={"phone": mask_phone(phone)})
            raise RateLimitedError("otp_locked", "too many wrong codes for this number", LOCK_SECONDS)
        record["attempts"] = attempts
        await self.coordinator.update_otp(phone, record)
        raise UnauthorizedError("the code is not correct", "invalid_code")

    def _generate_code(self) -> str:
        # secrets, not random: the code is a credential.
        digits = max(4, min(self.settings.otp_code_length, 10))
        return "".join(secrets.choice("0123456789") for _ in range(digits))


def _hash_code(phone: str, code: str) -> str:
    """Redis stores the hash, not the code, so a dump of Redis cannot log anybody in."""
    return hashlib.sha256(f"{phone}:{code}".encode()).hexdigest()
