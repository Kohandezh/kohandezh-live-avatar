import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { RecordedAnswer } from './useRecordedAnswer';

export interface RecordedAnswerPlayerProps {
  recorded: RecordedAnswer;
  /**
   * `video`: the recorded video covers the stage, full bleed (REQ-057).
   * `audio`: a bare element for the page's `sr-only` wrapper, heard and never seen (REQ-058).
   */
  variant: 'video' | 'audio';
}

/**
 * The recorded answer's own `<video playsInline>` (REQ-055). It never touches the live stage's
 * element, so the live session's attach guard is not involved.
 *
 * `useRecordedAnswer` sets its `src` to a `blob:` URL once the whole file has downloaded. The page
 * mounts this from the tap on, so the element exists when the file arrives.
 */
export function RecordedAnswerPlayer({ recorded, variant }: RecordedAnswerPlayerProps) {
  const { phase, mediaRef, handleEnded, handleMediaError, resume } = recorded;
  const isShown = phase === 'playing' || phase === 'blocked';

  const element = (
    <video
      ref={mediaRef}
      playsInline
      preload="auto"
      aria-hidden="true"
      tabIndex={-1}
      onEnded={handleEnded}
      onError={handleMediaError}
      className={cn(
        'absolute inset-0 h-full w-full object-cover',
        // On the element itself, never on a wrapper: an opacity below 1 on a wrapper would blank
        // the glass drawn over it (see ConversationStage).
        !isShown && 'opacity-0',
      )}
    />
  );

  if (variant === 'audio') return element;

  return (
    // Transparent until the answer plays, so the stage stays visible while the file downloads.
    <div className={cn('absolute inset-0', isShown && 'bg-background')}>
      {element}
      {phase === 'blocked' && <TapToPlayOverlay onPress={resume} />}
    </div>
  );
}

/** "Recorded answer", so nobody takes the answer for a live one. */
export function RecordedAnswerLabel() {
  const { t } = useTranslation();
  return (
    <span className="glass shrink-0 rounded-full px-3 py-1 text-xs font-medium text-foreground">
      {t('library.recordedLabel')}
    </span>
  );
}

/**
 * The answer text. On `/video` it is the text alternative of the recorded speech. Up to 480
 * characters, so it scrolls inside about a third of the screen.
 */
export function RecordedAnswerCaption({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t('library.captionLabel')}
      // A scrollable region has to be reachable by keyboard to be scrollable by keyboard.
      tabIndex={0}
      className="glass max-h-[33dvh] min-h-0 w-full overflow-y-auto rounded-2xl px-4 py-3 text-start text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-accent"
    >
      <p>{text}</p>
    </section>
  );
}

/**
 * Moves the keyboard focus to the element when it mounts. "Tap to play" takes the focus: the
 * question or the Stop button that had it may be gone, and this is now the one thing to press.
 */
function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

/**
 * The browser refused to autoplay after the download, which is common on iOS (REQ-059). On
 * `/video` the whole video is the button, as on the live screen's sound overlay, and a visible
 * pill says what the tap does. The pill sits in the upper half, because Start is in the middle.
 */
function TapToPlayOverlay({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const ref = useFocusOnMount<HTMLButtonElement>();
  return (
    <button
      ref={ref}
      type="button"
      onClick={onPress}
      className="absolute inset-0 flex flex-col items-center focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-accent"
    >
      <span className="flex h-1/2 items-center">
        <span className="glass rounded-full px-4 py-2 text-sm font-semibold text-foreground">
          {t('library.tapToPlay')}
        </span>
      </span>
    </button>
  );
}

/**
 * "Tap to play the answer" on `/audio` (REQ-059). The player is inside the `sr-only` wrapper and
 * cannot be seen or tapped, so this shows in place of the caption, under the orb.
 */
export function TapToPlayButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const ref = useFocusOnMount<HTMLButtonElement>();
  return (
    <Button
      ref={ref}
      variant="ghost"
      onPress={onPress}
      className="glass min-h-11 rounded-full px-5 text-sm font-semibold text-foreground"
    >
      {t('library.tapToPlay')}
    </Button>
  );
}
