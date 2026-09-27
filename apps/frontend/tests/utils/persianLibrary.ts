import type { AxiosAdapter } from 'axios';
import { apiClient } from '@/shared/api';

/**
 * The mock library is Persian only, like the rendered library, so an English screen gets no
 * suggested questions. Tests that run the English screen call this after `installMockApi`: the list
 * request is answered with the Persian answers, and everything else goes to the mock unchanged.
 * The request the app sent still says `en`, so a test can check that.
 */
export function servePersianLibraryToEnglishScreens(): void {
  const inner = apiClient.defaults.adapter as AxiosAdapter;
  apiClient.defaults.adapter = (config) =>
    inner(
      config.url === '/api/library/suggestions'
        ? { ...config, params: { ...config.params, language: 'fa' } }
        : config,
    );
}

/** The two published answers of the mock seed (src/data/mock/handlers.ts), in list order. */
export const MOCK_LIBRARY = {
  firstQuestion: 'دکتر کهندژ کیست و چه کاری انجام می‌دهد؟',
  firstAnswer: 'دکتر کهندژ متخصص کاشت مو است و سال‌هاست در این زمینه کار می‌کند.',
  firstId: 'mock-library-identity',
  secondQuestion: 'برای کاشت مو چند گرافت لازم دارم؟',
} as const;
