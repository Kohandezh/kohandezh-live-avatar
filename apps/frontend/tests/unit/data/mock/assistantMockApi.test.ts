import axios from 'axios';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MOCK_ASSISTANT_AGENT_TYPE,
  installMockApi,
  mockAssistant,
  mockSession,
} from '@/data/mock';
import { assistantSessionSchema } from '@/entities/assistant-session';
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
