import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usersApi, type PageQuery } from '@shared/api';
import type { User } from './types';

// Query keys are owned by the entity. Features invalidate through these helpers.
export const userKeys = {
  all: ['users'] as const,
  publicList: (q: PageQuery) => [...userKeys.all, 'public', q] as const,
  detail: (id: string) => [...userKeys.all, 'detail', id] as const,
};

export function usePublicUsers(query: PageQuery = { page: 1, pageSize: 20 }) {
  return useQuery({ queryKey: userKeys.publicList(query), queryFn: () => usersApi.listPublic(query) });
}

export function useUser(id: string) {
  return useQuery({ queryKey: userKeys.detail(id), queryFn: () => usersApi.get(id), enabled: !!id });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Pick<User, 'displayName'>>) => usersApi.updateMe(patch),
    onSuccess: (user) => {
      qc.setQueryData(['session'], user);
      void qc.invalidateQueries({ queryKey: userKeys.all });
    },
  });
}
