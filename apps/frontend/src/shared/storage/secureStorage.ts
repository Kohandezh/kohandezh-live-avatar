import type { KeyValueStorage } from './types';

/**
 * Native secure-storage adapter.
 *
 * TODO(production): replace the placeholder below with an OS-backed
 * Capacitor plugin (iOS Keychain / Android Keystore). Keep this
 * get/set/remove contract so callers do not change.
 *
 * The placeholder uses localStorage so the app works in development.
 * It is NOT secure and must not ship to production.
 */
const placeholder: KeyValueStorage = {
  async get(key) {
    return globalThis.localStorage?.getItem(key) ?? null;
  },
  async set(key, value) {
    globalThis.localStorage?.setItem(key, value);
  },
  async remove(key) {
    globalThis.localStorage?.removeItem(key);
  },
};

export const secureStorage: KeyValueStorage = placeholder;
