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

Login is a phone number plus a one-time code (OTP). There is no password anywhere in the system.

### POST /api/auth/otp/request

Request: `{ "phone": string }`

The backend normalizes the phone to E.164. Iranian local numbers (`09123456789`) become
`+989123456789`. Persian and Arabic digits are accepted. Anything else is `422 validation_error`.

Response `202`:
`{ "phone": "+989123456789", "expiresInSeconds": 120, "resendAfterSeconds": 60, "devCode"?: "123456" }`

- `devCode` is present only when the backend runs with `APP_ENV=development`. It exists so the
  login flow can be finished without an SMS provider. In any other environment the code is
  neither returned nor logged.
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

## Backend requirements

- **Error shape.** FastAPI's default validation error is `{"detail": [...]}` with status `422`.
  The backend must install an exception handler that returns `{ "code", "message", "details"? }`
  instead, or `ApiError` cannot show a useful message.
- **Job endpoints.** Anything slower than a few seconds follows the `202` plus job-id rule above.
- **Uploads.** Enforce a maximum file size and an allowlist of content types on the server.

## Rules

- Frontend depends on public API contracts, not backend implementation details.
- All API calls pass through `src/shared/api/client.ts`.
- The backend must enforce the admin role on `/api/admin/*`. The frontend guard is UX only.
- CORS must list the web, admin and widget origins explicitly and allow credentials
  (`CORS_ALLOWED_ORIGINS` plus `ASSISTANT_EMBED_ALLOWED_ORIGINS`).

## Phase 1 workbench endpoints

`/tts/*`, `/avatar/*`, `/assets/*`, `/usage` and `/ws/status` belong to the Phase 1 LITE mode
workbench. They use snake_case bodies and are not part of the contract above. See
`apps/api/README.md`.
