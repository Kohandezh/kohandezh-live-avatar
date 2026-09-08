import {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { sleep } from '@/shared/utils';
import { MockHttpError, routes, type MockRequest } from './handlers';

export interface MockApiOptions {
  /** Fake network delay. Set 0 in tests. */
  delayMs?: number;
}

const FALLBACK_ORIGIN = 'http://mock.local';

function buildUrl(config: InternalAxiosRequestConfig): URL {
  const base = config.baseURL || FALLBACK_ORIGIN;
  const url = new URL(config.url ?? '/', base);

  if (config.params && typeof config.params === 'object') {
    for (const [key, value] of Object.entries(
      config.params as Record<string, unknown>,
    )) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url;
}

function parseBody(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

function errorResponse(
  config: InternalAxiosRequestConfig,
  status: number,
  code: string,
  message: string,
): AxiosError {
  const response: AxiosResponse = {
    data: { code, message },
    status,
    statusText: message,
    headers: {},
    config,
  };

  return new AxiosError(
    message,
    status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
    config,
    undefined,
    response,
  );
}

/** An axios adapter that answers requests from src/data/mock instead of the network. */
export function createMockAdapter({
  delayMs = 400,
}: MockApiOptions = {}): AxiosAdapter {
  return async (config) => {
    if (delayMs > 0) await sleep(delayMs);

    const url = buildUrl(config);
    const method = (config.method ?? 'get').toLowerCase();
    const route = routes.find(
      (candidate) =>
        candidate.method === method && candidate.path.test(url.pathname),
    );

    if (!route) {
      throw errorResponse(
        config,
        404,
        'not_found',
        `No mock for ${method.toUpperCase()} ${url.pathname}`,
      );
    }

    const headers = AxiosHeaders.from(config.headers);
    const request: MockRequest = {
      method,
      url,
      body: parseBody(config.data),
      authorization: headers.get('Authorization')?.toString(),
    };

    try {
      const result = route.handle(request);

      return {
        data: result.body,
        status: result.status ?? 200,
        statusText: 'OK',
        headers: {},
        config,
      } satisfies AxiosResponse;
    } catch (error) {
      if (error instanceof MockHttpError) {
        throw errorResponse(config, error.status, error.code, error.message);
      }
      throw error;
    }
  };
}

/** Points the API client at the mock adapter. Call once during bootstrap. */
export function installMockApi(
  client: AxiosInstance,
  options?: MockApiOptions,
): void {
  client.defaults.adapter = createMockAdapter(options);
}
