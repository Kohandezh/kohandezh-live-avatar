import { selectLanguage } from '@/features/settings';
import { initI18n } from '@/i18n';
import { apiClient } from '@/shared/api';
import { env } from '@/shared/config/env';
import { store } from './store';

/**
 * Runs once before the first render, for every app target.
 * Keep it small: things that must exist before React mounts.
 */
export async function bootstrap(): Promise<void> {
  if (env.apiMock) {
    if (env.isProd) {
      console.warn('[api] VITE_API_MOCK is enabled in a production build.');
    }
    // Loaded on demand so mock code never ends up in a normal bundle.
    const { installMockApi } = await import('@/data/mock');
    installMockApi(apiClient);
  }

  await initI18n(selectLanguage(store.getState()));
}
