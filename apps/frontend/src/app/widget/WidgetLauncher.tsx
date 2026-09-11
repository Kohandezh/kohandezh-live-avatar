import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/utils';
import type { WidgetPosition } from './config';

function ChatIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12Z" />
      <path d="M9 11h6" />
      <path d="M9 14.5h3.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

export interface WidgetLauncherProps {
  isOpen: boolean;
  position: WidgetPosition;
  onToggle: () => void;
  ref: Ref<HTMLButtonElement>;
}

/**
 * The floating button that opens the assistant. It is the only thing the widget shows on the
 * customer's page while the panel is closed.
 */
export function WidgetLauncher({
  isOpen,
  position,
  onToggle,
  ref,
}: WidgetLauncherProps) {
  const { t } = useTranslation();

  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      aria-label={isOpen ? t('widget.close') : t('widget.open')}
      aria-expanded={isOpen}
      aria-haspopup="dialog"
      className={cn(
        'pointer-events-auto fixed bottom-4 z-0 size-14 items-center justify-center',
        'rounded-full bg-slate-900 text-white shadow-lg transition-colors hover:bg-slate-700',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900',
        position === 'end' ? 'end-4' : 'start-4',
        // The open panel covers the whole phone screen and carries its own close button.
        // `hidden` and `flex` are both display utilities, so only one of them is applied.
        isOpen ? 'hidden sm:flex' : 'flex',
      )}
    >
      {isOpen ? <CloseIcon /> : <ChatIcon />}
    </button>
  );
}
