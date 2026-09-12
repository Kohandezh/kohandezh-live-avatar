import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMockApi, MOCK_OTP_CODE, mockSession } from '@/data/mock';
import { LoginPage } from '@/pages/login/LoginPage';
import { apiClient } from '@/shared/api';
import { clearAccessToken } from '@/shared/storage/tokenStore';
import { renderWithProviders } from '../utils/renderWithProviders';

/**
 * Flips `navigator.onLine`, which is what the app's own `useOnline` hook
 * reads. Deliberately does NOT also poke TanStack Query's global
 * `onlineManager`: one test here (`disables submit ... while offline`) mounts
 * LoginPage while already "offline" and still needs the `me` query underneath
 * `useSession` to settle so the form appears — syncing `onlineManager` pauses
 * that query forever instead (see onboardingPage.test.tsx for the one place
 * this file's sibling test DOES need that sync, and why).
 */
function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    value,
    configurable: true,
  });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

/** Persian digits for MOCK_OTP_CODE ('123456'), one Persian glyph per ASCII digit. */
const MOCK_OTP_CODE_FA = '۱۲۳۴۵۶';

/** Counts calls to the verify endpoint only, so a test proves auto-submit fired once,
 * not just that some request went out. Typed by shape, not `ReturnType<typeof
 * vi.spyOn>`: that generic default (`MockInstance<(this: unknown, ...args:
 * unknown[]) => unknown>`) cannot accept a spy on `apiClient.post`'s real,
 * narrower signature under `tsc -b`'s contravariance check. */
function verifyCallCount(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.filter(
    ([url]) => typeof url === 'string' && url.includes('/api/auth/otp/verify'),
  ).length;
}

async function reachCodeStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Phone number'), '09351234567');
  await user.click(screen.getByRole('button', { name: 'Send code' }));
  await screen.findByLabelText('One-time code');
}

describe('LoginPage (phone OTP)', () => {
  beforeEach(async () => {
    installMockApi(apiClient, { delayMs: 0 });
    mockSession.clear();
    // The access token store is an in-memory singleton (by design: web
    // sessions are cookie-based, so it is never persisted). A previous
    // test's successful verify leaves a token in it unless cleared here.
    await clearAccessToken();
  });

  afterEach(async () => {
    setOnline(true);
    vi.useRealTimers();
    // HeroUI's InputOTP (input-otp under the hood) schedules its own internal
    // setTimeout(0|10|50) housekeeping on every keystroke, with no cleanup, to
    // resync the hidden input's selection. If a test ends less than 50ms after
    // typing, one of those can fire after this file's jsdom environment is torn
    // down and throw "window is not defined" as an unhandled exception. Give
    // them one real tick to drain before the next test (or the file) tears
    // anything down.
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  it('auto-submits once the sixth digit lands, with no Verify press (requirement 12)', async () => {
    const postSpy = vi.spyOn(apiClient, 'post');
    const user = userEvent.setup();
    renderWithProviders(<LoginPage redirectTo="/assistant" />);

    await reachCodeStep(user);
    expect(await screen.findByText(/\+989351234567/)).toBeInTheDocument();

    // No click on "Verify" anywhere in this test: typing the sixth digit is the
    // only thing that submits the form.
    await user.type(screen.getByLabelText('One-time code'), MOCK_OTP_CODE);

    // A successful verify signs the user in, and LoginPage redirects away.
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Log in' }),
      ).not.toBeInTheDocument(),
    );
    // Exactly one call, not just a successful outcome: a second auto-submit of
    // the same code could lock the account out after five wrong attempts.
    expect(verifyCallCount(postSpy)).toBe(1);
  });

  it('clears the field on a wrong code, then auto-submits a second, different code', async () => {
    const postSpy = vi.spyOn(apiClient, 'post');
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await reachCodeStep(user);

    await user.type(screen.getByLabelText('One-time code'), '000000');
    expect(await screen.findByText('That code is wrong.')).toBeInTheDocument();
    // The old behaviour kept the wrong digits on screen; auto-submit clears them
    // instead, so a second attempt starts from an empty box, not a stale one.
    expect(screen.getByLabelText('One-time code')).toHaveValue('');

    await user.type(screen.getByLabelText('One-time code'), MOCK_OTP_CODE);

    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Log in' }),
      ).not.toBeInTheDocument(),
    );
    expect(verifyCallCount(postSpy)).toBe(2);
  });

  it('normalizes Persian digits to ASCII before auto-submitting', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await reachCodeStep(user);

    await user.type(screen.getByLabelText('One-time code'), MOCK_OTP_CODE_FA);

    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Log in' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('does not auto-submit a completed code while offline', async () => {
    const postSpy = vi.spyOn(apiClient, 'post');
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await reachCodeStep(user);
    setOnline(false);

    await user.type(screen.getByLabelText('One-time code'), MOCK_OTP_CODE);

    // The heading never disappears, because nothing was ever sent.
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
    expect(verifyCallCount(postSpy)).toBe(0);
  });

  it('the Verify button still triggers a real submission when pressed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await reachCodeStep(user);

    // Five digits: the code is not complete, so the auto-submit effect never
    // fires. Pressing Verify by hand is the only thing that can act on it, so
    // this proves the button is still wired to the real submit handler
    // (auto-submit calls the exact same one) rather than being dead markup.
    await user.type(
      screen.getByLabelText('One-time code'),
      MOCK_OTP_CODE.slice(0, 5),
    );
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(
      await screen.findByText('Enter the 6-digit code.'),
    ).toBeInTheDocument();

    // Finishing the code lets that same button (or the auto-submit it shares
    // a handler with) carry the login the rest of the way.
    await user.type(
      screen.getByLabelText('One-time code'),
      MOCK_OTP_CODE.slice(5),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Log in' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('shows the disabled-account message', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    // u-001, the deterministic disabled seed account (src/data/mock/users.ts).
    await user.type(
      await screen.findByLabelText('Phone number'),
      '+989900000000',
    );
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await screen.findByLabelText('One-time code');

    await user.type(screen.getByLabelText('One-time code'), MOCK_OTP_CODE);

    expect(
      await screen.findByText('This account is disabled.'),
    ).toBeInTheDocument();
  });

  it('disables the resend button with a countdown, then re-enables it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(<LoginPage />);

    await user.type(
      await screen.findByLabelText('Phone number'),
      '09351234567',
    );
    await user.click(screen.getByRole('button', { name: 'Send code' }));

    const resendButton = await screen.findByRole('button', {
      name: /Resend code/,
    });
    expect(resendButton).toBeDisabled();
    expect(resendButton).toHaveTextContent('60s');

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByRole('button', { name: 'Resend code' })).toBeEnabled();
  });

  it('disables submit and explains why while offline', async () => {
    const user = userEvent.setup();
    setOnline(false);
    renderWithProviders(<LoginPage />);

    const phoneInput = await screen.findByLabelText('Phone number');

    expect(
      screen.getByText('You are offline. Connect to the internet to continue.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send code' })).toBeDisabled();

    await user.type(phoneInput, '09351234567');
    expect(screen.getByRole('button', { name: 'Send code' })).toBeDisabled();
  });

  it('lets the user go back and change the number', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await reachCodeStep(user);

    await user.click(screen.getByRole('button', { name: 'Change number' }));

    expect(screen.getByLabelText('Phone number')).toBeInTheDocument();
  });
});
