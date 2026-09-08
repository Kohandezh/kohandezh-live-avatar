import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { assetsApi, describeError } from '@/shared/api';
import { formatNumber } from '@/i18n';
import { InlineAlert, KeyValue, LoadingState, StatusChip } from '@/shared/ui';
import { pcm16ToWav } from '@/shared/utils';
import { useAudioPcm, type AudioAsset } from '@/entities/audio-asset';

/** Plays a generated asset with the native, keyboard-accessible `<audio>` element. */
export function AudioPreview({ asset }: { asset: AudioAsset }) {
  const { t, i18n } = useTranslation();
  const pcm = useAudioPcm(asset.id);

  const objectUrl = useMemo(
    () => (pcm.data ? URL.createObjectURL(pcm16ToWav(pcm.data, asset.sampleRate, 1)) : null),
    [pcm.data, asset.sampleRate],
  );
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  return (
    <section aria-label={t('tts.preview')} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone={asset.cacheHit ? 'accent' : 'success'}>
          {asset.cacheHit ? t('tts.cacheHit') : t('tts.cacheMiss')}
        </StatusChip>
        <StatusChip tone="default">
          {t('tts.duration')}:{' '}
          {t('tts.seconds', { value: formatNumber(asset.durationMs / 1000, i18n.language) })}
        </StatusChip>
      </div>
      {pcm.isPending && <LoadingState label={t('tts.loadingPreview')} />}
      {pcm.isError && (
        <InlineAlert status="danger" onRetry={() => void pcm.refetch()}>
          {t('tts.previewError')}{' '}
          <span className="ltr text-xs opacity-80">{describeError(pcm.error)}</span>
        </InlineAlert>
      )}
      {objectUrl && (
        <audio
          controls
          src={objectUrl}
          className="w-full"
          aria-label={t('tts.preview')}
          preload="auto"
        />
      )}
      <KeyValue
        items={[
          { label: t('tts.assetId'), value: asset.id, ltr: true },
          {
            label: t('tts.download'),
            value: (
              <a
                href={assetsApi.audioUrl(asset.id)}
                target="_blank"
                rel="noreferrer"
                className="ltr text-xs underline"
              >
                {asset.cacheKey.slice(0, 16)}….pcm
              </a>
            ),
            ltr: true,
          },
        ]}
      />
    </section>
  );
}
