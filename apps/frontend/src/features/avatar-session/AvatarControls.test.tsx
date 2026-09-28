import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { errorBody, server } from '@tests/utils/server';
import { renderWithProviders } from '@tests/utils/renderWithProviders';
import { AvatarSessionPanel } from './AvatarSessionPanel';
import type { AvatarSessionState } from './types';

vi.mock('./livekitRoom', () => ({
  connectRoom: vi.fn(),
  disconnectRoom: vi.fn(),
  startRoomAudio: vi.fn(),
  setMediaTargets: vi.fn(),
  isRoomConnected: vi.fn(() => false),
}));

const connected: AvatarSessionState = {
  status: 'connected',
  session: {
    id: 's1',
    providerSessionId: 'p1',
    roomName: 'room-1',
    livekitUrl: 'wss://live.example.test',
    sandbox: true,
    transport: 'managed' as const,
  },
  media: { audio: true, video: false },
  audioBlocked: true,
  speaking: false,
  error: null,
};

describe('AvatarSessionPanel states', () => {
  it('idle: only Start is enabled and the empty video state is shown', () => {
    renderWithProviders(
      <AvatarSessionPanel text="سلام" recordingActive={false} />,
    );
    expect(screen.getByRole('button', { name: /start avatar/i })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: /send to avatar/i }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: /^interrupt$/i })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /close session/i }),
    ).toBeDisabled();
    expect(
      screen.getByText(/start a session to see the avatar/i),
    ).toBeInTheDocument();
  });

  it('connected: speak/interrupt/close enabled, audio-blocked prompt and identifiers shown', () => {
    renderWithProviders(
      <AvatarSessionPanel text="سلام" recordingActive={false} />,
      {
        preloadedState: { avatarSession: connected },
      },
    );
    expect(
      screen.getByRole('button', { name: /start avatar/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /send to avatar/i }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: /^interrupt$/i })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: /close session/i }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: /enable audio/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('room-1')).toBeInTheDocument();
    expect(screen.getByText(/waiting for avatar video/i)).toBeInTheDocument();
  });

  it('connected with blank text: Send stays disabled; active recording blocks Close', () => {
    renderWithProviders(<AvatarSessionPanel text="   " recordingActive />, {
      preloadedState: { avatarSession: connected },
    });
    expect(
      screen.getByRole('button', { name: /send to avatar/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /close session/i }),
    ).toBeDisabled();
    expect(screen.getByText(/stop the active recording/i)).toBeInTheDocument();
  });

  it('disconnected: explains the lost connection and allows Close for cleanup', () => {
    renderWithProviders(
      <AvatarSessionPanel text="سلام" recordingActive={false} />,
      {
        preloadedState: {
          avatarSession: {
            ...connected,
            status: 'disconnected',
            error: 'SERVER_SHUTDOWN',
          },
        },
      },
    );
    expect(screen.getByText(/connection was lost/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /close session/i }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: /send to avatar/i }),
    ).toBeDisabled();
  });
});

describe('AvatarSessionPanel errors (section 8)', () => {
  it('maps any failed session start to one message, with the code and a retry', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('*/api/avatar/session', () =>
        HttpResponse.json(errorBody('configuration_error', 'PUBLIC_LIVEKIT_URL must be wss://'), {
          status: 503,
        }),
      ),
    );
    renderWithProviders(<AvatarSessionPanel text="سلام" recordingActive={false} />);

    await user.click(screen.getByRole('button', { name: /start avatar/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'The avatar session could not start. Check that the LiveAvatar account is active, then try again.',
    );
    expect(screen.getByText('configuration_error')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it.each([
    ['elevenlabs_payment', 'ElevenLabs refused the speech because the plan is not paid.'],
    ['elevenlabs_quota', 'ElevenLabs is busy or its quota is used up.'],
    ['elevenlabs_stream_error', 'The avatar could not speak the answer.'],
  ])('maps a failed speak with %s to its speech message', async (code, message) => {
    const user = userEvent.setup();
    server.use(
      http.post('*/api/avatar/speak', () =>
        HttpResponse.json(errorBody(code, 'Fixed English text.'), { status: 502 }),
      ),
    );
    renderWithProviders(<AvatarSessionPanel text="سلام" recordingActive={false} />, {
      preloadedState: { avatarSession: connected },
    });

    await user.click(screen.getByRole('button', { name: /send to avatar/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(screen.getByText(code)).toHaveAttribute('dir', 'ltr');
    expect(screen.queryByText(/Fixed English text/)).toBeNull();
  });
});
