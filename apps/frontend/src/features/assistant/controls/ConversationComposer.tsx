import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Drawer,
  Label,
  TextArea as HeroTextArea,
  TextField,
} from '@heroui/react';
import { Button } from '@/shared/ui';

/** Touch targets must be at least 44 px. */
const TOUCH_TARGET = 'min-h-11';

export interface ConversationComposerProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** False while the session cannot take a turn. The field and Send both refuse. */
  canSend: boolean;
  /** Receives the trimmed text. The drawer closes and clears itself afterwards. */
  onSend: (text: string) => void;
}

/**
 * The typed turn, for a user who cannot or does not want to speak.
 *
 * Shared by both conversation screens, which is the only reason it is a component rather
 * than markup in a page: `/audio` and `/video` open the same drawer from the same corner
 * control, and two copies of a text box would drift apart.
 *
 * The draft lives here, not in the page. Nothing outside the drawer reads it, and keeping it
 * here means an unsent sentence survives closing and reopening the drawer without either
 * page holding state it does not use.
 *
 * `isDismissable={false}` is not a style choice. HeroUI's drag-to-dismiss puts
 * `touch-action: none` on the dialog, and a touch-action of none on an ancestor stops a
 * finger from scrolling anything inside it. With drag off the field behaves like a normal
 * text box. Escape and the Close button still close the drawer.
 */
export function ConversationComposer({
  isOpen,
  onOpenChange,
  canSend,
  onSend,
}: ConversationComposerProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
    onOpenChange(false);
  };

  return (
    <Drawer.Backdrop
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={false}
    >
      <Drawer.Content placement="bottom">
        <Drawer.Dialog aria-label={t('conversation.compose.label')}>
          <Drawer.Body>
            <TextField isDisabled={!canSend} fullWidth>
              <Label>{t('conversation.compose.label')}</Label>
              <HeroTextArea
                rows={3}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t('conversation.compose.placeholder')}
                dir="auto"
              />
            </TextField>
          </Drawer.Body>
          <Drawer.Footer>
            <Button
              variant="tertiary"
              className={TOUCH_TARGET}
              onPress={() => onOpenChange(false)}
            >
              {t('conversation.compose.close')}
            </Button>
            <Button
              variant="primary"
              className={TOUCH_TARGET}
              isDisabled={!canSend || draft.trim().length === 0}
              onPress={send}
            >
              {t('conversation.compose.send')}
            </Button>
          </Drawer.Footer>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
