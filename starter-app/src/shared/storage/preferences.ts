import { isNative } from '@shared/platform/isNative';

// Small, non-sensitive key/value persistence (locale, theme, onboarding flags).
// NEVER put tokens or personal data here — use storage/token.ts for tokens.
export interface KeyValueStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const web: KeyValueStorage = {
  async get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* quota / private mode */
    }
  },
  async remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

const native: KeyValueStorage = {
  async get(key) {
    const { Preferences } = await import('@capacitor/preferences');
    return (await Preferences.get({ key })).value;
  },
  async set(key, value) {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key, value });
  },
  async remove(key) {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.remove({ key });
  },
};

export const preferences: KeyValueStorage = isNative() ? native : web;
