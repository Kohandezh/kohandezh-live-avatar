import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { installMockApi, mockSession } from '@/data/mock';
import { RequireAuth, RequireRole } from '@/features/authentication';
import { apiClient } from '@/shared/api';
import { renderWithProviders } from '../utils/renderWithProviders';

function renderGuarded(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<p>login page</p>} />
      <Route path="/forbidden" element={<p>forbidden page</p>} />
      <Route element={<RequireAuth />}>
        <Route element={<RequireRole roles={['admin']} />}>
          <Route path="/admin" element={<p>admin page</p>} />
        </Route>
      </Route>
    </Routes>,
    { route },
  );
}

describe('route guards', () => {
  beforeEach(() => {
    installMockApi(apiClient, { delayMs: 0 });
    mockSession.clear();
  });

  it('redirects anonymous users to the login page', async () => {
    renderGuarded('/admin');

    expect(await screen.findByText('login page')).toBeInTheDocument();
  });

  it('sends signed-in users without the role to the forbidden page', async () => {
    mockSession.set('u-user');
    renderGuarded('/admin');

    expect(await screen.findByText('forbidden page')).toBeInTheDocument();
  });

  it('renders the page for users with the role', async () => {
    mockSession.set('u-admin');
    renderGuarded('/admin');

    expect(await screen.findByText('admin page')).toBeInTheDocument();
  });
});
