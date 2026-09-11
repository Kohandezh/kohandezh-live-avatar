import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Card, Chip, type ChipProps } from '@heroui/react';
import { Button } from '@/shared/ui';
import { formatNumber, formatTime } from '@/i18n';
import { clearLog, selectLogEvents, type LogLevel } from './eventLogSlice';

type StatusTone = NonNullable<ChipProps['color']>;

const LEVEL_TONE: Record<LogLevel, StatusTone> = {
  info: 'accent',
  warn: 'warning',
  error: 'danger',
};

/** Structured, newest-first event log. Machine strings are rendered LTR inside the RTL page. */
export function DiagnosticsPanel() {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch();
  const events = useSelector(selectLogEvents);

  return (
    <Card>
      <div className="mb-4 flex flex-row flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">{t('diagnostics.title')}</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">
            {t('diagnostics.events', {
              count: events.length,
              count_formatted: formatNumber(events.length, i18n.language),
            })}
          </span>
          <Button
            size="sm"
            variant="ghost"
            isDisabled={events.length === 0}
            onPress={() => dispatch(clearLog())}
          >
            {t('diagnostics.clear')}
          </Button>
        </div>
      </div>
      <div>
        {events.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">{t('diagnostics.empty')}</p>
        ) : (
          <ol
            className="ltr max-h-80 divide-y divide-border overflow-auto text-sm"
            aria-label={t('diagnostics.title')}
          >
            {events.map((event) => (
              <li key={event.id} className="flex flex-col gap-1 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <time dateTime={event.at} className="font-mono text-xs text-slate-500">
                    {formatTime(event.at, 'en')}
                  </time>
                  <Chip color={LEVEL_TONE[event.level]} variant="soft" size="sm">
                    {t(`diagnostics.level.${event.level}`)}
                  </Chip>
                  <span className="font-mono text-xs text-slate-500">{event.source}</span>
                  <span className="break-words">{event.message}</span>
                </div>
                {event.data !== undefined && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-slate-500">
                      {t('diagnostics.details')}
                    </summary>
                    <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-surface-secondary p-2 font-mono whitespace-pre-wrap break-all">
                      {JSON.stringify(event.data, null, 2)}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}
