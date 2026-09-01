import { Button, Card } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { InlineAlert, KeyValue, LoadingState, StatusChip, type StatusTone } from '@shared/ui';
import { formatNumber, formatTime } from '@shared/i18n';
import { useBackendHealth, type HealthLevel } from './useBackendHealth';
import { useStatusSocket } from './useStatusSocket';

const TONE: Record<HealthLevel, StatusTone> = {
  checking: 'default',
  ok: 'success',
  degraded: 'warning',
  unreachable: 'danger',
  offline: 'default',
};

function levelLabel(level: HealthLevel, t: (key: string) => string): string {
  return {
    checking: t('health.checking'),
    ok: t('health.ok'),
    degraded: t('health.degraded'),
    unreachable: t('health.unreachable'),
    offline: t('health.offline'),
  }[level];
}

/** Compact indicator for the app header. */
export function HealthStatusChip() {
  const { t } = useTranslation();
  const { level } = useBackendHealth();
  return (
    <span aria-live="polite">
      <StatusChip tone={TONE[level]}>{levelLabel(level, t)}</StatusChip>
    </span>
  );
}

/** Detailed card: per-dependency status, latency, heartbeat socket. */
export function HealthStatusCard() {
  const { t, i18n } = useTranslation();
  const { level, health, isFetching, refetch, error, online } = useBackendHealth();
  const socket = useStatusSocket(online);

  return (
    <Card>
      <Card.Header className="flex flex-row flex-wrap items-center justify-between gap-2">
        <Card.Title>{t('health.title')}</Card.Title>
        <div className="flex items-center gap-2">
          <StatusChip tone={TONE[level]}>{levelLabel(level, t)}</StatusChip>
          <Button
            size="sm"
            variant="ghost"
            isDisabled={!online || isFetching}
            onPress={() => void refetch()}
          >
            {t('health.refresh')}
          </Button>
        </div>
      </Card.Header>
      <Card.Content className="flex flex-col gap-3">
        {level === 'checking' && <LoadingState label={t('health.checking')} />}
        {level === 'offline' && <InlineAlert status="warning">{t('app.offline')}</InlineAlert>}
        {level === 'unreachable' && (
          <InlineAlert status="danger" onRetry={() => void refetch()}>
            {t('health.unreachable')}
            {error instanceof Error && (
              <span className="ltr ms-2 text-xs opacity-80">{error.message}</span>
            )}
          </InlineAlert>
        )}
        {health && (
          <table className="w-full text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-1 text-start font-medium">{t('health.dependency')}</th>
                <th className="py-1 text-start font-medium">{t('health.status')}</th>
                <th className="py-1 text-start font-medium">{t('health.latency')}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(health.dependencies).map(([name, dep]) => (
                <tr key={name} className="border-t border-border">
                  <td className="py-1.5">{t(`health.deps.${name}`, { defaultValue: name })}</td>
                  <td className="py-1.5">
                    <StatusChip tone={dep.status === 'ok' ? 'success' : 'danger'}>
                      {dep.status}
                      {dep.detail ? ` · ${dep.detail}` : ''}
                    </StatusChip>
                  </td>
                  <td className="py-1.5 ltr">
                    {dep.latency_ms != null
                      ? `${formatNumber(dep.latency_ms, i18n.language)} ms`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <KeyValue
          items={[
            {
              label: t('health.lastChecked'),
              value: health ? formatTime(health.timestamp, i18n.language) : '—',
            },
            {
              label: socket.connected
                ? t('health.socketConnected')
                : t('health.socketDisconnected'),
              value: (
                <StatusChip tone={socket.connected ? 'success' : 'default'}>
                  {t('health.activeSessions')}:{' '}
                  {socket.activeSessions == null
                    ? '—'
                    : formatNumber(socket.activeSessions, i18n.language)}
                </StatusChip>
              ),
            },
            {
              label: t('health.heartbeat'),
              value: socket.lastHeartbeat ? formatTime(socket.lastHeartbeat, i18n.language) : '—',
            },
          ]}
        />
      </Card.Content>
    </Card>
  );
}
