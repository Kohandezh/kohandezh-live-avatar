import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '@/i18n';
import { Button, Spinner, StatusChip } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { AssistantStatusChip } from './AssistantStatusChip';
import type { AssistantController } from './useAssistantSession';

/** Seconds left when the countdown starts to warn the user. */
const WARNING_SECONDS = 15;

/**
 * The avatar video plus every non-streaming state as an overlay.
 * The element stays mounted in voice mode (hidden by the panel) so the audio keeps playing.
 */
export function AssistantVideo({
  controller,
}: {
  controller: AssistantController;
}) {
  const { t, i18n } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const {
    status,
    isStreamReady,
    isAudioBlocked,
    remainingSeconds,
    attachMedia,
  } = controller;

  useEffect(() => {
    attachMedia(videoRef.current);
    return () => attachMedia(null);
  }, [attachMedia]);

  const isStreaming = status === 'connected' && isStreamReady;
  const isBusy = status === 'requesting' || status === 'connecting';

  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-slate-900 sm:aspect-video">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        aria-label={t('assistant.video.label')}
        className={cn(
          'h-full w-full object-contain',
          !isStreaming && 'opacity-0',
        )}
      />

      {!isStreaming && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-sm text-white/90">
          {isBusy && <Spinner className="border-t-current" />}
          {status === 'idle' && <p>{t('assistant.video.idle')}</p>}
          {isBusy && <p>{t(`assistant.status.${status}`)}</p>}
          {status === 'connected' && <p>{t('assistant.video.waiting')}</p>}
          {status === 'ending' && <p>{t('assistant.status.ending')}</p>}
          {status === 'ended' && <p>{t('assistant.video.ended')}</p>}
          {/* The panel shows the full error above; the box only repeats the state. */}
          {status === 'error' && <p>{t('assistant.status.error')}</p>}
        </div>
      )}

      {isStreaming && isAudioBlocked && (
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-2 bg-slate-900/80 p-3 text-sm text-white">
          <span>{t('assistant.video.audioBlocked')}</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={controller.enableAudio}
          >
            {t('assistant.video.enableAudio')}
          </Button>
        </div>
      )}

      <div className="absolute top-2 start-2 flex flex-wrap items-center gap-1">
        <AssistantStatusChip status={status} />
        {remainingSeconds !== null && (
          <StatusChip
            tone={remainingSeconds <= WARNING_SECONDS ? 'warning' : 'default'}
          >
            {t('assistant.remaining', {
              seconds: formatNumber(remainingSeconds, i18n.language),
            })}
          </StatusChip>
        )}
      </div>
    </div>
  );
}
