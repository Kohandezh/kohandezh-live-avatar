import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Chip,
  Drawer,
  Label,
  TextArea as HeroTextArea,
  TextField,
} from '@heroui/react';
import {
  AssistantStatusChip,
  Transcript,
  useConversationScreen,
} from '@/features/assistant';
import { AssistantSphere } from '@/features/assistant/sphere';
import { formatNumber } from '@/i18n';
import { Button, ErrorState, InlineAlert } from '@/shared/ui';
import { ConversationStage } from './ConversationStage';

/** Seconds left when the countdown starts to warn the user. */
const WARNING_SECONDS = 15;

/** Touch targets must be at least 44 px. */
const TOUCH_TARGET = 'min-h-11';

function MicIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      {muted && <path d="M4 4l16 16" />}
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function SoundIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 9.5h3L11 6v12l-4-3.5H4Z" />
      <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />
      <path d="M18 7a7 7 0 0 1 0 10" />
    </svg>
  );
}

function KeyboardIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8" />
    </svg>
  );
}

function TranscriptIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 5h16v11H8l-4 3V5Z" />
      <path d="M8 9h8M8 12.5h5" />
    </svg>
  );
}

/**
 * The voice conversation (requirement 17). No picture of the doctor, one sphere that shows
 * who is talking, and every control the video screen has.
 *
 * The stage is mounted here too, hidden with `sr-only`. The avatar's voice plays through a
 * media element, so the element has to exist even when nothing is shown. Never
 * `display: none` (some engines stop playback) and never `opacity-0` on a wrapper (any
 * opacity below 1 makes an element a Backdrop Root, which blanks the glass inside it).
 * The sphere reads its loudness straight off that same element.
 *
 * There is no back button. Every route change has to pass the navigation guard in the
 * floating menu, which asks before it ends a live conversation, and a second exit on this
 * screen would walk around it.
 */
export function AudioConversationPage() {
  const { t, i18n } = useTranslation();
  const { controller, stageRef } = useConversationScreen('/audio');
  const [isTranscriptOpen, setTranscriptOpen] = useState(false);
  const [isComposerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState('');

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
  } = controller;

  const isBusy = status === 'requesting' || status === 'connecting';
  const isLive = status === 'connected' || status === 'ending';
  const hasFinished = status === 'ended' || status === 'error';
  const isStreaming = status === 'connected' && isStreamReady;

  const lastTurn = transcript.at(-1);
  const lastAvatarText = [...transcript]
    .reverse()
    .find((turn) => turn.speaker === 'avatar')?.text;

  const sendDraft = () => {
    const text = draft.trim();
    if (!text) return;
    controller.sendText(text);
    setDraft('');
    setComposerOpen(false);
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background">
      {/* Not shown, only heard. See the note on the component. */}
      <div className="sr-only">
        <ConversationStage controller={controller} mediaRef={stageRef} />
      </div>

      {/* `dock-clear` here, not on the layout's `<main>`: this screen is full bleed to the
          bottom edge so the floating menu's glass has the page behind it, and this column
          pays the clearance so the controls still stop above the menu. */}
      <div className="stage-safe-top dock-clear mx-auto flex h-full w-full max-w-md flex-col gap-3 px-4">
        <h1 className="sr-only">{t('conversation.audio.title')}</h1>

        <div className="flex items-center gap-2">
          {/* Keeps the chips optically centred against the button at the end. */}
          <div className="min-h-11 min-w-11 shrink-0" aria-hidden="true" />

          <div className="flex flex-1 flex-wrap items-center justify-center gap-1">
            <AssistantStatusChip status={status} />

            {session?.sandbox && (
              <Chip color="accent" variant="soft" size="sm">
                {t('assistant.sandbox')}
              </Chip>
            )}
          </div>

          <Button
            variant="secondary"
            isIconOnly
            aria-label={t('conversation.transcript.open')}
            className="min-h-11 min-w-11 shrink-0 rounded-full"
            onPress={() => setTranscriptOpen(true)}
          >
            <TranscriptIcon />
          </Button>
        </div>

        {isLive && (
          <div className="flex flex-wrap items-center justify-center gap-1">
            {remainingSeconds !== null && (
              <Chip
                color={
                  remainingSeconds <= WARNING_SECONDS ? 'warning' : 'default'
                }
                variant="soft"
                size="sm"
              >
                {t('assistant.remaining', {
                  seconds: formatNumber(remainingSeconds, i18n.language),
                })}
              </Chip>
            )}

            {/* A good connection needs no chip. Only the bad news is worth the space. */}
            {status === 'connected' && connectionQuality === 'bad' && (
              <Chip color="warning" variant="soft" size="sm">
                {t('assistant.quality.bad')}
              </Chip>
            )}

            {/* An ElevenLabs agent always answers in its own language, so the user has to
                know which language to speak. */}
            {session?.agentType === 'elevenlabs' && (
              <Chip variant="soft" size="sm">
                {t('assistant.agentLanguage', {
                  language: t(`assistant.languages.${session.language}`),
                })}
              </Chip>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          {!online && (
            <InlineAlert status="warning">{t('assistant.offline')}</InlineAlert>
          )}

          {/* The browser refused to play the sound because no gesture preceded it. Common
              on iOS, and a dead end without the button in the control row below: the
              avatar is talking and the user hears silence. */}
          {isStreaming && isAudioBlocked && (
            <InlineAlert status="warning">
              {t('assistant.video.audioBlocked')}
            </InlineAlert>
          )}

          {/* A control failed while the conversation kept running. The dangerous one is
              `micPermission`: the avatar talks, the user talks back, and nobody hears
              them. It has to be visible during the call, not only after it. */}
          {error && status !== 'error' && (
            <InlineAlert status="danger">
              {t(`assistant.errors.${error.kind}`)}
            </InlineAlert>
          )}

          {status === 'ended' && endReason && (
            <InlineAlert status="info" title={t('assistant.ended.title')}>
              {t(`assistant.ended.${endReason}`)}
            </InlineAlert>
          )}
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          {/* The sphere stays mounted in every state, error included. It is the screen's
              one picture, it has a calm drained look for an ended or failed session, and
              `data-sphere-state` is what a test reads. */}
          <AssistantSphere
            status={status}
            isUserSpeaking={isUserSpeaking}
            isAvatarSpeaking={isAvatarSpeaking}
            isMicMuted={isMicMuted}
            mediaRef={stageRef}
          />

          {status === 'error' && error && (
            <div className="glass w-full max-w-sm rounded-3xl px-4">
              <ErrorState
                className="py-6"
                title={t('assistant.errors.title')}
                description={t(`assistant.errors.${error.kind}`)}
                onRetry={canStart ? () => void controller.start() : undefined}
              />
              {error.code && (
                <p dir="ltr" className="pb-4 text-center text-xs text-muted">
                  {t('assistant.errors.code', { code: error.code })}
                </p>
              )}
            </div>
          )}

          {/* The last thing said, quiet enough to stay behind the sphere. The screen
              reader gets it from the live region below instead. */}
          {isLive && lastTurn && (
            <p
              aria-hidden="true"
              className="line-clamp-2 text-center text-sm text-muted"
            >
              {lastTurn.text}
            </p>
          )}

          {/* `ghost` keeps HeroUI from painting a filled background under the glass; the
              `glass` utility sits in Tailwind's utilities layer, which comes after
              HeroUI's component layer, so the material wins. */}
          {!isLive && status !== 'error' && (
            <Button
              variant="ghost"
              onPress={() => void controller.start()}
              isPending={isBusy}
              isDisabled={!canStart}
              className="glass glass-fringe min-h-14 rounded-full px-7 text-base font-semibold text-foreground"
            >
              {t(hasFinished ? 'assistant.restart' : 'assistant.start')}
            </Button>
          )}
        </div>

        {isLive && (
          <div className="flex flex-col items-center gap-2">
            <div
              data-glass="strong"
              className="glass glass-fringe flex flex-wrap items-center justify-center gap-2 rounded-full p-2"
            >
              {isAudioBlocked && (
                <Button
                  variant="secondary"
                  className={TOUCH_TARGET}
                  onPress={controller.enableAudio}
                >
                  <SoundIcon />
                  {t('assistant.video.enableAudio')}
                </Button>
              )}

              {/* The main control of this screen, so it is the biggest thing in the row. */}
              <Button
                variant={isMicMuted ? 'secondary' : 'primary'}
                className="min-h-14 rounded-full px-6"
                aria-pressed={isMicMuted}
                isDisabled={!canControl}
                onPress={() => void controller.toggleMic()}
              >
                <MicIcon muted={isMicMuted} />
                {t(isMicMuted ? 'assistant.mic.unmute' : 'assistant.mic.mute')}
              </Button>

              {/* A tap on the sphere is not enough on its own: a keyboard and a screen
                  reader both need a real labelled button. */}
              {isAvatarSpeaking && (
                <Button
                  variant="secondary"
                  className={TOUCH_TARGET}
                  isDisabled={!canControl}
                  onPress={controller.interrupt}
                >
                  {t('assistant.interrupt')}
                </Button>
              )}

              <Button
                variant="secondary"
                className={TOUCH_TARGET}
                onPress={() => setComposerOpen(true)}
              >
                <KeyboardIcon />
                {t('conversation.compose.open')}
              </Button>
            </div>

            {/* Labelled, never icon-only: ending a call is not a button to guess at. */}
            <Button
              variant="danger"
              className={TOUCH_TARGET}
              isPending={status === 'ending'}
              onPress={() => void controller.stop()}
            >
              <StopIcon />
              {t('assistant.end')}
            </Button>
          </div>
        )}
      </div>

      {/*
        The transcript is a panel, but a blind user must not lose the conversation when the
        panel is closed. This live region carries the latest answer while it is, and stands
        down while the panel is open so the same line is not read twice.
      */}
      {!isTranscriptOpen && (
        <p aria-live="polite" className="sr-only">
          {lastAvatarText ?? ''}
        </p>
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
