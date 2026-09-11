import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AxiosAdapter } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real SDK talks to LiveAvatar over WebRTC. Tests drive a fake with the same events.
vi.mock('@heygen/liveavatar-web-sdk', async () => {
  const mock = await import('../utils/liveAvatarSdkMock');
  return mock.createLiveAvatarSdkMockModule();
});

import { installMockApi, mockSession } from '@/data/mock';
import { AssistantPanel } from '@/features/assistant';
import { apiClient } from '@/shared/api';
import {
  AgentEventsEnum,
  FakeLiveAvatarSession,
  SessionEvent,
  lastFakeSession,
  resetLiveAvatarSdkMock,
  sdkState,
} from '../utils/liveAvatarSdkMock';
import { renderWithProviders } from '../utils/renderWithProviders';

const requests: string[] = [];

/** The mock adapter plus a log, so a test can prove the backend session was closed. */
function installRecordingMockApi() {
  requests.length = 0;
  installMockApi(apiClient, { delayMs: 0 });
  const inner = apiClient.defaults.adapter as AxiosAdapter;
  apiClient.defaults.adapter = (config) => {
    requests.push(`${config.method?.toUpperCase()} ${config.url}`);
    return inner(config);
  };
}

function setOnline(isOnline: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => isOnline,
  });
}

async function startConversation() {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole('button', { name: 'Start the conversation' }),
  );
  await screen.findAllByText('Live');
  return user;
}

function emitStreamReady() {
  act(() => lastFakeSession().emit(SessionEvent.SESSION_STREAM_READY));
}

describe('AssistantPanel', () => {
  beforeEach(() => {
    resetLiveAvatarSdkMock();
    installRecordingMockApi();
    mockSession.set('u-user');
    setOnline(true);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  it('starts idle with the video area and an empty transcript', () => {
    renderWithProviders(<AssistantPanel />);

    expect(
      screen.getByRole('button', { name: 'Start the conversation' }),
    ).toBeEnabled();
    expect(screen.getByLabelText('Assistant video')).toBeInTheDocument();
    expect(screen.getByText('Nothing said yet')).toBeInTheDocument();
    expect(screen.getByText('Not started')).toBeInTheDocument();
  });

  it('shows progress while the session is being prepared', async () => {
    // Hold the backend answer so the "requesting" state is observable, not a race.
    let releaseBackend = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseBackend = resolve;
    });
    const inner = apiClient.defaults.adapter as AxiosAdapter;
    apiClient.defaults.adapter = async (config) => {
      await gate;
      return inner(config);
    };

    renderWithProviders(<AssistantPanel />);
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Start the conversation' }));

    expect(await screen.findAllByText('Preparing…')).not.toHaveLength(0);
    expect(
      screen.getByRole('button', { name: 'Start the conversation' }),
    ).toBeDisabled();

    await act(async () => {
      releaseBackend();
      await gate;
    });
    await screen.findAllByText('Live');
  });

  it('mints a session, connects the SDK, and keeps the token out of the page', async () => {
    renderWithProviders(<AssistantPanel />);
    await startConversation();

    expect(requests).toContain('POST /api/assistant/session');
    expect(lastFakeSession().sessionToken).toBe('mock-session-token');
    expect(sdkState.attachCount).toBeGreaterThan(0);
    expect(document.body.innerHTML).not.toContain('mock-session-token');
    expect(screen.getByText('Test mode')).toBeInTheDocument();
  });

  it('shows the video once the provider reports the stream is ready', async () => {
    renderWithProviders(<AssistantPanel />);
    await startConversation();

    expect(screen.getByText('Connected. Waiting for the video…')).toBeVisible();
    emitStreamReady();

    await waitFor(() =>
      expect(
        screen.queryByText('Connected. Waiting for the video…'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Assistant video')).toBeInTheDocument();
  });

  it('switches to voice mode without reconnecting', async () => {
    renderWithProviders(<AssistantPanel />);
    const user = await startConversation();
    emitStreamReady();

    await user.click(screen.getByRole('button', { name: 'Voice' }));

    expect(screen.getByText('Your turn. Say something.')).toBeInTheDocument();
    expect(screen.getAllByText('Live').length).toBeGreaterThan(0);
    // The video element is only hidden, so the audio keeps playing.
    expect(screen.getByLabelText('Assistant video')).toBeInTheDocument();
    expect(FakeLiveAvatarSession.instances).toHaveLength(1);
    expect(sdkState.startCount).toBe(1);
  });

  it('mutes and unmutes the microphone', async () => {
    renderWithProviders(<AssistantPanel />);
    const user = await startConversation();

    await user.click(
      screen.getByRole('button', { name: /Mute the microphone/ }),
    );
    const unmute = await screen.findByRole('button', {
      name: /Turn the microphone on/,
    });
    expect(lastFakeSession().voiceChat.isMuted).toBe(true);

    await user.click(unmute);
    expect(
      await screen.findByRole('button', { name: /Mute the microphone/ }),
    ).toBeInTheDocument();
    expect(lastFakeSession().voiceChat.isMuted).toBe(false);
  });

  it('sends an interrupt to the running session', async () => {
    renderWithProviders(<AssistantPanel />);
    const user = await startConversation();

    await user.click(screen.getByRole('button', { name: 'Interrupt' }));

    expect(sdkState.interruptCount).toBe(1);
  });

  it('renders both sides of the conversation', async () => {
    renderWithProviders(<AssistantPanel />);
    await startConversation();

    act(() => {
      const session = lastFakeSession();
      session.emit(AgentEventsEnum.USER_TRANSCRIPTION, {
        event_id: 'u1',
        text: 'سلام',
      });
      session.emit(AgentEventsEnum.AVATAR_TRANSCRIPTION, {
        event_id: 'a1',
        text: 'سلام، چطور می‌توانم کمک کنم؟',
      });
    });

    expect(await screen.findByText('سلام')).toBeInTheDocument();
    // Twice: once in the list and once in the polite live region that announces the answer.
    expect(screen.getAllByText('سلام، چطور می‌توانم کمک کنم؟')).toHaveLength(2);
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('Assistant')).toBeInTheDocument();
  });

  it('ends the conversation when the provider reaches the time limit', async () => {
    renderWithProviders(<AssistantPanel />);
    await startConversation();

    act(() =>
      lastFakeSession().emit(AgentEventsEnum.SESSION_STOPPED, {
        event_id: 's1',
        stop_reason: 'max_session_duration_reached',
      }),
    );

    expect(
      await screen.findByText('The conversation ended'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'The test session reached its limit of about one minute.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Start again' }),
    ).toBeInTheDocument();
    // The backend row is closed even though the user did not press End.
    await waitFor(() =>
      expect(requests.some((entry) => entry.includes('/close'))).toBe(true),
    );
  });

  it('ends the conversation when the user presses End', async () => {
    renderWithProviders(<AssistantPanel />);
    const user = await startConversation();

    await user.click(screen.getByRole('button', { name: /End/ }));

    expect(
      await screen.findByText(
        'You ended the conversation. You can start a new one.',
      ),
    ).toBeInTheDocument();
    expect(sdkState.stopCount).toBe(1);
    expect(requests).toContain(
      'POST /api/assistant/session/mock-assistant-session/close',
    );
  });

  it('closes the backend session when the SDK fails to start and offers a retry', async () => {
    sdkState.startError = new Error('ICE failed');
    renderWithProviders(<AssistantPanel />);

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Start the conversation' }));

    expect(
      await screen.findByText('The conversation could not start'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Something went wrong. Try again.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(requests).toContain(
      'POST /api/assistant/session/mock-assistant-session/close',
    );
  });

  it('explains an expired session when the backend answers 401', async () => {
    mockSession.clear();
    renderWithProviders(<AssistantPanel />);

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Start the conversation' }));

    expect(
      await screen.findByText('Your session has expired. Log in again.'),
    ).toBeInTheDocument();
    expect(FakeLiveAvatarSession.instances).toHaveLength(0);
  });

  it('tells the user when the provider could not honor the requested language', async () => {
    renderWithProviders(<AssistantPanel language="fa" />);
    await startConversation();

    // The mock (like the real provider, verified 2026-09-11) only supports "en" today, so a
    // Persian request falls back and the panel must say so instead of pretending it is Persian.
    expect(
      screen.getByText(
        'The assistant speaks English for now. Persian is not available from the provider yet.',
      ),
    ).toBeInTheDocument();
  });

  it('blocks the start button while the browser is offline', () => {
    setOnline(false);
    renderWithProviders(<AssistantPanel />);

    expect(
      screen.getByText(
        'You are offline. The conversation needs a network connection.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Start the conversation' }),
    ).toBeDisabled();
  });
});
