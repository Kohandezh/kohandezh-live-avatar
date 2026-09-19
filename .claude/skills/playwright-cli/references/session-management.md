# Browser Session Management

Run several isolated browsers at once, each with its own cookies and storage. This is a
`playwright-cli` feature for exploring by hand. In a spec the equivalent is
`await browser.newContext()`, and `@playwright/test` already gives each test its own.

## Named sessions

```bash
playwright-cli -s=visitor open http://localhost:5273
playwright-cli -s=admin   open http://localhost:5275/login

playwright-cli -s=visitor fill "getByLabel('Phone number')" "09351234567"
playwright-cli -s=admin   snapshot
```

Each session has independent cookies, localStorage, sessionStorage, IndexedDB, cache,
history and tabs.

## Why this matters here

Three uses that come up constantly in this repo:

**1. The kiosk threat model.** One session is the previous visitor, another is the next
one. Confirm that nothing from the first reaches the second.

```bash
playwright-cli -s=first open http://localhost:5273
playwright-cli -s=first fill "#user-input" "شماره من ۰۹۱۲..."
playwright-cli -s=first click "#send-btn"

playwright-cli -s=second open http://localhost:5273
playwright-cli -s=second --raw eval "document.body.innerText"   # must not contain it
```

**2. Visitor and admin at the same time.** Change a branding colour or a dataset entry in
the admin session, reload the visitor session, see the effect. That is the real loop for
white-label work.

**3. The leads module's three doors.** `/v/{code}` (field visitor), `/edit/{token}`
(company contact), and the admin queue each have their own credential and no shared
session. Open one per browser session and check that none of them can reach another's
page.

## Session commands

```bash
playwright-cli list                       # all sessions
playwright-cli close                      # close the default browser
playwright-cli -s=visitor close           # close a named browser
playwright-cli close-all
playwright-cli kill-all                   # force-kill stale daemons
playwright-cli delete-data                # delete the default profile directory
playwright-cli -s=visitor delete-data
```

Set a default session name for a whole shell:

```bash
export PLAYWRIGHT_CLI_SESSION="visitor"
playwright-cli open http://localhost:5273
```

## Persistent profiles

By default a profile lives in memory only. `--persistent` writes it to disk.

```bash
playwright-cli open http://localhost:5273 --persistent
playwright-cli open http://localhost:5273 --profile=/tmp/kohandezh-profile
```

In-memory is the safer default for anything touching an admin session.

## Session configuration

```bash
playwright-cli open http://localhost:5273 --browser=firefox
playwright-cli open http://localhost:5273 --headed
playwright-cli open http://localhost:5273 --config=.playwright/my-cli.json
```

The tests use Chromium. Check another engine only when chasing a browser-specific bug.

## Attaching to a running browser

Connect to a browser that is already open instead of launching one.

By channel. The browser needs remote debugging on: open `chrome://inspect/#remote-debugging`
there and tick "Allow remote debugging for this browser instance".

```bash
playwright-cli attach --cdp=chrome
playwright-cli attach --cdp=chrome-canary
playwright-cli attach --cdp=msedge
```

Supported channels: `chrome`, `chrome-beta`, `chrome-dev`, `chrome-canary`, `msedge`,
`msedge-beta`, `msedge-dev`, `msedge-canary`.

With no `--session`, the session is named after the channel, so parallel attaches do not
collide on `default`. Pass `--session=<name>` to override.

By CDP endpoint:

```bash
playwright-cli attach --cdp=http://localhost:9222
```

Via the browser extension:

```bash
playwright-cli attach --extension
```

Detach without closing the external browser:

```bash
playwright-cli detach
playwright-cli -s=msedge detach
```

`detach` works only on sessions made with `attach`. For sessions made with `open`, use
`close`.

## Practice

Name sessions after the role they play, so a half-finished investigation still reads:

```bash
# good
playwright-cli -s=visitor open http://localhost:5273
playwright-cli -s=admin open http://localhost:5275
playwright-cli -s=next-visitor open http://localhost:5273

# avoid
playwright-cli -s=s1 open http://localhost:5273
```

Close what you opened. `close-all` when finished, `kill-all` if a daemon goes stale.

## The equivalent in a spec

`@playwright/test` gives every test a fresh context already, so you rarely need this. When
one test genuinely needs two parties:

```ts
test('a second browser does not inherit the first one\'s session', async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  // ...
  await first.close();
  await second.close();
});
```

Two contexts from one browser is cheaper than two browsers and gives the same isolation.
Close them, or the run leaks them.
