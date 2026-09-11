import type { Key } from 'react';
import { useTranslation } from 'react-i18next';
import { ToggleButton, ToggleButtonGroup } from '@heroui/react';
import { Button } from '@/shared/ui';
import type { AssistantMode } from './types';
import type { AssistantController } from './useAssistantSession';

/** Touch targets must be at least 44 px, which is one step above the default button height. */
const TOUCH_TARGET = 'min-h-11';

const MODES: readonly AssistantMode[] = ['voice', 'video'];

function isMode(value: Key): value is AssistantMode {
  return MODES.includes(value as AssistantMode);
}

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
 * Voice or video. Single selection, so React Aria renders a radio group: the two buttons carry
 * role="radio" and arrow keys move between them.
 */
function ModeToggle({
  mode,
  onChange,
}: {
  mode: AssistantMode;
  onChange: (mode: AssistantMode) => void;
}) {
  const { t } = useTranslation();

  function handleSelectionChange(keys: Set<Key>) {
    const [next] = [...keys];
    if (next !== undefined && isMode(next)) onChange(next);
  }

  return (
    <ToggleButtonGroup
      aria-label={t('assistant.mode.label')}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[mode]}
      onSelectionChange={handleSelectionChange}
    >
      {MODES.map((candidate, index) => (
        <ToggleButton key={candidate} id={candidate} className={TOUCH_TARGET}>
          {index > 0 && <ToggleButtonGroup.Separator />}
          {t(`assistant.mode.${candidate}`)}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
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
