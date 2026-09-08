import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@tests/utils/renderWithProviders';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { logEvent } from './eventLogSlice';

describe('DiagnosticsPanel', () => {
  it('shows the empty state and disables Clear', () => {
    renderWithProviders(<DiagnosticsPanel />);
    expect(screen.getByText(/no events yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear log/i })).toBeDisabled();
  });

  it('renders redacted events newest first and clears them', async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<DiagnosticsPanel />);
    store.dispatch(
      logEvent({
        level: 'info',
        source: 'avatar',
        message: 'first',
        data: { livekit_client_token: 'abc' },
      }),
    );
    store.dispatch(logEvent({ level: 'error', source: 'livekit', message: 'second' }));

    const items = await screen.findAllByRole('listitem');
    expect(items[0]).toHaveTextContent('second');
    expect(items[1]).toHaveTextContent('first');
    await user.click(screen.getByText(/details/i));
    expect(screen.getByText(/\[redacted\]/)).toBeInTheDocument();
    expect(screen.queryByText(/abc/)).toBeNull();

    await user.click(screen.getByRole('button', { name: /clear log/i }));
    expect(screen.getByText(/no events yet/i)).toBeInTheDocument();
  });
});
