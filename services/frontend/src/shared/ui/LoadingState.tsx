import { Spinner } from '@heroui/react';
import { useTranslation } from 'react-i18next';

export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation();
  const text = label ?? t('state.loading');
  return (
    <div className="flex items-center gap-3 p-4 text-muted" role="status" aria-live="polite">
      <Spinner size="sm" color="current" />
      <span>{text}</span>
    </div>
  );
}
