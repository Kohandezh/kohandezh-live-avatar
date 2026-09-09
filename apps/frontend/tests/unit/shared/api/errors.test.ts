import {
  AxiosError,
  AxiosHeaders,
  type InternalAxiosRequestConfig,
} from 'axios';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  isNetworkError,
  isUnauthorized,
  toApiError,
} from '@/shared/api/errors';

const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() };

describe('toApiError', () => {
  it('maps an axios response error to ApiError with status and body code', () => {
    const error = new AxiosError(
      'Request failed',
      AxiosError.ERR_BAD_REQUEST,
      config,
      undefined,
      {
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        config,
        data: { code: 'unauthorized', message: 'Not logged in.' },
      },
    );

    const apiError = toApiError(error);

    expect(apiError).toBeInstanceOf(ApiError);
    expect(apiError.status).toBe(401);
    expect(apiError.code).toBe('unauthorized');
    expect(apiError.message).toBe('Not logged in.');
    expect(isUnauthorized(apiError)).toBe(true);
    expect(isNetworkError(apiError)).toBe(false);
  });

  it('marks errors without a response as network errors', () => {
    const error = new AxiosError(
      'Network Error',
      AxiosError.ERR_NETWORK,
      config,
    );

    const apiError = toApiError(error);

    expect(apiError.isNetworkError).toBe(true);
    expect(apiError.status).toBeUndefined();
  });

  it('does not treat a cancelled request as a network error', () => {
    const error = new AxiosError('canceled', AxiosError.ERR_CANCELED, config);

    expect(toApiError(error).isNetworkError).toBe(false);
  });

  it('wraps plain errors and unknown values', () => {
    expect(toApiError(new Error('boom')).message).toBe('boom');
    expect(toApiError('boom').message).toBe('Unknown error');
  });

  it('returns an existing ApiError unchanged', () => {
    const original = new ApiError({ message: 'x', status: 500 });

    expect(toApiError(original)).toBe(original);
  });
});
