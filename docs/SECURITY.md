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
11. Never enable `VITE_API_MOCK` in staging or production. The mock accepts a fixed demo password.
12. Host the admin dashboard on its own origin and limit who can reach it.
13. An AI gateway logs metadata only: user, model, token counts, latency. Never log prompt or
    answer text. If a product promises it does not store conversations, that must be true in the
    code, not in a setting an operator can flip.
14. Upload endpoints enforce a maximum size and an allowlist of content types on the server.
    A client-side check is a hint, not a control.
15. Backend secrets (model API keys, database passwords) come from the runtime environment.
    Never bake them into a container image or a build artifact.
