import { describe, expect, it } from 'vitest';
import { ApiError } from '@/shared/api';
import {
  ASSISTANT_ERROR_KINDS,
  assistantReducer,
  classifyAssistantError,
  elevenLabsEventActions,
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
  agentType: 'full',
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

  it('ends a conversation the user cancelled while it was still starting', () => {
    // The user presses End on the "preparing" screen. Before `requesting` was a live
    // status the reducer dropped both actions and the screen stayed on `requesting`
    // for ever, with `canStart` false and no way out.
    const state = reduce([
      { type: 'requesting' },
      { type: 'ending' },
      { type: 'ended', reason: 'user' },
    ]);

    expect(state.status).toBe('ended');
    expect(state.endReason).toBe('user');
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

  it('ignores a sentence that repeats the previous turn of the same speaker', () => {
    // The real run sent the opening line twice, with two different event ids.
    const state = reduce([
      ...connected(),
      {
        type: 'transcriptAppended',
        turn: { id: 'a1', speaker: 'avatar', text: 'سلام، چطور کمک کنم؟' },
      },
      {
        type: 'transcriptAppended',
        turn: { id: 'a2', speaker: 'avatar', text: '  سلام، چطور   کمک کنم؟ ' },
      },
    ]);

    expect(state.transcript).toHaveLength(1);
  });

  it('compares a turn with the previous turn of the same speaker only', () => {
    // The same words from the two speakers are two real turns.
    const state = reduce([
      ...connected(),
      {
        type: 'transcriptAppended',
        turn: { id: 'a1', speaker: 'avatar', text: 'بله' },
      },
      {
        type: 'transcriptAppended',
        turn: { id: 'u1', speaker: 'user', text: 'بله' },
      },
      // The late copy of the avatar line is still dropped, even with a turn in between,
      // because the provider can deliver it after the next transcription.
      {
        type: 'transcriptAppended',
        turn: { id: 'a2', speaker: 'avatar', text: 'بله' },
      },
    ]);

    expect(state.transcript.map((turn) => turn.id)).toEqual(['a1', 'u1']);
  });

  it('rewrites the answer the agent corrected', () => {
    const state = reduce([
      ...connected(),
      {
        type: 'transcriptAppended',
        turn: { id: 'a1', speaker: 'avatar', text: 'دو هزار تومان' },
      },
      {
        type: 'transcriptCorrected',
        original: 'دو هزار تومان',
        corrected: 'سه هزار تومان',
      },
    ]);

    expect(state.transcript).toEqual([
      { id: 'a1', speaker: 'avatar', text: 'سه هزار تومان' },
    ]);
  });

  it('leaves the transcript alone when the corrected answer is unknown', () => {
    const state = reduce([
      ...connected(),
      {
        type: 'transcriptAppended',
        turn: { id: 'a1', speaker: 'avatar', text: 'بله' },
      },
      { type: 'transcriptCorrected', original: 'چیز دیگری', corrected: 'خیر' },
    ]);

    expect(state.transcript[0].text).toBe('بله');
  });

  it('connects on the ready stream, before the SDK reports the state', () => {
    // `start()` resolves late in FULL mode, so the stream is what proves the call is live.
    const state = reduce([
      { type: 'requesting' },
      { type: 'created', session: sessionInfo },
      { type: 'connecting' },
      { type: 'streamReady' },
      { type: 'connected', at: 10_000 },
      // The SDK state change arrives later and must not move the deadline.
      { type: 'connected', at: 25_000 },
    ]);

    expect(state.status).toBe('connected');
    expect(state.isStreamReady).toBe(true);
    expect(state.endsAt).toBe(10_000 + 60_000);
  });

  it('does not connect a conversation that already ended', () => {
    const state = reduce([
      ...connected(),
      { type: 'ended', reason: 'user' },
      { type: 'connected', at: 90_000 },
    ]);

    expect(state.status).toBe('ended');
  });

  it('clears a warning once the control works again', () => {
    const state = reduce([
      ...connected(),
      { type: 'controlFailed', error: { kind: 'micPermission' } },
      { type: 'controlRecovered' },
    ]);

    expect(state.error).toBeNull();
    expect(state.status).toBe('connected');
  });

  it('keeps a failed start visible when a control recovers', () => {
    const state = reduce([
      { type: 'requesting' },
      { type: 'failed', error: { kind: 'provider' } },
      { type: 'controlRecovered' },
    ]);

    expect(state.error).toEqual({ kind: 'provider' });
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

describe('elevenLabsEventActions', () => {
  const event = (
    elevenLabsEventType: string,
    data: Record<string, unknown>,
  ) => ({
    event_id: 'el-1',
    elevenlabs_event_type: elevenLabsEventType,
    data,
  });

  it('maps a user transcript to a user turn', () => {
    expect(
      elevenLabsEventActions(
        event('user_transcript', {
          user_transcription_event: { user_transcript: ' سلام ' },
        }),
      ),
    ).toEqual([
      {
        type: 'transcriptAppended',
        turn: { id: 'el-1', speaker: 'user', text: 'سلام' },
      },
    ]);
  });

  it('maps an agent response to an avatar turn', () => {
    expect(
      elevenLabsEventActions(
        event('agent_response', {
          agent_response_event: { agent_response: 'بله' },
        }),
      ),
    ).toEqual([
      {
        type: 'transcriptAppended',
        turn: { id: 'el-1', speaker: 'avatar', text: 'بله' },
      },
    ]);
  });

  it('maps a correction to a rewrite of the answer it corrects', () => {
    expect(
      elevenLabsEventActions(
        event('agent_response_correction', {
          agent_response_correction_event: {
            original_agent_response: 'بله',
            corrected_agent_response: 'خیر',
          },
        }),
      ),
    ).toEqual([{ type: 'transcriptCorrected', original: 'بله', corrected: 'خیر' }]);
  });

  it('stops the speaking state on an interruption', () => {
    expect(elevenLabsEventActions(event('interruption', {}))).toEqual([
      { type: 'avatarSpeaking', isSpeaking: false },
    ]);
  });

  it('ignores the events the UI does not use', () => {
    expect(elevenLabsEventActions(event('ping', { ping_event: {} }))).toEqual(
      [],
    );
    expect(
      elevenLabsEventActions(event('audio', { audio_event: { audio_base_64: 'x' } })),
    ).toEqual([]);
    expect(elevenLabsEventActions(event('something_new', {}))).toEqual([]);
  });

  it('drops an empty or malformed payload instead of adding a blank turn', () => {
    expect(
      elevenLabsEventActions(
        event('user_transcript', { user_transcription_event: {} }),
      ),
    ).toEqual([]);
    expect(
      elevenLabsEventActions(
        event('agent_response', { agent_response_event: { agent_response: 7 } }),
      ),
    ).toEqual([]);
    expect(elevenLabsEventActions(event('agent_response', {}))).toEqual([]);
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
