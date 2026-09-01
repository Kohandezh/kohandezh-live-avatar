import { ApiError, codeFromStatus, describeError } from './errors';

describe('codeFromStatus', () => {
  it('maps orchestrator statuses', () => {
    expect(codeFromStatus(401)).toBe('UNAUTHORIZED');
    expect(codeFromStatus(404)).toBe('NOT_FOUND');
    expect(codeFromStatus(409)).toBe('CONFLICT');
    expect(codeFromStatus(422)).toBe('VALIDATION');
    expect(codeFromStatus(429)).toBe('RATE_LIMITED');
    expect(codeFromStatus(503)).toBe('UNAVAILABLE');
    expect(codeFromStatus(502)).toBe('SERVER');
  });
});

describe('ApiError.isRetryable', () => {
  it('lets the server verdict win', () => {
    expect(new ApiError(503, 'UNAVAILABLE', 'x', { retryable: false }).isRetryable).toBe(false);
    expect(new ApiError(409, 'CONFLICT', 'x', { retryable: true }).isRetryable).toBe(true);
  });
  it('falls back to transport/5xx heuristics', () => {
    expect(new ApiError(500, 'SERVER', 'x').isRetryable).toBe(true);
    expect(new ApiError(0, 'NETWORK', 'x').isRetryable).toBe(true);
    expect(new ApiError(0, 'TIMEOUT', 'x').isRetryable).toBe(true);
    expect(new ApiError(422, 'VALIDATION', 'x').isRetryable).toBe(false);
  });
  it('describes with the server code when present', () => {
    expect(
      describeError(
        new ApiError(503, 'UNAVAILABLE', 'not ready', { serverCode: 'configuration_error' }),
      ),
    ).toBe('configuration_error: not ready');
    expect(describeError(new Error('boom'))).toBe('boom');
  });
});
