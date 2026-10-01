import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useLibraryFollowUps,
  useLibrarySuggestions,
  type LibraryLanguage,
  type LibrarySuggestion,
} from '@/entities/library-entry';
import type { AssistantStatus } from '@/features/assistant';
import { useRecordedAnswer } from './useRecordedAnswer';

/** The lead card shows up to three follow-ups (REQ-075). */
const MAX_FOLLOW_UPS = 3;

/**
 * What `/video` and `/audio` share of the answer library: the suggestions of the screen language,
 * fetched only while the live conversation is `idle` (REQ-051), the one recorded answer, and the
 * lead card that follows it (REQ-075).
 *
 * The lead card's state is React state of the page that calls this (spec, state ownership):
 * whether the visitor went back to the list, and whether the last live start came from the lead
 * card, which decides what a failed start shows (REQ-078).
 *
 * `start` is the conversation controller's live start. Both ways in go through here, so a
 * recorded answer is always stopped before it (REQ-060) and the origin is always recorded.
 */
export function useAnswerLibrary(status: AssistantStatus, start: () => Promise<void>) {
  const { i18n } = useTranslation();
  // The screen's language, the same rule as `useConversationScreen`.
  const language: LibraryLanguage = i18n.language.startsWith('fa') ? 'fa' : 'en';
  const suggestions = useLibrarySuggestions(language, {
    enabled: status === 'idle',
  });
  const recorded = useRecordedAnswer(language);
  const { play, cancel } = recorded;

  const [isListRequested, setListRequested] = useState(false);
  const [isFollowUpPlaying, setFollowUpPlaying] = useState(false);
  const [isStartFromLead, setStartFromLead] = useState(false);

  // Only at `idle`: a recorded answer is not a live session, so the status stays `idle` from the
  // tap to the lead card, and the card leaves as the live session starts (owner decision 3).
  const isLeadCardShown =
    status === 'idle' && recorded.phase === 'finished' && !isListRequested;
  const followUps = useLibraryFollowUps(
    isLeadCardShown ? (recorded.entry?.id ?? null) : null,
  );

  const playSuggestion = useCallback(
    (entry: LibrarySuggestion) => {
      setListRequested(false);
      setFollowUpPlaying(false);
      play(entry);
    },
    [play],
  );

  // "Exactly like a suggestion", except that the list was not on screen, so it does not come back
  // while the answer loads.
  const playFollowUp = useCallback(
    (entry: LibrarySuggestion) => {
      setListRequested(false);
      setFollowUpPlaying(true);
      play(entry);
    },
    [play],
  );

  const showQuestions = useCallback(() => setListRequested(true), []);

  const startLive = useCallback(
    (isFromLead: boolean) => {
      setStartFromLead(isFromLead);
      cancel();
      void start();
    },
    [cancel, start],
  );
  const startPlain = useCallback(() => startLive(false), [startLive]);
  const consult = useCallback(() => startLive(true), [startLive]);

  return {
    suggestions,
    recorded,
    playSuggestion,
    isFollowUpPlaying,
    /** Start: a plain live start, whose failure shows the error alone. */
    startLive: startPlain,
    lead: {
      isShown: isLeadCardShown,
      /** Under the error of a failed start from the lead card (REQ-078). */
      isFallbackShown: status === 'error' && isStartFromLead,
      // A failed request leaves the card without follow-ups and says nothing (section 8). The
      // backend sends at most three (REQ-077); the card never shows more, whatever it sends.
      followUps: followUps.isSuccess ? followUps.data.slice(0, MAX_FOLLOW_UPS) : [],
      playFollowUp,
      showQuestions,
      consult,
    },
  };
}
