import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server, errorBody } from '@tests/utils/server';
import { providersWrapper } from '@tests/utils/renderWithProviders';
import { useTtsGeneration } from './useTtsGeneration';

describe('useTtsGeneration', () => {
  it('maps the asset, remembers its id and logs a cache-miss event', async () => {
    const { Wrapper, store } = providersWrapper();
    const { result } = renderHook(() => useTtsGeneration(), { wrapper: Wrapper });

    act(() => result.current.generate('سلام'));
    await waitFor(() => expect(result.current.asset).toBeDefined());

    expect(result.current.asset).toMatchObject({
      durationMs: 1500,
      cacheHit: false,
      sampleRate: 24000,
    });
    expect(store.getState().composer.lastAudioAssetId).toBe(result.current.asset?.id);
    const [event] = store.getState().diagnostics.events;
    expect(event?.source).toBe('tts');
    expect(event?.message).toMatch(/ElevenLabs/);
  });

  it('exposes normalized errors and logs them', async () => {
    server.use(
      http.post('*/api/tts/generate', () =>
        HttpResponse.json(errorBody('provider_quota', 'ElevenLabs quota exceeded', false), {
          status: 429,
        }),
      ),
    );
    const { Wrapper, store } = providersWrapper();
    const { result } = renderHook(() => useTtsGeneration(), { wrapper: Wrapper });

    act(() => result.current.generate('سلام'));
    await waitFor(() => expect(result.current.error).toBeTruthy());

    expect(result.current.asset).toBeUndefined();
    expect(store.getState().diagnostics.events[0]).toMatchObject({ level: 'error', source: 'tts' });
  });
});
