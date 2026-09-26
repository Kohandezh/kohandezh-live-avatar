# API

The backend. Python with FastAPI (ADR 0006).

## What is here

```text
services/orchestrator/       FastAPI app, schemas, migrations, LiveKit gateway, media probe
services/orchestrator/src/auth/       phone login: one-time codes, session tokens, guards
services/orchestrator/src/auth/asanak.py  sends the login code by SMS (OTP_DELIVERY=asanak)
services/orchestrator/src/assistant/  assistant session tokens: voice agent (Persian) or FULL persona
services/elevenlabs/         TTS client, PCM validation, deterministic content-addressed cache
services/liveavatar/         LiveAvatar session client, event socket, LITE session manager
```

Imports are rooted at `apps/api`, so modules are `services.orchestrator.src.main` and friends.
The orchestrator image sets `PYTHONPATH=/app` and copies `apps/api/services` to `/app/services`.
It is built and run through the repository-root `docker-compose.yml`, not on its own.

The routes it serves are listed in the root `README.md`. `docs/API.md` describes the starter's
generic contract (auth, pagination, error shape); the avatar routes extend it and use the
enveloped error body described below.

`VITE_API_MOCK=true` still makes the frontend answer the starter's own routes from
`apps/frontend/src/data/mock`. The avatar routes have no mock adapter; their tests use MSW
handlers in `apps/frontend/tests/utils/server.ts`.

## Rules that come from the frontend side

- **Error shape.** The orchestrator returns the enveloped form
  `{ "error": { "code", "message", "retryable", "details" }, "correlation_id" }`. The starter's flat
  form `{ "code", "message", "details"? }` is also accepted. `toApiError` in
  `apps/frontend/src/shared/api/errors.ts` normalizes both, so new endpoints may use either, but
  should stay consistent with the app they belong to. FastAPI's default validation error is
  `{"detail": [...]}` with status `422`, so the exception handler converts it.
- **Sessions.** Web and admin use the HttpOnly cookie `kd_session`. Native sends
  `Authorization: Bearer <token>`. Both carry the same opaque token and resolve to the same
  identity and role check (ADR 0002). See `docs/SECURITY.md`.
- **Authorization.** The frontend guards are UX only. Check the role on every `/api/admin/*` request.
- **Long work.** Answer `202` with a job id and let the client poll. Never hold a request open while
  a model runs.
- **CORS.** Cloud installs need explicit web and admin origins with credentials. On-premise installs
  serve both from one origin and need none.

## Already decided

PostgreSQL 16 for metadata and usage, Redis for locks and short-lived session state, SQL
migrations applied on startup from `services/orchestrator/migrations`. Background jobs run in the
API process, from the `generation_jobs` table, with no queue library and no worker service
(ADR 0015, `services/orchestrator/src/jobs/`). Record any further decision as an ADR under
`docs/DECISIONS/` rather than letting a commit decide by accident.
