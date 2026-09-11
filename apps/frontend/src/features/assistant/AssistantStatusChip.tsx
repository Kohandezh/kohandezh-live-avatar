import { useTranslation } from 'react-i18next';
import { Chip, type ChipProps } from '@heroui/react';
import type { AssistantStatus } from './types';

type StatusTone = NonNullable<ChipProps['color']>;

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
    <Chip color={STATUS_TONE[status]} variant="soft" size="sm" className={className}>
      {t(`assistant.status.${status}`)}
    </Chip>
  );
}
