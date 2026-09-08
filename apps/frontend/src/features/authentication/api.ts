import { z } from 'zod';
import { userSchema } from '@/entities/user';
import { apiClient } from '@/shared/api';
import type { LoginInput } from './schemas';

/**
 * POST /api/auth/login
 * Web: the backend sets an HttpOnly session cookie and may omit accessToken.
 * Native: the backend returns accessToken, which we keep in secure storage.
 */
export const loginResponseSchema = z.object({
  user: userSchema,
  accessToken: z.string().optional(),
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

export async function login(input: LoginInput): Promise<LoginResponse> {
  const { data } = await apiClient.post('/api/auth/login', input);
  return loginResponseSchema.parse(data);
}

/** POST /api/auth/logout. Clears the cookie session on the server. */
export async function logout(): Promise<void> {
  await apiClient.post('/api/auth/logout');
}
