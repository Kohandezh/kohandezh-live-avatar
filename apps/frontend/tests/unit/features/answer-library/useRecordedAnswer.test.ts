import { act, renderHook, waitFor } from '@testing-library/react';
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibrarySuggestion } from '@/entities/library-entry';
import { libraryEntryKeys } from '@/entities/library-entry';
import { useRecordedAnswer } from '@/features/answer-library';
import { apiClient } from '@/shared/api';
import { providersWrapper } from '../../../utils/renderWithProviders';

const FIRST: LibrarySuggestion = {
  id: 'entry-1',
  question: 'Who is the doctor?',
  answerText: 'The doctor is a hair transplant surgeon.',
  durationMs: 4000,
};
const SECOND: LibrarySuggestion = {
  id: 'entry-2',
  question: 'How many grafts do I need?',
  answerText: 'It depends on the area.',
  durationMs: 4000,
};

/** One pending download per request, so a test decides when and how each one ends. */
interface PendingRequest {
  config: InternalAxiosRequestConfig;
  resolve: (blob: Blob) => void;
  reject: (error: unknown) => void;
}

const realAdapter = apiClient.defaults.adapter;
let requests: PendingRequest[];
let urlCount: number;
let createObjectURL: ReturnType<typeof vi.fn<(blob: Blob) => string>>;
let revokeObjectURL: ReturnType<typeof vi.fn<(url: string) => void>>;

function axiosFailure(
  config: InternalAxiosRequestConfig,
  status: number | null,
  code?: string,
): AxiosError {
  if (status === null) {
    return new AxiosError('Network Error', code ?? AxiosError.ERR_NETWORK, config);
  }
  return new AxiosError('failed', AxiosError.ERR_BAD_REQUEST, config, undefined, {
    data: { error: { code: status === 404 ? 'not_found' : 'x' } },
    status,
    statusText: '',
    headers: {},
    config,
  });
}

function mp4(): Blob {
  return new Blob([new Uint8Array([0, 0, 0, 24])], { type: 'video/mp4' });
}

/** A `<video>` the hook can drive. jsdom has no media playback, so `play` and `pause` are spies. */
function fakeVideo() {
  const element = document.createElement('video');
  const play = vi.fn(() => Promise.resolve());
  const pause = vi.fn();
  element.play = play;
  element.pause = pause;
  element.load = vi.fn();
  return { element, play, pause };
}

/**
 * Waits until `count` downloads have reached the adapter. The shared client runs its request
 * interceptors first (one of them awaits the token store), so a request is never there at once.
 */
async function requestCount(count: number) {
  await waitFor(() => expect(requests).toHaveLength(count));
  return requests[count - 1] as PendingRequest;
}

function renderRecordedAnswer() {
  const { Wrapper, queryClient } = providersWrapper();
  const hook = renderHook(() => useRecordedAnswer('en'), { wrapper: Wrapper });
  const video = fakeVideo();
  hook.result.current.mediaRef(video.element);
  return { ...hook, video, queryClient };
}

beforeEach(() => {
  requests = [];
  urlCount = 0;
  createObjectURL = vi.fn(() => {
    urlCount += 1;
    return `blob:answer-${urlCount}`;
  });
  revokeObjectURL = vi.fn();
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  const adapter: AxiosAdapter = (config) =>
    new Promise((resolve, reject) => {
      config.signal?.addEventListener?.('abort', () =>
        reject(new AxiosError('canceled', AxiosError.ERR_CANCELED, config)),
      );
      requests.push({
        config,
        resolve: (blob) =>
          resolve({ data: blob, status: 200, statusText: 'OK', headers: {}, config }),
        reject,
      });
    });
  apiClient.defaults.adapter = adapter;
});

afterEach(() => {
  apiClient.defaults.adapter = realAdapter;
});

describe('useRecordedAnswer (REQ-054)', () => {
  it('downloads the tapped answer as a blob, then plays it from an object URL', async () => {
    const { result, video } = renderRecordedAnswer();

    act(() => result.current.play(FIRST));

    expect(result.current.phase).toBe('loading');
    expect(result.current.entry).toEqual(FIRST);
    await requestCount(1);
    expect(requests[0]?.config.url).toBe('/api/library/answers/entry-1/video');
    expect(requests[0]?.config.responseType).toBe('blob');

    const first = await requestCount(1);
    await act(async () => first.resolve(mp4()));

    await waitFor(() => expect(result.current.phase).toBe('playing'));
    expect(video.element.getAttribute('src')).toBe('blob:answer-1');
    expect(video.play).toHaveBeenCalledTimes(1);
  });

  it('ignores a second tap on the question that is already loading or playing', async () => {
    const { result } = renderRecordedAnswer();

    act(() => result.current.play(FIRST));
    act(() => result.current.play(FIRST));
    await requestCount(1);

    const first = await requestCount(1);
    await act(async () => first.resolve(mp4()));
    await waitFor(() => expect(result.current.phase).toBe('playing'));
    act(() => result.current.play(FIRST));
    await act(async () => {});

    expect(requests).toHaveLength(1);
    expect(result.current.phase).toBe('playing');
  });

  it('a tap on another question aborts the running download and plays the new one', async () => {
    const { result, video } = renderRecordedAnswer();

    act(() => result.current.play(FIRST));
    const firstSignal = (await requestCount(1)).config.signal as AbortSignal;
    act(() => result.current.play(SECOND));

    expect(firstSignal.aborted).toBe(true);
    expect(result.current.entry).toEqual(SECOND);
    expect(result.current.phase).toBe('loading');

    const second = await requestCount(2);
    await act(async () => second.resolve(mp4()));
    await waitFor(() => expect(result.current.phase).toBe('playing'));
    expect(video.element.getAttribute('src')).toBe('blob:answer-1');
  });

  it('a new tap during playback revokes the old object URL before the next download', async () => {
    const { result } = renderRecordedAnswer();
    act(() => result.current.play(FIRST));
    const first = await requestCount(1);
    await act(async () => first.resolve(mp4()));
    await waitFor(() => expect(result.current.phase).toBe('playing'));

    act(() => result.current.play(SECOND));

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:answer-1');
    expect(result.current.phase).toBe('loading');
  });

  it('Stop pauses, revokes the URL and finishes, keeping the played entry (REQ-061, SC-016)', async () => {
    const { result, video } = renderRecordedAnswer();
    act(() => result.current.play(FIRST));
    const first = await requestCount(1);
    await act(async () => first.resolve(mp4()));
    await waitFor(() => expect(result.current.phase).toBe('playing'));

    act(() => result.current.stop());

    expect(video.pause).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:answer-1');
    expect(video.element.hasAttribute('src')).toBe(false);
    expect(result.current.phase).toBe('finished');
    expect(result.current.entry).toEqual(FIRST);
  });

  it('Stop during the download aborts it and finishes', async () => {
    const { result } = renderRecordedAnswer();
    act(() => result.current.play(FIRST));
    const signal = (await requestCount(1)).config.signal as AbortSignal;

    act(() => result.current.stop());

    expect(signal.aborted).toBe(true);
    expect(result.current.phase).toBe('finished');
  });

  it('the end of the answer revokes the URL and finishes (SC-016)', async () => {
    const { result } = renderRecordedAnswer();
    act(() => result.current.play(FIRST));
    const first = await requestCount(1);
    await act(async () => first.resolve(mp4()));
    await waitFor(() => expect(result.current.phase).toBe('playing'));

    act(() => result.current.handleEnded());

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:answer-1');
    expect(result.current.phase).toBe('finished');
  });

  it('unmount stops playback and revokes the URL (REQ-063, SC-016)', async () => {
    const { result, unmount, video } = renderRecordedAnswer();
    act(() => result.current.play(FIRST));
    const first = await requestCount(1);
    await act(async () => first.resolve(mp4()));
    await waitFor(() => expect(result.current.phase).toBe('playing'));

    unmount();

    expect(video.pause).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:answer-1');
  });

  it('unmount during the download aborts it', async () => {
    const { result, unmount } = renderRecordedAnswer();
    act(() => result.current.play(FIRST));
    const signal = (await requestCount(1)).config.signal as AbortSignal;

    unmount();

    expect(signal.aborted).toBe(true);
  });

  it('cancel stops and revokes synchronously and returns to idle, for a live start (REQ-060, SC-015)', async () => {
    const { result, video } = renderRecordedAnswer();
    act(() => result.current.play(FIRST));
    const first = await requestCount(1);
    await act(async () => first.resolve(mp4()));
    await waitFor(() => expect(result.current.phase).toBe('playing'));

    act(() => result.current.cancel());

    expect(video.pause).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:answer-1');
    expect(result.current.phase).toBe('idle');
    expect(result.current.entry).toBeNull();
  });

  it('a refused play() becomes `blocked`, and resume plays it (REQ-059)', async () => {
    const { result, video } = renderRecordedAnswer();
    video.play.mockImplementationOnce(() =>
      Promise.reject(new DOMException('no gesture', 'NotAllowedError')),
    );
    act(() => result.current.play(FIRST));
    const first = await requestCount(1);
    await act(async () => first.resolve(mp4()));

    await waitFor(() => expect(result.current.phase).toBe('blocked'));

    await act(async () => result.current.resume());

    expect(result.current.phase).toBe('playing');
    expect(video.play).toHaveBeenCalledTimes(2);
  });

  it('a 404 is `notFound` and invalidates the suggestions (REQ-062, SC-017)', async () => {
    const { result, queryClient } = renderRecordedAnswer();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    act(() => result.current.play(FIRST));

    const request = await requestCount(1);
    await act(async () => request.reject(axiosFailure(request.config, 404)));

    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.errorKind).toBe('notFound');
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: libraryEntryKeys.suggestions('en'),
    });
  });

  it.each([
    ['a 429', 'rateLimited', 429, undefined],
    ['a 500', 'generic', 500, undefined],
    ['a failure with no response', 'offline', null, undefined],
    ['a timeout', 'generic', null, 'ECONNABORTED'],
  ] as const)('%s shows the `%s` line', async (_name, kind, status, code) => {
    const { result } = renderRecordedAnswer();
    act(() => result.current.play(FIRST));

    const request = await requestCount(1);
    await act(async () =>
      request.reject(axiosFailure(request.config, status, code)),
    );

    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.errorKind).toBe(kind);
  });

  it('a media error while playing is `generic` and revokes the URL', async () => {
    const { result } = renderRecordedAnswer();
    act(() => result.current.play(FIRST));
    const first = await requestCount(1);
    await act(async () => first.resolve(mp4()));
    await waitFor(() => expect(result.current.phase).toBe('playing'));

    act(() => result.current.handleMediaError());

    expect(result.current.phase).toBe('error');
    expect(result.current.errorKind).toBe('generic');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:answer-1');
  });

  it('retry downloads the same answer again', async () => {
    const { result } = renderRecordedAnswer();
    act(() => result.current.play(FIRST));
    const request = await requestCount(1);
    await act(async () => request.reject(axiosFailure(request.config, 500)));
    await waitFor(() => expect(result.current.phase).toBe('error'));

    act(() => result.current.retry());

    expect(result.current.phase).toBe('loading');
    const again = await requestCount(2);
    expect(again.config.url).toBe('/api/library/answers/entry-1/video');
  });
});
