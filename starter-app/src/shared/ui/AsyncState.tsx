import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@shared/api/errors';
import { Button } from './Button';

// Architecture §10: every data-driven UI handles Loading / Empty / Error / Success explicitly.
// Use this wrapper around TanStack Query results so no screen forgets a state.

export function Spinner() {
  const { t } = useTranslation();
  return (
    <div className="state" role="status" aria-live="polite">
      <div className="spinner" />
      <span className="sr-only">{t('state.loading')}</span>
    </div>
  );
}

export function EmptyState({ message }: { message?: string }) {
  const { t } = useTranslation();
  return <div className="state">{message ?? t('state.empty')}</div>;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const message =
    error instanceof ApiError
      ? error.code === 'UNAUTHORIZED'
        ? t('state.unauthorized')
        : error.code === 'NOT_FOUND'
          ? t('state.notFound')
          : t('state.error')
      : t('state.error');
  const canRetry = !(error instanceof ApiError) || error.isRetryable;
  return (
    <div className="state state--error" role="alert">
      <p>{message}</p>
      {onRetry && canRetry && <Button onClick={onRetry}>{t('state.retry')}</Button>}
    </div>
  );
}

interface AsyncStateProps<T> {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: T | undefined;
  isEmpty?: (data: T) => boolean;
  refetch?: () => void;
  emptyMessage?: string;
  children: (data: T) => ReactNode;
}

export function AsyncState<T>({ isLoading, isError, error, data, isEmpty, refetch, emptyMessage, children }: AsyncStateProps<T>) {
  if (isLoading) return <Spinner />;
  if (isError) return <ErrorState error={error} {...(refetch ? { onRetry: refetch } : {})} />;
  if (data === undefined) return <EmptyState {...(emptyMessage ? { message: emptyMessage } : {})} />;
  if (isEmpty?.(data)) return <EmptyState {...(emptyMessage ? { message: emptyMessage } : {})} />;
  return <>{children(data)}</>;
}
