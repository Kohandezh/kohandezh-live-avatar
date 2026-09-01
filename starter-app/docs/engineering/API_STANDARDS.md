# API Standards (frontend-facing)

The contract is `docs/api/openapi.yaml`. These rules apply to every endpoint the frontend consumes
and every change proposed to the backend team.

## Transport
- HTTPS only. JSON request/response bodies. `Accept: application/json`.
- Base URL from `VITE_API_BASE_URL`; paths are relative and never hard-coded with a host.

## Authentication
- Login: `POST /auth/login` with header `X-Auth-Mode: cookie` (web) or `bearer` (native).
  Cookie mode sets an `HttpOnly; Secure; SameSite` cookie. Bearer mode returns `accessToken`.
- Session: `GET /auth/me` → current user or `401`.
- Logout: `POST /auth/logout` → `204`; invalidates the session server-side.

## Tiers
| Tier | Prefix | Auth | Exposure |
| --- | --- | --- | --- |
| Public | `/public/…` | none | explicit `PUBLIC_FIELDS` allowlist only |
| Authenticated | `/…` | required | user-scoped data |
| Privileged | `/admin/…` | required + role | administrative |

## Error envelope (every non-2xx)
```json
{ "error": { "code": "VALIDATION", "message": "human readable", "details": { "field": "email" } } }
```
Codes are stable strings. `message` is safe to show only after mapping through i18n; the client
maps HTTP status → `ApiErrorCode` (`shared/api/errors.ts`). Stack traces never reach the client.

## Pagination / filtering / sorting
```json
{ "items": [], "page": 1, "pageSize": 20, "total": 123 }
```
Query params: `page`, `pageSize` (max 100), `sort` (`field` or `-field`), `q`.

## Rate limits
`429` with `Retry-After`. The client treats `429` as retryable with backoff; never as a bug.

## Versioning
Additive changes only. Breaking changes ship under a new path prefix (`/v2/…`) or a coordinated
cut-over recorded in `DECISIONS.md`. Deprecated fields stay for at least one release.

## Idempotency
`PUT`/`DELETE` are idempotent. `POST` that creates resources should accept an
`Idempotency-Key` header when retries are possible from mobile clients.
