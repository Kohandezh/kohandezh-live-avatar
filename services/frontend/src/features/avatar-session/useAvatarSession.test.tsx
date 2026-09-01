import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server, errorBody, fixtures } from '@/test/server';
import { providersWrapper } from '@/test/render';

const livekit = vi.hoisted(() => ({
  connect: vi.fn<(url: string, token: string) => Promise<void>>(),
  disconnect: vi.fn(async () => undefined),
  startAudio: vi.fn(async () => undefined),
}));

vi.mock('./livekitRoom', () => ({
  connectRoom: livekit.connect,
  disconnectRoom: livekit.disconnect,
  startRoomAudio: livekit.startAudio,
  setMediaTargets: vi.fn(),
  isRoomConnected: vi.fn(() => true),
}));

import { useAvatarSession } from './useAvatarSession';

describe('useAvatarSession', () => {
  beforeEach(() => {
    livekit.connect.mockReset();
    livekit.connect.mockResolvedValue(undefined);
    livekit.disconnect.mockClear();
  });

  it('creates the session, connects LiveKit with the token, and never stores the token', async () => {
    const { Wrapper, store } = providersWrapper();
    const { result } = renderHook(() => useAvatarSession(), { wrapper: Wrapper });

    expect(result.current.canStart).toBe(true);
    act(() => result.current.start.mutate());
    await waitFor(() => expect(result.current.status).toBe('connected'));

    expect(livekit.connect).toHaveBeenCalledWith(
      fixtures.session.livekit_url,
      fixtures.session.livekit_client_token,
      expect.anything(),
    );
    expect(result.current.session).toMatchObject({
      id: fixtures.session.id,
      roomName: 'avatar-room-1',
      sandbox: true,
    });
    const serialized = JSON.stringify(store.getState());
    expect(serialized).not.toContain(fixtures.session.livekit_client_token);
    expect(result.current.canSpeak).toBe(true);
    expect(result.current.canStart).toBe(false);
  });

  it('surfaces the configuration error from the orchestrator without retrying', async () => {
    server.use(
      http.post('*/api/avatar/session', () =>
        HttpResponse.json(errorBody('configuration_error', 'PUBLIC_LIVEKIT_URL must be wss://'), {
          status: 503,
        }),
      ),
    );
    const { Wrapper, store } = providersWrapper();
    const { result } = renderHook(() => useAvatarSession(), { wrapper: Wrapper });

    act(() => result.current.start.mutate());
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.error).toContain('configuration_error');
    expect(livekit.connect).not.toHaveBeenCalled();
    expect(store.getState().diagnostics.events[0]).toMatchObject({
      level: 'error',
      source: 'avatar',
    });
    expect(result.current.canStart).toBe(true);
  });

  it('closes the server session when LiveKit cannot connect', async () => {
    let closed = 0;
    server.use(
      http.post(
        '*/api/avatar/close',
        () => ((closed += 1), HttpResponse.json({ status: 'closed' })),
      ),
    );
    livekit.connect.mockRejectedValue(new Error('ICE failed'));
    const { Wrapper } = providersWrapper();
    const { result } = renderHook(() => useAvatarSession(), { wrapper: Wrapper });

    act(() => result.current.start.mutate());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(closed).toBe(1);
    expect(result.current.error).toContain('ICE failed');
  });

  it('speaks, interrupts and closes through the API', async () => {
    const calls: string[] = [];
    server.use(
      http.post('*/api/avatar/speak', () => {
        calls.push('speak');
        return HttpResponse.json({
          event_id: 'e',
          audio_asset_id: null,
          cache_hit: false,
          interrupted: false,
        });
      }),
      http.post(
        '*/api/avatar/interrupt',
        () => (calls.push('interrupt'), HttpResponse.json({ status: 'interrupted' })),
      ),
      http.post(
        '*/api/avatar/close',
        () => (calls.push('close'), HttpResponse.json({ status: 'closed' })),
      ),
    );
    const { Wrapper } = providersWrapper();
    const { result } = renderHook(() => useAvatarSession(), { wrapper: Wrapper });
    act(() => result.current.start.mutate());
    await waitFor(() => expect(result.current.status).toBe('connected'));

    act(() => result.current.speak.mutate('سلام'));
    await waitFor(() => expect(result.current.speak.isSuccess).toBe(true));
    act(() => result.current.interrupt.mutate());
    await waitFor(() => expect(result.current.interrupt.isSuccess).toBe(true));
    act(() => result.current.close.mutate());
    await waitFor(() => expect(result.current.status).toBe('idle'));

    expect(calls).toEqual(['speak', 'interrupt', 'close']);
    expect(livekit.disconnect).toHaveBeenCalled();
    expect(result.current.session).toBeNull();
  });
});
