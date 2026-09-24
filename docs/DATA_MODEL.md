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
  so the feature hook (`useAssistantSession`) owns it instead of TanStack Query.
- Permissions: a signed-in user, or the website widget with a valid `X-Embed-Key` and origin

### Provider usage in the backend (`provider_usage` table)

Created by `apps/api/services/orchestrator/migrations/001_initial.sql`. One row per provider event
we want to count. The frontend never reads it; `GET /usage` sums it per provider and operation.

| Column                  | Type           | Notes                                                          |
| ----------------------- | -------------- | -------------------------------------------------------------- |
| `id`                    | uuid           | primary key                                                    |
| `provider`              | text           | `liveavatar` on every assistant row                            |
| `operation`             | text           | what happened. The assistant operations are listed below      |
| `provider_resource_id`  | text (null)    | the provider's own id. Assistant rows: LiveAvatar's session id, never our `sessions.id` |
| `model`                 | text (null)    | null on assistant rows                                         |
| `characters`            | integer (null) | null on assistant rows: no text reaches the backend            |
| `estimated_duration_ms` | bigint (null)  | `assistant_answer`: the answer's length, measured by the browser |
| `cache_hit`             | boolean        | default `false`, and `false` on every assistant row today      |
| `metadata`              | jsonb          | see below. Never any text of a question or an answer          |
| `occurred_at`           | timestamptz    | insert time. For `assistant_answer`: when the report arrived, not when the avatar spoke |

The assistant writes three operations. `principal` is `user:<id>` or `embed:<origin>`.

- `assistant_token`: a session was minted (`POST /api/assistant/session`). Metadata: `avatar_id`,
  `sandbox`, `language`, `requested_language`, `provider_mode`, `principal`.
- `assistant_answer`: one avatar answer the browser reported
  (`POST /api/assistant/session/{id}/answers`). Metadata: `principal`, `sandbox`, `provider_mode`,
  `answer_index`, `source` (always `browser`). `docs/API.md` says what the row means and what it
  does not mean.
- `assistant_close`: the session was closed (`POST /api/assistant/session/{id}/close`). Metadata:
  `principal`, `provider_stop`.

## Adding a model

1. Create `src/entities/<name>/types.ts` with a Zod schema and inferred type.
2. Add `api.ts` (calls through `apiClient`, parses with the schema).
3. Add `hooks.ts` with a `keys` object and TanStack Query hooks.
4. Document it here and in `docs/API.md`.
5. Add the routes to `src/data/mock/handlers.ts` so the mock keeps working.

Do not duplicate the entire backend database schema in the frontend.
