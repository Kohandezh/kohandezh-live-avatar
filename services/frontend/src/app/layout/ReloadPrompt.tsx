import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { InlineAlert } from '@shared/ui';

/** Service-worker lifecycle UI: new version available / app shell cached for offline. */
export function ReloadPrompt() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh && !offlineReady) return null;

  return (
    <div className="px-4 pt-3">
      {needRefresh ? (
        <InlineAlert
          status="accent"
          title={t('app.updateAvailable')}
          actions={
            <>
              <Button size="sm" variant="primary" onPress={() => void updateServiceWorker(true)}>
                {t('app.reload')}
              </Button>
              <Button size="sm" variant="ghost" onPress={() => setNeedRefresh(false)}>
                {t('app.dismiss')}
              </Button>
            </>
          }
        />
      ) : (
        <InlineAlert
          status="default"
          actions={
            <Button size="sm" variant="ghost" onPress={() => setOfflineReady(false)}>
              {t('app.dismiss')}
            </Button>
          }
        >
          {t('app.offlineReady')}
        </InlineAlert>
      )}
    </div>
  );
}
