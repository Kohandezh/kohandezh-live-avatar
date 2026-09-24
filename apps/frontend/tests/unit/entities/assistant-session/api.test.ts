import type { InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { reportAssistantAnswers } from '@/entities/assistant-session';
import { apiClient } from '@/shared/api';

describe('reportAssistantAnswers', () => {
  const realAdapter = apiClient.defaults.adapter;
  let sent: InternalAxiosRequestConfig | undefined;
  let reply: unknown;

  beforeEach(() => {
    sent = undefined;
    reply = { recorded: 2, duplicates: 0 };
    apiClient.defaults.adapter = async (config) => {
      sent = config;
      return {
        data: reply,
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    };
  });

  afterEach(() => {
    apiClient.defaults.adapter = realAdapter;
  });

  it('posts the measured answers of one session and parses the result', async () => {
    const body = {
      answers: [
        { index: 0, durationMs: 4200 },
        { index: 1, durationMs: 1800 },
      ],
    };

    const result = await reportAssistantAnswers('session/1', body);

    expect(result).toEqual({ recorded: 2, duplicates: 0 });
    expect(sent?.method).toBe('post');
    // The id is a path segment, so it is encoded like the close call does.
    expect(sent?.url).toBe('/api/assistant/session/session%2F1/answers');
    // Metadata must not hold anything up: it gives up after 10 s.
    expect(sent?.timeout).toBe(10_000);
    expect(JSON.parse(String(sent?.data))).toEqual(body);
  });

  it('rejects a response that does not match the contract', async () => {
    reply = { recorded: 1 };

    await expect(
      reportAssistantAnswers('session-1', {
        answers: [{ index: 0, durationMs: 1000 }],
      }),
    ).rejects.toThrow();
  });
});
