import { describe, expect, it } from 'vitest';
import {
  assistantSessionCloseSchema,
  assistantSessionSchema,
  toAssistantSessionInfo,
} from '@/entities/assistant-session';

const response = {
  id: '4b9a-session',
  sessionToken: 'provider-token',
  providerSessionId: 'la-session-1',
  sandbox: true,
  avatarId: 'dd73ea75-1218-4ef3-92ce-606d5f7fbc0a',
  language: 'en',
  requestedLanguage: 'fa',
  maxSessionDurationSeconds: 60,
  agentType: 'elevenlabs',
};

describe('assistantSessionSchema', () => {
  it('accepts the documented response', () => {
    expect(assistantSessionSchema.parse(response)).toEqual(response);
  });

  it('rejects a response without a session token', () => {
    expect(() =>
      assistantSessionSchema.parse({ ...response, sessionToken: '' }),
    ).toThrow();
  });

  it('rejects an unknown agent type', () => {
    expect(() =>
      assistantSessionSchema.parse({ ...response, agentType: 'openai' }),
    ).toThrow();
  });

  it('rejects an unsupported language', () => {
    expect(() =>
      assistantSessionSchema.parse({ ...response, language: 'de' }),
    ).toThrow();
  });

  it('rejects a non-positive session duration', () => {
    expect(() =>
      assistantSessionSchema.parse({
        ...response,
        maxSessionDurationSeconds: 0,
      }),
    ).toThrow();
  });

  it('drops the provider token when the UI keeps the session', () => {
    const info = toAssistantSessionInfo(assistantSessionSchema.parse(response));

    expect(info).not.toHaveProperty('sessionToken');
    expect(JSON.stringify(info)).not.toContain('provider-token');
    expect(info.maxSessionDurationSeconds).toBe(60);
    // The panel needs it to pick the session class and the language notice.
    expect(info.agentType).toBe('elevenlabs');
  });

  it('accepts only the documented close result', () => {
    expect(assistantSessionCloseSchema.parse({ status: 'closed' })).toEqual({
      status: 'closed',
    });
    expect(() =>
      assistantSessionCloseSchema.parse({ status: 'open' }),
    ).toThrow();
  });
});
