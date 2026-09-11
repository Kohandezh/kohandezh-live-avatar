import axios from 'axios';
import { beforeEach, describe, expect, it } from 'vitest';
import { installMockApi, MOCK_OTP_CODE, mockSession } from '@/data/mock';
import { isApiError } from '@/shared/api';
import { toApiError } from '@/shared/api/errors';
import { attachErrorInterceptor } from '@/shared/api/interceptors';

function createClient() {
  const client = axios.create({ baseURL: 'http://localhost:3000' });
  attachErrorInterceptor(client);
  installMockApi(client, { delayMs: 0 });
  return client;
}

async function expectStatus(promise: Promise<unknown>, status: number) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );

  expect(isApiError(error) ? error.status : error).toBe(status);
}

describe('mock API', () => {
  beforeEach(() => {
    mockSession.clear();
  });

  it('returns 401 from /api/me without a session', async () => {
    await expectStatus(createClient().get('/api/me'), 401);
  });

  it('requests a code and logs in a known account with it', async () => {
    const client = createClient();

    const request = await client.post('/api/auth/otp/request', {
      phone: '09351234567',
    });
    expect(request.status).toBe(202);
    expect(request.data.phone).toBe('+989351234567');
    expect(request.data.devCode).toBe(MOCK_OTP_CODE);

    const verify = await client.post('/api/auth/otp/verify', {
      phone: '09351234567',
      code: MOCK_OTP_CODE,
    });
    expect(verify.data.user.phone).toBe('+989351234567');
    expect(verify.data.accessToken).toMatch(/^mock-token-/);

    const me = await client.get('/api/me');
    expect(me.data.id).toBe('u-user');
  });

  it('rejects an invalid phone number on request', async () => {
    await expectStatus(
      createClient().post('/api/auth/otp/request', { phone: 'abc' }),
      422,
    );
  });

  it('rejects a wrong code', async () => {
    const client = createClient();
    await client.post('/api/auth/otp/request', { phone: '09351234567' });

    await expectStatus(
      client.post('/api/auth/otp/verify', {
        phone: '09351234567',
        code: '000000',
      }),
      401,
    );
  });

  it('rejects a code when nothing was requested', async () => {
    // A phone number no other test in this file requests, so there is no
    // leftover pending code from an earlier test to accidentally match.
    await expectStatus(
      createClient().post('/api/auth/otp/verify', {
        phone: '09370000009',
        code: MOCK_OTP_CODE,
      }),
      410,
    );
  });

  it('creates a new user account for an unknown phone number', async () => {
    const client = createClient();
    const phone = '09190000001';

    await client.post('/api/auth/otp/request', { phone });
    const verify = await client.post('/api/auth/otp/verify', {
      phone,
      code: MOCK_OTP_CODE,
    });

    expect(verify.data.user.phone).toBe('+989190000001');
    expect(verify.data.user.role).toBe('user');
    expect(verify.data.user.email).toBeNull();
  });

  it('blocks a disabled account', async () => {
    const client = createClient();
    // u-001 is the deterministic disabled seed account (see src/data/mock/users.ts).
    const phone = '+989900000000';

    await client.post('/api/auth/otp/request', { phone });
    await expectStatus(
      client.post('/api/auth/otp/verify', { phone, code: MOCK_OTP_CODE }),
      403,
    );
  });

  it('accepts a bearer token instead of the session', async () => {
    const client = createClient();

    const me = await client.get('/api/me', {
      headers: { Authorization: 'Bearer mock-token-u-admin' },
    });

    expect(me.data.role).toBe('admin');
  });

  it('blocks admin endpoints for normal users', async () => {
    mockSession.set('u-user');

    await expectStatus(createClient().get('/api/admin/users'), 403);
    await expectStatus(createClient().get('/api/admin/dashboard'), 403);
  });

  it('filters and paginates users for admins', async () => {
    mockSession.set('u-admin');
    const client = createClient();

    const firstPage = await client.get('/api/admin/users', {
      params: { page: 1, pageSize: 5 },
    });
    expect(firstPage.data.items).toHaveLength(5);
    expect(firstPage.data.total).toBe(57);

    const search = await client.get('/api/admin/users', {
      params: { q: 'admin@example' },
    });
    expect(search.data.items).toHaveLength(1);
    expect(search.data.items[0].id).toBe('u-admin');
  });

  it('returns 404 for unknown routes', async () => {
    await expectStatus(createClient().get('/api/does-not-exist'), 404);
  });

  it('produces errors that toApiError understands', async () => {
    const error = await createClient()
      .get('/api/me')
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(toApiError(error).code).toBe('unauthorized');
  });
});
