import { memo, useId, type ReactNode } from 'react';
import { Spinner } from '@heroui/react';
import { cn } from '@/shared/utils';

export interface ControlButtonProps {
  /**
   * One of the four `control-anchor-*` utilities, passed in as a whole literal string.
   *
   * Never build this name from parts. Tailwind v4 scans source files for literal class
   * names, so `control-anchor-${row}-${side}` matches nothing, all four utilities get
   * pruned from the stylesheet, and every control lands in the same corner with no error.
   * See the comment block above the utilities in globals.css.
   */
  anchorClassName: string;
  /**
   * The accessible name. With `showLabel` it is also the visible word under the circle, so
   * the button is named by its own text and needs no `aria-label` at all.
   */
  label: string;
  showLabel?: boolean;
  icon: ReactNode;
  /** 48 px for the three secondary controls, 64 px for the microphone. */
  size?: 'md' | 'lg';
  /** Solid accent instead of glass. The live microphone, so the primary control reads as on. */
  isFilled?: boolean;
  tone?: 'default' | 'danger';
  /**
   * Dimmed and refused, but still focusable and still pressable.
   *
   * `aria-disabled`, never the `disabled` attribute. A dead button that swallows the tap
   * teaches the user nothing, which is why `useNavigationGuard` already keeps a blocked tab
   * reachable so it can explain itself. `disabled` would also drop End out of the tab order
   * for as long as it is ending.
   */
  isBlocked?: boolean;
  /**
   * Why it is blocked, in words.
   *
   * Read out as the control's description, so a screen reader hears "Interrupt, unavailable,
   * only while Dr. Kohandezh is speaking" rather than just "unavailable". A dimmed control with
   * no explanation reads as broken. Sighted users get the same sentence in the notice line when
   * they press it.
   */
  blockedReason?: string;
  /** A spinner in place of the icon. Not beside it: the circle holds one thing at a time. */
  isPending?: boolean;
  onPress: () => void;
  /** Runs instead of `onPress` while blocked, so a refused press can say why. */
  onBlockedPress?: () => void;
}

/**
 * One physically anchored circle in the conversation control layer.
 *
 * A native `<button>` rather than the shared `Button`, for three reasons that all come from
 * the same place: the shared wrapper forces `isDisabled` whenever it is pending, `isDisabled`
 * is also where its dimmed look comes from, and it renders the spinner next to the children
 * instead of in place of them. This screen needs a dimmed control that is still focusable,
 * and a spinner that replaces the icon.
 *
 * The glass box never moves and its opacity is never animated. globals.css is explicit that
 * both force the backdrop blur to be recomputed, so the press feedback and the dim both sit
 * on the inner icon instead.
 *
 * Memoised because the page re-renders once a second while a session has a deadline, and four
 * backdrop filters over a running orb animation are not worth re-rendering at 1 Hz.
 */
export const ControlButton = memo(function ControlButton({
  anchorClassName,
  label,
  showLabel = false,
  icon,
  size = 'md',
  isFilled = false,
  tone = 'default',
  isBlocked = false,
  blockedReason,
  isPending = false,
  onPress,
  onBlockedPress,
}: ControlButtonProps) {
  const reasonId = useId();
  const hasReason = isBlocked && Boolean(blockedReason);

  /*
    A blocked control is never solid.

    Two reasons, and both point the same way. A solid accent circle with a dimmed glyph reads
    as on and off at the same time, and the dim below is a colour that is only tuned against
    the glass. The call site already avoids the combination; deciding it here means the two
    can never disagree.
  */
  const isSolid = isFilled && !isBlocked;

  /*
    One colour class for the icon, chosen here instead of stacked into `cn()`.

    `cn()` is a plain `join(' ')`, not tailwind-merge, so two classes that set the same
    property both land in the attribute and the stylesheet order picks the winner, not the
    order of the arguments. `.text-danger` is emitted before `.text-foreground`, so an End
    button that passed both came out foreground grey instead of red.

    Blocked wins first: dimmed and refused is the state the user has to read. `--muted` is the
    secondary-text token, tuned in globals.css to 4.76:1 on the page ground and 5.18:1 on a
    surface, so the glyph stays over the 3:1 a non-text element needs in both themes and in
    the reduced-transparency fallback. Plain `opacity: 0.4` did not: measured 2.58:1 in light.
  */
  const iconColorClass = isBlocked
    ? 'text-muted'
    : isSolid
      ? 'text-accent-foreground'
      : tone === 'danger'
        ? 'text-danger'
        : 'text-foreground';

  return (
    <button
      type="button"
      aria-disabled={isBlocked || undefined}
      aria-describedby={hasReason ? reasonId : undefined}
      // Which controls are refused, readable from outside. The same idea as the notice line's
      // `data-notice` and the orb's `data-sphere-state`: a test should not have to infer the
      // state from a colour. The dim itself is a colour token on the icon, not a class hung
      // off this attribute, because a colour can be measured and `opacity: 0.4` could not
      // clear 3:1 in light.
      data-soft-disabled={isBlocked ? 'true' : undefined}
      // Named by its visible word when it has one, so a screen reader does not read the name
      // and then the same word again.
      aria-label={showLabel ? undefined : label}
      onClick={isBlocked ? onBlockedPress : onPress}
      className={cn(
        anchorClassName,
        // The layer above is `pointer-events-none` so taps reach the screen behind it. Each
        // control turns them back on for its own box.
        'group pointer-events-auto flex flex-col items-center gap-1 rounded-2xl',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
      )}
    >
      <span
        className={cn(
          'flex items-center justify-center rounded-full',
          size === 'lg' ? 'size-16' : 'size-12',
          isSolid ? 'bg-accent' : 'glass glass-fringe',
          iconColorClass,
        )}
      >
        {/* Everything that changes visually happens on this span, never on the glass. */}
        <span
          className={cn(
            'flex transition-opacity duration-150',
            // The press dim, and the one control that must not get it. A refused press
            // already answers in the notice line, and 70% of an already dimmed glyph
            // measures 2.85:1 in light, back under the 3:1 the resting state just cleared.
            !isBlocked && 'group-active:opacity-70',
          )}
        >
          {isPending ? (
            <Spinner color="current" size="sm" aria-hidden />
          ) : (
            icon
          )}
        </span>
      </span>

      {showLabel && (
        <span
          className={cn(
            'text-xs font-medium',
            // Not plain `text-danger`. globals.css measures that token at 4.0:1 as text on a
            // dark ground, because it is tuned to carry white ON a red fill. HeroUI's
            // `--danger-soft-foreground` is the same family meant to be read as text, and the
            // repo already redirects its own danger text roles to it for this reason. The icon
            // keeps `text-danger`: a glyph is a non-text element and needs 3:1, not 4.5:1.
            tone === 'danger'
              ? 'text-(--danger-soft-foreground)'
              : 'text-foreground',
          )}
        >
          {label}
        </span>
      )}

      {/* The description, not the name. `aria-label` above already sets the name for the
          icon-only controls, so this span is only ever read as the "why". */}
      {hasReason && (
        <span id={reasonId} className="sr-only">
          {blockedReason}
        </span>
      )}
    </button>
  );
});
