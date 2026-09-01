import { api } from './client';
import type { Paginated, PageQuery } from './types';
import type { UserDto as User, PublicUserDto as PublicUser } from './dto';

export const usersApi = {
  /** Public API: explicit field allowlist enforced server-side. */
  listPublic: (query: PageQuery = {}) => api.get<Paginated<PublicUser>>('/public/users', { query, anonymous: true }),
  /** Authenticated API. */
  get: (id: string) => api.get<User>(`/users/${id}`),
  updateMe: (patch: Partial<Pick<User, 'displayName'>>) => api.patch<User>('/users/me', patch),
};
