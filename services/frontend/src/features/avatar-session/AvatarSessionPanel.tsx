import { Card } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { KeyValue, StatusChip } from '@shared/ui';
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
      <Card.Header className="flex flex-row flex-wrap items-center justify-between gap-2">
        <Card.Title>{t('session.title')}</Card.Title>
        {session && (
          <StatusChip tone={session.sandbox ? 'accent' : 'warning'}>
            {session.sandbox ? t('session.sandbox') : t('session.live')}
          </StatusChip>
        )}
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
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
          <p className="text-sm text-muted">{t('session.noSession')}</p>
        )}
      </Card.Content>
    </Card>
  );
}
