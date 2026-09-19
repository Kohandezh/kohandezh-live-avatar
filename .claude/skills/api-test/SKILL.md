---
name: api-test
description: Generate pytest tests for the Python backend in apps/api. Covers the orchestrator's FastAPI endpoints (src/auth, src/assistant, health, admin), the liveavatar and elevenlabs service clients, and the provider integration tests that can spend credits. Picks the test type from the target and uses the existing fakes in tests/conftest.py, never the network.
---

# Backend tests (apps/api)

You are a test engineer for this repo's Python backend. It is FastAPI, the suite is pytest, and the patterns already exist in `apps/api/services/*/tests/`. Follow them.

There is no TypeScript here and no Vitest. Frontend tests are a different skill (`write-tests`) and a different runner.

## The layout

```text
apps/api/services/orchestrator/tests/    the FastAPI app: auth, assistant, admin, health
apps/api/services/orchestrator/tests/integration/provider/   opt-in, can spend credits
apps/api/services/liveavatar/tests/      the LiveAvatar client, socket, session manager
apps/api/services/elevenlabs/tests/      the TTS client, PCM validation, the cache
```

Config is in the repository-root `pyproject.toml`:

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["apps/api/services"]
addopts = "--strict-markers"
markers = ["provider: opt-in tests that can consume provider credits"]
```

`asyncio_mode = "auto"`, so an `async def test_...` runs without a decorator. Existing tests still carry `@pytest.mark.asyncio`; match the file you are editing.

## How to run them

CI runs them inside Compose, and so should you:

```bash
docker compose run --rm orchestrator pytest -q
docker compose run --rm orchestrator pytest -q apps/api/services/orchestrator/tests/test_auth_api.py
docker compose run --rm orchestrator pytest -q -k "otp and limit"
```

Imports are rooted at `apps/api`, so modules are `services.orchestrator.src.main` and friends. The orchestrator image sets `PYTHONPATH=/app`.

## The core rule: fakes, not the network, not a real database

`apps/api/services/orchestrator/tests/conftest.py` builds the **real app** on top of **fake infrastructure**. That is the pattern. Do not reach for a live PostgreSQL, a live Redis, or a live provider.

The `api` fixture gives you an `ApiContext` with everything you need:

| Field         | What it is                                                        |
| ------------- | ----------------------------------------------------------------- |
| `client`      | `httpx.AsyncClient` over `ASGITransport`, base URL `http://test`  |
| `settings`    | the `Settings` object the app is running with, mutable in a test  |
| `database`    | `FakeDatabase`, in-memory rows for users, sessions, usage         |
| `redis`       | `FakeRedis`, the handful of commands the `Coordinator` uses, with real expiry |
| `coordinator` | the real `Coordinator` over `FakeRedis`                           |
| `liveavatar`  | `FakeLiveAvatarClient`, records calls, never reaches the network  |
| `sender`      | `RecordingOtpSender`, keeps every code it was asked to send       |

`ApiContext.login(phone, platform=...)` walks the whole login flow and returns the bearer token a native client would get. Use it instead of re-typing the OTP dance.

### Settings isolation is automatic, and load-bearing

`isolate_settings_from_environment` is `autouse`. It deletes every `Settings` variable from the process environment for the duration of the test. CI runs pytest inside the container with `.env.example` loaded as real environment variables, and a developer may have a real `.env` exported. Either would silently change which code path a test exercises.

`build_settings(**overrides)` is how a test gets different settings. It passes `_env_file=None`, so a developer's real `.env` can never leak in.

```python
settings = build_settings(app_env="production", assistant_rate_limit_per_hour=1)
```

To change one value for an already-running app, write it on `api.settings`:

```python
api.settings.app_env = "production"
```

## Pick the test type

### 1. Endpoint test (the default for anything under `src/`)

Use the `api` fixture and drive the real HTTP surface.

```python
import pytest

PHONE = "09123456789"
E164 = "+989123456789"


@pytest.mark.asyncio
async def test_a_code_request_normalizes_the_phone_and_answers_with_the_limits(api):
    response = await api.client.post("/auth/otp/request", json={"phone": PHONE})

    assert response.status_code == 202
    body = response.json()
    assert body["phone"] == E164
    assert body["resendAfterSeconds"] == 60
```

**Request the bare path, not `/api/...`.** The frontend calls `/api/auth/otp/verify`; nginx
strips that prefix (`infra/nginx/default.conf`) and no router here sets one. A test that asks
for `/api/auth/...` gets a 404.

Assert on the **wire shape**, not on internals: status code, the camelCase field names the frontend parses, and the error body. The orchestrator's error shape is `{ "error": { code, message, retryable, details }, "correlation_id" }`.

### 2. Unit test for a pure helper

`normalize_phone`, `mask_phone`, the media probe, the PCM checks, the cache key. No fixture, no app, just the function.

```python
from services.orchestrator.src.auth.phone import normalize_phone


def test_a_local_iranian_number_becomes_e164():
    assert normalize_phone("09123456789") == "+989123456789"
```

### 3. Service-client test (`liveavatar`, `elevenlabs`)

These talk to an HTTP provider. Stub the transport with `httpx.MockTransport` or the fake already in that service's tests. **Never let a unit test reach the network.**

### 4. Provider integration test (opt-in, spends credits)

`apps/api/services/orchestrator/tests/integration/provider/` holds the tests that hit a real provider. They are guarded twice: the `provider` marker, and the environment (`REAL_PROVIDER_TESTS`, `CONFIRM_CREDIT_USAGE`). CI never sets either, and `.env.example` carries placeholder keys, so CI never spends credit.

That folder has its own `conftest.py` which **shadows** `isolate_settings_from_environment` with a no-op. It has to: `real_provider_tests` is itself a `Settings` field, so the parent fixture stripped the opt-in flag and every test in the folder skipped itself, including the guard that proves the opt-in works. Do not "fix" that shadowing.

Only add a test here when there is no other way to prove the behaviour, and say in the docstring what it costs.

## What to cover

Every new endpoint or behaviour needs the happy path **and** the refusals:

- **Auth**: anonymous (`401`), signed in but wrong role (`403`), a disabled account (`403 account_disabled`), a stale token (`401`, never silently anonymous).
- **Validation**: a missing field, a value out of range, a malformed phone. FastAPI answers `422`; the exception handler converts it to the repo's error shape.
- **Limits**: the resend guard, the hourly caps, the wrong-code lockout. `FakeRedis` has real expiry behaviour, and a test can drop a key directly to reach the next limit:

  ```python
  await api.redis.delete(f"once:otp:resend:{phone}")
  ```

- **Environment-dependent behaviour**: `devCode` appears only with `app_env="development"` and `OTP_DELIVERY=console`. Assert both the present and the absent case.
- **Pagination**: page, page size, the clamp, and the total.
- **Logging**: that a secret, a code, or an unmasked phone does **not** reach the log. `caplog` plus an assertion on absence.

A security change tests the denied path, not only the allowed one. That is not optional here.

## Style

- One behaviour per test. The name says the behaviour in a sentence: `test_the_answer_carries_no_code_outside_development`.
- Plain `def`/`async def` with bare `assert`. No `unittest.TestCase`, no `describe`/`it`.
- Shared fakes belong in the service's `conftest.py`. A second fake database in a test file is a smell.
- Ruff runs with `select = ["E", "F", "I", "B", "UP", "ASYNC", "S"]` and `line-length = 110`. `S101` (assert) is ignored, so bare asserts are fine. A hard-coded test credential needs `# noqa: S105` with a reason, the way `conftest.py` does it for the public embed key.
- Never delete or skip a failing test to make CI green. Fix the cause or ask.

## Checklist

- Uses the `api` fixture and the existing fakes, not a live service.
- Covers the refusal paths, not only the success path.
- Asserts the wire shape the frontend actually parses.
- New endpoint: the frontend side also gets a mock route in `apps/frontend/src/data/mock/handlers.ts` and `docs/API.md` is updated, in the same PR.
- `docker compose run --rm orchestrator pytest -q` passes.
