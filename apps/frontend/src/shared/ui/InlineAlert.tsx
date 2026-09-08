import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../utils';
import { Button } from './Button';

export type AlertStatus = 'info' | 'success' | 'warning' | 'danger';

const statusClasses: Record<AlertStatus, string> = {
  info: 'border-indigo-200 bg-indigo-50 text-indigo-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-red-200 bg-red-50 text-red-900',
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
    <div
      role={status === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-lg border p-3 text-sm', statusClasses[status], className)}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      {children ? <div className={cn(title && 'mt-1')}>{children}</div> : null}
      {onRetry || actions ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {t('states.retry')}
            </Button>
          ) : null}
          {actions}
        </div>
      ) : null}
    </div>
  );
}
