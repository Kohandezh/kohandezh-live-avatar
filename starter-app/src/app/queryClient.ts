import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@shared/api/errors';

// SERVER STATE lives here. Defaults tuned for mobile: no aggressive refetch, bounded retries.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Never retry auth/authorization/validation failures.
        if (error instanceof ApiError && error.status < 500 && error.status !== 429) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: 0 },
  },
});
