import { redact } from './redact';

describe('redact', () => {
  it('masks credential-looking keys and JWT-shaped strings', () => {
    const out = redact({
      livekit_client_token:
        'eyJhbGciOiJIUzI1NiJ9.eyJyb29tIjoiYXZhdGFyIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ',
      nested: { api_key: 'abc', authorization: 'Bearer x', room: 'r1' },
      jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJyb29tIjoiYXZhdGFyIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ',
      ok: 'visible',
    }) as Record<string, unknown>;
    expect(out['livekit_client_token']).toBe('[redacted]');
    expect((out['nested'] as Record<string, unknown>)['api_key']).toBe('[redacted]');
    expect((out['nested'] as Record<string, unknown>)['authorization']).toBe('[redacted]');
    expect((out['nested'] as Record<string, unknown>)['room']).toBe('r1');
    expect(out['jwt']).toBe('[redacted]');
    expect(out['ok']).toBe('visible');
  });
  it('serializes errors and bounds depth', () => {
    expect(redact(new Error('boom'))).toEqual({ name: 'Error', message: 'boom' });
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 10; i += 1) deep = { child: deep };
    expect(JSON.stringify(redact(deep))).toContain('[truncated]');
  });
});
