import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AssistantPanel, type AssistantMode } from '@/features/assistant';
import { supportedLanguages, type SupportedLanguage } from '@/i18n';
import { cn } from '@/shared/utils';
import type { WidgetPosition } from './config';
import { useFocusTrap, useIsPhone } from './hooks';

function LanguageSwitch({
  language,
  onChange,
}: {
  language: SupportedLanguage;
  onChange: (next: SupportedLanguage) => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      role="group"
      aria-label={t('language.label')}
      className="flex overflow-hidden rounded-lg border border-slate-300"
    >
      {supportedLanguages.map((candidate) => (
        <button
          key={candidate}
          type="button"
          lang={candidate}
          aria-pressed={candidate === language}
          onClick={() => onChange(candidate)}
          className={cn(
            'min-h-11 px-3 text-sm transition-colors sm:min-h-9',
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900',
            candidate === language
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-700 hover:bg-slate-100',
          )}
        >
          {t(`language.${candidate}`)}
        </button>
      ))}
    </div>
  );
}

export interface WidgetPanelProps {
  language: SupportedLanguage;
  mode: AssistantMode;
  position: WidgetPosition;
  onLanguageChange: (next: SupportedLanguage) => void;
  onClose: () => void;
}

/**
 * The panel the launcher opens: a full-screen sheet on a phone, a card anchored above the
 * launcher on a wider screen. It is only mounted while it is open, so closing it unmounts
 * `AssistantPanel`, which releases the live session in its cleanup.
 */
export function WidgetPanel({
  language,
  mode,
  position,
  onLanguageChange,
  onClose,
}: WidgetPanelProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const isPhone = useIsPhone();

  useFocusTrap(panelRef, isPhone);

  // Move focus into the panel so a keyboard or screen reader user lands on the dialog.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return;
    // The customer's page may also listen for Escape. This one is ours.
    event.stopPropagation();
    onClose();
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal={isPhone}
      aria-label={t('widget.title')}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className={cn(
        'pointer-events-auto fixed inset-0 z-10 flex flex-col overflow-hidden bg-slate-50 text-slate-900',
        'font-sans text-sm focus:outline-none',
        'sm:inset-auto sm:bottom-24 sm:max-h-[calc(100dvh-9rem)] sm:w-100 sm:rounded-2xl',
        'sm:border sm:border-slate-200 sm:shadow-2xl',
        position === 'end' ? 'sm:end-4' : 'sm:start-4',
      )}
    >
      <header className="safe-top flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <h2 className="me-auto truncate text-base font-semibold">
          {t('widget.title')}
        </h2>
        <LanguageSwitch language={language} onChange={onLanguageChange} />
        <button
          type="button"
          onClick={onClose}
          aria-label={t('widget.close')}
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-lg text-slate-600',
            'transition-colors hover:bg-slate-100 hover:text-slate-900',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900',
          )}
        >
          <svg
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12" />
            <path d="M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div className="safe-bottom flex-1 overflow-y-auto p-3">
        <AssistantPanel language={language} initialMode={mode} />
      </div>
    </div>
  );
}
