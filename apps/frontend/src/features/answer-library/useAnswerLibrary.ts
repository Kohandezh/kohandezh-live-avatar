import { useTranslation } from 'react-i18next';
import {
  useLibrarySuggestions,
  type LibraryLanguage,
} from '@/entities/library-entry';
import type { AssistantStatus } from '@/features/assistant';
import { useRecordedAnswer } from './useRecordedAnswer';

/**
 * What `/video` and `/audio` share of the answer library: the suggestions of the screen language,
 * fetched only while the live conversation is `idle` (REQ-051), and the one recorded answer.
 */
export function useAnswerLibrary(status: AssistantStatus) {
  const { i18n } = useTranslation();
  // The screen's language, the same rule as `useConversationScreen`.
  const language: LibraryLanguage = i18n.language.startsWith('fa') ? 'fa' : 'en';
  const suggestions = useLibrarySuggestions(language, {
    enabled: status === 'idle',
  });
  const recorded = useRecordedAnswer(language);
  return { suggestions, recorded };
}
