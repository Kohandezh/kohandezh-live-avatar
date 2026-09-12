import type { AssistantStatus } from '../types';

/**
 * Pure drawing logic for the audio conversation sphere (requirement 17).
 *
 * Nothing here touches React or looks anything up in the DOM. The component passes the
 * signals in and the painter gets a `CanvasRenderingContext2D`, so every rule below can be
 * checked in a unit test.
 */

/**
 * The five states the sphere can be in. The wrapper publishes the value as
 * `data-sphere-state`, which is how a Playwright test asserts the behaviour: the sphere is
 * a canvas, and a canvas cannot be asserted by pixels.
 */
export type SphereState = 'idle' | 'user' | 'agent' | 'muted' | 'ended';

/** Everything the sphere needs to know about the conversation. */
export interface SphereSignals {
  status: AssistantStatus;
  isUserSpeaking: boolean;
  isAvatarSpeaking: boolean;
  isMicMuted: boolean;
}

/** One frame's worth of instructions for the painter. */
export interface SphereView {
  state: SphereState;
  /** How loud the current speaker is, 0 to 1. */
  level: number;
  /** Multiplies the base radius. */
  radiusScale: number;
  /** 0 uses the user hue, 1 uses the agent hue, in between mixes them. */
  hueMix: number;
  /** Multiplies the colour intensity. Low values drain the sphere of colour. */
  saturation: number;
  /** Multiplies every alpha. Low values fade the whole sphere. */
  alpha: number;
  /** Filament rotation speed in radians per second. */
  spin: number;
  /** How far the filaments wobble away from a clean circle, 0 to 1. */
  ripple: number;
  /** Outer glow strength, 0 to 1. */
  bloom: number;
  /** True while expanding rings should be emitted. */
  rings: boolean;
}

export interface SphereHues {
  /** Hue in degrees for the user's turn. */
  user: number;
  /** Hue in degrees for the avatar's turn. */
  agent: number;
}

/**
 * Which theme the sphere is painted for.
 *
 * The app writes `class="dark"` and `data-theme="dark"` on `<html>`, and the `dark` CSS variant
 * keys on exactly that (see `src/styles/globals.css`). The sphere reads the same thing, never
 * `prefers-color-scheme`, or it would disagree with the screen around it: a user whose system is
 * dark but who picked light in the app would get a dark-tuned sphere on a light page.
 */
export type SphereTheme = 'light' | 'dark';

/** One colour stop, before the view's `saturation` and `alpha` multipliers are applied. */
export interface SphereStop {
  /** OKLCH lightness, 0 to 1. */
  lightness: number;
  /** OKLCH chroma. */
  chroma: number;
  /** Alpha, 0 to 1. */
  alpha: number;
  /**
   * Degrees away from the sphere's own hue. Optional, and 0 when left out.
   *
   * This is a render property, not a brand colour, which is why it lives here and not in CSS: the
   * sphere's hue still comes from `--sphere-hue-user` / `--sphere-hue-agent` and this only says
   * how one stop leans away from it. The filaments already work the same way (`Filament.hueShift`).
   *
   * It is what stops the light-mode ball reading as paint. On a light page the sRGB gamut runs out
   * of chroma above lightness 0.88, so a bright centre can only be a chalky near-white, and a
   * chalky near-white on a coloured ball is a plastic sheen. Real light is not one hue: the hot
   * part runs toward magenta and the shaded part toward blue. Leaning the stops apart buys the
   * centre its heat back without asking the gamut for chroma it does not have.
   */
  hueShift?: number;
}

/** A colour stop that knows where it sits in its gradient. */
export interface SphereGradientStop extends SphereStop {
  /**
   * Where the stop sits.
   *
   * For every gradient except the bloom this is a plain gradient offset, 0 to 1. The bloom is
   * the exception: see `SpherePalette.bloomAnchor`.
   */
  at: number;
}

/** One stroked pass over a filament path. */
export interface SphereStrand {
  lightness: number;
  chroma: number;
  /** Alpha at silence. */
  alphaBase: number;
  /** Added to the alpha at full loudness. */
  alphaLevel: number;
  /** Line width as a fraction of the sphere radius. */
  width: number;
}

/**
 * How the sphere is painted on one theme's ground.
 *
 * `sphereView` says what the sphere is *doing* (who holds the turn, how loud, how fast it
 * spins). The palette says how that is painted so it survives the ground behind it. Keeping the
 * two apart is why a theme switch needs no change to the behaviour code, and why the unit tests
 * of `sphereView` do not care about the theme at all.
 *
 * Four layers are optional (`shadow`, `occlusion`, `relight`, `specular`). A theme that does not
 * need one sets it to `null` and the matching draw method returns at once.
 */
export interface SpherePalette {
  /**
   * How the wide filament band is composited.
   *
   * `lighter` adds light, which is what a glowing object does on a near-black ground. On a light
   * page every pixel is already near white, so adding light only clips to white and the strands
   * vanish. There the band is `multiply`, which darkens, and a second thin `source-over` thread
   * is drawn down the middle of it (`filamentCore`) so the strand still reads as lit.
   */
  filamentComposite: GlobalCompositeOperation;
  /** How the expanding rings are composited. Same reasoning as `filamentComposite`. */
  ringComposite: GlobalCompositeOperation;
  /**
   * What the bloom stops' `at` values mean.
   *
   * `offset` is a plain gradient offset, 0 to 1. `radius` is a multiple of the sphere radius,
   * converted to an offset every frame.
   *
   * The two exist because the two themes need different things. Dark mode is the reference look
   * and must stay byte identical, so it keeps fixed offsets. Light mode needs its strongest stop
   * to land on the silhouette, and the silhouette moves in offset space whenever `view.bloom` or
   * `view.radiusScale` changes. A fixed offset would slide the peak under the ball exactly when
   * the user speaks loudest, which is the state the halo matters most in.
   */
  bloomAnchor: 'offset' | 'radius';
  /** The bloom gradient's inner circle, as a multiple of the sphere radius. */
  bloomInner: number;
  /** Outer bloom reach: `radius * (base + gain * view.bloom)`. */
  bloomRadius: { base: number; gain: number };
  /** Bloom strength floor, so a quiet sphere still has a halo: `floor + (1 - floor) * bloom`. */
  bloomFloor: number;
  /** The halo. `source-over` in both themes, because only a plain paint can tint the page. */
  bloom: readonly SphereGradientStop[];
  /** The ball itself. Painted opaque, before anything that blends. */
  core: readonly SphereGradientStop[];
  /**
   * Floor under `view.alpha` for the solid layers: `floor + (1 - floor) * view.alpha`.
   *
   * The ended state drops `view.alpha` to 0.35. On a dark page that is still a visible glow. On a
   * light page it leaves the ball a hair darker than the paper, which is close to invisible, so
   * light mode keeps a floor under the layers that carry the silhouette. The halo, the shadow,
   * the filaments and the rings still fade on the raw value, so the sphere does read as finished.
   */
  coreAlphaFloor: number;
  /** The ten orbiting strands. Their alpha rises with the measured loudness. */
  filament: SphereStrand;
  /** The thin bright thread down the middle of each strand, or `null` for one stroke only. */
  filamentCore: SphereStrand | null;
  /**
   * Clip the strands to the ball's disc.
   *
   * The ripple pushes a strand out to 1.12R. Outside the ball the canvas is near transparent, and
   * a `multiply` stroke over transparency degenerates to a plain paint, so an unclipped light-mode
   * strand paints dark hairs lying on the pale halo. One clip per frame covers all ten.
   */
  clipFilaments: boolean;
  /** Contact shadow under the ball, or `null`. Gives it somewhere to sit. */
  shadow: readonly SphereGradientStop[] | null;
  /** Ambient occlusion just outside the silhouette, or `null`. Multiply. */
  occlusion: readonly SphereGradientStop[] | null;
  /** The inner lamp, painted after the strands, or `null`. */
  relight: readonly SphereGradientStop[] | null;
  /** The small specular highlight, or `null`. */
  specular: readonly SphereGradientStop[] | null;
  /** The expanding rings of the avatar's turn. Alpha fades to 0 over the ring's life. */
  ring: SphereStop;
  /**
   * How the ring's alpha falls over its life: `(1 - progress) ** fadePower`.
   *
   * 1 on dark. 2 on light, because a linear fade on a light page leaves a thin hard circle far
   * from the ball, and a thin hard circle reads as a drawn outline rather than as light.
   */
  ringFadePower: number;
}

const TAU = Math.PI * 2;

/**
 * Fallback hues, used only if the CSS custom properties cannot be read. Kept in step with
 * `--sphere-hue-user` / `--sphere-hue-agent` in `src/styles/globals.css`, which bracket the app
 * accent so the sphere and the buttons read as one product.
 */
export const DEFAULT_SPHERE_HUES: SphereHues = { user: 288, agent: 328 };

/**
 * The highest chroma any palette below uses. Only the `hsl` fallback needs it: that path has no
 * chroma axis, so the value is mapped onto HSL saturation and this is what counts as 100%.
 */
const MAX_CHROMA = 0.22;

/**
 * The two looks, side by side.
 *
 * DARK is the reference image and is not up for discussion: a near-black page, a white-hot core
 * inside a saturated violet body, strands and rings that add light on top of it, and a wide bloom
 * bleeding outward. Every number in the dark palette below is the number that shipped.
 *
 * LIGHT is not the same recipe with different numbers. It is a different physical model, and it
 * has to be, because additive light does not exist on paper. Add light to a pixel that is already
 * at 0.97 lightness and it clips to white: the strands disappear, the halo disappears, and what
 * survives is the flat base fill. That flat base fill was the plain purple ball.
 *
 * So on a light ground the sphere is lit the way a real object on a white table is lit:
 *
 * 1. The body is DARKER than the page. That is what gives it presence. A glowing object on paper
 *    is read from its silhouette first, not from its brightness.
 * 2. Luminosity comes from a bright inner core and high chroma, not from adding light. The core
 *    gradient runs light in the middle, saturated through the body, darkest at the rim.
 * 3. The halo is a coloured tint of the hue, never a white bloom. White on white is nothing.
 * 4. The strands DARKEN (`multiply`) a wide band and then lay a thin bright thread down the
 *    middle of it. A dark band with a bright centre is what a lit strand looks like from outside.
 * 5. A contact shadow and an occlusion seam put the ball in a space instead of on top of one.
 *
 * A canvas blend mode can never reach the page behind the canvas; `multiply` only blends against
 * pixels this canvas has already painted. That is why the halo and the contact shadow are plain
 * `source-over` paints (a tint is the only tool available against the page), and why the opaque
 * core has to be down before anything that blends.
 *
 * Every light-mode chroma below is at the sRGB gamut limit for the hue range the sphere travels,
 * not at a value picked by eye. See `tests/unit/features/assistant/sphere.palette.test.ts`. A
 * chroma above the limit does not throw: it quietly desaturates and drags the hue, which would
 * stop the user hue (288) and the agent hue (328) reading as an even pair.
 */
export const SPHERE_PALETTES: Record<SphereTheme, SpherePalette> = {
  dark: {
    filamentComposite: 'lighter',
    ringComposite: 'lighter',
    bloomAnchor: 'offset',
    bloomInner: 0.2,
    bloomRadius: { base: 1.35, gain: 1.25 },
    bloomFloor: 0,
    bloom: [
      { at: 0, lightness: 0.78, chroma: 0.2, alpha: 0.62 },
      { at: 0.45, lightness: 0.66, chroma: 0.19, alpha: 0.3 },
      { at: 1, lightness: 0.52, chroma: 0.12, alpha: 0 },
    ],
    core: [
      { at: 0, lightness: 0.97, chroma: 0.05, alpha: 0.72 },
      { at: 0.6, lightness: 0.7, chroma: 0.22, alpha: 0.58 },
      { at: 1, lightness: 0.56, chroma: 0.21, alpha: 0.14 },
    ],
    coreAlphaFloor: 0,
    filament: {
      lightness: 0.82,
      chroma: 0.17,
      alphaBase: 0.1,
      alphaLevel: 0.12,
      width: 0.012,
    },
    filamentCore: null,
    clipFilaments: false,
    shadow: null,
    occlusion: null,
    relight: null,
    specular: null,
    ring: { lightness: 0.85, chroma: 0.16, alpha: 0.35 },
    ringFadePower: 1,
  },

  light: {
    filamentComposite: 'multiply',
    ringComposite: 'multiply',
    bloomAnchor: 'radius',
    bloomInner: 0.55,
    bloomRadius: { base: 1.2, gain: 1.1 },
    // A halo that switches off in the quiet states is a ball with no light in it. Almost half the
    // light-mode halo is always on; the rest follows the voice.
    bloomFloor: 0.45,
    /*
      Radius multiples, not offsets. The peak sits at 1.03, a hair outside the silhouette, because
      light spills at the edge of an object and not out of its middle, and a peak parked exactly on
      1.00 is hidden behind the ball's own last pixel. The 9.99 stop is past every reachable radius,
      so it always clamps onto offset 1 and closes the disc at alpha 0.
    */
    bloom: [
      { at: 0.55, lightness: 0.7, chroma: 0.17, alpha: 0.3, hueShift: 6 },
      { at: 1.03, lightness: 0.66, chroma: 0.205, alpha: 0.9, hueShift: 10 },
      { at: 1.18, lightness: 0.74, chroma: 0.145, alpha: 0.42, hueShift: 4 },
      { at: 9.99, lightness: 0.86, chroma: 0.07, alpha: 0, hueShift: -8 },
    ],
    /*
      The six-stop profile, and this is the whole read:

        0.00  a lamp seen through frosted glass
        0.26  the light falling off
        0.56  the saturated body, at the lightness where the gamut holds the most chroma
        0.82  a dip: more glass on the sight line near the edge
        0.93  a lift: the caustic ring, light gathered by the curve of the edge
        1.00  the rim, the darkest thing on the ball, in the last seven percent

      Dip, lift, drop. Take that pattern out and the ball is flat again. If a stop has to move for
      gamut reasons, move its chroma and never its lightness. The pattern is pinned by
      `tests/unit/features/assistant/sphere.palette.test.ts`.

      The `hueShift` on each stop leans the hot part toward magenta and the shaded part toward
      blue. See `SphereStop.hueShift`: above lightness 0.88 the sRGB gamut has almost no chroma
      left, so heat has to come from hue rather than from saturation.
    */
    core: [
      { at: 0.0, lightness: 0.84, chroma: 0.098, alpha: 0.98, hueShift: 18 },
      { at: 0.26, lightness: 0.75, chroma: 0.148, alpha: 1, hueShift: 12 },
      { at: 0.56, lightness: 0.56, chroma: 0.248, alpha: 1, hueShift: 2 },
      { at: 0.82, lightness: 0.47, chroma: 0.21, alpha: 1, hueShift: -8 },
      { at: 0.93, lightness: 0.63, chroma: 0.215, alpha: 1, hueShift: 6 },
      { at: 1.0, lightness: 0.41, chroma: 0.19, alpha: 1, hueShift: -12 },
    ],
    coreAlphaFloor: 0.35,
    // The wide dark band. Its lightness (0.46) is below the body's (0.56), so it darkens even if
    // the engine refuses `multiply` and the stroke falls back to a plain paint.
    filament: {
      lightness: 0.46,
      chroma: 0.195,
      alphaBase: 0.14,
      alphaLevel: 0.16,
      width: 0.042,
    },
    // The thin thread down the middle. Above the body's lightness (0.56), below the page's (0.97),
    // so it reads as light on the shaded parts of the ball and washes out inside the lamp.
    filamentCore: {
      lightness: 0.82,
      chroma: 0.089,
      alphaBase: 0.17,
      alphaLevel: 0.22,
      width: 0.017,
    },
    clipFilaments: true,
    shadow: [
      { at: 0, lightness: 0.48, chroma: 0.1, alpha: 0.26 },
      { at: 0.6, lightness: 0.62, chroma: 0.11, alpha: 0.09 },
      { at: 1, lightness: 0.72, chroma: 0.08, alpha: 0 },
    ],
    occlusion: [
      { at: 0, lightness: 0.66, chroma: 0.13, alpha: 0.05 },
      { at: 0.22, lightness: 0.62, chroma: 0.15, alpha: 0.08 },
      { at: 1, lightness: 0.78, chroma: 0.09, alpha: 0 },
    ],
    relight: [
      { at: 0, lightness: 0.89, chroma: 0.062, alpha: 0.86, hueShift: 28 },
      { at: 0.3, lightness: 0.84, chroma: 0.1, alpha: 0.5, hueShift: 22 },
      { at: 0.65, lightness: 0.76, chroma: 0.14, alpha: 0.24, hueShift: 12 },
      { at: 1, lightness: 0.7, chroma: 0.165, alpha: 0 },
    ],
    specular: [
      { at: 0, lightness: 0.96, chroma: 0.018, alpha: 0.34, hueShift: 24 },
      { at: 1, lightness: 0.96, chroma: 0.018, alpha: 0, hueShift: 24 },
    ],
    ring: { lightness: 0.52, chroma: 0.22, alpha: 0.5 },
    ringFadePower: 2,
  },
};

/** Ten filaments read as a globe and still cost one cheap path each per frame. */
const FILAMENT_COUNT = 10;

/** Points sampled along one filament. 96 stays smooth at phone size. */
const FILAMENT_SAMPLES = 96;

/** Spreads tilts and starting phases evenly with no random number generator. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** A new ring leaves the core this often while the avatar speaks. */
const RING_INTERVAL_S = 0.52;

/** And it takes this long to fade out. */
const RING_LIFE_S = 1.6;

/**
 * Time constants for the eased values, in seconds. The hue reaches about 95% of the new
 * colour in 125 ms, which is the crossfade the design asks for.
 */
const HUE_TAU_S = 0.042;

/**
 * The level rises faster than it falls, the way a volume meter does. A syllable has to
 * reach the sphere at once, but the gap between two syllables must not make it collapse.
 */
const LEVEL_ATTACK_S = 0.04;
const LEVEL_RELEASE_S = 0.18;

/**
 * The hue the sphere rests at when nobody holds the turn: idle, connecting, muted, ended.
 *
 * Exactly half way between the two speaking hues, which is the app accent. `--sphere-hue-user`
 * (288) and `--sphere-hue-agent` (328) bracket `--accent` (hue 308) on purpose, so a mix of 0.5
 * lands on the accent itself. Measured, the resting sphere is then `oklch(62% 0.21 308)` =
 * #a958e5, next door to the product reference (#b44ae6 measures hue 312.8).
 *
 * Resting at 0 instead, the user's own hue, was the visible half of defect D1: the sphere spent
 * all of its idle life at 288 = #8567fa, which still reads as blue even after the hue tokens
 * moved off HeroUI's default. Nobody holds the turn on an idle screen, so neither speaker's
 * colour is the honest one to show.
 */
const RESTING_HUE_MIX = 0.5;

/** Where the ball's light comes from, as a fraction of the radius. Up and toward the start side. */
const FOCUS_X = -0.25;
const FOCUS_Y = -0.3;

/**
 * Where the inner lamp sits, as a fraction of the radius.
 *
 * Closer to the middle than the core's focus, and that is the whole difference between a lit ball
 * and a glowing one. A bright patch parked near the edge of a disc is what a reflection looks
 * like; a bright patch near the middle is what a source inside the object looks like. The core
 * keeps the off-centre focus, because that is what gives the ball its volume, and only the lamp
 * moves in.
 */
const LAMP_X = -0.13;
const LAMP_Y = -0.16;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Moves `value` toward `target` at a rate that does not depend on the frame rate.
 * A slow phone and a fast phone reach the same place after the same amount of time.
 */
function approach(
  value: number,
  target: number,
  dt: number,
  tau: number,
): number {
  if (dt <= 0) return target;
  return value + (target - value) * (1 - Math.exp(-dt / tau));
}

/**
 * A stand-in for the user's loudness, 0 to 1.
 *
 * The user's real microphone level is not available: `VoiceChat.track` and
 * `LiveAvatarSession.room` are both private in `@heygen/liveavatar-web-sdk@0.0.18`, and a
 * second `getUserMedia` on the same device fights echo cancellation. The SDK does report
 * `isUserSpeaking` from a real voice detector, so the flag is true speech and only the
 * shape of the swell is synthetic.
 *
 * Three sines at rates that do not divide into each other: a syllable rate, a slower
 * stress pattern, and a small jitter. The result never visibly repeats.
 */
export function speechEnvelope(timeMs: number): number {
  const t = timeMs / 1000;
  const syllable = 0.5 + 0.5 * Math.sin(t * 11.3);
  const stress = 0.5 + 0.5 * Math.sin(t * 3.7 + 1.1);
  const jitter = 0.5 + 0.5 * Math.sin(t * 27.1 + 2.3);
  return clamp01(0.3 + 0.5 * syllable * (0.55 + 0.45 * stress) + 0.08 * jitter);
}

/**
 * Which of the five states the signals describe.
 *
 * The avatar's turn wins over a muted microphone: the user needs to see who is talking
 * more than they need to be reminded that their own microphone is off.
 */
export function sphereState(signals: SphereSignals): SphereState {
  const { status, isAvatarSpeaking, isMicMuted, isUserSpeaking } = signals;
  if (status === 'ending' || status === 'ended' || status === 'error') {
    return 'ended';
  }
  if (status !== 'connected') return 'idle';
  if (isAvatarSpeaking) return 'agent';
  if (isMicMuted) return 'muted';
  if (isUserSpeaking) return 'user';
  return 'idle';
}

/**
 * Turns the conversation signals into one frame's instructions.
 *
 * `avatarLevel` is the measured loudness of the avatar's audio, or null when no analyser
 * could be built (a blocked AudioContext on iOS, for example). Null falls back to the same
 * synthetic envelope the user's turn uses. A level of 0 is normal, never an error.
 *
 * The two turns are deliberately different in kind, not in degree:
 * the user's turn swells with the voice, the avatar's turn stays steady, spins fast and
 * pushes out rings. A user can tell them apart without reading anything.
 */
export function sphereView(
  signals: SphereSignals,
  avatarLevel: number | null,
  timeMs: number,
): SphereView {
  const state = sphereState(signals);
  const breath = 0.5 + 0.5 * Math.sin((timeMs / 1000) * 0.9);

  switch (state) {
    case 'user': {
      const level = speechEnvelope(timeMs);
      return {
        state,
        level,
        radiusScale: 1 + 0.18 * level,
        hueMix: 0,
        saturation: 1,
        alpha: 1,
        spin: 0.25,
        ripple: 0.4 + 0.6 * level,
        bloom: 0.25 + 0.6 * level,
        rings: false,
      };
    }

    case 'agent': {
      const level = clamp01(avatarLevel ?? speechEnvelope(timeMs));
      return {
        state,
        level,
        // Almost steady. The avatar's presence is carried by the spin and the rings, so
        // the globe does not have to pump with every syllable.
        radiusScale: 1 + 0.04 * level,
        hueMix: 1,
        saturation: 1,
        alpha: 1,
        spin: 1.15,
        ripple: 0.45,
        // Floored, so the sphere stays bright in the gaps between words.
        bloom: Math.max(0.5, 0.4 + 0.5 * level),
        rings: true,
      };
    }

    case 'muted':
      return {
        state,
        level: 0.12,
        radiusScale: 1 + 0.02 * breath,
        hueMix: RESTING_HUE_MIX,
        saturation: 0.25,
        alpha: 0.85,
        spin: 0.12,
        ripple: 0.25,
        bloom: 0.2,
        rings: false,
      };

    case 'ended':
      return {
        state,
        level: 0,
        radiusScale: 1,
        hueMix: RESTING_HUE_MIX,
        // Not red. The error message carries that meaning; colour alone never does.
        saturation: 0.15,
        alpha: 0.35,
        spin: 0.06,
        ripple: 0.2,
        bloom: 0.15,
        rings: false,
      };

    default: {
      // Idle covers everything before the conversation is live, including the wait while
      // the session connects. The bloom breathes there so the globe reads as "working".
      const connecting =
        signals.status === 'requesting' || signals.status === 'connecting';
      const pulse = 0.5 + 0.5 * Math.sin((timeMs / 1000) * 2.4);
      return {
        state,
        level: 0,
        radiusScale: 1 + 0.02 * breath,
        hueMix: RESTING_HUE_MIX,
        saturation: 0.8,
        alpha: 0.9,
        spin: 0.18,
        ripple: 0.35,
        bloom: connecting ? 0.35 + 0.25 * pulse : 0.3 + 0.05 * breath,
        rings: false,
      };
    }
  }
}

interface Filament {
  /** Rotation of this filament's orbital plane. */
  tilt: number;
  /** How edge-on the plane looks. */
  squash: number;
  /** Base turn rate, multiplied by the view's `spin`. */
  speed: number;
  /** Two radial wobbles. Both are whole numbers so the curve closes on itself. */
  wobbleA: number;
  wobbleB: number;
  /** Degrees away from the base hue, so the ten strands are not one flat colour. */
  hueShift: number;
  /** Integrated every frame. Never derived from the clock: see `paint`. */
  phase: number;
}

function seedFilaments(): Filament[] {
  return Array.from({ length: FILAMENT_COUNT }, (_, index) => ({
    tilt: index * GOLDEN_ANGLE,
    // Never 0 (a flat line) and never 1 (a plain circle): both read as a ring, not a globe.
    squash: 0.18 + 0.72 * Math.abs(Math.cos(index * GOLDEN_ANGLE)),
    speed: 0.6 + (index / FILAMENT_COUNT) * 0.9,
    wobbleA: 2 + (index % 3),
    wobbleB: 5 + (index % 4),
    hueShift: (index - (FILAMENT_COUNT - 1) / 2) * 3.2,
    phase: index * GOLDEN_ANGLE * 2,
  }));
}

/**
 * Does this canvas understand CSS Color 4? Older WebViews parse `oklch()` as invalid and
 * silently keep the previous colour, which would paint the whole sphere black.
 */
function canvasSupportsOklch(ctx: CanvasRenderingContext2D): boolean {
  const previous = ctx.fillStyle;
  try {
    ctx.fillStyle = '#000000';
    ctx.fillStyle = 'oklch(70% 0.2 300)';
    return ctx.fillStyle !== '#000000';
  } catch {
    return false;
  } finally {
    ctx.fillStyle = previous;
  }
}

/**
 * Does this canvas understand this blend mode?
 *
 * Setting `globalCompositeOperation` to a value the engine does not know is silently ignored, so
 * an unsupported `multiply` would leave the strokes on whatever mode happened to be set last.
 * Probe once per theme change and fall back to `source-over`, which still darkens in light mode
 * because the band's lightness sits below the body's. The strands lose depth; they do not vanish.
 */
function canvasSupportsComposite(
  ctx: CanvasRenderingContext2D,
  mode: GlobalCompositeOperation,
): boolean {
  const previous = ctx.globalCompositeOperation;
  try {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalCompositeOperation = mode;
    return ctx.globalCompositeOperation === mode;
  } catch {
    return false;
  } finally {
    ctx.globalCompositeOperation = previous;
  }
}

/**
 * Paints the sphere on a 2D canvas.
 *
 * Not SVG: rebuilding ten path `d` attributes plus a blur filter every frame is the
 * classic 15 to 25 fps case on a mid-range Android. Not WebGL: a shader plus a
 * context-lost handler is a lot of machinery for one decorative element, and a full-screen
 * noise shader is often slower because it is limited by how fast the device can fill
 * pixels.
 *
 * The outer glow is a radial gradient, never `ctx.filter = 'blur(...)'`. A radial gradient
 * is what a blurred point light looks like, so one filled disc replaces a whole filter pass.
 */
export class SpherePainter {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly filaments: Filament[] = seedFilaments();
  private readonly supportsOklch: boolean;
  private rings: { age: number }[] = [];

  private width = 0;
  private height = 0;
  private hues: SphereHues = DEFAULT_SPHERE_HUES;
  private palette: SpherePalette = SPHERE_PALETTES.dark;
  /** `palette.filamentComposite`, or `source-over` if this engine does not know it. */
  private filamentComposite: GlobalCompositeOperation = 'lighter';
  private ringComposite: GlobalCompositeOperation = 'lighter';
  private hueMix = 0;
  private level = 0;
  private ringTimer = 0;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
    this.supportsOklch = canvasSupportsOklch(ctx);
    this.setTheme('dark');
  }

  /**
   * Tells the painter the new CSS size. The caller sets `canvas.width` and
   * `canvas.height` first; resizing a canvas resets its context, which is why the scale
   * transform is applied here and not once at construction.
   */
  setSize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.width = cssWidth;
    this.height = cssHeight;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** The hues come from CSS, so the theme owns them and dark mode can change them. */
  setHues(hues: SphereHues): void {
    this.hues = hues;
  }

  /**
   * Which ground the sphere is being painted on.
   *
   * The caller must set this before the first paint and again whenever the app theme changes.
   * The default is the dark palette, so a caller that never sets it gets the reference look.
   */
  setTheme(theme: SphereTheme): void {
    const palette = SPHERE_PALETTES[theme];
    this.palette = palette;
    this.filamentComposite = canvasSupportsComposite(
      this.ctx,
      palette.filamentComposite,
    )
      ? palette.filamentComposite
      : 'source-over';
    this.ringComposite = canvasSupportsComposite(
      this.ctx,
      palette.ringComposite,
    )
      ? palette.ringComposite
      : 'source-over';
  }

  /**
   * The smoothed loudness the painter is drawing with. Exposed so a unit test can check
   * the attack and the release without reading pixels back off a canvas.
   */
  get easedLevel(): number {
    return this.level;
  }

  /**
   * Advances the animation by `dtMs` and paints one frame.
   *
   * Pass `dtMs = 0` for a still frame: the eased values snap to their targets instead of
   * crawling toward them, which is what a reduced-motion user needs to see.
   */
  paint(view: SphereView, dtMs: number): void {
    const dt = Math.max(0, dtMs) / 1000;
    this.hueMix = approach(this.hueMix, view.hueMix, dt, HUE_TAU_S);
    this.level = approach(
      this.level,
      view.level,
      dt,
      view.level > this.level ? LEVEL_ATTACK_S : LEVEL_RELEASE_S,
    );

    // Integrated, not derived from the clock. Deriving a phase from elapsed time makes
    // every filament jump the instant `spin` changes.
    for (const filament of this.filaments) {
      filament.phase += filament.speed * view.spin * dt;
    }

    this.advanceRings(view.rings, dt);
    this.draw(view);
  }

  private advanceRings(emit: boolean, dt: number): void {
    for (const ring of this.rings) ring.age += dt;
    // At most four rings are alive at once, so rebuilding the list costs nothing.
    this.rings = this.rings.filter((ring) => ring.age < RING_LIFE_S);

    if (!emit) {
      this.ringTimer = 0;
      return;
    }
    this.ringTimer += dt;
    while (this.ringTimer >= RING_INTERVAL_S) {
      this.ringTimer -= RING_INTERVAL_S;
      this.rings.push({ age: 0 });
    }
  }

  /**
   * The draw order, and it is fixed rather than data driven.
   *
   * The opaque core has to be painted before anything that blends against it. `multiply` blends
   * with the pixels this canvas has already painted, so a multiply stroke over a transparent
   * canvas silently degenerates into a plain paint: no error, no crash, and the flat ball is
   * back. A layer a theme does not use sets its palette entry to `null` and returns at once.
   */
  private draw(view: SphereView): void {
    const { ctx, width, height } = this;
    if (width <= 0 || height <= 0) return;

    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.3 * view.radiusScale;
    const hue =
      this.hues.user + (this.hues.agent - this.hues.user) * this.hueMix;

    ctx.clearRect(0, 0, width, height);
    this.drawShadow(cx, cy, radius, hue, view);
    this.drawBloom(cx, cy, radius, hue, view);
    this.drawOcclusion(cx, cy, radius, hue, view);
    this.drawCore(cx, cy, radius, hue, view);
    this.drawFilaments(cx, cy, radius, hue, view);
    this.drawRelight(cx, cy, radius, hue, view);
    this.drawSpecular(cx, cy, radius, hue, view);
    this.drawRings(cx, cy, radius, hue, view);
  }

  /**
   * One palette stop as a colour string, with the view's own multipliers applied.
   *
   * `saturation` drains the colour (the muted and ended states), `alpha` fades the whole sphere,
   * and `alphaScale` is the per-part strength, such as the bloom.
   */
  private stopColor(
    hue: number,
    stop: SphereStop,
    view: SphereView,
    alphaScale = 1,
  ): string {
    return this.color(
      hue + (stop.hueShift ?? 0),
      stop.lightness,
      stop.chroma * view.saturation,
      stop.alpha * view.alpha * alphaScale,
    );
  }

  /**
   * `view.alpha` with the palette's floor under it, for the layers that carry the silhouette.
   *
   * See `SpherePalette.coreAlphaFloor`. Dark passes a floor of 0, so this is the identity there.
   */
  private solidAlpha(view: SphereView): number {
    const floor = this.palette.coreAlphaFloor;
    return floor + (1 - floor) * view.alpha;
  }

  /** Adds a list of stops to a gradient, in order, with the view's multipliers applied. */
  private addStops(
    gradient: CanvasGradient,
    stops: readonly SphereGradientStop[],
    hue: number,
    view: SphereView,
    alphaScale = 1,
  ): void {
    for (const stop of stops) {
      gradient.addColorStop(
        clamp01(stop.at),
        this.stopColor(hue, stop, view, alphaScale),
      );
    }
  }

  /**
   * The halo.
   *
   * `source-over` in both themes. A blend mode cannot reach the page behind the canvas, so a
   * plain tint is the only thing that can colour the ground around the ball.
   */
  private drawBloom(
    cx: number,
    cy: number,
    radius: number,
    hue: number,
    view: SphereView,
  ): void {
    const { ctx, palette } = this;
    const { base, gain } = palette.bloomRadius;
    const inner = radius * palette.bloomInner;

    /*
      The cap keeps the halo disc inside the canvas. Past the canvas edge the disc is sliced flat
      by the element's own bounds while its alpha is still above zero, which paints a straight
      tinted edge across a round object. It only applies to the radius-anchored (light) bloom:
      the offset-anchored dark bloom ends at alpha 0 on its last stop, so nothing is ever cut
      there, and capping it would squeeze the reference falloff.
    */
    const inradius = Math.min(this.width, this.height) * 0.5;
    const wanted = radius * (base + gain * view.bloom);
    const outer =
      palette.bloomAnchor === 'radius' ? Math.min(wanted, inradius) : wanted;
    if (outer <= inner) return;

    const strength = palette.bloomFloor + (1 - palette.bloomFloor) * view.bloom;
    const gradient = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);

    let last = 0;
    if (palette.bloomAnchor === 'radius') {
      // `at` is a multiple of the sphere radius. The offset that lands on the silhouette moves
      // with both `view.bloom` and `view.radiusScale`, so it is computed per frame, never fixed.
      const outerRatio = outer / radius;
      const span = Math.max(1e-4, outerRatio - palette.bloomInner);
      for (const stop of palette.bloom) {
        // Clamping a rising list keeps it non-decreasing, so `addColorStop` stays legal even
        // when two stops collapse onto 1.
        last = clamp01((stop.at - palette.bloomInner) / span);
        gradient.addColorStop(last, this.stopColor(hue, stop, view, strength));
      }
    } else {
      this.addStops(gradient, palette.bloom, hue, view, strength);
      last = clamp01(palette.bloom[palette.bloom.length - 1]?.at ?? 1);
    }
    // Nothing may be cut at the disc edge.
    if (last < 1) gradient.addColorStop(1, this.color(hue, 0.5, 0, 0));

    ctx.beginPath();
    ctx.arc(cx, cy, outer, 0, TAU);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  /**
   * The ball.
   *
   * Opaque, and painted before every blending layer. The off-centre focus is what turns a flat
   * disc into a volume: the light source sits above and toward the start side.
   */
  private drawCore(
    cx: number,
    cy: number,
    radius: number,
    hue: number,
    view: SphereView,
  ): void {
    const { ctx } = this;
    const gradient = ctx.createRadialGradient(
      cx + radius * FOCUS_X,
      cy + radius * FOCUS_Y,
      radius * 0.05,
      cx,
      cy,
      radius,
    );
    const solid = { ...view, alpha: this.solidAlpha(view) };
    this.addStops(gradient, this.palette.core, hue, solid);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  /**
   * The contact shadow the ball sits on. Light mode only.
   *
   * Not scaled by `view.bloom`: a shadow is cast by the object, not by how loud it is.
   */
  private drawShadow(
    cx: number,
    cy: number,
    radius: number,
    hue: number,
    view: SphereView,
  ): void {
    const stops = this.palette.shadow;
    if (!stops) return;
    const { ctx } = this;
    const reach = radius * 0.86;

    ctx.save();
    ctx.translate(cx, cy + radius * 1.06);
    ctx.scale(1, 0.2);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, reach);
    this.addStops(gradient, stops, hue, view);
    ctx.beginPath();
    ctx.arc(0, 0, reach, 0, TAU);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();
  }

  /**
   * The seam where the ball meets its own halo. Light mode only.
   *
   * Tuned as a tint, not as a blend. Canvas blending is weighted by the backdrop's alpha, and the
   * halo only carries about 0.10 to 0.15 alpha out here, so most of this layer lands as a plain
   * paint whatever the blend mode says.
   */
  private drawOcclusion(
    cx: number,
    cy: number,
    radius: number,
    hue: number,
    view: SphereView,
  ): void {
    const stops = this.palette.occlusion;
    if (!stops) return;
    const { ctx } = this;
    const outer = radius * 1.2;

    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const gradient = ctx.createRadialGradient(
      cx,
      cy,
      radius * 0.96,
      cx,
      cy,
      outer,
    );
    this.addStops(gradient, stops, hue, view);
    ctx.beginPath();
    ctx.arc(cx, cy, outer, 0, TAU);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();
  }

  private drawFilaments(
    cx: number,
    cy: number,
    radius: number,
    hue: number,
    view: SphereView,
  ): void {
    const { ctx, palette } = this;

    ctx.save();
    if (palette.clipFilaments) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, TAU);
      ctx.clip();
    }

    for (const filament of this.filaments) {
      const cos = Math.cos(filament.tilt);
      const sin = Math.sin(filament.tilt);
      ctx.beginPath();

      for (let sample = 0; sample <= FILAMENT_SAMPLES; sample += 1) {
        const u = (sample / FILAMENT_SAMPLES) * TAU;
        // The two phase multipliers (1 and -1.618) do not divide into each other, so the
        // combined shape never visibly repeats and no noise table has to ship.
        const wobble =
          0.5 * Math.sin(u * filament.wobbleA + filament.phase) +
          0.3 * Math.sin(u * filament.wobbleB - filament.phase * 1.618);
        const r = radius * (1 + view.ripple * 0.12 * wobble);
        const x = r * Math.cos(u);
        const y = r * Math.sin(u) * filament.squash;
        const px = cx + x * cos - y * sin;
        const py = cy + x * sin + y * cos;
        if (sample === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();

      const strandHue = hue + filament.hueShift;
      // The wide band. Adds light on dark, takes it away on light.
      ctx.globalCompositeOperation = this.filamentComposite;
      this.strokeStrand(palette.filament, strandHue, radius, view);

      // The thin thread down the middle of the band. `stroke()` keeps the path, so this is one
      // extra stroke and not one extra path build. A dark band with a bright core is what a lit
      // strand looks like from outside, which is how light mode stays continuous with dark.
      if (palette.filamentCore) {
        ctx.globalCompositeOperation = 'source-over';
        this.strokeStrand(palette.filamentCore, strandHue, radius, view);
      }
    }

    ctx.restore();
  }

  private strokeStrand(
    strand: SphereStrand,
    hue: number,
    radius: number,
    view: SphereView,
  ): void {
    const { ctx } = this;
    ctx.lineWidth = Math.max(1, radius * strand.width);
    ctx.strokeStyle = this.color(
      hue,
      strand.lightness,
      strand.chroma * view.saturation,
      (strand.alphaBase + strand.alphaLevel * this.level) * view.alpha,
    );
    ctx.stroke();
  }

  /**
   * The lamp inside the ball. Light mode only, `source-over`, never `lighter`.
   *
   * It is painted AFTER the filaments on purpose. A strand that crosses the lamp is washed out by
   * the lamp, which is what a strand near a bright source really does, and it is what keeps the
   * multiply strands from muddying the hot centre.
   */
  private drawRelight(
    cx: number,
    cy: number,
    radius: number,
    hue: number,
    view: SphereView,
  ): void {
    const stops = this.palette.relight;
    if (!stops) return;
    const { ctx } = this;
    // 0.21R of lamp offset plus 0.42R of reach is 0.63R, so the lamp never touches the rim.
    const gradient = ctx.createRadialGradient(
      cx + radius * LAMP_X,
      cy + radius * LAMP_Y,
      0,
      cx + radius * LAMP_X,
      cy + radius * LAMP_Y,
      radius * 0.42,
    );
    this.addStops(gradient, stops, hue, {
      ...view,
      alpha: this.solidAlpha(view),
    });
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  /**
   * The small specular highlight. Light mode only.
   *
   * Driven by `view.alpha` and the solid floor, never by `view.saturation`: a muted microphone
   * drains the colour out of the glass, it does not make the glass less shiny.
   */
  private drawSpecular(
    cx: number,
    cy: number,
    radius: number,
    hue: number,
    view: SphereView,
  ): void {
    const stops = this.palette.specular;
    if (!stops) return;
    const { ctx } = this;
    const reach = radius * 0.15;
    const alpha = this.solidAlpha(view);

    ctx.save();
    ctx.translate(cx - radius * 0.44, cy - radius * 0.5);
    ctx.rotate(-0.5);
    ctx.scale(1, 0.62);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, reach);
    for (const stop of stops) {
      gradient.addColorStop(
        clamp01(stop.at),
        // The mixed sphere hue, not 0. At this chroma the error is small, but a red-tinted
        // highlight on a violet ball is still wrong.
        this.color(
          hue + (stop.hueShift ?? 0),
          stop.lightness,
          stop.chroma,
          stop.alpha * alpha,
        ),
      );
    }
    ctx.beginPath();
    ctx.arc(0, 0, reach, 0, TAU);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();
  }

  private drawRings(
    cx: number,
    cy: number,
    radius: number,
    hue: number,
    view: SphereView,
  ): void {
    const { ctx, palette } = this;
    if (this.rings.length === 0) return;
    const ripple = palette.ring;

    ctx.save();
    ctx.globalCompositeOperation = this.ringComposite;
    for (const ring of this.rings) {
      const progress = clamp01(ring.age / RING_LIFE_S);
      const fade = (1 - progress) ** palette.ringFadePower;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * (1 + progress * 0.9), 0, TAU);
      ctx.lineWidth = Math.max(1, radius * 0.02 * (1 - progress));
      ctx.strokeStyle = this.color(
        hue,
        ripple.lightness,
        ripple.chroma * view.saturation,
        fade * ripple.alpha * view.alpha,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * One colour string. `oklch` keeps the two hues perceptually even; the `hsl` fallback is
   * for canvas engines that predate CSS Color 4. The fallback is not the same colour, only
   * a plausible one: `MAX_CHROMA` is as saturated as any palette gets, so it maps to a
   * full-saturation `hsl`.
   */
  private color(
    hue: number,
    lightness: number,
    chroma: number,
    alpha: number,
  ): string {
    const a = clamp01(alpha).toFixed(3);
    if (this.supportsOklch) {
      return `oklch(${(lightness * 100).toFixed(1)}% ${chroma.toFixed(3)} ${hue.toFixed(1)} / ${a})`;
    }
    const saturation = clamp01(chroma / MAX_CHROMA) * 100;
    return `hsl(${hue.toFixed(1)} ${saturation.toFixed(0)}% ${(lightness * 100).toFixed(0)}% / ${a})`;
  }
}
