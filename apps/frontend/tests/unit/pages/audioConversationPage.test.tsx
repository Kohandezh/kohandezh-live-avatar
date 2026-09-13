import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real SDK talks to LiveAvatar over WebRTC. Same fake the conversation route tests drive.
vi.mock('@heygen/liveavatar-web-sdk', async () => {
  const mock = await import('../../utils/liveAvatarSdkMock');
  return mock.createLiveAvatarSdkMockModule();
});

import { installMockApi, mockSession } from '@/data/mock';
import { ConversationLiveProvider } from '@/features/navigation';
import { AudioConversationPage } from '@/pages/conversation/AudioConversationPage';
import { apiClient } from '@/shared/api';
import {
  lastFakeSession,
  resetLiveAvatarSdkMock,
  sdkState,
} from '../../utils/liveAvatarSdkMock';
import { renderWithProviders } from '../../utils/renderWithProviders';

/**
 * The three promises of the `/audio` screen that live in the page rather than in a control:
 * which live region announces what, and where the keyboard lands when a session ends.
 *
 * All three were broken in ways a diff hides. The notice line hard-coded `role="status"` and
 * only swapped `aria-live`, so the denied-microphone case never became the alert it was
 * designed as. The same line then repeated a refused press that the control had already read
 * out on focus. And the focus effect only knew about `ended`, so a start that FAILED dropped
 * the keyboard on `<body>`.
 */

/** The notice line, found by the attribute it publishes its state on. */
function noticeLine(): HTMLElement {
  const line = document.querySelector('[data-notice]');
  if (!(line instanceof HTMLElement)) throw new Error('no notice line');
  return line;
}

function renderAudio() {
  return renderWithProviders(
    <ConversationLiveProvider>
      <AudioConversationPage />
    </ConversationLiveProvider>,
    { route: '/audio' },
  );
}

async function startConversation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole('button', { name: 'Start the conversation' }),
  );
  await waitFor(() => expect(lastFakeSession()).toBeTruthy());
}

describe('the /audio page', () => {
  beforeEach(() => {
    resetLiveAvatarSdkMock();
    installMockApi(apiClient, { delayMs: 0 });
    mockSession.set('u-user');
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  it('inserts the notice line as a real alert when the microphone is denied', async () => {
    /*
      The conversation keeps running when the microphone is refused, which is exactly why this
      one message has to interrupt: the avatar talks, the user talks back, and nobody hears
      them. Denying the device on a mute press is the version of it that can be watched from
      both sides, because the line is a polite status first.
    */
    const user = userEvent.setup();
    renderAudio();
    await startConversation(user);

    // Found by `data-notice`: the orb's own caption is a second `role="status"` on this screen.
    const polite = await waitFor(noticeLine);
    expect(polite).toHaveAttribute('role', 'status');
    expect(polite).toHaveAttribute('aria-live', 'polite');

    sdkState.muteError = new DOMException('denied', 'NotAllowedError');
    await user.click(screen.getByRole('button', { name: 'Mute the microphone' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The microphone is blocked.');
    expect(alert).toHaveAttribute('aria-live', 'assertive');

    /*
      The point of the whole fix: a NEW node. Several screen readers read a live region's role
      and politeness when the node is inserted and ignore a later change, so rewriting the role
      on the element that is already there never produces an alert.
    */
    expect(alert).not.toBe(polite);
    expect(polite).not.toBeInTheDocument();

    // The reserved height is the same either way, so the swap cannot move the orb.
    expect(alert).toHaveClass('h-11');
  });

  it('shows a refused press without saying it a second time', async () => {
    const user = userEvent.setup();
    renderAudio();
    await startConversation(user);

    const interrupt = await screen.findByRole('button', { name: 'Interrupt' });
    // Refused because the avatar is not speaking, and the reason is already the control's
    // own description, which a screen reader reads on focus.
    await waitFor(() =>
      expect(interrupt).toHaveAttribute('aria-disabled', 'true'),
    );
    expect(interrupt).toHaveAccessibleDescription(
      'Only while Dr. Kohandezh is speaking',
    );

    await user.click(interrupt);

    const line = noticeLine();
    expect(line).toHaveTextContent('Only while Dr. Kohandezh is speaking');
    // Seen, not said. Saying it here would be the second announcement of one sentence.
    expect(line).toHaveAttribute('aria-live', 'off');
  });

  it('moves the keyboard to the error card when a start fails', async () => {
    /*
      The control layer mounts on `isSessionOpen`, which is false for `error` as well as for
      `ended`. So a start that fails while the keyboard is on End unmounts the focused button,
      and without somewhere to send it the focus falls all the way to `<body>`.
    */
    sdkState.startError = new Error('boom');
    const user = userEvent.setup();
    renderAudio();

    await user.click(
      screen.getByRole('button', { name: 'Start the conversation' }),
    );

    const card = await screen.findByText('The conversation could not start');
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
    });
    expect(document.activeElement).toContainElement(card);
  });
});
