import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { installMockApi, mockSession } from '@/data/mock';
import { HomePage } from '@/pages/home/HomePage';
import { apiClient } from '@/shared/api';
import { renderWithProviders } from '../utils/renderWithProviders';

/** The shape both routers use: the landing sits at the index route. */
function renderHomeRoute(route = '/') {
  return renderWithProviders(
    <Routes>
      <Route index element={<HomePage />} />
      <Route path="/assistant" element={<p>conversation page</p>} />
    </Routes>,
    { route },
  );
}

describe('HomePage', () => {
  beforeEach(() => {
    installMockApi(apiClient, { delayMs: 0 });
    mockSession.clear();
  });

  it('shows the landing and the primary call to action to visitors', async () => {
    renderHomeRoute();

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Talk to Dr. Kohandezh, any time.',
      }),
    ).toBeInTheDocument();

    const cta = screen.getByRole('link', { name: 'Start a conversation' });
    expect(cta).toHaveAttribute('href', '/login');
    expect(
      screen.getByRole('link', { name: 'I already have an account' }),
    ).toBeInTheDocument();
  });

  it('explains the three steps', async () => {
    renderHomeRoute();

    expect(
      await screen.findByRole('heading', { name: 'How it works' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Log in with your phone' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Allow the microphone' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Speak and listen' }),
    ).toBeInTheDocument();
  });

  it('sends signed-in users straight to the conversation', async () => {
    mockSession.set('u-user');
    renderHomeRoute();

    expect(await screen.findByText('conversation page')).toBeInTheDocument();
  });
});
