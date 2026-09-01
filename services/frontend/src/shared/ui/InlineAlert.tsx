import { Alert, Button } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';

interface Props {
  status: 'default' | 'accent' | 'success' | 'warning' | 'danger';
  title?: ReactNode;
  children?: ReactNode;
  onRetry?: (() => void) | undefined;
  retryLabel?: string;
  actions?: ReactNode;
}

/** Non-interruptive inline message with an optional retry action. */
export function InlineAlert({ status, title, children, onRetry, retryLabel, actions }: Props) {
  const { t } = useTranslation();
  return (
    <Alert status={status} role={status === 'danger' ? 'alert' : 'status'}>
      <Alert.Indicator />
      <Alert.Content>
        {title && <Alert.Title>{title}</Alert.Title>}
        {children && <Alert.Description>{children}</Alert.Description>}
        {(onRetry || actions) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {onRetry && (
              <Button size="sm" variant="secondary" onPress={onRetry}>
                {retryLabel ?? t('state.retry')}
              </Button>
            )}
            {actions}
          </div>
        )}
      </Alert.Content>
    </Alert>
  );
}
