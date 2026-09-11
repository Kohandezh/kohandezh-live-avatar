import axios, { AxiosHeaders, type AxiosAdapter } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attachAuthInterceptor } from '@/shared/api/interceptors';
import { isNative } from '@/shared/platform';

vi.mock('@/shared/platform', () => ({
  isNative: vi.fn(),
}));

/** Builds a client whose adapter just reports the headers it received. */
function createClientCapturingHeaders(onHeaders: (headers: AxiosHeaders) => void) {
  const client = axios.create({ baseURL: 'http://localhost:3000' });
  attachAuthInterceptor(client);

  const captureAdapter: AxiosAdapter = async (config) => {
    onHeaders(AxiosHeaders.from(config.headers));
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  };
  client.defaults.adapter = captureAdapter;

  return client;
}

describe('attachAuthInterceptor', () => {
  beforeEach(() => {
    vi.mocked(isNative).mockReset();
  });

  it('sends X-Client-Platform: web when the app is not running natively', async () => {
    vi.mocked(isNative).mockReturnValue(false);
    let headers: AxiosHeaders | undefined;

    await createClientCapturingHeaders((h) => {
      headers = h;
    }).get('/ping');

    expect(headers?.get('X-Client-Platform')).toBe('web');
  });

  it('sends X-Client-Platform: native when running inside Capacitor', async () => {
    vi.mocked(isNative).mockReturnValue(true);
    let headers: AxiosHeaders | undefined;

    await createClientCapturingHeaders((h) => {
      headers = h;
    }).get('/ping');

    expect(headers?.get('X-Client-Platform')).toBe('native');
  });
});
