import type { KeyValueStorage } from './types';

/**
 * In-memory storage. Values are lost on page reload.
 * Used on web, where the session lives in an HttpOnly cookie (ADR 0002),
 * so a bearer token should never be written to localStorage.
 */
export function createMemoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();

  return {
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async remove(key) {
      values.delete(key);
    },
  };
}

export const memoryStorage = createMemoryStorage();
