import { useTranslation } from 'react-i18next';
import { useOnlineStatus } from '../hooks';

/** Thin bar shown while the device has no network. */
export function OfflineBanner() {
  const { t } = useTranslation();
  const online = useOnlineStatus();

  if (online) return null;

  return (
    <div
      role="status"
      className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900"
    >
      {t('states.offline')}
    </div>
  );
}
