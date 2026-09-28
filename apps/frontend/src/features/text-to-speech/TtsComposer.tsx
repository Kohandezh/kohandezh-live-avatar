import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/shared/api';
import { useOnline } from '@/shared/hooks';
import { formatNumber } from '@/i18n';
import { Card, TextField, Label, TextArea as HeroTextArea, Description } from '@heroui/react';
import { Button, InlineAlert } from '@/shared/ui';
import { AudioPreview } from './AudioPreview';
import { MAX_TEXT_LENGTH, selectComposerText, setComposerText } from './composerSlice';
import { speechErrorKey } from './speechErrors';
import { useTtsGeneration } from './useTtsGeneration';

interface Props {
  /**
   * An approved text to speak as it is (REQ-074). The field shows it read only, and the
   * operator's own draft stays in the composer slice untouched.
   */
  lockedText?: string;
}

/** Persian text composer + Generate Audio + playback of the resulting asset. */
export function TtsComposer({ lockedText }: Props) {
  const { t, i18n } = useTranslation();
  const { t: tAdmin } = useTranslation('admin');
  const dispatch = useDispatch();
  const draft = useSelector(selectComposerText);
  const text = lockedText ?? draft;
  const isLocked = lockedText !== undefined;
  const online = useOnline();
  const tts = useTtsGeneration();
  const blank = text.trim().length === 0;

  return (
    <Card>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-foreground">{t('tts.title')}</h2>
      </div>
      <div className="flex flex-col gap-4">
        <TextField isDisabled={tts.isPending} isReadOnly={isLocked} fullWidth>
          <Label>{t('tts.label')}</Label>
          <HeroTextArea
            id="tts-text"
            name="text"
            rows={5}
            value={text}
            onChange={(event) => {
              if (!isLocked) dispatch(setComposerText(event.target.value));
            }}
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
            title={tAdmin(speechErrorKey(tts.error))}
            onRetry={() => tts.generate(text)}
          >
            {/* The code stays on its own line, in LTR, so an admin can quote it. */}
            {isApiError(tts.error) && tts.error.serverCode ? (
              <span dir="ltr" className="block text-xs">
                {tts.error.serverCode}
              </span>
            ) : null}
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
