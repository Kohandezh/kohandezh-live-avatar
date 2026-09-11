import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AssistantPanel, type AssistantMode } from '@/features/assistant';
import { supportedLanguages, type SupportedLanguage } from '@/i18n';
import { cn } from '@/shared/utils';
import type { WidgetPosition } from './config';
import { useFocusTrap, useIsPhone } from './hooks';

/*
 * Why plain buttons here and HeroUI everywhere else:
 *
 * React Aria's press handling needs its Shadow DOM support turned on (`enableShadowDOM()` from
 * react-stately, off by default). Without it a mouse press inside the widget's shadow root is
 * cancelled, because the document-level `pointerup` sees the shadow host instead of the button.
 * Touch is unaffected. Until that flag is set in the widget entry, a HeroUI button in this
 * header would do nothing for a visitor on a desktop browser.
 */
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
      className="flex overflow-hidden rounded-lg border border-solid border-border"
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
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
            // Soft, not solid: the start button is the one primary action on this screen.
            candidate === language
              ? 'bg-accent-soft text-accent-soft-foreground'
              : 'bg-surface text-foreground hover:bg-default',
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
        'pointer-events-auto fixed inset-0 z-10 flex flex-col overflow-hidden',
        'bg-background text-foreground font-sans text-sm focus:outline-none',
        'sm:inset-auto sm:bottom-24 sm:max-h-[calc(100dvh-9rem)] sm:w-100 sm:rounded-2xl',
        'sm:border sm:border-solid sm:border-border sm:shadow-lg',
        position === 'end' ? 'sm:end-4' : 'sm:start-4',
      )}
    >
      {/*
        The header row is tight: the title shares it with the language switch and the close
        button. It stays at the panel's own text size so the full name fits next to them.
      */}
      <header className="safe-top flex items-center gap-2 border-b border-solid border-separator bg-surface px-3 py-3 sm:px-4">
        <h2 className="me-auto truncate text-sm font-semibold">
          {t('widget.title')}
        </h2>
        <LanguageSwitch language={language} onChange={onLanguageChange} />
        {/* A plain button for the same reason as the language switch above. */}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('widget.close')}
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-lg text-muted',
            'transition-colors hover:bg-default hover:text-foreground sm:size-9',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
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
