import { reportAssistantAnswers } from '@/entities/assistant-session';
import { isApiError } from '@/shared/api';

/** The endpoint takes at most this many answers in one request. */
const BATCH_MAX = 20;
/** Segments that end close together go out in one request. */
const FLUSH_DELAY_MS = 500;
/** While the avatar keeps talking the flush waits for the next segment, but no longer than this. */
const MAX_HOLD_MS = 2000;
const NETWORK_RETRY_DELAY_MS = 1000;
/** Used when a 429 does not say how long to wait. */
const BUSY_RETRY_FALLBACK_MS = 2000;

interface Answer {
  index: number;
  durationMs: number;
}

export interface AnswerReporter {
  /** `AVATAR_SPEAK_STARTED`. Closes a segment that never got its end. */
  segmentStarted(): void;
  /** `AVATAR_SPEAK_ENDED`, the ElevenLabs `interruption`, or the provider ending the session. */
  segmentEnded(): void;
  /**
   * Closes the open segment and sends everything still queued, one attempt per batch. Resolves
   * when the last request settled, so the caller can close the session after it: a report that
   * arrives after `close` is refused. Never rejects.
   */
  finish(): Promise<void>;
}

/**
 * How long to wait before the one retry, or null when retrying cannot help.
 *
 * A 409, 404, 401, 403 or 422 means the session is over or the batch is wrong. A 2xx whose body
 * fails the schema is not an `ApiError`: the backend took the batch, so it is not sent again.
 */
function retryDelayMs(error: unknown): number | null {
  if (!isApiError(error)) return null;
  if (error.status === 429) {
    const details = error.details as { retryAfterSeconds?: unknown } | null;
    const seconds = details?.retryAfterSeconds;
    return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
      ? seconds * 1000
      : BUSY_RETRY_FALLBACK_MS;
  }
  // No status at all: the request never got an answer (offline, timeout).
  if (error.status === undefined || error.status >= 500) {
    return NETWORK_RETRY_DELAY_MS;
  }
  return null;
}

/**
 * Measures the avatar's speech segments of one backend session and reports them
 * (POST /api/assistant/session/{id}/answers), so the backend writes one usage row per answer.
 *
 * Reporting is best effort and invisible: no outcome reaches the UI, the reducer or the console.
 * A batch leaves the queue on a 2xx. A 429, a 5xx or a network error gets one retry with the same
 * indexes (the backend counts each index once), and anything else drops the batch.
 */
export function createAnswerReporter(
  sessionId: string,
  maxDurationMs: number,
): AnswerReporter {
  let segmentStartedAt: number | null = null;
  // Counts only the segments that are kept, so it never repeats within the session.
  let nextIndex = 0;
  const pending: Answer[] = [];
  // When the oldest answer in `pending` was queued.
  let pendingSince = 0;
  let flushTimer: number | null = null;
  let flushDueAt = 0;
  // One request at a time: the backend refuses a second report for the same session while the
  // first is still being written.
  let inFlight: Promise<void> | null = null;
  let isFinishing = false;
  let finished: Promise<void> | null = null;
  // Ends the wait before a retry early, so the pre-close flush does not sit out a 429 delay.
  let cutRetryWait: (() => void) | null = null;

  const clearFlushTimer = () => {
    if (flushTimer !== null) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
  };

  const waitBeforeRetry = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => {
        cutRetryWait = null;
        resolve();
      }, ms);
      cutRetryWait = () => {
        window.clearTimeout(timer);
        cutRetryWait = null;
        resolve();
      };
    });

  const send = async (answers: Answer[]) => {
    try {
      await reportAssistantAnswers(sessionId, { answers });
      return;
    } catch (error) {
      const delayMs = retryDelayMs(error);
      if (delayMs === null || isFinishing) return;
      await waitBeforeRetry(delayMs);
    }
    try {
      await reportAssistantAnswers(sessionId, { answers });
    } catch {
      // Dropped. The row is a measurement aid, not a record the user depends on.
    }
  };

  const flush = (): Promise<void> => {
    clearFlushTimer();
    if (inFlight) return inFlight;
    if (pending.length === 0) return Promise.resolve();
    inFlight = (async () => {
      // A segment that ends while a request runs goes out right after it.
      while (pending.length > 0) await send(pending.splice(0, BATCH_MAX));
    })().finally(() => {
      inFlight = null;
      // Queued between the last check of the loop and here.
      if (pending.length > 0 && !isFinishing) scheduleFlush();
    });
    return inFlight;
  };

  const armFlushTimer = (delayMs: number) => {
    flushDueAt = performance.now() + delayMs;
    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      // The avatar is answering again, so its next segment can join this request.
      const heldMs = performance.now() - pendingSince;
      if (segmentStartedAt !== null && heldMs < MAX_HOLD_MS) {
        armFlushTimer(MAX_HOLD_MS - heldMs);
        return;
      }
      void flush();
    }, delayMs);
  };

  const scheduleFlush = () => {
    if (pending.length >= BATCH_MAX) {
      void flush();
      return;
    }
    // Never on the spot, so segments that end in one burst share a request. A flush that waits
    // for a segment that has now ended is brought forward.
    if (flushTimer === null || flushDueAt > performance.now() + FLUSH_DELAY_MS) {
      clearFlushTimer();
      armFlushTimer(FLUSH_DELAY_MS);
    }
  };

  /** Queues the open segment, if any. True when an answer was queued. */
  const closeSegment = (): boolean => {
    if (segmentStartedAt === null) return false;
    const measured = Math.round(performance.now() - segmentStartedAt);
    segmentStartedAt = null;
    // The backend refuses 0 ms and anything longer than the session.
    if (measured < 1) return false;
    if (pending.length === 0) pendingSince = performance.now();
    pending.push({
      index: nextIndex++,
      durationMs: Math.min(measured, maxDurationMs),
    });
    return true;
  };

  return {
    segmentStarted() {
      if (isFinishing) return;
      if (closeSegment()) scheduleFlush();
      segmentStartedAt = performance.now();
    },

    segmentEnded() {
      if (isFinishing) return;
      if (closeSegment()) scheduleFlush();
    },

    finish() {
      if (finished) return finished;
      closeSegment();
      isFinishing = true;
      clearFlushTimer();
      cutRetryWait?.();
      finished = (async () => {
        while (inFlight || pending.length > 0) await flush();
      })();
      return finished;
    },
  };
}
