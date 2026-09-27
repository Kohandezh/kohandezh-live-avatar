import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibrarySuggestion } from '@/entities/library-entry';
import { Button } from '@/shared/ui';

export interface SuggestedQuestionsProps {
  items: LibrarySuggestion[];
  onSelect: (entry: LibrarySuggestion) => void;
  /** The question whose answer is downloading. It shows a spinner; the others are disabled. */
  pendingId: string | null;
  /** Offline: nothing can be downloaded, so nothing can be pressed. */
  isDisabled: boolean;
  /** Receives the keyboard focus when set, for example the question that was just played. */
  focusId: string | null;
}

/**
 * The suggested questions under Start (REQ-056). Full-width glass buttons, one per question,
 * each a 44 px target. A long question is clamped to two lines on screen; the button's accessible
 * name is still the whole question, because the clamp only hides overflow.
 */
export function SuggestedQuestions({
  items,
  onSelect,
  pendingId,
  isDisabled,
  focusId,
}: SuggestedQuestionsProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (focusId) buttonRefs.current.get(focusId)?.focus();
  }, [focusId]);

  return (
    <section aria-labelledby={headingId} className="w-full">
      <h2 id={headingId} className="sr-only">
        {t('library.suggestionsTitle')}
      </h2>
      <ul aria-labelledby={headingId} className="flex w-full flex-col gap-2">
        {items.map((entry) => (
          <li key={entry.id}>
            <Button
              ref={(node: HTMLButtonElement | null) => {
                if (node) buttonRefs.current.set(entry.id, node);
                else buttonRefs.current.delete(entry.id);
              }}
              variant="ghost"
              fullWidth
              isPending={pendingId === entry.id}
              isDisabled={isDisabled || (pendingId !== null && pendingId !== entry.id)}
              onPress={() => onSelect(entry)}
              className="glass h-auto min-h-11 justify-start rounded-2xl px-4 py-2 text-start text-sm font-medium whitespace-normal text-foreground"
            >
              <span className="line-clamp-2">{entry.question}</span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
