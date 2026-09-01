import { Button, Card } from '@heroui/react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HealthStatusCard } from '@features/diagnostics';
import { getWebRtcCapabilities } from '@shared/platform';
import { InlineAlert, KeyValue, StatusChip } from '@shared/ui';

// Pages compose features + shared UI. No business logic here.
export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const rtc = getWebRtcCapabilities();

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="md:col-span-2">
        <Card.Header>
          <Card.Title>{t('home.title')}</Card.Title>
          <Card.Description>{t('home.intro')}</Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3">
          <InlineAlert status="warning">{t('home.creditNotice')}</InlineAlert>
          <div>
            <Button variant="primary" onPress={() => void navigate('/session')}>
              {t('home.open')}
            </Button>
          </div>
        </Card.Content>
      </Card>

      <HealthStatusCard />

      <div className="flex flex-col gap-4">
        <Card>
          <Card.Header>
            <Card.Title>{t('home.phaseTitle')}</Card.Title>
          </Card.Header>
          <Card.Content className="flex flex-col gap-2">
            <InlineAlert
              status="danger"
              title={<span className="ltr">{t('home.phaseVerdict')}</span>}
            >
              {t('home.phasePending')}
            </InlineAlert>
          </Card.Content>
        </Card>
        <Card>
          <Card.Header>
            <Card.Title>{t('home.webrtcTitle')}</Card.Title>
          </Card.Header>
          <Card.Content className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <StatusChip tone={rtc.peerConnection ? 'success' : 'danger'}>
                {rtc.peerConnection ? t('home.webrtcSupported') : t('home.webrtcUnsupported')}
              </StatusChip>
              {!rtc.secureContext && (
                <StatusChip tone="warning">{t('home.insecureContext')}</StatusChip>
              )}
            </div>
            <KeyValue
              items={[
                {
                  label: t('home.platform'),
                  value: `${rtc.platform}${rtc.native ? ' (native)' : ''}`,
                  ltr: true,
                },
              ]}
            />
          </Card.Content>
        </Card>
      </div>
    </div>
  );
}
