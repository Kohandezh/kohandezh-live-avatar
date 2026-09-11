import axios, { AxiosHeaders, type AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';
import { apiClient, configureApiClient } from '@/shared/api';
import {
  attachEmbedKeyInterceptor,
  setEmbedKey,
} from '@/shared/api/interceptors';

/** Builds a client whose adapter just reports the headers it received. */
function createClientCapturingHeaders(
  onHeaders: (headers: AxiosHeaders) => void,
) {
  const client = axios.create({ baseURL: 'http://localhost:3000' });
  attachEmbedKeyInterceptor(client);

  const captureAdapter: AxiosAdapter = async (config) => {
    onHeaders(AxiosHeaders.from(config.headers));
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  };
  client.defaults.adapter = captureAdapter;

  return client;
}

/** Sends one request through a fresh client and returns the headers it carried. */
async function sendAndReadHeaders(): Promise<AxiosHeaders | undefined> {
  let headers: AxiosHeaders | undefined;
  const client = createClientCapturingHeaders((captured) => {
    headers = captured;
  });
  await client.get('/ping');
  return headers;
}

describe('attachEmbedKeyInterceptor', () => {
  afterEach(() => {
    setEmbedKey(null);
  });

  it('sends no embed key header when none is configured', async () => {
    const headers = await sendAndReadHeaders();

    expect(headers?.has('X-Embed-Key')).toBe(false);
  });

  it('sends X-Embed-Key once an embed key is configured', async () => {
    setEmbedKey('embed-key-1');

    const headers = await sendAndReadHeaders();

    expect(headers?.get('X-Embed-Key')).toBe('embed-key-1');
  });
});

describe('configureApiClient', () => {
  const baseURL = apiClient.defaults.baseURL;
  const withCredentials = apiClient.defaults.withCredentials;

  afterEach(() => {
    apiClient.defaults.baseURL = baseURL;
    apiClient.defaults.withCredentials = withCredentials;
    setEmbedKey(null);
  });

  it('points the shared client at the given backend', () => {
    configureApiClient({
      baseURL: 'https://api.example.com',
      embedKey: 'embed-key-2',
    });

    expect(apiClient.defaults.baseURL).toBe('https://api.example.com');
  });

  it('turns cookies off so a visitor session never mixes with the embed key', () => {
    configureApiClient({ baseURL: '', embedKey: 'embed-key-2' });

    expect(apiClient.defaults.withCredentials).toBe(false);
  });

  it('makes every request carry the embed key', async () => {
    configureApiClient({ baseURL: '', embedKey: 'embed-key-3' });

    const headers = await sendAndReadHeaders();

    expect(headers?.get('X-Embed-Key')).toBe('embed-key-3');
  });
});
