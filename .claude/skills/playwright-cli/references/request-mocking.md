# Request Mocking

Intercept, mock, modify and block network requests.

Two contexts:

- **`playwright-cli`** for exploring by hand. Its `route` and `run-code` take JavaScript,
  because they run in the CLI's driver process.
- **A spec in `apps/frontend/tests/e2e/`**, which uses `page.route` in TypeScript.

## Read this first: the suite already has a fake backend

The e2e suite runs with `VITE_API_MOCK=true`, so `src/data/mock` answers the app's own
endpoints. You do **not** need `page.route` for the normal path. Reach for it only when
the mock cannot give you what the test needs:

- a specific **failure** (500, 429, a malformed body)
- a **slow** response, to see the loading state
- a **dead network**, to see the offline state
- asserting **what the app sent**

The avatar provider is a separate problem. `VITE_API_MOCK` does not fake it, and the fix
is not `page.route` on the provider's API: `tests/e2e/utils/fakeLiveAvatarSdk.ts`
intercepts the SDK module itself. See `references/page-objects.md`.

## In a spec

### Forcing an error path

```ts
test('a failed session request shows the error state with a retry', async ({ page }) => {
  await page.route('**/api/assistant/session', (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'assistant_rate_limited', message: 'too many sessions' },
      }),
    }),
  );

  await page.goto('/audio');

  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});
```

Match the real error body. The orchestrator answers
`{ "error": { code, message, retryable, details }, "correlation_id" }`, and
`toApiError` in `src/shared/api/errors.ts` normalizes it. A stub with a different shape
tests the wrong thing.

### A dead network

```ts
await page.route('**/api/**', (route) => route.abort('internetdisconnected'));
```

Options: `connectionrefused`, `timedout`, `connectionreset`, `internetdisconnected`.

### Reading what the page sent

This is how you assert the app called the right endpoint with the right body:

```ts
const sent: unknown[] = [];

await page.route('**/api/auth/otp/verify', async (route) => {
  sent.push(route.request().postDataJSON());
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: { id: '1', role: 'user' } }),
  });
});

// ...drive the flow...

expect(sent).toHaveLength(1);
expect(sent[0]).toMatchObject({ phone: '+989351234567' });
```

### Seeing the loading state

```ts
await page.route('**/api/me', async (route) => {
  await new Promise((r) => setTimeout(r, 3000));
  await route.continue();
});
```

`route.continue()` lets the real (mock) response through after the delay, so you get the
loading state without having to invent a body.

### Keep the stub honest

A stub that carries fields the real server no longer sends lets the page pass a test
against data that does not exist. When you stub an endpoint, copy the shape from the
entity's Zod schema or from `tests/utils/server.ts`, whose `fixtures` mirror
`apps/api/services/orchestrator/src/schemas.py`.

## From the CLI

```bash
playwright-cli route "**/*.jpg" --status=404
playwright-cli route "**/api/me" --status=401 --content-type=application/json
playwright-cli route "**/api/data" --body='{"ok":true}' --header="X-Custom: value"
playwright-cli route "**/*" --remove-header=cookie,authorization
playwright-cli route-list
playwright-cli unroute "**/*.jpg"
playwright-cli unroute
```

### URL patterns

```
**/api/me              Exact path match
**/api/*/details       Wildcard in path
**/*.{png,jpg,jpeg}    Match file extensions
**/search?q=*          Match query parameters
```

### Advanced, via run-code (JavaScript)

Conditional response based on the request body:

```bash
playwright-cli run-code "async page => {
  await page.route('**/api/auth/otp/verify', route => {
    const body = route.request().postDataJSON();
    if (body.code === '123456') {
      route.fulfill({ body: JSON.stringify({ user: { id: '1', role: 'user' } }) });
    } else {
      route.fulfill({ status: 400, body: JSON.stringify({ error: { code: 'invalid_code' } }) });
    }
  });
}"
```

Modify a real response:

```bash
playwright-cli run-code "async page => {
  await page.route('**/api/me', async route => {
    const response = await route.fetch();
    const json = await response.json();
    json.role = 'admin';
    await route.fulfill({ response, json });
  });
}"
```

Simulate a network failure:

```bash
playwright-cli run-code "async page => {
  await page.route('**/api/**', route => route.abort('internetdisconnected'));
}"
```

Options: `connectionrefused`, `timedout`, `connectionreset`, `internetdisconnected`.

Delay a response, to see the loading state:

```bash
playwright-cli run-code "async page => {
  await page.route('**/api/**', async route => {
    await new Promise(r => setTimeout(r, 3000));
    await route.continue();
  });
}"
```

A slow response is worth exercising by hand. `LoadingState` is a real part of every async
screen, and a screen that only looks right once the data has arrived is not finished.
