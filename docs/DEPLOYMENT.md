# DEPLOYMENT

## Environments

- Development
- Staging
- Production

Environment-specific values come from environment variables at build time (`VITE_*`). Never set `VITE_API_MOCK=true` outside development.

## Outputs

`pnpm build` runs the type check and produces four independent folders:

| Folder                       | Deploy to                                     |
| ---------------------------- | --------------------------------------------- |
| `apps/frontend/dist/mobile/` | Nothing. Capacitor copies it into the apps.   |
| `apps/frontend/dist/web/`    | Static host for the public web app (PWA).     |
| `apps/frontend/dist/admin/`  | Static host for the admin dashboard.          |
| `apps/frontend/dist/widget/` | CDN or static host for the embeddable script. |

Build one target with `pnpm build:web`, `pnpm build:admin`, `pnpm build:mobile`, or
`pnpm build:widget`.

## Web (PWA)

- Serve over HTTPS. Service workers do not run on plain HTTP (except `localhost`).
- Single-page app: route every path to `index.html`.
- `sw.js` and `manifest.webmanifest` are generated at build time. Serve `sw.js` with `Cache-Control: no-cache` so updates are found quickly.
- Never route `/api/*` to the SPA fallback. The service worker already skips those paths.

## Admin

- Host it on its own origin (for example `admin.example.com`). Add that origin to the backend CORS allowlist with credentials.
- Restrict access at the network or identity layer where possible (VPN, SSO, IP allowlist). The role check in the UI is not a security boundary.
- `index.html` sends `robots: noindex`.

## Website widget

`dist/widget/` holds two files (ADR 0010):

- `assistant-widget.js` — the whole widget in one script. About 395 kB gzipped today, because
  the LiveAvatar SDK cannot be split out of an IIFE bundle.
- `index.html` — a demo page. It is only a development aid. Do not publish it.

Host `assistant-widget.js` on a static host or CDN over HTTPS, and serve it with a long
`Cache-Control` plus a version in the path (for example `/widget/2026-09-11/assistant-widget.js`),
because the file name has no content hash.

### What the customer adds to their page

```html
<script
  src="https://cdn.example.com/assistant-widget.js"
  data-api-base="https://api.example.com"
  data-embed-key="YOUR_EMBED_KEY"
  data-lang="fa"
  data-mode="voice"
  data-position="end"
  defer
></script>
```

Only `data-embed-key` is required. `data-api-base` is empty when the backend answers on the
same origin as the customer's page. `data-lang` is `fa` or `en` (default: the visitor's
browser), `data-mode` is `voice` or `video` (default `voice`), `data-position` is `end` or
`start` (default `end`, which is the left side on a Persian page).

A page that wants to control the widget itself leaves the data attributes off and calls the
global instead:

```html
<script src="https://cdn.example.com/assistant-widget.js" defer></script>
<script>
  window.addEventListener('load', () => {
    const assistant = window.KohandezhAssistant.init({
      apiBaseUrl: 'https://api.example.com',
      embedKey: 'YOUR_EMBED_KEY',
      language: 'fa',
    });
    // assistant.open(), assistant.close(), assistant.destroy()
  });
</script>
```

### What the backend needs

- Add the customer's page origin (scheme, host and port, no path) to
  `ASSISTANT_EMBED_ALLOWED_ORIGINS`. A request from any other origin is refused with
  `403 embed_origin_not_allowed`. `*` is only accepted while `APP_ENV=development`.
- Add the same origin to `CORS_ALLOWED_ORIGINS`, and keep `X-Embed-Key` in the allowed request
  headers. The widget sends no cookies, so the embed key is the whole credential.
- Give each customer their own `ASSISTANT_EMBED_KEY` and keep `ASSISTANT_RATE_LIMIT_PER_HOUR`
  set. The key is public: it sits in the customer's HTML, and the origin allowlist plus the
  rate limit are what stop somebody else from using it.

### Notes for the customer

- Both the page and the backend must be HTTPS. The browser only gives a page the microphone in
  a secure context, so the widget cannot start a conversation on plain HTTP (except on
  `localhost`).
- The visitor is asked for the microphone by their browser on the first conversation. If the
  page is inside an `<iframe>`, that frame needs `allow="microphone"`.
- A Content Security Policy on the customer's site must allow the script origin in
  `script-src`, the backend in `connect-src`, and the LiveAvatar media servers in `connect-src`
  and `media-src`.

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
