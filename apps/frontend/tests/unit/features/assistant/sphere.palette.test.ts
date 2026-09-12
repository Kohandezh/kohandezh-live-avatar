import { describe, expect, it } from 'vitest';
import {
  SPHERE_PALETTES,
  type SphereGradientStop,
  type SphereStop,
} from '@/features/assistant/sphere/sphere';

/**
 * The sRGB gamut pass, and the draw-order pass, for the sphere palettes.
 *
 * Chroma at high lightness is capped by the gamut, not by taste. A stop the gamut cannot hold does
 * not throw: the browser quietly clips it, which desaturates the colour and drags its hue. On a
 * light page that is exactly what would stop the user hue (288) and the agent hue (328) reading as
 * an even pair, so the light palette is checked stop by stop.
 *
 * The dark palette is deliberately NOT checked. Several of its stops sit outside the gamut on
 * purpose: they are the near-white glow stops, and clipping them pushes them toward white, which
 * is the look the reference image is built on. Dark mode is frozen (see
 * `tests/e2e/mobile.spheredark.spec.ts`), so changing those numbers is not on the table.
 */

/** OKLCH to linear sRGB to sRGB. The maths the browser runs for an `oklch()` colour. */
function oklchToRgb(
  lightness: number,
  chroma: number,
  hueDegrees: number,
): [number, number, number] {
  const hue = (hueDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);

  const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lRoot ** 3;
  const m = mRoot ** 3;
  const s = sRoot ** 3;

  const linear: [number, number, number] = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  return linear.map((value) =>
    value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055,
  ) as [number, number, number];
}

/**
 * Every base hue the sphere can ask for.
 *
 * 288 is `--sphere-hue-user`, 328 is `--sphere-hue-agent`, and the sphere blends linearly between
 * them, so it visits everything in between and nothing outside. A stop's own `hueShift` is added
 * on top of this, and the filaments add a further spread of their own.
 */
const BASE_HUES = Array.from({ length: 101 }, (_, index) => 288 + index * 0.4);

/**
 * The extra spread the ten strands add on top of the base hue (`Filament.hueShift`), so the ten
 * are not one flat colour. Only the two strand layers see it.
 */
const STRAND_SPREAD = 14.4;

/** Half a step of 8-bit rounding. Anything further out is a real clip, not float noise. */
const TOLERANCE = 1 / 512;

function offenders(stop: SphereStop, label: string, spread = 0): string[] {
  const found: string[] = [];
  const leans = spread === 0 ? [0] : [-spread, 0, spread];
  for (const base of BASE_HUES)
    for (const lean of leans) {
      const shifted = base + lean + (stop.hueShift ?? 0);
      const rgb = oklchToRgb(stop.lightness, stop.chroma, shifted);
      if (rgb.some((v) => v < -TOLERANCE || v > 1 + TOLERANCE)) {
        found.push(
          `${label} oklch(${stop.lightness} ${stop.chroma} ${shifted.toFixed(1)}) -> ` +
            rgb.map((v) => v.toFixed(3)).join(', '),
        );
      }
    }
  return found;
}

describe('the light palette stays inside the sRGB gamut', () => {
  const { light } = SPHERE_PALETTES;

  /** A strand is a stop with no `alpha` field. The gamut does not care about alpha. */
  const asStop = (strand: {
    lightness: number;
    chroma: number;
  }): SphereStop => ({
    lightness: strand.lightness,
    chroma: strand.chroma,
    alpha: 1,
  });

  const layers: [string, readonly SphereStop[] | null, number?][] = [
    ['bloom', light.bloom],
    ['core', light.core],
    ['shadow', light.shadow],
    ['occlusion', light.occlusion],
    ['relight', light.relight],
    ['specular', light.specular],
    ['ring', [light.ring]],
    ['filament', [asStop(light.filament)], STRAND_SPREAD],
    [
      'filamentCore',
      light.filamentCore ? [asStop(light.filamentCore)] : null,
      STRAND_SPREAD,
    ],
  ];

  for (const [name, stops, spread] of layers) {
    it(`${name} is in gamut at every hue the sphere can reach`, () => {
      expect(stops, `${name} must exist in the light palette`).toBeTruthy();
      const bad = (stops ?? []).flatMap((stop, index) =>
        offenders(stop, `${name}[${index}]`, spread),
      );
      // The first two are enough to read; the count says how bad it is.
      expect(bad.slice(0, 2).join(' | '), `${bad.length} clipped`).toBe('');
    });
  }
});

describe('the light core keeps its dip, lift and drop', () => {
  /*
    The six-stop profile is the whole read: the body darkens toward the edge, lifts again for the
    caustic ring the curve of the glass gathers, then drops hard for the rim. Flatten any part of
    it and the ball goes back to being a plain purple disc, which is the defect this work fixed.
  */
  const core = SPHERE_PALETTES.light.core as readonly SphereGradientStop[];

  it('has six stops in rising order', () => {
    expect(core).toHaveLength(6);
    for (let i = 1; i < core.length; i += 1) {
      expect(core[i].at).toBeGreaterThan(core[i - 1].at);
    }
    expect(core[0].at).toBe(0);
    expect(core[core.length - 1].at).toBe(1);
  });

  it('dips before the edge, lifts for the caustic, then drops at the rim', () => {
    const [centre, , body, dip, lift, rim] = core;
    expect(centre.lightness).toBeGreaterThan(body.lightness);
    expect(dip.lightness).toBeLessThan(body.lightness);
    expect(lift.lightness).toBeGreaterThan(dip.lightness);
    expect(rim.lightness).toBeLessThan(dip.lightness);
    // The rim is the darkest thing on the ball. That is what makes the silhouette readable on a
    // page that is lighter than every part of the sphere.
    expect(Math.min(...core.map((stop) => stop.lightness))).toBe(rim.lightness);
  });

  it('stays below the page it is painted on', () => {
    // `--background` measures oklch(97.02% 0 0). A ball lighter than the page is a hole in it.
    for (const stop of core) expect(stop.lightness).toBeLessThan(0.97);
  });
});
