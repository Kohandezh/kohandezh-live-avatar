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
  /**
   * Why Record stays off, if it does (REQ-036, ruling 5): no generated audio of this text yet, so
   * its length is unknown, or audio too long for one session.
   */
  recordBlock: 'needsAudio' | 'tooLong' | null;
  /**
   * False when the finished recording is not this screen's to use (another answer's text,
   * ruling 7). Then the "ready" line is left out.
   */
  isResultForThisScreen?: boolean;
}

const RECORD_BLOCK_KEYS = {
  needsAudio: 'library.record.needsAudio',
  tooLong: 'library.errors.tooLong',
} as const;

type StatusTone = NonNullable<ChipProps['color']>;

const TONE: Record<RecordingStatus, StatusTone> = {
  idle: 'default',
  starting: 'accent',
  recording: 'danger',
  finalizing: 'accent',
  done: 'success',
  error: 'danger',
};

export function RecordingControls({
  sessionId,
  text,
  audioAssetId,
  transport,
  recordBlock,
  isResultForThisScreen = true,
}: Props) {
  const { t, i18n } = useTranslation();
  const { t: tAdmin } = useTranslation('admin');
  const online = useOnline();
  const rec = useRecording();
  const unsupported = transport === 'managed';
  const canStart =
    online &&
    sessionId !== null &&
    !unsupported &&
    recordBlock === null &&
    !rec.isActive &&
    rec.status !== 'starting';
  const canStop = online && rec.isActive && rec.status !== 'finalizing';

  // The job status line of REQ-041. One polite live region, so each change is announced once.
  let jobLine: string | null = null;
  if (rec.status === 'done') {
    if (isResultForThisScreen) jobLine = tAdmin('library.record.job.done');
  } else if (rec.job.isSlow) jobLine = tAdmin('library.record.job.slow');
  else if (rec.job.status === 'queued') jobLine = tAdmin('library.record.job.queued');
  else if (rec.job.status === 'running') jobLine = tAdmin('library.record.job.running');

  return (
    <Card>
      <div className="mb-4 flex flex-row flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">{t('recording.title')}</h2>
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
              {rec.status === 'finalizing' ? t('recording.finalizing') : t('recording.stop')}
            </Button>
          )}
        </div>

        {recordBlock && !rec.isActive ? (
          <p className={recordBlock === 'tooLong' ? 'text-sm text-danger' : 'text-sm text-muted'}>
            {tAdmin(RECORD_BLOCK_KEYS[recordBlock])}
          </p>
        ) : null}

        {unsupported ? (
          <InlineAlert status="info" title={t('recording.unsupported.title')}>
            {t('recording.unsupported.body')}
          </InlineAlert>
        ) : (
          sessionId === null &&
          !rec.isActive &&
          rec.status !== 'done' && (
            <p className="text-sm text-muted">{t('recording.needsSession')}</p>
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

        <div aria-live="polite" className="flex flex-col gap-2">
          {jobLine !== null ? (
            <p className={rec.status === 'done' ? 'text-sm text-success' : 'text-sm text-foreground'}>
              {jobLine}
            </p>
          ) : null}
        </div>
        {rec.job.isSlow ? (
          <div>
            <Button size="sm" variant="secondary" onPress={rec.job.checkAgain}>
              {tAdmin('library.record.job.checkAgain')}
            </Button>
          </div>
        ) : null}
        {rec.status === 'finalizing' && rec.active && (
          <KeyValue
            items={[
              { label: t('recording.assetId'), value: rec.active.externalId, ltr: true },
              ...(rec.jobId ? [{ label: t('recording.jobId'), value: rec.jobId, ltr: true }] : []),
            ]}
          />
        )}

        {rec.status === 'error' && rec.errorKey && (
          <InlineAlert
            status="danger"
            title={tAdmin(rec.errorKey)}
            onRetry={rec.isActive ? () => rec.stop.mutate() : undefined}
            actions={
              !rec.isActive ? (
                <Button size="sm" variant="ghost" onPress={rec.reset}>
                  {t('app.dismiss')}
                </Button>
              ) : undefined
            }
          >
            {/* The code stays on its own line, in LTR, so an admin can quote it. */}
            {rec.errorCode ? (
              <span dir="ltr" className="block text-xs">
                {rec.errorCode}
              </span>
            ) : null}
          </InlineAlert>
        )}
        {rec.status === 'done' && rec.result && (
          <div className="flex flex-col gap-2">
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
                            value: formatNumber(rec.result.probe.durationMs / 1000, i18n.language),
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
        )}
        {rec.status === 'idle' && sessionId !== null && !unsupported && (
          <p className="text-sm text-muted">{t('recording.idle')}</p>
        )}
      </div>
    </Card>
  );
}
