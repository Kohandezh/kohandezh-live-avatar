import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server, errorBody } from '@tests/utils/server';
import { providersWrapper } from '@tests/utils/renderWithProviders';
import { useRecording } from './useRecording';

describe('useRecording', () => {
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

  it('keeps the recording handle when finalization fails so it can be retried', async () => {
    server.use(
      http.post('*/api/assets/video/:id/finalize', () =>
        HttpResponse.json(errorBody('egress_failure', 'MP4 did not appear', true), { status: 502 }),
      ),
    );
    const { Wrapper } = providersWrapper();
    const { result } = renderHook(() => useRecording(), { wrapper: Wrapper });
    act(() => result.current.start.mutate({ sessionId: 's1', text: 'x', audioAssetId: null }));
    await waitFor(() => expect(result.current.status).toBe('recording'));
    act(() => result.current.stop.mutate());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.isActive).toBe(true);
    expect(result.current.error).toContain('egress_failure');
  });
});
