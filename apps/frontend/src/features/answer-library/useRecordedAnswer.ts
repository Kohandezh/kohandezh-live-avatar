import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  fetchLibraryVideo,
  libraryEntryKeys,
  type LibraryLanguage,
  type LibrarySuggestion,
} from '@/entities/library-entry';
import { toApiError } from '@/shared/api';

export type RecordedAnswerPhase =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'blocked'
  | 'error'
  | 'finished';

/** Which line of spec section 8 a failure shows (`library.errors.<kind>`). */
export type RecordedAnswerErrorKind =
  | 'notFound'
  | 'rateLimited'
  | 'offline'
  | 'generic';

export interface RecordedAnswer {
  phase: RecordedAnswerPhase;
  /** The answer that is loading, playing, failed or just finished. Null at `idle`. */
  entry: LibrarySuggestion | null;
  errorKind: RecordedAnswerErrorKind | null;
  /** The ref of `RecordedAnswerPlayer`'s own `<video>`, never the live stage's element. */
  mediaRef: (element: HTMLVideoElement | null) => void;
  /** A tap on a question. A tap on the one already loading or playing is ignored. */
  play: (entry: LibrarySuggestion) => void;
  /** The Stop button. Ends at `finished`, keeping the entry. */
  stop: () => void;
  /** Before a live start (REQ-060): stops and revokes synchronously, then back to `idle`. */
  cancel: () => void;
  /** "Tap to play the answer", after the browser refused to autoplay (REQ-059). */
  resume: () => void;
  /** Downloads the failed answer again. */
  retry: () => void;
  /** The player's `ended` event. */
  handleEnded: () => void;
  /** The player's `error` event. */
  handleMediaError: () => void;
}

interface State {
  phase: RecordedAnswerPhase;
  entry: LibrarySuggestion | null;
  errorKind: RecordedAnswerErrorKind | null;
}

const IDLE: State = { phase: 'idle', entry: null, errorKind: null };

/**
 * The error table of section 8: a failure with no response at all is `offline`,
 * whatever `navigator.onLine` says, and a timeout is `generic`.
 */
function errorKindOf(error: unknown): RecordedAnswerErrorKind {
  const apiError = toApiError(error);
  if (apiError.status === 404) return 'notFound';
  if (apiError.status === 429) return 'rateLimited';
  if (apiError.category === 'TIMEOUT') return 'generic';
  if (apiError.isNetworkError) return 'offline';
  return 'generic';
}

function isNotAllowed(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotAllowedError';
}

/**
 * Playback of one recorded answer from the library (REQ-054).
 *
 * The whole MP4 is downloaded as a blob through the shared client, then played from a `blob:`
 * URL on the player's own element. No media URL of the API is ever put in the DOM (ADR 0014
 * item 6). One object URL at a time: it is revoked on end, on Stop, on a new tap, before a live
 * start and on unmount, and a new tap aborts the running download.
 *
 * Everything here is React state; the blob never enters the query cache.
 */
export function useRecordedAnswer(language: LibraryLanguage): RecordedAnswer {
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>(IDLE);
  const elementRef = useRef<HTMLVideoElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);
  // The phase and entry the callbacks read, so they stay stable across renders.
  const stateRef = useRef<State>(IDLE);

  /*
    A callback ref that keeps the last element after it unmounts. React clears an object ref
    before this hook's unmount cleanup runs, so leaving the route could not pause it otherwise.
  */
  const mediaRef = useCallback((element: HTMLVideoElement | null) => {
    if (element) elementRef.current = element;
  }, []);

  const update = useCallback((next: State) => {
    stateRef.current = next;
    setState(next);
  }, []);

  /** Stops whatever runs: the download, the sound, and the object URL. */
  const release = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const element = elementRef.current;
    if (element) {
      element.pause();
      // `removeAttribute` and `load`, not `src = ''`: an empty `src` fires an `error` event.
      if (element.hasAttribute('src')) {
        element.removeAttribute('src');
        element.load();
      }
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const startPlayback = useCallback(
    async (entry: LibrarySuggestion) => {
      const element = elementRef.current;
      if (!element) {
        update({ phase: 'error', entry, errorKind: 'generic' });
        return;
      }
      // A Stop, a new tap or a live start while `play()` is pending leaves this attempt behind;
      // its late answer (often an AbortError) must not change the phase again.
      const isStillWaiting = () => {
        const { phase, entry: current } = stateRef.current;
        return (
          urlRef.current !== null &&
          current === entry &&
          (phase === 'loading' || phase === 'blocked')
        );
      };
      try {
        await element.play();
        if (isStillWaiting()) update({ phase: 'playing', entry, errorKind: null });
      } catch (error) {
        if (!isStillWaiting()) return;
        if (isNotAllowed(error)) {
          update({ phase: 'blocked', entry, errorKind: null });
          return;
        }
        release();
        update({ phase: 'error', entry, errorKind: 'generic' });
      }
    },
    [release, update],
  );

  const play = useCallback(
    (entry: LibrarySuggestion) => {
      const current = stateRef.current;
      const isBusy =
        current.phase === 'loading' ||
        current.phase === 'playing' ||
        current.phase === 'blocked';
      if (isBusy && current.entry?.id === entry.id) return;

      release();
      const controller = new AbortController();
      abortRef.current = controller;
      update({ phase: 'loading', entry, errorKind: null });

      fetchLibraryVideo(entry.id, controller.signal).then(
        (blob) => {
          if (controller.signal.aborted) return;
          abortRef.current = null;
          const url = URL.createObjectURL(blob);
          urlRef.current = url;
          const element = elementRef.current;
          if (element) element.src = url;
          void startPlayback(entry);
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          abortRef.current = null;
          const errorKind = errorKindOf(error);
          if (errorKind === 'notFound') {
            // Withdrawn or unpublished meanwhile: refetch, so the entry leaves the list (REQ-062).
            void queryClient.invalidateQueries({
              queryKey: libraryEntryKeys.suggestions(language),
            });
          }
          update({ phase: 'error', entry, errorKind });
        },
      );
    },
    [language, queryClient, release, startPlayback, update],
  );

  const stop = useCallback(() => {
    const { entry } = stateRef.current;
    release();
    update({ phase: 'finished', entry, errorKind: null });
  }, [release, update]);

  const cancel = useCallback(() => {
    release();
    update(IDLE);
  }, [release, update]);

  const resume = useCallback(() => {
    const { phase, entry } = stateRef.current;
    if (phase !== 'blocked' || !entry) return;
    void startPlayback(entry);
  }, [startPlayback]);

  const retry = useCallback(() => {
    const { phase, entry } = stateRef.current;
    if (phase === 'error' && entry) play(entry);
  }, [play]);

  const handleEnded = useCallback(() => {
    if (stateRef.current.phase !== 'playing') return;
    stop();
  }, [stop]);

  const handleMediaError = useCallback(() => {
    const { phase, entry } = stateRef.current;
    // Only an element that holds an answer can fail. Clearing the `src` after a Stop cannot.
    if (!urlRef.current || (phase !== 'playing' && phase !== 'blocked' && phase !== 'loading')) {
      return;
    }
    release();
    update({ phase: 'error', entry, errorKind: 'generic' });
  }, [release, update]);

  // Leaving the route stops playback (REQ-063).
  useEffect(() => release, [release]);

  return {
    phase: state.phase,
    entry: state.entry,
    errorKind: state.errorKind,
    mediaRef,
    play,
    stop,
    cancel,
    resume,
    retry,
    handleEnded,
    handleMediaError,
  };
}
