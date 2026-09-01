import { http, HttpResponse } from 'msw';
import { server, errorBody } from '@/test/server';
import { api, apiUrl, apiWsUrl, request, requestBinary, setCredentialsProvider } from './client';
import { ApiError } from './errors';

describe('api client', () => {
  afterEach(() => setCredentialsProvider(null));

  it('resolves the same-origin base against window.location', () => {
    expect(apiUrl('/health')).toBe(`${window.location.origin}/api/health`);
    expect(apiUrl('assets/audio/1', { x: 1 })).toBe(
      `${window.location.origin}/api/assets/audio/1?x=1`,
    );
    expect(apiWsUrl('/ws/status')).toBe(
      `${window.location.origin.replace(/^http/, 'ws')}/api/ws/status`,
    );
  });

  it('returns parsed JSON on success', async () => {
    const health = await api.get<{ status: string }>('/health');
    expect(health.status).toBe('ok');
  });

  it('normalizes orchestrator error bodies', async () => {
    server.use(
      http.post('*/api/avatar/session', () =>
        HttpResponse.json(
          errorBody('configuration_error', 'PUBLIC_LIVEKIT_URL must be wss://', false, 'corr-42'),
          {
            status: 503,
          },
        ),
      ),
    );
    const error = await api.post('/avatar/session', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(503);
    expect(apiError.code).toBe('UNAVAILABLE');
    expect(apiError.serverCode).toBe('configuration_error');
    expect(apiError.correlationId).toBe('corr-42');
    expect(apiError.isRetryable).toBe(false);
    expect(apiError.message).toContain('PUBLIC_LIVEKIT_URL');
  });

  it('maps network failures and timeouts', async () => {
    server.use(http.get('*/api/health', () => HttpResponse.error()));
    await expect(request('/health')).rejects.toMatchObject({ code: 'NETWORK' });

    server.use(
      http.get('*/api/health', async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return HttpResponse.json({});
      }),
    );
    await expect(request('/health', { timeoutMs: 20 })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('fetches binary bodies', async () => {
    const buffer = await requestBinary('/assets/audio/abc');
    expect(buffer.byteLength).toBe(4800);
  });

  it('attaches headers from the credentials provider without leaking them elsewhere', async () => {
    let seen: string | null = null;
    server.use(
      http.get('*/api/health', ({ request: req }) => {
        seen = req.headers.get('authorization');
        return HttpResponse.json({ status: 'ok' });
      }),
    );
    setCredentialsProvider(async () => ({ Authorization: 'Bearer future-token' }));
    await api.get('/health');
    expect(seen).toBe('Bearer future-token');
  });
});
