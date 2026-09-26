import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { getJob } from './api';
import { JobTimeoutError } from './errors';
import type { FinishedJob } from './types';

export const jobKeys = {
  all: ['job'] as const,
  detail: (jobId: string) => [...jobKeys.all, jobId] as const,
};

export interface WaitForJobOptions {
  intervalMs: number;
  timeoutMs: number;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns a function that polls a job every `intervalMs` until it is done or failed, and throws
 * `JobTimeoutError` once `timeoutMs` has passed. Each poll goes through the query cache under
 * `jobKeys.detail`, so a screen that reads the same job sees the latest answer. A failed poll
 * request throws its `ApiError` at once.
 */
export function useWaitForJob() {
  const queryClient = useQueryClient();

  return useCallback(
    async (jobId: string, { intervalMs, timeoutMs }: WaitForJobOptions): Promise<FinishedJob> => {
      const startedAt = Date.now();
      for (;;) {
        const job = await queryClient.fetchQuery({
          queryKey: jobKeys.detail(jobId),
          queryFn: () => getJob(jobId),
          staleTime: 0,
        });
        if (job.status === 'done' || job.status === 'failed') return job;
        if (Date.now() - startedAt >= timeoutMs) throw new JobTimeoutError(jobId);
        await delay(intervalMs);
      }
    },
    [queryClient],
  );
}
