import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { describeError, isApiError } from '@/shared/api';
import { useOnline } from '@/shared/hooks';
import { formatNumber } from '@/i18n';
import { Card, TextField, Label, TextArea as HeroTextArea, Description } from '@heroui/react';
import { Button, InlineAlert } from '@/shared/ui';
import { AudioPreview } from './AudioPreview';
import { MAX_TEXT_LENGTH, selectComposerText, setComposerText } from './composerSlice';
import { useTtsGeneration } from './useTtsGeneration';

/** Persian text composer + Generate Audio + playback of the resulting asset. */
export function TtsComposer() {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch();
  const text = useSelector(selectComposerText);
  const online = useOnline();
  const tts = useTtsGeneration();
  const blank = text.trim().length === 0;

  return (
    <Card>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-foreground">{t('tts.title')}</h2>
      </div>
      <div className="flex flex-col gap-4">
        <TextField isDisabled={tts.isPending} fullWidth>
          <Label>{t('tts.label')}</Label>
          <HeroTextArea
            id="tts-text"
            name="text"
            rows={5}
            value={text}
            onChange={(event) => dispatch(setComposerText(event.target.value))}
            maxLength={MAX_TEXT_LENGTH}
            placeholder={t('tts.placeholder')}
            dir="auto"
            lang="fa"
            aria-describedby="tts-text-hint"
          />
          <Description id="tts-text-hint">
            {t('tts.hint')} ·{' '}
            {t('tts.characters', {
              count: text.length,
              count_formatted: formatNumber(text.length, i18n.language),
            })}
          </Description>
        </TextField>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            isDisabled={blank || !online || tts.isPending}
            isPending={tts.isPending}
            onPress={() => tts.generate(text)}
          >
            {tts.isPending ? t('tts.generating') : t('tts.generate')}
          </Button>
        </div>

        {!online && <InlineAlert status="warning">{t('app.offline')}</InlineAlert>}

        {tts.error && (
          <InlineAlert
            status="danger"
            title={t('tts.error')}
            onRetry={
              isApiError(tts.error) && !tts.error.isRetryable ? undefined : () => tts.generate(text)
            }
          >
            <span className="ltr text-xs">{describeError(tts.error)}</span>
          </InlineAlert>
        )}

        {tts.asset ? (
          <AudioPreview asset={tts.asset} />
        ) : (
          !tts.isPending && !tts.error && <p className="text-sm text-muted">{t('tts.empty')}</p>
        )}
      </div>
    </Card>
  );
}
