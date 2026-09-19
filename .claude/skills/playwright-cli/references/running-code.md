# Running Custom Playwright Code from the CLI

`run-code` executes arbitrary Playwright code for scenarios the plain CLI commands do not
cover.

**It takes JavaScript.** The code runs inside `playwright-cli`'s own driver process, so
that is the language of this command, not a sign that the repo uses node. Your tests stay
TypeScript, and so is your spec, so most of what you run here transfers directly to a
test.

## Syntax

```bash
playwright-cli run-code "async page => {
  // Playwright code here. page.context() reaches the browser context.
}"
```

Or from a file:

```bash
playwright-cli run-code --filename=./my-script.js
```

The code must be a single function expression. It is wrapped in `(...)` and evaluated.
`import`, `export` and `require` are not supported.

## Colour scheme, for light/dark work

```bash
playwright-cli run-code "async page => { await page.emulateMedia({ colorScheme: 'light' }); }"
playwright-cli run-code "async page => { await page.emulateMedia({ colorScheme: 'dark' }); }"
playwright-cli run-code "async page => { await page.emulateMedia({ reducedMotion: 'reduce' }); }"
playwright-cli run-code "async page => { await page.emulateMedia({ media: 'print' }); }"
```

This matters here. The chat boot script in `themes/base/partials/index.html` reads
`prefers-color-scheme` when nothing is stored in `localStorage`. See the `dark-mode`
skill.


The context form is the one you usually want, because the boot script runs on first paint
and an emulate call after `goto` is too late.

## Viewport and device

```bash
playwright-cli resize 390 844          # plain CLI command, no run-code needed
```


Check narrow width. The drawer stops being an overlay at 992px and becomes a sidebar
(`static/chat/base.css`), so the layout is genuinely different above and below it.

## Permissions

The chat has a microphone button (`#mic-btn`) that posts to `/api/transcribe`.

```bash
playwright-cli run-code "async page => {
  await page.context().grantPermissions(['microphone']);
}"
```


## Wait strategies

```bash
playwright-cli run-code "async page => { await page.waitForLoadState('networkidle'); }"
playwright-cli run-code "async page => { await page.locator('#loading-bubble').waitFor({ state: 'hidden' }); }"
playwright-cli run-code "async page => { await page.waitForFunction(() => typeof initChat === 'function'); }"
```


Wait on a condition, never on a sleep.

## Page information

```bash
playwright-cli run-code "async page => { return await page.title(); }"
playwright-cli run-code "async page => { return page.url(); }"
playwright-cli run-code "async page => { return await page.content(); }"
playwright-cli run-code "async page => { return page.viewportSize(); }"
```

In a spec: `await page.title()`, `page.url()`, `await page.content()`, `page.viewportSize()`.

## Reading state out of the page

```bash
playwright-cli run-code "async page => {
  return await page.evaluate(() => ({
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    theme: document.documentElement.dataset.theme,
    settings: localStorage.getItem('settings'),
  }));
}"
```

In a spec: the same callback, through `await page.evaluate(...)`.

## Frames and downloads

```bash
playwright-cli run-code "async page => {
  const frame = page.locator('iframe#my-iframe').contentFrame();
  await frame.locator('button').click();
}"

playwright-cli run-code "async page => {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download' }).click();
  const download = await downloadPromise;
  await download.saveAs('./downloaded-file.csv');
  return download.suggestedFilename();
}"
```

Downloads are worth exercising in the admin panel. Several admin screens export CSV or a
database dump.


## Error handling

```bash
playwright-cli run-code "async page => {
  try {
    await page.getByRole('button', { name: 'ارسال' }).click({ timeout: 1000 });
    return 'clicked';
  } catch (e) {
    return 'element not found';
  }
}"
```

## A full flow: log in and save the state

Against the mock backend the seeded account is `09351234567` and the code is always
`123456` (`src/data/mock/users.ts`):

```bash
playwright-cli run-code "async page => {
  await page.goto('http://localhost:5273/login');
  await page.getByLabel('Phone number').fill('09351234567');
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('One-time code').fill('123456');
  await page.waitForURL('**/onboarding');
  await page.context().storageState({ path: 'user-auth.json' });
  return 'ok';
}"
```

A fresh account lands on `/onboarding`, not on the home screen: `RequireProfile` gates the
product screens on a name being on file.

Never put a real credential in a committed file or a saved storage-state file. See
`references/storage-state.md`.
