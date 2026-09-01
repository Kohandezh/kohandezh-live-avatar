import os

import pytest

pytestmark = pytest.mark.provider


def test_real_provider_suite_is_explicitly_opt_in():
    if os.getenv("REAL_PROVIDER_TESTS", "false").lower() != "true":
        pytest.skip("REAL_PROVIDER_TESTS is false; no provider credits consumed")
    assert os.getenv("CONFIRM_CREDIT_USAGE") == "YES", "explicit credit confirmation is also required"
