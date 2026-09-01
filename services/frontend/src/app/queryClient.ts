import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@shared/api';

// SERVER STATE lives here. Defaults tuned for mobile: no aggressive refetch, bounded retries.
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Never retry validation/config/auth failures; those need a human.
          if (error instanceof ApiError && !error.isRetryable) return false;
          return failureCount < 2;
        },
      },
      // Mutations touch providers (credits) or sessions: never retried automatically.
      mutations: { retry: 0 },
    },
  });
}

export const queryClient = createQueryClient();
