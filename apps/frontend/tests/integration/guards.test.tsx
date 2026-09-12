import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { installMockApi, MOCK_OTP_CODE, mockSession } from '@/data/mock';
import { RequireAuth, RequireProfile, RequireRole } from '@/features/authentication';
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

/** Phone outside the seeded range (see src/data/mock/users.ts: fixed accounts are
 * +989121234567 / +989351234567, and generated ones sit in +98990000000X). Signing
 * in with it creates a fresh account with an empty `firstName`, the same shape
 * `RequireProfile` sees for a brand-new user who has not finished onboarding. */
async function signInUnseededUser(phone: string) {
  await apiClient.post('/api/auth/otp/request', { phone });
  const { data } = await apiClient.post('/api/auth/otp/verify', {
    phone,
    code: MOCK_OTP_CODE,
  });
  mockSession.set(data.user.id);
  return data.user as { id: string; firstName: string };
}

function renderProfileGuarded(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<p>login page</p>} />
      <Route path="/onboarding" element={<p>onboarding page</p>} />
      <Route element={<RequireProfile />}>
        <Route path="/video" element={<p>video page</p>} />
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

  describe('RequireProfile', () => {
    it('sends a signed-in user with an empty firstName to /onboarding', async () => {
      await signInUnseededUser('+989370000001');
      renderProfileGuarded('/video');

      expect(await screen.findByText('onboarding page')).toBeInTheDocument();
    });

    it('renders the outlet for a user who already has a name', async () => {
      // u-user is a seeded account with firstName "User" (src/data/mock/users.ts).
      mockSession.set('u-user');
      renderProfileGuarded('/video');

      expect(await screen.findByText('video page')).toBeInTheDocument();
    });

    it('shows a loading state while the me query is pending', () => {
      mockSession.set('u-user');
      // delayMs > 0 so the `me` query is still pending on the first paint.
      installMockApi(apiClient, { delayMs: 50 });
      renderProfileGuarded('/video');

      expect(screen.queryByText('video page')).not.toBeInTheDocument();
      expect(screen.queryByText('onboarding page')).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('does not crash when the user becomes null while the outlet is mounted', async () => {
      // This is the real bug class the amendments call out: the global 401 handler
      // nulls the `me` query in place, so `useSession()` can report a null user
      // with `isLoading` false, before `RequireAuth` above it has redirected away.
      // `RequireProfile` must bail out instead of reading `.firstName` off null.
      mockSession.set('u-user');
      const { queryClient } = renderProfileGuarded('/video');

      expect(await screen.findByText('video page')).toBeInTheDocument();

      queryClient.setQueryData(['user', 'me'], null);

      expect(await screen.findByText('login page')).toBeInTheDocument();
    });
  });
});
