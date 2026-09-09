import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { initI18n } from '@/i18n';
import { server } from './utils/server';

beforeAll(async () => {
  await initI18n('en');
  // `bypass`, not `error`: the starter's own tests use src/data/mock, not msw.
  server.listen({ onUnhandledRequest: 'bypass' });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear();
});

afterAll(() => server.close());

// jsdom lacks these browser APIs used by the avatar providers and components.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:mock';
  URL.revokeObjectURL = () => {};
}
