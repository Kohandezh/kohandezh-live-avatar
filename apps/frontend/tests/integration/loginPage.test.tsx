import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMockApi, MOCK_OTP_CODE, mockSession } from '@/data/mock';
import { LoginPage } from '@/pages/login/LoginPage';
import { apiClient } from '@/shared/api';
import { clearAccessToken } from '@/shared/storage/tokenStore';
import { renderWithProviders } from '../utils/renderWithProviders';

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    value,
    configurable: true,
  });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
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

  afterEach(() => {
    setOnline(true);
    vi.useRealTimers();
  });

  it('sends a code, verifies it, and signs the user in', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage redirectTo="/assistant" />);

    // The `me` query is pending on mount; the form only appears once it settles.
    await user.type(
      await screen.findByLabelText('Phone number'),
      '09351234567',
    );
    await user.click(screen.getByRole('button', { name: 'Send code' }));

    // Step 2: the normalized phone is shown and a dev code hint appears.
    expect(await screen.findByText(/\+989351234567/)).toBeInTheDocument();
    expect(
      screen.getByText(`Development code: ${MOCK_OTP_CODE}`),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('One-time code'), MOCK_OTP_CODE);
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    // A successful verify signs the user in, and LoginPage redirects away.
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Welcome back' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('shows an error for the wrong code and keeps the code field', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.type(
      await screen.findByLabelText('Phone number'),
      '09351234567',
    );
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await screen.findByLabelText('One-time code');

    await user.type(screen.getByLabelText('One-time code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('That code is wrong.')).toBeInTheDocument();
    expect(screen.getByLabelText('One-time code')).toHaveValue('000000');
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
    await user.click(screen.getByRole('button', { name: 'Verify' }));

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

    await user.type(
      await screen.findByLabelText('Phone number'),
      '09351234567',
    );
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await screen.findByLabelText('One-time code');

    await user.click(screen.getByRole('button', { name: 'Change number' }));

    expect(screen.getByLabelText('Phone number')).toBeInTheDocument();
  });
});
