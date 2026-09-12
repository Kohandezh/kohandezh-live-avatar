import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/utils';
import { usePrefersReducedMotion } from '../useConversationScreen';
import type { AssistantStatus } from '../types';
import {
  DEFAULT_SPHERE_HUES,
  SpherePainter,
  sphereState,
  sphereView,
  type SphereHues,
  type SphereSignals,
  type SphereTheme,
} from './sphere';
import { useAvatarAudioLevel } from './useAvatarAudioLevel';

/**
 * A screen reader must not hear every flip of the speaking flags. They change several
 * times per turn, so the live region waits this long before it reads the new state.
 */
const ANNOUNCE_DELAY_MS = 800;

/** A phone with a 3x screen gains nothing visible and pays three times the fill cost. */
const MAX_DPR = 2;

/** A tab that was in the background for a minute must not replay that minute in one step. */
const MAX_FRAME_MS = 50;

/** Reads the two hues from CSS so the theme owns them, not this file. */
function readHues(element: Element): SphereHues {
  const styles = getComputedStyle(element);
  const read = (name: string, fallback: number) => {
    const value = Number.parseFloat(styles.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    user: read('--sphere-hue-user', DEFAULT_SPHERE_HUES.user),
    agent: read('--sphere-hue-agent', DEFAULT_SPHERE_HUES.agent),
  };
}

/**
 * How the app marks dark mode. `ThemeSync` writes both the class and the attribute on `<html>`,
 * and `globals.css` keys its `dark` variant on the same pair, so matching here keeps the sphere
 * and the page it sits on in step. Deliberately not `prefers-color-scheme`: the app resolves
 * `system` itself, so the OS preference is not the answer when the user picked a theme by hand.
 */
const DARK_SELECTOR = '.dark, [data-theme="dark"]';

/** Which ground the sphere is being painted on. */
function readTheme(element: Element): SphereTheme {
  if (element.closest(DARK_SELECTOR)) return 'dark';
  // The widget target renders inside a Shadow DOM, where `closest` stops at the shadow
  // boundary. The theme marker is on the host, so check it by hand.
  const root = element.getRootNode();
  if (
    typeof ShadowRoot !== 'undefined' &&
    root instanceof ShadowRoot &&
    root.host.closest(DARK_SELECTOR)
  ) {
    return 'dark';
  }
  return 'light';
}

/**
 * Which sentence describes the conversation right now.
 *
 * `assistant.voice.*` has no entry for `requesting` or `connecting`, so those two fall back
 * to `assistant.status.*`. Same split as `AssistantVoiceView`.
 */
function messageKey(signals: SphereSignals): string {
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

export interface AssistantSphereProps {
  status: AssistantStatus;
  isUserSpeaking: boolean;
  isAvatarSpeaking: boolean;
  isMicMuted: boolean;
  /**
   * The media element of the screen that renders this sphere. The avatar's audio track
   * rides on it as a `MediaStream`, which is where the real loudness is measured.
   */
  mediaRef: RefObject<HTMLMediaElement | null>;
  className?: string;
}

/**
 * The audio conversation sphere (requirement 17).
 *
 * It shows who holds the turn and how loud they are. The user's turn swells with the voice;
 * the avatar's turn holds its size, spins fast and pushes out rings. The two are different
 * in kind, so nobody has to compare sizes to tell them apart.
 *
 * The drawing lives in `sphere.ts` and the loudness in `useAvatarAudioLevel.ts`. This file
 * only owns the canvas, the animation frame loop, and what a screen reader hears.
 *
 * `data-sphere-state` on the wrapper is how a test asserts the behaviour. A canvas has no
 * DOM to query and cannot be checked by pixels.
 */
export function AssistantSphere({
  status,
  isUserSpeaking,
  isAvatarSpeaking,
  isMicMuted,
  mediaRef,
  className,
}: AssistantSphereProps) {
  const { t } = useTranslation();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painterRef = useRef<SpherePainter | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const signals: SphereSignals = {
    status,
    isUserSpeaking,
    isAvatarSpeaking,
    isMicMuted,
  };
  const state = sphereState(signals);

  /*
    Every changing signal reaches the loop through this ref, never through the effect's
    dependency list. `isUserSpeaking` flips on and off many times in one sentence; if it
    were a dependency the loop would tear down and restart on each flip.
  */
  const signalsRef = useRef(signals);
  signalsRef.current = signals;

  const readLevel = useAvatarAudioLevel(mediaRef, status === 'connected');

  /*
    The loop runs while the conversation is being set up or is live. `connecting` is
    included on purpose: its bloom pulses so the globe reads as "working". Everything else
    (idle, ended, error) is one still frame, which costs nothing.
  */
  const isAnimating =
    status === 'requesting' ||
    status === 'connecting' ||
    status === 'connected';

  /**
   * Paints one frame and stops. `dt = 0` makes the eased values snap to their targets, so
   * a still frame is the finished picture rather than the first step toward it.
   */
  const paintStill = useCallback(() => {
    const painter = painterRef.current;
    if (!painter) return;
    const now = typeof performance === 'undefined' ? 0 : performance.now();
    painter.paint(sphereView(signalsRef.current, null, now), 0);
  }, []);

  // The canvas, its size, and its colours.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;

    // jsdom has no 2D context. No canvas means no sphere, never a crash.
    const context = canvas.getContext('2d');
    if (!context) return;

    const painter = new SpherePainter(context);
    painterRef.current = painter;

    /*
      The colours live in CSS, so a theme switch changes them while the element keeps the exact
      same size. Reading them only on resize would leave the sphere in the old theme's palette
      until something happened to resize it, and on this screen nothing ever does.
    */
    const applyColours = () => {
      painter.setHues(readHues(wrapper));
      painter.setTheme(readTheme(wrapper));
      paintStill();
    };

    const resize = () => {
      const rect = wrapper.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      // Setting the size resets the context, so the scale has to be reapplied here.
      painter.setSize(width, height, dpr);
      applyColours();
    };

    resize();

    const stops: (() => void)[] = [];

    if (typeof ResizeObserver === 'undefined') {
      // Old WebViews and the test environment. The window is the next best signal.
      window.addEventListener('resize', resize);
      stops.push(() => window.removeEventListener('resize', resize));
    } else {
      const observer = new ResizeObserver(resize);
      observer.observe(wrapper);
      stops.push(() => observer.disconnect());
    }

    /*
      The theme marker is written on <html> by `ThemeSync` (and on the host element for the
      widget target), so watch those two attributes. This also covers the system-mode user whose
      operating system flips to dark while the screen is open: `ThemeSync` rewrites the class for
      that case too, so one observer catches every route into a theme change.
    */
    if (typeof MutationObserver !== 'undefined') {
      const themeObserver = new MutationObserver(applyColours);
      const options = {
        attributes: true,
        attributeFilter: ['class', 'data-theme'],
      };
      themeObserver.observe(document.documentElement, options);

      const root = wrapper.getRootNode();
      if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) {
        themeObserver.observe(root.host, options);
      }
      stops.push(() => themeObserver.disconnect());
    }

    return () => {
      for (const stop of stops) stop();
      painterRef.current = null;
    };
  }, [paintStill]);

  // The animation frame loop.
  useEffect(() => {
    if (!isAnimating || reducedMotion) return;

    let frame = 0;
    let previous = 0;

    const step = (time: number) => {
      const painter = painterRef.current;
      if (painter) {
        const elapsed =
          previous === 0 ? 0 : Math.min(MAX_FRAME_MS, time - previous);
        previous = time;
        painter.paint(
          sphereView(signalsRef.current, readLevel(), time),
          elapsed,
        );
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
  }, [isAnimating, reducedMotion, readLevel]);

  /*
    The still frame. It covers the states with no loop, and it repaints when the speaker
    changes: a reduced-motion user still sees who holds the turn, through colour and size
    instead of movement.
  */
  useEffect(() => {
    if (isAnimating && !reducedMotion) return;
    paintStill();
  }, [state, isAnimating, reducedMotion, paintStill]);

  const message = t(messageKey(signals));
  const [announced, setAnnounced] = useState(message);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setAnnounced(message),
      ANNOUNCE_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [message]);

  return (
    <div className={cn('flex flex-col items-center gap-4', className)}>
      <div
        ref={wrapperRef}
        data-sphere-state={state}
        className="relative aspect-square w-full max-w-[18rem]"
      >
        {/* The picture carries no information a screen reader can use. The text below does. */}
        <canvas ref={canvasRef} aria-hidden="true" className="h-full w-full" />
      </div>

      {/* Sighted users get the change at once. */}
      <p
        aria-hidden="true"
        className="text-center text-sm font-medium text-foreground"
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
