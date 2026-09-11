import { useTranslation } from 'react-i18next';
import { StatusChip, type StatusTone } from '@/shared/ui';
import type { AssistantStatus } from './types';

const STATUS_TONE: Record<AssistantStatus, StatusTone> = {
  idle: 'default',
  requesting: 'accent',
  connecting: 'accent',
  connected: 'success',
  ending: 'default',
  ended: 'default',
  error: 'danger',
};

/** The same status label in the video overlay and in the voice card. */
export function AssistantStatusChip({
  status,
  className,
}: {
  status: AssistantStatus;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <StatusChip tone={STATUS_TONE[status]} className={className}>
      {t(`assistant.status.${status}`)}
    </StatusChip>
  );
}
