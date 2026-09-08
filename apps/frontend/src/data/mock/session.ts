const SESSION_KEY = 'mock_session_user_id';

let memory: string | null = null;

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Stands in for the server-side session (cookie on web, token on native).
 * Kept in localStorage so a page reload keeps the mock session.
 */
export const mockSession = {
  get(): string | null {
    return storage()?.getItem(SESSION_KEY) ?? memory;
  },
  set(userId: string): void {
    memory = userId;
    storage()?.setItem(SESSION_KEY, userId);
  },
  clear(): void {
    memory = null;
    storage()?.removeItem(SESSION_KEY);
  },
};
