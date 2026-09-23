# 0014. Conversation data retention

Status: Proposed
Date: 2026-09-23

## Context

The assistant runs in the browser against LiveAvatar's cloud. No question, answer or answer media
reaches our backend today (`apps/api/services/orchestrator/src/assistant/service.py:50-54`), so
nothing from a conversation is stored.

The response-caching spike (`docs/features/response-caching/RESEARCH.md`, "§" below) changes
that. Three of its five options store text or media from a user's conversation: C, D, and the
draft loop of E, the owner's design (§5, the row "C3 storage of user text"). Option B stores none
(§6). The spike routes to this ADR (§8) because the change is a new trust boundary, "a new place
user data lives" (`.claude/skills/writing-spikes/references/adr-escalation.md:27`).

The only rule that touches it is item 13 of `docs/SECURITY.md:16-18`. It bans *logging* prompt and
answer text. It makes *storing* it conditional: "If a product promises it does not store
conversations, that must be true in the code". The repository records no such promise (§3, "C3 in
full"). So nothing forbids storage today and nothing permits it. No ADR covers it.

Three facts shape every item below:

- Two doors reach the assistant: a signed-in user, or the public embed key on an allowed origin
  (`.../src/assistant/router.py:34-49`). A widget visitor has no user id
  (`.../migrations/002_assistant.sql:23-24`, `router.py:49`).
- Some customers need an install with no internet access (`0006-backend-stack.md:21`, C7 in §3).
- Two lifecycles must not share a status column: the question's review and the media's render
  (§8, last open question). `DRAFT` already means a recording row (`.../src/database.py:129-134`).

This record is **Proposed**. The owner accepts, edits or rejects each item. "Owner decision" marks
what only the owner can settle, with a proposed default that is not a decision. Code is cited at
`35f6154`, whose code is identical to `main@eb05da0`. `.../` is `apps/api/services/orchestrator/`.

## Decision

Items 1 to 7 carry the numbers of §8. Item 13 of `docs/SECURITY.md` stays as it is: logging
conversation text stays banned whatever is stored. A table row is storage, not a log. A log line
with `question_text` in it is a log, and stays banned. In code, stored text is a `SecretStr`, like
the backend's keys (`.../src/config.py:21`), so a stray `repr` prints stars. Log calls keep the
house shape, an event name plus metadata in `extra` (`.../src/auth/router.py:51`). A test asserts
that creating a draft leaves its text in no log record. Per-answer usage rows (a count, a
duration, `cache_hit`) are metadata, which item 13 permits now (`docs/SECURITY.md:16`).

### 1. What may be stored, for how long, and how it is deleted

**Decision.** The backend may store one piece of user text: the question that missed on the
pre-session screen, as a draft (§5 Option E, step 4). Answer text joins it only through item 5's
read-back. No live media is stored. A deletion request removes every draft with the user's id.

| Record | Lifecycle | Kept until |
| ------ | --------- | ---------- |
| Draft: the user's words | question review | rejection, approval, or 30 days, whichever comes first. Item 5's audit row stays, without text |
| Library entry: staff's reworded text (item 2) | question review, then media render | the entry is withdrawn |
| Rendered MP4 | media render | withdrawn or replaced. The file is deleted with its row |

**Rejected:** a draft for every turn. Follow-up turns lean on earlier ones, the pre-session matcher
can never serve them, and they multiply stored user text (§5 Option E, step 4).

**Owner decision:** default proposed is question text only and no live media, one draft per missed
visit, 30 days for a draft nobody reviewed, and consent as the legal basis: the pre-session screen
asks, and if the user does not agree, no draft is made. The spike holds no legal analysis. Which
law applies is for the owner and counsel.

### 2. Replay to a different user

**Decision.** Media recorded from one user's live conversation is never shown to another user.
Media rendered offline from approved text may be shown to any user, on both doors. A question one
user asked reaches others only as a library entry: reworded by staff, cleaned of names and other
personal details, and approved (§5 Option E, step 5). A widget visitor's words are never stored
(item 3), so they are never shown.

**Rejected:** showing the user's words as asked. That shows one person's details to strangers, and
lets whoever posts drafts choose what others read (§8, open questions, the key-collision bullet).

**Owner decision:** default proposed is no for recorded media, and yes for a question after staff
rewording and approval. The stricter choice, a library only staff write, is Option B (§6).

### 3. Widget visitors

**Decision.** Nothing is stored from the embed door. A draft needs a signed-in user: the draft
endpoint refuses a principal without a user id, and every embed caller has none (`router.py:49`).
The refusal lives in the endpoint's dependency, not in a setting, because item 13 wants such a
promise true "in the code, not in a setting an operator can flip". A widget visitor's question may
still be matched in memory, then dropped. The widget plays library entries, and its misses are
counted as numbers in the usage rows.

**Rejected:** a deletion key for anonymous text. The only per-visitor value the backend holds is
the client address the rate limit counts (`router.py:49`). It is shared, it changes, and storing
it beside the text adds personal data. A random code per visitor is a credential with no account.

**Owner decision:** default proposed is that no text is stored from the widget. Staff then learn
how often widget visitors miss, never what they asked.

### 4. Third parties at query time

**Decision.** Only phase 3 of E needs this. On both doors, before a session, a user's speech may
go to hosted speech-to-text only at a vendor that already hears it on the live path, and only on
an install with internet access. ElevenLabs qualifies: the voice agent wraps the customer's
ElevenLabs agent, carries the Persian speech recognition, and ElevenLabs bills those minutes
(`.env.example:51-54`). This backend's key may sit in another workspace (U9). No new vendor
receives user speech or text. Embeddings run locally, as ADR 0006 planned (`sentence-transformers`,
`0006-backend-stack.md:33`). A no-internet install transcribes locally too, or skips phase 3 (C7).

**Rejected:** a hosted embedding API such as `text-embedding-3-large`. It sends every question,
hits included, to a vendor that sees nothing today, and it fails C7 (§5 Option E, "Which matcher").

**Owner decision:** default proposed is vendors already on the live path only, internet installs
only, local embeddings. Persian accuracy is unmeasured either way (U11, U14).

### 5. Provenance of drafts, approval, and audit

**Decision.** A draft's answer side comes only from a server-side read-back of the conversation by
its provider id, once U9 holds, never from answer text the browser posts (§5 Option E, "Provenance
of a draft"). A no-internet install cannot read back, so its drafts stay questions only (C7). The
question side may come from the browser, from signed-in users only (item 3), behind its own rate
limit: the hourly one counts session mints only (`router.py:59-63`). Approving or rejecting needs
the `admin` role, checked by `require_admin` (`.../src/auth/dependencies.py:57-60`), and writes an
audit row: reviewer, decision, time, no user text. The same holds for the existing video approval
endpoint, which has no `Depends(...)` and no reviewer column (`.../src/main.py:444-458`).

**Rejected:** browser-posted answer text with a "draft" label and a careful reviewer. A pre-filled
answer is the setting where "the median user accepted suggestions 17% of the time without
modifications" (Levy et al., CHI 2021, fetched 2026-09-23, in §5 Option E, "The confirm step").

**Owner decision:** default proposed is that one admin approves, and audit rows are kept as long as
the library exists. The stricter choice is approval by the practitioner whose face speaks it.

### 6. Object storage and the serving route

**Decision.** Object storage does not become a platform dependency. Local disk stays the default
(`.../src/config.py:125`, `docker-compose.yml:74`). An S3-compatible store is an optional setting:
Spaces for this owner, a self-hosted MinIO on premise (§4.4). Every target, the widget included,
fetches media through the backend behind `get_principal` (`router.py:34`), as a blob through the
shared axios client, as audio already is (`apps/frontend/src/shared/api/assets.ts:19-26`).

**Rejected:** a public or CDN URL: it skips both doors and fails a no-internet install. A signed
URL: it puts a credential in the DOM (`apps/frontend/src/shared/api/urls.ts:3-6`), and the Spaces
CDN does not cache it (DigitalOcean, "enable the CDN", dated 2026-09-03, fetched 2026-09-23, §5
Option E deltas table). A `<video src>`: it plays on `web` only (§5 Option B, C3 correction).

**Owner decision:** default proposed is local disk, with Spaces as a per-install setting. The
owner named Spaces (§5 Option E). The setting costs an S3 client or a `finalize` rework (§4.4
correction), and needs a delete path before it is switched on (item 1).

### 7. BYO transport for the assistant

**Decision.** Deferred on U1, in three parts.

- **Meanwhile:** no BYO transport for the assistant. It keeps the `managed` transport it
  hard-codes (`.../src/assistant/service.py:119`). BYO stays on the LITE render path (§4.1 row 7).
- **Precondition:** U1, whether LiveAvatar's FULL and voice-agent APIs accept a `livekit_config`.
  One paid call in the opt-in provider tests settles it (§7). The owner approves, a D spec runs it.
- **If false:** Option D is closed, and this item becomes a plain no.
- **If true:** D works on internet installs only, since a BYO session needs a public `wss://`
  LiveKit endpoint (`apps/api/services/liveavatar/manager.py:73-81`, C7). Adopting it also needs
  items 1 and 2 amended, because D stores and replays live media.

**Rejected:** deciding yes now. It rests on an unverified capability, and makes a public media
endpoint a per-session requirement, which breaks the installs ADR 0006 names (§5 Option D, C7).

**Owner decision:** default proposed is no BYO transport, with the paid U1 check made only if
voice parity by rendering fails (U10), the only reason the spike keeps C or D open (§6).

## Consequences

**What it buys.** Once accepted, a spec for E's phase 2 can pass the `writing-specs` gate (§8,
production item 8), and the next feature that wants conversation text meets a rule, not a gap.
Option B needs none of these answers (§6).

**What it costs.**

- Stored user text is a one-way door: undoing drafts is a privacy exercise (§5 Option E, Reversal).
- Deletion at 30 days needs a scheduled job, and none exists today (ADR 0015, below).
- A consent step on the pre-session screen, in `en` and `fa`, on three targets.
- Local models need a machine-learning runtime the image lacks (`.../requirements.txt:1-15`).
- Blob playback downloads the whole file before it plays (§5 Option B, C3 correction).
- Staff write every answer until U9 holds, which is the work the draft loop was meant to save.

**Options this enables or closes**, under the proposed defaults. C and D reopen only by amending
items 1 and 2, and only if rendering cannot reach voice parity (U10).

| Option | Needs | Result |
| ------ | ----- | ------ |
| B | nothing | open now |
| C | items 1 and 2 | closed: no live media is stored or replayed |
| D | items 1, 2 and 7 | closed, and item 7 waits on U1 |
| E, phase 2 | items 1, 2, 3 and 5 | open for questions; the answer side waits on U9 |
| E, phase 3 | item 4 | open on internet installs, once U11, U12, U13, U15 and U6 have evidence |

**Documents that change on acceptance.**

- `docs/SECURITY.md` gains an item: conversation text is stored only as ADR 0014 allows, never
  logged (item 13), never from the embed door, and deleted on the ADR's schedule.
- `docs/DATA_MODEL.md` gains the draft table with its own review status (not `DRAFT`), the audit
  columns and the retention rules, and the tables it leaves out today (§8, open questions).
- `docs/DECISIONS/0010-website-widget.md:71-73`, if widget visitors should see production renders:
  widgets stay in sandbox there; the code reads one global flag (`.../src/assistant/service.py:71`).
- `docs/API.md` and `apps/frontend/src/data/mock/handlers.ts`, with the spec that adds endpoints.

**Background jobs go to ADR 0015.** They are not conversation data, and the retry question does
not fit in a screen. ADR 0015 must settle:

1. An in-process runner over `generation_jobs`, as the spike proposes, or a queue library such as
   `arq` (§5 Option E, "The job runner"), and whether it also runs item 1's scheduled deletion.
2. Who owns job state, and the lease and attempt columns (`.../migrations/001_initial.sql:55-67`).
3. How a job that dies with the process is retried, and what becomes of its Egress recording and
   its LITE session, held in process memory (`apps/api/services/liveavatar/manager.py:53`, U18).
4. `GET /api/jobs/{jobId}` (`docs/API.md:20-22`), and converting `finalize`, which busy-waits up
   to fifteen seconds (`.../src/main.py:406-409`).

**Not settled here, and still the owner's:** the acceptable false-confirm rate (U13), and whether
a user must be told that a recording is playing (§8, open questions).

**The wrong fix this prevents.** Item 13 invites two wrong readings: "it only bans logging, so
store question text freely", and "it talks about not storing conversations, so do not store even
per-answer counts". This record closes both: user text is stored only as items 1 to 3 allow, and
per-answer metadata is allowed now.
