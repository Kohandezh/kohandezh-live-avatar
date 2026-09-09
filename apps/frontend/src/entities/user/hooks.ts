import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PaginationParams } from '@/shared/api';
import { getCurrentUser, listUsers } from './api';

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

export function useUsers(params: PaginationParams) {
  return useQuery({
    queryKey: userKeys.list(params),
    queryFn: () => listUsers(params),
    // Keeps the old page on screen while the next one loads.
    placeholderData: keepPreviousData,
  });
}
