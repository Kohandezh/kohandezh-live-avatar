/**
 * The glyphs of the conversation control layer.
 *
 * Hand-rolled inline SVG in the house style: `viewBox="0 0 24 24"`, `stroke-width="1.8"`,
 * round caps. No icon library. Both CLAUDE.md and AGENTS.md say not to add a dependency for
 * a small need, and every other icon in this repo is written the same way.
 *
 * Every glyph is `aria-hidden`. The control that holds it carries the accessible name, so a
 * screen reader must not read the picture as well.
 *
 * None of these point anywhere, so none of them mirror in Persian. A glyph with a direction
 * (a chevron, a send arrow) would have to mirror, and the physical-anchoring exception does
 * not cover it.
 */

export interface ControlIconProps {
  /** Tailwind size class. `size-5` for every control circle; `size-4` inline in the text. */
  className?: string;
}

/**
 * The handset turned down: the one universal "end the call" symbol on a phone.
 *
 * Stronger than the square the old screen used, and the square is now free for interrupt,
 * where a media-player stop glyph is what people already know.
 */
export function PhoneEndIcon({ className }: ControlIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* The handset is drawn level, then turned. Rotating the whole glyph keeps the two
          ear pieces symmetrical, which drawing it at an angle by hand does not. */}
      <g transform="rotate(135 12 12)">
        <path d="M4.3 9.2c4.8-3 10.6-3 15.4 0v2.4c0 .9-.8 1.6-1.7 1.4l-2.2-.4a1.6 1.6 0 0 1-1.3-1.4l-.1-1.1a11.2 11.2 0 0 0-4.8 0l-.1 1.1a1.6 1.6 0 0 1-1.3 1.4l-2.2.4A1.6 1.6 0 0 1 4.3 11.6Z" />
      </g>
    </svg>
  );
}

/** The microphone. The slash is the muted cue, so the state never rests on colour alone. */
export function MicIcon({
  muted,
  className,
}: ControlIconProps & { muted: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      {muted && <path d="M4 4l16 16" />}
    </svg>
  );
}

/** Interrupt. The stop square every media player uses for "stop this now". */
export function StopIcon({ className }: ControlIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

/** Type instead of speaking. */
export function KeyboardIcon({ className }: ControlIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8" />
    </svg>
  );
}

/** The hint at the end of the transcript block that the block opens something. */
export function TranscriptIcon({ className }: ControlIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 5h16v11H8l-4 3V5Z" />
      <path d="M8 9h8M8 12.5h5" />
    </svg>
  );
}
