import axios from 'axios';
import { beforeEach, describe, expect, it } from 'vitest';
import { installMockApi, MOCK_PASSWORD, mockSession } from '@/data/mock';
import { toApiError } from '@/shared/api/errors';
import { attachErrorInterceptor } from '@/shared/api/interceptors';
import { isApiError } from '@/shared/api';

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

  it('logs in with a known account and keeps the session', async () => {
    const client = createClient();

    const login = await client.post('/api/auth/login', {
      email: 'user@example.com',
      password: MOCK_PASSWORD,
    });
    expect(login.data.user.email).toBe('user@example.com');
    expect(login.data.accessToken).toMatch(/^mock-token-/);

    const me = await client.get('/api/me');
    expect(me.data.id).toBe('u-user');
  });

  it('rejects a wrong password', async () => {
    await expectStatus(
      createClient().post('/api/auth/login', {
        email: 'user@example.com',
        password: 'nope',
      }),
      401,
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
