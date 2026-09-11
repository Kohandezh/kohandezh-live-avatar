import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@heroui/react';
import { Button } from './Button';

export type AlertStatus = 'info' | 'success' | 'warning' | 'danger';

const STATUS_MAP: Record<AlertStatus, 'accent' | 'success' | 'warning' | 'danger'> = {
  info: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

/**
 * A message that sits inside a panel rather than replacing it, so the operator keeps the
 * surrounding controls. `onRetry` is omitted when the failure is not worth retrying.
 */
export function InlineAlert({
  status = 'info',
  title,
  onRetry,
  actions,
  children,
  className,
}: {
  status?: AlertStatus;
  title?: string;
  onRetry?: (() => void) | undefined;
  /** Extra buttons shown next to Retry, for example Dismiss. */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <Alert
      status={STATUS_MAP[status]}
      role={status === 'danger' ? 'alert' : 'status'}
      className={className}
    >
      <Alert.Content>
        {title ? <Alert.Title>{title}</Alert.Title> : null}
        {children ? <Alert.Description>{children}</Alert.Description> : null}
        {onRetry || actions ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {onRetry ? (
              <Button variant="secondary" size="sm" onPress={onRetry}>
                {t('states.retry')}
              </Button>
            ) : null}
            {actions}
          </div>
        ) : null}
      </Alert.Content>
    </Alert>
  );
}
