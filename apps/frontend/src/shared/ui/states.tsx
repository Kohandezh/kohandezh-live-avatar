import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../utils';
import { Button } from './Button';
import { Spinner } from './Spinner';

/**
 * Every async screen must show loading, empty, and error states.
 * Use these components so the states look the same everywhere.
 */

export function LoadingState({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-12 text-slate-500',
        className,
      )}
    >
      <Spinner size="lg" />
      <p className="text-sm">{label ?? t('states.loading')}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 py-12 text-center',
        className,
      )}
    >
      <p className="text-base font-medium text-slate-900">
        {title ?? t('states.empty.title')}
      </p>
      <p className="max-w-sm text-sm text-slate-500">
        {description ?? t('states.empty.description')}
      </p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title,
  description,
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-2 py-12 text-center',
        className,
      )}
    >
      <p className="text-base font-medium text-slate-900">
        {title ?? t('states.error.title')}
      </p>
      <p className="max-w-sm text-sm text-slate-500">
        {description ?? t('states.error.description')}
      </p>
      {onRetry ? (
        <Button
          variant="secondary"
          size="sm"
          className="mt-2"
          onClick={onRetry}
        >
          {t('states.retry')}
        </Button>
      ) : null}
    </div>
  );
}
