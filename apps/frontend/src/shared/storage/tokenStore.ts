import { isNative } from '../platform';
import { memoryStorage } from './memoryStorage';
import { secureStorage } from './secureStorage';
import type { KeyValueStorage } from './types';

const TOKEN_KEY = 'access_token';

/**
 * Web: the session is an HttpOnly cookie, so the token store is in memory only.
 * Native: the bearer token is kept in OS-backed secure storage.
 * Never log the token.
 */
function storage(): KeyValueStorage {
  return isNative() ? secureStorage : memoryStorage;
}

export async function getAccessToken(): Promise<string | null> {
  return storage().get(TOKEN_KEY);
}

export async function setAccessToken(token: string): Promise<void> {
  await storage().set(TOKEN_KEY, token);
}

export async function clearAccessToken(): Promise<void> {
  await storage().remove(TOKEN_KEY);
}
