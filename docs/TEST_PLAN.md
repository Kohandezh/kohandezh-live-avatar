# Test plan: Dr. Kohandezh Assistant

Manual and automated checks for the four targets before a release. Run the automated checks
first, then walk the manual cases for every target you ship. Record every failure in Linear with
the case id, the target, the environment, the steps, and a screenshot.

## 1. Environments

| Environment | What it proves | How to start |
| --- | --- | --- |
| **Mock** (no backend) | Screens, states, navigation, RTL, layout | `pnpm dev:<target>` with `VITE_API_MOCK=true`, or the `*-mock` entries in `.claude/launch.json` |
| **Real** (Docker backend, LiveAvatar sandbox) | Login by SMS, real conversation, provider errors, admin data | `docker compose up -d` then open <http://localhost:8088>, or run a dev server with `VITE_API_BASE_URL=http://localhost:8088` |
| **Native** (Capacitor) | Safe areas, secure token storage, microphone permission on a phone | `pnpm build:mobile && pnpm cap:sync && pnpm cap:android` (or `cap:ios`) |

Dev server ports: mobile 5173, web 5174, admin 5175, widget 5176. `.env.development.local` may
point at the real backend; the `*-mock` launch entries override it.

Real mode needs in `.env`: `LIVEAVATAR_API_KEY`, `LIVEAVATAR_VOICE_AGENT_ID` (Persian) and/or
`LIVEAVATAR_CONTEXT_ID` (English), `LIVEAVATAR_SANDBOX=true`, `ASSISTANT_EMBED_KEY` and
`ASSISTANT_EMBED_ALLOWED_ORIGINS` for the widget, `ADMIN_PHONES` for admin accounts. With
`OTP_DELIVERY=console` the code is printed in the backend log and shown in the app; with
`OTP_DELIVERY=asanak` every login sends a real SMS, so log in sparingly.

## 2. Test accounts

| Account | Mock | Real |
| --- | --- | --- |
| Normal user | phone `09351234567`, code `123456` | any phone, code from the backend log or SMS |
| Admin | phone `09121234567`, code `123456` | a phone listed in `ADMIN_PHONES` |
| Any other phone | creates a normal user, code `123456` | creates a normal user |

Sandbox facts that shape the expected results: every conversation ends after about 60 seconds,
the avatar is the public sandbox avatar (not the doctor's), Persian answers come from the voice
agent, English from the persona.

## 3. Automated checks (run first)

```bash
pnpm lint
pnpm build
pnpm test
pnpm test:e2e
docker compose run --rm orchestrator pytest -q
```

All must pass. `pnpm test:e2e` starts the four dev servers on their ports with the mock API; free
the ports first.

### Does an SMS really arrive?

`docker compose run --rm orchestrator pytest -q` never sends one. Every Asanak test answers the
HTTP call with a fake, so a green suite says nothing about whether a phone rings. Check that by
hand before a release or a demo:

```bash
docker compose run --rm \
  -e REAL_PROVIDER_TESTS=true -e CONFIRM_CREDIT_USAGE=YES \
  orchestrator pytest apps/api/services/orchestrator/tests/integration/provider/test_real_asanak.py -s
```

It spends one real SMS on the number in `OTP_TEST_PHONE`, then prints the code it sent. Compare
that with the message on the phone. Asanak accepting the request is not proof of delivery; the
phone is.

The test names the reason when it fails, because a blocked address and a wrong password look the
same from the login screen otherwise:

| Report says | What to do |
| --- | --- |
| blocked the address of this machine | Asanak answers Iranian addresses only. Run it from an allowed network, or ask Asanak support to allow the address. |
| Asanak status 1008 | The web service username or password is wrong. It is not the panel login. |
| Asanak status 1006 | The account is out of credit. Top it up in the panel. |
| Asanak status 1010 | Asanak rejected the destination number. |
| No answer came back at all | The request never got through. Check that the host can reach `sms.asanak.ir` on port 443. |

A pass only proves the SMS path. Real login also needs `OTP_DELIVERY=asanak` in `.env`, which is
`console` by default so local development never spends credit.

## 4. Web PWA (port 5174)

| Id | Case | Steps | Expected |
| --- | --- | --- | --- |
| W1 | Landing for visitors | Open `/` signed out | Product name in the header, hero "Talk to Dr. Kohandezh, any time.", one primary "Start a conversation", "I already have an account", three "How it works" steps, footer "© year Dr. Kohandezh". No nav links. |
| W2 | Persian and RTL | Switch the language to فارسی | `<html dir="rtl" lang="fa">`, every string Persian, Vazirmatn font, layout mirrored, no clipped text. Reload keeps the language. |
| W3 | Login, happy path | Start a conversation, enter a phone, send, enter the code, verify | Lands on `/assistant`. Header shows Conversation, Profile, Log out. |
| W4 | Login, errors | Empty or short phone; wrong code; press Resend at once; Change number | Field error under the input; "That code is wrong."; Resend disabled with a countdown; Change number returns to step 1 and clears the code. Input is kept. |
| W5 | Signed-in root | Signed in, open `/` | Redirects to `/assistant` without showing the landing. |
| W6 | Conversation idle | Open `/assistant` | Title "Conversation with Dr. Kohandezh", dark stage with "Not started", one primary Start, Voice/Video switch, empty transcript. |
| W7 | Conversation live (real) | Press Start, allow the microphone, say something | Status Requesting, Connecting, Live; video plays; your words and the answer appear as bubbles ("You", "Dr. Kohandezh"); countdown chip turns to warning at 15 s; ends with "Trial conversations end after about one minute." |
| W8 | Controls (real) | While live: mute, unmute, interrupt, end | Four identical glass circles, one per corner, no words on any of them: End top left, type top right, interrupt bottom left, microphone bottom right. The microphone glyph gains a slash and the avatar stops hearing you; Interrupt stops the answer; End shows "You ended the conversation" and Start again. |
| W9 | Voice mode | Switch to Voice before and during a conversation | Video hides, sound continues, ring shows speaking/listening state, switching back does not reconnect. |
| W10 | Microphone denied (real) | Block the microphone in the browser, press Start | "The microphone is blocked..." error with Retry. No spinner stuck. |
| W11 | Provider down (real) | Stop the backend or use a wrong provider key, press Start | Clear error state with Retry; no raw error text or status code. |
| W12 | Account page | Open `/profile` | Avatar initials, name, phone (LTR), email, role chip, member since, Settings with the language select, Log out. |
| W13 | Logout | Press Log out | Back to the landing, nav links gone, `/assistant` redirects to `/login`. |
| W14 | Expired session | Delete the `kd_session` cookie, then open `/profile` | Redirect to `/login`; after login you return to `/profile`. |
| W15 | Admin link | Sign in as admin | Header shows "Avatar console" (`/avatar`); a normal user never sees it but can still open the URL. |
| W16 | Offline | DevTools, Network, Offline | Offline banner at the top; login and Start disabled with an offline message; comes back when online. |
| W17 | Not found | Open `/nothing` | "Page not found" with a button back to home. |
| W18 | PWA | Production build (`pnpm build:web`, `pnpm preview:web`), install the app, publish a new build | Installs with the Kohandezh icon and name; the update prompt offers Reload; offline shell loads. |
| W19 | Responsive | 360 px, 768 px, 1280 px | No horizontal scroll, header wraps cleanly, 44 px touch targets. |

## 5. Mobile app (port 5173, then the native shell)

| Id | Case | Steps | Expected |
| --- | --- | --- | --- |
| M1 | Landing | Open `/` signed out | Header "Kohandezh" with the language select, landing content, **no tab bar**. |
| M2 | Login | Start a conversation, log in | Lands on Conversation; tab bar with Conversation and Profile appears; active tab is accent colored. |
| M3 | Conversation | Same as W6 to W11 | Same results; the stage is 3:4 on a phone. |
| M4 | Account | Profile tab | Same as W12; language change from Settings flips the whole app to RTL. |
| M5 | Logout | Log out | Landing again, tab bar hidden. |
| M6 | Persian | Switch to فارسی | Tab labels Persian, header RTL, no clipped labels. |
| M7 | Native: safe areas | Run on a notched device | Header and tab bar clear the notch and the home indicator. |
| M8 | Native: token | Log in, kill the app, reopen | Still signed in (token in secure storage). Log out, reopen: signed out. |
| M9 | Native: microphone | First Start | OS permission prompt; denial gives the W10 error; allow gives a live conversation. |
| M10 | Native: background | Put the app in the background during a conversation, return | Conversation ends or resumes cleanly; no frozen UI. |

## 6. Admin console (port 5175)

| Id | Case | Steps | Expected |
| --- | --- | --- | --- |
| A1 | Anonymous | Open `/` signed out | Redirect to `/login`. |
| A2 | Normal user | Log in as a normal user | `/forbidden` with "No access" and "Log in with another account", which logs out and returns to login. |
| A3 | Dashboard | Log in as admin | Sidebar with the product name and "Admin", Dashboard active, four stat cards with numbers, "Manage users". |
| A4 | Dashboard error | Stop the backend, reload | Error state with Retry; Retry recovers after the backend is back. |
| A5 | Users table | Open Users | Search field, table with name, phone, email, role, status, created; chips for role and status; footer "Page 1 of N". |
| A6 | Search | Type a name, then nonsense | Results filter after a short pause; nonsense shows "No users found". Clear button empties the field. |
| A7 | Pagination | Next, Previous, a page number | Page changes, summary updates, buttons disable at the ends, table dims while loading. |
| A8 | Phone width | 375 px | Menu button opens and closes the nav; table scrolls inside its card, page does not scroll sideways. |
| A9 | Persian | Switch to فارسی | Sidebar on the right, table right-to-left, phone and email stay LTR. |
| A10 | Logout | Log out | Back to `/login`; `/users` redirects to login. |

## 7. Website widget (port 5176 demo page, then a real customer page)

| Id | Case | Steps | Expected |
| --- | --- | --- | --- |
| G1 | Launcher | Open the demo page | Round accent button in the bottom corner; the host page layout is unchanged. |
| G2 | Open with the mouse | Click the launcher, then click Start | Panel opens; Start reacts (status changes). Repeat with touch emulation. |
| G3 | Language | Press English, then فارسی | Panel text and direction switch; the dialog name matches. |
| G4 | Close | Escape, then the close button | Panel closes both ways, focus returns to the launcher, a running conversation ends. |
| G5 | Phone | 375 px | Panel is a full-screen sheet with its own close button; launcher hidden while open. |
| G6 | Conversation (real) | Set `data-api-base` and `data-embed-key`, open from an allowed origin | Same as W7 to W9. |
| G7 | Wrong key or origin (real) | Wrong `data-embed-key`; page served from an origin not in the allowlist | Error state with Retry; no session starts. |
| G8 | Rate limit (real) | Start more conversations than `ASSISTANT_RATE_LIMIT_PER_HOUR` | "Too many conversations..." message with retry timing. |
| G9 | Style isolation | Host page with aggressive global CSS (`* { color: red; font-size: 30px }`) | Widget unaffected; nothing of the widget leaks into the page. |
| G10 | Script API | `window.KohandezhAssistant.init()` twice; `open()`, `close()`, `destroy()` | Second init logs a warning and does nothing; the calls work; destroy removes the host element. |

## 8. Cross-cutting

| Id | Case | Steps | Expected |
| --- | --- | --- | --- |
| X1 | Keyboard | Tab through every screen | Visible focus ring, logical order, Enter/Space activate, Escape closes the widget. |
| X2 | Screen reader | VoiceOver on the conversation screen | Status chip changes announced, transcript live region reads the last answer once. |
| X3 | Slow network | DevTools, Slow 3G | Loading states appear, buttons show a spinner and are disabled while pending, nothing double-submits. |
| X4 | Disabled account (real) | Disable a user in the database, then use the app | 403 "This account is disabled." on login; an existing session is signed out. |
| X5 | Text length | Persian and English on every screen | No truncated labels, no overlapping chips, headings wrap. |
| X6 | Reduced motion | OS "reduce motion" on | No pulsing icons or animated transitions. |

## 9. Exit criteria

- All automated checks green.
- Every case in sections 4 to 8 passed on the targets being released; cases marked (real) passed
  against the real backend at least once.
- No open Linear issue of priority High or Urgent for the release.

## 10. Known limits (not bugs)

- Sandbox conversations end after about one minute and show the public sandbox avatar.
- English persona conversations cannot run in Persian; Persian always uses the voice agent.
- The widget uses the host system font (no Vazirmatn inside its Shadow DOM).
- No dark theme yet.
