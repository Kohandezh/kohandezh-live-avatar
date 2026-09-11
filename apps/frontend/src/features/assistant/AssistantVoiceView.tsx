import { useTranslation } from 'react-i18next';
import { formatNumber } from '@/i18n';
import { Card, LoadingState, StatusChip } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { AssistantStatusChip } from './AssistantStatusChip';
import type { AssistantController } from './useAssistantSession';

const WARNING_SECONDS = 15;

function WaveIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('size-10', active && 'motion-safe:animate-pulse')}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 10v4" />
      <path d="M8 7v10" />
      <path d="M12 4v16" />
      <path d="M16 7v10" />
      <path d="M20 10v4" />
    </svg>
  );
}

/**
 * Voice mode: no picture, just who is talking and how much time is left.
 * The video element itself stays mounted in the panel so the sound keeps playing.
 */
export function AssistantVoiceView({
  controller,
}: {
  controller: AssistantController;
}) {
  const { t, i18n } = useTranslation();
  const {
    status,
    isAvatarSpeaking,
    isUserSpeaking,
    isMicMuted,
    remainingSeconds,
  } = controller;

  if (status === 'requesting' || status === 'connecting') {
    return (
      <Card className="shadow-none">
        <LoadingState label={t(`assistant.status.${status}`)} />
      </Card>
    );
  }

  const message = () => {
    if (status !== 'connected') return t(`assistant.voice.${status}`);
    if (isAvatarSpeaking) return t('assistant.voice.speaking');
    if (isMicMuted) return t('assistant.voice.muted');
    if (isUserSpeaking) return t('assistant.voice.listening');
    return t('assistant.voice.ready');
  };

  const ringClass = () => {
    if (status !== 'connected') return 'border-slate-200 text-slate-400';
    if (isAvatarSpeaking) return 'border-indigo-300 text-indigo-600';
    if (isMicMuted) return 'border-amber-300 text-amber-600';
    if (isUserSpeaking) return 'border-emerald-300 text-emerald-600';
    return 'border-slate-300 text-slate-600';
  };

  return (
    <Card className="flex flex-col items-center gap-3 py-10 shadow-none">
      <div
        className={cn(
          'flex size-24 items-center justify-center rounded-full border-4',
          ringClass(),
        )}
      >
        <WaveIcon active={isAvatarSpeaking || isUserSpeaking} />
      </div>

      <p className="text-center text-sm font-medium text-slate-700">
        {message()}
      </p>

      <div className="flex flex-wrap items-center justify-center gap-1">
        <AssistantStatusChip status={status} />
        {remainingSeconds !== null && (
          <StatusChip
            tone={remainingSeconds <= WARNING_SECONDS ? 'warning' : 'default'}
          >
            {t('assistant.remaining', {
              seconds: formatNumber(remainingSeconds, i18n.language),
            })}
          </StatusChip>
        )}
      </div>
    </Card>
  );
}
