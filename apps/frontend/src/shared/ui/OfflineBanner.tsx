import { useTranslation } from 'react-i18next';
import { Alert } from '@heroui/react';
import { useOnlineStatus } from '../hooks';

/** Thin bar shown while the device has no network. */
export function OfflineBanner() {
  const { t } = useTranslation();
  const online = useOnlineStatus();

  if (online) return null;

  return (
    <Alert status="warning" role="status" className="rounded-none">
      <Alert.Content>
        <Alert.Description className="text-center text-sm">
          {t('states.offline')}
        </Alert.Description>
      </Alert.Content>
    </Alert>
  );
}
