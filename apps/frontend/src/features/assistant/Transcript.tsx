import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Chip } from '@heroui/react';
import { EmptyState } from '@/shared/ui';
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
        className="mb-2 text-sm font-medium text-slate-900"
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
          {turns.map((turn) => (
            <li key={turn.id} className="flex flex-col items-start gap-1">
              <Chip
                color={turn.speaker === 'avatar' ? 'accent' : 'default'}
                variant="soft"
                size="sm"
              >
                {t(
                  turn.speaker === 'avatar'
                    ? 'assistant.transcript.assistant'
                    : 'assistant.transcript.you',
                )}
              </Chip>
              <p className="text-start text-sm text-slate-700">{turn.text}</p>
            </li>
          ))}
        </ul>
      )}

      <p aria-live="polite" className="sr-only">
        {latestAvatarText ?? ''}
      </p>
    </section>
  );
}
