import { useTranslation } from 'react-i18next';
import { Card, Chip } from '@heroui/react';
import { KeyValue } from '@/shared/ui';
import { AvatarControls } from './AvatarControls';
import { AvatarVideo } from './AvatarVideo';
import { useAvatarSession } from './useAvatarSession';

interface Props {
  text: string;
  recordingActive: boolean;
}

/** Video + controls + session identifiers. Owns the single useAvatarSession instance. */
export function AvatarSessionPanel({ text, recordingActive }: Props) {
  const { t } = useTranslation();
  const controller = useAvatarSession();
  const { session } = controller;

  return (
    <Card>
      <div className="mb-4 flex flex-row flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">{t('session.title')}</h2>
        {session && (
          <Chip color={session.sandbox ? 'accent' : 'warning'} variant="soft" size="sm">
            {session.sandbox ? t('session.sandbox') : t('session.live')}
          </Chip>
        )}
      </div>
      <div className="flex flex-col gap-4">
        <AvatarVideo controller={controller} />
        <AvatarControls controller={controller} text={text} recordingActive={recordingActive} />
        {session ? (
          <KeyValue
            items={[
              { label: t('session.labels.session'), value: session.id, ltr: true },
              { label: t('session.labels.provider'), value: session.providerSessionId, ltr: true },
              { label: t('session.labels.room'), value: session.roomName, ltr: true },
              { label: t('session.labels.livekit'), value: session.livekitUrl, ltr: true },
            ]}
          />
        ) : (
          <p className="text-sm text-slate-500">{t('session.noSession')}</p>
        )}
      </div>
    </Card>
  );
}
