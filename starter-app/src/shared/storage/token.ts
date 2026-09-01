import { isNative } from '@shared/platform/isNative';

// Access-token storage abstraction (architecture §3). Native uses Keychain/Keystore via a secure
// storage plugin; web never stores tokens (HttpOnly cookie owns the session). Swap the
// implementation here without touching the rest of the app.
export interface TokenStorage {
  getAccessToken(): Promise<string | null>;
  setAccessToken(token: string): Promise<void>;
  clearAccessToken(): Promise<void>;
}

const KEY = 'access_token';

const webNoop: TokenStorage = {
  async getAccessToken() {
    return null;
  },
  async setAccessToken() {
    /* web uses HttpOnly cookies; intentionally no-op */
  },
  async clearAccessToken() {
    /* no-op */
  },
};

const nativeSecure: TokenStorage = {
  async getAccessToken() {
    const { SecureStoragePlugin } = await import('capacitor-secure-storage-plugin');
    try {
      const { value } = await SecureStoragePlugin.get({ key: KEY });
      return value || null;
    } catch {
      return null; // key missing
    }
  },
  async setAccessToken(token) {
    const { SecureStoragePlugin } = await import('capacitor-secure-storage-plugin');
    await SecureStoragePlugin.set({ key: KEY, value: token });
  },
  async clearAccessToken() {
    const { SecureStoragePlugin } = await import('capacitor-secure-storage-plugin');
    try {
      await SecureStoragePlugin.remove({ key: KEY });
    } catch {
      /* already gone */
    }
  },
};

export const tokenStorage: TokenStorage = isNative() ? nativeSecure : webNoop;
