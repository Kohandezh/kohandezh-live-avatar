import logging

from ..config import Settings
from ..database import Database
from ..errors import ForbiddenError, ValidationError
from ..schemas import PublicUser
from .dependencies import UserRow
from .phone import normalize_phone

logger = logging.getLogger(__name__)


def public_user(row: UserRow) -> PublicUser:
    """Map a database row to the public field allowlist. Nothing else leaves the backend."""
    return PublicUser.model_validate(dict(row))


def admin_phone_set(settings: Settings) -> set[str]:
    """ADMIN_PHONES in E.164, so an operator can write 0912... or +98912... and both work."""
    phones = set()
    for entry in settings.admin_phone_list:
        try:
            phones.add(normalize_phone(entry))
        except ValidationError:
            logger.warning("admin_phone_ignored", extra={"reason": "not a valid phone number"})
    return phones


async def login_user(database: Database, settings: Settings, phone: str) -> UserRow:
    """Find or create the user behind a verified phone number.

    The role is re-applied on every login: adding a phone to ADMIN_PHONES promotes the account at
    the next login. Removing it does not demote, so an operator cannot lose admin access by
    editing one environment variable.
    """
    role = "admin" if phone in admin_phone_set(settings) else "user"
    user = await database.get_user_by_phone(phone)
    if user is None:
        user = await database.create_user(phone, role)
    if user["status"] != "active":
        raise ForbiddenError("this account is disabled", "account_disabled")
    if role == "admin" and user["role"] != "admin":
        user = await database.set_user_role(user["id"], "admin")
    return user
