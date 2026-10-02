import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server, errorBody, fixtures } from '@tests/utils/server';
import { providersWrapper } from '@tests/utils/renderWithProviders';
import { useRecording } from './useRecording';

const RECORD_ERRORS = 'library.record.errors';

type JobAnswer = Record<string, unknown>;

/** Answers GET /api/jobs/:id with `answers` in order, then keeps repeating the last one. */
function jobAnswers(...answers: JobAnswer[]) {
  const polls: string[] = [];
  server.use(
    http.get('*/api/jobs/:jobId', ({ params }) => {
      polls.push(String(params['jobId']));
      const answer = answers[Math.min(polls.length - 1, answers.length - 1)];
      return HttpResponse.json(answer);
    }),
  );
  return polls;
}

function finalizeCalls() {
  const calls: string[] = [];
  server.use(
    http.post('*/api/assets/video/:id/finalize', ({ params }) => {
      calls.push(String(params['id']));
      return HttpResponse.json(fixtures.finalizeJob, { status: 202 });
    }),
  );
  return calls;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function startRecording() {
  const { Wrapper, store } = providersWrapper();
  const { result, unmount } = renderHook(() => useRecording(), { wrapper: Wrapper });
  act(() => result.current.start.mutate({ sessionId: 's1', text: 'x', audioAssetId: null }));
  await waitFor(() => expect(result.current.status).toBe('recording'));
  return { result, store, Wrapper, unmount };
}

describe('useRecording', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts Egress and finalizes to an MP4 with probe data', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post('*/api/assets/generate-video', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 'v1', egress_id: 'EG_9', status: 'RECORDING' });
      }),
    );
    const { Wrapper } = providersWrapper();
    const { result } = renderHook(() => useRecording(), { wrapper: Wrapper });

    act(() => result.current.start.mutate({ sessionId: 's1', text: 'سلام', audioAssetId: 'a1' }));
    await waitFor(() => expect(result.current.status).toBe('recording'));
    expect(body).toMatchObject({ session_id: 's1', text: 'سلام', audio_asset_id: 'a1' });
    expect(String(body['asset_id'])).toMatch(/^AVATAR_\d{14}$/);
    expect(result.current.active).toMatchObject({ id: 'v1', egressId: 'EG_9' });

    act(() => result.current.stop.mutate());
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.result?.probe).toMatchObject({
      videoCodec: 'h264',
      audioCodec: 'aac',
      durationMs: 4200,
    });
    expect(result.current.active).toBeNull();
  });

  it('keeps the job id and polls every 2 seconds until the job is done (REQ-041)', async () => {
    const finalized = finalizeCalls();
    const polls = jobAnswers(
      { status: 'queued' },
      { status: 'running' },
      { status: 'done', result: fixtures.finalize },
    );
    const { result, store } = await startRecording();

    act(() => result.current.stop.mutate());
    await waitFor(() => expect(polls).toHaveLength(1));
    expect(result.current.status).toBe('finalizing');
    expect(store.getState().recording.jobId).toBe(fixtures.finalizeJob.jobId);

    await advance(1900);
    expect(polls).toHaveLength(1);
    expect(result.current.job.status).toBe('queued');
    await advance(100);
    await waitFor(() => expect(polls).toHaveLength(2));
    await waitFor(() => expect(result.current.job.status).toBe('running'));
    expect(result.current.status).toBe('finalizing');

    await advance(2000);
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(polls).toEqual(Array(3).fill(fixtures.finalizeJob.jobId));
    expect(finalized).toEqual([fixtures.recording.id]);
    expect(result.current.result).toMatchObject({
      id: fixtures.finalize.id,
      status: 'VIDEO_GENERATED',
      mediaUrl: fixtures.finalize.media_url,
    });
    expect(result.current.active).toBeNull();

    await advance(10_000);
    expect(polls).toHaveLength(3);
  });

  it.each([
    ['egress_failure', `${RECORD_ERRORS}.finalizeFileMissing`],
    ['egress_invalid_mp4', `${RECORD_ERRORS}.finalizeInvalid`],
    ['worker_lost', `${RECORD_ERRORS}.finalizeLost`],
    ['internal_error', `${RECORD_ERRORS}.finalizeFailed`],
    ['disk_full', `${RECORD_ERRORS}.finalizeFailed`],
  ])('maps a job that failed with %s to its message and stops polling', async (code, key) => {
    const polls = jobAnswers({ status: 'failed', error: { code, message: 'Fixed English text.' } });
    const { result } = await startRecording();

    act(() => result.current.stop.mutate());
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.errorKey).toBe(key);
    expect(result.current.errorCode).toBe(code);
    // Egress already stopped, so the handle is gone: the admin records the answer again.
    expect(result.current.isActive).toBe(false);
    await advance(10_000);
    expect(polls).toHaveLength(1);
  });

  it('stops polling at 180 seconds and shows the job as slow, not as an error', async () => {
    const polls = jobAnswers({ status: 'running' });
    const { result } = await startRecording();

    act(() => result.current.stop.mutate());
    await waitFor(() => expect(polls).toHaveLength(1));
    for (let elapsed = 0; elapsed < 178_000; elapsed += 2000) await advance(2000);
    expect(result.current.job.isSlow).toBe(false);

    await advance(2000);
    await waitFor(() => expect(result.current.job.isSlow).toBe(true));
    expect(result.current.status).toBe('finalizing');
    expect(result.current.errorKey).toBeNull();
    expect(result.current.isActive).toBe(true);
    const pollsAtTimeout = polls.length;
    expect(pollsAtTimeout).toBeGreaterThanOrEqual(90);
    expect(pollsAtTimeout).toBeLessThanOrEqual(91);

    await advance(10_000);
    expect(polls).toHaveLength(pollsAtTimeout);
  });

  it('Check again polls the same job for another 180 seconds without finalizing again', async () => {
    const finalized = finalizeCalls();
    const polls = jobAnswers({ status: 'running' });
    const { result } = await startRecording();
    act(() => result.current.stop.mutate());
    await waitFor(() => expect(polls).toHaveLength(1));
    for (let elapsed = 0; elapsed < 180_000; elapsed += 2000) await advance(2000);
    await waitFor(() => expect(result.current.job.isSlow).toBe(true));

    const again = jobAnswers({ status: 'running' }, { status: 'done', result: fixtures.finalize });
    act(() => result.current.job.checkAgain());
    await waitFor(() => expect(again).toHaveLength(1));
    expect(result.current.job.isSlow).toBe(false);
    await advance(2000);
    await waitFor(() => expect(result.current.status).toBe('done'));

    expect(finalized).toHaveLength(1);
  });

  it('keeps polling through a network error', async () => {
    let polls = 0;
    server.use(
      http.get('*/api/jobs/:jobId', () => {
        polls += 1;
        return polls === 2
          ? HttpResponse.error()
          : HttpResponse.json(
              polls < 3 ? { status: 'running' } : { status: 'done', result: fixtures.finalize },
            );
      }),
    );
    const { result } = await startRecording();

    act(() => result.current.stop.mutate());
    await waitFor(() => expect(polls).toBe(1));
    await advance(2000);
    await waitFor(() => expect(polls).toBe(2));
    expect(result.current.status).toBe('finalizing');
    await advance(2000);
    await waitFor(() => expect(result.current.status).toBe('done'));
  });

  it('keeps polling through a 500 the server marks not retryable, then shows done (REQ-041)', async () => {
    let polls = 0;
    server.use(
      http.get('*/api/jobs/:jobId', () => {
        polls += 1;
        return polls === 1
          ? HttpResponse.json(errorBody('internal_error', 'The job store failed.', false), {
              status: 500,
            })
          : HttpResponse.json({ status: 'done', result: fixtures.finalize });
      }),
    );
    const { result } = await startRecording();

    act(() => result.current.stop.mutate());
    await waitFor(() => expect(polls).toBe(1));
    await advance(100);
    expect(result.current.status).toBe('finalizing');
    expect(result.current.errorKey).toBeNull();

    await advance(2000);
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(polls).toBe(2);
  });

  it('stops polling on a 403 for the job, with the finalize message and the code', async () => {
    let polls = 0;
    server.use(
      http.get('*/api/jobs/:jobId', () => {
        polls += 1;
        return HttpResponse.json(errorBody('forbidden', 'Admin role required.'), { status: 403 });
      }),
    );
    const { result } = await startRecording();

    act(() => result.current.stop.mutate());
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.errorKey).toBe(`${RECORD_ERRORS}.finalizeFailed`);
    expect(result.current.errorCode).toBe('forbidden');
    await advance(10_000);
    expect(polls).toBe(1);
  });

  it('stops polling when the job is gone, with the finalize message and the code', async () => {
    server.use(
      http.get('*/api/jobs/:jobId', () =>
        HttpResponse.json(errorBody('not_found', 'job was not found'), { status: 404 }),
      ),
    );
    const { result } = await startRecording();

    act(() => result.current.stop.mutate());
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.errorKey).toBe(`${RECORD_ERRORS}.finalizeFailed`);
    expect(result.current.errorCode).toBe('not_found');
  });

  it('stops polling when the screen unmounts and resumes when it mounts again', async () => {
    const polls = jobAnswers({ status: 'running' });
    const { result, Wrapper, unmount } = await startRecording();
    act(() => result.current.stop.mutate());
    await waitFor(() => expect(polls).toHaveLength(1));

    unmount();
    await advance(10_000);
    expect(polls).toHaveLength(1);

    const again = renderHook(() => useRecording(), { wrapper: Wrapper });
    await waitFor(() => expect(polls).toHaveLength(2));
    expect(again.result.current.jobId).toBe(fixtures.finalizeJob.jobId);
    await advance(2000);
    await waitFor(() => expect(polls).toHaveLength(3));
  });

  it('keeps the recording handle when the finalize request fails, so Stop can be retried', async () => {
    server.use(
      http.post('*/api/assets/video/:id/finalize', () =>
        HttpResponse.json(errorBody('egress_failure', 'LiveKit Egress could not stop', true), {
          status: 502,
        }),
      ),
    );
    const { result } = await startRecording();

    act(() => result.current.stop.mutate());
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.isActive).toBe(true);
    expect(result.current.errorKey).toBe(`${RECORD_ERRORS}.finalizeFailed`);
    expect(result.current.errorCode).toBe('egress_failure');
  });

  it('refuses a done job whose result is not a finalized video', async () => {
    jobAnswers({ status: 'done', result: { id: 'v1' } });
    const { result } = await startRecording();

    act(() => result.current.stop.mutate());
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.errorKey).toBe(`${RECORD_ERRORS}.finalizeFailed`);
    expect(result.current.result).toBeNull();
  });

  it.each([
    ['recording_unavailable', `${RECORD_ERRORS}.recordingUnavailable`],
    ['duplicate_generation', `${RECORD_ERRORS}.recordingDuplicate`],
    ['egress_failure', `${RECORD_ERRORS}.recordingFailed`],
  ])('maps a refused recording start (%s) to its message', async (code, key) => {
    server.use(
      http.post('*/api/assets/generate-video', () =>
        HttpResponse.json(errorBody(code, 'Fixed English text.'), { status: 409 }),
      ),
    );
    const { Wrapper } = providersWrapper();
    const { result } = renderHook(() => useRecording(), { wrapper: Wrapper });

    act(() => result.current.start.mutate({ sessionId: 's1', text: 'x', audioAssetId: null }));
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.errorKey).toBe(key);
    expect(result.current.errorCode).toBe(code);
    expect(result.current.isActive).toBe(false);
  });
});
