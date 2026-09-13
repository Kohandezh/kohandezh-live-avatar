import { act, renderHook, waitFor } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@heygen/liveavatar-web-sdk', async () => {
  const mock = await import('@tests/utils/liveAvatarSdkMock');
  return mock.createLiveAvatarSdkMockModule();
});

import { installMockApi, mockSession } from '@/data/mock';
import { useAssistantSession } from '@/features/assistant';
import { apiClient } from '@/shared/api';
import {
  FakeLiveAvatarSession,
  resetLiveAvatarSdkMock,
  sdkState,
} from '@tests/utils/liveAvatarSdkMock';

/**
 * Cancelling a start that is still in flight.
 *
 * `start()` is a chain of awaits: the backend POST, the SDK import, then `session.start()`.
 * A conversation costs money, so a start nobody is waiting for any more must not connect, and
 * every backend row that was opened must be closed. Both tests below hold the backend POST
 * open on purpose, because that is the window where the user sees "preparing" and reaches for
 * End.
 *
 * These are regression tests for two real defects, in the order they were found:
 *
 * 1. `stop()` used to return early while both refs were null, and the reducer used to drop
 *    `ending` and `ended` because `requesting` was not a live status. Pressing End on the
 *    preparing screen did nothing at all, and the start carried on and connected.
 * 2. The first fix used a boolean cancel flag. `start()` reset it to false, so pressing End
 *    and then Restart un-cancelled the first start: it woke up believing it was still wanted
 *    and connected a SECOND paid session that nothing would ever close. The flag is now a
 *    generation counter, which is what the second test holds in place.
 */
describe('cancelling a start that is still in flight', () => {
  beforeEach(() => {
    resetLiveAvatarSdkMock();
    mockSession.set('u-user');
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => true,
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  /**
   * Holds the first session-create POST open until the returned function is called, so the
   * hook can be driven while it is parked mid-start.
   */
  function holdFirstCreate() {
    installMockApi(apiClient, { delayMs: 0 });
    const inner = apiClient.defaults.adapter as AxiosAdapter;

    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let creates = 0;

    apiClient.defaults.adapter = async (config) => {
      const url = String(config.url);
      const isCreate =
        String(config.method).toLowerCase() === 'post' &&
        !url.includes('close');
      if (isCreate) {
        creates += 1;
        if (creates === 1) await gate;
      }
      return inner(config);
    };

    return { release: () => release() };
  }

  it('ends a start the user cancelled before it connected', async () => {
    const { release } = holdFirstCreate();
    const { result } = renderHook(() => useAssistantSession());

    act(() => {
      void result.current.start();
    });
    await waitFor(() => expect(result.current.status).toBe('requesting'));

    // End, on the "preparing" screen. This used to do nothing at all.
    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.status).toBe('ended');

    // The held POST finally answers. The abandoned start must not carry on.
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    expect(result.current.status).toBe('ended');
    expect(FakeLiveAvatarSession.instances).toHaveLength(0);
    expect(sdkState.startCount).toBe(0);
  });

  it('does not connect a second session when the user restarts before the first start finishes', async () => {
    const { release } = holdFirstCreate();
    const { result } = renderHook(() => useAssistantSession());

    act(() => {
      void result.current.start();
    });
    await waitFor(() => expect(result.current.status).toBe('requesting'));

    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.status).toBe('ended');

    // Restart while the first POST is still in flight. With a boolean flag this reset the
    // cancel and revived the first start.
    act(() => {
      void result.current.start();
    });
    await waitFor(() => expect(result.current.status).toBe('connected'));

    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    // Exactly one live conversation, the one the user is actually in.
    expect(result.current.status).toBe('connected');
    expect(FakeLiveAvatarSession.instances).toHaveLength(1);
    expect(sdkState.startCount).toBe(1);
  });
});
