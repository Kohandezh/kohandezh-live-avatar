import { type ReactNode, useEffect } from 'react';
import { Provider as ReduxProvider } from 'react-redux';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { I18nextProvider } from 'react-i18next';
import { I18nProvider as AriaI18nProvider } from 'react-aria-components';
import { store, useAppDispatch, useAppSelector } from './store';
import { queryClient } from './queryClient';
import { config } from './config';
import { applyDocumentDirection, bcp47, i18n, isSupportedLocale } from '@shared/i18n';
import { setLocale, setOnline, setTheme, type Theme } from './store/uiSlice';
import { subscribeConnectivity } from '@shared/platform';
import { preferences, PREF_KEYS } from '@shared/storage/preferences';
import { setComposerText } from '@features/text-to-speech';

function applyTheme(theme: Theme): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    const dark = theme === 'dark' || (theme === 'system' && media.matches);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  };
  apply();
  media.addEventListener('change', apply);
  return () => media.removeEventListener('change', apply);
}

function LocaleEffects({ children }: { children: ReactNode }) {
  const locale = useAppSelector((s) => s.ui.locale);
  const theme = useAppSelector((s) => s.ui.theme);
  const composerText = useAppSelector((s) => s.composer.text);
  const dispatch = useAppDispatch();

  // Hydrate persisted, non-sensitive preferences once.
  useEffect(() => {
    void (async () => {
      const [savedLocale, savedTheme, savedText] = await Promise.all([
        preferences.get(PREF_KEYS.locale),
        preferences.get(PREF_KEYS.theme),
        preferences.get(PREF_KEYS.composerText),
      ]);
      if (isSupportedLocale(savedLocale)) dispatch(setLocale(savedLocale));
      if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system')
        dispatch(setTheme(savedTheme));
      if (savedText) dispatch(setComposerText(savedText));
    })();
  }, [dispatch]);

  useEffect(() => {
    void i18n.changeLanguage(locale);
    applyDocumentDirection(locale);
    void preferences.set(PREF_KEYS.locale, locale);
  }, [locale]);

  useEffect(() => {
    void preferences.set(PREF_KEYS.theme, theme);
    return applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const handle = setTimeout(
      () => void preferences.set(PREF_KEYS.composerText, composerText),
      400,
    );
    return () => clearTimeout(handle);
  }, [composerText]);

  useEffect(() => subscribeConnectivity((online) => dispatch(setOnline(online))), [dispatch]);

  return <AriaI18nProvider locale={bcp47(locale)}>{children}</AriaI18nProvider>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ReduxProvider store={store}>
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <LocaleEffects>{children}</LocaleEffects>
        </I18nextProvider>
        {config.devtools && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </ReduxProvider>
  );
}
