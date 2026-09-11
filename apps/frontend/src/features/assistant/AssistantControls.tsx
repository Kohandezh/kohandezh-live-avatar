import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { AssistantMode } from './types';
import type { AssistantController } from './useAssistantSession';

/** Touch targets must be at least 44 px, which is one step above the default button height. */
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

function ModeToggle({
  mode,
  onChange,
}: {
  mode: AssistantMode;
  onChange: (mode: AssistantMode) => void;
}) {
  const { t } = useTranslation();
  const modes: AssistantMode[] = ['voice', 'video'];

  return (
    <div
      role="group"
      aria-label={t('assistant.mode.label')}
      className="inline-flex rounded-lg border border-slate-300 p-0.5"
    >
      {modes.map((candidate) => (
        <button
          key={candidate}
          type="button"
          aria-pressed={mode === candidate}
          onClick={() => onChange(candidate)}
          className={cn(
            'min-h-11 rounded-md px-4 text-sm font-medium transition-colors',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900',
            mode === candidate
              ? 'bg-slate-900 text-white'
              : 'text-slate-700 hover:bg-slate-100',
          )}
        >
          {t(`assistant.mode.${candidate}`)}
        </button>
      ))}
    </div>
  );
}

/** Start / microphone / interrupt / end, plus the voice-video switch. */
export function AssistantControls({
  controller,
}: {
  controller: AssistantController;
}) {
  const { t } = useTranslation();
  const { status, canStart, canControl, isMicMuted, mode } = controller;
  const isLive = status === 'connected' || status === 'ending';
  const hasFinished = status === 'ended' || status === 'error';

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {isLive ? (
          <>
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
            <Button
              variant="secondary"
              className={TOUCH_TARGET}
              isDisabled={!canControl}
              onPress={controller.interrupt}
            >
              {t('assistant.interrupt')}
            </Button>
            <Button
              variant="danger"
              className={TOUCH_TARGET}
              isPending={status === 'ending'}
              onPress={() => void controller.stop()}
            >
              <StopIcon />
              {t('assistant.end')}
            </Button>
          </>
        ) : (
          <Button
            className={TOUCH_TARGET}
            isPending={status === 'requesting' || status === 'connecting'}
            isDisabled={!canStart}
            onPress={() => void controller.start()}
          >
            {t(hasFinished ? 'assistant.restart' : 'assistant.start')}
          </Button>
        )}
      </div>

      <ModeToggle mode={mode} onChange={controller.setMode} />
    </div>
  );
}
