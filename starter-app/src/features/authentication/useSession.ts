import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { authApi, ApiError, setUnauthorizedHandler } from '@shared/api';
import type { User } from '@entities/user';

export const sessionKey = ['session'] as const;

/** Current user, or null when not authenticated. Server state — owned by TanStack Query. */
export function useSession() {
  const qc = useQueryClient();
  useEffect(() => {
    setUnauthorizedHandler(() => qc.setQueryData(sessionKey, null));
  }, [qc]);

  return useQuery<User | null>({
    queryKey: sessionKey,
    queryFn: async () => {
      try {
        return await authApi.me();
      } catch (e) {
        if (e instanceof ApiError && e.code === 'UNAUTHORIZED') return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authApi.login,
    onSuccess: (user) => qc.setQueryData(sessionKey, user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      qc.setQueryData(sessionKey, null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
    },
  });
}
