import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '@/app/providers';
import { createQueryClient } from '@/app/queryClient';
import { createStore } from '@/app/store';
import { Router } from '@/app/web/router';
import { installMockApi, mockSession } from '@/data/mock';
import { apiClient } from '@/shared/api';

// The service worker prompt imports a module only the web build's PWA plugin provides.
vi.mock('@/app/web/PwaUpdatePrompt', () => ({ PwaUpdatePrompt: () => null }));

/**
 * The real web router, which owns its BrowserRouter, so it is rendered at a real URL instead of
 * through `renderWithProviders` and its MemoryRouter.
 */
function renderWebAt(path: string) {
  window.history.pushState({}, '', path);
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  return render(
    <Providers store={createStore()} queryClient={queryClient}>
      <Router />
    </Providers>,
  );
}

describe('web router', () => {
  beforeEach(() => {
    installMockApi(apiClient, { delayMs: 0 });
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it.each(['u-admin', null])(
    'renders the not-found page at /avatar, the removed workbench route (SC-019, SEC-006), session %s',
    async (userId) => {
      if (userId) mockSession.set(userId);
      else mockSession.clear();

      renderWebAt('/avatar');

      expect(
        await screen.findByRole('heading', { name: 'Page not found' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Text to speech' }),
      ).toBeNull();
    },
  );
});
