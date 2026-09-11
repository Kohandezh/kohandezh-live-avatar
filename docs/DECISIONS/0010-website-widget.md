# ADR 0010 — The Website Widget Is a Fourth Build Target

## Status

Accepted.

## Context

Customers want the assistant on their own website. They add one script tag and get the same
real-time voice and video conversation the mobile app and the web PWA already have.

That surface is different from the three targets in ADR 0004 in three ways:

1. It runs inside a page we do not control. The customer's CSS, fonts and globals are there,
   and our styles must not change their page either.
2. There is no logged-in user. A visitor of the customer's site has no account with us.
3. It is loaded by a plain `<script>` tag, so the output must be one file, not an
   `index.html` plus hashed assets.

Options considered:

1. An `<iframe>` that loads the web target. Full isolation, but the microphone permission has
   to be delegated with `allow="microphone"`, the panel cannot grow out of the frame, and the
   whole PWA (router, service worker, login screens) is loaded for one panel.
2. A separate repository or package for the widget. Clean boundary, but the assistant feature,
   the design tokens and the translations would have to be duplicated or published as a package.
3. A fourth Vite target that builds the existing shared feature into one script and renders it
   into a Shadow DOM on the customer's page.

## Decision

Option 3.

- `APP_TARGET=widget` builds `src/app/widget/` into `dist/widget/` in Vite library mode:
  one IIFE file `assistant-widget.js` that defines `window.KohandezhAssistant`, plus a demo
  `index.html` that stands in for a customer page during development (port 5176).
- The script creates a `<div>` at the end of `<body>`, opens a **Shadow DOM**, injects the app
  stylesheet as text (`@/styles/globals.css?inline`) and mounts React inside. Nothing but
  `window.KohandezhAssistant` is added to the page, and no style of ours escapes the shadow root.
- The widget renders the shared `AssistantPanel` (ADR 0004 keeps one codebase, PLAN D2 keeps one
  assistant feature). It has no Router and no Redux store: the assistant keeps its state in the
  feature hook and the language lives in i18next.
- **Authentication is a public embed key**, not a user session. `configureApiClient` points the
  single axios client at the customer's configured backend and registers `X-Embed-Key` on every
  request. Cookies are turned off (`withCredentials: false`).

## Consequences

### Build

- `vite.config.ts` has a fourth target. The widget build sets `build.lib`, drops `manualChunks`
  and sets `publicDir: false`. There is no PWA plugin and no service worker: registering one on
  somebody else's origin would be wrong.
- IIFE output cannot be code-split, so the lazy `import('@heygen/liveavatar-web-sdk')` in
  `useAssistantSession` is inlined and the LiveAvatar SDK (with `livekit-client`) ships inside
  the one file. That is the size budget problem below.
- The entry sets the global itself instead of relying on Rollup's `output.name`, so the dev
  server (which loads the entry as an ES module) behaves the same as the built script.

### Size budget

One file, gzipped, is about 395 kB today. About 260 kB of that is the LiveAvatar SDK and
LiveKit, which are only needed once a visitor starts a conversation. The customer should load
the script with `defer`. If the size becomes a problem, the fix is a small loader script that
fetches a second file at conversation start; that needs two builds and was not worth it yet.

### Security model (the backend side is in `docs/SECURITY.md`)

- The embed key is **public**. It is in the customer's HTML and anyone can read it. It is not a
  secret and it must never stand in for a user session.
- The backend pairs the key with an **origin allowlist** (`ASSISTANT_EMBED_ALLOWED_ORIGINS`)
  and a **rate limit** per key and client IP (`ASSISTANT_RATE_LIMIT_PER_HOUR`), and it keeps
  every session in **sandbox** mode. A stolen key on another origin is refused.
- No cookies. A visitor who also has our own session cookie for the same site never mixes that
  user with the anonymous embed principal.
- The provider session token stays in a local variable inside the feature hook. It is never
  logged, stored, or put in the URL.

### Limits we accept

- The widget does not lock the page's scroll while the sheet is open, because that would mean
  writing to the customer's `<body>`.
- Tailwind sizes use `rem`, which always resolves against the customer's root font size. A site
  that sets `html { font-size: 10px }` scales the widget with it. `:host { all: initial }`
  stops everything else from being inherited.
- One widget per page. A second `init()` warns and returns the first instance.
