import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  ConversationLiveProvider,
  useConversationLive,
  usePublishConversationLive,
} from '@/features/navigation/ConversationLiveContext';

function Publisher({ isLive }: { isLive: boolean }) {
  const renders = useRef(0);
  renders.current += 1;
  // A fresh object every render, exactly like the conversation pages build.
  usePublishConversationLive({
    isLive,
    isAvatarSpeaking: false,
    liveRoute: isLive ? '/video' : null,
  });
  return <p data-testid="publisher-renders">{renders.current}</p>;
}

function Reader() {
  const live = useConversationLive();
  return <p data-testid="reader">{String(live.isLive)}</p>;
}

function Harness() {
  const [isLive, setIsLive] = useState(false);
  return (
    <ConversationLiveProvider>
      <Publisher isLive={isLive} />
      <Reader />
      <button onClick={() => setIsLive(true)}>go live</button>
    </ConversationLiveProvider>
  );
}

/**
 * Regression test for the infinite render loop the build agent found in
 * `ConversationLiveContext`: a publishing effect that re-runs every time it
 * writes a fresh state object hangs the page it is mounted on. This checks the
 * provider settles to a small, bounded number of renders instead of looping.
 */
describe('ConversationLiveContext', () => {
  it('settles instead of looping, and the reader sees the published state', () => {
    render(<Harness />);

    expect(screen.getByTestId('reader')).toHaveTextContent('false');
    const settledRenders = Number(
      screen.getByTestId('publisher-renders').textContent,
    );
    expect(settledRenders).toBeLessThan(5);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'go live' }));
    });

    expect(screen.getByTestId('reader')).toHaveTextContent('true');
    expect(
      Number(screen.getByTestId('publisher-renders').textContent),
    ).toBeLessThan(settledRenders + 5);
  });

  it('resets to idle when the publisher unmounts, so leaving the route clears the live dot', () => {
    function Toggle() {
      const [mounted, setMounted] = useState(true);
      return (
        <ConversationLiveProvider>
          {mounted ? <Publisher isLive /> : null}
          <Reader />
          <button onClick={() => setMounted(false)}>unmount</button>
        </ConversationLiveProvider>
      );
    }

    render(<Toggle />);
    expect(screen.getByTestId('reader')).toHaveTextContent('true');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'unmount' }));
    });

    expect(screen.getByTestId('reader')).toHaveTextContent('false');
  });
});
