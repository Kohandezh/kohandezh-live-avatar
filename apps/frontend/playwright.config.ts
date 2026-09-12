import { defineConfig, devices } from '@playwright/test';

/**
 * E2E gets its OWN ports, deliberately NOT the `devPorts` in vite.config.ts.
 *
 * The dev ports belong to whoever ran `pnpm dev`, and their servers usually
 * run against the real backend (`.env.development.local` sets
 * `VITE_API_MOCK=false`). With `reuseExistingServer` on, Playwright would
 * happily attach to one of those instead of starting its own, and every
 * login test would then wait forever for an SMS code that the mock was
 * supposed to provide. The suite would fail, or worse pass, for reasons
 * that have nothing to do with the code under test.
 *
 * Separate ports mean the two never meet: e2e always talks to a server it
 * started itself, with the mock on, whether or not `pnpm dev` is running.
 */
const ports = {
  mobile: 5273,
  web: 5274,
  admin: 5275,
  widget: 5276,
} as const;

const isCI = Boolean(process.env.CI);

// E2E tests run against the dev servers with the mock API enabled,
// so they do not need a backend.
const mockEnv = { VITE_API_MOCK: 'true' };

/**
 * `--port` on the vite CLI overrides `server.port` from vite.config.ts.
 * `strictPort` is on there, so a clash fails loudly instead of silently
 * sliding to another port and leaving the tests pointed at nothing.
 */
function devServer(target: keyof typeof ports) {
  return {
    command: `pnpm --filter @app/frontend exec vite --port ${ports[target]}`,
    url: `http://localhost:${ports[target]}`,
    reuseExistingServer: !isCI,
    env: { ...mockEnv, APP_TARGET: target },
  };
}

/**
 * Requirement 10 needs a real `getUserMedia` call to succeed with nobody at
 * the keyboard to click the native permission dialog. `fake-ui` auto-accepts
 * that dialog and `fake-device` gives it a fake mic to grant, so the call
 * resolves instead of hanging the test. Chromium only, which is what both
 * the `mobile` (Pixel 7) and `web` (Desktop Chrome) projects already use.
 */
const fakeMediaArgs = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
];

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? 'github' : 'list',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'web',
      testMatch: /web\..*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${ports.web}`,
        launchOptions: { args: fakeMediaArgs },
      },
    },
    {
      name: 'mobile',
      testMatch: /mobile\..*\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        baseURL: `http://localhost:${ports.mobile}`,
        launchOptions: { args: fakeMediaArgs },
      },
    },
    {
      name: 'admin',
      testMatch: /admin\..*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${ports.admin}`,
      },
    },
    {
      // The widget dev server serves src/app/widget/index.html, a stand-in customer page.
      name: 'widget',
      testMatch: /widget\..*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${ports.widget}`,
      },
    },
  ],
  webServer: [
    devServer('web'),
    devServer('mobile'),
    devServer('admin'),
    devServer('widget'),
  ],
});
