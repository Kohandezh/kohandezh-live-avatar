import { type ReactNode, useEffect } from 'react';
import { Provider as ReduxProvider } from 'react-redux';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { I18nextProvider } from 'react-i18next';
import { store, useAppDispatch, useAppSelector } from './store';
import { queryClient } from './queryClient';
import { config } from './config';
import { i18n, applyDocumentDirection } from '@shared/i18n';
import { setOnline } from './store/uiSlice';
import { subscribeConnectivity } from '@shared/platform';

function LocaleEffects({ children }: { children: ReactNode }) {
  const locale = useAppSelector((s) => s.ui.locale);
  const dispatch = useAppDispatch();

  useEffect(() => {
    void i18n.changeLanguage(locale);
    applyDocumentDirection(locale);
  }, [locale]);

  useEffect(() => subscribeConnectivity((online) => dispatch(setOnline(online))), [dispatch]);

  return <>{children}</>;
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
