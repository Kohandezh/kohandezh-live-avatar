import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { userKeys } from '@/entities/user';
import { isApiError } from '@/shared/api';
import { clearAccessToken } from '@/shared/storage/tokenStore';

const ME_QUERY_KEY = JSON.stringify(userKeys.me());

/** True for the exact `me` query. RequireAuth already handles that query's own 401. */
function isMeQuery(queryKey?: readonly unknown[]): boolean {
  return queryKey !== undefined && JSON.stringify(queryKey) === ME_QUERY_KEY;
}

/**
 * Creates a QueryClient with the app defaults. Tests call this for isolation.
 *
 * Removing the app header removed the only control a user could press after
 * a "your session has expired" message. A 401 from any query or mutation
 * except the `me` query itself now means the session died server-side
 * (expired or revoked token), so it clears the token and nulls the `me`
 * query. `RequireAuth` sees `user === null` and redirects to `/login` on its
 * own; no other code needs to know this happened.
 */
export function createQueryClient() {
  // `handleSessionDeath` closes over `client` before it exists textually.
  // That is safe: the closure only reads `client` once a query or mutation
  // actually fails, which happens after this function returns.
  function handleSessionDeath(error: unknown, queryKey?: readonly unknown[]) {
    if (!isApiError(error) || error.status !== 401) return;
    if (isMeQuery(queryKey)) return;

    void clearAccessToken();
    client.setQueryData(userKeys.me(), null);
  }

  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => handleSessionDeath(error, query.queryKey),
    }),
    mutationCache: new MutationCache({
      onError: (error) => handleSessionDeath(error),
    }),
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

  return client;
}

export const queryClient = createQueryClient();
