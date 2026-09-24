import axios from 'axios';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MOCK_ASSISTANT_AGENT_TYPE,
  installMockApi,
  mockAssistant,
  mockSession,
} from '@/data/mock';
import {
  assistantAnswersReportSchema,
  assistantSessionSchema,
} from '@/entities/assistant-session';
import { isApiError } from '@/shared/api';
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

describe('mock assistant API', () => {
  beforeEach(() => {
    mockSession.clear();
    mockAssistant.agentType = MOCK_ASSISTANT_AGENT_TYPE;
  });

  it('refuses to create a session without a user or an embed key', async () => {
    await expectStatus(createClient().post('/api/assistant/session', {}), 401);
  });

  it('creates a Persian sandbox session for a signed-in user', async () => {
    mockSession.set('u-user');

    const response = await createClient().post('/api/assistant/session', {});
    const session = assistantSessionSchema.parse(response.data);

    // The default provider mode is the voice agent, which speaks Persian.
    expect(session).toMatchObject({
      sessionToken: 'mock-session-token',
      sandbox: true,
      language: 'fa',
      requestedLanguage: 'fa',
      maxSessionDurationSeconds: 60,
      agentType: 'elevenlabs',
    });
  });

  it('ignores the requested language in the voice agent mode', async () => {
    mockSession.set('u-user');

    const response = await createClient().post('/api/assistant/session', {
      language: 'en',
    });

    // LiveAvatar refuses a per-session language for this agent type, so the agent's own wins.
    expect(response.data.language).toBe('fa');
    expect(response.data.requestedLanguage).toBe('en');
  });

  it('falls back from Persian in the FULL mode', async () => {
    mockAssistant.agentType = 'full';
    mockSession.set('u-user');

    const response = await createClient().post('/api/assistant/session', {});
    const session = assistantSessionSchema.parse(response.data);

    // FULL mode only supports "en" today, matching the real provider (verified 2026-09-11:
    // it rejects "fa" at session start).
    expect(session).toMatchObject({
      language: 'en',
      requestedLanguage: 'fa',
      agentType: 'full',
    });
  });

  it('creates a session for the widget with the embed key', async () => {
    mockAssistant.agentType = 'full';

    const response = await createClient().post(
      '/api/assistant/session',
      { language: 'en' },
      { headers: { 'X-Embed-Key': 'mock-embed-key' } },
    );

    expect(response.data.language).toBe('en');
    expect(response.data.requestedLanguage).toBe('en');
  });

  it('rejects a wrong embed key', async () => {
    await expectStatus(
      createClient().post(
        '/api/assistant/session',
        {},
        { headers: { 'X-Embed-Key': 'not-the-key' } },
      ),
      401,
    );
  });

  it('closes a session, twice if needed', async () => {
    mockSession.set('u-user');
    const client = createClient();

    const first = await client.post('/api/assistant/session/abc/close', {});
    const second = await client.post('/api/assistant/session/abc/close', {});

    expect(first.data).toEqual({ status: 'closed' });
    expect(second.data).toEqual({ status: 'closed' });
  });

  it('refuses to close a session for an anonymous caller', async () => {
    await expectStatus(
      createClient().post('/api/assistant/session/abc/close', {}),
      401,
    );
  });
});

async function expectError(
  promise: Promise<unknown>,
  status: number,
  code: string,
) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );

  expect(isApiError(error) ? [error.status, error.code] : error).toEqual([
    status,
    code,
  ]);
}

const ANSWERS_URL = '/api/assistant/session/mock-assistant-session/answers';

function answers(...items: [index: number, durationMs: number][]) {
  return {
    answers: items.map(([index, durationMs]) => ({ index, durationMs })),
  };
}

describe('mock assistant answers API', () => {
  beforeEach(async () => {
    mockSession.clear();
    mockSession.set('u-user');
    // Every test starts with a fresh session, which forgets the answers of the last one.
    await createClient().post('/api/assistant/session', {});
  });

  it('refuses an anonymous caller', async () => {
    mockSession.clear();

    await expectStatus(
      createClient().post(ANSWERS_URL, answers([0, 1000])),
      401,
    );
  });

  it('records the answers of a signed-in user', async () => {
    const response = await createClient().post(
      ANSWERS_URL,
      answers([0, 4200], [1, 1800]),
    );

    expect(assistantAnswersReportSchema.parse(response.data)).toEqual({
      recorded: 2,
      duplicates: 0,
    });
  });

  it('records the answers of the widget', async () => {
    mockSession.clear();

    const response = await createClient().post(
      ANSWERS_URL,
      answers([0, 1000]),
      {
        headers: { 'X-Embed-Key': 'mock-embed-key' },
      },
    );

    expect(response.data).toEqual({ recorded: 1, duplicates: 0 });
  });

  it('counts a repeated index once', async () => {
    const client = createClient();

    const first = await client.post(ANSWERS_URL, answers([0, 1000], [0, 2000]));
    const again = await client.post(ANSWERS_URL, answers([0, 1000], [1, 1000]));

    expect(first.data).toEqual({ recorded: 1, duplicates: 1 });
    expect(again.data).toEqual({ recorded: 1, duplicates: 1 });
  });

  it.each([
    ['a zero duration', answers([0, 0])],
    ['a fractional duration', answers([0, 1.5])],
    ['a duration as text', { answers: [{ index: 0, durationMs: '5' }] }],
    ['a negative index', answers([-1, 1000])],
    [
      'text in an answer',
      { answers: [{ index: 0, durationMs: 1000, text: 'hi' }] },
    ],
    ['an unknown top-level key', { ...answers([0, 1000]), transcript: 'hi' }],
    ['no answers', { answers: [] }],
    [
      'twenty-one answers',
      answers(
        ...Array.from({ length: 21 }, (_, i): [number, number] => [i, 100]),
      ),
    ],
    ['an answer longer than the 60 s session', answers([0, 60_001])],
  ])('refuses %s', async (_, body) => {
    await expectError(
      createClient().post(ANSWERS_URL, body),
      422,
      'validation_error',
    );
  });

  it('does not know any other session', async () => {
    await expectError(
      createClient().post(
        '/api/assistant/session/abc/answers',
        answers([0, 1000]),
      ),
      404,
      'not_found',
    );
  });

  it('refuses answers after the session closed, until a new one starts', async () => {
    const client = createClient();
    await client.post(
      '/api/assistant/session/mock-assistant-session/close',
      {},
    );

    await expectError(
      client.post(ANSWERS_URL, answers([0, 1000])),
      409,
      'assistant_session_closed',
    );

    await client.post('/api/assistant/session', {});
    expect((await client.post(ANSWERS_URL, answers([0, 1000]))).data).toEqual({
      recorded: 1,
      duplicates: 0,
    });
  });

  it('refuses answers that add up to more than the session', async () => {
    const client = createClient();
    await client.post(ANSWERS_URL, answers([0, 40_000]));

    await expectError(
      client.post(ANSWERS_URL, answers([1, 20_001])),
      409,
      'assistant_answers_limit',
    );
    // Exactly the session length still fits.
    expect((await client.post(ANSWERS_URL, answers([1, 20_000]))).data).toEqual(
      {
        recorded: 1,
        duplicates: 0,
      },
    );
  });
});
