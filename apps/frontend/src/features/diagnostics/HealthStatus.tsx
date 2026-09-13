import { useTranslation } from 'react-i18next';
import { Card, Chip, type ChipProps } from '@heroui/react';
import { Button, InlineAlert, KeyValue, LoadingState } from '@/shared/ui';
import { formatNumber, formatTime } from '@/i18n';
import { useBackendHealth, type HealthLevel } from './useBackendHealth';
import { useStatusSocket } from './useStatusSocket';

type StatusTone = NonNullable<ChipProps['color']>;

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
      <Chip color={TONE[level]} variant="soft" size="sm">{levelLabel(level, t)}</Chip>
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
      <div className="mb-4 flex flex-row flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">{t('health.title')}</h2>
        <div className="flex items-center gap-2">
          <Chip color={TONE[level]} variant="soft" size="sm">{levelLabel(level, t)}</Chip>
          <Button
            size="sm"
            variant="ghost"
            isDisabled={!online || isFetching}
            onPress={() => void refetch()}
          >
            {t('health.refresh')}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-3">
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
                    <Chip color={dep.status === 'ok' ? 'success' : 'danger'} variant="soft" size="sm">
                      {dep.status}
                      {dep.detail ? ` · ${dep.detail}` : ''}
                    </Chip>
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
                <Chip color={socket.connected ? 'success' : 'default'} variant="soft" size="sm">
                  {t('health.activeSessions')}:{' '}
                  {socket.activeSessions == null
                    ? '—'
                    : formatNumber(socket.activeSessions, i18n.language)}
                </Chip>
              ),
            },
            {
              label: t('health.heartbeat'),
              value: socket.lastHeartbeat ? formatTime(socket.lastHeartbeat, i18n.language) : '—',
            },
          ]}
        />
      </div>
    </Card>
  );
}
