import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConversationScreen, WARNING_SECONDS } from '@/features/assistant';
import {
  CONTROL_CLEAR_CORNERS,
  CONTROL_COLUMN_BOTTOM,
  CONTROL_REASONS,
  ConversationComposer,
  ConversationControlLayer,
  useConversationNotice,
  useSpeakingHold,
} from '@/features/assistant/controls';
import { formatNumber } from '@/i18n';
import { Button, ErrorState, InlineAlert } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { ConversationStage } from './ConversationStage';

const NOTICE_TONE = {
  muted: 'text-muted',
  warning: 'text-warning',
  danger: 'text-danger',
} as const;

/**
 * The video conversation (requirement 16): the avatar fills the screen, and every control
 * is glass chrome drawn on top of it.
 *
 * The same four physically anchored circles as `/audio`, from the same component: End top
 * left, type top right, interrupt bottom left, the microphone bottom right. They used to be
 * a row of labelled buttons in a pill at the bottom, which meant a user who switched between
 * the two conversation screens had to learn the controls twice. See
 * docs/DECISIONS/0013-physical-anchoring-for-conversation-controls.md.
 *
 * Idle is deliberately bare. One start button over the stage is the whole screen, so the
 * first thing a new user sees is a single thing to press.
 *
 * The session belongs to this page. Walking to `/audio` or `/settings` unmounts the page,
 * which closes the provider session and the backend row. The floating menu asks first.
 */
export function VideoConversationPage() {
  const { t, i18n } = useTranslation();
  const { controller, stageRef } = useConversationScreen('/video');
  const [isComposerOpen, setComposerOpen] = useState(false);
  const endedRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const {
    status,
    session,
    error,
    endReason,
    online,
    connectionQuality,
    remainingSeconds,
    isStreamReady,
    isAudioBlocked,
    isMicMuted,
    isAvatarSpeaking,
    canStart,
    canControl,
    start,
    stop,
    toggleMic,
    interrupt,
    sendText,
    enableAudio,
  } = controller;

  const isBusy = status === 'requesting' || status === 'connecting';
  const hasFinished = status === 'ended' || status === 'error';
  const isStreaming = status === 'connected' && isStreamReady;

  /*
    The control layer's lifetime, which starts before the connection does. All four controls
    mount at `requesting` and none of them appears or disappears until the session is over, so
    the screen never rearranges itself at the moment the connection succeeds.
  */
  const isSessionOpen =
    status === 'requesting' ||
    status === 'connecting' ||
    status === 'connected' ||
    status === 'ending';

  // Held for 800 ms after the avatar stops, so interrupt changes state once per answer rather
  // than blinking with every speech segment.
  const isAvatarHolding = useSpeakingHold(isAvatarSpeaking);

  /*
    Why each control is refused, or null when it is pressable. Identical to `/audio`: the two
    screens run the same session and refuse a control for the same reasons.
  */
  const micReason = canControl ? null : CONTROL_REASONS.notConnected;
  const interruptReason = !canControl
    ? CONTROL_REASONS.notConnected
    : isAvatarHolding
      ? null
      : CONTROL_REASONS.avatarNotSpeaking;
  const typeReason = !canControl
    ? CONTROL_REASONS.notConnected
    : online
      ? null
      : CONTROL_REASONS.offline;

  const restingNotice =
    session?.agentType === 'elevenlabs'
      ? t('assistant.agentLanguage', {
          language: t(`assistant.languages.${session.language}`),
        })
      : '';

  const { notice, reportBlocked } = useConversationNotice({
    status,
    online,
    isStreaming,
    isAudioBlocked,
    error,
    connectionQuality,
    // A boolean, not the number. `remainingSeconds` ticks every second; passing it down would
    // re-render four backdrop filters at 1 Hz over a playing video.
    isTimeWarning: remainingSeconds !== null && remainingSeconds <= WARNING_SECONDS,
    restingText: restingNotice,
  });

  /* Stable handlers, so the memoised control layer is not re-rendered by every tick. */
  const handleEnd = useCallback(() => void stop(), [stop]);
  const handleToggleMic = useCallback(() => void toggleMic(), [toggleMic]);
  const handleType = useCallback(() => setComposerOpen(true), []);

  useEffect(() => {
    if (status === 'ended') endedRef.current?.focus();
    if (status === 'error') errorRef.current?.focus();
  }, [status]);

  /*
    One static line for the whole session, the same as `/audio`. It replaced a row of chips
    that each changed on their own schedule, and that a corner circle would have sat on top of.
  */
  const sessionLine = [
    t('assistant.name'),
    session?.sandbox ? t('assistant.sandbox') : null,
    session
      ? t('assistant.sessionLength', {
          minutes: formatNumber(
            Math.max(1, Math.round(session.maxSessionDurationSeconds / 60)),
            i18n.language,
          ),
        })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      <ConversationStage controller={controller} mediaRef={stageRef} />

      {/*
        The chrome column is the 16:9 safe area. The stage itself is full bleed, because a
        literal 16:9 box on a phone (about 9:19.5) would cover roughly a quarter of the
        screen. So the video fills the screen and the chrome stays inside the region a 16:9
        frame would occupy. `pointer-events-none` on the column lets taps reach the stage;
        each control turns them back on for itself.

        The bottom clearance lives here and not on the layout's `<main>`: `<main>` drops it
        for this route so the stage runs under the floating menu and gives its glass
        something to blur. This column pays it instead, and pays for the two bottom circles
        on top of it.
      */}
      <div className="pointer-events-none absolute inset-0 flex justify-center">
        <div
          className={cn(
            'stage-safe-top stage-16x9 safe-inline-gutter flex h-full w-full flex-col',
            CONTROL_COLUMN_BOTTOM,
          )}
        >
          {/* The screen's only heading. A visible title would break "one button and
              nothing else", but a screen still needs a name for a screen reader. */}
          <h1 className="sr-only">{t('conversation.video.title')}</h1>

          {/* `px-16` keeps it clear of the two 48 px circles beside it, and one clamped line
              means a long Persian string can never wrap down over the avatar's face. */}
          <p className="flex min-h-12 items-center justify-center px-16 text-center text-xs">
            {sessionLine && (
              <span className="glass truncate rounded-full px-3 py-1 text-muted">
                {sessionLine}
              </span>
            )}
          </p>

          <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
            {/* The browser refused to play the sound because no gesture preceded it, which is
                common on iOS after a route change. The video becomes the button that fixes
                it: an overlay over what is already the biggest thing on the screen, so the
                target is enormous and not one pixel of the layout moves. */}
            {isStreaming && isAudioBlocked && (
              <button
                type="button"
                aria-label={t('assistant.video.enableAudio')}
                onClick={enableAudio}
                className="pointer-events-auto absolute inset-0 rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
            )}

            {/* `shrink-0`, so the news and the one control below it keep their full size. */}
            <div className="pointer-events-auto flex w-full shrink-0 flex-col items-center gap-4 empty:hidden">
              {status === 'error' && error && (
                <div
                  ref={errorRef}
                  tabIndex={-1}
                  className="glass w-full max-w-sm rounded-3xl px-4 outline-none"
                >
                  <ErrorState
                    className="py-6"
                    title={t('assistant.errors.title')}
                    description={t(`assistant.errors.${error.kind}`)}
                    onRetry={canStart ? () => void start() : undefined}
                  />
                  {error.code && (
                    <p dir="ltr" className="pb-4 text-center text-xs text-muted">
                      {t('assistant.errors.code', { code: error.code })}
                    </p>
                  )}
                </div>
              )}

              {status === 'ended' && endReason && (
                <div ref={endedRef} tabIndex={-1} className="w-full outline-none">
                  <InlineAlert status="info" title={t('assistant.ended.title')}>
                    {t(`assistant.ended.${endReason}`)}
                  </InlineAlert>
                </div>
              )}

              {/*
                The one thing to press. `ghost` keeps HeroUI from painting a filled
                background under the glass; the `glass` utility sits in Tailwind's utilities
                layer, which comes after HeroUI's component layer, so the material wins.
              */}
              {!isSessionOpen && status !== 'error' && (
                <Button
                  variant="ghost"
                  onPress={() => void start()}
                  isPending={isBusy}
                  isDisabled={!canStart}
                  className="glass glass-fringe min-h-14 rounded-full px-7 text-base font-semibold text-foreground"
                >
                  {t(hasFinished ? 'assistant.restart' : 'assistant.start')}
                </Button>
              )}

              {/* What `/audio` gets from the orb's caption. This screen has no orb, and the
                  stage behind is still black while the session is being set up, so without
                  this line the middle of the screen says nothing at all between the press
                  and the first frame. */}
              {isBusy && (
                <p className="text-sm text-muted">
                  {t(`assistant.status.${status}`)}
                </p>
              )}

              {status === 'connected' && !isStreamReady && (
                <p className="text-sm text-muted">
                  {t('assistant.video.waiting')}
                </p>
              )}
            </div>
          </div>

          {/* One line for everything that used to be its own chip or its own alert: offline,
              blocked audio, a control error, a weak connection, the time warning, and the
              reason a refused control was refused. The same line, and the same live region
              rules, as `/audio`.

              Fixed height, never `min-h`: no message may make this line grow and push the
              chrome above it. */}
          {isSessionOpen && (
            <p
              // Remounted when the role changes, never relabelled in place. Several screen
              // readers read a live region's role at the moment the node is INSERTED and
              // ignore a later change, so a status rewritten to an alert stays a status for
              // the user who needed the alert.
              key={notice.isAlert ? 'alert' : 'status'}
              data-notice={notice.tone}
              role={notice.isAlert ? 'alert' : 'status'}
              // `off` is not a mistake. It is the reason a refused press was refused, which
              // the blocked control already read out as its own description on focus.
              aria-live={
                notice.isSilent ? 'off' : notice.isAlert ? 'assertive' : 'polite'
              }
              aria-atomic="true"
              className={cn(
                'flex h-11 items-center justify-center px-4 text-center text-xs',
                CONTROL_CLEAR_CORNERS,
              )}
            >
              {notice.text && (
                <span
                  className={cn(
                    'glass flex flex-wrap items-center justify-center gap-x-1 rounded-full px-3 py-1',
                    NOTICE_TONE[notice.tone],
                  )}
                >
                  <span>{notice.text}</span>
                  {notice.hint && <span>{notice.hint}</span>}
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* The four physical corners. Outside the content column on purpose: the column pays a
          bottom clearance, so its box is not the screen. This layer measures the full height,
          which is what an anchored control needs. */}
      {isSessionOpen && (
        <ConversationControlLayer
          isEndPending={status === 'ending'}
          isMicMuted={isMicMuted}
          micReason={micReason}
          interruptReason={interruptReason}
          typeReason={typeReason}
          onEnd={handleEnd}
          onToggleMic={handleToggleMic}
          onInterrupt={interrupt}
          onType={handleType}
          onBlocked={reportBlocked}
        />
      )}

      {/* The typed turn, shared with `/audio`. */}
      <ConversationComposer
        isOpen={isComposerOpen}
        onOpenChange={setComposerOpen}
        canSend={canControl}
        onSend={sendText}
      />
    </div>
  );
}
