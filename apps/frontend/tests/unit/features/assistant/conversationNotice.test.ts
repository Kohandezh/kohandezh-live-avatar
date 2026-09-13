import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pickNotice,
  useConversationNotice,
  type ConversationNoticeInput,
  type NoticeContext,
} from '@/features/assistant/controls';

/**
 * The `/audio` notice line is the single slot that five different messages compete for.
 * Before the redesign each of them was its own chip or its own alert, appearing and
 * disappearing on its own schedule; now one of them wins and the rest wait.
 *
 * The order matters more than it looks, so it is tested here rather than left to a reviewer
 * reading a chain of `if`s. `pickNotice` is pure for exactly this reason: the priority can be
 * checked without rendering a screen or faking a session.
 *
 * `translate` returns the key. The test asserts which message won, not how it is worded.
 */

const RESTING = 'assistant.agentLanguage';

const base: ConversationNoticeInput = {
  status: 'connected',
  online: true,
  isStreaming: true,
  isAudioBlocked: false,
  error: null,
  connectionQuality: 'good',
  isTimeWarning: false,
  restingText: RESTING,
};

const context: NoticeContext = {
  translate: (key) => key,
  showBadConnection: false,
  blockedReasonKey: null,
  isRestingSilent: false,
  language: 'en',
};

function notice(
  input: Partial<ConversationNoticeInput> = {},
  extra: Partial<NoticeContext> = {},
) {
  return pickNotice({ ...base, ...input }, { ...context, ...extra });
}

describe('the /audio notice line', () => {
  it('rests on the sentence that says which language the agent speaks', () => {
    expect(notice().text).toBe(RESTING);
  });

  it('puts offline above everything else, a denied microphone included', () => {
    // The reason this ranking exists: a denied microphone stays in `state.error` for the rest
    // of the session, so with the other order a user who denied the microphone and then lost
    // the network would never be told the network was gone. The shell's offline banner is
    // hidden on this route, so this line is the only place that news can appear.
    const result = notice({
      online: false,
      error: { kind: 'micPermission' },
      isAudioBlocked: true,
    });

    expect(result.text).toBe('assistant.offline');
  });

  it('offers the blocked-audio message with the hint that the orb is the button', () => {
    const result = notice({ isAudioBlocked: true });

    expect(result.text).toBe('assistant.video.audioBlocked');
    expect(result.hint).toBe('assistant.voice.audioBlockedHint');
  });

  it('says nothing about blocked audio before the media is flowing', () => {
    expect(notice({ isAudioBlocked: true, isStreaming: false }).text).toBe(
      RESTING,
    );
  });

  it('raises only a denied microphone to an assertive announcement', () => {
    expect(notice({ error: { kind: 'micPermission' } })).toMatchObject({
      text: 'assistant.errors.micPermission',
      isAlert: true,
    });
    expect(notice({ error: { kind: 'provider' } })).toMatchObject({
      text: 'assistant.errors.provider',
      isAlert: false,
    });
  });

  it('leaves a failed start to the error card instead of repeating it', () => {
    expect(
      notice({ status: 'error', error: { kind: 'unknown' } }).text,
    ).toBe(RESTING);
  });

  it('ranks a weak connection below a control error and above the time warning', () => {
    expect(
      notice({ error: { kind: 'provider' }, isTimeWarning: true }, { showBadConnection: true })
        .text,
    ).toBe('assistant.errors.provider');

    expect(
      notice({ isTimeWarning: true }, { showBadConnection: true }).text,
    ).toBe('assistant.quality.bad');
  });

  it('warns about the time without a number that rewrites itself every second', () => {
    const result = notice({ isTimeWarning: true });

    expect(result.text).toBe('assistant.voice.timeWarning');
    // The sentence is fixed for the whole warning window. A ticking value inside a live
    // region would be read out on every tick.
    expect(result.tone).toBe('warning');
  });

  it('shows the reason a refused press was refused, but not over real news', () => {
    const reason = 'assistant.controls.reasons.avatarNotSpeaking';

    expect(notice({}, { blockedReasonKey: reason }).text).toBe(reason);
    // Anything higher up is already the reason, or is more important than it.
    expect(notice({ online: false }, { blockedReasonKey: reason }).text).toBe(
      'assistant.offline',
    );
  });

  it('shows a refused press without saying it, and stays quiet through the revert', () => {
    // The blocked control points `aria-describedby` at this same sentence, so a screen
    // reader read it out when the user focused the control. Putting it in the live region
    // would read it a second time, and the revert three seconds later a third.
    const reason = 'assistant.controls.reasons.avatarNotSpeaking';

    expect(notice({}, { blockedReasonKey: reason }).isSilent).toBe(true);
    // The revert. The reason has gone, the resting sentence is back, and the line is still
    // silent, so putting the old text back is not an announcement either.
    expect(notice({}, { isRestingSilent: true })).toMatchObject({
      text: RESTING,
      isSilent: true,
    });
  });

  it('still announces every message that is real news', () => {
    // The silence covers the refused press only. Everything a user could not learn any other
    // way keeps its voice, including while the line is in its quiet window.
    const quiet = { isRestingSilent: true };

    expect(notice({ online: false }, quiet).isSilent).toBe(false);
    expect(notice({ isAudioBlocked: true }, quiet).isSilent).toBe(false);
    expect(notice({ error: { kind: 'micPermission' } }, quiet).isSilent).toBe(
      false,
    );
    expect(notice({ error: { kind: 'provider' } }, quiet).isSilent).toBe(false);
    expect(
      notice({}, { ...quiet, showBadConnection: true }).isSilent,
    ).toBe(false);
    expect(notice({ isTimeWarning: true }, quiet).isSilent).toBe(false);
  });

  it('rests without silence once the quiet window is over', () => {
    expect(notice().isSilent).toBe(false);
  });
});

describe('the timers behind the notice line', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps the line silent through the revert, then lets it speak again', () => {
    const { result } = renderHook(() => useConversationNotice(base));

    expect(result.current.notice.isSilent).toBe(false);

    act(() =>
      result.current.reportBlocked(
        'assistant.controls.reasons.avatarNotSpeaking',
      ),
    );
    expect(result.current.notice.isSilent).toBe(true);

    // Three seconds later the reason is gone and the resting sentence is back. If the line
    // became polite in the same commit, that revert would be announced.
    act(() => void vi.advanceTimersByTime(3000));
    expect(result.current.notice.text).not.toBe('');
    expect(result.current.notice.isSilent).toBe(true);

    // A second after the text settled, the line can speak again, with nothing left to say.
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.notice.isSilent).toBe(false);
  });
});
