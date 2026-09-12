/*
 * FROZEN copy of the sphere renderer as it shipped before the light-mode rebuild.
 *
 * Do not fix, tidy, or update this file. Its only job is to be the thing the current renderer is
 * compared against by `mobile.spheredark.spec.ts`, which proves dark mode still paints exactly
 * the pixels it painted before. Changing it would make that proof prove nothing.
 *
 * It is not shipped: nothing under `src/` imports it, and the dark proof loads it straight off
 * disk through Vite's `/@fs` route. Its types are copied in rather than imported, so that a later
 * change to the live types cannot quietly change what this file compiles to.
 */

type SphereTheme = 'light' | 'dark';

interface SphereHues {
  user: number;
  agent: number;
}

interface SphereView {
  state: string;
  level: number;
  radiusScale: number;
  hueMix: number;
  saturation: number;
  alpha: number;
  spin: number;
  ripple: number;
  bloom: number;
  rings: boolean;
}

const TAU = Math.PI * 2;
const MAX_CHROMA = 0.22;
export const DEFAULT_SPHERE_HUES: SphereHues = { user: 288, agent: 328 };

interface SphereStop {
  lightness: number;
  chroma: number;
  alpha: number;
}
interface SpherePalette {
  glowComposite: GlobalCompositeOperation;
  bloom: readonly [SphereStop, SphereStop, SphereStop];
  core: readonly [SphereStop, SphereStop, SphereStop];
  filament: {
    lightness: number;
    chroma: number;
    alphaBase: number;
    alphaLevel: number;
  };
  ring: { lightness: number; chroma: number; alpha: number };
}

const SPHERE_PALETTES: Record<SphereTheme, SpherePalette> = {
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

const FILAMENT_COUNT = 10;
const FILAMENT_SAMPLES = 96;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const RING_INTERVAL_S = 0.52;
const RING_LIFE_S = 1.6;
const HUE_TAU_S = 0.042;
const LEVEL_ATTACK_S = 0.04;
const LEVEL_RELEASE_S = 0.18;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
function approach(
  value: number,
  target: number,
  dt: number,
  tau: number,
): number {
  if (dt <= 0) return target;
  return value + (target - value) * (1 - Math.exp(-dt / tau));
}
interface Filament {
  tilt: number;
  squash: number;
  speed: number;
  wobbleA: number;
  wobbleB: number;
  hueShift: number;
  phase: number;
}
function seedFilaments(): Filament[] {
  return Array.from({ length: FILAMENT_COUNT }, (_, index) => ({
    tilt: index * GOLDEN_ANGLE,
    squash: 0.18 + 0.72 * Math.abs(Math.cos(index * GOLDEN_ANGLE)),
    speed: 0.6 + (index / FILAMENT_COUNT) * 0.9,
    wobbleA: 2 + (index % 3),
    wobbleB: 5 + (index % 4),
    hueShift: (index - (FILAMENT_COUNT - 1) / 2) * 3.2,
    phase: index * GOLDEN_ANGLE * 2,
  }));
}
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

export class LegacySpherePainter {
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
  setSize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.width = cssWidth;
    this.height = cssHeight;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  setHues(hues: SphereHues): void {
    this.hues = hues;
  }
  setTheme(theme: SphereTheme): void {
    this.palette = SPHERE_PALETTES[theme];
  }
  get easedLevel(): number {
    return this.level;
  }

  paint(view: SphereView, dtMs: number): void {
    const dt = Math.max(0, dtMs) / 1000;
    this.hueMix = approach(this.hueMix, view.hueMix, dt, HUE_TAU_S);
    this.level = approach(
      this.level,
      view.level,
      dt,
      view.level > this.level ? LEVEL_ATTACK_S : LEVEL_RELEASE_S,
    );
    for (const filament of this.filaments) {
      filament.phase += filament.speed * view.spin * dt;
    }
    this.advanceRings(view.rings, dt);
    this.draw(view);
  }
  private advanceRings(emit: boolean, dt: number): void {
    for (const ring of this.rings) ring.age += dt;
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
    ctx.globalCompositeOperation = this.palette.glowComposite;
    this.drawFilaments(cx, cy, radius, hue, view);
    this.drawRings(cx, cy, radius, hue, view);
    ctx.restore();
  }
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
