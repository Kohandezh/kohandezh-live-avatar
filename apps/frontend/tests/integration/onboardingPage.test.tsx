import { onlineManager } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMockApi, MOCK_OTP_CODE, mockSession } from '@/data/mock';
import { selectMicPermissionAsked } from '@/features/settings';
import { OnboardingPage } from '@/pages/onboarding/OnboardingPage';
import { apiClient } from '@/shared/api';
import { renderWithProviders } from '../utils/renderWithProviders';

/**
 * Flips `navigator.onLine` (the app's own `useOnline` hook reads this) and
 * also tells TanStack Query's global `onlineManager` directly.
 *
 * Why both: `onlineManager` is a module-level singleton shared by every test
 * in this file, not something `renderWithProviders`'s fresh `QueryClient`
 * resets. It only listens for the real `online`/`offline` window events
 * while at least one query or mutation observer is mounted, so a dispatched
 * event can arrive while nothing is listening (between one test's `cleanup()`
 * and the next test's render) and get lost. A lost event would leave
 * `updateProfile.mutate()` paused forever in a later test, since TanStack
 * Query does not run a mutation while it believes the app is offline.
 */
function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    value,
    configurable: true,
  });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
  onlineManager.setOnline(value);
}

let phoneCounter = 0;

/** A fresh, never-seeded phone each call, so every test signs in a distinct new
 * account with an empty `firstName` (see src/data/mock/users.ts for the seeded
 * range this deliberately avoids: +989121234567, +989351234567, and
 * +98990000000X). */
async function signInNewUser() {
  phoneCounter += 1;
  const phone = `+98937${String(1_000_000 + phoneCounter).slice(1)}`;
  await apiClient.post('/api/auth/otp/request', { phone });
  const { data } = await apiClient.post('/api/auth/otp/verify', {
    phone,
    code: MOCK_OTP_CODE,
  });
  mockSession.set(data.user.id);
}

function renderOnboarding() {
  return renderWithProviders(
    <Routes>
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/video" element={<p>video page</p>} />
    </Routes>,
    { route: '/onboarding' },
  );
}

async function fillName(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('First name'), 'Sina');
  await user.type(screen.getByLabelText('Last name'), 'Roshan');
}

/**
 * Types a Jalali birthday into the segmented date field.
 *
 * The segments are React Aria spinbuttons, not text inputs, so this focuses the first one and
 * types digits; React Aria advances to the next segment on its own. The order on screen follows
 * the locale, so the segments are found by their `data-type` rather than by position.
 */
async function fillJalaliBirthDate(
  user: ReturnType<typeof userEvent.setup>,
  { year, month, day }: { year: number; month: number; day: number },
) {
  const segment = (type: string) =>
    document.querySelector<HTMLElement>(`[data-type="${type}"][role="spinbutton"]`)!;

  segment('month').focus();
  await user.keyboard(String(month));
  segment('day').focus();
  await user.keyboard(String(day));
  segment('year').focus();
  await user.keyboard(String(year));
}

describe('OnboardingPage (requirements 10, 13)', () => {
  beforeEach(async () => {
    installMockApi(apiClient, { delayMs: 0 });
    mockSession.clear();
    await signInNewUser();
    setOnline(true);
  });

  afterEach(() => {
    setOnline(true);
  });

  it('shows validation errors instead of saving empty names', async () => {
    const user = userEvent.setup();
    renderOnboarding();

    await user.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Enter your first name.')).toBeInTheDocument();
    expect(screen.getByText('Enter your last name.')).toBeInTheDocument();
    // Step 1 is still on screen: no save happened.
    expect(screen.getByLabelText('First name')).toBeInTheDocument();
  });

  it('collects an optional Jalali birthday and saves it as a Gregorian day', async () => {
    const putSpy = vi.spyOn(apiClient, 'put');
    const user = userEvent.setup();
    renderOnboarding();

    await fillName(user);
    // Khordad 31, 1372 in the Jalali calendar is 21 June 1993.
    await fillJalaliBirthDate(user, { year: 1372, month: 3, day: 31 });
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await screen.findByRole('heading', { name: 'Choose how the app looks' });
    expect(putSpy).toHaveBeenCalledWith('/api/me/profile', {
      firstName: 'Sina',
      lastName: 'Roshan',
      birthDate: '1993-06-21',
    });
    putSpy.mockRestore();
  });

  it('shows the birthday the user typed back in the Jalali calendar', async () => {
    const user = userEvent.setup();
    renderOnboarding();

    await fillJalaliBirthDate(user, { year: 1372, month: 3, day: 31 });

    // Read back off the field itself: a Gregorian 1993 here would mean the
    // picker silently reinterpreted the typed year.
    expect(
      document.querySelector('[data-type="year"][role="spinbutton"]'),
    ).toHaveTextContent('1372');
    expect(
      document.querySelector('[data-type="month"][role="spinbutton"]'),
    ).toHaveAttribute('aria-valuetext', expect.stringContaining('Khordad'));
  });

  it('saves with no birthday when the field is left empty', async () => {
    const putSpy = vi.spyOn(apiClient, 'put');
    const user = userEvent.setup();
    renderOnboarding();

    await fillName(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await screen.findByRole('heading', { name: 'Choose how the app looks' });
    // Null, not omitted: the endpoint is a full replace.
    expect(putSpy).toHaveBeenCalledWith('/api/me/profile', {
      firstName: 'Sina',
      lastName: 'Roshan',
      birthDate: null,
    });
    putSpy.mockRestore();
  });

  it('saves the name and moves to the appearance step', async () => {
    const user = userEvent.setup();
    renderOnboarding();

    await fillName(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      await screen.findByRole('heading', { name: 'Choose how the app looks' }),
    ).toBeInTheDocument();
  });

  it('keeps the typed names on screen after a failed save', async () => {
    const putSpy = vi
      .spyOn(apiClient, 'put')
      .mockRejectedValueOnce(new Error('network hiccup'));
    const user = userEvent.setup();
    renderOnboarding();

    await fillName(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Saving failed. Try again.')).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toHaveValue('Sina');
    expect(screen.getByLabelText('Last name')).toHaveValue('Roshan');
    putSpy.mockRestore();
  });

  it('disables the save button and explains why while offline', async () => {
    const user = userEvent.setup();
    renderOnboarding();

    await fillName(user);
    act(() => setOnline(false));

    expect(
      await screen.findByText(
        'You are offline. Connect to the internet to save.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('writes the chosen theme onto the document element (requirement 13)', async () => {
    const user = userEvent.setup();
    renderOnboarding();

    await fillName(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Choose how the app looks' });

    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe('dark'),
    );
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    await user.click(screen.getByRole('radio', { name: 'Light' }));
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe('light'),
    );
  });

  it('lists System as an appearance option with the system default noted', async () => {
    const user = userEvent.setup();
    renderOnboarding();

    await fillName(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Choose how the app looks' });

    expect(screen.getByRole('radio', { name: 'System' })).toBeInTheDocument();
    expect(
      screen.getByText('Follows your device setting.'),
    ).toBeInTheDocument();
  });

  async function reachMicStep(user: ReturnType<typeof userEvent.setup>) {
    await fillName(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Choose how the app looks' });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Allow the microphone' });
  }

  it('reaches /video after the microphone is granted, and stops the track', async () => {
    const track = { stop: vi.fn(), kind: 'audio', enabled: true };
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValueOnce({
      getTracks: () => [track],
    } as unknown as MediaStream);

    const user = userEvent.setup();
    const { store } = renderOnboarding();
    await reachMicStep(user);

    await user.click(
      screen.getByRole('button', { name: 'Allow the microphone' }),
    );
    expect(
      await screen.findByText('The microphone is ready.'),
    ).toBeInTheDocument();
    // The permission check must not leave the OS recording indicator lit.
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(selectMicPermissionAsked(store.getState())).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Start talking' }));
    expect(await screen.findByText('video page')).toBeInTheDocument();
  });

  it('reaches /video after the microphone is denied', async () => {
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValueOnce(
      new DOMException('denied', 'NotAllowedError'),
    );

    const user = userEvent.setup();
    renderOnboarding();
    await reachMicStep(user);

    await user.click(
      screen.getByRole('button', { name: 'Allow the microphone' }),
    );
    expect(
      await screen.findByText(
        'The microphone is blocked. You can turn it on later in your browser or phone settings.',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Start talking' }));
    expect(await screen.findByText('video page')).toBeInTheDocument();
  });

  it('reaches /video when the microphone step is skipped with Not now', async () => {
    const user = userEvent.setup();
    const { store } = renderOnboarding();
    await reachMicStep(user);

    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(
      await screen.findByText(
        'You can turn the microphone on later in settings.',
      ),
    ).toBeInTheDocument();
    expect(selectMicPermissionAsked(store.getState())).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Start talking' }));
    expect(await screen.findByText('video page')).toBeInTheDocument();
  });
});
