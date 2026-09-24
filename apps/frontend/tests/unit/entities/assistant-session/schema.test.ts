import { describe, expect, it } from 'vitest';
import {
  assistantAnswersReportSchema,
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

describe('assistantAnswersReportSchema', () => {
  it('accepts the documented report result', () => {
    expect(
      assistantAnswersReportSchema.parse({ recorded: 2, duplicates: 1 }),
    ).toEqual({ recorded: 2, duplicates: 1 });
    // A re-sent batch records nothing and is still a success.
    expect(
      assistantAnswersReportSchema.parse({ recorded: 0, duplicates: 3 }),
    ).toEqual({ recorded: 0, duplicates: 3 });
  });

  it.each([
    ['a missing count', { recorded: 1 }],
    ['a negative count', { recorded: -1, duplicates: 0 }],
    ['a fractional count', { recorded: 1.5, duplicates: 0 }],
    ['a count as text', { recorded: '1', duplicates: 0 }],
  ])('rejects %s', (_, result) => {
    expect(() => assistantAnswersReportSchema.parse(result)).toThrow();
  });
});
