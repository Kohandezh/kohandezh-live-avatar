import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../utils';
import { Button } from './Button';

function BackIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5 rtl:-scale-x-100"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export interface ScreenHeaderProps {
  title: string;
  onBack?: () => void;
  backLabel?: string;
  end?: ReactNode;
  className?: string;
}

/**
 * Top row for a screen that owns no shared app header (requirement 6 removed
 * it). Used by the settings screens and, over the conversation stage, by the
 * video and audio screens.
 *
 * The start and end slots are the same fixed width whether or not they hold
 * content, so the title stays centred either way.
 */
export function ScreenHeader({
  title,
  onBack,
  backLabel,
  end,
  className,
}: ScreenHeaderProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        'safe-top flex items-center gap-2 px-4 pb-3 pt-4',
        className,
      )}
    >
      <div className="flex min-h-11 min-w-11 items-center justify-start">
        {onBack ? (
          <Button
            variant="secondary"
            isIconOnly
            onPress={onBack}
            aria-label={backLabel ?? t('settings.back')}
            className="min-h-11 min-w-11 rounded-full"
          >
            <BackIcon />
          </Button>
        ) : null}
      </div>

      <h1 className="flex-1 truncate text-center text-lg font-semibold text-foreground">
        {title}
      </h1>

      <div className="flex min-h-11 min-w-11 items-center justify-end">
        {end}
      </div>
    </div>
  );
}
