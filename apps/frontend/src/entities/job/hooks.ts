import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { isApiError } from '@/shared/api';
import { getJob } from './api';

export const jobKeys = {
  all: ['job'] as const,
  detail: (jobId: string) => [...jobKeys.all, jobId] as const,
};

export interface JobPollOptions {
  intervalMs: number;
  /** When polling stops (epoch ms) if the job is still queued or running. Null: never. */
  pollUntil: number | null;
}

/** True once `deadline` (epoch ms) has passed. Re-renders the caller at that moment. */
function useHasPassed(deadline: number | null): boolean {
  const [passed, setPassed] = useState<number | null>(null);

  useEffect(() => {
    if (deadline === null) return undefined;
    const timer = setTimeout(() => setPassed(deadline), Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [deadline]);

  return deadline !== null && passed === deadline;
}

/**
 * True when the job cannot be read at all: `404` (unknown, or not this caller's) or `403`. Any
 * other failed poll (network, 5xx, whatever its `retryable`) is tried again at the next interval.
 */
export function isJobUnreadable(error: unknown): boolean {
  return isApiError(error) && (error.status === 403 || error.status === 404);
}

/**
 * The status of a long operation (`GET /api/jobs/{jobId}`), polled every `intervalMs` while it
 * is queued or running. Polling stops when the job is done or failed, at `pollUntil`, when the
 * job is unreadable (`isJobUnreadable`), and when the caller unmounts. No request while `jobId`
 * is null.
 */
export function useJob(jobId: string | null, { intervalMs, pollUntil }: JobPollOptions) {
  const hasTimedOut = useHasPassed(pollUntil);

  const query = useQuery({
    queryKey: jobKeys.detail(jobId ?? ''),
    queryFn: () => getJob(jobId ?? ''),
    enabled: jobId !== null && !hasTimedOut,
    // Always ask again on mount: coming back to the screen resumes the poll at once.
    staleTime: 0,
    // The interval is the retry: a failed poll is tried again at the next one.
    retry: false,
    refetchInterval: ({ state }) => {
      if (state.data?.status === 'done' || state.data?.status === 'failed') return false;
      if (isJobUnreadable(state.error)) return false;
      return intervalMs;
    },
    refetchIntervalInBackground: true,
  });

  const isFinished = query.data?.status === 'done' || query.data?.status === 'failed';
  return { ...query, hasTimedOut: jobId !== null && hasTimedOut && !isFinished };
}
