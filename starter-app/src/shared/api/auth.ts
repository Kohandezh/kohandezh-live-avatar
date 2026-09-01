import { api } from './client';
import { isNative } from '@shared/platform/isNative';
import { tokenStorage } from '@shared/storage/token';
import type { UserDto as User } from './dto';

export interface LoginRequest {
  email: string;
  password: string;
}

interface LoginResponse {
  user: User;
  /** Present only when the client asked for a token (native). Web gets an HttpOnly cookie. */
  accessToken?: string;
}

export async function login(payload: LoginRequest): Promise<User> {
  const res = await api.post<LoginResponse>('/auth/login', payload, {
    anonymous: true,
    // The client tells the backend which mechanism it wants; backend supports both.
    headers: { 'X-Auth-Mode': isNative() ? 'bearer' : 'cookie' },
  });
  if (isNative() && res.accessToken) await tokenStorage.setAccessToken(res.accessToken);
  return res.user;
}

export async function logout(): Promise<void> {
  try {
    await api.post<void>('/auth/logout');
  } finally {
    await tokenStorage.clearAccessToken();
  }
}

export function me(): Promise<User> {
  return api.get<User>('/auth/me');
}
