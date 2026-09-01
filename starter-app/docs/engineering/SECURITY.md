# Security

## Binding rules
1. The backend is the source of truth for authorization. Client checks are UX only.
2. Web sessions use `HttpOnly; Secure; SameSite` cookies. JavaScript never sees the session token.
3. Native sessions use Bearer tokens stored only in Keychain/Keystore via `shared/storage/token.ts`.
   Never `localStorage`, never `Preferences`, never the Redux store.
4. No secrets in the bundle. Every `VITE_*` value is public. API keys belong to the backend.
5. Allowed origins are an explicit list on the backend. Credentials + `*` CORS is forbidden.
6. Public API responses use explicit field allowlists.
7. Backend validates all input. Client validation (Zod) exists for UX and is never trusted.
8. Errors and logs never contain tokens, passwords, or personal data.
9. Service worker never caches API responses (`navigateFallbackDenylist: [/^\/api/]`, no runtime
   caching of `VITE_API_BASE_URL`).
10. Any change touching auth, sessions, tokens, cookies, or CORS gets a security review before
    merge (AGENTS.md stop condition 6).

## Threat notes for this architecture
- **XSS** → cookie is HttpOnly (web); native token lives outside the WebView storage. Still:
  never `dangerouslySetInnerHTML` with server content; i18n `escapeValue: false` is safe only
  because React escapes on render.
- **CSRF** → `SameSite=Lax` cookie + JSON content type + origin allowlist. If the backend accepts
  form posts, it must add a CSRF token; the frontend does not.
- **Token leakage on native** → tokens are never logged, never put in URLs, cleared on logout and
  on `401`.
- **Deep links** → treated as untrusted input; only the path is handed to the router.

## Current state vs target
- The mock backend sets `secure: false` on the cookie so it works on `http://localhost`. The real
  backend must set `Secure` in staging/production.
- Refresh-token rotation is not modeled in the starter. Add it in `shared/api/auth.ts` +
  `client.ts` (single-flight refresh on `401`) when the backend provides it.
