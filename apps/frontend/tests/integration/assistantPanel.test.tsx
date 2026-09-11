import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AxiosAdapter } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real SDK talks to LiveAvatar over WebRTC. Tests drive a fake with the same events.
vi.mock('@heygen/liveavatar-web-sdk', async () => {
  const mock = await import('../utils/liveAvatarSdkMock');
  return mock.createLiveAvatarSdkMockModule();
});

import {
  MOCK_ASSISTANT_AGENT_TYPE,
  installMockApi,
  mockAssistant,
  mockSession,
} from '@/data/mock';
import { AssistantPanel, useAssistantSession } from '@/features/assistant';
import { apiClient } from '@/shared/api';
import {
  AgentEventsEnum,
  AgentType,
  FakeElevenLabsAgentSession,
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

/** Makes both the token and the backend answer describe the Persian ElevenLabs agent. */
function configureElevenLabsAgent() {
  sdkState.agentType = AgentType.ELEVENLABS_AGENT;
  mockAssistant.agentType = 'elevenlabs';
}

describe('AssistantPanel', () => {
  beforeEach(() => {
    resetLiveAvatarSdkMock();
    installRecordingMockApi();
    mockAssistant.agentType = MOCK_ASSISTANT_AGENT_TYPE;
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
    expect(screen.getByText('Trial mode')).toBeInTheDocument();
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

    // Single selection, so the HeroUI toggle group renders radios, not plain buttons.
    await user.click(screen.getByRole('radio', { name: 'Voice' }));

    expect(screen.getByText('Your turn. Say something.')).toBeInTheDocument();
    expect(screen.getAllByText('Live').length).toBeGreaterThan(0);
    // The video element is only hidden, so the audio keeps playing.
    expect(screen.getByLabelText('Assistant video')).toBeInTheDocument();
    expect(FakeLiveAvatarSession.instances).toHaveLength(1);
    expect(sdkState.startCount).toBe(1);
  });

  it('offers voice and video as one labelled choice and switches back', async () => {
    renderWithProviders(<AssistantPanel />);
    const user = await startConversation();
    emitStreamReady();

    const group = screen.getByRole('radiogroup', { name: 'View' });
    const voice = within(group).getByRole('radio', { name: 'Voice' });
    const video = within(group).getByRole('radio', { name: 'Video' });
    expect(video).toBeChecked();

    await user.click(voice);
    expect(voice).toBeChecked();
    expect(video).not.toBeChecked();

    await user.click(video);
    expect(video).toBeChecked();
    // The picture comes back without a reconnect.
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
    expect(screen.getByText('Dr. Kohandezh')).toBeInTheDocument();
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
        'Trial conversations end after about one minute.',
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
    // Only the FULL mode path can fall back; the voice agent always answers in its own language.
    mockAssistant.agentType = 'full';
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
  it('drives the Persian agent with the ElevenLabs session class', async () => {
    configureElevenLabsAgent();
    renderWithProviders(<AssistantPanel />);
    await startConversation();

    expect(lastFakeSession()).toBeInstanceOf(FakeElevenLabsAgentSession);
    // The agent owns the language, so the panel says which one instead of a fallback notice.
    expect(screen.getByText('Speaks Persian')).toBeInTheDocument();
    expect(
      screen.queryByText(/Persian is not available from the provider yet/),
    ).not.toBeInTheDocument();
  });

  it('renders the conversation from the ElevenLabs event stream', async () => {
    configureElevenLabsAgent();
    renderWithProviders(<AssistantPanel />);
    await startConversation();

    act(() => {
      const session = lastFakeSession();
      session.emitElevenLabsEvent('user_transcript', {
        user_transcription_event: { user_transcript: 'سلام' },
      });
      session.emitElevenLabsEvent('agent_response', {
        agent_response_event: { agent_response: 'سلام، چطور کمک کنم؟' },
      });
      // The same answer arriving again on the generic stream must not be listed twice.
      session.emit(AgentEventsEnum.AVATAR_TRANSCRIPTION, {
        event_id: 'a-duplicate',
        text: 'سلام، چطور کمک کنم؟',
      });
    });

    expect(await screen.findByText('سلام')).toBeInTheDocument();
    // Twice: once in the list and once in the live region that announces the answer.
    expect(screen.getAllByText('سلام، چطور کمک کنم؟')).toHaveLength(2);
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('Dr. Kohandezh')).toBeInTheDocument();
  });

  it('warns when the microphone was refused and recovers on a retry', async () => {
    sdkState.micError = new DOMException('denied', 'NotAllowedError');
    renderWithProviders(<AssistantPanel />);
    const user = await startConversation();

    // The avatar still plays, so this is a warning, not a failed start.
    expect(
      screen.getByText(
        'The microphone is blocked. Allow microphone access in your browser settings and try again.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('The conversation could not start'),
    ).not.toBeInTheDocument();

    sdkState.micError = null;
    await user.click(
      screen.getByRole('button', { name: /Turn the microphone on/ }),
    );

    expect(
      await screen.findByRole('button', { name: /Mute the microphone/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        'The microphone is blocked. Allow microphone access in your browser settings and try again.',
      ),
    ).not.toBeInTheDocument();
  });

  it('reaches the connected state from the stream, before start() resolves', async () => {
    // The real FULL session resolves `start()` only after both LiveAvatar participants joined,
    // which left the UI on "Connecting…" while the avatar was already talking.
    let releaseStart = () => {};
    sdkState.startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    renderWithProviders(<AssistantPanel />);

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Start the conversation' }));
    await waitFor(() => expect(FakeLiveAvatarSession.instances).toHaveLength(1));
    emitStreamReady();

    expect(await screen.findAllByText('Live')).not.toHaveLength(0);
    expect(sdkState.attachCount).toBeGreaterThan(0);

    await act(async () => {
      releaseStart();
      await sdkState.startGate;
    });
  });
});

/** `sendText` has no control in the panel yet, so the hook is driven through a probe. */
describe('useAssistantSession text turns', () => {
  function TextTurnProbe() {
    const controller = useAssistantSession();
    return (
      <div>
        <button type="button" onClick={() => void controller.start()}>
          start
        </button>
        <button type="button" onClick={() => controller.sendText('سلام')}>
          send
        </button>
        <span>{controller.status}</span>
        <ul>
          {controller.transcript.map((turn) => (
            <li key={turn.id}>{turn.text}</li>
          ))}
        </ul>
      </div>
    );
  }

  beforeEach(() => {
    resetLiveAvatarSdkMock();
    installRecordingMockApi();
    mockAssistant.agentType = MOCK_ASSISTANT_AGENT_TYPE;
    mockSession.set('u-user');
    setOnline(true);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  it('sends a typed turn as a user message to the ElevenLabs agent', async () => {
    configureElevenLabsAgent();
    const user = userEvent.setup();
    renderWithProviders(<TextTurnProbe />);

    await user.click(screen.getByRole('button', { name: 'start' }));
    await screen.findByText('connected');
    await user.click(screen.getByRole('button', { name: 'send' }));

    // `message()` throws on that session class, so this proves the right call was made.
    expect(sdkState.sentUserMessages).toEqual(['سلام']);
    expect(await screen.findByText('سلام')).toBeInTheDocument();
  });

  it('sends a typed turn as a command in FULL mode', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TextTurnProbe />);

    await user.click(screen.getByRole('button', { name: 'start' }));
    await screen.findByText('connected');
    await user.click(screen.getByRole('button', { name: 'send' }));

    expect(sdkState.sentUserMessages).toEqual([]);
    expect(await screen.findByText('سلام')).toBeInTheDocument();
  });
});
