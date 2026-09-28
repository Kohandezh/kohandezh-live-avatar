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

| Method | Path                                     | Access      | Used by                          |
| ------ | ---------------------------------------- | ----------- | -------------------------------- |
| POST   | `/api/auth/otp/request`                  | Public      | `features/authentication`        |
| POST   | `/api/auth/otp/verify`                   | Public      | `features/authentication`        |
| POST   | `/api/auth/logout`                       | Auth        | `features/authentication`        |
| GET    | `/api/me`                                | Auth        | `entities/user` (session)        |
| PUT    | `/api/me/profile`                        | Auth        | `entities/user` (onboarding)     |
| GET    | `/api/admin/users`                       | Admin       | `entities/user` (admin table)    |
| GET    | `/api/admin/dashboard`                   | Admin       | `entities/dashboard`             |
| POST   | `/api/assistant/session`                 | Auth or key | `entities/assistant-session`     |
| POST   | `/api/assistant/session/{id}/close`      | Auth or key | `entities/assistant-session`     |
| POST   | `/api/assistant/session/{id}/answers`    | Auth or key | `entities/assistant-session`     |
| GET    | `/api/jobs/{jobId}`                      | Auth        | `entities/job` (recording)       |
| GET    | `/api/library/suggestions`               | Auth        | `entities/library-entry`         |
| GET    | `/api/library/answers/{id}/video`        | Auth        | `entities/library-entry`         |
| GET    | `/api/library/answers/{id}/follow-ups`   | Auth        | `entities/library-entry`         |
| GET    | `/api/admin/library/entries`             | Admin       | `entities/library-entry` (admin) |
| POST   | `/api/admin/library/entries`             | Admin       | `entities/library-entry` (admin) |
| PATCH  | `/api/admin/library/entries/{id}`        | Admin       | `entities/library-entry` (admin) |
| PATCH  | `/api/admin/library/entries/{id}/status` | Admin       | `entities/library-entry` (admin) |
| GET    | `/api/admin/library/recordings`          | Admin       | `entities/library-entry` (admin) |

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

The daily retention sweep is a system job, so only an admin reads it. When `done`, its `result` is
`{ "deleted_done_jobs": number, "deleted_withdrawn_media": number, "deleted_rejected_media":
number, "skipped_media": number }`. `skipped_media` counts the library media files the sweep could
not delete (`media_delete_failed`). Each one is logged with its entry id only, keeps its rows, and
is tried again by the next run. A skipped file does not fail the run: the sweep still ends `done`,
so `media_delete_failed` never appears as an `error.code`.

A job can go back from `running` to `queued`: when it waits for something, or when a retryable
error is retried later. `done` and `failed` are final. A second request for the same work while
its job is `queued` or `running` gets the same `jobId`.

- `401 unauthorized` without a session. `403 account_disabled` for a disabled account.
- `404 not_found` for an unknown id, and for a job the caller may not read. Both answer the same
  body, so a job id tells nothing about the job.
- `422 validation_error` when the id is not a UUID.

## The answer library

Staff write a fixed set of questions and approve a recorded video for each one in the `admin`
target. Signed-in users on `mobile` and `web` pick one of them and play its video. Free text never
reaches the library: the library is reached by selection only
(`docs/features/response-caching/SPEC.md`).

An entry has a `status`:

| Status      | Meaning                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `pending`   | Question and answer text only. The answer may still be the original.    |
| `ready`     | An admin approved the spoken text and asked for a video.                |
| `draft`     | A video exists and waits for an admin to review it.                     |
| `published` | Users see it.                                                           |
| `withdrawn` | Final. The entry left the library; its row and its audit rows stay.     |

An entry is **servable**, which means a user may see it, when it is `published`, its video is
`VIDEO_APPROVED`, and the video file exists. The list routes also need the entry's language to be
the requested one. The three user routes use this rule and nothing else.

The user routes need a signed-in user. The widget's embed key is not enough: a request with only
`X-Embed-Key` gets `401`, because the widget plays no library entries until it signs its users in
(ADR 0014, item 3). The admin routes need the admin role: `401` without a session, `403` for anyone
else. No library response or log line carries the text of a question or an answer except the
response bodies below.

### GET /api/library/suggestions

Query: `language` (`fa` or `en`, required), `limit` (1 to 20, default 6). This is a capped list,
not a paged one.

Response `200`: `{ "items": LibrarySuggestion[] }`, where `LibrarySuggestion` is exactly
`{ "id": string, "question": string, "answerText": string, "durationMs": number }`. Nothing else
of an entry reaches a user: no video id, key, category or review data. An empty `items` is normal
(for example an `en` user while only `fa` answers exist).

Order: the funnel stage first (stage 1 before 2 before 3, see the follow-ups below), then the order
the entries were created. An entry whose file is missing is skipped, and the list still fills up to
`limit` from the entries after it.

- `401 unauthorized`, `403 account_disabled`.
- `422 validation_error` for a missing or bad `language`, or a `limit` out of range.

### GET /api/library/answers/{id}/video

Response `200`: the whole MP4 (`video/mp4`, with `Content-Length` and
`Cache-Control: private, no-store`). Fetch it with the shared client as a blob; never put an API
URL in a `<video src>` (ADR 0014, item 6). A `Range` header is ignored: the answer is always the
whole file with `200`, never `206` or `416`, and there is no `Accept-Ranges`.

Each `200` writes one `provider_usage` row once the file is open and before the body is sent: `operation: "assistant_answer"`,
`cache_hit: true`, the video's duration, and metadata `{ library_entry_id, source: "library" }`.
The row has no user id, no principal and no session id (see `docs/DATA_MODEL.md`). It counts a
delivered file, not a watched one.

- `401 unauthorized`, `403 account_disabled`.
- `404 not_found` for an entry that does not exist or is not servable. Both answer the same body.
- `429 library_rate_limited`, `retryable: true`, with `details.retryAfterSeconds` and the same wait
  in the HTTP `Retry-After` header, which CORS exposes to the browser: more than
  `LIBRARY_PLAYBACK_RATE_LIMIT_PER_HOUR` requests (default 60) from one user in the current hour.
  Every request counts, also one that ends in `404`, so an unknown id costs the same as a real one.
- `422 validation_error` when the id is not a UUID.

A response other than `200` writes no usage row.

### GET /api/library/answers/{id}/follow-ups

Up to three servable entries to offer after a played answer. They have the same `category` and the
same language as the played entry, are not the played entry, and sit one funnel stage deeper. The
stage comes from `sectionType`: `identity`, `knowledge` and `casual` are stage 1, `sizing` is stage
2, `meeting` and `commercial` are stage 3. After a stage 3 answer the follow-ups are other stage 3
entries. `technical` never changes the result. Order: creation order.

Response `200`: `{ "items": LibrarySuggestion[] }`, at most 3. An empty `items` is normal. The
request writes no usage row.

- `401 unauthorized`, `403 account_disabled`.
- `404 not_found` when `id` is not servable.

### GET /api/admin/library/entries

Query: `status?`, `language?`, `category?`, `sectionType?`, `technical?` (exact values), `q?`
(part of the key or the question), `page?` (default 1), `pageSize?` (default 10, max 100).

Response `200`: `Paginated<AdminLibraryEntry>`, newest first. `AdminLibraryEntry`:

| Field            | Type               | Notes                                                        |
| ---------------- | ------------------ | ------------------------------------------------------------ |
| `id`             | string (uuid)      |                                                              |
| `key`            | string             | `^[A-Za-z0-9_-]{1,80}$`, unique, for example `C18Q05`        |
| `question`       | string             | 1 to 300 characters                                          |
| `answerText`     | string \| null     | the approved spoken text, 1 to 480 characters. Null in `pending` until written |
| `answerOriginal` | string \| null     | the original answer before the rewrite                       |
| `language`       | `fa` \| `en`       |                                                              |
| `category`       | string             | for example `18`                                             |
| `categoryTitle`  | string             |                                                              |
| `sectionType`    | string             | `knowledge`, `identity`, `sizing`, `meeting`, `commercial`, `casual` |
| `technical`      | string             | `technical`, `non-technical`, `classify`. Admin metadata only |
| `status`         | string             | see the status table above                                   |
| `position`       | integer            | creation order                                               |
| `videoAssetId`   | string \| null     | null in `pending` and `ready`                                |
| `videoStatus`    | string \| null     | the video's status, for example `VIDEO_GENERATED`            |
| `durationMs`     | integer \| null    | the video's duration                                         |
| `createdAt`, `publishedAt`, `withdrawnAt` | string (ISO 8601) | the last two null until that happens     |

`422 validation_error` for a filter value outside its list, or a page out of range.

### POST /api/admin/library/entries

The body is closed: an unknown key is `422`. Two ways in:

- **From text:** `{ "question", "answerText"?, "answerOriginal"?, "language", "category",
  "categoryTitle", "sectionType", "technical", "key" }` creates a `pending` entry. `answerText` is
  stored with its whitespace collapsed to single spaces, and its 480 characters are counted on that
  form.
- **From a recording:** the same fields with `"videoAssetId"` and without `answerText` create a
  `draft` entry. The video must be `VIDEO_GENERATED` with a non-empty file and no entry. Its text
  becomes `answerText`. `key` may be left out; it then defaults to the video's `external_id`.

Response `201`: the `AdminLibraryEntry`, placed after the last entry.

- `404 not_found`: the video does not exist.
- `409 library_video_not_ready`: the video is not `VIDEO_GENERATED`, or its file is missing or empty.
- `409 library_video_in_use`: another entry uses the video.
- `409 library_key_taken`: another entry has the key.
- `422 validation_error`: a bad or missing field, `answerText` together with `videoAssetId`, no
  `key` without a video, or a video whose text is longer than 480 characters.

### PATCH /api/admin/library/entries/{id}

Body: any of `question`, `answerText`, `language`, `category`, `categoryTitle`, `sectionType`,
`technical`, at least one. Only `answerText` may be `null`. The body is closed. Changes no status.

| Status               | Editable                                                             |
| -------------------- | -------------------------------------------------------------------- |
| `pending`            | all seven fields                                                     |
| `ready`, `draft`     | `question`, `category`, `categoryTitle`, `sectionType`, `technical` |
| `published`, `withdrawn` | nothing                                                          |

`answerText` and `language` stay locked after `pending` because the video speaks that text in that
language. To change them, reopen a `ready` entry (`ready` to `pending`). A `published` entry is
unpublished first, so every text users see went through Publish.

Response `200`: the `AdminLibraryEntry`.

- `404 not_found`.
- `409 invalid_status_transition` with `details: { "currentStatus": string }`: a field that is
  locked in the entry's status, or any edit of a `published` or `withdrawn` entry. Nothing changes.
- `422 validation_error`: an empty body, an unknown key, a `null` other than `answerText`, or a
  value out of range.

### PATCH /api/admin/library/entries/{id}/status

Body: `{ "status": string, "videoAssetId"?: string, "fromStatus"?: string }`. Every status change
goes through this one route and this table. Each accepted change writes one `library_entry_reviews`
row in the same transaction (`docs/DATA_MODEL.md`).

| To          | From                                        | What else happens                                                    | Review row       |
| ----------- | ------------------------------------------- | -------------------------------------------------------------------- | ---------------- |
| `ready`     | `pending`                                   | needs an `answerText` of 1 to 480 characters                          | `ready`          |
| `pending`   | `ready`                                     | reopens the text for editing                                          | `reopened`       |
| `draft`     | `ready`                                     | attaches `videoAssetId`: `VIDEO_GENERATED`, a non-empty file, no other entry, and the same text after whitespace normalization | `video_attached` |
| `ready`     | `draft`                                     | rejects the video: the video becomes `REJECTED` with an `asset_reviews` row, and the entry loses it | `video_rejected` |
| `published` | `draft`                                     | the file must exist; a `VIDEO_GENERATED` video is approved with an `asset_reviews` row, a `VIDEO_APPROVED` one is kept | `published` |
| `draft`     | `published`                                 | users stop seeing it; the video stays approved                        | `unpublished`    |
| `withdrawn` | `pending`, `ready`, `draft`, `published`    | final: nothing moves an entry out of `withdrawn`                      | `withdrawn`      |

`pending` to `draft` belongs to the import only; this route refuses it. `videoAssetId` is sent only
to attach a video (`status: "draft"` on a `ready` entry).

`fromStatus` is the status the admin's screen showed. When it is sent, the backend compares it
with the entry's status under the row lock, before anything else, and a different status answers
`409 invalid_status_transition` with `currentStatus`; nothing changes and no review row is written.
Clients should always send it: the target `ready` means "mark ready" from `pending` and "reject the
video" from `draft`, so a stale "Mark ready" without it would reject a video another admin attached
meanwhile. Without `fromStatus` the route behaves as the table says. `fromStatus` is an owner
decision of 2026-09-26 made after `docs/features/response-caching/SPEC.md` §6 was written; that
section does not list it yet.

Response `200`: the `AdminLibraryEntry` after the change.

- `404 not_found`: the entry, or the video to attach, does not exist.
- `409 invalid_status_transition` with `details: { "currentStatus": string }`: a `fromStatus` that
  is not the current status, a pair that is not in the table, or an entry that another request
  moved first. Two changes at once leave exactly one.
- `409 library_video_not_ready`: the video to attach or to publish is not in the right status, or
  its file is missing.
- `409 library_video_in_use`: another entry uses the video to attach.
- `409 library_text_mismatch`: the video does not say the entry's `answerText`.
- `422 validation_error`: an unknown status, `fromStatus` or key, `ready` without an answer text,
  `draft` from `ready` without `videoAssetId`, or `videoAssetId` with any other change.

### GET /api/admin/library/recordings

Query: `page?` (default 1), `pageSize?` (default 10, max 100).

Finished recordings that no entry uses yet: videos with status `VIDEO_GENERATED`, a non-empty file,
and no library entry, newest first. This is how an admin finds a recording again after a reload.

Response `200`: `Paginated<{ "videoAssetId": string, "answerText": string, "durationMs": number,
"createdAt": string }>`. `answerText` is the video's text.

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
stays open: it sends only the number of active LITE sessions. The workbench that calls these
routes is Record answer (`/library/record`) on the admin target; the web `/avatar` page is gone,
because recording moved into the admin target (ADR 0014, item 7: Option B first).

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
