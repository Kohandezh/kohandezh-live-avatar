import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMockApi, mockSession } from '@/data/mock';
import { RequireAuth, RequireProfile } from '@/features/authentication';
import { AppearancePage } from '@/pages/settings/AppearancePage';
import { PersonalInfoPage } from '@/pages/settings/PersonalInfoPage';
import { SettingsIndexPage } from '@/pages/settings/SettingsIndexPage';
import { SettingsLayout } from '@/pages/settings/SettingsLayout';
import { apiClient } from '@/shared/api';
import { env } from '@/shared/config/env';
import { renderWithProviders } from '../utils/renderWithProviders';

/** Reads the persisted settings blob the way the real app does: one JSON object
 * under the single 'settings' localStorage key (see settingsSlice.ts). */
function readPersistedSettings(): Record<string, unknown> {
  const raw = localStorage.getItem('settings');
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

/**
 * Wrapped in the same guards the real router puts `/settings` behind
 * (RequireAuth, RequireProfile). This matters for more than realism: those
 * guards call `useSession()` before the outlet renders, so the `me` query is
 * already resolved and cached by the time a settings page's own `useForm`
 * initializes. Skipping the guards would race the query and start every form
 * with empty defaults, which is a test-harness artifact, not a real bug.
 */
function renderSettings(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<p>landing</p>} />
      <Route path="/login" element={<p>login page</p>} />
      <Route element={<RequireAuth />}>
        <Route element={<RequireProfile />}>
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<SettingsIndexPage />} />
            <Route path="personal" element={<PersonalInfoPage />} />
            <Route path="appearance" element={<AppearancePage />} />
          </Route>
        </Route>
      </Route>
    </Routes>,
    { route },
  );
}

describe('Settings (requirements 5, 15)', () => {
  beforeEach(() => {
    installMockApi(apiClient, { delayMs: 0 });
    mockSession.clear();
  });

  describe('SettingsIndexPage', () => {
    it('lists personal information, appearance and language, with no log out row here', async () => {
      mockSession.set('u-user');
      renderSettings('/settings');

      expect(
        await screen.findByRole('link', { name: /Personal information/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /Appearance/ }),
      ).toBeInTheDocument();
      // The trigger's accessible name is "<selected value> Language" (React
      // Aria composes the value and the label), so match the label part only.
      expect(
        screen.getByRole('button', { name: /Language/ }),
      ).toBeInTheDocument();
      // Requirement 6 removed the header's log-out control; the user placed the
      // replacement on the personal info page instead (see PersonalInfoPage below),
      // not on this index.
      expect(
        screen.queryByRole('button', { name: 'Log out' }),
      ).not.toBeInTheDocument();
    });

    it('hides the admin-only avatar console row for a normal user, and shows it for an admin, only on the web target', async () => {
      const originalAppTarget = env.appTarget;
      // `env.appTarget` is 'test' under Vitest, so the row would be hidden no
      // matter what `hasRole` says unless this is forced to 'web' here: the
      // real gate is `hasRole(user, ['admin']) && env.appTarget === 'web'`, and
      // this test has to exercise both halves of that condition to be able to
      // fail if either one were removed.
      (env as { appTarget: string }).appTarget = 'web';

      try {
        mockSession.set('u-user');
        const normalUser = renderSettings('/settings');
        await screen.findByRole('link', { name: /Personal information/ });
        expect(
          screen.queryByRole('link', { name: /Avatar console/ }),
        ).not.toBeInTheDocument();
        normalUser.unmount();

        mockSession.set('u-admin');
        renderSettings('/settings');
        expect(
          await screen.findByRole('link', { name: /Avatar console/ }),
        ).toBeInTheDocument();
      } finally {
        (env as { appTarget: string }).appTarget = originalAppTarget;
      }
    });
  });

  describe('PersonalInfoPage', () => {
    it('renders the signed-in user and saves an edited name', async () => {
      mockSession.set('u-user');
      const user = userEvent.setup();
      renderSettings('/settings/personal');

      expect(await screen.findByLabelText('First name')).toHaveValue('User');
      expect(screen.getByLabelText('Last name')).toHaveValue('Example');
      // The read-only facts render too, not only the editable fields.
      expect(screen.getByText('+989351234567')).toBeInTheDocument();
      expect(screen.getByText('user@example.com')).toBeInTheDocument();

      const saveButton = screen.getByRole('button', { name: 'Save' });
      expect(saveButton).toBeDisabled();

      await user.clear(screen.getByLabelText('Last name'));
      await user.type(screen.getByLabelText('Last name'), 'Doe');
      expect(saveButton).toBeEnabled();
      await user.click(saveButton);

      expect(
        await screen.findByText('Your details were saved.'),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Last name')).toHaveValue('Doe');
      // Saved and untouched: the button goes back to disabled.
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('keeps the typed values on screen after a failed save', async () => {
      const putSpy = vi
        .spyOn(apiClient, 'put')
        .mockRejectedValueOnce(new Error('network hiccup'));
      mockSession.set('u-user');
      const user = userEvent.setup();
      renderSettings('/settings/personal');

      await user.clear(await screen.findByLabelText('First name'));
      await user.type(screen.getByLabelText('First name'), 'Sina');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(
        await screen.findByText('Saving failed. Try again.'),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('First name')).toHaveValue('Sina');
      putSpy.mockRestore();
    });

    it('carries the log out control at the bottom of this page, and it signs the user out', async () => {
      mockSession.set('u-user');
      const user = userEvent.setup();
      renderSettings('/settings/personal');

      await screen.findByLabelText('First name');
      const logoutButton = screen.getByRole('button', { name: 'Log out' });
      expect(logoutButton).toBeInTheDocument();

      await user.click(logoutButton);

      expect(await screen.findByText('landing')).toBeInTheDocument();
    });
  });

  describe('AppearancePage', () => {
    afterEach(() => {
      localStorage.clear();
    });

    it('changes the theme and the reduce-transparency flag, and both persist to the settings key', async () => {
      mockSession.set('u-user');
      const user = userEvent.setup();
      renderSettings('/settings/appearance');

      await user.click(await screen.findByRole('radio', { name: 'Dark' }));
      await waitFor(() =>
        expect(document.documentElement.dataset.theme).toBe('dark'),
      );
      expect(readPersistedSettings().theme).toBe('dark');

      // The switch's `<label>` wraps its own description text too, so match on
      // the label part rather than the whole concatenated accessible name.
      const reduceSwitch = screen.getByRole('switch', {
        name: /Reduce transparency/,
      });
      expect(reduceSwitch).not.toBeChecked();

      await user.click(reduceSwitch);

      await waitFor(() =>
        expect(readPersistedSettings().reduceTransparency).toBe(true),
      );
      expect(document.documentElement.dataset.reduceTransparency).toBe('true');
    });
  });
});
