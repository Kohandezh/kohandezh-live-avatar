import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/shared/ui';

/**
 * Shows a small card when a new service worker is waiting
 * or when the app finished caching for offline use.
 */
export function PwaUpdatePrompt() {
  const { t } = useTranslation();

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('[pwa] service worker registration failed', error);
    },
  });

  if (!needRefresh && !offlineReady) return null;

  const dismiss = () => {
    setNeedRefresh(false);
    setOfflineReady(false);
  };

  return (
    <div
      role="status"
      className="fixed end-4 bottom-4 z-50 w-[calc(100%-2rem)] max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-lg"
    >
      <p className="text-sm text-slate-900">
        {needRefresh ? t('pwa.updateAvailable') : t('pwa.offlineReady')}
      </p>
      <div className="mt-3 flex gap-2">
        {needRefresh ? (
          <Button size="sm" onPress={() => void updateServiceWorker(true)}>
            {t('pwa.reload')}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onPress={dismiss}>
          {t('pwa.dismiss')}
        </Button>
      </div>
    </div>
  );
}
