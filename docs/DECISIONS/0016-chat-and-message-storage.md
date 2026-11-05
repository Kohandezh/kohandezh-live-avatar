# 0016. Chat and message storage

Status: Proposed (2026-10-02). Questions 1 and 2 answered, question 3 replaced (2026-10-02); the
other items wait for the owner. If accepted, it changes ADR 0014 items 1, 4 and 5 (item 9).
Date: 2026-10-02

## Context

The owner asked for this on 2026-09-25: "Lead path: contact card + live assistant; avatar asks the
user to introduce themselves; store chats + messages (text and voice) + admin chat viewer like
/Users/sinashamsizadeh/projects/PadyarAIChatbot. Needs a new ADR (changes ADR 0014)." The
answer-library spec names it as the next step, after an ADR (`docs/features/response-caching/SPEC.md:83-85`).

**The owner's decisions of 2026-10-02** (translated from Persian). Library answers count: "We must
know what the user talked about." Each question tries the local library of recorded videos first;
on a hit, LiveAvatar is not used. A chat can mix sources (questions 1 and 2 from the library, 3
live), and its earlier turns go to the ElevenLabs agent. A failed post is retried inside the
session, then the user sees a message chosen by the status code. Browser posts are fine. Voice is V0.

**What exists today.** The browser drives the conversation with the SDK
(`.../src/assistant/service.py:66-71`). Turn text exists in the browser only, as a `TranscriptTurn`
(`apps/frontend/src/features/assistant/types.ts:48-52`), from agent events (`state.ts:343-384`),
transcription events (`useAssistantSession.ts:305-318`) or typed turns (`:503-514`), and a new
start clears it (`state.ts:75-81`). The browser drops the agent's `audio` chunks
(`state.ts:330-335`); the microphone goes straight to the provider. The backend gets an answer's
index and duration only (`service.py:219-224,245-247`), so `docs/SECURITY.md:26-27` is true: "Today
the backend stores none." A library answer needs a signed-in user (`.../src/library/router.py:38`)
and plays only at `idle` (`apps/frontend/src/features/answer-library/useAnswerLibrary.ts:41-44`).
Which question goes to the library and which goes live is the matcher spike's subject.

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
| Each assistant message records its source and the record that answered (`0010:145-150`) | Copy, as `library` with the entry id or `live` | Owner decision, 2026-10-02: library answers count (item 1) |
| Admin routes all behind one admin dependency (`app/routers/conversations_admin.py:25-35`) | Copy, as `require_admin` | Same rule as our library admin router (`.../src/library/router.py:39`) |
| Message text is never edited (`conversations_admin.py:20-23`) | Copy | A transcript is a record, not content |
| The viewer never puts row text in `innerHTML` (`static/admin/js/conversations.js:3-9`) | Copy | Text typed by the public is shown inside an admin session |
| Export and delete are audited; opening a chat is not (`conversations_admin.py:250-276,279-295,298-317`) | Change: opening is audited too (item 5) | Our chats are health conversations |
| Anonymous chats are the majority, claimed later by a visitor (`0010:59-66`, `app/services/conversations.py:725-766`) | Do not copy | Our only stored chats belong to a signed-in user from the first turn (item 7) |
| An unsigned cookie names the conversation, with an ownership check added later (`app/routers/chat.py:333-355`) | Do not copy | Our chat is a server row, owned by the principal from its creation (item 1) |
| Raw IP and user agent on each conversation (`0010:127-128`) | Do not copy | Not needed to read a chat, and more personal data to delete |
| One retention dial, 0 = keep forever, deleting on a timer (`conversations.py:1161-1196`) | Change: no timer, the admin decides (item 6) | ADR 0014 item 1, as the owner decided it |
| A JSON "answers" bag on the visitor for what the bot learns (`0010:47-57`, `conversations.py:679-696`) | Do not copy now | Our user profile already holds name and phone (item 4) |
| A model-written rolling summary (`0011_conversation_summary.sql:13-33`) | Do not copy | Earlier turns go to the agent as they are (item 10); our backend calls no model |
| A `feedback` column on messages (`0025_message_feedback.sql:31`) | Do not copy | Padyar dropped it again with its only reader and writer (`migrations/0028_drop_pwa_leftovers.sql:1-4,15`) |
| Spoken input is transcribed and the audio is not kept (`app/routers/voice.py:72-91`) | Matches ADR 0014 | Padyar stores no user voice either |
| Storage faults never cost the visitor an answer; admin reads raise (`conversations.py:21-27`, `chat.py:148-174`) | Copy | A failed write must not end a conversation |
| The lead screen (`static/admin/js/leads.js:1-24`) | Do not copy | It manages exhibitor companies, not people who asked for a consultation |

Code is cited at `0927cb3`. `.../` is `apps/api/services/orchestrator/`. Padyar paths are at
`3a4a415`.

## Decision

Item 13 of `docs/SECURITY.md` holds for everything below (item 8). A chat is never replayed to
another user, and nothing here touches the library's review rules (ADR 0014 item 2).

### 1. The data: a chat and its messages

**Decision.** Three new tables in one append-only migration (chats, messages, `chat_audit` of
item 5) and a nullable `chat_id` on `sessions`.

**The boundary.** A chat starts with a signed-in user's first question on `/video` or `/audio`,
from the library or live; a visit with no question writes no chat. It holds every later turn of
that visit: library turns and 0, 1 or more live sessions (End, then Start, stays in it). It ends
when the user leaves the screen (route change, `pagehide`, closed tab) or after an idle gap with
no turn and no open session; a reload starts a new chat. A mode switch is a route change today:
"switching modes ends the conversation"
(`apps/frontend/src/features/assistant/useConversationScreen.ts:60-66`). So it ends the chat, and
item 10's context with it. Inference: our reading of the owner's example
(question 8). The spec sets the gap, long enough that a lead card tap after a recorded answer
stays in the chat, and whether a language change starts a new one.

A **chat** holds: the user id (not null), the target (`mobile` or `web`), the language of its first
turn, a `lead` flag (item 4), started and ended times, a message count, and a `partial` flag (item
3). Each live session in it sets `sessions.chat_id` (`.../migrations/002_assistant.sql:23-30`): 0
to n sessions per chat, at most one chat per session. The provider's conversation id stays with
the session. The session start body, which takes only `language` today
(`.../src/schemas.py:227-228`), gains an optional chat id and the origin (`start` or `lead_card`):
a contract change (item 9). A session after a library turn carries the chat id. A plain Start
before any question has none; the first turn posted for it opens the chat and links the session
(inference: our design). The server checks that the chat is the caller's and open, and the origin
against a fixed list, but cannot prove the target or the origin.

A **message** holds: the chat, an identity id for order, the role (`user` or `avatar`), the text,
the input kind (`spoken`, `typed` or `tapped`), the **answer source**, a client turn id (unique per
chat, so a resent turn is a duplicate), and the insert time. Source `live` carries the session id,
with the provider's event id as turn id. Source `library` carries the entry id, with a turn id the
browser makes. No voice reference: no audio is stored (item 2).

**A library turn** is two messages, both source `library`: the question as asked (today a tapped
suggestion or follow-up; later a typed or spoken question the matcher sends to the library) and
the entry's answer. The browser posts it once the download succeeds, when the server counts a play
(`.../src/library/router.py:97-130`). For a tap it sends only the entry id; the server copies the
entry's `question` and `answer_text` (at most 300 and 480 characters,
`.../migrations/006_library_entries.sql:11,14`), only for a servable entry (`router.py:114-116`).
The texts are server facts that stay what the user saw; that the play happened is client-reported.
For a typed or spoken question the browser also sends the user's words.

**Owner decision, 2026-10-02:** library answers count as chat messages. This reverses the earlier
text of this item (no source, since library answers play before any session). A library message
joins a person to a library topic, a health question. The usage row avoids exactly that
(`docs/DATA_MODEL.md:159-165`), and its rule stays: the chat is a separate record, and item 6's
consent text must name it.

Relations. `provider_usage` rows stay; a speech segment is not a turn, so they are not joined. A
recorded live answer of Option D (ADR 0014 item 1) may later reference its message.

**Rejected:** one chat per live session, as before: it splits the owner's example (two library
answers, then a live question) across records. Turns as columns on `sessions`. Writing the library
turn inside the video `GET`: it ties the anonymous usage path to a person. Padyar's two parallel
stores (`0010:18-45`): we have no dashboard reading a flat table.

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
| T0. Store only the provider conversation id; read or link on demand | Almost no storage. Every view is a provider call (per-call cost unknown), and needs U9 | The provider's `retention_days` passes, or the key sits in another workspace: the chat is gone. No library turns, no search; a no-internet install has nothing |
| T1. The browser posts turns (the pick) | Three routes, one table pair, limits | A dead tab or a dropped network loses the last turns: the chat is `partial` |
| T2. Read-back by id after the session, as the primary source | One provider call per session, needs U9 and the browser's id | Fails on a no-internet install, and when the provider deletes first. No library turns |
| T3. ElevenLabs post-call webhook | A public inbound URL; a signature check; mapping the provider id to our session and user | Fails on a no-internet install. It receives every conversation of the workspace, other agents' included (`RESEARCH.md:990-991`), and a delivery missed while we are down is lost (inference; webhook retry behaviour not checked) |

T1 is the only option that works today on every install, with no provider capability left to
prove and no public endpoint, and the only one that sees library turns. Its weakness is trust in
the browser, which matters little for a record only admins read (below). T2 can later check the
live turns.

**Decision.** The browser opens a chat with `POST /api/chats` on the first question and posts each
finished turn to `POST /api/chats/{id}/messages`, in batches, the way `answerReporter.ts` posts
answers (`apps/frontend/src/features/assistant/answerReporter.ts:4-14,21-33`). The backend checks
that the caller owns the chat and that it is open, and for a `live` turn that the session is the
chat's and open (`.../src/assistant/service.py:225-235`). It caps the text length and the messages
per chat, and gives the endpoints their own rate limit, as `answers` has
(`.../src/assistant/router.py:105-115`). Text travels in the body, never the URL. Live turns come
from the deduplicated transcript, not raw provider events, since the provider sends one sentence
twice under two event ids (`state.ts:174-192`). The browser sends `POST /api/chats/{id}/close` when
the chat ends (item 1). On `pagehide` that request may not leave the page, and a beacon cannot
carry the native bearer header (`docs/SECURITY.md:37`). So the fallback is the server: it closes a
chat after the idle gap and sets `partial` when no close came.

The text is what the browser says it heard. For a record only admins read, that is enough
(inference: a false turn misleads one reader, never another user). It is not a draft and never
becomes library content, so ADR 0014 item 5's provenance rule is untouched.

**Failure.** A failed write never stops the conversation or blocks a question (Padyar's rule,
`chat.py:148-150`). The browser retries inside the session, then shows at most one quiet notice
per chat. The answer reporter retries once and shows nothing (`answerReporter.ts:35-64`); here
the user's record is at stake. Inference: we read the owner's "post" as these chat writes; the
failure UX of the question itself belongs to the matcher spike. Exact copy is the spec's:

| Outcome | Browser | The user sees |
| ------- | ------- | ------------- |
| No response, timeout, `5xx` | Retries with backoff; offline, waits for the network | After the last retry: this conversation may not be saved in full |
| `429` | Waits `Retry-After`, then retries | The same line, only if the retries run out |
| `401` | Stops posting | Your sign-in has ended, so this conversation is no longer saved |
| `403` | Stops posting | This conversation cannot be saved |
| `404` (chat gone), `409` (chat closed) | Opens a new chat for the next turns, once | Nothing, unless that fails too |
| `413`, `422` (too long, invalid) | Drops that turn, keeps the others | One message could not be saved |

Every lost turn sets `partial`, carried by the next batch that succeeds or by the close. In every
row the chat goes on: the notice is not an error state, and the live session is not touched.

**Corrections.** The agent can rewrite what it said, usually after an interruption, and the
browser replaces that turn's text (`state.ts:194-216`). The browser sends the correction once,
matched by the client turn id, and the server replaces that avatar message's text once. This is
the provider's own record of what was actually said, not an admin edit, so item 5's no-edit rule
holds: the stored text should match what the user heard.

**Rejected:** server capture under BYO as the source of text. It needs U1, a public media server
for every session, and speech-to-text of the recording (`0014:244-269`). T0, T2 and T3 for the
reasons in the table.

**Owner decision, 2026-10-02:** T1: "In general I have no problem with it being on the browser
side." A failed post is retried inside the session, then a message is shown by status code.

### 4. The introduction

**Decision.** Only signed-in users on `mobile` and `web` reach the lead card (`SPEC.md:673`). Their
phone is their login and their name is set at onboarding (`docs/DATA_MODEL.md:32-34,51-58`). So
the avatar asks the user's need, never the phone. The introduction is stored as ordinary messages.
Nothing is copied into the `users` row: a name or phone spoken in a chat stays message text.

A **lead** is a chat with a live session started from the lead card (its `lead` flag), found as a
filter of the chat list (item 5). No lead table now. It links to the person by the chat's user
id. The answer that led to it is the `library` turn just before that session in the same chat
(item 1), so no separate entry field is needed. The origin comes from the browser in the session
start body (item 1), so a lead is what the client reported, not a server fact.

The agent prompt is outside this repository (`SPEC.md:688-689`). Greeting by name needs the agent
to receive the name; only item 10's contextual update could carry it. Not decided here.

**Rejected:** parsing the introduction into profile fields. Nothing here can parse speech reliably,
and a profile changed by a chat surprises the user. And Padyar's answers bag (`0010:47-57`): it
duplicates the profile.

**Owner decision:** Open, see question 4.

### 5. The admin chat viewer

**Decision.** A "Chats" screen in the `admin` target only. Its API sits on a router with
`dependencies=[Depends(require_admin)]` (`.../src/auth/dependencies.py:57-61`). The screen guards
are UX on top of that rule. The list: newest first, filters by date, user, language, `lead` and
`partial`, and a text search over message bodies. The detail: the user's name and phone (an admin
already sees them in `GET /api/admin/users`) and every message in order with its role, input kind
and source (a library message names its entry). Text is rendered as text, never as HTML. No edit
of any message. No export in the first build.

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
the provider's copy, which ElevenLabs keeps under the agent's own `retention_days`, set by the
owner; the context of item 10 joins that copy (inference).

**Consent.** ADR 0014's consent text covers questions and answers "stored and may be shown to
others after review" (`0014:79-80`). It does not say the whole conversation is kept and read by
staff, and none of it exists in the app yet. So one consent step, for this ADR and ADR 0014, names
chats, admin access, spoken turns kept as text with no audio, each played recorded answer kept in
the chat, and earlier turns of the chat, recorded answers included, sent to the live assistant's
provider (item 10). A library tap writes a turn, so consent comes before the first question. No
chat is written before the spec that builds it, or without agreement. Whether a user who declines
may still play library answers, unstored, is open; any legal limit needs counsel.

**Rejected:** a fixed retention period. The owner removed the 30-day timer from ADR 0014 item 1.
Counsel may still require one (`0014:99-102`); then this item is amended with item 1.

**Owner decision:** Open, see question 6.

### 7. The widget

**Decision.** ADR 0014 item 3 stays. Nothing is stored from the anonymous embed door. The chat
endpoints refuse the embed principal (`.../src/assistant/router.py:50-54`). Once the signed-in
widget ADR is built, widget chats are stored like `web` chats.

**Rejected:** storing anonymous widget chats, Padyar's main case. A visitor with no user id cannot
ask for deletion, and anyone on an allowed origin could post text with the public key
(`0014:139-142`).

**Owner decision:** Open, see question 7.

### 8. Logging

**Decision.** `docs/SECURITY.md` items 13 and 17 hold. Log events carry ids and counts only:
session id, chat id, number written, duplicates, `partial`. No message text, no entry id of a
user's turn, no search term, name or phone. A test asserts that writing messages, sending context
and searching leave no text in any log record, as ADR 0014 requires for drafts. The stored text
is data under this ADR, not a log.

**Owner decision:** Open, see question 7.

### 9. What changes in ADR 0014, and which docs change

| ADR 0014 item | Change |
| ------------- | ------ |
| 1 | Adds a record: every turn of a signed-in chat as text, spoken and library turns included, no audio (item 2). A library turn joins the user to an entry. "Rejected: a draft per turn" stays true for drafts: a chat is not a draft and never reaches the library. The consent text widens (item 6 here) |
| 2 | None. A chat is never shown to another user |
| 3 | None. The embed door stores nothing |
| 4 | Adds: earlier turns, library topics included, reach the ElevenLabs agent as context (item 10). The same workspace already hears the user; no new vendor. V1 or V2 by read-back would use it too |
| 5 | Adds: browser-posted chat text is allowed because it is never a draft; a library answer's text is copied by the server from the entry; chat views and deletions write audit rows |
| 6 | None. No chat audio is stored (item 2) |
| 7 | None. Chats need no BYO |

ADR 0014 gets one status line: "Proposed change: ADR 0016". On acceptance it is marked amended in
part, with the date.

**Documents that change when this is built**, not in this change: `docs/SECURITY.md` item 17
("Today the backend stores none"); `docs/DATA_MODEL.md` (the three tables, `sessions.chat_id`, the
retention rule, and a note at `:159-165` that a chat joins a person to an entry while the usage
row still does not); `docs/API.md` and `apps/frontend/src/data/mock/handlers.ts` (the chat
endpoints, the admin chat routes, the new fields of `POST /api/assistant/session`); the
`assistant-session` entity schema and a new chat entity; `docs/features/response-caching/SPEC.md:83-85,1136-1138,1441-1443`
(the next step becomes a link; a library play and the lead card now write chat turns); the `en`
and `fa` locale files; `CHANGELOG.md`. None is wrong today.

**Open, for the spec:** a `disabled` user's chats stay as they are; the user cannot log in to add
more (`docs/DATA_MODEL.md:59`), and deletion follows item 6. The per-call cost of a later
read-back is unknown. V0 needs no ADR 0015 background job; a later read-back would. The agent's
greeting may come before the context (item 10); the agent prompt decides whether it waits.

**Owner decision:** Questions 1 and 2 answered, question 3 replaced; see questions 4 to 8.

### 10. Context to the agent

**Decision.** Once per live session, after the SDK's own state is `CONNECTED`
(`SESSION_STATE_CHANGED`, `useAssistantSession.ts:236-238`, or after `start()` resolves), the
browser sends the chat's earlier turns with `sendContextualUpdate(text)`, then the pending
question, if any, with `sendUserMessage`. Not on the app's first `connected`, which usually comes
from the stream-ready event before `start()` resolves (`useAssistantSession.ts:245-250`): every
agent command throws until the SDK state is `CONNECTED` (`@heygen/liveavatar-web-sdk` 0.0.18,
`lib/index.esm.js:1383-1388,1434-1438`). The exact hook point is for the spec. The SDK calls the
two calls "silent context the agent can use" and "equivalent to typing in the ElevenLabs widget"
(`lib/LiveAvatarSession/ElevenLabsAgentSession.d.ts:32-35`). ElevenLabs says a contextual update
is "non-interrupting background information" that "does not interrupt the current conversation
flow", and a user message "triggers the same response flow as spoken user input" ("Client to
server events", fetched 2026-10-02 and 2026-10-18). Context cannot go at session start: LiveAvatar
rejects per-session overrides for this agent type (`apps/api/services/liveavatar/client.py:128-129`).

**What is sent.** Plain text, oldest first, each turn labelled with speaker and source, cut to the
last turns under a character cap. The size limit is unknown: the SDK states none, and ElevenLabs
says only "Send relevant but concise contextual information". The spec measures it before setting
the cap; a library turn is at most 780 characters (item 1). The call returns an event id, no
receipt (`ElevenLabsAgentSession.d.ts:35`). Inference: the browser cannot know the agent used it,
and the agent's greeting (set in its prompt, outside this repository, `SPEC.md:688-689`) may play
before the context and not reflect it. The provider cost per call is unknown. The path rests on
`ElevenLabsAgentSession` of SDK 0.0.18, whose agent commands carry TODOs (`lib/index.esm.js:1417-1429`).

**Source: browser memory (recommended).** The page keeps one chat log in React state, read by the
poster (item 3) and by this step. The agent hears what the user saw, failed writes included; no
endpoint returns a person's chat text; no request sits before the question. A reload loses the
log, but also starts a new chat (item 1). No such log exists today: the library holds one answer
(`apps/frontend/src/features/answer-library/useRecordedAnswer.ts:28-29`), and a start clears the
transcript (`state.ts:75-81`). **Rejected:** reading the stored chat back: a new read path for
health text, one more request before the answer, and a gap whenever the chat is `partial`. No
context at all: the agent would answer question 3 without questions 1 and 2, the owner's example.

**Persona mode.** `persona` is FULL mode, English only, used when no voice agent is configured
(`.../src/assistant/service.py:35-39,96`). Its class has `message()` and no contextual update
(`lib/LiveAvatarSession/LiveAvatarSession.d.ts:29-38`). There the question goes alone, with no
earlier turns, and the chat is still stored. Earlier turns are not put into `message()`: the
avatar would answer them as user words. The Persian path is the voice agent.

**Owner decision, 2026-10-02:** the chat context goes to the agent. Browser memory as its source
is our recommendation (question 8).

## Questions for the owner

1. **What does "voice" mean?** **Answered 2026-10-02: V0** (item 2). V1 waits on U9, V2 on counsel.
2. **Transport: T1, the browser posts chat text?** **Answered 2026-10-02: yes** (item 3). One U9
   test (one sandbox conversation, one read by id) would still let T2 check live turns later.
3. **Does a chat record the library answer that led to it?** **Replaced 2026-10-02:** every
   library answer is a chat message with its entry (item 1), named in the consent text (item 6).
4. **The introduction.** **Recommended:** the agent asks the user's need, never the phone, and
   nothing is copied into the profile. Lead = a chat with a session started at the lead card, no
   lead table yet. Say if staff need a lead status (new, contacted) now; that adds one table.
5. **Is opening a chat audited, or only deleting?** **Recommended: opening too.** These are health
   conversations, and an audit row costs one insert.
6. **Retention.** **Recommended:** no timer, admin decides, as ADR 0014 item 1. Set the ElevenLabs
   agent's own `retention_days` too, since our deletion does not reach the provider.
7. **Items 7 and 8** keep ADR 0014 item 3 and the logging ban unchanged. **Recommended: accept as
   written.**
8. **Chat boundary and context source.** **Recommended:** one visit to the conversation screen,
   from the first question until the user leaves or an idle gap passes (item 1), with the context
   from browser memory (item 10). A switch between `/video` and `/audio` leaves the screen today,
   so it ends the chat and the agent loses the earlier turns. Say if a switch must keep the chat.

## Consequences

**What it buys.** The owner knows what each user talked about, library answers included, and which
answer led to a consultation. The live agent knows the earlier turns. Staff learn which questions
users ask, without a draft loop.

**What it costs.**

- Every turn of every signed-in chat is stored with no end date, and each library turn joins a
  person to a health topic, which also reaches ElevenLabs as context. A one-way door.
- A consent step on `mobile` and `web` in `en` and `fa`, before the first question.
- Text, target, origin, and that a library turn happened, are what the browser reports, in its
  own chat only. The server copies library text only for a servable entry.
- Three chat routes with limits, a changed session start body, three tables and one column, a
  chat log in the browser, a save notice, an admin screen, and deletion by user id.
- A dead tab or a dropped network leaves a chat `partial` until a read-back exists.

**What it does not do.** No audio. No matcher (the matcher spike). No context in persona mode. No
lead table or status. No export. No chat history for the user. No widget chats until the
signed-in widget ADR. No model summary.

**The wrong fix this prevents.** A reviewer sees browser-posted text and "fixes" it by sending
chats into the draft queue or the library. Chat text is for the admin to read only. It never
becomes content shown to another user without staff rewording and ADR 0014's review.
