import { QueryClient } from '@tanstack/react-query';
import { isApiError } from '@/shared/api';

/** Creates a QueryClient with the app defaults. Tests call this for isolation. */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => {
          // 4xx answers will not change on retry. Only retry network/5xx once.
          if (isApiError(error) && error.status && error.status < 500)
            return false;
          return failureCount < 1;
        },
      },
    },
  });
}

export const queryClient = createQueryClient();
