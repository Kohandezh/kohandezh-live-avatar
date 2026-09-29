# Changelog

## Unreleased

- After a recorded answer, `/video` and `/audio` in the mobile app and the web app show a lead
  card in place of Start and the suggested questions, with the keyboard focus on its heading. It
  offers «درخواست مشاوره» (Request a consultation), which starts the live assistant the same way
  as Start; a contact card with the two office numbers, the two sales numbers, the email address
  and the website; up to three related questions, which play like a suggestion; and "Other
  questions", which brings the list back with focus on the question that was played. The phone
  numbers are grouped ("021 2623 0054") and use Persian digits in Persian. When the start from the
  lead card fails, for example while LiveAvatar is inactive, the existing error shows with the
  contact card under it and the line "The live assistant is not available right now". A failed
  plain Start still shows the error alone. When the related questions cannot load, the card shows
  without them. The contact details are fixed in `contactChannels.ts` and never come from the
  server; they are underlined like the app's other links. The card is never cut: on a small screen
  the page scrolls to its end. While it shows, the orb on `/audio` no longer says "Press start".
  After «درخواست مشاوره» the keyboard focus moves to the screen's heading. The widget does not
  change.
- The admin target has a Record answer screen (`/library/record`, "Record answer" on the Answer
  library screen). It is the Phase 1 workbench (text to speech, avatar session, recording,
  diagnostics) and says in one line that recording needs an active LiveAvatar account and a paid
  ElevenLabs plan. The avatar session is capped at 300 seconds. Record stays off until the audio
  of the text on screen is generated, so its length is known, and when that audio is longer than
  4 minutes 30 seconds. While a recording runs, the text is locked, so the avatar says the text
  that was checked. Every failure shows one message with the server's
  code under it, including an unpaid ElevenLabs plan (`elevenlabs_payment`). After Stop, the
  finalize job is polled every 2 seconds with a status line; after 3 minutes it says the recording
  is still processing and offers Check again. Leaving the screen stops the polling and coming back
  resumes it. A finished recording is saved to the library as a new entry waiting for video review.
  "Record this answer" on a ready entry opens the screen with the approved text read only, and
  "Attach to this answer" gives the entry its video (a recording of another answer's text cannot
  be attached, and the screen says so). Finished recordings that are not in the
  library are listed under the steps, with Save to library and, for a ready entry with the same
  text, Attach. The mock API now runs the whole recording chain, so the screen can be tried
  without providers.
- The web route `/avatar` and its Settings row are gone (the workbench moved to the admin target).
  `/avatar` now shows the not-found page.
- The daily retention sweep now deletes library media. It removes the MP4 and the video row of a
  withdrawn library entry, and of a video that was rejected from an entry and that no entry uses.
  The entry and every audit row stay. A file that cannot be deleted is skipped and keeps its row,
  so the next run tries it again, and the sweep still deletes the others.
- Recorded answers play on `/video` and `/audio` in the mobile app and the web app. While no
  conversation runs, up to six suggested questions in the screen's language are listed under
  Start, and Start does not move when they arrive. A tap downloads the whole answer through the
  API client and plays it from a local `blob:` URL: `/video` shows the video over the stage,
  `/audio` plays its sound while the orb speaks. Both show a "Recorded answer" label and the
  answer text. Stop, the end of the answer, a new tap, Start and leaving the screen each stop the
  answer and free its memory; after an answer the lead card shows (see the entry above). A refused autoplay shows "Tap to play the answer". An answer that was withdrawn meanwhile
  leaves the list, too many plays ask the user to wait, and an offline or failed download offers
  Retry. The widget does not change. The mock now serves a small real MP4, so the
  player can be tried without a backend.
- The admin target has an Answer library screen (`/library`, "Answer library" in the sidebar).
  Staff search the entries by key or question and filter them by status, language, category,
  section type and technical, page by page. Opening an entry shows a panel for its state: a
  `pending` entry gets an editor for the spoken answer with the six rewrite rules beside it and a
  live character counter (a warning above 350, Mark ready disabled above 480); `ready` and `draft`
  entries keep their question and category fields editable; a `draft` or `published` entry plays
  its video, downloaded as a blob through the API client. The actions are Mark ready, Reopen
  text, Publish, Reject video, Unpublish and Withdraw; Withdraw and Reject video ask for
  confirmation first. Every status change sends the status the screen showed (`fromStatus` is now
  required in the entity's type), and when another admin changed the entry meanwhile the panel
  says so and shows the current state. What the admin typed stays in the field when the field is
  still editable, and otherwise shows next to the server's text as "Your unsaved text" until they
  dismiss it or close the panel. Recording an answer is not on
  this screen yet. English and Persian, right to left in Persian.
- The answer library can be filled from the render sprint's files. `library_import --results`
  reads a render run's results JSON and MP4 files into `draft` entries, each with a new video row
  and a copy of its MP4 (`LIB_<external_id>.mp4`), or attaches a video to the `ready` or `pending`
  entry with the same key and text. `library_import --source` reads the not-rendered answers into
  `pending` entries, with the rewrite pass's verdicts settling `classify` rows. Both check every
  row first and write nothing when one fails, and `--dry-run` only checks. `library_export` writes
  the `ready` entries in the render script's input format. The commands run inside the orchestrator
  container and print keys and reason codes only (`apps/api/README.md`).
- The API has an answer library, backend only. Staff keep questions with an approved spoken
  answer and a recorded video in two new tables (`library_entries`, `library_entry_reviews`,
  migration 006). An entry moves `pending`, `ready`, `draft`, `published`, and can be withdrawn for
  good; every change goes through one status route and one transition table, is guarded by the
  current status (and by the status the admin's screen showed, when it sends `fromStatus`), and
  writes one audit row with the admin's id and no text. Publishing approves a generated video, and
  rejecting a video rejects it, with the same `asset_reviews` row as the asset review route.
  Admins can list, filter, create and edit entries, and list finished recordings no entry uses
  yet. Signed-in users get up to six suggested questions in their language, the whole video of a
  published answer (always `200`, never a partial answer, and not stored by any cache), and up to
  three follow-up questions one step further on. A played answer writes a usage row with
  `cache_hit` true and no user id, and plays are limited to 60 per user per hour
  (`LIBRARY_PLAYBACK_RATE_LIMIT_PER_HOUR`), with a `Retry-After` header on the `429`. The widget's
  embed key gets `401` on every library route. The frontend has the `library-entry` entity and the
  mock routes.
- ElevenLabs speech now reports a plan payment problem clearly. The client raises
  `elevenlabs_payment` instead of the generic `elevenlabs_stream_error`, on both WebSocket paths
  (`apps/api/services/elevenlabs/client.py`), when the speech WebSocket answers with an error
  `payment_issue`, or any error at code 1008 (a pay-as-you-go plan gets this for an instant-cloned
  voice too, as `ivc_not_permitted`), or closes the socket with close code 1008.
  `/avatar/speak` returns it to the admin like any other provider error. The message is fixed
  English text; the provider's own text is never logged or returned.
- Stopping a recording no longer holds the request open. `POST /api/assets/video/{id}/finalize`
  stops Egress and answers `202` with a job id at once; a `finalize_video` job waits for the MP4
  (up to `FINALIZE_FILE_WAIT_SECONDS`, 30 by default, twice the old 15), probes it and marks the
  asset `VIDEO_GENERATED`. The `/avatar` workbench polls the job every 2 seconds and shows the
  same success and error states as before, plus a timeout error with a retry after 3 minutes. A
  failed job shows a translated message for its error code, in English and Persian.
  Finalize now needs a `DRAFT` asset, so it can no longer turn a rejected video back into a
  generated one, and a repeated or parallel finalize returns the same job instead of stopping
  Egress twice.
- The API runs background jobs. A runner inside the API process claims one due job at a time from
  `generation_jobs` with a 60 second lease, renewed every 20 seconds, so a job whose process died
  is picked up again. Retryable failures are retried with backoff up to the job's attempt limit;
  every failed attempt logs `job_attempt_failed` and a job that fails for good logs `job_failed`,
  with ids and counts only. `GET /api/jobs/{jobId}` reports a job's status to the user who started
  it or to an admin, and answers `404` to anyone else. A daily `retention_sweep` job deletes
  finished jobs after 30 days and keeps every failed job.
- A BYO LiveAvatar session (`LIVEAVATAR_TRANSPORT=byo`) can start. The avatar's LiveKit token
  had `canSubscribe` off, and LiveAvatar refuses such a token with a 422, so every BYO session, and
  with it every recording, failed. The token now allows subscribing.
- Approving a recording needs the finished media, and every decision is recorded. The status
  endpoint set any status from any status, so a video that was still recording (`DRAFT`) could be
  approved, and a rejected one approved again. Approval now needs `VIDEO_GENERATED` (or
  `AUDIO_GENERATED`), a rejection needs the generated or the approved status, and anything else
  answers `409 invalid_status_transition` with no change. The check and the change are one
  database statement, so two reviewers at once cannot both pass it. Each accepted decision writes
  one `asset_reviews` row: the reviewer's user id, the decision, the previous status and the time,
  never the asset text.
- The recording endpoints need an admin session. `/tts/generate`, `/avatar/*`, `/assets/*` and
  `/usage` had no check at all, so anyone who reached the API could start paid LiveAvatar
  sessions, spend ElevenLabs characters, record, approve and download assets. They now answer
  `401` without a session and `403` for a user who is not an admin or whose account is disabled,
  before the request is validated, so a body that fails validation gets `401` too. A body that is
  not valid JSON is the exception and answers `422`. `/ws/status` stays open; it shows only a
  session count. The
  web `/avatar` page still opens, but every API call it makes needs an admin session, because
  recording moves into the admin target.
- The assistant now reports each avatar answer, so `provider_usage` gets one `assistant_answer`
  row per answer on mobile, web and the widget. The hook measures each speech segment, from
  `AVATAR_SPEAK_STARTED` to its end, and sends the index and the length in batches of up to 20. The
  last batch goes out before `close`, because the backend refuses a report for a closed session.
  A failed report is retried at most once and is never shown to the user.
- The backend can record one usage row per avatar answer. The backend never observes an answer
  (the browser drives the conversation), so a saving from cached answers could not be measured
  from `provider_usage` at all. `POST /api/assistant/session/{id}/answers` takes the index and the
  length of each speech segment the browser measured and writes an `assistant_answer` row. Only
  numbers are sent, never text.
- A LiveAvatar validation error is no longer reported as a billing problem. The provider answers a
  bad request with a 422 whose message lists every valid value for the field, and one valid stop
  reason is `NO_CREDITS`. The client matched "credit" anywhere in the message, so "reason must be
  one of ..." surfaced as "LiveAvatar credits or concurrency are exhausted" and sent whoever was on
  call to the billing panel. A 422 is never a quota error.
- "The browser blocked the sound. Tap the circle to hear it." no longer appears when nothing is
  blocked. The avatar's stream was attached twice, once when `SESSION_STREAM_READY` arrived and
  once after `start()` resolved. The second attach assigns `srcObject` again, which interrupts a
  `play()` that has not resolved yet, and the browser rejects that call with `AbortError`. The
  hook caught every rejection and reported a blocked autoplay. The stream is now attached once
  per session, and an `AbortError` is the one rejection that is not treated as a block. Any other
  rejection still offers the tap, including one this code has never seen: a user who cannot hear
  the doctor and has nothing to press is the worse failure.
- The floating menu is icons only. Each item keeps its word as screen-reader text, so the
  accessible name and voice control are unchanged. The labels had made the pill wide enough to
  crowd the corner controls above it on a phone.
- The video conversation uses the same controls as the voice one. `/video` had a pill of
  labelled buttons at the bottom; it now has the same four glass circles in the four physical
  corners that `/audio` got in the control overhaul: End top left, type top right, interrupt
  bottom left, microphone bottom right. Typing a turn works on `/video` as well, from the
  shared `ConversationComposer`. A row of status chips became the one static session line, and
  the offline, audio-blocked, weak-connection and time-warning alerts became the one notice
  line, both of them the same as `/audio`. Switching between the two screens no longer means
  learning the controls twice.
- The four conversation controls are one size and one material. The microphone was a 64 px
  solid accent disc among three 48 px glass circles, which made it the loudest thing on a
  screen whose subject is the person talking. Mute still reads at a glance: the glyph carries
  the slash. End lost the word "پایان" under it, the only visible label in the layer; the red
  handset says what it does and the name still reaches a screen reader and voice control.
- Real SMS delivery can be checked without guesswork. An opt-in test
  (`tests/integration/provider/test_real_asanak.py`) sends one real code through Asanak and names
  the cause when it fails, telling a blocked IP apart from a wrong web service password. The
  opt-in mechanism it uses never worked: an autouse fixture stripped every `Settings` variable
  from the environment, `REAL_PROVIDER_TESTS` among them, so every provider test skipped itself
  even when asked to run.
- The login code is no longer echoed back to the browser once a real SMS is sent. `devCode` used
  to depend on `APP_ENV=development` alone, so a development machine with `OTP_DELIVERY=asanak`
  showed the code on the login screen next to the input while also sending it by SMS. It now
  needs console delivery as well, where there is no message to read. Setting `APP_ENV=production`
  instead would have marked the session cookie `Secure` and broken login over plain `http`.
- The documented test command works again. Since the Turborepo migration, `pnpm test --run` was
  parsed by `turbo` as one of its own options: it printed a usage dump, ran zero tests, and looked
  like a test failure. `@app/frontend`'s `test` script is now `vitest run`, so the command is plain
  `pnpm test` everywhere (docs, CI). Watch mode moved to
  `pnpm --filter @app/frontend test:watch`.
- Added an optional date of birth. Onboarding step 1 now collects it next to the name, and it
  stays editable on `/settings/personal`. The field is a Jalali (Solar Hijri) date: the user
  types Persian years and months, and the app stores a Gregorian `YYYY-MM-DD`. The calendar is
  forced to Persian in both interface languages, so the birthday reads the same in `fa` and in
  `en`. `users.birth_date` (migration `003_birth_date.sql`) holds it, `PUT /api/me/profile`
  accepts and clears it, and `GET /api/me` returns it. Conversion lives in one file,
  `src/features/profile/jalali.ts`, built on `@internationalized/date`, the calendar engine
  React Aria already uses. Leaving the field empty is fine and does not block onboarding.
  The shared name fields grew into `ProfileFields`, used by both screens: the endpoint is a
  full replace, so a screen that left the birthday out would clear it on every save.
- The theme picker on `/settings/appearance` is a HeroUI `ListBox` instead of a radio group.
  The rows are full-width press targets and the list cannot end up with nothing selected.
- "Reduce transparency" became a slider, 0 to 100, instead of an on/off switch. The glass
  effect now scales with the level: blur, saturation, brightness and the edge ring fade out
  while the tint fades in, so the middle of the slider is a real middle. The top of the scale
  still drops `backdrop-filter` outright rather than leaving a `blur(0px)` compositing layer.
  A setting saved as the old boolean is read back as 0 or 100, so nobody's choice resets.

- Added `PUT /api/me/profile` so a signed-in user can set their first and last name. It is a
  full replace: both fields are required, and the response is the whole updated user. No
  migration was needed; the `users` table already had `first_name` and `last_name` columns.
  The frontend treats an empty `firstName` as the signal that onboarding is not finished; there
  is no separate "new user" flag.
- Turned the MVP into the product "Dr. Kohandezh Assistant" (Persian: دستیار دکتر کهن‌دژ). Every
  starter string ("Cross-Platform App", "One codebase for mobile, web, and admin", the Phase 1
  status text) is gone from the four targets, the HTML titles, the PWA manifest, and the
  Capacitor config (`com.kohandezh.assistant`). New app icon (accent-blue rounded square with a
  speech bubble) in `public/icons/`, generated from `favicon.svg`; the workflow is in
  `docs/DEVELOPMENT.md`. Persian text now renders in Vazirmatn (`@fontsource/vazirmatn`,
  weights 400/500/700, imported by the mobile, web, and admin entries; the widget keeps the
  system font because `@font-face` does not work inside its Shadow DOM).
- Reworked navigation for the mobile app and the web PWA. `/` is a landing screen for visitors
  (what the product is, one "Start a conversation" action, three "How it works" steps) and sends
  a signed-in user straight to `/assistant`. The mobile tab bar has two tabs, Conversation and
  Profile, and is hidden until the user signs in. The web header shows Conversation and Profile
  only when signed in, and the Phase 1 workbench link (`/avatar`) only to admins; the route
  itself is unchanged. The profile page became an account page (avatar with initials, details,
  a settings card with the language select, log out). Not found and forbidden pages use the
  shared `EmptyState`. See the Navigation section in `ARCHITECTURE.md`.
- Finished the HeroUI v3 migration in the pages, layouts, and features that still used raw
  palette classes. Language switching uses HeroUI `Select`; the voice/video switch and the
  widget language switch use `ToggleButtonGroup`; the widget close control is `CloseButton`; the
  admin users screen uses `SearchField`, `Table`, and `Pagination`; the admin layout uses
  `Avatar` and token colors. Transcript turns render as chat bubbles and the avatar's turns are
  labelled "Dr. Kohandezh". The sandbox chip reads "Trial mode".
- Removed unused Phase 1 i18n keys (`home.intro`, `home.phase*`, `home.webrtc*`,
  `app.phaseNotice`, the `settings` group, ...) after checking that no code reads them.
- Added `*-mock` entries to `.claude/launch.json` that start each target against the mock API
  regardless of `.env.development.local`, for browser verification without the backend.
- Fixed the website widget for mouse users. React Aria checks which element is under the
  pointer when a press ends; inside the widget's Shadow DOM that element is the shadow host, so
  every mouse click on a HeroUI button (including Start) was cancelled while touch worked. The
  widget mount now calls `enableShadowDOM()` from `react-stately` before the first render, and
  `react-stately` is declared as a direct dependency for that import. `border-solid` is set
  explicitly where the widget draws borders, because Tailwind v4's `@property` border style is
  not applied inside a shadow root.
- Tests: new integration tests for the landing (`homePage.test.tsx`), the mobile tab bar
  (`mobileLayout.test.tsx`), and admin pagination; the e2e specs assert the product strings.

- Adopted HeroUI v3 (`@heroui/react`, `@heroui/styles`) as the component library across mobile,
  web, admin, and widget, replacing the hand-made Tailwind components in `src/shared/ui`. See
  `docs/DECISIONS/0011-heroui-component-library.md` for the reasons and the component mapping.
  Added agent tooling for it: the `heroui-react` MCP server (`.mcp.json`) and the HeroUI agent
  skill (`.claude/skills/heroui-react/`).
- Replaced email/password login with phone login (ADR 0002 stays the model, the credential
  changes). A user enters a phone number, gets a one-time code, and verifies it. Web keeps the
  code in the `kd_session` HttpOnly cookie; native gets a bearer token. In development the code
  is `console`-delivered and also returned as `devCode` so the flow can be tested without SMS.
  In staging and production, `OTP_DELIVERY=asanak` sends the code by real SMS through Asanak,
  from the customer's sender line using the approved OTP template (both set in `.env`). Phones listed in `ADMIN_PHONES`
  get the admin role. New backend routes `POST /api/auth/otp/request`, `POST /api/auth/otp/verify`,
  `POST /api/auth/logout`, and a `users` table (migration `002_assistant.sql`).
- Added the real-time assistant: one shared `features/assistant` feature and
  `entities/assistant-session` entity, used by the mobile app, the web app, and the website
  widget. It has a voice mode and a video mode, a transcript of the conversation, mic mute,
  interrupt, and a countdown for the sandbox time limit. The backend mints a LiveAvatar session
  token per conversation (`POST /api/assistant/session`, `POST /api/assistant/session/{id}/close`)
  and the browser drives the session with LiveAvatar's own SDK, so nothing of ours needs to be
  publicly reachable. Every session runs in LiveAvatar sandbox mode: no credits are spent, the
  session ends after about 60 seconds, and only the public "Wayne" avatar is used.
- Added two provider modes for the assistant, chosen by backend configuration. Persian
  conversations use LiveAvatar's stored Voice Agent (`LIVEAVATAR_VOICE_AGENT_ID`), which wraps
  the customer's own ElevenLabs agent; English conversations use LiveAvatar FULL mode with a
  Context persona (`LIVEAVATAR_CONTEXT_ID`), and fall back to a supported language when the
  caller asks for one FULL mode cannot start. The response carries `agentType: "elevenlabs" |
  "full"` so the frontend picks the matching SDK session class, and duplicate transcript events
  from the two providers are removed. Reason: LiveAvatar FULL mode does not support Persian today
  (`language: "fa"` is accepted when the token is minted but rejected at session start, and no
  STT provider or the ElevenLabs model behind FULL mode understands Persian yet), while the
  customer's ElevenLabs agent and LiveAvatar Voice Agent pairing already speaks Persian with a
  cloned voice. Verified against the real provider on 2026-09-11: both paths mint a token, start
  a sandbox session, and stop it cleanly.
- Added the website widget: a fourth Vite build target (`APP_TARGET=widget`, ADR 0010) that
  builds the shared assistant panel into one script a customer adds with a `<script>` tag. It
  renders inside a Shadow DOM so none of the widget's styles leak onto the customer's page and
  none of the customer's styles leak in. It authenticates with a public embed key
  (`ASSISTANT_EMBED_KEY`) instead of a user session; an origin allowlist
  (`ASSISTANT_EMBED_ALLOWED_ORIGINS`) and a per-visitor rate limit
  (`ASSISTANT_RATE_LIMIT_PER_HOUR`) are what actually protect the account, because the key itself
  is public. The widget has no router and no Redux store.
- Added explicit CORS: FastAPI now rejects any browser origin not in `CORS_ALLOWED_ORIGINS`, with
  credentials allowed only for that list. The website widget's allowed origins are added to it
  automatically.
- Ignored `.claude/worktrees/` in `.gitignore`. The desktop app checks out one worktree per
  agent there, and those checkouts must never be committed.
- Updated the end-to-end and mock-API coverage for all of the above: the web smoke test now
  expects login to land on `/assistant` (the product's main screen, replacing the old redirect to
  home), and `src/data/mock/handlers.ts` grew routes for OTP request/verify and for the assistant
  session so `pnpm dev` still works without a backend.
- Switched the package manager from npm to pnpm (ADR 0009). `pnpm-workspace.yaml` replaces the `workspaces` field, and `packageManager` pins the version for `corepack`. Updated CI, `.claude/launch.json`, the Playwright dev-server commands, and every documented command.
- Declared `workbox-window` as a devDependency. `vite-plugin-pwa` generates a virtual module that imports it, but the app had never declared it; npm's flat `node_modules` made it resolve anyway. The web build failed under pnpm until it was declared. This was a real missing dependency, not a pnpm quirk.
- Allowed the `esbuild` install script through `onlyBuiltDependencies`. pnpm 10 blocks dependency install scripts by default, and esbuild needs its own to place the platform binary Vite runs.
- Moved to a monorepo (ADR 0008). The frontend is now `apps/frontend/` and the backend is `apps/api/`. The root `package.json` declares the workspace and delegates every script, so `npm run dev`, `npm run lint`, `npm run build`, `npm test`, and `npm run test:e2e` still run from the repository root. Build output moved to `apps/frontend/dist/<target>/`. No frontend config content changed: they all use `import.meta.dirname` or relative paths. ADR 0004 is superseded in the single-package part only.
- Fixed four e2e tests that failed on a Playwright strict-mode violation. `getByRole('link', { name: 'Log in' })` matched both the navigation link and the "Log in to see your profile" button, because `name` matches by substring. Added `exact: true` to the four ambiguous selectors.
- Recorded the backend stack decision: Python with FastAPI (ADR 0006), chosen because the product's work is mostly machine learning. Proposed generating the API contract from the backend's OpenAPI document (ADR 0007). Updated `ARCHITECTURE.md` (now 0.4), `docs/API.md` (error shape, `202` job convention, SSE streaming), `docs/DEVELOPMENT.md`, `docs/DEPLOYMENT.md` (cloud and on-premise shapes), `docs/SECURITY.md` (AI gateway logging, upload limits, runtime secrets), `docs/DATA_MODEL.md`, `README.md`, `AGENTS.md`, `CLAUDE.md`, and `docs/CONTRIBUTING.md`.
- Added Engineering Standards and UI/UX Engineering Standards to `AGENTS.md`: engineering judgment, phased workflow, over- and under-engineering rules, STOP conditions, code quality bar, testing and security standards, documentation honesty, and a Definition of Done. `CLAUDE.md` now imports `AGENTS.md` and adds an execution workflow. `docs/CONTRIBUTING.md` and `README.md` point to them.

## 0.3.0

- Split the build into three targets from one codebase: `mobile` (Capacitor), `web` (PWA), and `admin` (dashboard). `APP_TARGET` selects the Vite root; outputs go to `dist/<target>/` (ADR 0004).
- Added the web PWA: `vite-plugin-pwa` manifest, Workbox service worker, update prompt, offline banner, generated placeholder icons (`npm run icons`).
- Added the admin dashboard: login, `RequireAuth` and `RequireRole` guards, sidebar layout, dashboard summary, users table with search and pagination.
- Added the authentication feature (login, logout, session from `GET /api/me`) and the `settings` feature (language in Redux, synced to `<html lang dir>`).
- Wired i18next with `en` and `fa` resources. All UI text goes through `t()`.
- Added Zod schemas for `User`, `DashboardSummary`, and paginated responses.
- Added shared UI components (`Button`, `Input`, `Card`, `Badge`, `Spinner`, `LoadingState`, `EmptyState`, `ErrorState`, `OfflineBanner`).
- Added a mock API (`src/data/mock`) behind `VITE_API_MOCK=true` (ADR 0005). `npm run dev` works without a backend.
- Web token store is now in memory; the web session is a cookie (ADR 0002). Native keeps using the secure-storage adapter.
- Added missing tooling: `@tailwindcss/vite`, `typescript-eslint`, `@capacitor/cli`, `jsdom`, Vitest config, Playwright config, `@/` path alias, `vite-env.d.ts`.
- Added unit, integration, and e2e tests. CI runs Playwright on Chromium.
- Updated `ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md`, and all docs for the three targets.

## 0.2.0

- Added CLAUDE.md.
- Added AGENTS.md.
- Added root ARCHITECTURE.md.
- Added ADRs for architecture, authentication, and state management.
- Added PWA manifest.
- Expanded project documentation and coding-agent rules.
- Added platform abstractions and API/storage boundaries.
