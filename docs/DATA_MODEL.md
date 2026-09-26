# DATA MODEL

This document describes frontend-facing domain models.
`apps/api` owns the database schema and migrations (ADR 0006).
Once ADR 0007 is accepted, these schemas are generated from the backend's OpenAPI document
instead of being written by hand.
Each model has a Zod schema in `apps/frontend/src/entities/<name>/types.ts`; the TypeScript type is inferred from it.

## User (`src/entities/user`)

Login identity is the phone number (E.164, for example `+989121234567`), not email. Email is
optional profile data and is `null` until the user sets one; today it is only ever the value the
backend returned at account creation.

| Field       | Type                       | Notes                                          |
| ----------- | -------------------------- | ----------------------------------------------- |
| `id`        | string                     |                                                  |
| `phone`     | string                     | E.164. The login identity.                      |
| `firstName` | string                     | Empty until the user completes onboarding.      |
| `lastName`  | string                     | Empty until the user completes onboarding.      |
| `email`     | string \| null             | Optional. `getFullName` falls back to `phone`.  |
| `birthDate` | string \| null             | Optional. Gregorian `YYYY-MM-DD`, shown as Jalali. |
| `role`      | `"user"` \| `"admin"`      | Backend decides. UI reads only.                 |
| `status`    | `"active"` \| `"disabled"` |                                                  |
| `createdAt` | string (ISO 8601)          | Formatted with `Intl` in the UI.                |

`birthDate` is collected on onboarding step 1, next to the name, and stays editable on
`/settings/personal`. It is optional: a user who declines it still finishes onboarding. The
field is stored and sent as a Gregorian day; the Jalali calendar exists only in the UI, and
`src/features/profile/jalali.ts` is the single place that converts between the two.

An empty `firstName` is the signal that onboarding is not done. There is no separate "new user"
flag: `firstName === ''` is true for every fresh account by construction, and `PUT /api/me/profile`
requires both names, so it is false from then on.

- Endpoints: `GET /api/me`, `PUT /api/me/profile`, `GET /api/admin/users`,
  `POST /api/auth/otp/request`, `POST /api/auth/otp/verify` (see `docs/API.md`)
- Query keys: `['user', 'me']`, `['user', 'list', params]`
- Hooks: `useCurrentUser()`, `useUpdateProfile()`, `useUsers(params)`, `useRequestOtp()`,
  `useVerifyOtp()` (the last two in `src/features/authentication`)
- Mutations that touch it: OTP verify and profile update (`setQueryData` on `me`), logout (clears
  the cache)
- Permissions: `me` and `me/profile` need a session; the list needs the admin role

### User in the backend (`users` table)

Created by `apps/api/services/orchestrator/migrations/002_assistant.sql`. The first successful
one-time code check creates the row. There is no password column: the phone plus the code is the
only credential.

| Column                    | Type        | Notes                                                |
| ------------------------- | ----------- | ---------------------------------------------------- |
| `id`                      | uuid        | primary key                                           |
| `phone`                   | text        | unique, E.164 (`+989123456789`)                       |
| `first_name`, `last_name` | text        | empty strings until the user completes onboarding    |
| `email`                   | text (null) | not collected at login                                |
| `birth_date`              | date (null) | optional. `DATE`, not a timestamp: a birthday is a day |
| `role`                    | text        | `user` or `admin`. `ADMIN_PHONES` promotes at login.  |
| `status`                  | text        | `active` or `disabled`. Disabled blocks login and API. |
| `created_at`, `updated_at`| timestamptz |                                                       |

`birth_date` is added by `migrations/003_birth_date.sql`.

The API returns an explicit allowlist of these columns as `User`
(`id`, `phone`, `firstName`, `lastName`, `email`, `birthDate`, `role`, `status`, `createdAt`).
Nothing else leaves the backend.

## DashboardSummary (`src/entities/dashboard`)

| Field              | Type    |
| ------------------ | ------- |
| `totalUsers`       | integer |
| `activeUsers`      | integer |
| `disabledUsers`    | integer |
| `newUsersThisWeek` | integer |

- Endpoint: `GET /api/admin/dashboard`
- Query key: `['dashboard', 'summary']`
- Hook: `useDashboardSummary()`
- Permissions: admin role

## AssistantSession (`src/entities/assistant-session`)

One real-time conversation with the LiveAvatar assistant. The backend mints the provider token
with its own API key; the browser drives the session with the official SDK.

| Field                       | Type              | Notes                                                     |
| --------------------------- | ----------------- | --------------------------------------------------------- |
| `id`                        | string (uuid)     | Our session row. Used to close the session.                |
| `sessionToken`              | string            | Provider credential. See the rule below.                   |
| `providerSessionId`         | string            | LiveAvatar's own session id, for support and logs.          |
| `sandbox`                   | boolean           | Server-side decision. The client cannot turn it off.        |
| `avatarId`                  | string            | Public avatar in sandbox, the custom avatar in production.  |
| `language`                  | `"fa"` \| `"en"`  | Language the session actually started in.                   |
| `requestedLanguage`         | `"fa"` \| `"en"`  | Language the caller asked for. See the note below.           |
| `maxSessionDurationSeconds` | integer           | About 60 in sandbox. Drives the countdown in the UI.        |
| `agentType`                 | `"elevenlabs"` \| `"full"` | Which SDK session class drives the token.        |

`sessionToken` is handed to the SDK session once, inside the feature hook, and never goes into
Redux, storage, a URL, or a log. `toAssistantSessionInfo()` strips it before anything else sees
the session.

`agentType` follows the backend's provider mode (see `docs/API.md`):

- `elevenlabs`: a LiveAvatar Voice Agent wrapping the customer's ElevenLabs agent. The hook uses
  `ElevenLabsAgentSession`, transcripts arrive as `elevenlabs_agent_event`, and a typed turn goes
  out with `sendUserMessage()`. This is the only path that speaks Persian today.
- `full`: FULL mode with a LiveAvatar context. The hook uses `LiveAvatarSession`, transcripts
  arrive as `user.transcription` / `avatar.transcription`, and a typed turn goes out with
  `message()`.

`language` and `requestedLanguage` differ for two reasons. In the `elevenlabs` mode `language` is
always the agent's own language, because LiveAvatar rejects a per-session language override for
that agent type. In the `full` mode they differ when FULL mode cannot start a session in the
requested language. Verified against the real provider on 2026-09-11: LiveAvatar FULL mode accepts
Persian (`"fa"`) when the token is minted, but rejects it at session start, because none of its STT
providers or its ElevenLabs TTS model support Persian yet. The backend falls back to a supported
language (`LIVEAVATAR_ASSISTANT_LANGUAGES`, default `en`); `AssistantPanel` shows an inline notice
when that fallback happened.

- Endpoints: `POST /api/assistant/session`, `POST /api/assistant/session/{id}/close`,
  `POST /api/assistant/session/{id}/answers`
- Functions: `createAssistantSession(body)`, `closeAssistantSession(id)`,
  `reportAssistantAnswers(id, body)` (parsed with `assistantAnswersReportSchema`)
- No query hook: a session is created by a user action and must never be cached or replayed,
  so the feature hook (`useAssistantSession`) owns it instead of TanStack Query. The same hook
  owns the answer reports: it measures each avatar speech segment and sends it, before `close`.
- Permissions: a signed-in user, or the website widget with a valid `X-Embed-Key` and origin

### Provider usage in the backend (`provider_usage` table)

Created by `apps/api/services/orchestrator/migrations/001_initial.sql`. One row per provider event
we want to count. The frontend never reads it; `GET /usage` sums it per provider and operation.

| Column                  | Type           | Notes                                                          |
| ----------------------- | -------------- | -------------------------------------------------------------- |
| `id`                    | uuid           | primary key                                                    |
| `provider`              | text           | `liveavatar` on every assistant row                            |
| `operation`             | text           | what happened. The assistant operations are listed below      |
| `provider_resource_id`  | text (null)    | the provider's own id. Assistant rows: LiveAvatar's session id, never our `sessions.id`. Null on a library row |
| `model`                 | text (null)    | null on assistant rows                                         |
| `characters`            | integer (null) | null on assistant rows: no text reaches the backend            |
| `estimated_duration_ms` | bigint (null)  | `assistant_answer`: the answer's length, measured by the browser, or the video's duration on a library row |
| `cache_hit`             | boolean        | default `false`. `true` only on a library row: a recorded answer served instead of a live one |
| `metadata`              | jsonb          | see below. Never any text of a question or an answer          |
| `occurred_at`           | timestamptz    | insert time. For `assistant_answer`: when the report arrived, not when the avatar spoke |

The assistant writes three operations, and the answer library writes a fourth kind of row.
`principal` is `user:<id>` or `embed:<origin>`.

- `assistant_token`: a session was minted (`POST /api/assistant/session`). Metadata: `avatar_id`,
  `sandbox`, `language`, `requested_language`, `provider_mode`, `principal`.
- `assistant_answer`: one avatar answer the browser reported
  (`POST /api/assistant/session/{id}/answers`). Metadata: `principal`, `sandbox`, `provider_mode`,
  `answer_index`, `source` (always `browser`). `docs/API.md` says what the row means and what it
  does not mean.
- `assistant_close`: the session was closed (`POST /api/assistant/session/{id}/close`). Metadata:
  `principal`, `provider_stop`.
- `assistant_answer` with `source: "library"`: a recorded answer was delivered
  (`GET /api/library/answers/{id}/video`, `200` only). `cache_hit` is `true`,
  `estimated_duration_ms` is the video's duration, `provider_resource_id`, `model` and `characters`
  are null. Metadata is exactly `library_entry_id` and `source`. There is no user id, principal or
  session id on purpose: every entry is a health question, and a row that joined a person to an
  entry would record which person chose which topic. So `GET /usage` counts cache hits per answer,
  never per person. The row counts a delivered file, not a watched one.

### Asset review in the backend (`asset_reviews` table)

Created by `apps/api/services/orchestrator/migrations/004_asset_reviews.sql`. One row per accepted
review decision on a recorded asset (ADR 0014, item 5). `PATCH /api/assets/{kind}/{id}/status`
writes it in the same transaction as the status change, so there is never a decision without its
row. Publishing a library entry (approval) and rejecting its video write the same row, with the
same statement, inside the library's own transaction. A refused decision writes nothing. The
frontend never reads it.

| Column             | Type        | Notes                                                              |
| ------------------ | ----------- | ------------------------------------------------------------------ |
| `id`               | uuid        | primary key                                                        |
| `asset_kind`       | text        | `audio` or `video`                                                 |
| `asset_id`         | uuid        | `audio_assets.id` or `video_assets.id`, by `asset_kind`. No foreign key |
| `reviewer_user_id` | uuid        | the admin who decided. References `users(id)`                      |
| `decision`         | text        | the new status: `AUDIO_APPROVED`, `VIDEO_APPROVED` or `REJECTED`   |
| `previous_status`  | text        | the status the decision replaced                                   |
| `created_at`       | timestamptz | when the decision was made                                         |

No asset text and no phone number. The index on `(asset_kind, asset_id)` serves the history of one
asset. The allowed transitions are in `docs/API.md`.

### Background jobs in the backend (`generation_jobs` table)

Created by `001_initial.sql`, with the runner columns from `005_generation_jobs_runner.sql`
(ADR 0015). It is the only owner of job state; Redis holds none. The API process runs the jobs
itself, one at a time per process, and `GET /api/jobs/{jobId}` reads them (`docs/API.md`).

| Column             | Type          | Notes                                                              |
| ------------------ | ------------- | ------------------------------------------------------------------ |
| `id`               | uuid          | primary key, the `jobId` of the API                                |
| `job_type`         | text          | see the job types below                                            |
| `dedupe_key`       | text          | at most one `queued` or `running` job per key (unique partial index) |
| `status`           | text          | `queued`, `running`, `done` or `failed`                            |
| `input`            | jsonb         | ids of the rows the job works on. Never user text                  |
| `output`           | jsonb         | the result of a `done` job, `{}` before that                       |
| `error_code`       | text (null)   | the last failure. Kept when a retry later succeeds                 |
| `error_message`    | text (null)   | a fixed text per `error_code`, never user text or an exception    |
| `attempt_count`    | integer       | claims for real work so far. A job that waits does not count      |
| `max_attempts`     | integer       | the retry limit, set per job type at enqueue                       |
| `run_after`        | timestamptz   | when the job is next due: now, a retry backoff, or a schedule      |
| `lease_expires_at` | timestamptz (null) | a `running` job past its lease lost its worker and is claimed again |
| `worker_id`        | text (null)   | the process that claimed the job last: host name plus a per-boot id |
| `created_by`       | uuid (null)   | the user who asked for the job. References `users(id)`. Null for a system job |
| `created_at`       | timestamptz   | enqueue time                                                       |
| `started_at`       | timestamptz (null) | the last claim                                                |
| `completed_at`     | timestamptz (null) | when the job became `done` or `failed`                         |
| `updated_at`       | timestamptz   | last change                                                        |

A job moves `queued` to `running` when a worker claims it, and then to `done`, to `failed`, or
back to `queued` (a retry, or a job that waits). An attempt is counted at each claim. A failure
whose error is retryable goes back to `queued` with a later `run_after`, unless it was the last
attempt. Any other failure is `failed` at once. A `running` job whose lease ran out is claimed
again, or fails with `worker_lost` when its lost attempt was the last one.

Job types:

| `job_type`        | `max_attempts` | What it does                                                 |
| ----------------- | -------------- | ------------------------------------------------------------ |
| `finalize_video`  | 3              | Enqueued by `POST /api/assets/video/{id}/finalize` with `dedupe_key` `finalize_video:<asset id>` and `input` `{ "asset_id" }`. When Egress has stopped, the job is made due and `input` gains `file_wait_from` (ISO time), where the wait for the MP4 starts. Waits for the MP4, then probes it and moves the asset from `DRAFT` to `VIDEO_GENERATED` in the transaction that marks the job done. `output` is the finalize result (`docs/API.md`) |
| `retention_sweep` | 1              | Daily. Deletes `done` jobs finished more than 30 days ago. Never deletes a `failed` job. `created_by` is null. The next run is enqueued one day ahead when the current one closes, whatever its outcome |

Failed jobs are kept with no end date, and each holds the `created_by` user id. A user deletion
must also clear that column on their failed jobs (ADR 0015, consequences).

## LibraryEntry (`src/entities/library-entry`)

The answer library: staff questions with an approved spoken answer and, once recorded, a video.
Signed-in users on `mobile` and `web` see only published entries in their language. The widget
never calls a library route. Endpoints and error codes are in `docs/API.md` ("The answer library").

A signed-in user gets `LibrarySuggestion` and nothing else of an entry:

| Field        | Type    | Notes                                   |
| ------------ | ------- | --------------------------------------- |
| `id`         | string  | the entry id, for the video and the follow-ups |
| `question`   | string  | the button label                        |
| `answerText` | string  | the caption: the text the video speaks  |
| `durationMs` | integer | the video's length                      |

The schema is strict (`z.strictObject`): a response with any other field fails to parse, because
the backend promises exactly these four.

An admin gets `AdminLibraryEntry`, every column below that the admin screens need, plus the video's
`videoStatus` and `durationMs` (field list in `docs/API.md`), and `LibraryRecording` for a finished
recording no entry uses yet (`videoAssetId`, `answerText`, `durationMs`, `createdAt`).

- Endpoints: `GET /api/library/suggestions`, `GET /api/library/answers/{id}/video`,
  `GET /api/library/answers/{id}/follow-ups`, and `/api/admin/library/entries`,
  `/api/admin/library/entries/{id}`, `/api/admin/library/entries/{id}/status`,
  `/api/admin/library/recordings`
- Functions: `getLibrarySuggestions`, `fetchLibraryVideo` (a `Blob`, `responseType: 'blob'`, 60 s
  timeout, an `AbortSignal`), `getLibraryFollowUps`, `listLibraryEntries`, `createLibraryEntry`,
  `updateLibraryEntry`, `changeLibraryEntryStatus`, `listLibraryRecordings`
- Query keys: `['library-entry', 'suggestions', language]`, `['library-entry', 'follow-ups', id]`,
  `['library-entry', 'list', params]`, `['library-entry', 'recordings', params]`
- Hooks: `useLibrarySuggestions(language, { enabled })`, `useLibraryFollowUps(id)`,
  `useLibraryEntries(params)`, `useLibraryRecordings(params)`, and the mutations
  `useCreateLibraryEntry()`, `useUpdateLibraryEntry()`, `useChangeLibraryEntryStatus()`, which
  refetch everything under `['library-entry']`
- The video blob is never put in the query cache. The screen that plays it owns it.
- Permissions: the three user routes need a signed-in user (the embed key gets `401`); the rest
  need the admin role

### The answer library in the backend (`library_entries`, `library_entry_reviews` tables)

Created by `apps/api/services/orchestrator/migrations/006_library_entries.sql`. Additive: two new
tables, no change to an existing one.

`library_entries`, one row per question:

| Column             | Type               | Notes                                                              |
| ------------------ | ------------------ | ------------------------------------------------------------------ |
| `id`               | uuid               | primary key                                                        |
| `key`              | text               | unique, `^[A-Za-z0-9_-]{1,80}$`, the sheet's key such as `C18Q05`  |
| `question`         | text               | staff text, 1 to 300 characters                                    |
| `answer_text`      | text (null)        | the approved spoken text, 1 to 480 characters, whitespace collapsed. Null only in `pending` (and in a `withdrawn` entry that left from `pending`) |
| `answer_original`  | text (null)        | the original answer before the rewrite, 1 to 5000 characters. Admin only |
| `language`         | text               | `fa` or `en`. A user sees only their app language                  |
| `category`         | text               | the sheet's category number as text                                |
| `category_title`   | text               |                                                                    |
| `section_type`     | text               | `knowledge`, `identity`, `sizing`, `meeting`, `commercial`, `casual`. Gives the funnel stage |
| `technical`        | text               | `technical`, `non-technical`, `classify`. Admin metadata only      |
| `import_metadata`  | jsonb              | from the import (`batch`, `bridge_type`, `section`). Never shown to users |
| `video_asset_id`   | uuid (null)        | unique, references `video_assets(id)`. Null in `pending` and `ready`, set in `draft` and `published` |
| `status`           | text               | `pending`, `ready`, `draft`, `published`, `withdrawn`              |
| `position`         | integer            | display order: the last position plus one at creation              |
| `created_by`       | uuid (null)        | the admin, references `users(id)`. Null for the import             |
| `created_at`, `updated_at` | timestamptz |                                                                    |
| `published_at`, `withdrawn_at` | timestamptz (null) | the last change of each kind                          |

Two checks tie the columns to the status: no video before `draft`, a video in `draft` and
`published`, either in `withdrawn`; and an answer text in `ready`, `draft` and `published`. The
indexes `(language, status, position)` and `(category, section_type, status)` serve the
suggestions and the follow-ups.

`library_entry_reviews`, one row per status change (ADR 0014, item 5). Append-only: nothing
updates or deletes a row.

| Column           | Type        | Notes                                                                |
| ---------------- | ----------- | -------------------------------------------------------------------- |
| `id`             | uuid        | primary key                                                          |
| `entry_id`       | uuid        | references `library_entries(id)`                                    |
| `reviewer_id`    | uuid (null) | the admin, references `users(id)`. Null when the import attached a video |
| `decision`       | text        | `ready`, `reopened`, `video_attached`, `video_rejected`, `published`, `unpublished`, `withdrawn` |
| `video_asset_id` | uuid (null) | the video of `video_attached` and `video_rejected`. No foreign key, so it outlives the video |
| `created_at`     | timestamptz | the time of the insert (`clock_timestamp()`), not of the transaction start |

No text column. The transitions and the decision each one writes are in `docs/API.md`
(`PATCH /api/admin/library/entries/{id}/status`). The status change and its review row are one
transaction, and the change is guarded by the current status, so two changes at once leave exactly
one. `created_at`, `published_at` and `withdrawn_at` are the time of the statement, not of the
transaction start, so a change that waited for the entry's row lock sorts after the change it
waited for.

The library reads these `video_assets` columns (created by `001_initial.sql`): `id`, `external_id`
(unique; the MP4 is `<external_id>.mp4`), `text` (what the avatar says, compared with
`answer_text` after whitespace normalization), `video_path` (absolute path of the MP4),
`duration_ms`, and `status`: `DRAFT` while recording, `VIDEO_GENERATED` once the file is probed,
`VIDEO_APPROVED` after review, `REJECTED`. An entry never uses `video_assets.status` for its own
state: the question's review and the media's render are two lifecycles.

## Adding a model

1. Create `src/entities/<name>/types.ts` with a Zod schema and inferred type.
2. Add `api.ts` (calls through `apiClient`, parses with the schema).
3. Add `hooks.ts` with a `keys` object and TanStack Query hooks.
4. Document it here and in `docs/API.md`.
5. Add the routes to `src/data/mock/handlers.ts` so the mock keeps working.

Do not duplicate the entire backend database schema in the frontend.
