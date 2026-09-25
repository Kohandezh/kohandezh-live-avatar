# 0014. Conversation data retention

Status: Accepted (2026-09-25). The owner decided every item. Items 1, 2, 3 and 7 changed the
proposal. Item 3 depends on a new ADR for a signed-in widget.
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
  (§8, the two-lifecycles open question). `DRAFT` already means a recording row
  (`.../src/database.py:129-134`).

The owner answered each item on 2026-09-25. Each item's "Owner decision" line records the answer.
Where the owner changed the proposal, the item's text now says what the owner decided. The owner
answered in two rounds. In the second, the owner chose to build both Option B and Option D, B
first, and to make the widget a signed-in surface.

| Item | Owner's answer | Result |
| ---- | -------------- | ------ |
| 1 | No automatic deletion after 30 days. Only an admin decides. Record every live answer (Option D). | Accepted, changed |
| 2 | Once an admin approves it, it can be shown to all users, recorded answers included. | Accepted, changed |
| 3 | Widget users must sign in; the widget loads the web version. Their questions are stored. | Accepted, changed. Needs a new ADR |
| 4 | Asked why ElevenLabs and not LiveAvatar, then accepted. | Accepted |
| 5 | Accepted. | Accepted |
| 6 | Accepted. | Accepted |
| 7 | Build Option D after Option B, with BYO. The U1 test is approved. | Accepted, changed |

Code is cited at `35f6154`, whose code is identical to `main@eb05da0`. `.../` is
`apps/api/services/orchestrator/`.

## Decision

Items 1 to 7 carry the numbers of §8. Item 13 of `docs/SECURITY.md` stays as it is: logging
conversation text stays banned whatever is stored. A table row is storage; a log line with
`question_text` in it is a log. User text travels only in a request body, never in a URL. Log
calls keep the house shape, an event name plus metadata in `extra` (`.../src/auth/router.py:51`),
and a test asserts that creating a draft leaves its text in no log record. Per-answer usage rows
(a count, a duration, `cache_hit`) are metadata, which item 13 permits now (`docs/SECURITY.md:16`).

### 1. What may be stored, for how long, and how it is deleted

**Decision.** The backend may store one piece of user text per missed visit, as a draft (§5 Option
E, step 4). In phase 2 the screen before Start is buttons (§6, trade-offs, B's suggestions row),
so it is the first `user_transcript` of a session started without a tap on a suggestion
(`apps/frontend/src/features/assistant/state.ts:343-356`). In phase 3 it is the question asked on
that screen; its audio is not kept after transcription. A draft has no end date: it stays until
an admin approves or rejects it. Nothing deletes it on a timer.

The backend may also store **each live answer as its own video** (Option D, item 7). Every answer
in every live session is recorded. The recording holds the avatar's audio and video only, never the
user's microphone or camera. Today's recorder saves the whole room
(`start_room_composite_egress`, `.../src/livekit_gateway.py:84-93`), so D needs a recorder that
takes the avatar's tracks only. The question that led to the answer is stored with it as text, so
an admin can judge it. A recorded answer, like a draft, stays until an admin publishes or rejects
it.

A deletion request from a user removes that user's drafts and unpublished recordings by user id;
an admin carries it out (limits in Consequences). Before Start, the user is told that their
questions and the avatar's answers are stored and may be shown to others after review, and must
agree. Without agreement the session does not start. No draft or recording is written before the
spec that builds this consent step.

| Record | Lifecycle | Kept until |
| ------ | --------- | ---------- |
| Draft: the user's words | question review | an admin rejects or approves it, or its user asks for deletion. Item 5's audit row stays, without text |
| Library entry: staff's cleaned text (item 2) | question review, then media render | the entry is withdrawn |
| Rendered MP4 | media render | withdrawn or replaced. The file is deleted with its row |
| Recorded answer: the avatar's live answer and its question text (Option D) | answer review | an admin rejects it, or its user asks for deletion. Once published, it is a library entry and follows that row |

**Rejected:** a draft per turn, since follow-up turns lean on earlier ones (§5 Option E, step 4).
And no user text at all: B stays, but staff never learn which questions are missing (§6,
trade-offs, first row).

**Owner decision, 2026-09-25: accepted with two changes.** First, the proposal deleted an
unreviewed draft after 30 days. The owner rejected that: only an admin decides what happens to a
draft. Second, the proposal stored no live media. The owner chose Option D, which records each live
answer. The rest of the proposal stands: one draft per missed visit, and consent as the legal
basis, asked before Start. Because every answer is recorded, a user who does not agree cannot start
a session. The spike has no legal analysis. Some privacy laws require an end date for stored
personal data, or a way to use a service without being recorded. If counsel finds that such a law
applies, this item is amended.

### 2. Replay to a different user

**Decision.** Media rendered offline from approved text may be shown to all signed-in users. A
question one user asked reaches others only as a library entry (§5 Option E, step 5). Its question
text is staff text, cleaned of names and other personal details before approval, since an agent
answer can repeat what the user said.

A recorded live answer (item 1, Option D) may be shown to other users only after an admin watches
the whole video and publishes it as a library entry, with a question the admin writes. An admin
cannot edit a video, only publish or reject it. So an answer that names the user or repeats their
personal or health details is rejected, however useful it is. The admin judges whether a question
is common from the list of recorded questions; automatic grouping of similar questions comes later
(Option E's matcher).

**Rejected:** showing the user's words as asked. That shows one person's details to strangers, and
lets whoever posts drafts choose what others read (§8, open questions, the key-collision bullet).
And publishing a recorded answer without an admin watching all of it.

**Owner decision, 2026-09-25: accepted with a change.** The proposal said no for recorded media.
The owner chose Option D: a recorded live answer may be shown to all users once an admin has
reviewed and published it. A question is shown only after staff rewording and admin approval.

### 3. Widget visitors

**Decision.** The widget becomes a signed-in surface. A visitor signs in, and the widget loads the
web version of the app. A widget user is then a signed-in user with a user id, and every rule of
items 1 and 2 applies to them as to a `web` user: their questions are stored as drafts, their
answers are recorded, they can ask for deletion, and they see library entries.

This reverses ADR 0010, which chose a public embed key because "there is no logged-in user"
(`0010-website-widget.md:16`) and rejected loading the web target in an `<iframe>`
(`0010-website-widget.md:22-24`). That change needs its own ADR. It must settle how a sign-in
works inside a page on the customer's site, since browsers often block a site's cookies inside a
frame on another site, and web sessions are HttpOnly cookies (`docs/SECURITY.md:6`).

**Meanwhile:** until that ADR is accepted and built, the widget stays the anonymous embed door.
Nothing is stored from the embed door, because a visitor with no user id cannot ask for deletion
and anyone on an allowed origin could post drafts with the public key
(`0010-website-widget.md:69-70`). The widget plays no library entries while its sessions stay in
sandbox (`0010-website-widget.md:71-73`, `.../src/assistant/service.py:71`), because a visitor
would see the practitioner's face on a hit and the sandbox avatar on a miss.

**Rejected:** storing text from the anonymous widget. The owner first chose it, then chose a
signed-in widget instead, which gives every stored question an owner. And a deletion key for
anonymous text: the only per-visitor value the backend holds is the client address the rate limit
counts (`router.py:49`), which is shared and changes.

**Owner decision, 2026-09-25: accepted with a change.** The proposal stored nothing from the
widget. The owner decided that widget users must sign in and use the web version, and that their
questions are stored like any signed-in user's. The new widget ADR comes after Option B.

### 4. Third parties at query time

**Why ElevenLabs, and not LiveAvatar.** In phase 3 the user speaks a question on the screen before
Start, and the backend turns that speech into text to look for a library match. No LiveAvatar
session exists at that moment: avoiding one is the point of a hit. So LiveAvatar is not in the
path. On the live path, LiveAvatar is the middle layer for the face only. Speech recognition, the
answer and the voice come from the customer's ElevenLabs agent, which LiveAvatar wraps
(`.env.example:51-54`). LiveAvatar's own speech-to-text providers do not support Persian
(`.../src/config.py:54-60`). So the only company that hears the user's Persian speech today is
ElevenLabs, and this item keeps it that way. It is not only the voice model.

**Decision.** Only phase 3 of E needs this. On both doors, before a session, a user's speech may
go to hosted speech-to-text only at the account that already hears it on the live path: the same
ElevenLabs workspace that runs the live agent (U9, U17). That agent carries the Persian speech
recognition, on the customer's own ElevenLabs plan (`.env.example:51-54`). If this backend's key
sits in another workspace, the default is a local model, or no phase 3. Only installs with
internet access qualify. No new vendor or account receives user speech or text. Embeddings run
locally, as ADR 0006 planned (`sentence-transformers`, `0006-backend-stack.md:33`). A no-internet
install transcribes locally too, or skips phase 3 (C7).

**Rejected:** a hosted embedding API such as `text-embedding-3-large`. It sends every question,
hits included, to a vendor that sees nothing today, and it fails C7 (§5 Option E, "Which matcher").

**Owner decision, 2026-09-25: accepted.** The owner asked why ElevenLabs; the answer is above.
The live agent's own ElevenLabs workspace only, internet installs only, local embeddings. Persian
accuracy is unmeasured either way (U11, U14).

### 5. Provenance of drafts, approval, and audit

**Decision.** A draft's answer side comes only from a server-side read-back by provider id, once
U9 holds, never from answer text the browser posts (§5 Option E, "Provenance of a draft"). A
no-internet install cannot read back, so its drafts stay questions only (C7). The question side
may come from the browser, from signed-in users only (item 3). The draft, speech-to-text and match
endpoints each get their own rate limit: the hourly one counts session mints only
(`router.py:59-63`), and hosted speech-to-text is paid (§5 Option E, C3). Approving or rejecting
needs `require_admin` (`.../src/auth/dependencies.py:57-60`) and writes an audit row: reviewer,
decision, time, no user text. So does the existing video approval endpoint, which has no
`Depends(...)` (`.../src/main.py:444-458`) and no reviewer column
(`.../migrations/001_initial.sql:39-53`).

**Rejected:** browser-posted answer text, labelled a draft, and a careful reviewer. When the
suggested label was wrong, "the median user accepted suggestions 17% of the time without
modifications" (Levy et al., CHI 2021, fetched 2026-09-23, §5 Option E, "The confirm step").

**Owner decision, 2026-09-25: accepted.** One admin approves, and audit rows are kept as long as
the library exists. Approval by the practitioner needs a role that does not exist
(`.../migrations/002_assistant.sql:10`), so it is an auth-model change with its own decision.

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

**Owner decision, 2026-09-25: accepted.** Local disk, with Spaces as a per-install setting. The
owner named Spaces (§5 Option E). The setting costs an S3 client or a `finalize` rework (§4.4
correction), and needs a delete path before it is switched on (item 1).

### 7. BYO transport for the assistant

**What BYO means.** BYO is "bring your own". The avatar's audio and video travel through a
LiveKit media server. With the `managed` transport, the assistant's only mode today, LiveAvatar
runs that server, and our backend never sees the media. With BYO, LiveAvatar sends the media
through our own LiveKit server instead, so our backend could record a live answer. That is the only
reason this item exists: recording live answers is Option D. The workbench already uses BYO to
record staff videos (§4.1 row 7).

**Option D, in short.** The first user asks a question and the live avatar answers. Our server
records that answer. When a later user asks the same question, the server plays the recording
instead of starting a new live answer. The recording has the real live face and voice, which is
its one advantage. It has four problems:

- It needs BYO, and nobody knows if LiveAvatar allows BYO for the assistant (U1). Our code never
  tried it (`apps/api/services/liveavatar/client.py:88,132-138`).
- It stores one user's live conversation and shows it to another user. Item 2 says no to that.
- BYO needs a public media server on the internet, so it cannot work on a no-internet install.
- We would run and pay for the media server of every live session, not only of recordings.

Option B gets the same result without these problems: staff write the answers, and the
workbench renders them offline. Its one risk is the voice. A rendered answer may not sound like
the live voice (U10). Only if that check fails does Option D become worth a paid test (U1).

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

**Owner decision, 2026-09-25: accepted with a change.** The proposal was no BYO. The owner chose
to build Option D after Option B, so the assistant gets a BYO transport, and approved the U1 test.

- **Order:** Option B first. D reuses B's library, admin review screen and playback.
- **Precondition:** the U1 test. It runs in sandbox where it can: a sandbox session costs no
  LiveAvatar credits, though a voice agent session still uses the customer's ElevenLabs minutes.
  It needs our LiveKit server reachable on a public `wss://` address first
  (`apps/api/services/liveavatar/manager.py:73-81`). The owner is asked again right before the call.
- **If U1 is false:** server-side capture is closed. The owner then decides whether to capture in
  the browser instead (Option C).
- **If U1 is true:** D works on internet installs only. Every live session then runs through our
  LiveKit server, so its uptime becomes the assistant's uptime.

## Consequences

**What it buys.** Once accepted, a spec for E's phase 2 can pass the `writing-specs` gate (§8,
production item 8), and the next feature that wants conversation text meets a rule, not a gap.
Option B needs none of these answers (§6).

**What it costs.**

- Stored user text is a one-way door: undoing drafts is a privacy exercise (§5 Option E, Reversal).
- Drafts have no end date (item 1). The draft table and the review queue grow until an admin
  clears them, and an unread draft keeps a user's words with no limit.
- A consent step on the pre-session screen, in `en` and `fa`, on `mobile` and `web`, and on the
  widget once it signs users in. A user who does not agree cannot start a session (item 1).
- Every live answer is a stored video (item 1). Storage grows with every session, and every video
  waits for an admin to watch it. Unpublished recordings have no end date.
- A signed-in widget reverses ADR 0010 and needs its own ADR (item 3).
- Local models need a machine-learning runtime the image lacks (`.../requirements.txt:1-15`).
- A blob plays only after the whole file downloads (§5 Option B, C3 correction).
- Staff write every answer until U9 holds, which is the work the draft loop was meant to save.
- Each new table or status is an append-only migration with no downgrade (C4 in §3), and the
  review queue grows with every miss (§5 Option E, Cost).

**What deletion does not reach.** Database backups of the draft and recording tables, a recording
already published as a library entry, and the copy of a conversation that stays at the provider.
This ADR does not cover them. The spike has no evidence on backups or on the provider's copy.

**Options this enables or closes**, under the owner's decisions.

| Option | Needs | Result |
| ------ | ----- | ------ |
| B | nothing | open now |
| C | items 1, 2 and 7 | the fallback only if U1 is false, and only if the owner then chooses it |
| D | items 1, 2 and 7 | chosen, built after B, once U1 holds |
| E, phase 2 | items 1, 2, 3 and 5 | open for questions; the answer side waits on U9 |
| E, phase 3 | item 4 | open on internet installs, once U11, U12, U15 and U6 have evidence and the owner has set U13 |

The build order is B, then D. E's draft loop and a signed-in widget each come with their own spec.

**Documents that change on acceptance.**

- `docs/SECURITY.md` gains an item: conversation text is stored only as ADR 0014 allows, and
  never logged (item 13). Added with this acceptance.
- `docs/DATA_MODEL.md` gains the draft and recorded-answer tables, each with its own review status
  (not `DRAFT`), the audit columns and the retention rules, with the spec that builds them.
- `docs/DECISIONS/0010-website-widget.md` is superseded in part by the signed-in widget ADR
  (item 3).
- `docs/API.md` and `apps/frontend/src/data/mock/handlers.ts`, with the spec that adds endpoints.

**Background jobs go to ADR 0015.** They are not conversation data, and the retry question does
not fit in a screen. ADR 0015 must settle: an in-process runner over `generation_jobs` or a queue
library such as `arq` (§5 Option E, "The job runner"); who owns job state, with its lease and
attempt columns (`.../migrations/001_initial.sql:55-67`); retry after the process dies, with its
Egress recording and its LITE session held in memory (`apps/api/services/liveavatar/manager.py:53`,
U18); `GET /api/jobs/{jobId}` (`docs/API.md:20-22`) and a `finalize` that no longer busy-waits
(`.../src/main.py:406-409`); and whether it runs scheduled deletion. Item 1 no longer needs one
for drafts.

**Not settled here, and still the owner's:** the acceptable false-confirm rate (U13), and whether
a user must be told that a recording is playing (§8, open questions).

**The wrong fix this prevents.** Item 13 invites two wrong readings: "it only bans logging, so
store question text freely", and "it talks about not storing conversations, so do not store even
per-answer counts". This record closes both: user text is stored only as items 1 to 3 allow, and
per-answer metadata is allowed now. A third wrong reading comes with item 1's change: "drafts have
no end date, so a job may clean them up". It may not. Only an admin decides about a draft, or a
user's deletion request.
