import { useTranslation } from 'react-i18next';
import { assetsApi } from '@/shared/api';
import { useOnline } from '@/shared/hooks';
import { formatNumber } from '@/i18n';
import { Card, Chip, type ChipProps } from '@heroui/react';
import { Button, InlineAlert, KeyValue } from '@/shared/ui';
import { useRecording } from './useRecording';
import type { RecordingStatus } from './recordingSlice';

interface Props {
  /** Connected avatar session id, or null when recording is impossible. */
  sessionId: string | null;
  text: string;
  audioAssetId: string | null;
  /** Recording needs a room we own. "managed" sessions run in LiveAvatar's room. */
  transport: 'managed' | 'byo' | null;
}

type StatusTone = NonNullable<ChipProps['color']>;

const TONE: Record<RecordingStatus, StatusTone> = {
  idle: 'default',
  starting: 'accent',
  recording: 'danger',
  finalizing: 'accent',
  done: 'success',
  error: 'danger',
};

export function RecordingControls({ sessionId, text, audioAssetId, transport }: Props) {
  const { t, i18n } = useTranslation();
  const online = useOnline();
  const rec = useRecording();
  const unsupported = transport === 'managed';
  const canStart =
    online && sessionId !== null && !unsupported && !rec.isActive && rec.status !== 'starting';
  const canStop = online && rec.isActive && rec.status !== 'finalizing';

  return (
    <Card>
      <div className="mb-4 flex flex-row flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">{t('recording.title')}</h2>
        <Chip color={TONE[rec.status]} variant="soft" size="sm">{t(`recording.status.${rec.status}`)}</Chip>
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('recording.title')}>
          {!rec.isActive ? (
            <Button
              variant="primary"
              isDisabled={!canStart}
              isPending={rec.start.isPending}
              onPress={() => sessionId && rec.start.mutate({ sessionId, text, audioAssetId })}
            >
              {rec.start.isPending ? t('recording.starting') : t('recording.start')}
            </Button>
          ) : (
            <Button
              variant="danger"
              isDisabled={!canStop}
              isPending={rec.stop.isPending}
              onPress={() => rec.stop.mutate()}
            >
              {rec.stop.isPending ? t('recording.finalizing') : t('recording.stop')}
            </Button>
          )}
        </div>

        {unsupported ? (
          <InlineAlert status="info" title={t('recording.unsupported.title')}>
            {t('recording.unsupported.body')}
          </InlineAlert>
        ) : (
          sessionId === null &&
          !rec.isActive &&
          rec.status !== 'done' && (
            <p className="text-sm text-slate-500">{t('recording.needsSession')}</p>
          )
        )}
        {rec.status === 'recording' && rec.active && (
          <InlineAlert status="danger" title={t('recording.recording')}>
            <KeyValue
              items={[
                { label: t('recording.assetId'), value: rec.active.externalId, ltr: true },
                { label: t('recording.egressId'), value: rec.active.egressId, ltr: true },
              ]}
            />
          </InlineAlert>
        )}
        {rec.status === 'error' && rec.error && (
          <InlineAlert
            status="danger"
            title={t('recording.error')}
            onRetry={rec.isActive ? () => rec.stop.mutate() : undefined}
            actions={
              !rec.isActive ? (
                <Button size="sm" variant="ghost" onPress={rec.reset}>
                  {t('app.dismiss')}
                </Button>
              ) : undefined
            }
          >
            <span className="ltr text-xs">{rec.error}</span>
          </InlineAlert>
        )}
        {rec.status === 'done' && rec.result && (
          <InlineAlert
            status="success"
            title={t('recording.done')}
            actions={
              <Button size="sm" variant="ghost" onClick={rec.reset}>
                {t('app.dismiss')}
              </Button>
            }
          >
            <div className="mt-1 flex flex-col gap-2">
              <a href={assetsApi.videoUrl(rec.result.id)} target="_blank" rel="noreferrer">
                {t('recording.download')}
              </a>
              <KeyValue
                items={[
                  { label: t('recording.assetId'), value: rec.result.id, ltr: true },
                  { label: t('health.status'), value: rec.result.status, ltr: true },
                  {
                    label: t('recording.probe'),
                    value:
                      [
                        rec.result.probe.videoCodec,
                        rec.result.probe.audioCodec,
                        rec.result.probe.width && rec.result.probe.height
                          ? `${rec.result.probe.width}×${rec.result.probe.height}`
                          : undefined,
                        rec.result.probe.durationMs !== undefined
                          ? t('tts.seconds', {
                              value: formatNumber(
                                rec.result.probe.durationMs / 1000,
                                i18n.language,
                              ),
                            })
                          : undefined,
                      ]
                        .filter(Boolean)
                        .join(' · ') || '—',
                    ltr: true,
                  },
                ]}
              />
            </div>
          </InlineAlert>
        )}
        {rec.status === 'idle' && sessionId !== null && !unsupported && (
          <p className="text-sm text-slate-500">{t('recording.idle')}</p>
        )}
      </div>
    </Card>
  );
}
