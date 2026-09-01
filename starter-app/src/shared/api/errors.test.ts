import { ApiError, codeFromStatus } from './errors';

describe('codeFromStatus', () => {
  it('maps auth and server codes', () => {
    expect(codeFromStatus(401)).toBe('UNAUTHORIZED');
    expect(codeFromStatus(403)).toBe('FORBIDDEN');
    expect(codeFromStatus(422)).toBe('VALIDATION');
    expect(codeFromStatus(503)).toBe('SERVER');
  });
  it('marks only network/timeout/5xx as retryable', () => {
    expect(new ApiError(500, 'SERVER', 'x').isRetryable).toBe(true);
    expect(new ApiError(0, 'NETWORK', 'x').isRetryable).toBe(true);
    expect(new ApiError(401, 'UNAUTHORIZED', 'x').isRetryable).toBe(false);
  });
});
