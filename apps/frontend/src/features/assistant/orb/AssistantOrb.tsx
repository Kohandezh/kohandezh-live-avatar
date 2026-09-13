import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/utils';
import { usePrefersReducedMotion } from '../useConversationScreen';
import type { AssistantStatus } from '../types';
import {
  ORB_HUE_SHIFT_DEG,
  levelTarget,
  orbFrame,
  orbState,
  smoothLevel,
  type OrbSignals,
  type OrbState,
} from './orb';
import { useAvatarAudioLevel } from './useAvatarAudioLevel';

/**
 * A screen reader must not hear every flip of the speaking flags. They change several times
 * per turn, so the live region waits this long before it reads the new state.
 */
const ANNOUNCE_DELAY_MS = 800;

/** A tab that was in the background for a minute must not replay that minute in one step. */
const MAX_FRAME_MS = 50;

/** The artwork, animating itself with SMIL. Served from `public/`, never bundled. */
const ART_SRC = '/images/ai-voice.svg';

/**
 * The same artwork with every `<animate>` removed, so it is one still picture.
 *
 * Needed because the artwork is an `<img>`, and nothing inside an `<img>` can be reached
 * from the page: `svg.pauseAnimations()` is not callable on it. Swapping the `src` is the
 * only thing that actually stops the motion, so that is what reduced motion does.
 */
const ART_STILL_SRC = '/images/ai-voice-still.svg';

/** Keeps the DOM writes small. Four decimals is far below one device pixel. */
function round(value: number): string {
  return value.toFixed(4);
}

/**
 * How present the artwork looks in each state, as plain opacity.
 *
 * Opacity alone, and changed only when the state changes, never once per frame. A muted
 * microphone and a finished call both pull the orb back without touching its colours, which
 * the caption underneath already names in words.
 */
const ART_OPACITY: Record<OrbState, number> = {
  idle: 0.95,
  user: 1,
  agent: 1,
  muted: 0.6,
  ended: 0.35,
};

/*
  The three objects below are inline styles on purpose, not Tailwind classes.

  `globals.css` imports Tailwind with `source('../')`, so Tailwind reads every file under
  `src/` and builds a utility for every word in them that could be a class name. The widget
  target then inlines that whole stylesheet into `dist/widget/assistant-widget.js`. A handful
  of utilities that only this screen uses would still ride along in the script every customer
  embeds. Measured, keeping them out of Tailwind is the difference between a 900 byte bigger
  widget and a 0 byte bigger one.

  They sit at module scope so React sees the same object on every render and never has to
  rewrite the style attribute.
*/
/*
  The picture, and the only part of this column that is allowed to give way.

  It used to carry `max-height: max(5rem, calc(100dvh - 26rem))`, which guessed how much of the
  viewport the bands above and below the orb would eat. The guess sized the SPHERE and forgot
  the caption under it, so on a 700x320 window the sphere took the whole 84px the column had
  and the caption was cut off top and bottom, over the notice line. The guess was also far too
  pessimistic on a landscape phone, where it clamped the sphere to its 5rem floor with 127px
  of room going spare.

  There is no fixed number here now. This box is the one shrinkable item in the column, the
  caption below is `shrink-0`, so flexbox reserves the caption's line first and hands the
  sphere whatever is left. The caption can no longer be clipped at any height, and the sphere
  is as big as the box it actually has rather than as big as a formula predicted.

  `min-height: 0` is what allows the shrink: a flex item's automatic minimum size would
  otherwise hold this box at its full square.
*/
const ORB_BOX: CSSProperties = {
  aspectRatio: '1 / 1',
  maxWidth: '18rem',
  minHeight: 0,
};

const HALO_BOX: CSSProperties = {
  // Fully clear to start with. Effects run after the first paint, so a brighter value here
  // would flash a full-strength purple ring for one frame on every mount.
  opacity: 0,
  /*
    `circle`, not the default ellipse. Once the box has been squeezed it is wider than it is
    tall, and an ellipse would stretch the glow sideways while the artwork inside stays round
    (see `object-contain` on the image). `closest-side` on a circle is the half of the shorter
    side, which is exactly the radius the letterboxed artwork takes.
  */
  background:
    'radial-gradient(circle closest-side, color-mix(in oklch, var(--accent) 60%, transparent), transparent 72%)',
};

/*
  The artwork sits after the halo in the document and takes a position of its own, so normal
  painting order puts it on top. That is why neither element needs a z-index, and why this
  box needs no stacking context of its own.

  `will-change` tells the compositor up front that this element is about to be transformed,
  so the first frame of a turn does not pay for building a new layer.
*/
const ART_BOX: CSSProperties = {
  position: 'relative',
  willChange: 'transform',
};

/**
 * Empty unless someone turns the hue shift on. See the note on `ORB_HUE_SHIFT_DEG`.
 *
 * Built once, at module scope, so it is a static value and never a per-frame cost.
 */
const HUE_SHIFT: CSSProperties =
  ORB_HUE_SHIFT_DEG === 0
    ? {}
    : { filter: `hue-rotate(${ORB_HUE_SHIFT_DEG}deg)` };

/**
 * Which sentence describes the conversation right now.
 *
 * `assistant.voice.*` has no entry for `requesting` or `connecting`, so those two fall back
 * to `assistant.status.*`.
 */
function messageKey(signals: OrbSignals): string {
  const { status, isAvatarSpeaking, isMicMuted, isUserSpeaking } = signals;
  if (status === 'requesting' || status === 'connecting') {
    return `assistant.status.${status}`;
  }
  if (status !== 'connected') return `assistant.voice.${status}`;
  if (isAvatarSpeaking) return 'assistant.voice.speaking';
  if (isMicMuted) return 'assistant.voice.muted';
  if (isUserSpeaking) return 'assistant.voice.listening';
  return 'assistant.voice.ready';
}

export interface AssistantOrbProps {
  status: AssistantStatus;
  isUserSpeaking: boolean;
  isAvatarSpeaking: boolean;
  isMicMuted: boolean;
  /**
   * The media element of the screen that renders this orb. The avatar's audio track rides on
   * it as a `MediaStream`, which is where the real loudness is measured.
   */
  mediaRef: RefObject<HTMLMediaElement | null>;
  className?: string;
}

/**
 * The AI Voice orb (requirement 17).
 *
 * The picture is the user's own SVG artwork. It animates itself with SMIL and this component
 * never edits a single node inside it. All the speaking cue does is scale a WRAPPER around
 * it, and brighten a halo behind it, so the artwork stays exactly as the user drew it.
 *
 * Two cues, different in kind so nobody has to compare sizes:
 *
 * - **The agent speaking breathes.** The wrapper swells from 1 to 1.08 with the measured
 *   loudness of the avatar's voice. Fast to rise, slow to fall, so syllables show through
 *   and the gaps between them never flatten it.
 * - **The user speaking halos.** The orb holds its size and a soft accent-purple glow behind
 *   it brightens and spreads. That glow is also how the pink and cyan artwork is tied to the
 *   app: the accent is around it, never painted on it.
 *
 * Only `transform` and `opacity` are written, both of which the compositor can do without
 * laying the page out again. The loop runs only while the conversation is connected and the
 * tab is visible, and not at all under `prefers-reduced-motion`.
 *
 * `data-sphere-state` on the wrapper is how a Playwright test asserts the behaviour. The
 * attribute name is inherited from the canvas sphere this replaced, because the e2e spec
 * reads it and its five values did not change. `data-orb-status` carries the raw status
 * next to it, so `connecting` and `error` can be told apart too.
 */
export function AssistantOrb({
  status,
  isUserSpeaking,
  isAvatarSpeaking,
  isMicMuted,
  mediaRef,
  className,
}: AssistantOrbProps) {
  const { t } = useTranslation();
  const artRef = useRef<HTMLDivElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  const signals: OrbSignals = {
    status,
    isUserSpeaking,
    isAvatarSpeaking,
    isMicMuted,
  };
  const state = orbState(signals);

  /*
    Every changing signal reaches the loop through this ref, never through the effect's
    dependency list. `isUserSpeaking` flips on and off many times in one sentence; if it were
    a dependency the loop would tear down and restart on each flip.
  */
  const signalsRef = useRef(signals);
  signalsRef.current = signals;

  const readLevel = useAvatarAudioLevel(mediaRef, status === 'connected');

  /*
    The loop only earns its cost while the conversation is live. Idle, connecting, ended and
    every reduced-motion case are one still arrangement instead, written once by the effect
    below. The artwork's own SMIL keeps the orb alive there on its own, which is why nothing
    has to run an animation frame to make "connecting" look busy.
  */
  const isLive = status === 'connected';
  const isAnimating = isLive && !reducedMotion;

  const isConnecting = status === 'requesting' || status === 'connecting';
  // How strong the halo sits when no loop is running. Connecting gets some, so the accent is
  // on screen while the user waits; everything else gets none.
  const restingHalo = isConnecting ? 0.32 : 0;

  useEffect(() => {
    if (!isAnimating) return;

    // Held here so the cleanup below resets the same two elements the loop wrote to, even
    // if React has already swapped the refs by then.
    const artNode = artRef.current;
    const haloNode = haloRef.current;

    let frame = 0;
    let previous = 0;
    let level = 0;
    let lastScale = '';
    let lastHalo = '';

    const step = (time: number) => {
      const elapsed =
        previous === 0 ? 0 : Math.min(MAX_FRAME_MS, time - previous);
      previous = time;

      const current = signalsRef.current;
      const target = levelTarget(current, readLevel(), time);
      level = smoothLevel(level, target, elapsed / 1000);
      const view = orbFrame(orbState(current), level);

      if (artNode) {
        // `translateZ(0)` keeps the artwork on its own compositor layer, so the scale never
        // reaches the page's layout.
        const transform = `translateZ(0) scale(${round(view.scale)})`;
        // Writing the same string again would still cost a style recalculation.
        if (transform !== lastScale) {
          artNode.style.transform = transform;
          lastScale = transform;
        }
      }

      if (haloNode) {
        const next = `${round(view.haloOpacity)}|${round(view.haloScale)}`;
        if (next !== lastHalo) {
          haloNode.style.opacity = round(view.haloOpacity);
          haloNode.style.transform = `translateZ(0) scale(${round(view.haloScale)})`;
          lastHalo = next;
        }
      }

      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);

    // A hidden tab still gets frames in some browsers, and pays for them in battery.
    const handleVisibility = () => {
      if (document.hidden) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        // Reset, or the first frame back would be one long jump.
        previous = 0;
      } else if (frame === 0) {
        frame = requestAnimationFrame(step);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      // Strict Mode runs effects twice in development, so cleanup has to be complete.
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isAnimating, readLevel]);

  /*
    The still arrangement. It covers every state with no loop, and it also cleans up after
    the loop: the last frame's inline transform would otherwise freeze the orb mid-breath
    when the call ends. Written here and not in the loop's cleanup, because cleanup runs
    after React has already committed the new render and would be overwritten.
  */
  useEffect(() => {
    if (isAnimating) return;
    const art = artRef.current;
    if (art) art.style.transform = 'translateZ(0) scale(1)';
    const halo = haloRef.current;
    if (halo) {
      halo.style.opacity = String(restingHalo);
      halo.style.transform = 'translateZ(0) scale(1)';
    }
  }, [isAnimating, restingHalo, state]);

  const message = t(messageKey(signals));
  const [announced, setAnnounced] = useState(message);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setAnnounced(message),
      ANNOUNCE_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [message]);

  /*
    `h-full` below, so the column is the height of the box the page gives it rather than the
    height of its own contents. That is what lets the sphere shrink instead of overflowing and
    being clipped by the page's `overflow-hidden`. The page's wrapper is a flex item with a
    resolved height, so the percentage has something to resolve against.
  */
  return (
    <div
      className={cn(
        'flex h-full flex-col items-center justify-center gap-4',
        className,
      )}
    >
      <div
        data-sphere-state={state}
        data-orb-status={status}
        className="relative w-full"
        style={ORB_BOX}
      >
        {/*
          The halo. This is the app's purple sitting behind the user's pink and cyan artwork,
          which is how the two palettes are reconciled without repainting anything the user
          drew. It is also the user's speaking cue: the loop writes its opacity and scale.

          A radial gradient with a soft falloff, and deliberately no soft-edge shadow. A soft-edged
          shadow on an element that is scaled every frame has to be redrawn every frame; a
          gradient that already fades to nothing at its edge costs nothing and looks the same.
        */}
        <div
          ref={haloRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full"
          style={HALO_BOX}
        />

        {/*
          The wrapper the speaking cue scales. The artwork itself is never touched.

          An `<img>` and not an inline `<svg>`: the file is 436 KB of markup, and inlining it
          would put all of it in the JS bundle and hand it to the JS parser. As an `<img>` it
          is one cacheable file the browser's own SVG parser reads, and its SMIL keeps running
          normally. Nothing in it needs to be reached from JS, because the cue is out here.
        */}
        <div
          ref={artRef}
          aria-hidden="true"
          className="h-full w-full"
          style={ART_BOX}
        >
          <img
            src={reducedMotion ? ART_STILL_SRC : ART_SRC}
            alt=""
            aria-hidden="true"
            draggable={false}
            /*
              `object-contain`, so the artwork letterboxes instead of stretching. The box is
              square whenever there is room for a square, but once the column is squeezed it is
              wider than it is tall, and without this the round artwork was pulled into an oval
              (measured 288x80 at 812x375).
            */
            className="h-full w-full object-contain"
            style={{ ...HUE_SHIFT, opacity: ART_OPACITY[state] }}
          />
        </div>
      </div>

      {/* Sighted users get the change at once. `shrink-0`, because this line is the reason the
          sphere above is allowed to shrink: it is news, and news is never squeezed away. */}
      <p
        aria-hidden="true"
        className="shrink-0 text-center text-sm font-medium text-foreground"
      >
        {message}
      </p>

      {/* A screen reader gets it once the turn has settled. */}
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announced}
      </p>
    </div>
  );
}
