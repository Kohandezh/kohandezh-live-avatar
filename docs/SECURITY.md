# SECURITY

1. Backend is the source of truth for authorization.
2. Never trust client-side permission checks. `RequireAuth` and `RequireRole` only shape the UI. Every `/api/admin/*` request must be checked on the server.
3. Use explicit public API field allowlists.
4. Use explicit CORS origins for the web and admin hosts, with `Access-Control-Allow-Credentials: true` for cookie sessions.
5. Validate sensitive input on the backend.
6. Store native tokens in Keychain/Keystore-backed storage. On web, keep the session in an HttpOnly cookie and never write a token to `localStorage`.
7. Never log credentials or access tokens.
8. Use HTTPS outside local development.
9. Never ship frontend secrets.
10. Keep sensitive data out of client error messages and logs.
11. Never enable `VITE_API_MOCK` in staging or production. The mock signs a visitor in without a
    real credential check.
12. Host the admin dashboard on its own origin and limit who can reach it.
13. An AI gateway logs metadata only: user, model, token counts, latency. Never log prompt or
    answer text. If a product promises it does not store conversations, that must be true in the
    code, not in a setting an operator can flip.
14. Upload endpoints enforce a maximum size and an allowlist of content types on the server.
    A client-side check is a hint, not a control.
15. Backend secrets (model API keys, database passwords) come from the runtime environment.
    Never bake them into a container image or a build artifact.

## Sessions

- Login is a phone number plus a one-time code. There is no password to steal, reuse, or leak.
- A session is an opaque random token (`secrets.token_urlsafe(32)`). It carries no claims, so it
  can be revoked at any moment by deleting one Redis key.
- Redis stores the SHA-256 of the token, not the token. A dump of Redis holds no usable session.
- Web keeps the token in the HttpOnly cookie `kd_session` (`SameSite=Lax`, `Path=/`, `Secure`
  outside development). JavaScript never sees it. `SameSite=Lax` is the CSRF protection.
- Native keeps the same token in OS-backed secure storage and sends it as `Authorization: Bearer`.
- `POST /api/auth/logout` revokes the token for both.
- Lifetime: `SESSION_TTL_DAYS` (30 days by default).

## One-time codes

- The code is created with `secrets`, never with `random`.
- Redis stores the SHA-256 of the code, and the check is a constant time compare.
- Limits: one code per minute and five per hour for one phone, twenty per hour for one IP address.
  Five wrong codes destroy the code and lock the number for five minutes.
- The code is written to the log only when `APP_ENV=development`. In any other environment the
  console sender logs a warning and delivers nothing, so a live code never reaches a log file.
  Returning the code in the response (`devCode`) is also development only.
- Phone numbers are masked in logs.

## SMS credentials (Asanak)

`ASANAK_USERNAME` and `ASANAK_PASSWORD` are the web service credentials for the customer's SMS
account. Anyone who holds them can send SMS on that account and spend its credit, so treat them
like any other production secret. They live in the runtime environment only: never in the
repository, never in a build artifact, never in a frontend variable. Asanak wants them in the
request body, so the backend never logs the request body, and a failed send logs only the masked
phone, the Asanak `meta.status`, and the HTTP status. The error returned to the browser
(`otp_delivery_failed`) carries no credential, no provider detail, and no code. Asanak expires
web service passwords, so plan a rotation: change it in the panel, update the environment
variable, restart the backend. The backend refuses to start when `OTP_DELIVERY=asanak` and either
value is empty, so a bad rotation fails the deploy instead of breaking login silently.

## Website widget (embed key)

- `ASSISTANT_EMBED_KEY` ships inside a public script, so it is not a secret. Treat it as a name,
  not as a credential.
- What protects the account is the rest of the model: the request `Origin` must be listed in
  `ASSISTANT_EMBED_ALLOWED_ORIGINS` (exact match), every visitor address gets at most
  `ASSISTANT_RATE_LIMIT_PER_HOUR` sessions, and sandbox mode means no credits are spent.
- `*` as an allowed origin only works when `APP_ENV=development`. It is ignored anywhere else.
- Leave `ASSISTANT_EMBED_KEY` empty to turn the widget off.
- The provider API key never leaves the backend. The browser only receives a short-lived session
  token for one conversation, and that token is never logged and never stored by the frontend.
