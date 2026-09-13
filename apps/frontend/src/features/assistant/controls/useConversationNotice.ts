import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '@/i18n';
import { WARNING_SECONDS } from '../state';
import type {
  AssistantConnectionQuality,
  AssistantError,
  AssistantStatus,
} from '../types';

/** A weak connection has to hold for this long before the line says so. */
const BAD_CONNECTION_DELAY_MS = 3000;

/** And the connection has to be good for this long before the line lets go. */
const GOOD_CONNECTION_CLEAR_MS = 5000;

/** How long a refused press keeps its reason on screen. */
const BLOCKED_REASON_MS = 3000;

/**
 * How much longer the line stays silent after the reason has gone.
 *
 * Turning the line back on and putting the resting text back in the same commit would let the
 * revert be announced, which is the third announcement this whole change exists to remove: a
 * screen reader already read the reason as the control's description on focus. So the text goes
 * back first, the line is still silent, and only afterwards does it become polite again, with
 * nothing left to say.
 */
const QUIET_AFTER_BLOCKED_MS = 1000;

export type NoticeTone = 'muted' | 'warning' | 'danger';

export interface ConversationNotice {
  /** The line to show. Empty while there is nothing to say. */
  text: string;
  /** A second sentence on the same line. Only the audio-blocked case uses it. */
  hint: string;
  tone: NoticeTone;
  /**
   * True only for a denied microphone. The avatar keeps talking and the user keeps talking
   * back, and nobody hears them, so that one message interrupts instead of waiting its turn.
   */
  isAlert: boolean;
  /**
   * Show it, do not say it.
   *
   * Only the reason a refused press was refused, plus the moment right after it. A blocked
   * control points `aria-describedby` at that same sentence, so a screen reader has already
   * read it out when the user focused the control, before they pressed it. Writing it into
   * this line as well would read it a second time, and the revert three seconds later a
   * third. Sighted users still see all three; nobody hears any of them.
   */
  isSilent: boolean;
}

export interface ConversationNoticeInput {
  status: AssistantStatus;
  online: boolean;
  /** Connected and the media is flowing. Audio can only be blocked once there is audio. */
  isStreaming: boolean;
  isAudioBlocked: boolean;
  error: AssistantError | null;
  connectionQuality: AssistantConnectionQuality;
  /** The session is inside its last `WARNING_SECONDS`. A boolean, never a ticking number. */
  isTimeWarning: boolean;
  /** What the line says when nothing is wrong. Usually which language the agent speaks. */
  restingText: string;
}

/** Everything `pickNotice` needs that is not part of the session state. */
export interface NoticeContext {
  /** i18next's `t`, narrowed to what this function uses. */
  translate: (key: string, values?: Record<string, unknown>) => string;
  /** The weak-connection message has already served its delay on both edges. */
  showBadConnection: boolean;
  /** The i18n key of the reason a refused press was refused, while it is still showing. */
  blockedReasonKey: string | null;
  /**
   * Keep the resting sentence silent as well. True for a short window after a refused press,
   * so putting the resting text back is not announced either. See `QUIET_AFTER_BLOCKED_MS`.
   */
  isRestingSilent: boolean;
  /** Locale for the one number in the time warning. */
  language: string;
}

/**
 * Which single message owns the notice line.
 *
 * Pure, and exported, so the priority order can be tested without rendering anything.
 *
 * Priority, highest first:
 *
 *  1. Offline
 *  2. Blocked audio (the orb is the button that fixes it)
 *  3. A control error, with a denied microphone escalating to an alert
 *  4. A weak connection, held on both edges so it cannot flicker
 *  5. The time warning
 *  6. The reason a refused press was refused
 *  7. Resting: which language the agent speaks
 *
 * Offline sits above the control error on purpose. A denied microphone stays in `state.error`
 * for the rest of the session, so with the other order a user who denied the microphone and
 * then lost the network would never be told the network was gone. The shell's offline banner
 * is hidden on this route, precisely so it cannot push the anchored controls around, which
 * makes this line the only place that news can appear.
 */
export function pickNotice(
  input: ConversationNoticeInput,
  context: NoticeContext,
): ConversationNotice {
  const { translate } = context;

  if (!input.online) {
    return line(translate('assistant.offline'), 'warning');
  }

  if (input.isStreaming && input.isAudioBlocked) {
    return {
      text: translate('assistant.video.audioBlocked'),
      hint: translate('assistant.voice.audioBlockedHint'),
      tone: 'warning',
      isAlert: false,
      isSilent: false,
    };
  }

  // A failed start owns the whole screen through the error card, so only a control that
  // failed while the conversation kept running belongs in this line.
  if (input.error && input.status !== 'error') {
    return {
      text: translate(`assistant.errors.${input.error.kind}`),
      hint: '',
      tone: 'danger',
      isAlert: input.error.kind === 'micPermission',
      isSilent: false,
    };
  }

  if (context.showBadConnection) {
    return line(translate('assistant.quality.bad'), 'warning');
  }

  if (input.isTimeWarning) {
    // One fixed sentence, not a counter. A number that rewrites itself every second is the
    // churn this screen exists to remove, and inside a live region it would also be read out
    // on every tick.
    return line(
      translate('assistant.voice.timeWarning', {
        seconds: formatNumber(WARNING_SECONDS, context.language),
      }),
      'warning',
    );
  }

  if (context.blockedReasonKey) {
    return line(translate(context.blockedReasonKey), 'muted', true);
  }

  return line(input.restingText, 'muted', context.isRestingSilent);
}

function line(
  text: string,
  tone: NoticeTone,
  isSilent = false,
): ConversationNotice {
  return { text, hint: '', tone, isAlert: false, isSilent };
}

export interface ConversationNoticeResult {
  notice: ConversationNotice;
  /** Call from a refused press with the i18n key of its reason. */
  reportBlocked: (reasonKey: string) => void;
}

/**
 * The one line of text under the orb, and the timers that keep it steady.
 *
 * This screen used to have five things that were each their own chip or their own alert:
 * offline, blocked audio, a control error, a weak connection and the time warning. Each
 * appeared and disappeared on its own schedule, so the middle of the screen moved while the
 * user was reading it. They share one slot now, the slot has a reserved height, and
 * `pickNotice` decides which of them owns it.
 */
export function useConversationNotice(
  input: ConversationNoticeInput,
): ConversationNoticeResult {
  const { t, i18n } = useTranslation();
  const [showBadConnection, setShowBadConnection] = useState(false);
  // An object, not a bare string: pressing the same blocked control twice has to restart the
  // timer, and an unchanged string would be dropped as an unchanged state value.
  const [blocked, setBlocked] = useState<{ key: string } | null>(null);
  // Outlives `blocked` by `QUIET_AFTER_BLOCKED_MS`, so the revert is not announced either.
  const [isQuiet, setQuiet] = useState(false);

  const isBad =
    input.status === 'connected' && input.connectionQuality === 'bad';

  useEffect(() => {
    // Slow in and slower out. A network that flaps every few seconds would otherwise put the
    // flicker we just removed from the chips straight back into the notice line.
    const delay = isBad ? BAD_CONNECTION_DELAY_MS : GOOD_CONNECTION_CLEAR_MS;
    const timer = window.setTimeout(() => setShowBadConnection(isBad), delay);
    return () => window.clearTimeout(timer);
  }, [isBad]);

  useEffect(() => {
    if (blocked === null) return;
    const timer = window.setTimeout(() => setBlocked(null), BLOCKED_REASON_MS);
    return () => window.clearTimeout(timer);
  }, [blocked]);

  useEffect(() => {
    // Only once the reason itself is gone. Pressing another blocked control in the meantime
    // sets `blocked` again, which stops this timer and starts the wait over.
    if (!isQuiet || blocked !== null) return;
    const timer = window.setTimeout(
      () => setQuiet(false),
      QUIET_AFTER_BLOCKED_MS,
    );
    return () => window.clearTimeout(timer);
  }, [isQuiet, blocked]);

  const reportBlocked = useCallback((reasonKey: string) => {
    setBlocked({ key: reasonKey });
    setQuiet(true);
  }, []);

  const notice = pickNotice(input, {
    translate: (key, values) => t(key, values ?? {}),
    showBadConnection,
    blockedReasonKey: blocked?.key ?? null,
    isRestingSilent: isQuiet,
    language: i18n.language,
  });

  return { notice, reportBlocked };
}
