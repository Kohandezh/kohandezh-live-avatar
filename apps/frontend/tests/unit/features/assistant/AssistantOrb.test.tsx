import { act, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantOrb, type AssistantOrbProps } from '@/features/assistant/orb';
import en from '@/i18n/locales/en/common.json';
import { renderWithProviders } from '../../../utils/renderWithProviders';

/**
 * The orb's caption, and the `isStartHidden` signal of Foreman ruling 4: while the lead card hides
 * Start on `/audio`, the idle caption "Press start, then speak." would point at a button that is
 * not there, so the orb says nothing at idle then.
 */

const IDLE = en.assistant.voice.idle;

function renderOrb(props: Partial<AssistantOrbProps> = {}) {
  return renderWithProviders(
    <AssistantOrb
      status="idle"
      isUserSpeaking={false}
      isAvatarSpeaking={false}
      isMicMuted={false}
      mediaRef={createRef<HTMLMediaElement>()}
      {...props}
    />,
  );
}

/** The screen reader copy follows the visible one after a short delay. */
function settle() {
  act(() => {
    vi.advanceTimersByTime(2_000);
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AssistantOrb caption and isStartHidden (ruling 4)', () => {
  it('says "Press start, then speak." at idle by default, for every other caller', () => {
    vi.useFakeTimers();
    renderOrb();
    settle();

    expect(screen.getByText(IDLE, { selector: 'p[aria-hidden="true"]' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(IDLE);
  });

  it('shows no caption at idle while Start is hidden, on screen or for a screen reader', () => {
    vi.useFakeTimers();
    renderOrb({ isStartHidden: true });
    settle();

    expect(screen.queryByText(IDLE)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('keeps the caption line, so the sphere does not grow when the caption goes', () => {
    renderOrb({ isStartHidden: true });

    const line = document.querySelector('p[aria-hidden="true"]');
    expect(line).not.toBeNull();
    expect(line?.textContent).toBe(' ');
  });

  it('only silences idle: once the session is requested the status caption shows again', () => {
    vi.useFakeTimers();
    renderOrb({ isStartHidden: true, status: 'requesting' });
    settle();

    expect(screen.getByRole('status')).toHaveTextContent(en.assistant.status.requesting);
  });
});
