# 0015. Background jobs

Status: Proposed
Date: 2026-09-24

## Context

The API is one uvicorn process (`apps/api/services/orchestrator/Dockerfile:28`) with no worker
service (`docker-compose.yml:91-127`). Its only background work is `asyncio.create_task`
(`apps/api/services/liveavatar/manager.py:137`, `apps/api/services/liveavatar/connection.py:37`).
Redis is locks and rate limits, not a queue (`.../src/coordination.py:30-107`).

The spike (`docs/features/response-caching/RESEARCH.md`, "§" below) sent the question here
(`RESEARCH.md:1434-1436`), and ADR 0014 lists what to settle (`0014:224-230`). Four facts force it:

- `docs/API.md:20-22` says long work answers `202` with a job id, polled at `GET /api/jobs/{jobId}`.
  That endpoint does not exist (§4.1 row 5).
- `finalize` holds its request open up to fifteen seconds, thirty sleeps of half a second
  (`.../src/main.py:406-409`). It breaks that rule today (`RESEARCH.md:1140`).
- `generation_jobs` was shaped for a runner (`.../migrations/001_initial.sql:55-68`), but no code
  uses it (§4.1 row 5). It has no attempt count, lease or worker id (`RESEARCH.md:1081-1082`).
- ADR 0014 writes no draft until a job enforces the 30 days (`0014:53-54`). B's and E's render
  jobs need a runner too (`RESEARCH.md:1079-1084,1140`).

**Proposed.** "Owner decision" marks what only the owner settles, with a default that is not a
decision. Code is cited at `536be20` (= `main@eb05da0`); `.../` is `apps/api/services/orchestrator/`.

## Decision

Job payloads are storage. `input` and `output` are JSONB (`001_initial.sql:62-63`). They reference
rows by id and carry no conversation text beyond what ADR 0014 items 1 to 3 allow. `error_message`
is a fixed message per `error_code`, never user text. A job reads its text from the row it names.

### 1. The runner

**Decision.** An in-process runner in the API runs jobs from `generation_jobs`, the spike's pick
(`RESEARCH.md:1079-1080`). It claims the next due job by a conditional update that sets its lease
(item 2). Job types: `finalize_video` (item 4) and `retention_sweep` (item 5); `render_video` waits
on item 3's precondition. A render job owns a LITE session, and sessions live in the API process's memory
(`manager.py:53,137-139`), so the job runs next to them.

**Rejected:** a queue library. `arq` is asyncio-native and Production/Stable (0.28.0, PyPI, fetched
2026-09-23), but it is a new dependency (`RESEARCH.md:1064-1066`), which only the owner may add.
Its PyPI record says "Job queues in python with asyncio and redis" and "In maintenance only mode"
(checked 2026-09-24). BullMQ Python is Alpha (3.2.6, PyPI, fetched 2026-09-23). Celery adds a
process and a broker role for Redis (`RESEARCH.md:1062-1064`). A separate worker copies the session
code for a short, rare job (`RESEARCH.md:1067-1076`).

**Owner decision:** default proposed is the in-process runner and no new dependency. A queue
library comes only if the owner says so. The lease covers a crash of today's one process and a
second process later. One `render_video` runs at a time per install: the claim step skips a render
while another is `running`, since concurrency limits are unverified (U18, `RESEARCH.md:1356`).

### 2. Who owns job state

**Decision.** `generation_jobs` in PostgreSQL is the only owner of job state. Redis holds none.
`status` takes the four values of `docs/API.md:21`: `queued`, `running`, `done`, `failed`. One new
append-only migration (C4, `RESEARCH.md:97`) adds these columns. This record does not write it.

| Column | Purpose |
| ------ | ------- |
| `attempt_count INT NOT NULL DEFAULT 0` | claims for real work so far (item 3) |
| `max_attempts INT NOT NULL` | the retry limit, set per job type at enqueue (item 3) |
| `run_after TIMESTAMPTZ NOT NULL DEFAULT now()` | when the job is next due: backoff and schedules |
| `lease_expires_at TIMESTAMPTZ` | a `running` job past its lease is dead |
| `worker_id TEXT` | the process holding the lease: host name plus a per-boot random id |
| `created_by UUID REFERENCES users(id)` | who asked; null for system jobs (item 4) |
| `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` | last change |

It adds a unique index on `dedupe_key` over `queued` and `running` rows: a repeat request gets the
existing `jobId`. The runner writes `error_code` and `error_message`, unused (`RESEARCH.md:1496-1497`).

**Rejected:** a Redis lock as the lease. It vanishes with its key and keeps no failure record.

**Owner decision:** default proposed is that `done` and `failed` rows are kept 30 days, then item
5 deletes them. They hold ids, a user id among them. The lease is 60 seconds, renewed every 20.

### 3. Retry after the process dies

**Decision.** An attempt is counted when a job is claimed for real work. A `finalize_video` that
finds no file yet and releases itself (item 4) is not an attempt. A failure whose error is marked
retryable (`.../src/errors.py:6-11`, as `main.py:410-413` does) returns to `queued` with backoff.
Any other failure is `failed` at once: retrying a render that cannot pass spends paid minutes.
When the process dies, its jobs' leases lapse. The attempt stays counted, and the runner requeues
each, or fails it with `worker_lost` at `max_attempts`. Finalize and sweep are safe to run twice.

A `render_video` job cannot resume. Its LITE session lived in the dead process's memory
(`manager.py:53`); the provider ends it on its five-minute idle timeout (LITE events page, cited at
`RESEARCH.md:1356`). A retry is a new session, a new `video_assets` row (`generate-video` refuses an
asset with an Egress id, `main.py:374-380`) and a new Egress. On reclaim the runner stops the old
Egress by its id (`main.py:393,404`); a failed stop counts as stopped, since `stop_egress` turns
every error into `egress_failure` (`.../src/livekit_gateway.py:103-109`). The old row gets
`RENDER_FAILED`, a new value no reviewer sets (`TEXT` column, `001_initial.sql:50`), and loses its
file. `REJECTED` stays the staff outcome with its audit row (`0014:129-132`). The next attempt
waits five minutes (`run_after`), so the old session has ended at the provider.

**What keeps a half-rendered asset invisible.** A new row starts `DRAFT` (`.../src/database.py:134`)
and becomes `VIDEO_GENERATED` only after the MP4 passes the probe (`main.py:414-415`,
`database.py:157-161`). Only `VIDEO_APPROVED` is ever matched or shown to a user. Two gaps close
before any rendered video is shown to a user, whether a job or the workbench rendered it. Approval
sets a status without checking the current one (`database.py:171-182`, `main.py:444-458`), so it
must require `VIDEO_GENERATED`. And `GET /assets/video/{id}` serves any row whose file exists,
whatever its status (`main.py:436-441`), so the user-facing route must serve `VIDEO_APPROVED` only.

**What the spike could not verify.** U18 is partly verified (`manager.py:56-190`,
`RESEARCH.md:1356`). Nor what Egress does once the publisher disappears; stopping it by id covers
both cases, and the ten-minute file limit bounds it (`egress.yaml:18`). So `render_video` waits:

- **Meanwhile:** the runner ships with `finalize_video` and `retention_sweep` only. Renders stay
  the manual workbench flow (`apps/frontend/src/features/recording/useRecording.ts:57`).
- **Precondition:** one paid render run outside production (U18, with U4). The owner approves it;
  the Option B spec runs it.
- **If it holds,** `render_video` ships with the defaults below. **If not,** renders stay manual,
  and if the account allows one session at a time, the B spec schedules renders around live users.

**Rejected:** resuming on the old session. Its handle and keepalive died with the process
(`manager.py:137-139`), and a new WebSocket replaces the old (`RESEARCH.md:1071-1072`).

**Owner decision:** default proposed is `max_attempts` 3 for `render_video` and `finalize_video`,
1 for `retention_sweep`. A render retry is a paid LITE session, 1 credit a minute (`RESEARCH.md:1544`).

### 4. `GET /api/jobs/{jobId}` and `finalize`

**Decision.** `GET /api/jobs/{jobId}` returns the shape in `docs/API.md:20-21`: `status`, `result`
from `output` when `done`, `error` from `error_code` and `error_message` when `failed`. The caller
is the job's `created_by` user or an admin (`require_admin`, `.../src/auth/dependencies.py:57-60`),
and a system job is admin only. Anyone else gets `404`. The mock gets the route (`RESEARCH.md:1083`).

`POST /assets/video/{asset_id}/finalize` is **converted, not wrapped** (`RESEARCH.md:1472-1474`).
It stops Egress (`main.py:404`), enqueues `finalize_video`, and answers `202` with the `jobId`. The
job checks for the file; if missing, it sets `run_after` a few seconds ahead and releases the lease
instead of sleeping. Once the file appears, it probes it and marks the row `VIDEO_GENERATED`
(`main.py:414-415`). At the wait's end it fails with `egress_failure` (`main.py:411-412`); that
timeout is final and is not retried. `finalize` takes no `Depends(...)` today (`main.py:397-398`),
so it and its poll require `require_admin`: the conversion lands with or after §8 production item
6, authoring-endpoint auth (`RESEARCH.md:1459-1471`).

**Rejected:** wrapping the loop in `asyncio.create_task`. It sleeps, dies on restart, has no poll.

**Owner decision:** default proposed is a 60-second file wait in total, four times today's fifteen.
The spike never measured how long Egress takes to write the file. Client polling is the spec's.

### 5. The deletion job

**Decision.** The same runner runs ADR 0014 item 1's scheduled deletion, as `retention_sweep` with
a fixed `dedupe_key`. On startup the runner enqueues it if none is queued or running. The next
run, a day ahead, is enqueued in the transaction that closes the current run, whatever its outcome.
A failed sweep is logged as a structured event with no user text (`.../src/auth/router.py:51`); the
phase 2 spec defines the admin surface that shows it. Each run deletes drafts past 30 days
(`0014:58`), `done` and `failed` jobs and `RENDER_FAILED` rows past item 2's period, and a withdrawn
or replaced MP4 with its row (`0014:60`). Draft and media periods stay ADR 0014's.

ADR 0014's gate holds until then:

- **Meanwhile:** no draft is written (`0014:53-54`); none exists (`.../src/assistant/service.py:50-54`).
- **Precondition:** the owner accepts ADR 0014 and this record. The phase 2 spec builds the sweep's
  draft part, with a test that an expired draft is gone after one run.
- **Either way:** with a queue library (item 1), the sweep is its scheduled job, if it can schedule
  jobs; the spike does not say. Without stored drafts, the sweep deletes jobs and media only.

**Rejected:** a cron container or a database scheduler extension, a new process or dependency.
And hiding old drafts in queries: the text still sits in the table, which is storage (`0014:40`).

**Owner decision:** default proposed is one sweep a day: while the API runs, a draft outlives its
30 days by a day at most.

## Consequences

**What it buys.** C5 holds (`RESEARCH.md:98`), and ADR 0014 item 1 gets its deletion job, with no
new dependency. The runner works offline (C7, `RESEARCH.md:100`). `render_video` does not: it needs
`LIVEAVATAR_TRANSPORT=byo` and a public `wss://` endpoint (`main.py:361-369`, `manager.py:73-81`).

**What it costs.**

- Jobs share a process with requests. Retry covers a crash, not load: fine while approvals are rare.
  A deploy or shutdown closes every LITE session (`main.py:122`, `manager.py:223-230`), so a render
  in flight uses up an attempt and a paid session. The migration is one-way (C4).
- `finalize` answers `202`, not `200`, and needs an admin session. The workbench polls. These change:
  `useRecording.ts:57`, `apps/frontend/src/shared/api/assets.ts:39-42`, `VideoFinalizeDto`
  (`apps/frontend/src/shared/api/dto.ts:98`), `apps/frontend/tests/utils/server.ts:71`, and the test
  `apps/frontend/src/features/recording/useRecording.test.tsx:37`.

**Work this unblocks.** §8 production item 7. ADR 0014 item 1's deletion job, so E's phase 2
(production item 8). B's and E's render jobs, once U18 holds and production items 2, 3, 6 are done.

**Documents that change on acceptance.**

- `docs/DATA_MODEL.md` gains `generation_jobs` and the `video_assets` statuses (`RENDER_FAILED`
  included) with who may see each. It documents neither today (`RESEARCH.md:1512-1514`).
- `docs/API.md` gains `GET /api/jobs/{jobId}` with its access rule.
- `apps/api/README.md` records `finalize`'s `202`, since `docs/API.md:205-209` keeps `/assets/*`
  out of the contract. Its "Already decided" (`:45-49`) gains: jobs run in the API process.
- `apps/frontend/src/data/mock/handlers.ts` gains the jobs route (`RESEARCH.md:1083`).
- A new migration after `003_birth_date.sql` adds item 2's columns and index.

**The wrong fix this prevents.** A reviewer sees a loop over a table, reads "Production/Stable"
next to `arq`, and swaps in a queue and a worker: a dependency the owner never approved, away from
the LITE sessions jobs own (`manager.py:53`). Or retries a render on the same asset row, where a
half-written recording could be approved.
