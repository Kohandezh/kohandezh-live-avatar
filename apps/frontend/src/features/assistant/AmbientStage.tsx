import { cn } from '@/shared/utils';

/**
 * The two glows read as one light source drifting behind frosted glass. They are plain
 * radial gradients, never a `filter: blur()`: a radial gradient is already the blurred
 * shape of a point light, and a real filter would turn this box into a Backdrop Root and
 * silently flatten the glass chrome drawn on top of it.
 *
 * The colours come from the sphere hue tokens in `globals.css`, so the ambient stage and
 * the audio sphere are the same light in two places.
 */
const USER_GLOW =
  'radial-gradient(closest-side, oklch(66% 0.20 var(--sphere-hue-user) / 0.55), oklch(66% 0.20 var(--sphere-hue-user) / 0) 100%)';

const AGENT_GLOW =
  'radial-gradient(closest-side, oklch(70% 0.19 var(--sphere-hue-agent) / 0.45), oklch(70% 0.19 var(--sphere-hue-agent) / 0) 100%)';

/**
 * The fallback backdrop for the conversation stage while nothing is streaming.
 *
 * There is no preview film yet (`media/video/` holds only a `.gitkeep`), and a black
 * rectangle behind the start button looks broken rather than calm. This is the designed
 * stand-in: set `VITE_ASSISTANT_PREVIEW_VIDEO` and `ConversationStage` plays the real
 * loop instead, with no other change.
 *
 * Decoration only, so it is hidden from screen readers.
 */
export function AmbientStage({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden bg-background',
        className,
      )}
    >
      {/*
        Each glow sits off centre inside a slowly rotating layer, so it travels a wide
        circle instead of pulsing in place. Only `transform` animates, which is the one
        property that is cheap to composite and safe above a glass element.
      */}
      <div className="absolute inset-[-25%] animate-spin [animation-duration:52s] motion-reduce:animate-none">
        <div
          className="absolute start-[8%] top-[10%] size-[70%] rounded-full"
          style={{ backgroundImage: USER_GLOW }}
        />
      </div>

      <div className="absolute inset-[-30%] animate-spin [animation-direction:reverse] [animation-duration:68s] motion-reduce:animate-none">
        <div
          className="absolute end-[6%] bottom-[8%] size-[62%] rounded-full"
          style={{ backgroundImage: AGENT_GLOW }}
        />
      </div>
    </div>
  );
}
