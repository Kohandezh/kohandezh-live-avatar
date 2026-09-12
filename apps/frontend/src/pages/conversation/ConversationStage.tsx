import { useEffect, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AmbientStage,
  usePrefersReducedMotion,
  type AssistantController,
} from '@/features/assistant';
import { env } from '@/shared/config/env';
import { cn } from '@/shared/utils';

export interface ConversationStageProps {
  controller: AssistantController;
  /**
   * Filled with the live media element. The caller owns the ref so it can read the
   * element for something else: the audio screen measures the avatar's voice from it.
   */
  mediaRef: RefObject<HTMLVideoElement | null>;
  className?: string;
}

/**
 * The media surface of one conversation screen: the single `<video>` the session plays
 * into, and the backdrop shown while nothing is streaming.
 *
 * Each screen mounts its own stage. The element is never moved between parents; moving it
 * in React means unmount plus remount, which detaches the MediaStream and cuts the audio.
 *
 * The audio screen renders this stage inside `sr-only`. Never hide it with `display:none`
 * (some engines stop playback) and never with `opacity` on a wrapper (any opacity below 1
 * makes an element a Backdrop Root, which blanks `backdrop-filter` on the glass inside it).
 */
export function ConversationStage({
  controller,
  mediaRef,
  className,
}: ConversationStageProps) {
  const { t } = useTranslation();
  const { status, isStreamReady, attachMedia } = controller;
  const reducedMotion = usePrefersReducedMotion();
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    attachMedia(mediaRef.current);
    return () => attachMedia(null);
  }, [attachMedia, mediaRef]);

  const isStreaming = status === 'connected' && isStreamReady;

  // A media query cannot pause a video, so the reduced-motion branch happens here: the
  // still ambient stage replaces the loop entirely.
  const showPreview =
    env.assistantPreviewVideo !== null && !previewFailed && !reducedMotion;

  // What the stage is actually showing. A test can read this instead of guessing from
  // pixels, the same way the audio sphere exposes `data-sphere-state`.
  const stageMode = isStreaming ? 'live' : showPreview ? 'preview' : 'ambient';

  return (
    <div
      data-stage-mode={stageMode}
      className={cn(
        'relative h-full w-full overflow-hidden bg-background',
        className,
      )}
    >
      {!isStreaming &&
        (showPreview ? (
          <video
            // `muted` is not optional: iOS refuses silent autoplay without it.
            src={env.assistantPreviewVideo ?? undefined}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden="true"
            tabIndex={-1}
            // A missing or unplayable file must not leave a black hole on the first
            // screen of the product.
            onError={() => setPreviewFailed(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <AmbientStage />
        ))}

      {/*
        The opacity sits on the `<video>` itself, never on a wrapper. The element has no
        children, so it can become a Backdrop Root without costing anything; a wrapper
        would take the glass chrome down with it.
      */}
      <video
        ref={mediaRef}
        autoPlay
        playsInline
        aria-label={t('assistant.video.label')}
        className={cn(
          'absolute inset-0 h-full w-full object-cover',
          !isStreaming && 'opacity-0',
        )}
      />
    </div>
  );
}
