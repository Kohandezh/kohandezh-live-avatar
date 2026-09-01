import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
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
  },
  media: { audio: true, video: false },
  audioBlocked: true,
  speaking: false,
  error: null,
};

describe('AvatarSessionPanel states', () => {
  it('idle: only Start is enabled and the empty video state is shown', () => {
    renderWithProviders(<AvatarSessionPanel text="سلام" recordingActive={false} />);
    expect(screen.getByRole('button', { name: /start avatar/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /send to avatar/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^interrupt$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /close session/i })).toBeDisabled();
    expect(screen.getByText(/start a session to see the avatar/i)).toBeInTheDocument();
  });

  it('connected: speak/interrupt/close enabled, audio-blocked prompt and identifiers shown', () => {
    renderWithProviders(<AvatarSessionPanel text="سلام" recordingActive={false} />, {
      preloadedState: { avatarSession: connected },
    });
    expect(screen.getByRole('button', { name: /start avatar/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /send to avatar/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^interrupt$/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /close session/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /enable audio/i })).toBeInTheDocument();
    expect(screen.getByText('room-1')).toBeInTheDocument();
    expect(screen.getByText(/waiting for avatar video/i)).toBeInTheDocument();
  });

  it('connected with blank text: Send stays disabled; active recording blocks Close', () => {
    renderWithProviders(<AvatarSessionPanel text="   " recordingActive />, {
      preloadedState: { avatarSession: connected },
    });
    expect(screen.getByRole('button', { name: /send to avatar/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /close session/i })).toBeDisabled();
    expect(screen.getByText(/stop the active recording/i)).toBeInTheDocument();
  });

  it('disconnected: explains the lost connection and allows Close for cleanup', () => {
    renderWithProviders(<AvatarSessionPanel text="سلام" recordingActive={false} />, {
      preloadedState: {
        avatarSession: { ...connected, status: 'disconnected', error: 'SERVER_SHUTDOWN' },
      },
    });
    expect(screen.getByText(/connection was lost/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close session/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /send to avatar/i })).toBeDisabled();
  });
});
