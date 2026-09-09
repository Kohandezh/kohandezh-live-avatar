import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser, userKeys } from '@/entities/user';
import { clearAccessToken, setAccessToken } from '@/shared/storage/tokenStore';
import { login, logout } from './api';

/** Current session, derived from the `me` query. */
export function useSession() {
  const query = useCurrentUser();

  return {
    user: query.data ?? null,
    isAuthenticated: Boolean(query.data),
    isLoading: query.isPending,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: login,
    onSuccess: async ({ user, accessToken }) => {
      if (accessToken) {
        await setAccessToken(accessToken);
      }
      queryClient.setQueryData(userKeys.me(), user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: logout,
    // Runs on success and on failure: local session must always be cleared.
    onSettled: async () => {
      await clearAccessToken();
      await queryClient.cancelQueries();
      queryClient.clear();
      queryClient.setQueryData(userKeys.me(), null);
    },
  });
}
