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

### User in the backend (`users` table)

Created by `apps/api/services/orchestrator/migrations/002_assistant.sql`. The first successful
one-time code check creates the row. There is no password column: the phone plus the code is the
only credential.

| Column                    | Type        | Notes                                                |
| ------------------------- | ----------- | ---------------------------------------------------- |
| `id`                      | uuid        | primary key                                           |
| `phone`                   | text        | unique, E.164 (`+989123456789`)                       |
| `first_name`, `last_name` | text        | empty strings until a profile feature exists          |
| `email`                   | text (null) | not collected at login                                |
| `role`                    | text        | `user` or `admin`. `ADMIN_PHONES` promotes at login.  |
| `status`                  | text        | `active` or `disabled`. Disabled blocks login and API. |
| `created_at`, `updated_at`| timestamptz |                                                       |

The API returns an explicit allowlist of these columns as `User`
(`id`, `phone`, `firstName`, `lastName`, `email`, `role`, `status`, `createdAt`). Nothing else
leaves the backend.

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

## Adding a model

1. Create `src/entities/<name>/types.ts` with a Zod schema and inferred type.
2. Add `api.ts` (calls through `apiClient`, parses with the schema).
3. Add `hooks.ts` with a `keys` object and TanStack Query hooks.
4. Document it here and in `docs/API.md`.
5. Add the routes to `src/data/mock/handlers.ts` so the mock keeps working.

Do not duplicate the entire backend database schema in the frontend.
