import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { TranscriptTurn } from './types';

/**
 * What was said, oldest first. New turns scroll into view, and the latest avatar answer is
 * announced once through a live region instead of re-reading the whole list.
 */
export function Transcript({ turns }: { turns: readonly TranscriptTurn[] }) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [turns.length]);

  const latestAvatarText = [...turns]
    .reverse()
    .find((turn) => turn.speaker === 'avatar')?.text;

  return (
    <section aria-labelledby="assistant-transcript-title">
      <h3
        id="assistant-transcript-title"
        className="mb-2 text-sm font-medium text-foreground"
      >
        {t('assistant.transcript.title')}
      </h3>

      {turns.length === 0 ? (
        <EmptyState
          className="py-6"
          title={t('assistant.transcript.emptyTitle')}
          description={t('assistant.transcript.empty')}
        />
      ) : (
        <ul
          ref={listRef}
          className="flex max-h-64 flex-col gap-3 overflow-y-auto"
        >
          {turns.map((turn) => {
            // The doctor answers from the start side, the user from the end side, so a glance
            // at the alignment is enough to tell the two apart.
            const isAvatar = turn.speaker === 'avatar';

            return (
              <li
                key={turn.id}
                className={cn(
                  'flex flex-col gap-1',
                  isAvatar ? 'items-start' : 'items-end',
                )}
              >
                <span className="text-xs font-medium text-muted">
                  {t(
                    isAvatar
                      ? 'assistant.transcript.assistant'
                      : 'assistant.transcript.you',
                  )}
                </span>
                <p
                  className={cn(
                    'max-w-[85%] rounded-2xl px-3 py-2 text-start text-sm',
                    isAvatar
                      ? 'rounded-ss-sm bg-accent-soft text-accent-soft-foreground'
                      : 'rounded-se-sm bg-default text-foreground',
                  )}
                >
                  {turn.text}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <p aria-live="polite" className="sr-only">
        {latestAvatarText ?? ''}
      </p>
    </section>
  );
}
