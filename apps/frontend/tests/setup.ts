import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
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
// `input-otp` (the engine under HeroUI's InputOTP) observes its own root in a
// mount effect, and `AssistantSphere` observes its canvas wrapper. jsdom has no
// ResizeObserver, so without this stub both throw on mount.
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
// `input-otp` probes `document.elementFromPoint` to detect a password manager
// badge sitting over the slots. jsdom does not implement it and returns
// undefined, which the library then calls `.closest()` on.
if (!document.elementFromPoint) {
  document.elementFromPoint = () => null;
}

// The onboarding microphone step (requirement 10) and `shared/platform/microphone.ts`
// both call `navigator.mediaDevices.getUserMedia`. jsdom has no media devices at all, so
// every test gets a working default here: it resolves one fake audio track whose `stop()`
// is a spy, so a test can assert the permission flow releases the microphone instead of
// leaving the OS recording indicator lit. Reassigned fresh in `beforeEach` because
// `restoreMocks` (vitest.config.ts) wipes a plain `vi.fn()` back to an empty stub after
// each test, not back to this implementation.
//
// A test that needs a denied or unavailable microphone overrides this for one call with
// `vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(...)`.
beforeEach(() => {
  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {},
      configurable: true,
      writable: true,
    });
  }

  navigator.mediaDevices.getUserMedia = vi.fn(async () => {
    const track = {
      stop: vi.fn(),
      kind: 'audio',
      enabled: true,
    } as unknown as MediaStreamTrack;

    return {
      getTracks: () => [track],
      getAudioTracks: () => [track],
      getVideoTracks: () => [],
    } as unknown as MediaStream;
  });
});
