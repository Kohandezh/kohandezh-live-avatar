---
name: authorization
description: Use when implementing authentication, authorization, or access control in this repo. Covers the two doors (a user session, or the widget embed key on an allowed origin), the phone plus one-time-code login, the cookie/bearer split between web and native, the admin role check, the rate limits, and what the frontend guards are and are not.
---

# Authorization in this repo

There is **one login** (a phone number plus a one-time code) and **two doors** into the API. Pick the door that matches the surface you are touching. Do not invent a third.

Read `docs/SECURITY.md` and ADR 0002 (`docs/DECISIONS/0002-authentication.md`) before changing anything here. This file is the working map.

## The two doors

| Door | Who it lets in | Where it is enforced |
| ---- | -------------- | -------------------- |
| **Session** | a signed-in user, on any target | `get_current_user` in `src/auth/dependencies.py` |
| **Embed key + origin** | an anonymous visitor on a customer website | `get_principal` in `src/assistant/router.py` |

`get_principal` tries the session first. Only when there is no session at all does it fall back to the embed key, and then the request `Origin` must be an exact match in `ASSISTANT_EMBED_ALLOWED_ORIGINS`. Anything else is refused.

Paths are relative to `apps/api/services/orchestrator/`.

## Door 1: the user session

### Login

1. `POST /api/auth/otp/request` normalizes the phone to E.164 (`src/auth/phone.py`), then `OtpService.request` stores a code and sends it.
2. `POST /api/auth/otp/verify` calls `OtpService.verify`, then `login_user`, then `SessionService.issue`.
3. The answer depends on the client:
   - Header `X-Client-Platform: native` → the token comes back in the body as `accessToken`.
   - Anything else (web, admin) → `set_session_cookie` writes the HttpOnly cookie `kd_session`.

There is no password. There is nothing to steal, reuse, or leak.

### The session token

- An opaque random token, `secrets.token_urlsafe(32)`. **It carries no claims.** It is not a JWT and must not become one without an ADR.
- Redis stores the SHA-256 of the token, never the token. A Redis dump holds no usable session.
- Revocation is deleting one Redis key (`POST /api/auth/logout`).
- Lifetime: `SESSION_TTL_DAYS`, 30 days by default.
- Web: HttpOnly cookie `kd_session`, `SameSite=Lax`, `Path=/`, `Secure` outside development. JavaScript never sees it. **`SameSite=Lax` is the CSRF protection here**; there is no separate CSRF token.
- Native: the same opaque token in OS-backed secure storage, sent as `Authorization: Bearer <token>`.

`session_token(request)` reads the bearer header first, then the cookie. One function, both transports.

### Resolving it

`resolve_optional_user` is the only place that turns a token into a user. Three outcomes, and the difference matters:

- **No token at all** → `None`. The caller decides whether anonymous is allowed.
- **A token that no longer resolves** → `401`, not anonymous. A stale cookie must never be mistaken for a widget visitor.
- **A user whose `status` is not `active`** → `403 account_disabled`.

`get_current_user` turns the `None` case into `401`. Use it as the dependency on anything that needs a user.

### The admin role

```python
router = APIRouter(tags=["admin"], dependencies=[Depends(require_admin)])
```

`require_admin` (`src/auth/dependencies.py`) is where the admin role is actually enforced. Put it on the **router**, not on individual handlers, so a new endpoint added to that router cannot forget it. A handler under `/api/admin/*` that is not covered by `require_admin` is a Critical security bug.

## Door 2: the widget embed key

`ASSISTANT_EMBED_KEY` ships inside a public script. **It is a name, not a credential.** What actually protects the account is the rest of the model:

- The request `Origin` must be an exact match in `ASSISTANT_EMBED_ALLOWED_ORIGINS`.
- `*` as an allowed origin works **only** when `APP_ENV=development`. It is ignored anywhere else.
- Every visitor address gets at most `ASSISTANT_RATE_LIMIT_PER_HOUR` sessions. The key is public, so the limit counts the **address**, not the key.
- An empty `ASSISTANT_EMBED_KEY` turns the widget off.

The `Principal` returned by `get_principal` carries two separate keys on purpose: `key` identifies the caller, `rate_key` is what the hourly limit counts. For a signed-in user both are the user id. For an embed visitor `key` is the origin and `rate_key` is the client address.

## One path gotcha: the `/api` prefix

The frontend calls `/api/auth/otp/verify`. The backend router declares `/auth/otp/verify`.
Both are right: nginx strips the prefix (`location /api/` proxying to
`http://orchestrator:8000/` in `infra/nginx/default.conf`), and no FastAPI router here sets
a prefix.

So: use `/api/...` when you mean the browser's view (the frontend, `docs/API.md`, a spec's
contract section) and the bare path when you mean the handler (a pytest case, a router
decorator). A backend test that requests `/api/auth/...` gets a 404.

## The assistant session token

`POST /api/assistant/session` returns a **per-conversation** credential, not a login. Rules, all Critical if broken (`docs/SECURITY.md`, rule 16):

- The provider API key never leaves the backend.
- The browser SDK holds the session token **in memory only**.
- Never in Redux, never in `localStorage`, never in a URL, never in a log, on any target.

## One-time codes

- Created with `secrets`, never with `random`.
- Redis stores the SHA-256 of the code. The check is a constant-time compare.
- Limits: one code per minute and five per hour per phone; twenty per hour per IP address. Five wrong codes destroy the code and lock the number for five minutes.
- The code reaches a log **only** when `APP_ENV=development`. Elsewhere the console sender logs a warning and delivers nothing.
- `devCode` comes back in the response only with `APP_ENV=development` **and** `OTP_DELIVERY=console`. A development machine that sends real SMS does not echo the code, so a demo cannot leave a live code on screen.
- Phone numbers are masked in logs (`mask_phone`).

Weakening any of these is a Critical finding.

## The frontend side

**The frontend guards are UX only.** They hide screens the user cannot use. They are not security, and the backend must check on every request.

- `RequireAuth` (`src/features/authentication/guards.tsx`) redirects an anonymous user to `/login`. On `403 account_disabled` it sends them to `/forbidden`, which carries the only log-out button a disabled user still has. On a network or 5xx failure it shows `ErrorState`, because "the request failed" is not the same as "not logged in".
- `RequireProfile` gates the product screens on a signed-in user **and** a name on file. The server's `firstName` is the onboarding flag, never a local flag, so it survives a reinstall, a second device, and a private window.
- `RequireRole` + `hasRole` (`src/features/authentication/roles.ts`) hide admin screens. Cosmetic.
- **Tokens move only through `src/shared/storage/tokenStore.ts`**: `getAccessToken`, `setAccessToken`, `clearAccessToken`. Never `localStorage` on web. Never Redux. Never a log.
- Session state is the `me` query. Do not keep a second copy of the user in Redux.

## When you add an endpoint

Ask, in this order:

1. **Who may call it?** A signed-in user, an admin, or an embed visitor. There is no fourth answer.
2. **Which dependency enforces that?** `get_current_user`, `require_admin` on the router, or `get_principal`. Do not hand-roll a check inside the handler.
3. **What does it return?** Use an explicit public-field allowlist (`public_user`), never the raw database row.
4. **Is it rate limited?** Anything an anonymous caller can reach needs a limit counted on the client address.
5. **What does the frontend need?** The Zod schema, `docs/API.md`, and `src/data/mock/handlers.ts`, all in the same PR.
6. **What is the denied path test?** A security-sensitive change tests the refusal as well as the success.

## STOP and ask before

- A new auth mechanism: a token format, a second cookie, an API key, a service account. That needs an ADR under `docs/DECISIONS/` first.
- Turning the session token into a JWT, or putting any claim inside it.
- Loosening a rate limit, the origin allowlist, or the `devCode` conditions.
- Anything that makes a frontend guard load-bearing for security.

## Checklist

- The endpoint names its door, and a dependency enforces it.
- `/api/admin/*` is covered by `require_admin` on the router.
- No raw row in a response; an explicit allowlist instead.
- No token in a log, a URL, Redux, or `localStorage`.
- Anonymous-reachable endpoints are rate limited per address.
- The denied path has a test, not only the allowed path.
- `docs/SECURITY.md` still describes the code after your change.
