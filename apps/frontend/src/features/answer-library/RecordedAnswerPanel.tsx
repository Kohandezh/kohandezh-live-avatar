import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import type { LibrarySuggestion } from '@/entities/library-entry';
import { useOnlineStatus } from '@/shared/hooks';
import { Button, ErrorState, InlineAlert, LoadingState } from '@/shared/ui';
import { SuggestedQuestions, type SuggestedQuestionsProps } from './SuggestedQuestions';
import type { RecordedAnswer } from './useRecordedAnswer';

export interface RecordedAnswerPanelProps {
  recorded: RecordedAnswer;
  suggestions: UseQueryResult<LibrarySuggestion[]>;
}

/** Retry is offered for these two only (ruling 2). A `404` answer is gone, a `429` must wait. */
const RETRYABLE = new Set(['generic', 'offline']);

/**
 * Everything under Start while the conversation is idle (REQ-056): the suggested questions, and
 * while an answer loads or plays, the loading line and Stop. The page renders it only at `idle`.
 *
 * - `loading`: the list stays, the tapped question shows a spinner and the others are disabled
 *   (ruling 1), then the loading line and Stop.
 * - `playing`, `blocked`: the list is hidden and Stop takes its place.
 * - `error`: the error line, with Retry when a retry can help, and the list under it.
 * - `finished`: see the lead card slot below.
 */
export function RecordedAnswerPanel({
  recorded,
  suggestions,
}: RecordedAnswerPanelProps) {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  const stopRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const { phase, entry, errorKind } = recorded;
  const isPlaying = phase === 'playing' || phase === 'blocked';

  useEffect(() => {
    // The list, and with it the tapped question, leaves as the answer starts. Stop is its
    // replacement, so a keyboard user whose focus went with the list lands there.
    if (phase === 'playing' && document.activeElement === document.body) {
      stopRef.current?.focus();
    }
    if (phase === 'error') errorRef.current?.focus();
  }, [phase]);

  const stopButton = (
    <Button
      ref={stopRef}
      variant="ghost"
      onPress={recorded.stop}
      className="glass min-h-11 shrink-0 rounded-full px-6 text-sm font-semibold text-foreground"
    >
      {t('library.stop')}
    </Button>
  );

  if (isPlaying) {
    return <div className="flex w-full flex-col items-center">{stopButton}</div>;
  }

  const list = (
    <SuggestionList
      suggestions={suggestions}
      onSelect={recorded.play}
      pendingId={phase === 'loading' ? (entry?.id ?? null) : null}
      isDisabled={!isOnline}
      // The lead card slot (REQ-075, REQ-061, step 9 of the rollout in spec section 11). At
      // `finished` the lead card goes HERE, in place of this list, with focus on its heading; its
      // "Other questions" button then brings the list back with focus on the played question.
      // Until step 9 the list comes back at once, with that focus.
      focusId={phase === 'finished' ? (entry?.id ?? null) : null}
    />
  );

  return (
    <div className="flex w-full flex-col items-center gap-3">
      {phase === 'error' && errorKind && (
        <div ref={errorRef} tabIndex={-1} className="w-full outline-none">
          <InlineAlert
            status="danger"
            actions={
              RETRYABLE.has(errorKind) ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="min-h-11"
                  // Like the questions: a download cannot work offline. It comes back with the
                  // connection, and the error line stays until then.
                  isDisabled={!isOnline}
                  onPress={recorded.retry}
                >
                  {t('states.retry')}
                </Button>
              ) : null
            }
          >
            {t(`library.errors.${errorKind}`)}
          </InlineAlert>
        </div>
      )}

      {list}

      {/* Always mounted, so a screen reader hears the line when it is filled in: many read a live
          region only if it existed before its text changed. */}
      <p aria-live="polite" className="text-center text-sm text-muted">
        {phase === 'loading' ? t('library.loading') : ''}
      </p>

      {phase === 'loading' && stopButton}
    </div>
  );
}

/** The list query's own states: a compact loading and error state under Start; Start still works. */
function SuggestionList({
  suggestions,
  ...listProps
}: Omit<SuggestedQuestionsProps, 'items'> & {
  suggestions: UseQueryResult<LibrarySuggestion[]>;
}) {
  const { t } = useTranslation();
  if (suggestions.isPending) return <LoadingState className="py-4" />;
  if (suggestions.isError) {
    return (
      <ErrorState
        className="py-4"
        description={t('library.suggestionsError')}
        onRetry={() => void suggestions.refetch()}
      />
    );
  }
  // Nothing at all for an empty library, on purpose (spec section 10, "empty"): a message about a
  // feature the user never saw would be noise.
  if (suggestions.data.length === 0) return null;
  return <SuggestedQuestions items={suggestions.data} {...listProps} />;
}
