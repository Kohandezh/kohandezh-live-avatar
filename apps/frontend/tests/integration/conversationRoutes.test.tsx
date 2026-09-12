import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real SDK talks to LiveAvatar over WebRTC. Tests drive a fake with the same events
// (see tests/utils/liveAvatarSdkMock.ts, the same mock the widget's AssistantPanel tests use).
vi.mock('@heygen/liveavatar-web-sdk', async () => {
  const mock = await import('../utils/liveAvatarSdkMock');
  return mock.createLiveAvatarSdkMockModule();
});

import { installMockApi, mockSession } from '@/data/mock';
import { ConversationLiveProvider, useConversationLive } from '@/features/navigation';
import { FloatingTabBar } from '@/features/navigation/FloatingTabBar';
import { AudioConversationPage } from '@/pages/conversation/AudioConversationPage';
import { VideoConversationPage } from '@/pages/conversation/VideoConversationPage';
import { apiClient } from '@/shared/api';
import {
  AgentEventsEnum,
  SessionEvent,
  lastFakeSession,
  resetLiveAvatarSdkMock,
  sdkState,
} from '../utils/liveAvatarSdkMock';
import { renderWithProviders } from '../utils/renderWithProviders';

/** One conversation screen, alone: no floating menu, for assertions about the
 * screen's own content (the idle button count, error and ended states). */
function renderVideoAlone() {
  return renderWithProviders(
    <ConversationLiveProvider>
      <VideoConversationPage />
    </ConversationLiveProvider>,
    { route: '/video' },
  );
}

function renderAudioAlone() {
  return renderWithProviders(
    <ConversationLiveProvider>
      <AudioConversationPage />
    </ConversationLiveProvider>,
    { route: '/audio' },
  );
}

/** The floating menu wired to the live conversation state, the way `MobileLayout`
 * wires it: the shell reads `useConversationLive()` above the outlet and passes
 * `liveRoute` down, so the menu's live dot and the navigation guard both work. */
function Shell() {
  const { liveRoute } = useConversationLive();
  return (
    <>
      <FloatingTabBar liveRoute={liveRoute} />
      <Routes>
        <Route path="/video" element={<VideoConversationPage />} />
        <Route path="/audio" element={<AudioConversationPage />} />
        <Route path="/settings" element={<p>settings page</p>} />
      </Routes>
    </>
  );
}

function renderShell(route: string) {
  return renderWithProviders(
    <ConversationLiveProvider>
      <Shell />
    </ConversationLiveProvider>,
    { route },
  );
}

async function startConversation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole('button', { name: 'Start the conversation' }),
  );
  await waitFor(() => expect(lastFakeSession()).toBeTruthy());
  return lastFakeSession();
}

describe('conversation routes (requirements 16, 17, 18, 19)', () => {
  beforeEach(() => {
    resetLiveAvatarSdkMock();
    installMockApi(apiClient, { delayMs: 0 });
    mockSession.set('u-user');
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  it('the idle video screen renders exactly one button, to start the conversation (requirement 16)', () => {
    renderVideoAlone();

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('Start the conversation');
  });

  it('shows the error state with a working retry when the SDK fails to start', async () => {
    sdkState.startError = new Error('boom');
    const user = userEvent.setup();
    renderAudioAlone();

    await user.click(
      screen.getByRole('button', { name: 'Start the conversation' }),
    );
    expect(
      await screen.findByText('Something went wrong. Try again.'),
    ).toBeInTheDocument();

    // Fix the fault, then prove the ErrorState's own Retry button (not just the
    // page's restart button) is wired to the same `controller.start`.
    sdkState.startError = null;
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() =>
      expect(
        screen.queryByText('Something went wrong. Try again.'),
      ).not.toBeInTheDocument(),
    );
    expect(sdkState.startCount).toBe(2);
  });

  it('shows the trial time-limit message once the provider ends the session', async () => {
    const user = userEvent.setup();
    renderAudioAlone();
    const session = await startConversation(user);

    act(() => {
      session.emit(AgentEventsEnum.SESSION_STOPPED, {
        stop_reason: 'time_limit_reached',
      });
    });

    expect(
      await screen.findByText('Trial conversations end after about one minute.'),
    ).toBeInTheDocument();
  });

  it('offers the audio-unblock recovery button when playback is blocked, and it retries playback', async () => {
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValue(new Error('blocked by the browser'));
    const user = userEvent.setup();
    renderAudioAlone();
    const session = await startConversation(user);

    act(() => session.emit(SessionEvent.SESSION_STREAM_READY));
    expect(
      await screen.findByText('The browser blocked the sound.'),
    ).toBeInTheDocument();

    const callsBeforeRetry = playSpy.mock.calls.length;
    playSpy.mockResolvedValueOnce(undefined);
    await user.click(screen.getByRole('button', { name: 'Turn the sound on' }));

    await waitFor(() =>
      expect(playSpy.mock.calls.length).toBeGreaterThan(callsBeforeRetry),
    );
  });

  it('/audio publishes the initial voice state to the screen-reader live region (requirement 17)', () => {
    renderAudioAlone();

    // Before the conversation starts, `assistant.voice.idle` is what a screen
    // reader (and this test) reads back off the sr-only status region.
    expect(screen.getByRole('status')).toHaveTextContent(
      'Press start, then speak.',
    );
  });

  it('blocks a route change while the avatar is speaking, and explains why with a toast (requirement 18)', async () => {
    const user = userEvent.setup();
    renderShell('/video');
    const session = await startConversation(user);

    act(() => session.emit(AgentEventsEnum.AVATAR_SPEAK_STARTED));

    await user.click(screen.getByRole('button', { name: 'Audio' }));

    // Blocked, and the reason is announced in a toast (not the leave-confirm
    // dialog, which uses the same alertdialog role, so this checks its own
    // heading rather than the role).
    expect(
      await screen.findByText('Wait until the answer finishes.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'End this conversation?' }),
    ).not.toBeInTheDocument();
    // Still on the video screen: the live controls are still the ones on screen.
    expect(screen.getByRole('button', { name: 'End' })).toBeInTheDocument();
  });

  it('asks for confirmation before leaving a live conversation, and cancelling keeps the session (requirement 19)', async () => {
    const user = userEvent.setup();
    renderShell('/video');
    await startConversation(user);

    await user.click(screen.getByRole('button', { name: 'Audio' }));

    expect(
      await screen.findByRole('heading', { name: 'End this conversation?' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Stay here' }));

    expect(
      screen.queryByRole('heading', { name: 'End this conversation?' }),
    ).not.toBeInTheDocument();
    // Still on /video, and the call is still live.
    expect(screen.getByRole('button', { name: 'End' })).toBeInTheDocument();
    expect(sdkState.stopCount).toBe(0);
  });

  it('confirming the leave ends the call and switches screens (requirement 19)', async () => {
    const user = userEvent.setup();
    renderShell('/video');
    await startConversation(user);

    await user.click(screen.getByRole('button', { name: 'Audio' }));
    await user.click(
      await screen.findByRole('button', { name: 'End and continue' }),
    );

    // The video session's own cleanup closed the provider session (amendment 1:
    // this needs no extra code, only that /video and /audio are ordinary sibling
    // routes with their own session each).
    await waitFor(() => expect(sdkState.stopCount).toBe(1));
    // Landed on a fresh, idle /audio screen: a new conversation, not the old one.
    expect(
      await screen.findByRole('button', { name: 'Start the conversation' }),
    ).toBeInTheDocument();
  });
});
