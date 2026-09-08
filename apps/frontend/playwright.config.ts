import { defineConfig, devices } from '@playwright/test';

// Ports must match `devPorts` in vite.config.ts.
const ports = { mobile: 5173, web: 5174, admin: 5175 } as const;

const isCI = Boolean(process.env.CI);

// E2E tests run against the dev servers with the mock API enabled,
// so they do not need a backend.
const mockEnv = { VITE_API_MOCK: 'true' };

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
      },
    },
    {
      name: 'mobile',
      testMatch: /mobile\..*\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        baseURL: `http://localhost:${ports.mobile}`,
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
  ],
  webServer: [
    {
      command: 'pnpm run dev:web',
      url: `http://localhost:${ports.web}`,
      reuseExistingServer: !isCI,
      env: mockEnv,
    },
    {
      command: 'pnpm run dev:mobile',
      url: `http://localhost:${ports.mobile}`,
      reuseExistingServer: !isCI,
      env: mockEnv,
    },
    {
      command: 'pnpm run dev:admin',
      url: `http://localhost:${ports.admin}`,
      reuseExistingServer: !isCI,
      env: mockEnv,
    },
  ],
});
