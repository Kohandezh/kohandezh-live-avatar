import path from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * The dark-mode proof.
 *
 * Paints the dark sphere with the new renderer and with a byte-for-byte copy of the renderer that
 * shipped before the light-mode work, from identical inputs, in a real browser, and compares the
 * two canvases. jsdom has no 2D context, so this cannot be a unit test.
 *
 * It is the only thing that turns "dark mode is unchanged" from an argument into a fact.
 */
test('dark mode is byte identical to the previous renderer', async ({
  page,
}) => {
  await page.goto('/login');

  /*
    The mobile dev server's Vite root is `src/app/mobile`, so neither module is under the served
    root. `/@fs/<absolute path>` is how Vite serves a file from anywhere in the workspace.
  */
  const root = process.cwd();
  const paths = {
    next: `/@fs${path.resolve(root, 'src/features/assistant/sphere/sphere.ts')}`,
    legacy: `/@fs${path.resolve(root, 'tests/e2e/fixtures/legacySphere.ts')}`,
  };

  const result = await page.evaluate(async (urls: typeof paths) => {
    /*
      Typed structurally rather than with `typeof import(...)`. The e2e project has no path
      aliases, so pulling the app's own module graph in here would drag half the app into this
      type check for no gain.
    */
    interface Signals {
      status: string;
      isUserSpeaking: boolean;
      isAvatarSpeaking: boolean;
      isMicMuted: boolean;
    }
    interface PainterLike {
      setSize(width: number, height: number, dpr: number): void;
      setHues(hues: { user: number; agent: number }): void;
      setTheme(theme: 'dark' | 'light'): void;
      paint(view: unknown, dtMs: number): void;
    }
    type PainterClass = new (ctx: CanvasRenderingContext2D) => PainterLike;

    const [next, legacy] = (await Promise.all([
      import(/* @vite-ignore */ urls.next),
      import(/* @vite-ignore */ urls.legacy),
    ])) as [
      {
        SpherePainter: PainterClass;
        sphereView: (
          signals: Signals,
          level: number | null,
          timeMs: number,
        ) => unknown;
      },
      { LegacySpherePainter: PainterClass },
    ];

    const make = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 576;
      canvas.height = 576;
      return canvas;
    };

    const run = (
      Painter: PainterClass,
      signals: Signals,
      level: number | null,
    ) => {
      const canvas = make();
      const painter = new Painter(canvas.getContext('2d')!);
      painter.setSize(288, 288, 2);
      painter.setHues({ user: 288, agent: 328 });
      painter.setTheme('dark');
      // Fixed clock, fixed step. Forty frames is long enough for rings to be emitted, to age,
      // and to be retired, and for the filament phases to travel.
      for (let frame = 0; frame < 40; frame += 1) {
        painter.paint(next.sphereView(signals, level, 1234 + frame * 16), 16);
      }
      return canvas.toDataURL();
    };

    const cases: {
      name: string;
      signals: Signals;
      level: number | null;
    }[] = [
      {
        name: 'idle',
        signals: {
          status: 'connected',
          isUserSpeaking: false,
          isAvatarSpeaking: false,
          isMicMuted: false,
        },
        level: null,
      },
      {
        name: 'user',
        signals: {
          status: 'connected',
          isUserSpeaking: true,
          isAvatarSpeaking: false,
          isMicMuted: false,
        },
        level: null,
      },
      {
        name: 'agent',
        signals: {
          status: 'connected',
          isUserSpeaking: false,
          isAvatarSpeaking: true,
          isMicMuted: false,
        },
        level: 0.7,
      },
      {
        name: 'muted',
        signals: {
          status: 'connected',
          isUserSpeaking: false,
          isAvatarSpeaking: false,
          isMicMuted: true,
        },
        level: null,
      },
      {
        name: 'ended',
        signals: {
          status: 'ended',
          isUserSpeaking: false,
          isAvatarSpeaking: false,
          isMicMuted: false,
        },
        level: null,
      },
    ];

    return cases.map(({ name, signals, level }) => ({
      name,
      same:
        run(next.SpherePainter, signals, level) ===
        run(legacy.LegacySpherePainter, signals, level),
    }));
  }, paths);

  expect(result).toEqual([
    { name: 'idle', same: true },
    { name: 'user', same: true },
    { name: 'agent', same: true },
    { name: 'muted', same: true },
    { name: 'ended', same: true },
  ]);
});
