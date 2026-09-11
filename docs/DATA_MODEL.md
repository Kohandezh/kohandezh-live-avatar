# DATA MODEL

This document describes frontend-facing domain models.
`apps/api` owns the database schema and migrations (ADR 0006).
Once ADR 0007 is accepted, these schemas are generated from the backend's OpenAPI document
instead of being written by hand.
Each model has a Zod schema in `apps/frontend/src/entities/<name>/types.ts`; the TypeScript type is inferred from it.

## User (`src/entities/user`)

Login identity is the phone number (E.164, for example `+989121234567`), not email. Email is
optional profile data and is `null` until the user sets one; there is no profile feature yet, so
today it is only ever the value the backend returned at account creation.

| Field       | Type                       | Notes                                          |
| ----------- | -------------------------- | ----------------------------------------------- |
| `id`        | string                     |                                                  |
| `phone`     | string                     | E.164. The login identity.                      |
| `firstName` | string                     | Empty string until a profile feature exists.    |
| `lastName`  | string                     | Empty string until a profile feature exists.    |
| `email`     | string \| null             | Optional. `getFullName` falls back to `phone`.  |
| `role`      | `"user"` \| `"admin"`      | Backend decides. UI reads only.                 |
| `status`    | `"active"` \| `"disabled"` |                                                  |
| `createdAt` | string (ISO 8601)          | Formatted with `Intl` in the UI.                |

- Endpoints: `GET /api/me`, `GET /api/admin/users`, `POST /api/auth/otp/request`,
  `POST /api/auth/otp/verify` (see `docs/API.md`)
- Query keys: `['user', 'me']`, `['user', 'list', params]`
- Hooks: `useCurrentUser()`, `useUsers(params)`, `useRequestOtp()`, `useVerifyOtp()` (both in
  `src/features/authentication`)
- Mutations that touch it: OTP verify (`setQueryData` on `me`), logout (clears the cache)
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

## Adding a model

1. Create `src/entities/<name>/types.ts` with a Zod schema and inferred type.
2. Add `api.ts` (calls through `apiClient`, parses with the schema).
3. Add `hooks.ts` with a `keys` object and TanStack Query hooks.
4. Document it here and in `docs/API.md`.
5. Add the routes to `src/data/mock/handlers.ts` so the mock keeps working.

Do not duplicate the entire backend database schema in the frontend.
