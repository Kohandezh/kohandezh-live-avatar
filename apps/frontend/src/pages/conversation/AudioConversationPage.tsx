import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Drawer,
  Label,
  TextArea as HeroTextArea,
  TextField,
} from '@heroui/react';
import {
  Transcript,
  useConversationScreen,
  WARNING_SECONDS,
} from '@/features/assistant';
import {
  CONTROL_REASONS,
  ConversationControlLayer,
  TranscriptIcon,
  useConversationNotice,
  useSpeakingHold,
} from '@/features/assistant/controls';
import { AssistantOrb } from '@/features/assistant/orb';
import { formatNumber } from '@/i18n';
import { Button, ErrorState, InlineAlert } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { ConversationStage } from './ConversationStage';

/** Touch targets must be at least 44 px. */
const TOUCH_TARGET = 'min-h-11';

/*
  The bottom of the content column, as an inline style rather than a utility.

  `dock-clear` reserves `--dock-clearance`, which clears the floating menu. This column has to
  clear the two bottom control circles as well, and they stand on top of that clearance. The
  short-viewport branch below drops the extra reserve again: on a landscape phone 4.5rem of it
  is most of the remaining height, and the notice line and the transcript block clear the
  circles sideways there instead.
*/
const COLUMN_BOTTOM =
  'pb-[calc(var(--dock-clearance)+4.5rem)] [@media(max-height:34rem)]:pb-[var(--dock-clearance)]';

/*
  Keeps the two reserved lines out from under the corner circles on a short screen, where the
  column has no room to sit above them. 5rem, not 4rem: the microphone is the 64 px one.

  Margin, not padding. Both lines stretch to the column's width, so padding would inset the
  text and leave the BOX full width, still sitting under the circle and still eating its taps.
  Measured in a browser: the transcript block and the interrupt circle overlapped by the
  circle's whole 48 by 48 area with padding.
*/
const CLEAR_CORNERS = '[@media(max-height:34rem)]:mx-20';

const NOTICE_TONE = {
  muted: 'text-muted',
  warning: 'text-warning',
  danger: 'text-danger',
} as const;

/**
 * The voice conversation (requirement 17).
 *
 * The orb is the screen. Four round controls sit in the four physical corners, one line of
 * text sits under the orb, and there is no container behind any of them.
 *
 * The rule this screen is built on: **nothing appears or disappears during a conversation.**
 * The control layer's lifetime is the session's lifetime, from `requesting` to `ended`. The
 * old screen grew its whole control block at the moment the connection succeeded, which is
 * exactly when the user is watching it. Now the shape is already there while it connects, and
 * only three things change inside it: whether a control can be pressed, the microphone's icon
 * and fill, and the words in the two reserved lines.
 *
 * Both reserved lines keep their height whether or not they have anything in them, so filling
 * one never pushes the orb.
 *
 * The four corners are anchored to physical screen corners and do not mirror in Persian. See
 * docs/DECISIONS/0013-physical-anchoring-for-conversation-controls.md and the
 * `control-anchor-*` comment block in globals.css. Text, both drawers and the floating menu
 * all still follow the writing direction.
 *
 * The stage is mounted here too, hidden with `sr-only`. The avatar's voice plays through a
 * media element, so the element has to exist even when nothing is shown. Never
 * `display: none` (some engines stop playback) and never `opacity-0` on a wrapper (any
 * opacity below 1 makes an element a Backdrop Root, which blanks the glass inside it). The orb
 * reads its loudness straight off that same element.
 *
 * There is no back button. Every route change has to pass the navigation guard in the floating
 * menu, which asks before it ends a live conversation, and a second exit here would walk
 * around it.
 */
export function AudioConversationPage() {
  const { t, i18n } = useTranslation();
  const { controller, stageRef } = useConversationScreen('/audio');
  const [isTranscriptOpen, setTranscriptOpen] = useState(false);
  const [isComposerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const endedRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const {
    status,
    session,
    error,
    endReason,
    online,
    transcript,
    connectionQuality,
    remainingSeconds,
    isStreamReady,
    isAudioBlocked,
    isMicMuted,
    isUserSpeaking,
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
    The control layer's whole lifetime, in one expression. Two unmounts are allowed in a
    session and neither is mid-conversation: the Start button leaves as the layer arrives, and
    the layer leaves as Restart arrives.
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
    Why each control is refused, or null when it is pressable. A refused control is dimmed but
    still focusable and still pressable, so the press can put its reason in the notice line.

    A muted microphone deliberately does NOT refuse interrupt. Talking over the avatar is the
    other way to interrupt it, and a muted user cannot do that, so this is the one user the
    button exists for.
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

  /*
    The resting text of the notice line. An ElevenLabs agent always answers in its own
    language, so the user has to know which language to speak, and that is the one part of the
    session line nobody may miss. It never changes during a session, so it does not churn.
  */
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
    // re-render four backdrop filters at 1 Hz over the orb's animation loop.
    isTimeWarning: remainingSeconds !== null && remainingSeconds <= WARNING_SECONDS,
    restingText: restingNotice,
  });

  /*
    Stable handlers, so the memoised control layer is not re-rendered by every tick of the
    countdown. Every function below the destructuring is already stable inside the session
    hook, so these only ever change when the session itself does.
  */
  const handleEnd = useCallback(() => void stop(), [stop]);
  const handleToggleMic = useCallback(() => void toggleMic(), [toggleMic]);
  const handleType = useCallback(() => setComposerOpen(true), []);

  /*
    The conversation is over, so the keyboard is moved to the news rather than left on a
    control that no longer exists. From here Tab reaches Restart.

    Both endings, not just the clean one. The control layer's mount condition is
    `isSessionOpen`, which is false for `error` as well as for `ended`, so a start that fails
    while the keyboard is on End unmounts the focused button either way. Only one of the two
    cards is ever mounted, so the pair of calls cannot fight over the focus.
  */
  useEffect(() => {
    if (status === 'ended') endedRef.current?.focus();
    if (status === 'error') errorRef.current?.focus();
  }, [status]);

  const lastTurn = transcript.at(-1);
  // The transcript survives the end of the call. In a medical conversation "what did the
  // doctor say about the dose" is asked after it, not during it, and `state.ts` keeps the
  // turns, so there is nothing to rebuild.
  const showTranscript = isSessionOpen || (hasFinished && transcript.length > 0);

  /*
    One static line for the whole session. The status chip, the sandbox chip, the agent
    language chip and the running seconds counter were four separate chips that each changed on
    their own schedule; the orb's caption already says what the status chip said.
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

  const sendDraft = () => {
    const text = draft.trim();
    if (!text) return;
    sendText(text);
    setDraft('');
    setComposerOpen(false);
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background">
      {/* Not shown, only heard. See the note on the component. */}
      <div className="sr-only">
        <ConversationStage controller={controller} mediaRef={stageRef} />
      </div>

      {/* The content column, in normal flow. `safe-inline-gutter` is the same 1rem gutter as a
          plain padding until the device has a horizontal cutout, which in landscape is on one
          side, and then it grows to clear it. This screen is full bleed, so nothing else
          protects this column. */}
      <div
        className={cn(
          'stage-safe-top safe-inline-gutter mx-auto flex h-full w-full max-w-md flex-col',
          COLUMN_BOTTOM,
        )}
      >
        <h1 className="sr-only">{t('conversation.audio.title')}</h1>

        {/* Set once per session and never touched again. `px-16` keeps it clear of the two
            48 px circles beside it, and one clamped line means a long Persian string can never
            wrap down into the orb. */}
        <p className="flex min-h-12 items-center justify-center px-16 text-center text-xs text-muted">
          <span className="line-clamp-1">{sessionLine}</span>
        </p>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
          {/* The orb stays mounted in every state, error included. It is the screen's one
              picture, it has a calm drained look for an ended or failed session, and
              `data-sphere-state` is what a test reads. */}
          {/* The orb is the part that gives way when the middle of the screen runs out of room.
              Everything under it is either news or a control, and a control a user cannot reach
              is much worse than a small picture. `min-h-0` is what lets a flex item shrink below
              its content; without it this box refused to shrink and the Restart button spilled
              out of the column and landed on top of the transcript, swallowing its taps. */}
          <div className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden">
            <AssistantOrb
              // Smaller once the conversation is over. The picture has done its job by then and
              // the room goes to the message and to Restart. This is not mid-conversation churn:
              // the whole screen changes at `ended` anyway.
              className={cn('w-full', hasFinished && 'max-w-40')}
              status={status}
              isUserSpeaking={isUserSpeaking}
              isAvatarSpeaking={isAvatarSpeaking}
              isMicMuted={isMicMuted}
              mediaRef={stageRef}
            />

            {/* The browser refused to play the sound because no gesture preceded it, which is
                common on iOS. The orb becomes the button that fixes it: an overlay over what is
                already the biggest thing on the screen, so the target is enormous and not one
                pixel of the layout moves. A 44 px button inside the notice line would have
                grown that line by about 50 px at the moment of connection, pushing the orb,
                which is the one thing this screen promises never to do. */}
            {isStreaming && isAudioBlocked && (
              <button
                type="button"
                aria-label={t('assistant.video.enableAudio')}
                onClick={enableAudio}
                className="absolute inset-0 rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
            )}
          </div>

          {/* `shrink-0`, so the news and the one control below it always keep their full size
              and the squeeze goes to the orb above instead. */}
          <div className="flex w-full shrink-0 flex-col items-center gap-4 empty:hidden">
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

            {/* `ghost` keeps HeroUI from painting a filled background under the glass; the
                `glass` utility sits in Tailwind's utilities layer, which comes after HeroUI's
                component layer, so the material wins. */}
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
          </div>
        </div>

        {/* One line for everything that used to be its own chip or its own alert: offline,
            blocked audio, a control error, a weak connection, the time warning, and the reason
            a refused control was refused.

            It is a real live region, and the only one on this screen besides the orb's caption.
            Those messages were all announced before this redesign, and the orb's region carries
            only the caption, on an 800 ms debounce, so without this they would all have gone
            silent. A denied microphone raises it to a real `role="alert"`: the avatar talks, the
            user talks back, and nobody hears them. The reason a refused press was refused is the
            one message that is shown without being said, because the control it came from has
            already said it.

            Fixed height, never `min-h`: two lines of `text-xs` is 32 px inside a 44 px box, so
            no message can make this line grow and push the orb. */}
        {isSessionOpen && (
          <p
            /*
              Remounted when the role changes, never relabelled in place.

              Several screen readers read a live region's role and politeness at the moment the
              node is INSERTED and ignore a later change to them, so an element that starts as
              `role="status"` and is rewritten to `role="alert"` stays a polite status for the
              user who needed the alert. Changing the key makes React drop the old node and
              insert a new one with the role it needs. The reserved height is the same either
              way, so nothing moves when it swaps.
            */
            key={notice.isAlert ? 'alert' : 'status'}
            // Which message won, readable from outside. The same idea as the orb's
            // `data-sphere-state`: a test should not have to infer the state from pixels or
            // from a translated string.
            data-notice={notice.tone}
            role={notice.isAlert ? 'alert' : 'status'}
            /*
              `off` is not a mistake. It is the reason a refused press was refused, which the
              blocked control already read out as its own description when the user focused it.
              See `isSilent` in useConversationNotice.ts.
            */
            aria-live={
              notice.isSilent
                ? 'off'
                : notice.isAlert
                  ? 'assertive'
                  : 'polite'
            }
            aria-atomic="true"
            className={cn(
              'flex h-11 flex-wrap items-center justify-center gap-x-1 overflow-hidden px-4 text-center text-xs',
              CLEAR_CORNERS,
              NOTICE_TONE[notice.tone],
            )}
          >
            {notice.text && <span>{notice.text}</span>}
            {notice.hint && <span>{notice.hint}</span>}
          </p>
        )}

        {/* The transcript is content, not chrome. The old icon button in the top row is gone
            and the last thing said is the way in, which is a far bigger target than 44 px and
            frees the top right for typing.

            The text is `aria-hidden` and the button carries the name: a screen reader hears one
            control, not a control and then the same sentence again. */}
        {showTranscript && (
          <button
            type="button"
            aria-label={t('conversation.transcript.open')}
            onClick={() => setTranscriptOpen(true)}
            className={cn(
              'flex h-12 items-center justify-center gap-2 overflow-hidden rounded-2xl px-4 text-center text-sm text-muted',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              CLEAR_CORNERS,
            )}
          >
            <span aria-hidden="true" className="line-clamp-2">
              {lastTurn?.text ?? t('conversation.transcript.open')}
            </span>
            <TranscriptIcon className="size-4 shrink-0" />
          </button>
        )}
      </div>

      {/* The four physical corners. Outside the content column on purpose: the column is in
          flow and pays the bottom clearance, so its box is not the screen. This layer measures
          the same width but the full height, which is what an anchored control needs. */}
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

      {/*
        `isDismissable={false}` is not a style choice. HeroUI's drag-to-dismiss puts
        `touch-action: none` on the dialog, and a touch-action of none on an ancestor stops
        a finger from scrolling anything inside it. With drag off the transcript scrolls
        and the composer behaves like a normal text box. Escape and the Close button below
        still close the panel.
      */}
      <Drawer.Backdrop
        isOpen={isTranscriptOpen}
        onOpenChange={setTranscriptOpen}
        isDismissable={false}
      >
        <Drawer.Content placement="bottom">
          {/* `Transcript` renders the visible heading, so the dialog takes its name from
              the same string instead of printing it twice. */}
          <Drawer.Dialog aria-label={t('assistant.transcript.title')}>
            <Drawer.Body>
              <Transcript turns={transcript} />
            </Drawer.Body>
            <Drawer.Footer>
              <Button
                variant="tertiary"
                className={TOUCH_TARGET}
                onPress={() => setTranscriptOpen(false)}
              >
                {t('conversation.transcript.close')}
              </Button>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>

      {/* The typed turn. `sendText` has existed in the session hook with no user
          interface at all; this is it. */}
      <Drawer.Backdrop
        isOpen={isComposerOpen}
        onOpenChange={setComposerOpen}
        isDismissable={false}
      >
        <Drawer.Content placement="bottom">
          <Drawer.Dialog aria-label={t('conversation.compose.label')}>
            <Drawer.Body>
              <TextField isDisabled={!canControl} fullWidth>
                <Label>{t('conversation.compose.label')}</Label>
                <HeroTextArea
                  rows={3}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={t('conversation.compose.placeholder')}
                  dir="auto"
                />
              </TextField>
            </Drawer.Body>
            <Drawer.Footer>
              <Button
                variant="tertiary"
                className={TOUCH_TARGET}
                onPress={() => setComposerOpen(false)}
              >
                {t('conversation.compose.close')}
              </Button>
              <Button
                variant="primary"
                className={TOUCH_TARGET}
                isDisabled={!canControl || draft.trim().length === 0}
                onPress={sendDraft}
              >
                {t('conversation.compose.send')}
              </Button>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </div>
  );
}
