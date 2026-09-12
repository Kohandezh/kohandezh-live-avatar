import { useTranslation } from 'react-i18next';
import { Chip } from '@heroui/react';
import {
  AssistantStatusChip,
  useConversationScreen,
} from '@/features/assistant';
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

/**
 * The video conversation (requirement 16): the avatar fills the screen, and every control
 * is glass chrome drawn on top of it.
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
  } = controller;

  const isBusy = status === 'requesting' || status === 'connecting';
  const isLive = status === 'connected' || status === 'ending';
  const hasFinished = status === 'ended' || status === 'error';
  const isStreaming = status === 'connected' && isStreamReady;

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      <ConversationStage controller={controller} mediaRef={stageRef} />

      {/*
        The chrome column is the 16:9 safe area. The stage itself is full bleed, because a
        literal 16:9 box on a phone (about 9:19.5) would cover roughly a quarter of the
        screen. So the video fills the screen and the chrome stays inside the region a 16:9
        frame would occupy: `stage-16x9` caps the column at 16:9 of its own height on a
        short wide window, and at a readable column width everywhere else.
        `pointer-events-none` on the column lets taps reach the stage; each control turns
        them back on for itself.
      */}
      <div className="pointer-events-none absolute inset-0 flex justify-center">
        {/* `dock-clear` belongs here, not on the layout's `<main>`. `<main>` drops it for
            this route so the stage behind this column runs under the floating menu and
            gives its glass something to blur; this column pays the clearance instead, so
            the controls still stop above the menu. */}
        <div className="stage-safe-top stage-16x9 dock-clear flex h-full w-full flex-col gap-3 px-4">
          {/* The screen's only heading. A visible title would break "one button and
              nothing else", but a screen still needs a name for a screen reader. */}
          <h1 className="sr-only">{t('conversation.video.title')}</h1>

          {status !== 'idle' && (
            <div className="flex flex-wrap items-center gap-1">
              <AssistantStatusChip status={status} />

              {session?.sandbox && (
                <Chip color="accent" variant="soft" size="sm">
                  {t('assistant.sandbox')}
                </Chip>
              )}

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

              {/* An ElevenLabs agent always answers in its own language, so the user has
                  to know which language to speak. */}
              {session?.agentType === 'elevenlabs' && (
                <Chip variant="soft" size="sm">
                  {t('assistant.agentLanguage', {
                    language: t(`assistant.languages.${session.language}`),
                  })}
                </Chip>
              )}
            </div>
          )}

          <div className="pointer-events-auto flex flex-col gap-2">
            {!online && (
              <InlineAlert status="warning">
                {t('assistant.offline')}
              </InlineAlert>
            )}

            {/*
              A control failed while the conversation kept running. The dangerous one is
              `micPermission`: the avatar talks, the user talks back, and nobody hears
              them. It has to be visible during the call, not only after it.
            */}
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

          {/* The middle of the screen: the one thing to press, or the reason there is
              nothing to press. */}
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            {status === 'error' && error && (
              <div className="glass pointer-events-auto max-w-sm rounded-3xl px-4">
                <ErrorState
                  className="py-6"
                  title={t('assistant.errors.title')}
                  description={t(`assistant.errors.${error.kind}`)}
                />
                {error.code && (
                  <p dir="ltr" className="pb-4 text-center text-xs text-muted">
                    {t('assistant.errors.code', { code: error.code })}
                  </p>
                )}
              </div>
            )}

            {/*
              The one thing to press. `ghost` keeps HeroUI from painting a filled
              background under the glass; the `glass` utility sits in Tailwind's utilities
              layer, which comes after HeroUI's component layer, so the material wins.
            */}
            {!isLive && (
              <Button
                variant="ghost"
                onPress={() => void controller.start()}
                isPending={isBusy}
                isDisabled={!canStart}
                className="glass glass-fringe pointer-events-auto min-h-14 rounded-full px-7 text-base font-semibold text-foreground"
              >
                {t(hasFinished ? 'assistant.restart' : 'assistant.start')}
              </Button>
            )}

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

          {/*
            The browser refused to play the sound because no gesture preceded it. Common
            on iOS after a route change, and a dead end without this button: the avatar is
            talking and the user hears silence.
          */}
          {isStreaming && isAudioBlocked && (
            <div
              data-glass="strong"
              className="glass pointer-events-auto flex flex-wrap items-center justify-between gap-2 rounded-2xl p-3"
            >
              <span className="text-sm text-foreground">
                {t('assistant.video.audioBlocked')}
              </span>
              <Button
                size="sm"
                variant="secondary"
                className={TOUCH_TARGET}
                onPress={controller.enableAudio}
              >
                {t('assistant.video.enableAudio')}
              </Button>
            </div>
          )}

          {isLive && (
            <div
              data-glass="strong"
              className="glass glass-fringe pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-full p-2"
            >
              <Button
                variant="secondary"
                className={TOUCH_TARGET}
                aria-pressed={isMicMuted}
                isDisabled={!canControl}
                onPress={() => void controller.toggleMic()}
              >
                <MicIcon muted={isMicMuted} />
                {t(isMicMuted ? 'assistant.mic.unmute' : 'assistant.mic.mute')}
              </Button>

              {/* Only useful while the avatar holds the turn, so it only exists then. */}
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
      </div>
    </div>
  );
}
