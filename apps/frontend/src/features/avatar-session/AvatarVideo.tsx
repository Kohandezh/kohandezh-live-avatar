import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Spinner, StatusChip, type StatusTone } from '@/shared/ui';
import { setMediaTargets } from './livekitRoom';
import type { AvatarSessionController } from './useAvatarSession';
import type { SessionStatus } from './types';

const STATUS_TONE: Record<SessionStatus, StatusTone> = {
  idle: 'default',
  starting: 'accent',
  connecting: 'accent',
  connected: 'success',
  reconnecting: 'warning',
  disconnected: 'danger',
  closing: 'default',
  error: 'danger',
};

/** Remote avatar video from LiveKit plus every non-streaming state as an overlay. */
export function AvatarVideo({ controller }: { controller: AvatarSessionController }) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioHostRef = useRef<HTMLDivElement>(null);
  const { status, media, audioBlocked, error } = controller;

  useEffect(() => {
    setMediaTargets({ video: videoRef.current, audioHost: audioHostRef.current });
    return () => setMediaTargets({});
  }, []);

  const busy = status === 'starting' || status === 'connecting' || status === 'closing';
  const showVideo = status === 'connected' || status === 'reconnecting';

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={false}
        aria-label={t('session.video.label')}
        className={
          showVideo && media.video
            ? 'h-full w-full object-contain'
            : 'h-full w-full object-contain opacity-0'
        }
      />
      <div ref={audioHostRef} hidden />

      {!(showVideo && media.video) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-sm text-white/90">
          {busy && <Spinner className="border-t-current" />}
          {status === 'idle' && <p>{t('session.video.idle')}</p>}
          {status === 'starting' && <p>{t('session.starting')}</p>}
          {status === 'connecting' && <p>{t('session.connecting')}</p>}
          {status === 'closing' && <p>{t('session.closing')}</p>}
          {(status === 'connected' || status === 'reconnecting') && (
            <p>{t('session.video.waiting')}</p>
          )}
          {status === 'disconnected' && (
            <>
              <p>{t('session.video.disconnected')}</p>
              {error && <p className="ltr text-xs opacity-75">{error}</p>}
            </>
          )}
          {status === 'error' && (
            <>
              <p>{t('session.error')}</p>
              {error && <p className="ltr text-xs opacity-75">{error}</p>}
              <Button
                size="sm"
                variant="secondary"
                disabled={!controller.canStart}
                onClick={() => controller.start.mutate()}
              >
                {t('session.video.reconnect')}
              </Button>
            </>
          )}
        </div>
      )}

      {showVideo && audioBlocked && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/70 p-3 text-sm text-white">
          <span>{t('session.video.audioBlocked')}</span>
          <Button size="sm" variant="primary" onClick={() => void controller.enableAudio()}>
            {t('session.video.enableAudio')}
          </Button>
        </div>
      )}

      <div className="absolute top-2 start-2 flex gap-1">
        <StatusChip tone={STATUS_TONE[status]}>{t(`session.status.${status}`)}</StatusChip>
      </div>
    </div>
  );
}
