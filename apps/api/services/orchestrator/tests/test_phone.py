import pytest

from services.orchestrator.src.auth.phone import mask_phone, normalize_phone
from services.orchestrator.src.errors import ValidationError


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("09123456789", "+989123456789"),
        ("0912 345 6789", "+989123456789"),
        ("0912-345-6789", "+989123456789"),
        ("۰۹۱۲۳۴۵۶۷۸۹", "+989123456789"),
        ("٠٩١٢٣٤٥٦٧٨٩", "+989123456789"),
        ("00989123456789", "+989123456789"),
        ("+98 912 345 6789", "+989123456789"),
        (" +14155552671 ", "+14155552671"),
        ("+49 (30) 1234567", "+49301234567"),
    ],
)
def test_numbers_people_type_become_e164(raw: str, expected: str):
    assert normalize_phone(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "123",
        "0912345678",  # one digit short of an Iranian mobile
        "02112345678",  # a landline is not accepted for login
        "+0912345678",  # a country code never starts with zero
        "+98912345678901234",  # longer than E.164 allows
        "phone number",
        "+98912abc6789",
    ],
)
def test_anything_else_is_rejected(raw: str):
    with pytest.raises(ValidationError) as error:
        normalize_phone(raw)
    assert error.value.status_code == 422


def test_logs_only_keep_the_last_digits():
    assert mask_phone("+989123456789") == "***789"
    assert mask_phone("+98") == "***"
