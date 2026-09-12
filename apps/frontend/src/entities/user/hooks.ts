import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { PaginationParams } from '@/shared/api';
import { getCurrentUser, listUsers, updateProfile } from './api';

export const userKeys = {
  all: ['user'] as const,
  me: () => [...userKeys.all, 'me'] as const,
  list: (params: PaginationParams) =>
    [...userKeys.all, 'list', params] as const,
};

export function useCurrentUser() {
  return useQuery({
    queryKey: userKeys.me(),
    queryFn: getCurrentUser,
    staleTime: 5 * 60_000,
  });
}

/**
 * Writes the response straight into the `me` cache instead of invalidating it:
 * the mutation returns the whole fresh user, so a refetch would be a wasted
 * round trip. Matches `useVerifyOtp`.
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateProfile,
    onSuccess: (user) => {
      queryClient.setQueryData(userKeys.me(), user);
    },
  });
}

export function useUsers(params: PaginationParams) {
  return useQuery({
    queryKey: userKeys.list(params),
    queryFn: () => listUsers(params),
    // Keeps the old page on screen while the next one loads.
    placeholderData: keepPreviousData,
  });
}
