import { Card } from '@heroui/react';
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
      // `above-dock` (not `bottom-4`): the floating tab bar is also fixed,
      // end-aligned, z-50 — without this the update card lands on top of it.
      className="fixed end-4 above-dock z-50 w-[calc(100%-2rem)] max-w-sm"
    >
      <Card className="shadow-lg">
        <Card.Content>
          <p className="text-sm text-foreground">
            {needRefresh ? t('pwa.updateAvailable') : t('pwa.offlineReady')}
          </p>
        </Card.Content>
        <Card.Footer className="mt-3 gap-2">
          {needRefresh ? (
            <Button size="sm" onPress={() => void updateServiceWorker(true)}>
              {t('pwa.reload')}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onPress={dismiss}>
            {t('pwa.dismiss')}
          </Button>
        </Card.Footer>
      </Card>
    </div>
  );
}
