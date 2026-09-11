import re

from ..errors import ValidationError

# Iranian keyboards produce Persian and Arabic digits. Map them to ASCII before anything else.
_EASTERN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_SEPARATORS = re.compile(r"[\s\-().]")
_IRANIAN_MOBILE = re.compile(r"^09\d{9}$")
_E164_DIGITS = re.compile(r"^[1-9]\d{7,14}$")

_MESSAGE = "phone must be an Iranian mobile number (09...) or an international number (+...)"


def normalize_phone(raw: str) -> str:
    """Turn what the user typed into E.164, so one person is always one row.

    Accepted: 09123456789, 00989123456789, +989123456789, and any other +<country><number>.
    """
    value = _SEPARATORS.sub("", (raw or "").translate(_EASTERN_DIGITS).strip())
    if value.startswith("00"):
        value = "+" + value[2:]
    elif _IRANIAN_MOBILE.match(value):
        value = "+98" + value[1:]
    if not value.startswith("+"):
        raise ValidationError(_MESSAGE)
    digits = value[1:]
    if not _E164_DIGITS.match(digits):
        raise ValidationError(_MESSAGE)
    return "+" + digits


def mask_phone(phone: str) -> str:
    """Hide a phone number in logs. Only the last three digits survive."""
    return f"***{phone[-3:]}" if len(phone) > 3 else "***"
