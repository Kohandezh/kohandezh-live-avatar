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
}

/**
 * How the sphere is painted on one theme's ground.
 *
 * `sphereView` says what the sphere is *doing* (who holds the turn, how loud, how fast it
 * spins). The palette says how that is painted so it survives the ground behind it. Keeping the
 * two apart is why a theme switch needs no change to the behaviour code, and why the unit tests
 * of `sphereView` do not care about the theme at all.
 */
export interface SpherePalette {
  /**
   * How the filaments and the rings are composited.
   *
   * `lighter` adds light, which is what a glowing object does on a near-black ground. On a light
   * ground adding light only pushes the pixels toward white, so the strands disappear; there the
   * sphere is painted as a solid object with `source-over` instead.
   */
  glowComposite: GlobalCompositeOperation;
  /** Outer glow, from the centre outward. The last stop is always fully transparent. */
  bloom: readonly [SphereStop, SphereStop, SphereStop];
  /** The ball itself: highlight, body, rim. */
  core: readonly [SphereStop, SphereStop, SphereStop];
  /** The ten orbiting strands. Their alpha rises with the measured loudness. */
  filament: {
    lightness: number;
    chroma: number;
    /** Alpha at silence. */
    alphaBase: number;
    /** Added to the alpha at full loudness. */
    alphaLevel: number;
  };
  /** The expanding rings of the avatar's turn. Alpha fades to 0 over the ring's life. */
  ring: { lightness: number; chroma: number; alpha: number };
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
 * DARK is the reference image: a near-black page, a white-hot core inside a saturated violet
 * body, strands and rings that add light on top of it, and a wide bloom bleeding outward.
 *
 * LIGHT is the same object under different light. Three things change, and all three are forced
 * by the ground:
 *
 * 1. Compositing. `lighter` over a light page is invisible, so the strands and rings switch to
 *    `source-over` and get darker than the ball instead of brighter.
 * 2. Opacity. On black a 35% violet reads as glow; on #f5f5f5 it reads as nothing. The core is
 *    close to opaque in light mode so it is a solid object, and the highlight stays lighter than
 *    the body so the ball still looks round.
 * 3. Lightness. Every light-mode colour sits below the page's lightness (0.97) rather than above
 *    it. The bloom becomes a coloured halo, not a white one.
 *
 * The light bloom is also much weaker, and that is a shape problem rather than a taste one. The
 * bloom is a radial gradient filled across the whole canvas rectangle, so it reaches the straight
 * edges before it reaches the corners. On a dark ground a wide, strong glow hides that; on a light
 * ground the same strength paints a visible tinted box around the ball. Rendered and checked at
 * the avatar's turn, which is where the bloom is strongest.
 *
 * The hues are the same in both themes; only how they are laid down changes.
 */
export const SPHERE_PALETTES: Record<SphereTheme, SpherePalette> = {
  dark: {
    glowComposite: 'lighter',
    bloom: [
      { lightness: 0.78, chroma: 0.2, alpha: 0.62 },
      { lightness: 0.66, chroma: 0.19, alpha: 0.3 },
      { lightness: 0.52, chroma: 0.12, alpha: 0 },
    ],
    core: [
      { lightness: 0.97, chroma: 0.05, alpha: 0.72 },
      { lightness: 0.7, chroma: 0.22, alpha: 0.58 },
      { lightness: 0.56, chroma: 0.21, alpha: 0.14 },
    ],
    filament: {
      lightness: 0.82,
      chroma: 0.17,
      alphaBase: 0.1,
      alphaLevel: 0.12,
    },
    ring: { lightness: 0.85, chroma: 0.16, alpha: 0.35 },
  },
  light: {
    glowComposite: 'source-over',
    bloom: [
      { lightness: 0.72, chroma: 0.2, alpha: 0.22 },
      { lightness: 0.66, chroma: 0.19, alpha: 0.07 },
      { lightness: 0.6, chroma: 0.16, alpha: 0 },
    ],
    core: [
      { lightness: 0.84, chroma: 0.13, alpha: 0.96 },
      { lightness: 0.62, chroma: 0.21, alpha: 0.99 },
      { lightness: 0.5, chroma: 0.2, alpha: 0.96 },
    ],
    filament: {
      lightness: 0.52,
      chroma: 0.2,
      alphaBase: 0.26,
      alphaLevel: 0.22,
    },
    ring: { lightness: 0.58, chroma: 0.2, alpha: 0.45 },
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
 * Paints the sphere on a 2D canvas.
 *
 * Not SVG: rebuilding ten path `d` attributes plus a blur filter every frame is the
 * classic 15 to 25 fps case on a mid-range Android. Not WebGL: a shader plus a
 * context-lost handler is a lot of machinery for one decorative element, and a full-screen
 * noise shader is often slower because it is limited by how fast the device can fill
 * pixels.
 *
 * The outer glow is a radial gradient, never `ctx.filter = 'blur(...)'`. A radial gradient
 * is what a blurred point light looks like, so one `fillRect` replaces a whole filter pass.
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
  private hueMix = 0;
  private level = 0;
  private ringTimer = 0;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
    this.supportsOklch = canvasSupportsOklch(ctx);
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
    this.palette = SPHERE_PALETTES[theme];
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

  private draw(view: SphereView): void {
    const { ctx, width, height } = this;
    if (width <= 0 || height <= 0) return;

    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.3 * view.radiusScale;
    const hue =
      this.hues.user + (this.hues.agent - this.hues.user) * this.hueMix;

    ctx.clearRect(0, 0, width, height);
    this.drawBloom(cx, cy, radius, hue, view);
    this.drawCore(cx, cy, radius, hue, view);

    ctx.save();
    // On a dark ground this is `lighter`, so overlapping light adds up the way real light does.
    // On a light ground it is `source-over`: see `SpherePalette.glowComposite`.
    ctx.globalCompositeOperation = this.palette.glowComposite;
    this.drawFilaments(cx, cy, radius, hue, view);
    this.drawRings(cx, cy, radius, hue, view);
    ctx.restore();
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
      hue,
      stop.lightness,
      stop.chroma * view.saturation,
      stop.alpha * view.alpha * alphaScale,
    );
  }

  private drawBloom(
    cx: number,
    cy: number,
    radius: number,
    hue: number,
    view: SphereView,
  ): void {
    const { ctx } = this;
    const [inner, middle, edge] = this.palette.bloom;
    const outer = radius * (1.35 + view.bloom * 1.25);
    const gradient = ctx.createRadialGradient(
      cx,
      cy,
      radius * 0.2,
      cx,
      cy,
      outer,
    );
    gradient.addColorStop(0, this.stopColor(hue, inner, view, view.bloom));
    gradient.addColorStop(0.45, this.stopColor(hue, middle, view, view.bloom));
    gradient.addColorStop(1, this.stopColor(hue, edge, view, view.bloom));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private drawCore(
    cx: number,
    cy: number,
    radius: number,
    hue: number,
    view: SphereView,
  ): void {
    const { ctx } = this;
    const [highlight, body, rim] = this.palette.core;
    // Off-centre highlight: a light source above and to the start side gives the flat
    // circle its volume.
    const gradient = ctx.createRadialGradient(
      cx - radius * 0.25,
      cy - radius * 0.3,
      radius * 0.05,
      cx,
      cy,
      radius,
    );
    gradient.addColorStop(0, this.stopColor(hue, highlight, view));
    gradient.addColorStop(0.6, this.stopColor(hue, body, view));
    gradient.addColorStop(1, this.stopColor(hue, rim, view));
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  private drawFilaments(
    cx: number,
    cy: number,
    radius: number,
    hue: number,
    view: SphereView,
  ): void {
    const { ctx } = this;
    ctx.lineWidth = Math.max(1, radius * 0.012);

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
      const strand = this.palette.filament;
      ctx.strokeStyle = this.color(
        hue + filament.hueShift,
        strand.lightness,
        strand.chroma * view.saturation,
        (strand.alphaBase + strand.alphaLevel * this.level) * view.alpha,
      );
      ctx.stroke();
    }
  }

  private drawRings(
    cx: number,
    cy: number,
    radius: number,
    hue: number,
    view: SphereView,
  ): void {
    const { ctx } = this;
    const ripple = this.palette.ring;
    for (const ring of this.rings) {
      const progress = clamp01(ring.age / RING_LIFE_S);
      ctx.beginPath();
      ctx.arc(cx, cy, radius * (1 + progress * 0.9), 0, TAU);
      ctx.lineWidth = Math.max(1, radius * 0.02 * (1 - progress));
      ctx.strokeStyle = this.color(
        hue,
        ripple.lightness,
        ripple.chroma * view.saturation,
        (1 - progress) * ripple.alpha * view.alpha,
      );
      ctx.stroke();
    }
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
