# Render server

A short-lived server that records answer videos: a LiveAvatar avatar speaks each answer, and our
own LiveKit Egress saves it as an MP4. It was built and used in the render sprint of 2026-09-25
(120 answers, 69.6 minutes of video). This folder holds everything that sprint added on top of
the repository.

| File                        | What it is                                                        |
| --------------------------- | ----------------------------------------------------------------- |
| `docker-compose.server.yml` | Compose override: Caddy for TLS, and localhost-only ports         |
| `Caddyfile`                 | Caddy site: `wss://` on 443 to LiveKit's signalling port          |
| `render_answers.py`         | The render script. Runs inside the orchestrator container         |

Paths below are relative to the repository root unless they start with `/`. A bare file name is
a file in this folder, or the file named with its full path just before it.

## Why a server

Recording needs the avatar in a LiveKit room that we own, so our Egress worker can join and
record it. That is the BYO transport:

- With `LIVEAVATAR_TRANSPORT=managed`, the API refuses to record with `409 recording_unavailable`
  (`apps/api/services/orchestrator/src/main.py:368-376`).
- With `byo`, the API creates the room in our LiveKit (`apps/api/services/liveavatar/manager.py:82`).
- LiveAvatar's cloud must then join our LiveKit from the internet, so `PUBLIC_LIVEKIT_URL` must be
  a public `wss://` URL, not localhost. Otherwise the session fails with `configuration_error`
  (`manager.py:73-81`, `apps/api/services/orchestrator/src/config.py:186-187`).

A laptop behind a home router cannot offer that, so the sprint used a DigitalOcean droplet.

## Droplet

CPU-Optimized, 4 dedicated vCPUs, 8 GB RAM, Ubuntu 24.04 LTS, your SSH key.

Why this size: LiveKit says a self-hosted Egress needs at least 4 CPUs and 4 GB of memory, and a
RoomComposite recording can use 2 to 6 CPUs (docs.livekit.io/home/self-hosting/egress, read
2026-09-24). Our Egress counts 2 CPUs per room recording (`infra/livekit-egress/egress.yaml:13`).
Postgres, Redis, LiveKit and the API share the rest. The droplet is billed by the hour, so it is
destroyed after the sprint (see the last section).

Install Docker Engine with the Compose plugin from Docker's apt repository. The sprint used
Docker 29 and Compose v5.5.1.

## DNS

Add an A record, for example `livekit.<your domain>`, pointing to the droplet's public IP. Do it
before you start Caddy. Caddy asks for the TLS certificate on first start, and that only works
when the name already points to this server and ports 80 and 443 are open.

## Firewall

Open only these ports with `ufw`:

```bash
ufw allow from <your IP> to any port 22 proto tcp   # SSH, your address only
ufw allow 80/tcp                                    # TLS certificate
ufw allow 443/tcp                                   # wss:// to LiveKit, through Caddy
ufw allow 7881/tcp                                  # LiveKit media over TCP
ufw allow 7882/udp                                  # LiveKit media over UDP
ufw enable
```

Never open 7880 or 8088:

- 7880 is LiveKit signalling without TLS. The public entry is Caddy on 443.
- 8088 is the web app, and nginx behind it forwards `/api` to the API.

Closing them in `ufw` is not enough. Docker sends traffic for a published port through its own
iptables rules, and `ufw`'s rules never see it. So a port that Docker publishes on all addresses
is open to the internet whatever `ufw` says. The base file publishes 7880 and 8088 on all addresses
(`docker-compose.yml:50`, `docker-compose.yml:134`). The override publishes them on `127.0.0.1`
only (`apps/api/setup/server/docker-compose.server.yml:25-26` and `:30-31`). In the sprint both
were checked closed from outside. If you need the web app, use an SSH tunnel:
`ssh -L 8088:127.0.0.1:8088 root@<droplet IP>`.

## .env on the server

Copy your local `.env` to the server (never commit it). Then change these values:

```bash
LIVEKIT_DOMAIN=livekit.<your domain>          # new: Caddy's site name
LIVEAVATAR_TRANSPORT=byo
PUBLIC_LIVEKIT_URL=wss://livekit.<your domain>
LIVEKIT_NODE_IP=<droplet public IP>
LIVEAVATAR_SANDBOX=false
LIVEAVATAR_AVATAR_ID=<production avatar id>
LIVEAVATAR_MAX_SESSION_SECONDS=300
ELEVENLABS_VOICE_ID=onwK4e9ZLuTAKqWW03F9      # Daniel, the voice the sprint chose
LIVEKIT_API_KEY=<new random value>
LIVEKIT_API_SECRET=<new random value, at least 32 characters>
POSTGRES_PASSWORD=<new random value>
OTP_DELIVERY=console
APP_ENV=development
ADMIN_PHONES=<your phone>                     # new since the admin-auth change
ASSISTANT_EMBED_KEY=
```

Why each one:

- `LIVEKIT_DOMAIN`: `docker-compose.server.yml:11` passes it to Caddy, and the `Caddyfile` uses it
  as the site name. The domain is written nowhere else.
- `LIVEAVATAR_TRANSPORT`, `PUBLIC_LIVEKIT_URL`: see "Why a server".
- `LIVEKIT_NODE_IP`: the compose file gives it to LiveKit (`docker-compose.yml:46`). The sprint set
  it to the droplet's public IP.
- `LIVEAVATAR_SANDBOX=false` and the production avatar: sandbox allows only the public "Wayne"
  avatar (`docs/features/response-caching/RESEARCH.md:1042`) and ends every session after about
  60 seconds (`README.md:6`). The sprint used the account's own avatar.
- `LIVEAVATAR_MAX_SESSION_SECONDS=300`: production refuses a longer session (see "Known problems").
- `ELEVENLABS_VOICE_ID`: the premade voice Daniel. An instant-cloned voice was refused on the plan
  the account had (see "Known problems").
- New LiveKit key and secret, new Postgres password: the server gets its own credentials, so
  nothing from a laptop works against it. `openssl rand -hex 32` makes a good value. The secret
  needs at least 32 characters (`.env.example:133`).
- `OTP_DELIVERY=console` with `APP_ENV=development`: the server sends no SMS, so this is the only
  way an admin can sign in. See "Admin token".
- `ADMIN_PHONES`: that phone becomes an admin at sign-in
  (`apps/api/services/orchestrator/src/auth/users.py:36`).
- `ASSISTANT_EMBED_KEY` empty: the website widget is off (`docs/SECURITY.md:75`).

`ELEVENLABS_API_KEY` and `LIVEAVATAR_API_KEY` stay as in your local `.env`.

## Start

```bash
cd /opt/kohandezh        # where the repository copy lives; the sprint used rsync, not git
export COMPOSE_FILE=docker-compose.yml:apps/api/setup/server/docker-compose.server.yml
docker compose up -d --build orchestrator caddy
docker compose ps
curl -fsS -o /dev/null https://livekit.<your domain> && echo "LiveKit answers through Caddy"
```

The last line asks LiveKit's root path, the same path as its health check
(`docker-compose.yml:57`), but through Caddy and TLS.

Set `COMPOSE_FILE` in every shell on the server, or `docker compose` uses the base file alone.

Only `orchestrator` and `caddy` are named. Compose starts what they need: `media-init`,
`postgres`, `redis`, `livekit` and `livekit-egress` (`docker-compose.yml:109-119`, and
`depends_on` in the override). The `frontend` is not needed for scripted renders, and the sprint
did not start it.

## Admin token

Every route the render script calls needs an admin session
(`apps/api/services/orchestrator/src/main.py:247`). The script reads an admin bearer token from
`ADMIN_TOKEN`, sends it only as the `Authorization` header, and never prints it. When
`ADMIN_TOKEN` is empty it stops before any request (`render_answers.py:83-85`). This is the same
rule as `scripts/real-provider-smoke`.

Get the token by signing in the way the native app does, inside the orchestrator container (the
API has no public port):

```bash
docker compose exec -T orchestrator curl -s -X POST http://127.0.0.1:8000/auth/otp/request \
  -H 'Content-Type: application/json' -d '{"phone":"<your phone>"}'
# The answer has "devCode". Use it below.
ADMIN_TOKEN=$(docker compose exec -T orchestrator curl -s -X POST http://127.0.0.1:8000/auth/otp/verify \
  -H 'Content-Type: application/json' -H 'X-Client-Platform: native' \
  -d '{"phone":"<your phone>","code":"<devCode>"}' \
  | python3 -c 'import json, sys; print(json.load(sys.stdin)["accessToken"])')
export ADMIN_TOKEN
```

The second command keeps the token in a shell variable and never shows it.

How it works:

- `X-Client-Platform: native` makes the answer carry `accessToken` instead of setting a cookie
  (`apps/api/services/orchestrator/src/auth/router.py:54-55`).
- `devCode` is in the answer only when `APP_ENV=development` and `OTP_DELIVERY=console`
  (`apps/api/services/orchestrator/src/auth/otp.py:95`). In any other environment the console
  sender writes the code nowhere (`otp.py:31-46`, `apps/api/services/orchestrator/src/auth/asanak.py:201-203`),
  so nobody could sign in on this server.
- Development mode is acceptable here only because the API is not public: Caddy passes only
  LiveKit, and the web app is bound to `127.0.0.1`. Development also turns off the cookie's
  `Secure` flag (`apps/api/services/orchestrator/src/auth/sessions.py:53`) and accepts a `*`
  widget origin (`apps/api/services/orchestrator/src/assistant/router.py:33-35`), and the widget is
  off anyway. Never use this `.env` on a public app server.

The session lives in Redis for `SESSION_TTL_DAYS` and dies with the droplet.

## Render

Put the script and the input where the container sees them. `./media` is mounted at `/media`
(`docker-compose.yml:108`):

```bash
mkdir -p media/render
cp apps/api/setup/server/render_answers.py media/render/
cp <your answers file> media/render/answers.json
docker compose exec -T -e ADMIN_TOKEN orchestrator python /media/render/render_answers.py
```

`-e ADMIN_TOKEN` with no value copies the variable from your shell into the container, so the
token is not written on the command line. Run it inside `tmux`, so a lost SSH connection does not
stop a long batch.

Input, `media/render/answers.json`: a JSON list.

```json
[{"key": "Q001", "question": "...", "answer": "the text the avatar speaks"}]
```

Output, `media/render/results.json`: one entry per key (`render_answers.py:64-74`):

```json
{"Q001": {"key": "Q001", "question": "...", "answer": "...", "video_asset_id": "<uuid>",
          "external_id": "ANS_Q001_<time>", "audio_asset_id": "<uuid>", "status": "VIDEO_GENERATED",
          "duration_ms": 46900, "file": "/media/video/ANS_Q001_<time>.mp4", "error": null}}
```

A failed key has only `key`, `question`, `answer` and `error` (`render_answers.py:101-108`).
The results file is saved after every key.

Resume: run the command again with no keys. It skips every key that already has a result without
an error, so it renders only the new and the failed ones (`render_answers.py:95-96`). To render
chosen keys again, even finished ones, name them:
`... python /media/render/render_answers.py Q001 Q007`. `RENDER_INPUT` and `RENDER_RESULTS` change
the two paths (`render_answers.py:25-26`).

Each key gets its own avatar session (`render_answers.py:48-79`): open a session with
`sandbox: false` and 300 s, start the recording, wait 6 s for the Egress browser to join, speak
the answer, wait 1.5 s, finalize the MP4, close the session. The MP4 is in `media/video/` on the
server.

## Known problems (render sprint 2026-09-25)

- **300 s session cap.** Production LiveAvatar refuses a `max_session_duration` over 300. The API
  still accepts up to 3600 (`apps/api/services/orchestrator/src/schemas.py:70`), so keep
  `LIVEAVATAR_MAX_SESSION_SECONDS=300`. The script sends 300.
- **`canSubscribe`.** LiveAvatar answers 422 "Input Livekit token needs to grant canSubscribe
  permission" when the avatar's LiveKit token lacks it. `main` gives the avatar token
  `can_subscribe=False` (`apps/api/services/orchestrator/src/livekit_gateway.py:66-72`), so every
  BYO session fails. The fix is on the branch `fix/liveavatar-byo-token-subscribe`. Use it until it
  is merged.
- **ElevenLabs plan.** An unpaid plan answers `payment_issue`. A pay-as-you-go plan refuses
  instant-cloned voices with `ivc_not_permitted`. Both close the stream with code 1008, and every
  speech call fails. Check the plan and the voice before a batch. The sprint used Daniel, a premade
  voice.
- **Phone numbers.** Write them in the answer text as grouped Persian words. Digits were read out
  wrong.
- **Time and size.** One render took about 45 s. The MP4 is about 0.4 MB per second of video.
  Plan the disk from that: 70 minutes of video is about 1.7 GB.

## Back up, then destroy

From your own computer:

```bash
rsync -av root@<droplet IP>:/opt/kohandezh/media/video/ ./kohandezh-renders/
rsync -av root@<droplet IP>:/opt/kohandezh/media/render/ ./kohandezh-renders/sheets/
ssh root@<droplet IP> 'cd /opt/kohandezh && docker compose exec -T postgres pg_dump -U kohandezh kohandezh_avatar' \
  | gzip > ./kohandezh-renders/sheets/render-db.sql.gz
```

Check that the number of MP4 files and their sizes match the server. The database dump holds the
`video_assets` rows that `results.json` points to.

Then destroy the droplet in the DigitalOcean panel. Do not only power it off: a powered-off
droplet is still billed, because its disk and IP stay reserved. Remove the DNS A record too.
After that, the videos exist only in your backup.
