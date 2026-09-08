# DEPLOYMENT

## Environments

- Development
- Staging
- Production

Environment-specific values come from environment variables at build time (`VITE_*`). Never set `VITE_API_MOCK=true` outside development.

## Outputs

`pnpm build` runs the type check and produces three independent folders:

| Folder                        | Deploy to                                   |
| ----------------------------- | ------------------------------------------- |
| `apps/frontend/dist/mobile/`  | Nothing. Capacitor copies it into the apps. |
| `apps/frontend/dist/web/`     | Static host for the public web app (PWA).   |
| `apps/frontend/dist/admin/`   | Static host for the admin dashboard.        |

Build one target with `pnpm build:web`, `pnpm build:admin`, or `pnpm build:mobile`.

## Web (PWA)

- Serve over HTTPS. Service workers do not run on plain HTTP (except `localhost`).
- Single-page app: route every path to `index.html`.
- `sw.js` and `manifest.webmanifest` are generated at build time. Serve `sw.js` with `Cache-Control: no-cache` so updates are found quickly.
- Never route `/api/*` to the SPA fallback. The service worker already skips those paths.

## Admin

- Host it on its own origin (for example `admin.example.com`). Add that origin to the backend CORS allowlist with credentials.
- Restrict access at the network or identity layer where possible (VPN, SSO, IP allowlist). The role check in the UI is not a security boundary.
- `index.html` sends `robots: noindex`.

## Backend

The backend is `apps/api/` (ADR 0006, ADR 0008). It is built and deployed separately from the
frontend, even though it lives in the same repository. Two shapes:

**Cloud.** The API is on its own origin (for example `api.example.com`). Add the web and admin
origins to the backend CORS allowlist with `Access-Control-Allow-Credentials: true`. Set
`VITE_API_BASE_URL` to the API origin at build time.

**On-premise.** One web server serves `dist/web/` and `dist/admin/` and proxies `/api` to the
backend on the same origin. Then `VITE_API_BASE_URL` is empty, no CORS is needed, and the session
cookie is same-site. Prefer this shape when the customer allows it: fewer moving parts, and one
less way to get cookies wrong.

Never route `/api/*` to the SPA fallback in either shape.

## Native

Run Capacitor from `apps/frontend`, where `capacitor.config.ts` lives:

```bash
pnpm build:mobile
pnpm cap:sync
```

Then build Android/iOS with the native toolchains (`pnpm cap:android`, `pnpm cap:ios`). Replace the placeholder token storage in `src/shared/storage/secureStorage.ts` with a Keychain/Keystore plugin before release.
