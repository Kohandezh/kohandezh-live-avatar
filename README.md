# Dr.Kohandezh Live Avatar — Phase 1

Local, Dockerized infrastructure proof for a hybrid cached/live Persian avatar. Phase 1 intentionally excludes WordPress, CRM, RAG, business conversation flows, authentication, production UX, and bulk asset generation.

## Architecture

```text
React + TypeScript + Vite + HeroUI (PWA, Capacitor-ready)
  | HTTPS/WS + scoped subscriber JWT (same-origin /api)
  v
Nginx :8088 ---> FastAPI orchestrator
                    |         |              |
                    |         |              +--> PostgreSQL metadata/usage
                    |         +-----------------> Redis locks/session state
                    |
                    +--> ElevenLabs HTTP or WebSocket
                    |      -> raw PCM S16LE, 24 kHz, mono
                    |      -> deterministic audio cache
                    |
                    +--> LiveAvatar LITE session/event WebSocket
                              | BYO publisher JWT
                              v
                         LiveKit :7880/:7881/:7882
                              |             |
                         Browser WebRTC   Egress worker
                                              |
                                         H.264/AAC MP4
                                              |
                                      services/media/video
```

LiveAvatar is only the real-time renderer. The application owns TTS, caching, session lifecycle, interruption, listening state, Egress, media metadata, and usage accounting.

The frontend is a standalone application, not a WordPress plugin or embed. WordPress, PHP, CRM, scheduling, RAG, payments and production authentication are permanently out of scope for this repository.

## Services

| Service | Responsibility | Host exposure |
|---|---|---|
| `frontend` | React/Vite PWA (built in a multi-stage image) served by Nginx, which also reverse-proxies `/api` | `8088/tcp` by default |
| `orchestrator` | FastAPI REST/WebSocket API and provider coordination | internal only |
| `livekit` | Rooms, participants, WebRTC signaling/media | `7880/tcp`, `7881/tcp`, `7882/udp` |
| `livekit-egress` | Room-composite MP4 recording | internal only |
| `postgres` | Persistent sessions/assets/jobs/usage metadata | internal only |
| `redis` | Locks, deduplication, short-lived session state | internal only |
| `media-init` | Local-development bind-mount permissions | one-shot, internal only |

PostgreSQL and Redis use named volumes. Audio, video, and JSON metadata use bind-mounted directories under `services/media/` so test artifacts are directly inspectable. `media-init` makes those local development directories writable by the non-root application and Egress containers; production should use purpose-built ownership and permissions instead of mode `0777`.

## Setup

Requirements: Docker Desktop/Engine with Compose v2+, at least 4 CPUs and 4 GB available for Egress, and `curl`, `jq`, and `ffprobe` for the smoke script.

```bash
cp .env.example .env
```

Set strong local values for `POSTGRES_PASSWORD` and `LIVEKIT_API_SECRET`, then configure:

- `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` for a Persian-capable voice.
- `ELEVENLABS_MODEL_ID`; the default `eleven_v3_conversational` uses Text-to-Dialogue. Other supported models use the standard TTS endpoint.
- `LIVEAVATAR_API_KEY` and `LIVEAVATAR_AVATAR_ID`. The example avatar is the documented LITE sandbox avatar.
- `PUBLIC_LIVEKIT_URL` and public WebRTC networking before any real LiveAvatar session.

Start and stop:

```bash
docker compose up -d
docker compose ps
docker compose down
```

Open <http://localhost:8088>. Provider credentials stay in the orchestrator container and are never placed in the browser bundle. `docker compose up -d --build frontend` rebuilds the web bundle after frontend changes.

## Frontend (services/frontend)

React 19 + TypeScript + Vite 7 + HeroUI v3 (Tailwind CSS v4) + TanStack Query + Redux Toolkit + React Router + i18next (Persian RTL default, English) + `vite-plugin-pwa` + `livekit-client`. Capacitor is configured (`capacitor.config.ts`) but no native shells are generated in Phase 1.

```text
services/frontend/src
├── app/        bootstrap, providers (Redux, Query, i18n, theme), router, store, layout
├── pages/      home (health + phase status), avatar-session (console), not-found
├── features/   avatar-session, text-to-speech, recording, diagnostics
├── entities/   session, audio-asset, video-asset (DTO -> domain mapping, queries)
└── shared/     api (the only fetch), config, i18n, platform, storage, hooks, ui, utils
```

Rules enforced by ESLint: `UI component -> feature hook -> shared/api client -> FastAPI`. No `fetch()` outside `shared/api/client.ts`; `shared/` never imports higher layers; `features`/`entities`/`shared` never import `app` or `pages`. Server state lives in TanStack Query; Redux holds only client-owned UI state (locale, theme, composer draft, session/recording handles, diagnostics log). The scoped LiveKit browser token is passed straight to the LiveKit SDK and is never stored in Redux, persisted or logged (the diagnostics log redacts credential-shaped values).

Development against the running Compose stack (Vite proxies `/api` to `http://localhost:8088`):

```bash
cd services/frontend
pnpm install
pnpm dev            # http://localhost:5173
pnpm check          # typecheck + lint + prettier + vitest
pnpm test           # vitest only
pnpm build          # production bundle + service worker in dist/
pnpm preview        # serve dist/ locally
pnpm icons          # regenerate PNG icons from public/icons/*.svg (macOS qlmanage)
```

Environment files: `.env.development`, `.env.production`, `.env.test` (see `.env.example`). Only `VITE_*` values reach the bundle and all are public. `VITE_API_BASE_URL` defaults to the same-origin `/api`; a Capacitor build must use an absolute URL.

PWA: `vite-plugin-pwa` generates the manifest (`fa`/`rtl`, installable, SVG + 192/512 PNG icons, maskable icon) and a Workbox service worker that precaches only the app shell (`js/css/html/svg/png/woff2/webmanifest`). `/api` is on the navigate-fallback denylist and no API or media response is ever cached. Offline mode shows a banner and disables network actions; LiveKit/WebRTC streaming and provider calls genuinely require a network connection.

Manual QA (not a Phase 1 blocker): service-worker registration and the install prompt are verified only at the HTTP level (`/sw.js` and `/manifest.webmanifest` served with the right MIME types and `no-cache`). Confirm registration and installability once in a normal Chrome/Edge profile on `http://localhost:8088` (DevTools → Application → Service Workers / Manifest); embedded browser panes block registration.

Capacitor: `capacitor.config.ts` keeps the bundle compatible (`appId` `com.kohandezh.liveavatar`, `webDir` `dist`). Platform-specific code stays behind `shared/platform/` (`isNative`, connectivity, deep links, WebRTC capability probe) and `shared/storage/` (preferences). Android/iOS release builds are not part of Phase 1, and the `Capacitor WebView -> WebRTC -> LiveKit -> media permissions` path still needs explicit validation before any native build counts.

Authentication is not implemented. `shared/api/client.ts` exposes `setCredentialsProvider` / `setUnauthorizedHandler` so the future model (web: HttpOnly Secure SameSite cookie; native: Bearer token in platform secure storage) can be added without rewriting feature calls.

## Provider contracts

### ElevenLabs

`POST /api/tts/generate` accepts UTF-8 text and synthesis controls. The response is raw `pcm_24000`: signed 16-bit little-endian, 24,000 Hz, mono. The server validates frame alignment and duration before caching. The v3 default uses `/v1/text-to-dialogue`; its WebSocket path uses `/v1/text-to-dialogue/stream-input`. Non-v3 models use `/v1/text-to-speech/{voice_id}` and its streaming WebSocket.

Every synthesis parameter is part of canonical sorted JSON before SHA-256 hashing:

```text
text, voice_id, model_id, speed, stability, similarity,
style, language, output_format
```

The PCM is stored as `services/media/audio/<sha256>.pcm`; metadata is stored as `services/media/metadata/audio-<sha256>.json` and in PostgreSQL. A Redis lock prevents simultaneous duplicate billing. Cache hits are recorded as usage events but do not call ElevenLabs.

### LiveAvatar LITE

The orchestrator creates a BYO LiveKit room and two least-privilege tokens: a publish-only token for LiveAvatar and a subscribe-only token for the browser. It creates and starts a LITE session, waits for `session.state_updated` with state `connected`, then supports the exact LITE commands:

- `agent.speak`, with one shared `event_id` and raw PCM chunks
- `agent.speak_end`
- `agent.interrupt`
- `agent.start_listening` / `agent.stop_listening`
- `session.keep_alive`

Speech requests wait for the matching `agent.speak_ended`, so Egress is not finalized before rendering completes. Current canonical teardown is `DELETE /v1/sessions` with the bearer session token. Cleanup closes the event socket and explicitly terminates the provider session even on start failure or application shutdown.

### Public BYO LiveKit prerequisite

`ws://localhost:7880` is sufficient only for local LiveKit/browser tests. LiveAvatar runs in the cloud and cannot reach it. A real BYO test requires:

- a trusted public `wss://` endpoint in `PUBLIC_LIVEKIT_URL`;
- DNS/TLS termination for signaling;
- an advertised public node IP;
- reachable ICE/TCP `7881` and ICE/UDP mux `7882` (or a correctly configured UDP range/TURN deployment).

Do not replace this with LiveAvatar-managed LiveKit: doing so would bypass the project’s Egress acceptance path.

## API

The UI uses these same-origin routes through Nginx (typed wrappers live in `services/frontend/src/shared/api/`):

```text
GET    /api/health
POST   /api/tts/generate
POST   /api/avatar/session
POST   /api/avatar/speak
POST   /api/avatar/interrupt
POST   /api/avatar/listening/{start|stop}
POST   /api/avatar/close
POST   /api/assets/generate-video
POST   /api/assets/video/{uuid}/finalize
GET    /api/assets/audio/{uuid}
GET    /api/assets/video/{uuid}
PATCH  /api/assets/{audio|video}/{uuid}/status
GET    /api/usage
WS     /api/ws/status
```

Generated assets are never auto-approved. Valid manual states are `DRAFT`, `AUDIO_GENERATED`, `AUDIO_APPROVED`, `VIDEO_GENERATED`, `VIDEO_APPROVED`, and `REJECTED`; approval routes enforce the media kind.

## Credit-safe testing

Automated tests use mocks and synthetic media. Real provider tests are disabled by default.

```bash
docker compose build
docker compose run --rm orchestrator pytest -q
docker compose run --rm orchestrator ruff check .
(cd services/frontend && pnpm check)
./scripts/healthcheck
```

The frontend suite (Vitest + Testing Library + MSW) covers the API client and error normalization, the TTS / avatar-session / recording hooks against a mocked contract, and the loading, empty, error, disconnected and offline states of the key panels. The Python suite additionally asserts that no frontend source or env file references server secret names.

Useful credit-free checks:

```bash
curl -fsS http://localhost:8088/api/health | jq
curl -fsS http://localhost:8088/
docker compose logs --tail=200 orchestrator livekit livekit-egress
```

The Python unit suite validates cache identity/hit/miss/corruption, PCM format and chunking, provider error classification, exact LiveAvatar events and teardown, scoped LiveKit grants, API validation/secrets boundaries, and H.264+audio MP4 probing.

Credit safety in the UI: **Generate audio** and **Send to avatar** call ElevenLabs / LiveAvatar through the orchestrator whenever real credentials are configured in `.env`. Identical text is served from the deterministic cache and does not call ElevenLabs again. **Start avatar** fails fast with `configuration_error` (503) until `PUBLIC_LIVEKIT_URL` is a public `wss://` endpoint, which makes the session error path testable without credits.

## One real smoke test

Run this only after all tests pass, provider credentials are configured, and `PUBLIC_LIVEKIT_URL` is publicly reachable:

```bash
REAL_PROVIDER_TESTS=true CONFIRM_CREDIT_USAGE=YES ./scripts/real-provider-smoke
```

The script is deliberately gated twice and uses one short Persian sentence. It creates one LiveAvatar session, starts Egress, streams one ElevenLabs utterance, waits for avatar completion, finalizes and downloads the MP4, runs `ffprobe`, closes the session, and prints the usage endpoint. Its trap attempts explicit session teardown on every failure.

To test only ElevenLabs (also consumes credits):

```bash
CONFIRM_CREDIT_USAGE=YES ./scripts/generate-test-audio
```

Repeating the identical request must return `cache_hit: true` and must not make a second provider call.

## Troubleshooting

- **Compose fails before startup:** copy `.env.example` to `.env`; required database and LiveKit secrets cannot be blank.
- **LiveAvatar configuration error:** `PUBLIC_LIVEKIT_URL` is still local/non-TLS. Configure public `wss://` signaling and reachable RTC ports.
- **Browser connects but has no media:** inspect LiveKit participant/ICE logs; confirm `7881/tcp` and `7882/udp` reach the advertised node IP. The console's Diagnostics panel lists every LiveKit track/participant/connection event.
- **Avatar video has no sound:** browsers block autoplay audio without a gesture; the video panel shows an *Enable audio* button when LiveKit reports playback is blocked.
- **Frontend shows an old bundle:** the image bakes `dist/` at build time; run `docker compose up -d --build frontend`.
- **Egress unhealthy:** allocate at least 4 CPU/4 GB, retain `SYS_ADMIN`, verify it shares Redis with LiveKit, and check `docker compose logs livekit-egress`.
- **No MP4:** ensure `services/media/video` is writable and Egress can resolve `livekit` and `redis`. Finalization rejects missing, corrupt, zero-duration, non-H.264, or audio-less output.
- **PCM rejection:** raw PCM has no header. It must contain complete signed 16-bit LE frames at 24 kHz mono; use `ffmpeg -f s16le -ar 24000 -ac 1` explicitly when inspecting/converting.
- **Quota errors:** no indefinite retries occur. ElevenLabs `429` and LiveAvatar credit/quota failures return actionable categories.
- **PostgreSQL/Redis unavailable:** `/api/health` becomes degraded and Compose health dependencies prevent the orchestrator from starting prematurely.

## Persistence and cleanup

`docker compose down` preserves named database/Redis volumes and local media. `./scripts/cleanup` performs the same non-destructive stop. Removing volumes or media is intentionally not automated.

## Phase boundary

This repository provides Phase 1 interfaces for later cached/live orchestration and the Phase 2 asset factory, but it does not implement those product layers. Phase 1 is considered passed only after the real Text → ElevenLabs → PCM24 → LiveAvatar LITE → this LiveKit → browser → Egress → H.264 MP4 path has been observed and recorded.

Operational risk: this working copy is **not a Git repository**. Initialise Git and make a deliberate baseline commit (with `.env` excluded) before any VPS deployment; nothing here has version history yet.

Next milestone (Linux VPS): deploy the Compose stack, point `live.kohandezh.com` at the host, terminate HTTPS/WSS, set the LiveKit advertised public IP, expose `443/tcp`, `7881/tcp` and `7882/udp` only (PostgreSQL and Redis stay private), verify public browser WebRTC, then run exactly one authorised real provider session and validate the Egress MP4, database metadata and usage records.

Current verdict: **PHASE 1: FAIL**. Local infrastructure, automated tests and the local Egress MP4 are verified; the real ElevenLabs / LiveAvatar LITE / public `wss://` LiveKit / real browser playback / real Avatar → Egress MP4 path is still pending.
