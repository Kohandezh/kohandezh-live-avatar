# API

The frontend talks to an external backend through one axios client: `src/shared/api/client.ts`.
The mock in `src/data/mock` implements the same contract for local development.

The backend is `apps/api/` (Python / FastAPI, ADR 0006, ADR 0008). This document is the written
contract between the two apps. Any backend that implements it works with this frontend.

## Conventions

- JSON request and response bodies, camelCase field names.
- Errors return `{ "error": { "code": string, "message": string, "retryable": boolean, "details"?: unknown }, "correlation_id": string }`.
  The client turns them into `ApiError` (`src/shared/api/errors.ts`), which also accepts the flat
  `{ "code", "message", "details"? }` shape.
- Lists are paginated: `{ "items": T[], "total": number, "page": number, "pageSize": number }`. `page` starts at 1.
- Web sends cookies (`withCredentials: true`). Native sends `Authorization: Bearer <token>`.
- The frontend sends `X-Client-Platform: web | native`. The backend uses it to decide between a
  cookie and a token when a session is created.
- Responses are validated with Zod in the entity that owns them.
- Long operations answer `202 Accepted` with `{ "jobId": string }`. The frontend then polls
  `GET /api/jobs/{jobId}`, which returns `{ "status": "queued" | "running" | "done" | "failed", "result"?: unknown, "error"?: { "code": string, "message": string } }`.
  Never hold a request open while a model runs.
- Streaming answers use Server-Sent Events (`text/event-stream`), not WebSockets, so the same
  code works through a normal reverse proxy.
- `/avatar/speak` only uses ElevenLabs' speech WebSocket, so its `ProviderError` codes are
  `configuration_error`, `elevenlabs_timeout`, `elevenlabs_stream_error`, and `elevenlabs_payment`.
  `elevenlabs_payment` (the ElevenLabs plan is not paid) is raised, on either WebSocket path, for
  any of: an error message with `error: "payment_issue"`, an error message with `code: 1008`
  (covers `ivc_not_permitted` on a pay-as-you-go plan too), or the socket closed with close code
  `1008`. It is `502`, not retryable, with a fixed English message; the provider's own text is
  never logged or returned.

## Endpoints used by the frontend

| Method | Path                                  | Access      | Used by                       |
| ------ | ------------------------------------- | ----------- | ----------------------------- |
| POST   | `/api/auth/otp/request`               | Public      | `features/authentication`     |
| POST   | `/api/auth/otp/verify`                | Public      | `features/authentication`     |
| POST   | `/api/auth/logout`                    | Auth        | `features/authentication`     |
| GET    | `/api/me`                             | Auth        | `entities/user` (session)     |
| PUT    | `/api/me/profile`                     | Auth        | `entities/user` (onboarding)  |
| GET    | `/api/admin/users`                    | Admin       | `entities/user` (admin table) |
| GET    | `/api/admin/dashboard`                | Admin       | `entities/dashboard`          |
| POST   | `/api/assistant/session`              | Auth or key | `entities/assistant-session`  |
| POST   | `/api/assistant/session/{id}/close`   | Auth or key | `entities/assistant-session`  |
| POST   | `/api/assistant/session/{id}/answers` | Auth or key | `entities/assistant-session`  |
| GET    | `/api/jobs/{jobId}`                   | Auth        | `entities/job` (recording)    |

Login is a phone number plus a one-time code (OTP). There is no password anywhere in the system.

### POST /api/auth/otp/request

Request: `{ "phone": string }`

The backend normalizes the phone to E.164. Iranian local numbers (`09123456789`) become
`+989123456789`. Persian and Arabic digits are accepted. Anything else is `422 validation_error`.

Response `202`:
`{ "phone": "+989123456789", "expiresInSeconds": 120, "resendAfterSeconds": 60, "devCode"?: "123456" }`

- `devCode` is present only when the backend runs with `APP_ENV=development` **and**
  `OTP_DELIVERY=console`. It exists so the login flow can be finished when no SMS is sent. As
  soon as delivery is switched to `asanak` the code is in the message, so it is left out of the
  response rather than printed on the login screen. In production it is never returned or logged.
- `429 otp_rate_limited` with `details: { "retryAfterSeconds": n }`. The limits are one code per
  minute and five codes per hour for one phone, and twenty codes per hour for one IP address.
- `502 otp_delivery_failed` when the SMS provider does not accept the message
  (`OTP_DELIVERY=asanak`). `retryable` is `true` for a provider timeout or a provider 5xx, and
  `false` for anything the provider rejected, such as a bad destination or an expired password.
  The message never carries the code or the provider credentials; the provider status code is in
  the backend log, not in the response.

### POST /api/auth/otp/verify

Request: `{ "phone": string, "code": string }`. Header: `X-Client-Platform: web | native`.

Response `200`: `{ "user": User, "accessToken"?: string }`

- Web: the backend sets the HttpOnly cookie `kd_session` (`SameSite=Lax`, `Secure` outside
  development, `Path=/`, 30 days). The body has no `accessToken` at all.
- Native: no cookie. `accessToken` holds the same opaque token; the app stores it in secure storage.
- The first successful check creates the user with `role: "user"` and `status: "active"`.
- Errors: `401 invalid_code`, `429 otp_locked` with `retryAfterSeconds` after five wrong codes
  (the code is destroyed as well), `410 otp_expired` when no code is pending, `403 account_disabled`.

### POST /api/auth/logout

Response `204`. Works with the cookie or with the bearer token. The token stops working at once.

### GET /api/me

Response: `User`. `401` when there is no session. The frontend treats `401` here as "anonymous", not as an error.
`403 account_disabled` when the account was turned off after the session was created.

### PUT /api/me/profile

Request: `{ "firstName": string, "lastName": string, "birthDate": string | null }`. Full replace,
not a partial patch. Both names are required on every call. `birthDate` is optional, but the
replace covers it too: sending `null`, or leaving the field out, clears a birthday saved before.
Clients send all three fields.

`birthDate` is a Gregorian calendar day, `YYYY-MM-DD`, with no time and no time zone. The app
collects and shows it in the Jalali (Solar Hijri) calendar and converts at the edge
(`apps/frontend/src/features/profile/jalali.ts`); the wire format is always Gregorian.

Response `200`: `User`. `401` when there is no session. `403 account_disabled` when the account
was turned off. `422 validation_error` when a name is blank after trimming or longer than 100
characters, or when `birthDate` is not a real day between `1900-01-01` and today.

The frontend uses the returned `firstName` to decide whether first-run onboarding is finished.
There is no separate "new user" flag.

### GET /api/admin/users

Query: `q?` (matches phone, first name, last name, email), `page?` (default 1), `pageSize?` (default 10, max 100).

Response: `Paginated<User>`. `401` without a session, `403` for non-admin users.

### GET /api/admin/dashboard

Response: `DashboardSummary`. `401` without a session, `403` for non-admin users.

### POST /api/assistant/session

Starts a LiveAvatar conversation. The backend mints the session token with the server API key;
the browser drives the session with the official SDK.

There are two provider modes and the backend configuration picks one. The client never chooses.

| Provider mode | Configuration | `agentType` | SDK class | Persian |
| --- | --- | --- | --- | --- |
| Voice agent | `LIVEAVATAR_VOICE_AGENT_ID` is set (default) | `elevenlabs` | `ElevenLabsAgentSession` | yes |
| Persona (FULL) | only `LIVEAVATAR_CONTEXT_ID` is set | `full` | `LiveAvatarSession` | no |

The voice agent is a stored LiveAvatar Voice Agent that wraps the customer's ElevenLabs agent. It
carries the Persian speech recognition, the prompt and the cloned voice, so it is the only path
that speaks Persian today. Its conversation minutes are billed by ElevenLabs, separately from
LiveAvatar, so never start a session without a user action.

Auth, one of:

- a signed in user (cookie or bearer), or
- the website widget: header `X-Embed-Key: <key>` and an `Origin` that is in the backend's embed
  allowlist. A key that does not match is `401 unauthorized`; an origin that is not allowed is
  `403 embed_origin_not_allowed`.

Request: `{ "language"?: "fa" | "en" }` (default: the backend's configured language).

Response `200`:

```json
{
  "id": "uuid",
  "sessionToken": "provider token for the browser SDK",
  "providerSessionId": "string",
  "sandbox": true,
  "avatarId": "uuid",
  "language": "fa",
  "requestedLanguage": "fa",
  "maxSessionDurationSeconds": 60,
  "agentType": "elevenlabs"
}
```

- `sessionToken` is a credential. Never put it in Redux, `localStorage`, a URL, or a log.
- While sandbox is on, the backend always uses the public sandbox avatar and clamps the duration
  to 60 seconds. The client cannot turn sandbox off.
- `agentType` says which SDK class can drive `sessionToken`: `elevenlabs` needs
  `ElevenLabsAgentSession`, `full` needs `LiveAvatarSession`. The token itself also carries this
  (`parseAgentTypeFromToken`), so the frontend can check both.
- `language` is the language the session actually started in. `requestedLanguage` is what the
  caller asked for (or the backend's configured default, when the caller did not send one).
  In the voice agent mode `language` is always the agent's own language
  (`LIVEAVATAR_VOICE_AGENT_LANGUAGE`, `fa`) and the request's `language` is ignored: LiveAvatar
  rejects a per-session language override for this agent type. `requestedLanguage` still echoes
  what the caller asked for.
  In the persona mode the two differ when FULL mode cannot start a session in the requested
  language: verified against the
  real provider on 2026-09-11, LiveAvatar FULL mode accepts `avatar_persona.language: "fa"` when
  the token is minted, but rejects it at session start ("Language not supported"), because none of
  its STT providers or its ElevenLabs TTS model support Persian yet. `LIVEAVATAR_ASSISTANT_LANGUAGES`
  (default `en`) lists the languages the backend is allowed to actually start a session in; a
  requested language outside that list falls back to the backend's configured preferred language,
  or to the first supported language if that is not supported either. The client should show the
  fallback to the user rather than silently proceed as if Persian was used.
- `429 assistant_rate_limited` with `retryAfterSeconds` (per user, or per visitor address for the
  widget). `503 configuration_error` when the provider key is missing, or when neither the voice
  agent id nor the context id is set.
  Provider failures keep their codes: `liveavatar_auth`, `liveavatar_quota`, `liveavatar_error`,
  `liveavatar_timeout`.

### POST /api/assistant/session/{id}/close

Same auth. Only the caller that created the session can close it; anybody else gets `404`.

Response `200`: `{ "status": "closed" }`. Closing twice is fine and answers `200` again.

### POST /api/assistant/session/{id}/answers

Same auth. Only the caller that created the session can report for it; anybody else gets `404`.
The browser reports the avatar answers it measured, and the backend writes one `provider_usage`
row per answer (`operation: "assistant_answer"`, see `docs/DATA_MODEL.md`). The backend never
observes an answer itself, so the browser has to report. The endpoint makes no provider call.

Request. The body is closed: any other key, in the body or in an item, is `422`.

```json
{ "answers": [{ "index": 0, "durationMs": 4200 }, { "index": 1, "durationMs": 1800 }] }
```

- `answers`: 1 to 20 items.
- `index`: integer, 0 to 10000. The position of the speech segment in the session, counted by the
  browser. It only exists so a re-sent batch is not counted twice.
- `durationMs`: integer, at least 1 and at most the session's length
  (`maxSessionDurationSeconds` times 1000, so 60000 in sandbox). Never above 3600000.

Response `200`: `{ "recorded": number, "duplicates": number }`. An item whose `index` the session
already reported, or that repeats an earlier item of the same batch, is dropped and counted in
`duplicates`; in a batch the earlier item wins. A duplicate is never an error, so re-sending a
batch is safe.

The batch is written as a whole or not at all. The checks, in the order they run:

- `401 unauthorized`, `403 embed_origin_not_allowed`, `403 account_disabled`: as for creating a
  session.
- `422 validation_error`: the body or the id breaks the rules above. A body that is not JSON at
  all gets this `422` even before the auth check, because the body is decoded first.
- `429 assistant_answers_rate_limited` with `retryAfterSeconds`, `retryable: true`: more than
  `ASSISTANT_ANSWERS_RATE_LIMIT_PER_HOUR` reports (default 600) in the last hour, per user, or per
  visitor address for the widget. This is its own counter. A report never spends one of the
  session creations that `assistant_rate_limited` counts.
- `404 not_found`: the session does not exist, or another caller created it.
- `409 assistant_session_closed`, `retryable: false`: the session was closed, failed to start, or
  is older than its length plus 300 seconds (a tab that dies never calls close).
- `422 validation_error` with `details.limitMs`: one `durationMs` is longer than the session.
- `429 assistant_answers_busy`, `retryAfterSeconds: 2`, `retryable: true`: another report for the
  same session was still being written after 2 seconds. Nothing was written. Sending the same
  batch again is safe: an `index` already stored counts as a duplicate.
- `409 assistant_answers_limit`, `retryable: false`: after the duplicates are dropped, the session
  would hold more than `ASSISTANT_ANSWERS_PER_SESSION_MAX` answers (default 200), or answers longer
  than the session in total. A batch of only duplicates writes nothing and answers `200`.

What an `assistant_answer` row means. It is one avatar speech segment, from
`AVATAR_SPEAK_STARTED` to `AVATAR_SPEAK_ENDED`, measured by the browser clock. The browser asserts
it, and it is best effort: a tab that is killed loses the answers it had not reported yet. The row
is a measurement aid for the response-cache work, not a billing record: `estimated_duration_ms` is
not provider minutes, and the row count is an upper bound on agent turns until it is compared with
the real provider. `occurred_at` is when the report arrived, not when the avatar spoke.
`cache_hit` is always `false` on these rows. No text of the question or the answer is sent or
stored, only the index and the duration (`docs/SECURITY.md` item 13; ADR 0014, still pending,
says the same). Nothing in the app calls this endpoint yet.

### GET /api/jobs/{jobId}

The poll for a long operation (see Conventions). Only the user who started the job, or an admin,
may read it. A job the system started itself (the daily retention sweep) has no user, so only an
admin may read it.

Response `200`, by `status`:

- `{ "status": "queued" }` and `{ "status": "running" }`: not finished. Poll again.
- `{ "status": "done", "result": unknown }`: `result` is the job's output. The operation that
  started the job defines its shape.
- `{ "status": "failed", "error": { "code": string, "message": string } }`: `message` is a fixed
  English text per `code`, never user text and never a server exception. Show a translated text
  by `code`. `worker_lost` means the process running the job stopped on the job's last allowed
  attempt; `internal_error` is an unexpected failure. The operation adds its own codes (the
  finalize job's codes are listed under `POST /api/assets/video/{id}/finalize` below).

A job can go back from `running` to `queued`: when it waits for something, or when a retryable
error is retried later. `done` and `failed` are final. A second request for the same work while
its job is `queued` or `running` gets the same `jobId`.

- `401 unauthorized` without a session. `403 account_disabled` for a disabled account.
- `404 not_found` for an unknown id, and for a job the caller may not read. Both answer the same
  body, so a job id tells nothing about the job.
- `422 validation_error` when the id is not a UUID.

## Backend requirements

- **Error shape.** FastAPI's default validation error is `{"detail": [...]}` with status `422`.
  The backend must install an exception handler that returns `{ "code", "message", "details"? }`
  instead, or `ApiError` cannot show a useful message.
- **Job endpoints.** Anything slower than a few seconds follows the `202` plus job-id rule above.
- **Uploads.** Enforce a maximum file size and an allowlist of content types on the server.

## Rules

- Frontend depends on public API contracts, not backend implementation details.
- All API calls pass through `src/shared/api/client.ts`.
- The backend must enforce the admin role on `/api/admin/*` and on the Phase 1 workbench routes
  below. The frontend guard is UX only.
- CORS must list the web, admin and widget origins explicitly and allow credentials
  (`CORS_ALLOWED_ORIGINS` plus `ASSISTANT_EMBED_ALLOWED_ORIGINS`).

## Phase 1 workbench endpoints

`/tts/*`, `/avatar/*`, `/assets/*`, `/usage` and `/ws/status` belong to the Phase 1 LITE mode
workbench. They use snake_case bodies and are not part of the contract above. See
`apps/api/README.md`.

Every one of these routes except `/ws/status` needs a signed-in admin, the same check as
`/api/admin/*` (`require_admin`). They start paid provider work (ElevenLabs, LiveAvatar, LiveKit
Egress) or serve media that is not published yet. The check runs before the request is validated,
so a refused request never reaches a provider:

- `401 unauthorized` without a session, even when the body or a path value fails validation. A
  body that is not valid JSON still answers `422`, because FastAPI parses the JSON before it runs
  the check.
- `403 forbidden` for a signed-in user whose role is not `admin`.
- `403 account_disabled` for a disabled account.

An admin gets the route's own answer, including its `404`, `409` and `422` errors. `/ws/status`
stays open: it sends only the number of active LITE sessions. The web `/avatar` workbench now
gets `401` or `403` for anyone who is not an admin, because recording moves into the admin target
(ADR 0014, item 7: Option B first).

### PATCH /api/assets/{kind}/{id}/status

Request: `{ "status": "AUDIO_APPROVED" | "VIDEO_APPROVED" | "REJECTED" }`. `kind` is `audio` or
`video`. Response `200`: `{ "id": string, "status": string }`. Each decision needs the asset in
one of these statuses:

| Kind    | Decision         | Allowed from                        |
| ------- | ---------------- | ----------------------------------- |
| `audio` | `AUDIO_APPROVED` | `AUDIO_GENERATED`                   |
| `audio` | `REJECTED`       | `AUDIO_GENERATED`, `AUDIO_APPROVED` |
| `video` | `VIDEO_APPROVED` | `VIDEO_GENERATED`                   |
| `video` | `REJECTED`       | `VIDEO_GENERATED`, `VIDEO_APPROVED` |

- `409 invalid_status_transition` from any other status, with
  `details: { "currentStatus": string }`. The asset does not change. A `DRAFT` video is still
  recording, so it cannot be approved. A rejection is final.
- `404 not_found` for an unknown id.
- `422 validation_error` for another `kind`, or for a status of the other kind.
- The status check is part of the update statement, so two reviews at once cannot both pass it.
  Every accepted decision writes one `asset_reviews` row in the same transaction
  (`docs/DATA_MODEL.md`). A refused decision writes nothing.

### POST /api/assets/video/{id}/finalize

Stops the Egress recording of a video asset and answers at once. No body. A `finalize_video` job
(`docs/DATA_MODEL.md`) then waits for the MP4, probes it and marks the asset `VIDEO_GENERATED`, so
the request is never held open while the file is written (ADR 0015, item 4).

Response `202`: `{ "jobId": string }`. Poll `GET /api/jobs/{jobId}` (the workbench polls every 2
seconds and gives up after 180). A second call while that job is `queued` or `running` answers
`202` with the same `jobId` and does not stop Egress again, also when both calls arrive at once.
After a `failed` job, a new call starts a new job.

The call creates the job first and then stops Egress; the job becomes due only once Egress has
stopped. No database connection is held while LiveKit answers.

- `404 not_found`: unknown id.
- `409 egress_failure`: the asset has no Egress recording.
- `409 invalid_status_transition` with `details: { "currentStatus": string }`: the asset is not
  `DRAFT`. A `REJECTED` video can no longer be turned into `VIDEO_GENERATED` this way.
- `502 egress_failure`, `retryable: true`: LiveKit did not accept the stop. The job this call
  created ends `failed` with `egress_failure` without running, so a new call can start again.
  Exception: when an earlier finalize job of this asset ran, its stop already ended the Egress
  and LiveKit refuses a second stop. That refusal counts as stopped and the new job starts, so a
  late MP4 can still be finalized after a job that failed waiting for it.

The job's `result` once `done` is the asset: `{ "id", "status": "VIDEO_GENERATED", "media_url",
"probe" }`, the fields finalize answered before it became a job. `probe` holds `container`,
`video_codec`, `audio_codec`, `duration_ms`, `width`, `height` and `frame_rate`. The job's `error`
once `failed`:

| `code`                      | Meaning                                                                 |
| --------------------------- | ----------------------------------------------------------------------- |
| `egress_failure`            | The MP4 did not appear within `FINALIZE_FILE_WAIT_SECONDS` (default 30) after Egress stopped. The time the stop call took does not count. Final, not retried |
| `egress_invalid_mp4`        | The file is not an MP4 with H.264 video and audio                       |
| `invalid_status_transition` | The asset stopped being `DRAFT` while the job waited, for example a rejection. The asset keeps that status |
| `not_found`                 | The asset no longer exists                                              |
| `worker_lost`, `internal_error` | As for every job                                                    |

While the file is missing the job goes back to `queued` every 2 seconds, and that wait does not
count as an attempt.
