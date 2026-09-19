import { act, renderHook, waitFor } from '@testing-library/react';
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
import { SessionEvent } from '@tests/utils/liveAvatarSdkMock';

/**
 * Attaching the stream, and what counts as "the browser blocked the sound".
 *
 * A regression test for a real defect. The stream was attached twice, once when
 * `SESSION_STREAM_READY` arrived and once after `start()` resolved. The second attach assigns
 * `srcObject` again, which interrupts the first `play()`; the browser rejects that call with
 * `AbortError`. The hook caught every rejection and reported a blocked autoplay, so a user
 * whose audio was fine was told to tap the circle to hear it.
 */
describe('attaching the avatar stream', () => {
  beforeEach(() => {
    resetLiveAvatarSdkMock();
    mockSession.set('u-user');
    installMockApi(apiClient, { delayMs: 0 });
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => true,
    });
  });

  async function startWithElement(play: () => Promise<void>) {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
    const element = document.createElement('video');
    const { result } = renderHook(() => useAssistantSession());

    act(() => result.current.attachMedia(element));
    await act(async () => {
      await result.current.start();
    });
    return result;
  }

  it('attaches the stream once, however many places ask for it', async () => {
    const result = await startWithElement(() => Promise.resolve());
    const afterStart = sdkState.attachCount;

    // The stream-ready event is the second place that asks, and the one that used to
    // interrupt the play() the first had already begun.
    const session = FakeLiveAvatarSession.instances.at(-1)!;
    act(() => session.emit(SessionEvent.SESSION_STREAM_READY, undefined));
    act(() => session.emit(SessionEvent.SESSION_STREAM_READY, undefined));

    await waitFor(() => expect(result.current.isStreamReady).toBe(true));
    expect(sdkState.attachCount).toBe(afterStart);
  });

  it('does not call an interrupted play a blocked autoplay', async () => {
    const abort = new DOMException('interrupted by a new load request', 'AbortError');
    const result = await startWithElement(() => Promise.reject(abort));

    await waitFor(() => expect(result.current.status).toBe('connected'));
    // The user can do nothing about an AbortError, so they must not be told to tap anything.
    expect(result.current.isAudioBlocked).toBe(false);
  });

  it('still asks the user to tap when the autoplay policy really refuses', async () => {
    const denied = new DOMException('play() failed because the user agent...', 'NotAllowedError');
    const result = await startWithElement(() => Promise.reject(denied));

    await waitFor(() => expect(result.current.isAudioBlocked).toBe(true));
  });

  it('still offers the tap for a rejection it has never seen', async () => {
    // The recovery button is kept for anything that is not the known false alarm. A user who
    // cannot hear the doctor and has nothing to press is the worse failure.
    const odd = new Error('some browser, some day');
    const result = await startWithElement(() => Promise.reject(odd));

    await waitFor(() => expect(result.current.isAudioBlocked).toBe(true));
  });
});
