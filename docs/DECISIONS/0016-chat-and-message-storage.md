# 0016. Chat and message storage

Status: Proposed (2026-10-02). Question 1 answered 2026-10-02; the other items wait for the owner.
If accepted, it changes ADR 0014 items 1 and 5 (item 9 lists each change).
Date: 2026-10-02

## Context

The owner asked for this on 2026-09-25: "Lead path: contact card + live assistant; avatar asks the
user to introduce themselves; store chats + messages (text and voice) + admin chat viewer like
/Users/sinashamsizadeh/projects/PadyarAIChatbot. Needs a new ADR (changes ADR 0014)." The
answer-library spec names it as the next step, after an ADR (`docs/features/response-caching/SPEC.md:83-85`).

**What exists today.** The browser drives the conversation with the SDK
(`.../src/assistant/service.py:66-71`). Turn text exists in the browser only, as a `TranscriptTurn`
(`apps/frontend/src/features/assistant/types.ts:48-52`), from agent events (`state.ts:343-384`),
transcription events (`useAssistantSession.ts:305-318`) or typed turns (`:503-514`). The browser
drops the agent's `audio` chunks (`state.ts:330-335`); the microphone goes straight to the
provider. The backend gets an answer's index and duration only (`service.py:219-224,245-247`), so
`docs/SECURITY.md:26-27` is true: "Today the backend stores none."

**The provider already keeps a copy.** The ElevenLabs API has "Get the audio recording of a
particular conversation" at `GET v1/convai/conversations/{conversation_id}/audio`, and each agent
has privacy settings: `record_voice`, `retention_days` ("-1 indicates there is no retention
limit"), `delete_audio`, `zero_retention_mode` (official `elevenlabs-python` SDK, generated from
the API, commit `963b4a5`, files `src/elevenlabs/conversational_ai/conversations/audio/client.py`
and `src/elevenlabs/types/privacy_config_output.py:12-40`, fetched 2026-10-02; the docs site
answered `403` to our fetch). The SDK does not say whether that audio holds both sides. LiveAvatar
passes the ElevenLabs `conversation_id` to the browser, and our hook ignores it
(`docs/features/response-caching/RESEARCH.md:977-981`). Whether this backend's key can read that
conversation is open (U9, `RESEARCH.md:1349`).

**The lead card.** After a recorded answer, «درخواست مشاوره» starts the live assistant
(`SPEC.md:673-689`). What the avatar says then, the request to introduce oneself included, lives in
the ElevenLabs agent prompt, outside this repository (`SPEC.md:688-689`). The lead card stores
nothing (`SPEC.md:1136-1138`).

**The rules this meets.** ADR 0014 item 1 allows one draft per missed visit and a recorded answer
holding "the avatar's audio and video only, never the user's microphone or camera"
(`0014-conversation-data-retention.md:63-76`). Phase 3 audio "is not kept after transcription"
(`0014:66-67`). It rejected "a draft per turn" (`0014:91-93`). Consent comes before Start, and
nothing is written before the spec that builds it (`0014:79-82`). The embed door stores nothing
(`0014:139-144`). `docs/SECURITY.md:16-18` (item 13) bans logging conversation text. No consent
text exists: "consent" appears nowhere in `apps/frontend/src`, and the microphone step says only
"Dr. Kohandezh needs to hear you" (`apps/frontend/src/i18n/locales/en/common.json:82-85`).

**The reference product.** PadyarAIChatbot (`PadyarAIChatbot@3a4a415`, "Padyar" below) stores
chats for an exhibition kiosk. What this ADR copies, changes or leaves:

| Padyar does | Here | Why |
| ----------- | ---- | --- |
| A conversation table and a message table, one row per message with a role (`migrations/0010_conversations.sql:120-154`) | Copy | A chat is read back whole, in order. A flat per-answer row cannot do that (`0010:33-38`) |
| Messages ordered by an identity id, not the time (`0009_conversation_memory.sql:16-21`, `0010:68-73`) | Copy | Two turns in the same instant must keep their order |
| Each assistant message records its source and the record that answered (`0010:145-150`) | Change: at chat level only (question 3) | Every message in our chat is a live answer: library answers play at `idle`, before any session (`docs/features/response-caching/SPEC.md:684-687`) |
| Admin routes all behind one admin dependency (`app/routers/conversations_admin.py:25-35`) | Copy, as `require_admin` | Same rule as our library admin router (`.../src/library/router.py:39`) |
| Message text is never edited (`conversations_admin.py:20-23`) | Copy | A transcript is a record, not content |
| The viewer never puts row text in `innerHTML` (`static/admin/js/conversations.js:3-9`) | Copy | Text typed by the public is shown inside an admin session |
| Export and delete are audited; opening a chat is not (`conversations_admin.py:250-276,279-295,298-317`) | Change: opening is audited too (item 5) | Our chats are health conversations |
| Anonymous chats are the majority, claimed later by a visitor (`0010:59-66`, `app/services/conversations.py:725-766`) | Do not copy | Our only stored chats belong to a signed-in user from the first turn (item 7) |
| An unsigned cookie names the conversation, with an ownership check added later (`app/routers/chat.py:333-355`) | Do not copy | Our chat is keyed by our session row, owned by the principal (`.../src/assistant/service.py:225-229`) |
| Raw IP and user agent on each conversation (`0010:127-128`) | Do not copy | Not needed to read a chat, and more personal data to delete |
| One retention dial, 0 = keep forever, deleting on a timer (`conversations.py:1161-1196`) | Change: no timer, the admin decides (item 6) | ADR 0014 item 1, as the owner decided it |
| A JSON "answers" bag on the visitor for what the bot learns (`0010:47-57`, `conversations.py:679-696`) | Do not copy now | Our user profile already holds name and phone (item 4) |
| A model-written rolling summary (`0011_conversation_summary.sql:13-33`) | Do not copy | Our backend sends no turn to a model; the agent holds context |
| A `feedback` column on messages (`0025_message_feedback.sql:31`) | Do not copy | Padyar dropped it again with its only reader and writer (`migrations/0028_drop_pwa_leftovers.sql:1-4,15`) |
| Spoken input is transcribed and the audio is not kept (`app/routers/voice.py:72-91`) | Matches ADR 0014 | Padyar stores no user voice either |
| Storage faults never cost the visitor an answer; admin reads raise (`conversations.py:21-27`, `chat.py:148-174`) | Copy | A failed write must not end a live conversation |
| The lead screen (`static/admin/js/leads.js:1-24`) | Do not copy | It manages exhibitor companies, not people who asked for a consultation |

Code is cited at `e476b4a`. `.../` is `apps/api/services/orchestrator/`. Padyar paths are at
`3a4a415`.

## Decision

Item 13 of `docs/SECURITY.md` holds for everything below (item 8). A chat is never replayed to
another user, and nothing here touches the library's review rules (ADR 0014 item 2).

### 1. The data: a chat and its messages

**Decision.** Three new tables in one append-only migration: chats, messages, and `chat_audit`
(item 5).

A **chat** is one live assistant session of a signed-in user. It references our `sessions` row
(`.../migrations/002_assistant.sql:23-30`), one chat per session. It holds: the user id (not
null), the target (`mobile` or `web`), the language, how it began (`start` or `lead_card`; the
library entry that led to it only if question 3 says yes), started and ended times, a message
count, a `partial` flag (item 3), and the provider's conversation id when the browser has it.

The target, the origin and the entry id are client-reported. They ride on the session start body,
`POST /api/assistant/session`, which takes only `language` today (`.../src/schemas.py:227-228`).
That is a contract change (item 9). The server checks the values against fixed lists and that the
entry exists, but cannot prove them.

A **message** holds: the chat, an identity id for order, the role (`user` or `avatar`), the text,
the input kind (`spoken` or `typed`), the provider's event id (unique per chat, so a resent turn is
a duplicate), and the server's insert time. It has no voice reference: no audio is stored (item
2), and a later decision that keeps audio adds the column. It has no answer source: every message is a live turn, because library answers play at
`idle`, before any session exists (`docs/features/response-caching/SPEC.md:684-687`). A
message-level entry link would also join a person to a health topic, which a library play avoids
on purpose (`docs/DATA_MODEL.md:162-165`).

Relations. `provider_usage` rows stay; a speech segment is not a turn, so they are not joined. A
recorded live answer of Option D (ADR 0014 item 1) may later reference its message.

**Rejected:** extra columns on `sessions`. A session has many turns, and its `metadata` JSONB
already mixes provider facts. And Padyar's two parallel stores (`0010:18-45`): we have no
dashboard reading a flat table.

**Owner decision:** Open, see question 3.

### 2. Voice

**Decision.** The owner's words "text and voice" read two ways. (a) Voice conversations: store
the words of spoken chats as text, marked `spoken`. (b) Voice recordings: keep audio. The owner
chose V0 (below). The options:

| Option | What is kept | How it gets here | Fits ADR 0014 |
| ------ | ------------ | ---------------- | ------------- |
| V0 | Text only, spoken turns marked `spoken` | Item 3 | Yes, after item 1's change |
| V1 | V0 plus the avatar's audio | Read back from ElevenLabs by conversation id (U9), or BYO capture (ADR 0014 item 7, U1) | Close: item 1 already keeps avatar audio inside recorded answers |
| V2 | V0 plus the user's own voice | Read-back (if that audio holds both sides, unverified), or the browser uploads its microphone | No. It reverses `0014:66-67,71-72`, and it is health speech: needs counsel |

No audio is stored. If a later decision keeps audio, it follows ADR 0014 item 6: local disk by
default, S3 as a setting, served only through the backend as a blob to an admin (`0014:205-209`).

**Owner decision, 2026-10-02:** V0. Spoken turns are stored as text, marked `spoken`. No audio is
stored. V1 and V2 need a new decision (V1 after U9, V2 after counsel).

### 3. Transport

The options. Costs are per install; "U9" is the read-back question (`RESEARCH.md:1349`).

| Option | Real cost | One failure mode |
| ------ | --------- | ---------------- |
| T0. Store only the provider conversation id; read or link on demand | Almost no storage. Every view is a provider call (per-call cost unknown), and needs U9 | The provider's `retention_days` passes, or the key sits in another workspace: the chat is gone. No search across chats; a no-internet install has nothing |
| T1. The browser posts turns (the pick) | One endpoint, one table pair, limits | A dead tab or a dropped network loses the last turns: the chat is `partial` |
| T2. Read-back by id after the session, as the primary source | One provider call per chat, needs U9 and the browser's id | Fails on a no-internet install, and when the provider deletes first |
| T3. ElevenLabs post-call webhook | A public inbound URL; a signature check; mapping the provider id to our session and user | Fails on a no-internet install. It receives every conversation of the workspace, other agents' included (`RESEARCH.md:990-991`), and a delivery missed while we are down is lost (inference; webhook retry behaviour not checked) |

T1 is the only option that works today on every install, with no provider capability left to
prove and no public endpoint. Its weakness is trust in the browser, which matters little for a
record only admins read (below). T2 is its later check, not its replacement.

**Decision.** The browser posts each finished turn to a new endpoint on the session,
`POST /api/assistant/session/{id}/messages`, in batches, the way `answerReporter.ts` already posts
answers (`apps/frontend/src/features/assistant/answerReporter.ts:4-14,22-32`). The backend checks
that the caller owns the session and that it is open (`.../src/assistant/service.py:225-235`). It
caps the text length and the messages per chat, and gives the endpoint its own rate limit, as
`answers` has (`.../src/assistant/router.py:105-115`). Text travels in the body, never the URL.
It posts turns from the deduplicated transcript, not raw provider events, since the provider sends
one sentence twice under two event ids (`state.ts:174-192`).

The text is what the browser says it heard. For a record only admins read, that is enough
(inference: a false turn misleads one reader, never another user). It is not a draft and never
becomes library content, so ADR 0014 item 5's provenance rule is untouched.

**Failure and partial chats.** A failed write never stops the conversation (Padyar's rule,
`chat.py:148-150`). The browser retries once, as the answer reporter does
(`answerReporter.ts:35-55`), then drops the batch; the `partial` flag rides on the next batch that
succeeds, or on close. A tab that dies sends neither, so the server closes the chat at the
deadline that refuses late answers (`service.py:231-235`) and sets `partial` itself.

**Corrections.** The agent can rewrite what it said, usually after an interruption, and the
browser replaces that turn's text (`state.ts:194-216`). The browser sends the correction once,
matched by the turn's event id, and the server replaces that avatar message's text once. This is
the provider's own record of what was actually said, not an admin edit, so item 5's no-edit rule
holds: the stored text should match what the user heard.

**Rejected:** server capture under BYO as the source of text. It needs U1, a public media server
for every session, and speech-to-text of the recording (`0014:244-269`). T0, T2 and T3 for the
reasons in the table.

**Owner decision:** Open, see question 2.

### 4. The introduction

**Decision.** Only signed-in users on `mobile` and `web` reach the lead card (`SPEC.md:673`). Their
phone is their login and their name is set at onboarding (`docs/DATA_MODEL.md:32-34,51-58`). So
the avatar asks the user's need, never the phone. The introduction is stored as ordinary messages.
Nothing is copied into the `users` row: a name or phone spoken in a chat stays message text.

A **lead** is a chat that began at the lead card, found as a filter of the chat list (item 5). No
lead table now. It links to the person by the chat's user id, and to the answer that led to it by
the entry id if question 3 allows. The origin and the entry id come from the browser in the
session start body (item 1), so a lead is what the client reported, not a server fact.

The agent prompt is outside this repository (`SPEC.md:688-689`). Greeting the user by name needs
the backend to pass it to the agent; whether LiveAvatar forwards such values is not verified.

**Rejected:** parsing the introduction into profile fields. Nothing here can parse speech reliably,
and a profile changed by a chat surprises the user. And Padyar's answers bag (`0010:47-57`): it
duplicates the profile.

**Owner decision:** Open, see question 4.

### 5. The admin chat viewer

**Decision.** A "Chats" screen in the `admin` target only. Its API sits on a router with
`dependencies=[Depends(require_admin)]` (`.../src/auth/dependencies.py:57-61`). The screen guards
are UX on top of that rule. The list: newest first, filters by date, user, language, `lead_card`
and `partial`, and a text search over message bodies. The detail: the user's name and phone (an
admin already sees them in `GET /api/admin/users`) and every message in order with its role and
input kind. Text is rendered as text, never as HTML. No edit of any message. No export in the
first build.

**Audit.** Opening a chat, deleting a chat, and carrying out a user's deletion request each write
a row in `chat_audit` (item 1): admin id, chat or user id, action, time, no text. Bare ids with
no foreign key, so a row outlives its chat, as a review row keeps a deleted video's id
(`docs/DATA_MODEL.md:312`). Padyar audits only export and delete. The strong audit log of ADR
0015 item 3 (`0015-background-jobs.md:140-142`) can take these rows over later.

**Search terms are user text too.** An admin may type a patient's name. The term goes in a request
body, or the access log is configured to drop query strings: the API runs uvicorn with its default
access log (`.../Dockerfile:28`), which prints the request line with its query (inference from
uvicorn's defaults; the spec verifies it).

**Owner decision:** Open, see question 5.

### 6. Retention, deletion and consent

**Decision.** Chats follow ADR 0014 item 1: no timer. A chat stays until an admin deletes it or
its user asks for deletion. A deletion request removes that user's chats and messages by user
id; an admin carries it out; the audit row stays without text. Deletion does not reach backups or
the provider's copy, which ElevenLabs keeps under the agent's own `retention_days`, set by the owner.

**Consent.** ADR 0014's consent text covers questions and answers "stored and may be shown to
others after review" (`0014:79-80`). It does not say the whole conversation is kept and read by
staff, and none of it exists in the app yet. So one consent step, for this ADR and ADR 0014, names
chats, admin access, and that spoken turns are kept as text, with no audio. No chat is written before the spec that
builds it. Without agreement, no chat is stored.

**Rejected:** a fixed retention period. The owner removed the 30-day timer from ADR 0014 item 1.
Counsel may still require one (`0014:99-102`); then this item is amended with item 1.

**Owner decision:** Open, see question 6.

### 7. The widget

**Decision.** ADR 0014 item 3 stays. Nothing is stored from the anonymous embed door. The messages
endpoint refuses the embed principal (`.../src/assistant/router.py:50-54`). Once the signed-in
widget ADR is built, widget chats are stored like `web` chats.

**Rejected:** storing anonymous widget chats, Padyar's main case. A visitor with no user id cannot
ask for deletion, and anyone on an allowed origin could post text with the public key
(`0014:139-142`).

**Owner decision:** Open, see question 7.

### 8. Logging

**Decision.** `docs/SECURITY.md` items 13 and 17 hold. Log events carry ids and counts only:
session id, chat id, number written, duplicates, `partial`. No message text, search term, name or
phone. A test asserts that writing messages and searching leave no text in any log record, as ADR
0014 requires for drafts. The stored text is data under this ADR, not a log.

**Owner decision:** Open, see question 7.

### 9. What changes in ADR 0014, and which docs change

| ADR 0014 item | Change |
| ------------- | ------ |
| 1 | Adds a record: every turn of a signed-in live chat, as text, spoken turns included, no audio (item 2). Its "Rejected: a draft per turn" stays true for drafts: a chat is not a draft and never reaches the library. The consent text widens (item 6 here) |
| 2 | None. A chat is never shown to another user |
| 3 | None. The embed door stores nothing |
| 4 | None for V0. V1 or V2 by read-back uses the same ElevenLabs workspace that already hears the user |
| 5 | Adds: browser-posted chat text is allowed because it is never a draft; chat views and deletions write audit rows |
| 6 | None. No chat audio is stored (item 2) |
| 7 | None. Chats need no BYO |

ADR 0014 gets one status line: "Proposed change: ADR 0016". On acceptance it is marked amended in
part, with the date.

**Documents that change when this is built**, not in this change: `docs/SECURITY.md` item 17
("Today the backend stores none"); `docs/DATA_MODEL.md` (the three tables, the retention rule);
`docs/API.md` and `apps/frontend/src/data/mock/handlers.ts` (the messages endpoint, the admin chat
routes, and the new fields of `POST /api/assistant/session`, a contract change); the
`assistant-session` entity schema; `docs/features/response-caching/SPEC.md:83-85,1441-1443` (the
next step becomes a link); the `en` and `fa` locale files; `CHANGELOG.md`. None is wrong today.

**Open, for the spec:** a `disabled` user's chats stay as they are; the user cannot log in to add
more (`docs/DATA_MODEL.md:59`), and deletion follows item 6. The per-call cost of a later
read-back is unknown. V0 needs no ADR 0015 background job; a later read-back would.

**Owner decision:** Open, see questions 2 to 7 (question 1 answered, item 2).

## Questions for the owner

1. **What does "voice" mean?** **Answered 2026-10-02: V0**, spoken turns kept as text, no audio
   (item 2). The avatar's audio (V1) needs a new decision after U9, the user's voice (V2) after
   counsel.
2. **Transport: T1, the browser posts chat text, before a read-back is proven?** **Recommended:
   yes.** Item 3's table: only T1 works today on every install with no public endpoint. Approve one
   U9 test (one sandbox conversation, one read by id) so T2 can check chats later.
3. **Does a chat record the library answer that led to it?** Today a library play stores no user
   or session id on purpose (`docs/DATA_MODEL.md:159-165`). **Recommended: yes, only when the user
   then starts a live chat from the lead card.** The lead is the point of that chat. A plain play
   stays anonymous.
4. **The introduction.** **Recommended:** the agent asks the user's need, never the phone, and
   nothing is copied into the profile. Lead = a chat begun at the lead card, no lead table yet. Say
   if staff need a lead status (new, contacted) now; that adds one table.
5. **Is opening a chat audited, or only deleting?** **Recommended: opening too.** These are health
   conversations, and an audit row costs one insert.
6. **Retention.** **Recommended:** no timer, admin decides, as ADR 0014 item 1. Set the ElevenLabs
   agent's own `retention_days` too, since our deletion does not reach the provider.
7. **Items 7 and 8** keep ADR 0014 item 3 and the logging ban unchanged. **Recommended: accept as
   written.**

## Consequences

**What it buys.** The owner's lead path gets its record: who asked for a consultation, after which
answer, and what they said. Staff learn which questions users ask, which ADR 0014 wanted drafts for,
without a draft loop.

**What it costs.**

- Every turn of every signed-in live chat is stored with no end date. A one-way door: undoing it
  is a privacy exercise.
- A consent step on `mobile` and `web` in `en` and `fa`, before any chat is written.
- Text, target and origin are what the browser reports. A broken or hostile client can store wrong
  turns in its own chat only.
- A new endpoint with its own limits, a changed session start body, three tables (chats,
  messages, `chat_audit`), an admin screen, and deletion by user id.
- Chats are `partial` whenever a tab dies or the network drops; nothing fills the gap until a
  read-back exists.

**What it does not do.** No audio of the user or the avatar. No lead table or lead status. No export. No chat history
for the user. No widget chats until the signed-in widget ADR. No model summary.

**The wrong fix this prevents.** A reviewer sees browser-posted text and "fixes" it by sending
chats into the draft queue or the library. Chat text is for the admin to read only. It never
becomes content shown to another user without staff rewording and ADR 0014's review.
