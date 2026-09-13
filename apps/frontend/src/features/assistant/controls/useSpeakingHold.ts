import { useEffect, useState } from 'react';

/**
 * How long the interrupt button stays live after the avatar stops speaking.
 *
 * The same 800 ms the orb already uses for its live region (`ANNOUNCE_DELAY_MS` in
 * `AssistantOrb.tsx`), and for the same reason.
 */
export const SPEAKING_HOLD_MS = 800;

/**
 * `isSpeaking`, held true for a moment after it goes false.
 *
 * `isAvatarSpeaking` flips several times inside one answer: once per speech segment, and the
 * ElevenLabs `interruption` event forces it false as well. Binding the interrupt button
 * straight to the raw flag would make the one control the design teaches through its enabled
 * state blink dim and lit several times per answer. Worse, it makes the button unreliable to
 * hit: the user aims at a lit button and presses a dim one.
 *
 * Holding turns one answer into one steady change.
 */
export function useSpeakingHold(
  isSpeaking: boolean,
  holdMs: number = SPEAKING_HOLD_MS,
): boolean {
  const [held, setHeld] = useState(isSpeaking);

  useEffect(() => {
    if (isSpeaking) {
      setHeld(true);
      return;
    }
    const timer = window.setTimeout(() => setHeld(false), holdMs);
    return () => window.clearTimeout(timer);
  }, [isSpeaking, holdMs]);

  return held;
}
