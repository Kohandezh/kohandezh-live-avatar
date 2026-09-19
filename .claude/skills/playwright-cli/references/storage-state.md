# Storage: Cookies and localStorage

This app keeps state in both. What lives where is a security decision, not a convenience
one, so most of what you check here is whether something is in the right half.

## What this app stores

### Cookies (set by the server)

| Cookie | What it carries |
|---|---|
| `kd_session` | The session. HttpOnly, `SameSite=Lax`, `Path=/`, `Secure` outside development. JavaScript never sees it |

That is the whole list. The token is opaque and carries no claims; the server resolves it
against Redis. Native clients send the same token as `Authorization: Bearer` instead and
have no cookie at all.

### localStorage (written by the page)

| Key | What it carries |
|---|---|
| `settings` | One JSON object: `language`, `theme`, `reduceTransparency`, `micPermissionAsked` |

Written by `persistSettings` in `src/features/settings/settingsSlice.ts` and read by
`loadInitialSettings`. The anti-FOUC script in each `index.html` reads it directly, before
any bundle has run.

**No token ever goes in `localStorage` on web.** That is rule 6 in `docs/SECURITY.md`.
Native tokens go to OS-backed secure storage through `src/shared/storage/tokenStore.ts`.
A change that puts a token in `localStorage` is a Critical review finding.

The per-conversation assistant session token lives in memory only. Not in `localStorage`,
not in Redux, not in a URL, not in a log.

## Checking the settings boot path by hand

The anti-FOUC script runs before first paint, so the only way to test it is to write the
value *before* the page loads:

```bash
playwright-cli open http://localhost:5273
playwright-cli localstorage-set settings '{"theme":"dark","language":"fa"}'
playwright-cli reload
playwright-cli --raw eval "document.documentElement.dataset.theme"    # expect: dark
playwright-cli --raw eval "document.documentElement.dir"              # expect: rtl
```

Reload matters. Setting the key on an already-painted page proves nothing about the boot
script.

## Cookies

```bash
playwright-cli cookie-list
playwright-cli cookie-list --domain=localhost
playwright-cli cookie-list --path=/api
playwright-cli cookie-get kd_session
playwright-cli cookie-set kd_session abc123
playwright-cli cookie-set kd_session abc123 --domain=localhost --path=/ --httpOnly --sameSite=Lax
playwright-cli cookie-set remember token123 --expires=1735689600
playwright-cli cookie-delete kd_session
playwright-cli cookie-clear
```

Several cookies at once, via `run-code` (JavaScript):

```bash
playwright-cli run-code "async page => {
  await page.context().addCookies([
    { name: 'kd_session', value: 'c1', domain: 'localhost', path: '/', httpOnly: true }
  ]);
}"
```

Note that under `VITE_API_MOCK=true` there is no server to set a real cookie. The mock
signs a visitor in without a credential check, which is exactly why rule 11 in
`docs/SECURITY.md` forbids it outside development.

## localStorage

```bash
playwright-cli localstorage-list
playwright-cli localstorage-get settings
playwright-cli localstorage-set settings '{"theme":"light"}'
playwright-cli localstorage-delete settings
playwright-cli localstorage-clear
```

## sessionStorage

```bash
playwright-cli sessionstorage-list
playwright-cli sessionstorage-get <key>
playwright-cli sessionstorage-set <key> <value>
playwright-cli sessionstorage-delete <key>
playwright-cli sessionstorage-clear
```

## Storage state files

Save and restore a whole browser state (cookies plus per-origin storage):

```bash
playwright-cli state-save                    # auto filename
playwright-cli state-save admin-auth.json
playwright-cli state-load admin-auth.json
playwright-cli open http://localhost:5275
```

File format:

```json
{
  "cookies": [
    { "name": "kd_session", "value": "abc123", "domain": "localhost",
      "path": "/", "expires": 1735689600, "httpOnly": true,
      "secure": false, "sameSite": "Lax" }
  ],
  "origins": [
    { "origin": "http://localhost:5273",
      "localStorage": [ { "name": "settings", "value": "{\"theme\":\"dark\"}" } ] }
  ]
}
```

## The same things in a spec

Set state before the page loads. This is how you test the anti-FOUC script, which runs on
the first paint and is too late to influence afterwards:

```ts
test('the saved dark theme is applied before the first paint', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('settings', JSON.stringify({ theme: 'dark' }));
  });

  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
```

Read and clear at runtime:

```ts
const saved = await page.evaluate(() => localStorage.getItem('settings'));
await page.evaluate(() => localStorage.clear());

const cookies = await page.context().cookies();
expect(cookies.find((c) => c.name === 'kd_session')).toBeUndefined();
await page.context().clearCookies();
```

Set a cookie:

```ts
await page.context().addCookies([
  { name: 'kd_session', value: 'c1', url: 'http://localhost:5273' },
]);
```

**Each test gets a fresh context by default.** `fullyParallel` is on, so do not defeat
that with `test.describe.serial` plus shared state unless the order genuinely is the
behaviour. A shared context leaks one test's language, theme and onboarding flag into the
next.

`micPermissionAsked` is the one that bites: the onboarding microphone step remembers that
it asked, so a test that depends on being asked must start from clean storage.

## Security notes

- Never commit a storage-state file containing a real session. Delete it when done.
- Never put a real credential in a script, a test, or a saved state file.
- `kd_session` is HttpOnly on purpose. A browser test must not be able to forge a signed-in
  session by writing `localStorage`. Identity comes from `GET /api/me`, which reads the
  cookie the page cannot see. If a change ever makes `localStorage` enough to pass as
  signed in, that is the defect, not the test.
