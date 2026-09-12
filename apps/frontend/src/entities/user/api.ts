import {
  apiClient,
  isUnauthorized,
  paginatedSchema,
  type PaginationParams,
} from '@/shared/api';
import { userSchema, type User } from './types';

const usersPageSchema = paginatedSchema(userSchema);

/** Returns the signed-in user, or null when there is no session. */
export async function getCurrentUser(): Promise<User | null> {
  try {
    const { data } = await apiClient.get('/api/me');
    return userSchema.parse(data);
  } catch (error) {
    if (isUnauthorized(error)) return null;
    throw error;
  }
}

export interface UpdateProfileInput {
  firstName: string;
  lastName: string;
}

/**
 * Full replace, not a partial patch: the backend requires both names on every
 * call. Returns the whole updated user.
 */
export async function updateProfile(input: UpdateProfileInput): Promise<User> {
  const { data } = await apiClient.put('/api/me/profile', input);
  return userSchema.parse(data);
}

/** Admin only. The backend must enforce the admin check. */
export async function listUsers(params: PaginationParams = {}) {
  const { data } = await apiClient.get('/api/admin/users', { params });
  return usersPageSchema.parse(data);
}
