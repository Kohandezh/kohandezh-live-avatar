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
        <Route path="/video" element={<p>video page</p>} />
        <Route path="/audio" element={<p>audio page</p>} />
        <Route path="/settings" element={<p>settings page</p>} />
        <Route path="/onboarding" element={<p>onboarding page</p>} />
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

  it('has no header element and no brand text anywhere in the shell (requirements 2, 6)', async () => {
    mockSession.set('u-user');
    renderShell('/video');

    await screen.findByText('video page');
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(document.querySelector('header')).not.toBeInTheDocument();
    expect(screen.queryByText('Dr. Kohandezh Assistant')).not.toBeInTheDocument();
  });

  it('has no footer element in the shell (requirement 9)', async () => {
    mockSession.set('u-user');
    renderShell('/video');

    await screen.findByText('video page');
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    expect(document.querySelector('footer')).not.toBeInTheDocument();
  });

  it('shows the floating menu with exactly the three links (requirement 14)', async () => {
    mockSession.set('u-user');
    renderShell('/video');

    const nav = await screen.findByRole('navigation', { name: 'Menu' });
    expect(nav).toBeInTheDocument();

    const items = screen.getAllByRole('button', {
      name: /^(Settings|Video|Audio)$/,
    });
    expect(items).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Video' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Audio' })).toBeInTheDocument();
  });

  it('hides the menu on /onboarding even for a signed-in user', async () => {
    mockSession.set('u-user');
    renderShell('/onboarding');

    expect(await screen.findByText('onboarding page')).toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: 'Menu' }),
    ).not.toBeInTheDocument();
  });
});
