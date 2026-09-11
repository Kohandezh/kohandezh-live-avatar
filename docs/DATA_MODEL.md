# DATA MODEL

This document describes frontend-facing domain models.
`apps/api` owns the database schema and migrations (ADR 0006).
Once ADR 0007 is accepted, these schemas are generated from the backend's OpenAPI document
instead of being written by hand.
Each model has a Zod schema in `apps/frontend/src/entities/<name>/types.ts`; the TypeScript type is inferred from it.

## User (`src/entities/user`)

| Field       | Type                       | Notes                            |
| ----------- | -------------------------- | -------------------------------- |
| `id`        | string                     |                                  |
| `firstName` | string                     |                                  |
| `lastName`  | string                     |                                  |
| `email`     | string (email)             |                                  |
| `role`      | `"user"` \| `"admin"`      | Backend decides. UI reads only.  |
| `status`    | `"active"` \| `"disabled"` |                                  |
| `createdAt` | string (ISO 8601)          | Formatted with `Intl` in the UI. |

- Endpoints: `GET /api/me`, `GET /api/admin/users`
- Query keys: `['user', 'me']`, `['user', 'list', params]`
- Hooks: `useCurrentUser()`, `useUsers(params)`
- Mutations that touch it: login (`setQueryData` on `me`), logout (clears the cache)
- Permissions: `me` needs a session; the list needs the admin role

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

One real-time conversation with the LiveAvatar assistant (FULL mode). The backend mints the
provider token with its own API key; the browser drives the session with the official SDK.

| Field                       | Type              | Notes                                                     |
| --------------------------- | ----------------- | --------------------------------------------------------- |
| `id`                        | string (uuid)     | Our session row. Used to close the session.                |
| `sessionToken`              | string            | Provider credential. See the rule below.                   |
| `providerSessionId`         | string            | LiveAvatar's own session id, for support and logs.          |
| `sandbox`                   | boolean           | Server-side decision. The client cannot turn it off.        |
| `avatarId`                  | string            | Public avatar in sandbox, the custom avatar in production.  |
| `language`                  | `"fa"` \| `"en"`  | Language of the avatar persona.                             |
| `maxSessionDurationSeconds` | integer           | About 60 in sandbox. Drives the countdown in the UI.        |

`sessionToken` is handed to `new LiveAvatarSession(...)` once, inside the feature hook, and
never goes into Redux, storage, a URL, or a log. `toAssistantSessionInfo()` strips it before
anything else sees the session.

- Endpoints: `POST /api/assistant/session`, `POST /api/assistant/session/{id}/close`
- Functions: `createAssistantSession(body)`, `closeAssistantSession(id)`
- No query hook: a session is created by a user action and must never be cached or replayed,
  so the feature hook (`useAssistantSession`) owns it instead of TanStack Query.
- Permissions: a signed-in user, or the website widget with a valid `X-Embed-Key` and origin

## Adding a model

1. Create `src/entities/<name>/types.ts` with a Zod schema and inferred type.
2. Add `api.ts` (calls through `apiClient`, parses with the schema).
3. Add `hooks.ts` with a `keys` object and TanStack Query hooks.
4. Document it here and in `docs/API.md`.
5. Add the routes to `src/data/mock/handlers.ts` so the mock keeps working.

Do not duplicate the entire backend database schema in the frontend.
