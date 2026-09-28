import { screen, waitFor, within } from '@testing-library/react';
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

    it('has no avatar console row, not even for an admin on the web target (SC-019)', async () => {
      const originalAppTarget = env.appTarget;
      // The row used to show for an admin on `web` only, so force `web` to prove it is gone.
      (env as { appTarget: string }).appTarget = 'web';

      try {
        mockSession.set('u-admin');
        renderSettings('/settings');
        await screen.findByRole('link', { name: /Personal information/ });
        expect(screen.queryByRole('link', { name: /Avatar console/ })).toBeNull();
        expect(
          screen
            .getAllByRole('link')
            .filter((link) => link.getAttribute('href') === '/avatar'),
        ).toHaveLength(0);
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

    it('loads the stored birthday into the Jalali field', async () => {
      mockSession.set('u-user');
      renderSettings('/settings/personal');

      // u-user was seeded with 1993-06-21, which is Khordad 31, 1372.
      await screen.findByLabelText('First name');
      expect(
        document.querySelector('[data-type="year"][role="spinbutton"]'),
      ).toHaveTextContent('1372');
      expect(
        document.querySelector('[data-type="day"][role="spinbutton"]'),
      ).toHaveTextContent('31');
    });

    it('keeps the stored birthday when only the name is edited', async () => {
      // `PUT /api/me/profile` is a full replace, so a screen that sent only the
      // names would clear the birthday on every save. This is that regression.
      const putSpy = vi.spyOn(apiClient, 'put');
      mockSession.set('u-user');
      const user = userEvent.setup();
      renderSettings('/settings/personal');

      // Not "Doe": the mock backend keeps edited users between tests in this
      // file, and an earlier test already saved that value. An unchanged form
      // is not dirty, so Save would stay disabled and this would pass for the
      // wrong reason.
      await user.clear(await screen.findByLabelText('Last name'));
      await user.type(screen.getByLabelText('Last name'), 'Roshan');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await screen.findByText('Your details were saved.');
      expect(putSpy).toHaveBeenCalledWith('/api/me/profile', {
        firstName: 'User',
        lastName: 'Roshan',
        birthDate: '1993-06-21',
      });
      putSpy.mockRestore();
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

    it('picks the theme from the list box and persists it to the settings key', async () => {
      mockSession.set('u-user');
      const user = userEvent.setup();
      renderSettings('/settings/appearance');

      const themeList = await screen.findByRole('listbox', { name: 'Theme' });
      expect(
        within(themeList).getByRole('option', { name: /System/ }),
      ).toHaveAttribute('aria-selected', 'true');

      await user.click(within(themeList).getByRole('option', { name: 'Dark' }));

      await waitFor(() =>
        expect(document.documentElement.dataset.theme).toBe('dark'),
      );
      expect(readPersistedSettings().theme).toBe('dark');
      expect(
        within(themeList).getByRole('option', { name: 'Dark' }),
      ).toHaveAttribute('aria-selected', 'true');
    });

    it('offers exactly the three themes, with the system default explained', async () => {
      mockSession.set('u-user');
      renderSettings('/settings/appearance');

      const themeList = await screen.findByRole('listbox', { name: 'Theme' });

      expect(within(themeList).getAllByRole('option')).toHaveLength(3);
      expect(
        within(themeList).getByRole('option', { name: 'Light' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Follows your device setting.'),
      ).toBeInTheDocument();
    });

    it('sets the reduce-transparency level with the slider, and the level reaches the CSS', async () => {
      mockSession.set('u-user');
      const user = userEvent.setup();
      renderSettings('/settings/appearance');

      const slider = await screen.findByRole('slider', {
        name: 'Reduce transparency',
      });
      expect(slider).toHaveValue('0');
      // 0 is the untouched glass, so the full-flat attribute must stay off.
      expect(document.documentElement.dataset.reduceTransparency).toBe('false');

      // Keyboard, not a drag: jsdom has no layout, so a pointer drag on a
      // slider track cannot produce a value. The arrow keys move by `step`.
      await user.tab();
      slider.focus();
      await user.keyboard('{ArrowRight}{ArrowRight}');

      await waitFor(() =>
        expect(readPersistedSettings().reduceTransparency).toBe(10),
      );
      // A level in the middle scales the glass through this custom property
      // rather than switching it off.
      expect(
        document.documentElement.style.getPropertyValue('--glass-reduce'),
      ).toBe('0.1');
      expect(document.documentElement.dataset.reduceTransparency).toBe('false');
    });

    it('marks the top of the scale so the glass is dropped outright', async () => {
      mockSession.set('u-user');
      const user = userEvent.setup();
      renderSettings('/settings/appearance');

      const slider = await screen.findByRole('slider', {
        name: 'Reduce transparency',
      });
      slider.focus();
      await user.keyboard('{End}');

      await waitFor(() =>
        expect(readPersistedSettings().reduceTransparency).toBe(100),
      );
      expect(document.documentElement.dataset.reduceTransparency).toBe('true');
      expect(
        document.documentElement.style.getPropertyValue('--glass-reduce'),
      ).toBe('1');
    });
  });
});
