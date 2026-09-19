"""Real provider tests are the one place that must see the real environment.

`tests/conftest.py` deletes every `Settings` variable from the environment before each test, so a
developer's `.env` cannot quietly change which path a test takes. That is right for the tests that
answer the provider with a fake, and wrong here: these tests exist to use the real credentials.

It also had a side effect nobody could see. `real_provider_tests` is a `Settings` field, so
`REAL_PROVIDER_TESTS=true` was stripped along with the rest and every opt-in test skipped itself,
including the guard that is supposed to prove the opt-in works.

Redefining the fixture by name switches it off for this folder and changes nothing anywhere else.
"""

import pytest


@pytest.fixture(autouse=True)
def isolate_settings_from_environment():
    """Shadows the parent fixture with one that keeps the environment intact."""
    return None
