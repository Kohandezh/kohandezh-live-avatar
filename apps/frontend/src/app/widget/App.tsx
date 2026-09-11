import { useEffect, useRef } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getDirection,
  isSupportedLanguage,
  type SupportedLanguage,
} from '@/i18n';
import { queryClient } from '../queryClient';
import type { WidgetConfig } from './config';
import { WidgetLauncher } from './WidgetLauncher';
import { WidgetPanel } from './WidgetPanel';

export interface AppProps {
  config: WidgetConfig;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

/**
 * Entry of the website widget: a launcher plus the panel it opens, inside a Shadow DOM on
 * somebody else's page.
 *
 * There is no Router (one screen) and no Redux store (the assistant keeps its state in the
 * feature hook, and the language lives in i18next). That keeps the embedded bundle small.
 */
export function App({ config, isOpen, onOpenChange }: AppProps) {
  const { i18n } = useTranslation();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(isOpen);

  const language: SupportedLanguage = isSupportedLanguage(i18n.language)
    ? i18n.language
    : config.language;

  // Give focus back to the launcher after the panel closes, not on the first render.
  useEffect(() => {
    if (wasOpen.current && !isOpen) launcherRef.current?.focus();
    wasOpen.current = isOpen;
  }, [isOpen]);

  return (
    <QueryClientProvider client={queryClient}>
      <div dir={getDirection(language)} lang={language}>
        {isOpen && (
          <WidgetPanel
            language={language}
            mode={config.mode}
            position={config.position}
            onLanguageChange={(next) => void i18n.changeLanguage(next)}
            onClose={() => onOpenChange(false)}
          />
        )}
        <WidgetLauncher
          ref={launcherRef}
          isOpen={isOpen}
          position={config.position}
          onToggle={() => onOpenChange(!isOpen)}
        />
      </div>
    </QueryClientProvider>
  );
}
