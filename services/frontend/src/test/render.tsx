import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { Provider as ReduxProvider } from 'react-redux';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { i18n } from '@shared/i18n';
import { createAppStore, type RootState } from '@app/store';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 0 } },
  });
}

interface Options extends Omit<RenderOptions, 'wrapper'> {
  preloadedState?: Partial<RootState>;
  locale?: 'fa' | 'en';
}

/** Renders with a fresh store + query client so tests never share state. */
export function renderWithProviders(
  ui: ReactElement,
  { preloadedState, locale = 'en', ...options }: Options = {},
) {
  const store = createAppStore(preloadedState);
  const queryClient = createTestQueryClient();
  void i18n.changeLanguage(locale);

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ReduxProvider store={store}>
        <QueryClientProvider client={queryClient}>
          <I18nextProvider i18n={i18n}>
            <MemoryRouter>{children}</MemoryRouter>
          </I18nextProvider>
        </QueryClientProvider>
      </ReduxProvider>
    );
  }

  return { store, queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}

export function providersWrapper(preloadedState?: Partial<RootState>) {
  const store = createAppStore(preloadedState);
  const queryClient = createTestQueryClient();
  void i18n.changeLanguage('en');
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <ReduxProvider store={store}>
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
      </QueryClientProvider>
    </ReduxProvider>
  );
  return { store, queryClient, Wrapper };
}
