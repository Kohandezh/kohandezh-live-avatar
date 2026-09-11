import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { MobileLayout } from '@/app/mobile/MobileLayout';
import { installMockApi, mockSession } from '@/data/mock';
import { apiClient } from '@/shared/api';
import { renderWithProviders } from '../utils/renderWithProviders';

function renderShell(route = '/') {
  return renderWithProviders(
    <Routes>
      <Route element={<MobileLayout />}>
        <Route index element={<p>landing</p>} />
        <Route path="/assistant" element={<p>conversation page</p>} />
      </Route>
    </Routes>,
    { route },
  );
}

describe('MobileLayout', () => {
  beforeEach(() => {
    installMockApi(apiClient, { delayMs: 0 });
    mockSession.clear();
  });

  it('hides the tab bar from anonymous visitors', async () => {
    renderShell();

    expect(await screen.findByText('landing')).toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: 'Menu' }),
    ).not.toBeInTheDocument();
  });

  it('shows the conversation and profile tabs to a signed-in user', async () => {
    mockSession.set('u-user');
    renderShell('/assistant');

    const tabs = await screen.findByRole('navigation', { name: 'Menu' });
    expect(tabs).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Conversation' })).toHaveAttribute(
      'href',
      '/assistant',
    );
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute(
      'href',
      '/profile',
    );
  });
});
