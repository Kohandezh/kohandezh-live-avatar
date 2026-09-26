import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server, errorBody, fixtures } from '@tests/utils/server';
import { providersWrapper } from '@tests/utils/renderWithProviders';
import { useRecording } from './useRecording';

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
  const { result } = renderHook(() => useRecording(), { wrapper: Wrapper });
  act(() => result.current.start.mutate({ sessionId: 's1', text: 'x', audioAssetId: null }));
  await waitFor(() => expect(result.current.status).toBe('recording'));
  return { result, store };
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

  it('keeps the job id and polls every 2 seconds until the job is done', async () => {
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
    await advance(100);
    await waitFor(() => expect(polls).toHaveLength(2));
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

  it('shows a failed job as an error and keeps the recording so it can be retried', async () => {
    const polls = jobAnswers({
      status: 'failed',
      error: { code: 'egress_failure', message: 'The recording file did not appear in time.' },
    });
    const { result } = await startRecording();

    act(() => result.current.stop.mutate());
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.isActive).toBe(true);
    expect(result.current.error).toContain('egress_failure');
    expect(result.current.errorKey).toBe('recording.errors.egress_failure');
    await advance(10_000);
    expect(polls).toHaveLength(1);
  });

  it('shows the server text of a failed job whose code it does not know', async () => {
    jobAnswers({ status: 'failed', error: { code: 'disk_full', message: 'The disk is full.' } });
    const { result } = await startRecording();

    act(() => result.current.stop.mutate());
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.errorKey).toBeNull();
    expect(result.current.error).toBe('disk_full: The disk is full.');
  });

  it('shows an unexpected server failure of the job with the generic text', async () => {
    jobAnswers({ status: 'failed', error: { code: 'internal_error', message: 'The job failed.' } });
    const { result } = await startRecording();

    act(() => result.current.stop.mutate());
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.errorKey).toBe('recording.errors.generic');
  });

  it('gives up after 180 seconds with a timeout error that can be retried', async () => {
    const polls = jobAnswers({ status: 'running' });
    const { result } = await startRecording();

    act(() => result.current.stop.mutate());
    await waitFor(() => expect(polls).toHaveLength(1));
    for (let elapsed = 0; elapsed < 178_000; elapsed += 2000) await advance(2000);
    expect(result.current.status).toBe('finalizing');

    await advance(2000);
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorKey).toBe('recording.timeout');
    expect(result.current.isActive).toBe(true);
    const pollsAtTimeout = polls.length;
    expect(pollsAtTimeout).toBe(91);

    await advance(10_000);
    expect(polls).toHaveLength(pollsAtTimeout);
  });

  it('checks the same job again when the operator retries after a timeout', async () => {
    const finalized = finalizeCalls();
    const polls = jobAnswers({ status: 'running' });
    const { result } = await startRecording();
    act(() => result.current.stop.mutate());
    await waitFor(() => expect(polls).toHaveLength(1));
    for (let elapsed = 0; elapsed < 180_000; elapsed += 2000) await advance(2000);
    await waitFor(() => expect(result.current.status).toBe('error'));

    jobAnswers({ status: 'done', result: fixtures.finalize });
    act(() => result.current.stop.mutate());
    await waitFor(() => expect(result.current.status).toBe('done'));

    // The backend answers a repeated finalize with the same job while it is queued or running.
    expect(finalized).toHaveLength(2);
  });

  it('keeps the recording handle when the finalize request fails', async () => {
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
    expect(result.current.error).toContain('egress_failure');
    // A failed request is not a failed job: its server text is shown as before.
    expect(result.current.errorKey).toBeNull();
  });

  it('shows an error when polling the job fails', async () => {
    server.use(
      http.get('*/api/jobs/:jobId', () =>
        HttpResponse.json(errorBody('not_found', 'job was not found'), { status: 404 }),
      ),
    );
    const { result } = await startRecording();

    act(() => result.current.stop.mutate());
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.isActive).toBe(true);
    expect(result.current.error).toContain('not_found');
  });

  it('refuses a done job whose result is not a finalized video', async () => {
    jobAnswers({ status: 'done', result: { id: 'v1' } });
    const { result } = await startRecording();

    act(() => result.current.stop.mutate());
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.isActive).toBe(true);
    expect(result.current.result).toBeNull();
  });
});
