import { useTranslation } from 'react-i18next';
import { Alert } from '@heroui/react';
import { useOnlineStatus } from '../hooks';

/** Thin bar shown while the device has no network. */
export function OfflineBanner() {
  const { t } = useTranslation();
  const online = useOnlineStatus();

  if (online) return null;

  return (
    // safe-top: the app header is gone (requirement 6), so this can now be
    // the very top element of the screen and must clear the notch itself.
    <Alert status="warning" role="status" className="safe-top rounded-none">
      <Alert.Content>
        <Alert.Description className="text-center text-sm">
          {t('states.offline')}
        </Alert.Description>
      </Alert.Content>
    </Alert>
  );
}
