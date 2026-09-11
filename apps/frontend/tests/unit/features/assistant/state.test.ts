import { describe, expect, it } from 'vitest';
import { ApiError } from '@/shared/api';
import {
  ASSISTANT_ERROR_KINDS,
  assistantReducer,
  classifyAssistantError,
  endReasonFromProvider,
  initialAssistantState,
  isAssistantBusy,
  remainingSeconds,
} from '@/features/assistant/state';
import type { AssistantAction } from '@/features/assistant/state';
import type { AssistantSessionInfo } from '@/entities/assistant-session';
import enCommon from '@/i18n/locales/en/common.json';
import faCommon from '@/i18n/locales/fa/common.json';

const sessionInfo: AssistantSessionInfo = {
  id: 'session-1',
  providerSessionId: 'la-1',
  sandbox: true,
  avatarId: 'avatar-1',
  language: 'en',
  requestedLanguage: 'fa',
  maxSessionDurationSeconds: 60,
};

function reduce(actions: AssistantAction[]) {
  return actions.reduce(assistantReducer, initialAssistantState);
}

const connected = (at = 1_000): AssistantAction[] => [
  { type: 'requesting' },
  { type: 'created', session: sessionInfo },
  { type: 'connecting' },
  { type: 'connected', at },
];

describe('assistantReducer', () => {
  it('walks from idle to connected and sets the deadline', () => {
    const state = reduce(connected(10_000));

    expect(state.status).toBe('connected');
    expect(state.session).toEqual(sessionInfo);
    expect(state.endsAt).toBe(10_000 + 60_000);
  });

  it('keeps the session and the transcript when the mode changes', () => {
    const state = reduce([
      ...connected(),
      {
        type: 'transcriptAppended',
        turn: { id: 'e1', speaker: 'avatar', text: 'سلام' },
      },
      { type: 'modeChanged', mode: 'voice' },
    ]);

    expect(state.mode).toBe('voice');
    expect(state.status).toBe('connected');
    expect(state.transcript).toHaveLength(1);
  });

  it('ignores a turn that arrives twice with the same event id', () => {
    const turn = { id: 'e1', speaker: 'user' as const, text: 'سلام' };
    const state = reduce([
      ...connected(),
      { type: 'transcriptAppended', turn },
      { type: 'transcriptAppended', turn },
    ]);

    expect(state.transcript).toHaveLength(1);
  });

  it('clears the previous conversation when a new one starts', () => {
    const state = reduce([
      ...connected(),
      {
        type: 'transcriptAppended',
        turn: { id: 'e1', speaker: 'avatar', text: 'hi' },
      },
      { type: 'ended', reason: 'timeLimit' },
      { type: 'modeChanged', mode: 'voice' },
      { type: 'requesting' },
    ]);

    expect(state.status).toBe('requesting');
    expect(state.transcript).toEqual([]);
    expect(state.session).toBeNull();
    expect(state.endReason).toBeNull();
    // The chosen view survives a restart.
    expect(state.mode).toBe('voice');
  });

  it('ends the conversation on a provider stop and stops the countdown', () => {
    const state = reduce([
      ...connected(),
      { type: 'avatarSpeaking', isSpeaking: true },
      { type: 'ended', reason: 'timeLimit' },
    ]);

    expect(state.status).toBe('ended');
    expect(state.endReason).toBe('timeLimit');
    expect(state.endsAt).toBeNull();
    expect(state.isAvatarSpeaking).toBe(false);
  });

  it('does not replace a failed start with an "ended" message', () => {
    const state = reduce([
      { type: 'requesting' },
      { type: 'failed', error: { kind: 'provider' } },
      { type: 'ended', reason: 'provider' },
    ]);

    expect(state.status).toBe('error');
    expect(state.error).toEqual({ kind: 'provider' });
  });

  it('keeps the conversation running when a control fails', () => {
    const state = reduce([
      ...connected(),
      { type: 'controlFailed', error: { kind: 'micPermission' } },
    ]);

    expect(state.status).toBe('connected');
    expect(state.error).toEqual({ kind: 'micPermission' });
  });

  it('tracks mute, speaking and connection quality', () => {
    const state = reduce([
      ...connected(),
      { type: 'micChanged', isMuted: true },
      { type: 'userSpeaking', isSpeaking: true },
      { type: 'qualityChanged', quality: 'bad' },
      { type: 'streamReady' },
      { type: 'audioBlocked', isBlocked: true },
    ]);

    expect(state).toMatchObject({
      isMicMuted: true,
      isUserSpeaking: true,
      connectionQuality: 'bad',
      isStreamReady: true,
      isAudioBlocked: true,
    });
  });
});

describe('assistant derivations', () => {
  it('counts down and never goes below zero', () => {
    expect(remainingSeconds(null, 0)).toBeNull();
    expect(remainingSeconds(10_000, 5_500)).toBe(5);
    expect(remainingSeconds(10_000, 99_000)).toBe(0);
  });

  it('knows when a start may be pressed', () => {
    expect(isAssistantBusy('idle')).toBe(false);
    expect(isAssistantBusy('ended')).toBe(false);
    expect(isAssistantBusy('error')).toBe(false);
    expect(isAssistantBusy('requesting')).toBe(true);
    expect(isAssistantBusy('connected')).toBe(true);
  });

  it('separates the sandbox time limit from other provider stops', () => {
    expect(endReasonFromProvider('max_session_duration_reached')).toBe(
      'timeLimit',
    );
    expect(endReasonFromProvider('session_timeout')).toBe('timeLimit');
    expect(endReasonFromProvider('agent_error')).toBe('provider');
  });
});

describe('classifyAssistantError', () => {
  it('maps the backend statuses to one message each', () => {
    expect(
      classifyAssistantError(
        new ApiError({
          message: 'no',
          status: 401,
          serverCode: 'unauthorized',
        }),
      ),
    ).toEqual({ kind: 'unauthorized', code: 'unauthorized' });

    expect(
      classifyAssistantError(new ApiError({ message: 'no', status: 403 })),
    ).toMatchObject({ kind: 'forbidden' });

    expect(
      classifyAssistantError(
        new ApiError({
          message: 'slow down',
          status: 429,
          serverCode: 'assistant_rate_limited',
        }),
      ),
    ).toEqual({ kind: 'rateLimited', code: 'assistant_rate_limited' });

    expect(
      classifyAssistantError(
        new ApiError({
          message: 'quota',
          status: 503,
          serverCode: 'liveavatar_quota',
        }),
      ),
    ).toEqual({ kind: 'provider', code: 'liveavatar_quota' });

    expect(
      classifyAssistantError(
        new ApiError({ message: 'offline', isNetworkError: true }),
      ),
    ).toEqual({ kind: 'network' });

    expect(
      classifyAssistantError(
        new ApiError({ message: 'too slow', category: 'TIMEOUT' }),
      ),
    ).toEqual({ kind: 'timeout' });
  });

  it('recognises a blocked or missing microphone', () => {
    expect(
      classifyAssistantError(new DOMException('denied', 'NotAllowedError')),
    ).toEqual({ kind: 'micPermission' });
    expect(
      classifyAssistantError(new DOMException('none', 'NotFoundError')),
    ).toEqual({ kind: 'micUnavailable' });
  });

  it('treats the SDK rejection shape as a provider failure', () => {
    // The LiveAvatar SDK rejects with a plain object, not an Error.
    expect(
      classifyAssistantError({
        status: 401,
        errorCode: 4002,
        message: 'Invalid token',
      }),
    ).toEqual({ kind: 'provider' });
  });

  it('falls back to one generic message', () => {
    expect(classifyAssistantError(new Error('boom'))).toEqual({
      kind: 'unknown',
    });
  });
});

describe('assistant translations', () => {
  it('has an English and a Persian message for every error kind', () => {
    for (const kind of ASSISTANT_ERROR_KINDS) {
      expect(enCommon.assistant.errors).toHaveProperty(kind);
      expect(faCommon.assistant.errors).toHaveProperty(kind);
    }
  });

  it('has the same assistant keys in both languages', () => {
    const keys = (value: object, prefix = ''): string[] =>
      Object.entries(value).flatMap(([key, child]) =>
        typeof child === 'object' && child !== null
          ? keys(child as object, `${prefix}${key}.`)
          : [`${prefix}${key}`],
      );

    expect(keys(faCommon.assistant).sort()).toEqual(
      keys(enCommon.assistant).sort(),
    );
  });
});
