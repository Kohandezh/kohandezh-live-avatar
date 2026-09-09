# API

The frontend talks to an external backend through one axios client: `src/shared/api/client.ts`.
The mock in `src/data/mock` implements the same contract for local development.

The backend is `apps/api/` (Python / FastAPI, ADR 0006, ADR 0008). This document is the written
contract between the two apps. Any backend that implements it works with this frontend.

## Conventions

- JSON request and response bodies.
- Errors return `{ "code": string, "message": string, "details"?: unknown }`. The client turns them into `ApiError` (`src/shared/api/errors.ts`).
- Lists are paginated: `{ "items": T[], "total": number, "page": number, "pageSize": number }`. `page` starts at 1.
- Web sends cookies (`withCredentials: true`). Native sends `Authorization: Bearer <token>`.
- Responses are validated with Zod in the entity that owns them.
- Long operations answer `202 Accepted` with `{ "jobId": string }`. The frontend then polls
  `GET /api/jobs/{jobId}`, which returns `{ "status": "queued" | "running" | "done" | "failed", "result"?: unknown, "error"?: { "code": string, "message": string } }`.
  Never hold a request open while a model runs.
- Streaming answers use Server-Sent Events (`text/event-stream`), not WebSockets, so the same
  code works through a normal reverse proxy.

## Endpoints used by the starter

| Method | Path                   | Access | Used by                       |
| ------ | ---------------------- | ------ | ----------------------------- |
| POST   | `/api/auth/login`      | Public | `features/authentication`     |
| POST   | `/api/auth/logout`     | Auth   | `features/authentication`     |
| GET    | `/api/me`              | Auth   | `entities/user` (session)     |
| GET    | `/api/admin/users`     | Admin  | `entities/user` (admin table) |
| GET    | `/api/admin/dashboard` | Admin  | `entities/dashboard`          |

### POST /api/auth/login

Request: `{ "email": string, "password": string }`

Response: `{ "user": User, "accessToken"?: string }`

- Web: the backend sets an HttpOnly session cookie and may omit `accessToken`.
- Native: the backend returns `accessToken`; the app stores it in secure storage.
- `401 invalid_credentials` on wrong email or password.

### GET /api/me

Response: `User`. `401` when there is no session. The frontend treats `401` here as "anonymous", not as an error.

### GET /api/admin/users

Query: `q?` (search in name and email), `page?` (default 1), `pageSize?` (default 10, max 100).

Response: `Paginated<User>`. `403` for non-admin users.

### GET /api/admin/dashboard

Response: `DashboardSummary`. `403` for non-admin users.

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
- CORS must list the web and admin origins explicitly and allow credentials.
