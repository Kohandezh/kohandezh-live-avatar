import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { Providers } from '@/app/providers';
import { createQueryClient } from '@/app/queryClient';
import { createStore, type RootState } from '@/app/store';
import { i18n } from '@/i18n';

/**
 * Renders with a fresh Redux store, a fresh QueryClient (no retries),
 * and a MemoryRouter starting at `route`.
 */
export function renderWithProviders(
  ui: ReactElement,
  {
    route = '/',
    preloadedState,
    locale = 'en',
    ...options
  }: RenderOptions & {
    route?: string;
    preloadedState?: Partial<RootState>;
    locale?: 'en' | 'fa';
  } = {},
) {
  const store = createStore(preloadedState);
  void i18n.changeLanguage(locale);
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <Providers store={store} queryClient={queryClient}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </Providers>
    );
  }

  return {
    store,
    queryClient,
    ...render(ui, { wrapper: Wrapper, ...options }),
  };
}

/**
 * Wrapper for renderHook: same providers, no router.
 * Hooks that navigate should use renderWithProviders instead.
 */
export function providersWrapper(preloadedState?: Partial<RootState>) {
  const store = createStore(preloadedState);
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: 0 },
  });
  void i18n.changeLanguage('en');

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <Providers store={store} queryClient={queryClient}>
      {children}
    </Providers>
  );

  return { store, queryClient, Wrapper };
}
