/**
 * JSON helper over window.localStorage for non-sensitive client state
 * (for example: language, UI preferences). Never store tokens here.
 */
export const localStore = {
  get<T>(key: string): T | null {
    try {
      const value = globalThis.localStorage?.getItem(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch {
      return null;
    }
  },
  set<T>(key: string, value: T): void {
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can be full or blocked (private mode). Ignore.
    }
  },
  remove(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // Ignore.
    }
  },
};
