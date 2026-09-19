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

## SMS delivery

Login is a one-time code, so a deploy that people outside the team use needs a real SMS sender.
Set `OTP_DELIVERY=asanak` and these variables:

| Variable | Value |
| --- | --- |
| `ASANAK_USERNAME` | web service user from the Asanak panel |
| `ASANAK_PASSWORD` | web service password (Asanak expires it, so rotate it) |
| `ASANAK_SOURCE` | the sender line the template belongs to, from the Asanak panel |
| `ASANAK_TEMPLATE_ID` | the id of the approved OTP template, from the Asanak panel |
| `ASANAK_TEMPLATE_CODE_PARAMETER` | `code`, the template variable holding the code |

`ASANAK_BASE_URL` and `ASANAK_TIMEOUT_SECONDS` have working defaults; set them only to point at
another endpoint or to change the 10 second timeout.

The backend refuses to start when `OTP_DELIVERY=asanak` and the username or the password is
empty, so a missing secret fails the deploy instead of the first login.

`OTP_DELIVERY=console` is the default and is for development only. It writes the code to the log
when `APP_ENV=development` and delivers nothing anywhere else, which means nobody can log in.
See `docs/SECURITY.md` for how the credentials are handled.

## Sandbox to production

Everything in this repository ships defaulted to LiveAvatar sandbox mode. Before a deploy that
real users rely on, go through this checklist:

- `LIVEAVATAR_SANDBOX=false`, and `LIVEAVATAR_ASSISTANT_AVATAR_ID` set to the real (non-sandbox)
  avatar id. Sandbox sessions are free and short; production ones are neither.
- Real embed origins in `ASSISTANT_EMBED_ALLOWED_ORIGINS` instead of `*` (which only works while
  `APP_ENV=development` anyway).
- `OTP_DELIVERY=asanak` with `ASANAK_USERNAME` and `ASANAK_PASSWORD` set. The backend refuses to
  start otherwise once delivery is switched to Asanak.
- `APP_ENV=production`. This stops the console sender from writing codes to the log. It also
  removes `devCode` from the OTP response, though `OTP_DELIVERY=asanak` already does that on its
  own, which is what keeps a development demo with real SMS from showing the code.
- HTTPS everywhere: the web app, the admin dashboard, the widget host, and the API. Browsers only
  grant the microphone in a secure context.
- `CORS_ALLOWED_ORIGINS` set to the real web, admin, and widget origins, nothing else.

## Native

Run Capacitor from `apps/frontend`, where `capacitor.config.ts` lives:

```bash
pnpm build:mobile
pnpm cap:sync
```

Then build Android/iOS with the native toolchains (`pnpm cap:android`, `pnpm cap:ios`). Replace the placeholder token storage in `src/shared/storage/secureStorage.ts` with a Keychain/Keystore plugin before release.
