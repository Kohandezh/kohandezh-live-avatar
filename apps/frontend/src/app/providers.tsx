import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { LanguageSync } from '@/features/settings';
import { queryClient as defaultQueryClient } from './queryClient';
import { store as defaultStore, type AppStore } from './store';

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
        <LanguageSync />
        {children}
      </QueryClientProvider>
    </Provider>
  );
}
