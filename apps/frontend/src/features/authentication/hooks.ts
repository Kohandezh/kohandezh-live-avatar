import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser, userKeys } from '@/entities/user';
import { clearAccessToken, setAccessToken } from '@/shared/storage/tokenStore';
import { logout, requestOtp, verifyOtp } from './api';

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

/** Step 1: send a one-time code to the phone number. */
export function useRequestOtp() {
  return useMutation({
    mutationFn: requestOtp,
  });
}

/** Step 2: verify the code and start the session. */
export function useVerifyOtp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: verifyOtp,
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
