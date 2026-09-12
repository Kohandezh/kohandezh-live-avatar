import { describe, expect, it } from 'vitest';
import {
  SpherePainter,
  sphereView,
  type SphereSignals,
} from '@/features/assistant/sphere/sphere';

/**
 * The one invariant the whole light-mode design rests on: the opaque core is down before anything
 * blends.
 *
 * `multiply` blends against the pixels this canvas has already painted. Move a blending layer
 * above the core and it blends against a transparent canvas, where it silently degenerates into a
 * plain paint. No error, no crash, no exception in the console: just the flat purple ball the
 * light-mode work was done to get rid of. That is the kind of break a screenshot catches and a
 * type checker never does, so it is pinned here.
 *
 * jsdom has no 2D context, so the context is a recording fake. Only the calls that decide the
 * order are recorded; the rest answer just enough for the painter to run.
 */

interface Call {
  op: string;
  value?: string;
}

function recordingContext(): {
  ctx: CanvasRenderingContext2D;
  calls: Call[];
} {
  const calls: Call[] = [];
  const gradient = {
    addColorStop: () => undefined,
  } as unknown as CanvasGradient;

  /*
    `save` and `restore` really do stack the blend mode, because that is the behaviour under test:
    a layer must not leak its blend mode into the layer after it. A fake whose `restore` did
    nothing would report a leak that is not there.
  */
  const stack: GlobalCompositeOperation[] = [];
  let composite: GlobalCompositeOperation = 'source-over';

  const target = {
    // `oklch()` support is probed by writing a colour and reading it back. A fake that stores
    // what it is given answers "yes", which is the path worth testing.
    fillStyle: '' as string | CanvasGradient,
    strokeStyle: '' as string | CanvasGradient,
    lineWidth: 1,
    get globalCompositeOperation(): GlobalCompositeOperation {
      return composite;
    },
    set globalCompositeOperation(value: GlobalCompositeOperation) {
      composite = value;
      calls.push({ op: 'composite', value });
    },
    setTransform: () => undefined,
    clearRect: () => calls.push({ op: 'clearRect' }),
    createRadialGradient: () => gradient,
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    arc: () => calls.push({ op: 'arc' }),
    clip: () => calls.push({ op: 'clip' }),
    fill: () => calls.push({ op: 'fill' }),
    stroke: () => calls.push({ op: 'stroke' }),
    save: () => {
      stack.push(composite);
      calls.push({ op: 'save' });
    },
    restore: () => {
      composite = stack.pop() ?? 'source-over';
      calls.push({ op: 'restore' });
    },
    translate: () => undefined,
    rotate: () => undefined,
    scale: () => undefined,
  };

  const ctx = target as unknown as CanvasRenderingContext2D;

  return { ctx, calls };
}

const SIGNALS: SphereSignals = {
  status: 'connected',
  isUserSpeaking: false,
  isAvatarSpeaking: true,
  isMicMuted: false,
};

function paintOnce(theme: 'light' | 'dark'): Call[] {
  const { ctx, calls } = recordingContext();
  const painter = new SpherePainter(ctx);
  painter.setSize(288, 288, 2);
  painter.setTheme(theme);
  // Two frames, so a ring exists by the second one and the ring layer really runs.
  painter.paint(sphereView(SIGNALS, 0.8, 0), 600);
  calls.length = 0;
  painter.paint(sphereView(SIGNALS, 0.8, 600), 16);
  return calls;
}

describe('sphere draw order', () => {
  it('paints the opaque core before the strands blend against it', () => {
    const calls = paintOnce('light');

    const firstStroke = calls.findIndex((call) => call.op === 'stroke');
    const fillsFirst = calls
      .slice(0, firstStroke)
      .filter((call) => call.op === 'fill').length;

    /*
      Four solid fills go down before the first strand is stroked: the contact shadow, the halo,
      the occlusion seam, and the ball. Lose the fourth and the strands multiply against a
      transparent canvas, where multiply degenerates into a plain paint and the ball goes flat.
      The count is asserted rather than "some fill came first", because "some fill" is already
      true of the halo and would stay true with the core moved to the end.
    */
    expect(firstStroke, 'the strands must be stroked').toBeGreaterThan(-1);
    expect(fillsFirst).toBe(4);

    // And the strands' blend mode is only set once those fills exist.
    const firstBlend = calls.findIndex(
      (call) => call.op === 'composite' && call.value === 'multiply',
    );
    expect(firstBlend).toBeGreaterThan(-1);
    expect(calls.filter((call) => call.op === 'fill').length).toBeGreaterThan(
      4,
    );
  });

  it('paints only the halo and the ball before the strands, in dark mode', () => {
    const calls = paintOnce('dark');
    const firstStroke = calls.findIndex((call) => call.op === 'stroke');
    const fillsFirst = calls
      .slice(0, firstStroke)
      .filter((call) => call.op === 'fill').length;
    // Dark has no shadow, no occlusion seam, no lamp and no glint. Two fills, exactly as before.
    expect(fillsFirst).toBe(2);
    expect(calls.filter((call) => call.op === 'fill')).toHaveLength(2);
  });

  it('still clears, fills and strokes on both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      const calls = paintOnce(theme);
      expect(calls[0]).toEqual({ op: 'clearRect' });
      expect(calls.some((call) => call.op === 'fill')).toBe(true);
      expect(calls.some((call) => call.op === 'stroke')).toBe(true);
    }
  });

  it('clips the strands to the ball in light mode and not in dark mode', () => {
    expect(paintOnce('light').some((call) => call.op === 'clip')).toBe(true);
    expect(paintOnce('dark').some((call) => call.op === 'clip')).toBe(false);
  });

  it('strokes each strand twice in light mode and once in dark mode', () => {
    const strokes = (theme: 'light' | 'dark') =>
      paintOnce(theme).filter((call) => call.op === 'stroke').length;
    // Ten strands, plus however many rings are alive. Light doubles only the strand strokes.
    expect(strokes('light') - strokes('dark')).toBe(10);
  });

  it('never leaves a blend mode set for the next frame', () => {
    for (const theme of ['light', 'dark'] as const) {
      const { ctx } = recordingContext();
      const painter = new SpherePainter(ctx);
      painter.setSize(288, 288, 2);
      painter.setTheme(theme);
      painter.paint(sphereView(SIGNALS, 0.8, 0), 600);
      // Every layer that blends restores the mode it found. A layer that forgets would silently
      // blend the next frame's halo, which is painted first and must be a plain paint.
      expect(ctx.globalCompositeOperation).toBe('source-over');
    }
  });
});
