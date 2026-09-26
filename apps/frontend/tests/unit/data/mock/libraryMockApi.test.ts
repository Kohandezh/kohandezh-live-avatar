import axios from 'axios';
import { beforeEach, describe, expect, it } from 'vitest';
import { installMockApi, mockSession, resetMockLibrary } from '@/data/mock';
import {
  adminLibraryEntryPageSchema,
  adminLibraryEntrySchema,
  libraryRecordingPageSchema,
  librarySuggestionListSchema,
} from '@/entities/library-entry';
import { isApiError } from '@/shared/api';
import { attachErrorInterceptor } from '@/shared/api/interceptors';

function createClient() {
  const client = axios.create({ baseURL: 'http://localhost:3000' });
  attachErrorInterceptor(client);
  installMockApi(client, { delayMs: 0 });
  return client;
}

async function expectError(
  promise: Promise<unknown>,
  status: number,
  code?: string,
) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );

  expect(isApiError(error) ? error.status : error).toBe(status);
  if (code && isApiError(error)) expect(error.code).toBe(code);
}

const newEntry = {
  question: 'پرسش تازه',
  language: 'fa',
  category: '5',
  categoryTitle: 'دسته پنج',
  sectionType: 'knowledge',
  technical: 'technical',
  key: 'C5Q01',
};

async function suggestions(client = createClient(), language = 'fa') {
  const response = await client.get('/api/library/suggestions', {
    params: { language },
  });
  return librarySuggestionListSchema.parse(response.data).items;
}

async function entries(client = createClient(), params = {}) {
  const response = await client.get('/api/admin/library/entries', { params });
  return adminLibraryEntryPageSchema.parse(response.data);
}

describe('mock library API, signed-in user routes', () => {
  beforeEach(() => {
    mockSession.clear();
    resetMockLibrary();
  });

  it('needs a session', async () => {
    const client = createClient();

    await expectError(
      client.get('/api/library/suggestions', { params: { language: 'fa' } }),
      401,
    );
    await expectError(client.get('/api/library/answers/x/follow-ups'), 401);
    await expectError(client.get('/api/library/answers/x/video'), 401);
  });

  it('suggests two Persian answers and none in English', async () => {
    mockSession.set('u-user');

    const persian = await suggestions();
    const english = await suggestions(createClient(), 'en');

    expect(persian).toHaveLength(2);
    expect(english).toEqual([]);
  });

  it('refuses a bad language or limit', async () => {
    mockSession.set('u-user');
    const client = createClient();

    await expectError(
      client.get('/api/library/suggestions', { params: { language: 'de' } }),
      422,
      'validation_error',
    );
    await expectError(
      client.get('/api/library/suggestions', {
        params: { language: 'fa', limit: 21 },
      }),
      422,
      'validation_error',
    );
  });

  it('follows the first suggestion with the second one', async () => {
    mockSession.set('u-user');
    const [first, second] = await suggestions();

    const response = await createClient().get(
      `/api/library/answers/${first?.id}/follow-ups`,
    );

    expect(librarySuggestionListSchema.parse(response.data).items).toEqual([
      second,
    ]);
  });

  it('answers 404 for the follow-ups of an entry users may not see', async () => {
    mockSession.set('u-admin');
    const [draft] = (await entries(createClient(), { status: 'draft' })).items;
    mockSession.set('u-user');

    await expectError(
      createClient().get(`/api/library/answers/${draft?.id}/follow-ups`),
      404,
      'not_found',
    );
    await expectError(
      createClient().get('/api/library/answers/no-such-entry/follow-ups'),
      404,
      'not_found',
    );
  });

  it('answers 404 for every video, because the mock holds no media', async () => {
    mockSession.set('u-user');
    const [first] = await suggestions();

    await expectError(
      createClient().get(`/api/library/answers/${first?.id}/video`),
      404,
      'not_found',
    );
  });
});

describe('mock library API, admin routes', () => {
  beforeEach(() => {
    mockSession.clear();
    resetMockLibrary();
  });

  it('needs the admin role', async () => {
    await expectError(createClient().get('/api/admin/library/entries'), 401);
    mockSession.set('u-user');

    await expectError(createClient().get('/api/admin/library/entries'), 403);
    await expectError(createClient().get('/api/admin/library/recordings'), 403);
    await expectError(
      createClient().post('/api/admin/library/entries', newEntry),
      403,
    );
  });

  it('lists every status, newest first, and filters them', async () => {
    mockSession.set('u-admin');

    const all = await entries();
    const pending = await entries(createClient(), { status: 'pending' });

    expect(new Set(all.items.map((entry) => entry.status))).toEqual(
      new Set(['pending', 'ready', 'draft', 'published', 'withdrawn']),
    );
    const positions = all.items.map((entry) => entry.position);
    expect(positions).toEqual([...positions].sort((a, b) => b - a));
    expect(pending.items.every((entry) => entry.status === 'pending')).toBe(
      true,
    );
    expect(pending.total).toBe(pending.items.length);
  });

  it('creates a pending entry and refuses a taken key', async () => {
    mockSession.set('u-admin');
    const client = createClient();

    const response = await client.post('/api/admin/library/entries', newEntry);

    expect(response.status).toBe(201);
    const created = adminLibraryEntrySchema.parse(response.data);
    expect(created.status).toBe('pending');
    expect(created.answerText).toBeNull();
    await expectError(
      client.post('/api/admin/library/entries', newEntry),
      409,
      'library_key_taken',
    );
    await expectError(
      client.post('/api/admin/library/entries', {
        ...newEntry,
        key: undefined,
      }),
      422,
      'validation_error',
    );
  });

  it('saves a finished recording as a draft and stops listing it', async () => {
    mockSession.set('u-admin');
    const client = createClient();
    const before = libraryRecordingPageSchema.parse(
      (await client.get('/api/admin/library/recordings')).data,
    );
    const [recording] = before.items;

    const response = await client.post('/api/admin/library/entries', {
      ...newEntry,
      key: undefined,
      videoAssetId: recording?.videoAssetId,
    });
    const after = libraryRecordingPageSchema.parse(
      (await client.get('/api/admin/library/recordings')).data,
    );

    const created = adminLibraryEntrySchema.parse(response.data);
    expect(created.status).toBe('draft');
    expect(created.answerText).toBe(recording?.answerText);
    expect(after.total).toBe(before.total - 1);
  });

  it('edits the labels of a ready entry but not its answer text', async () => {
    mockSession.set('u-admin');
    const client = createClient();
    const [ready] = (await entries(client, { status: 'ready' })).items;

    const edited = await client.patch(
      `/api/admin/library/entries/${ready?.id}`,
      {
        question: 'پرسش اصلاح‌شده',
      },
    );

    expect(adminLibraryEntrySchema.parse(edited.data).question).toBe(
      'پرسش اصلاح‌شده',
    );
    await expectError(
      client.patch(`/api/admin/library/entries/${ready?.id}`, {
        answerText: 'متن دیگر',
      }),
      409,
      'invalid_status_transition',
    );
  });

  it('refuses a status change whose fromStatus is not the current status', async () => {
    mockSession.set('u-admin');
    const client = createClient();
    const [draft] = (await entries(client, { status: 'draft' })).items;
    const url = `/api/admin/library/entries/${draft?.id}/status`;

    await expectError(
      client.patch(url, { status: 'ready', fromStatus: 'pending' }),
      409,
      'invalid_status_transition',
    );
    const [unchanged] = (await entries(client, { status: 'draft' })).items;
    const published = await client.patch(url, {
      status: 'published',
      fromStatus: 'draft',
    });

    expect(unchanged?.id).toBe(draft?.id);
    expect(unchanged?.videoAssetId).toBe(draft?.videoAssetId);
    expect(adminLibraryEntrySchema.parse(published.data).status).toBe(
      'published',
    );
  });

  it('moves an entry along the transition table and refuses the rest', async () => {
    mockSession.set('u-admin');
    const client = createClient();
    const [pending] = (await entries(client, { status: 'pending' })).items;
    const [draft] = (await entries(client, { status: 'draft' })).items;
    const [ready] = (await entries(client, { status: 'ready' })).items;
    const status = (id: string | undefined, body: object) =>
      client.patch(`/api/admin/library/entries/${id}/status`, body);

    await expectError(
      status(pending?.id, { status: 'draft' }),
      409,
      'invalid_status_transition',
    );
    await expectError(status(ready?.id, { status: 'draft' }), 422);
    const published = await status(draft?.id, { status: 'published' });
    const withdrawn = await status(draft?.id, { status: 'withdrawn' });

    expect(adminLibraryEntrySchema.parse(published.data).status).toBe(
      'published',
    );
    expect(adminLibraryEntrySchema.parse(withdrawn.data).withdrawnAt).not.toBe(
      null,
    );
    await expectError(
      status(draft?.id, { status: 'draft' }),
      409,
      'invalid_status_transition',
    );
    await expectError(status('no-such-entry', { status: 'withdrawn' }), 404);
  });

  it('shows a published entry to users and hides it once unpublished', async () => {
    mockSession.set('u-admin');
    const client = createClient();
    const [draft] = (await entries(client, { status: 'draft' })).items;
    await client.patch(`/api/admin/library/entries/${draft?.id}/status`, {
      status: 'published',
    });
    mockSession.set('u-user');
    const withDraft = await suggestions();

    mockSession.set('u-admin');
    await client.patch(`/api/admin/library/entries/${draft?.id}/status`, {
      status: 'draft',
    });
    mockSession.set('u-user');

    expect(withDraft.map((item) => item.id)).toContain(draft?.id);
    expect((await suggestions()).map((item) => item.id)).not.toContain(
      draft?.id,
    );
  });
});
