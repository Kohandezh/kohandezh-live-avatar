import { act, renderHook } from '@testing-library/react';
import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real SDK talks to LiveAvatar over WebRTC. Tests drive a fake with the same events.
vi.mock('@heygen/liveavatar-web-sdk', async () => {
  const mock = await import('../utils/liveAvatarSdkMock');
  return mock.createLiveAvatarSdkMockModule();
});

import {
  MOCK_ASSISTANT_AGENT_TYPE,
  installMockApi,
  mockAssistant,
  mockSession,
} from '@/data/mock';
import { useAssistantSession } from '@/features/assistant';
import { apiClient } from '@/shared/api';
import {
  AgentEventsEnum,
  AgentType,
  lastFakeSession,
  resetLiveAvatarSdkMock,
  sdkState,
} from '../utils/liveAvatarSdkMock';
import { providersWrapper } from '../utils/renderWithProviders';

/** The id the mock backend gives every assistant session it creates. */
const SESSION_ID = 'mock-assistant-session';
const ANSWERS_URL = `/api/assistant/session/${SESSION_ID}/answers`;
const CLOSE_URL = `/api/assistant/session/${SESSION_ID}/close`;

type Answer = { index: number; durationMs: number };

/** What a test can make the answers route do instead of the mock backend, once per request. */
type InjectedOutcome =
  | { status: number; code: string; details?: unknown }
  | 'network';

const log: string[] = [];
const answerBodies: Answer[][] = [];
const injected: InjectedOutcome[] = [];

function errorFor(
  config: InternalAxiosRequestConfig,
  outcome: InjectedOutcome,
): AxiosError {
  if (outcome === 'network') {
    return new AxiosError('Network Error', AxiosError.ERR_NETWORK, config);
  }
  const response: AxiosResponse = {
    data: {
      error: { code: outcome.code, message: outcome.code, details: outcome.details ?? null },
      correlation_id: 'corr-test',
    },
    status: outcome.status,
    statusText: outcome.code,
    headers: {},
    config,
  };
  return new AxiosError(
    outcome.code,
    outcome.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
    config,
    undefined,
    response,
  );
}

/**
 * The mock adapter plus a log of when each request started and finished, so a test can prove the
 * order of `answers` and `close`, and a queue of failures to answer the `answers` route with.
 */
function installRecordingMockApi() {
  log.length = 0;
  answerBodies.length = 0;
  injected.length = 0;
  installMockApi(apiClient, { delayMs: 0 });
  const inner = apiClient.defaults.adapter as AxiosAdapter;
  apiClient.defaults.adapter = async (config) => {
    const name = `${config.method?.toUpperCase()} ${config.url}`;
    log.push(`start ${name}`);
    try {
      if (config.url === ANSWERS_URL) {
        const body = JSON.parse(String(config.data)) as { answers: Answer[] };
        answerBodies.push(body.answers);
        const outcome = injected.shift();
        if (outcome) throw errorFor(config, outcome);
      }
      return await inner(config);
    } finally {
      log.push(`end ${name}`);
    }
  };
}

function answerRequestCount(): number {
  return log.filter((entry) => entry === `start POST ${ANSWERS_URL}`).length;
}

/** Moves the fake clock (timers and `performance.now()`) and lets the promises settle. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function emit(event: string, payload?: unknown) {
  act(() => lastFakeSession().emit(event, payload));
}

/** One avatar speech segment of `ms` milliseconds by the fake clock. */
async function speak(ms: number) {
  emit(AgentEventsEnum.AVATAR_SPEAK_STARTED);
  await advance(ms);
  emit(AgentEventsEnum.AVATAR_SPEAK_ENDED);
}

async function renderStartedSession() {
  const hook = renderHook(() => useAssistantSession(), {
    wrapper: providersWrapper().Wrapper,
  });
  await act(async () => {
    await hook.result.current.start();
  });
  expect(hook.result.current.status).toBe('connected');
  return hook;
}

describe('useAssistantSession reports avatar answers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetLiveAvatarSdkMock();
    installRecordingMockApi();
    mockAssistant.agentType = MOCK_ASSISTANT_AGENT_TYPE;
    mockSession.set('u-user');
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => true,
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends two measured segments in one request for the backend session id (criterion 1)', async () => {
    await renderStartedSession();
    log.length = 0;

    await speak(4200);
    await speak(1800);
    await advance(1000);

    expect(answerBodies).toEqual([
      [
        { index: 0, durationMs: 4200 },
        { index: 1, durationMs: 1800 },
      ],
    ]);
    // The backend id, never the provider session id, and nothing else was sent.
    expect(log).toEqual([`start POST ${ANSWERS_URL}`, `end POST ${ANSWERS_URL}`]);
  });

  it('does not send on the first segment end of a synchronous burst', async () => {
    await renderStartedSession();

    act(() => {
      const session = lastFakeSession();
      session.emit(AgentEventsEnum.AVATAR_SPEAK_STARTED);
      vi.advanceTimersByTime(700);
      session.emit(AgentEventsEnum.AVATAR_SPEAK_ENDED);
      session.emit(AgentEventsEnum.AVATAR_SPEAK_STARTED);
      vi.advanceTimersByTime(300);
      session.emit(AgentEventsEnum.AVATAR_SPEAK_ENDED);
    });
    expect(answerRequestCount()).toBe(0);

    await advance(600);
    expect(answerBodies).toEqual([
      [
        { index: 0, durationMs: 700 },
        { index: 1, durationMs: 300 },
      ],
    ]);
  });

  it('flushes a segment still open at End before the close request starts (criterion 2)', async () => {
    const { result } = await renderStartedSession();
    log.length = 0;

    emit(AgentEventsEnum.AVATAR_SPEAK_STARTED);
    await advance(3000);
    await act(async () => {
      await result.current.stop();
    });

    expect(answerBodies).toEqual([[{ index: 0, durationMs: 3000 }]]);
    expect(log).toEqual([
      `start POST ${ANSWERS_URL}`,
      `end POST ${ANSWERS_URL}`,
      `start POST ${CLOSE_URL}`,
      `end POST ${CLOSE_URL}`,
    ]);
    expect(result.current.status).toBe('ended');
    expect(result.current.endReason).toBe('user');
  });

  it('holds an answer for at most 2 s while the avatar keeps talking', async () => {
    await renderStartedSession();

    await speak(1000);
    emit(AgentEventsEnum.AVATAR_SPEAK_STARTED);
    await advance(1900);
    expect(answerRequestCount()).toBe(0);
    await advance(200);
    expect(answerBodies).toEqual([[{ index: 0, durationMs: 1000 }]]);

    await advance(3000);
    emit(AgentEventsEnum.AVATAR_SPEAK_ENDED);
    await advance(600);
    expect(answerBodies.at(-1)).toEqual([{ index: 1, durationMs: 5100 }]);
  });

  it('drops a 0 ms segment without spending an index, and sends a 1 ms one (criterion 3)', async () => {
    await renderStartedSession();

    await speak(0);
    await speak(1);
    await advance(1000);

    expect(answerBodies).toEqual([[{ index: 0, durationMs: 1 }]]);
  });

  it('clamps a segment longer than the session to its length (criterion 3)', async () => {
    await renderStartedSession();

    await speak(61_000);
    await advance(1000);

    expect(answerBodies).toEqual([[{ index: 0, durationMs: 60_000 }]]);
  });

  it('sends a segment exactly as long as the session as it is (criterion 3 control)', async () => {
    await renderStartedSession();

    await speak(60_000);
    await advance(1000);

    expect(answerBodies).toEqual([[{ index: 0, durationMs: 60_000 }]]);
  });

  it('adds nothing for an end with no open segment', async () => {
    await renderStartedSession();

    emit(AgentEventsEnum.AVATAR_SPEAK_ENDED);
    await advance(3000);

    expect(answerRequestCount()).toBe(0);
  });

  it('sends 21 segments as 20 items and then 1, indexes 0 to 20 in order (criterion 4)', async () => {
    const { result } = await renderStartedSession();

    for (let segment = 0; segment < 21; segment += 1) await speak(100);
    await advance(1000);

    expect(answerBodies.map((body) => body.length)).toEqual([20, 1]);
    expect(answerBodies.flat().map((answer) => answer.index)).toEqual(
      Array.from({ length: 21 }, (_, index) => index),
    );

    log.length = 0;
    await act(async () => {
      await result.current.stop();
    });
    expect(log).toEqual([`start POST ${CLOSE_URL}`, `end POST ${CLOSE_URL}`]);
  });

  it('retries a 429 once after retryAfterSeconds with the same items (criterion 5)', async () => {
    await renderStartedSession();
    injected.push({
      status: 429,
      code: 'assistant_answers_busy',
      details: { retryAfterSeconds: 2 },
    });

    // The flush runs 500 ms after the end, so the retry is due 2 s later, at 2500 ms.
    await speak(4200);
    await advance(600);
    expect(answerRequestCount()).toBe(1);

    await advance(1800);
    expect(answerRequestCount()).toBe(1);
    await advance(200);
    expect(answerRequestCount()).toBe(2);
    expect(answerBodies).toEqual([
      [{ index: 0, durationMs: 4200 }],
      [{ index: 0, durationMs: 4200 }],
    ]);
  });

  it('drops a batch after a second 429', async () => {
    await renderStartedSession();
    injected.push(
      { status: 429, code: 'assistant_answers_rate_limited', details: { retryAfterSeconds: 2 } },
      { status: 429, code: 'assistant_answers_rate_limited', details: { retryAfterSeconds: 2 } },
    );

    await speak(4200);
    await advance(10_000);
    expect(answerRequestCount()).toBe(2);

    // A later segment still goes out, and the dropped one is not sent again.
    await speak(1000);
    await advance(1000);
    expect(answerBodies.at(-1)).toEqual([{ index: 1, durationMs: 1000 }]);
    expect(answerRequestCount()).toBe(3);
  });

  it('falls back to 2 s when a 429 carries no retryAfterSeconds', async () => {
    await renderStartedSession();
    injected.push({ status: 429, code: 'assistant_answers_busy' });

    await speak(1000);
    await advance(2400);
    expect(answerRequestCount()).toBe(1);
    await advance(200);
    expect(answerRequestCount()).toBe(2);
  });

  it('does not retry a 409 assistant_session_closed (criterion 5)', async () => {
    await renderStartedSession();
    injected.push({ status: 409, code: 'assistant_session_closed' });

    await speak(4200);
    await advance(10_000);

    expect(answerRequestCount()).toBe(1);
  });

  it.each([
    [404, 'not_found'],
    [401, 'unauthorized'],
    [403, 'embed_origin_not_allowed'],
    [422, 'validation_error'],
    [409, 'assistant_answers_limit'],
  ])('does not retry a %i %s', async (status, code) => {
    await renderStartedSession();
    injected.push({ status, code });

    await speak(1000);
    await advance(10_000);

    expect(answerRequestCount()).toBe(1);
  });

  it('retries a network error once after 1 s (criterion 5)', async () => {
    await renderStartedSession();
    injected.push('network');

    await speak(4200);
    // The flush runs 500 ms after the end, so the retry is due 1 s later, at 1500 ms.
    await advance(600);
    expect(answerRequestCount()).toBe(1);
    await advance(800);
    expect(answerRequestCount()).toBe(1);
    await advance(200);
    expect(answerRequestCount()).toBe(2);
    expect(answerBodies[1]).toEqual([{ index: 0, durationMs: 4200 }]);
  });

  it('retries a 5xx once after 1 s, then drops it', async () => {
    await renderStartedSession();
    injected.push(
      { status: 503, code: 'unavailable' },
      { status: 500, code: 'internal_error' },
    );

    await speak(4200);
    await advance(10_000);

    expect(answerRequestCount()).toBe(2);
  });

  it('gives the pre-close flush one attempt and no retry', async () => {
    const { result } = await renderStartedSession();
    injected.push('network');
    log.length = 0;

    emit(AgentEventsEnum.AVATAR_SPEAK_STARTED);
    await advance(2000);
    await act(async () => {
      await result.current.stop();
    });
    await advance(5000);

    expect(log).toEqual([
      `start POST ${ANSWERS_URL}`,
      `end POST ${ANSWERS_URL}`,
      `start POST ${CLOSE_URL}`,
      `end POST ${CLOSE_URL}`,
    ]);
  });

  it('keeps every report outcome out of the hook state (criterion 6)', async () => {
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(
      (method) => vi.spyOn(console, method),
    );
    const { result } = await renderStartedSession();
    emit(AgentEventsEnum.AVATAR_TRANSCRIPTION, {
      event_id: 'avatar-1',
      text: 'Hello there.',
    });
    const snapshot = () => ({
      status: result.current.status,
      transcript: result.current.transcript,
      error: result.current.error,
      endReason: result.current.endReason,
      isAvatarSpeaking: result.current.isAvatarSpeaking,
    });
    const before = snapshot();

    injected.push(
      { status: 409, code: 'assistant_session_closed' },
      { status: 422, code: 'validation_error' },
      'network',
      'network',
    );
    await speak(1000);
    await advance(1000);
    await speak(1000);
    await advance(1000);
    await speak(1000);
    await advance(5000);

    expect(answerRequestCount()).toBe(4);
    expect(snapshot()).toEqual(before);
    expect(result.current.status).toBe('connected');
    expect(result.current.error).toBeNull();
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });

  it('starts the index at 0 again for a new session (criterion 7)', async () => {
    const { result } = await renderStartedSession();
    await speak(1000);
    await speak(1000);
    await act(async () => {
      await result.current.stop();
    });

    await act(async () => {
      await result.current.start();
    });
    await speak(2500);
    await advance(1000);

    expect(answerBodies).toEqual([
      [
        { index: 0, durationMs: 1000 },
        { index: 1, durationMs: 1000 },
      ],
      [{ index: 0, durationMs: 2500 }],
    ]);
  });

  it('closes an open segment on the ElevenLabs interruption event (criterion 8)', async () => {
    sdkState.agentType = AgentType.ELEVENLABS_AGENT;
    mockAssistant.agentType = 'elevenlabs';
    await renderStartedSession();

    emit(AgentEventsEnum.AVATAR_SPEAK_STARTED);
    await advance(2500);
    act(() => lastFakeSession().emitElevenLabsEvent('interruption', {}));
    await advance(3000);
    // The late end the provider may still send adds nothing.
    emit(AgentEventsEnum.AVATAR_SPEAK_ENDED);
    await advance(1000);

    expect(answerBodies).toEqual([[{ index: 0, durationMs: 2500 }]]);
  });

  it('closes an open segment on SESSION_STOPPED and still reports the provider end (criterion 8)', async () => {
    const { result } = await renderStartedSession();
    log.length = 0;

    emit(AgentEventsEnum.AVATAR_SPEAK_STARTED);
    await advance(1500);
    emit(AgentEventsEnum.SESSION_STOPPED, { stop_reason: 'time_limit_reached' });
    await advance(1000);

    expect(answerBodies).toEqual([[{ index: 0, durationMs: 1500 }]]);
    expect(log).toEqual([
      `start POST ${ANSWERS_URL}`,
      `end POST ${ANSWERS_URL}`,
      `start POST ${CLOSE_URL}`,
      `end POST ${CLOSE_URL}`,
    ]);
    expect(result.current.status).toBe('ended');
    expect(result.current.endReason).not.toBe('user');
  });

  it('closes an open segment when the next one starts', async () => {
    await renderStartedSession();

    emit(AgentEventsEnum.AVATAR_SPEAK_STARTED);
    await advance(1200);
    await speak(800);
    await advance(1000);

    expect(answerBodies).toEqual([
      [
        { index: 0, durationMs: 1200 },
        { index: 1, durationMs: 800 },
      ],
    ]);
  });

  it('flushes before close when the screen unmounts', async () => {
    const { unmount } = await renderStartedSession();
    log.length = 0;

    emit(AgentEventsEnum.AVATAR_SPEAK_STARTED);
    await advance(900);
    unmount();
    await advance(0);

    expect(log).toEqual([
      `start POST ${ANSWERS_URL}`,
      `end POST ${ANSWERS_URL}`,
      `start POST ${CLOSE_URL}`,
      `end POST ${CLOSE_URL}`,
    ]);
  });
});
