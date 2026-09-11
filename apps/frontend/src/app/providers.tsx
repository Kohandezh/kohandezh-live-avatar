import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { I18nProvider } from '@heroui/react';
import { useLanguage } from '@/features/settings';
import { LanguageSync } from '@/features/settings';
import { queryClient as defaultQueryClient } from './queryClient';
import { store as defaultStore, type AppStore } from './store';

/** Reads the Redux language and passes it to React Aria's I18nProvider. */
function LocaleProvider({ children }: { children: ReactNode }) {
  const [language] = useLanguage();
  return (
    <I18nProvider locale={language === 'fa' ? 'fa-IR' : 'en-US'}>
      {children}
    </I18nProvider>
  );
}

/**
 * Providers shared by every app target (mobile, web, admin).
 * `store` and `queryClient` can be replaced in tests.
 */
export function Providers({
  children,
  store = defaultStore,
  queryClient = defaultQueryClient,
}: {
  children: ReactNode;
  store?: AppStore;
  queryClient?: QueryClient;
}) {
  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <LocaleProvider>
          <LanguageSync />
          {children}
        </LocaleProvider>
      </QueryClientProvider>
    </Provider>
  );
}
