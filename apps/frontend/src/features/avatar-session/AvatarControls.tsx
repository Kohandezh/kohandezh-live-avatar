import { useTranslation } from 'react-i18next';
import { isApiError } from '@/shared/api';
import { speechErrorKey } from '@/features/text-to-speech';
import { Button, InlineAlert } from '@/shared/ui';
import type { AvatarSessionController } from './useAvatarSession';

interface Props {
  controller: AvatarSessionController;
  /** Draft text to send; owned by the text-to-speech composer and passed in by the page. */
  text: string;
  /** A running Egress recording must be stopped before the session can be closed. */
  recordingActive: boolean;
}

/** The backend's code under a message, left to right, so an admin can quote it (section 8). */
function ErrorCode({ error }: { error: unknown }) {
  if (!isApiError(error) || !error.serverCode) return null;
  return (
    <span dir="ltr" className="block text-xs">
      {error.serverCode}
    </span>
  );
}

export function AvatarControls({ controller, text, recordingActive }: Props) {
  const { t } = useTranslation();
  const { t: tAdmin } = useTranslation('admin');
  const { status, session, online, start, speak, interrupt, close } = controller;
  const blank = text.trim().length === 0;
  const canClose = online && session !== null && status !== 'closing' && !recordingActive;
  const startError = start.error;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('session.title')}>
        <Button
          variant="primary"
          isDisabled={!controller.canStart}
          isPending={start.isPending}
          onPress={() => start.mutate()}
        >
          {start.isPending ? t('session.starting') : t('session.start')}
        </Button>
        <Button
          variant="secondary"
          isDisabled={!controller.canSpeak || blank}
          isPending={speak.isPending}
          onPress={() => speak.mutate(text)}
        >
          {speak.isPending ? t('session.speaking') : t('session.speak')}
        </Button>
        <Button
          variant="secondary"
          isDisabled={!controller.canInterrupt}
          isPending={interrupt.isPending}
          onPress={() => interrupt.mutate()}
        >
          {t('session.interrupt')}
        </Button>
        <Button
          variant="secondary"
          isDisabled={!canClose}
          isPending={close.isPending}
          onPress={() => close.mutate()}
        >
          {close.isPending ? t('session.closing') : t('session.close')}
        </Button>
      </div>

      {session !== null && recordingActive && (
        <p className="text-xs text-muted">{t('session.closeBlocked')}</p>
      )}
      {!online && <InlineAlert status="warning">{t('app.offline')}</InlineAlert>}

      {status === 'error' && startError && (
        <InlineAlert
          status="danger"
          title={tAdmin('library.record.errors.sessionFailed')}
          onRetry={() => start.mutate()}
        >
          <ErrorCode error={startError} />
        </InlineAlert>
      )}
      {speak.error && (
        <InlineAlert
          status="danger"
          title={tAdmin(speechErrorKey(speak.error))}
          onRetry={() => speak.mutate(text)}
        >
          <ErrorCode error={speak.error} />
        </InlineAlert>
      )}
    </div>
  );
}
