import type { AssistantStatus } from '../types';

/**
 * Pure maths for the AI Voice orb (requirement 17).
 *
 * The picture is the user's own SVG artwork, which animates itself with SMIL. Nothing here
 * draws anything. This file only decides how much to scale the wrapper the artwork sits in,
 * and how bright the halo behind it should be, so every rule can be unit tested.
 */

/**
 * The five states the orb can be in.
 *
 * The wrapper publishes the value as `data-sphere-state`. The name is kept from the old
 * canvas sphere on purpose: `tests/e2e/mobile.conversation.spec.ts` asserts it, and the
 * meaning did not change.
 */
export type OrbState = 'idle' | 'user' | 'agent' | 'muted' | 'ended';

/** Everything the orb needs to know about the conversation. */
export interface OrbSignals {
  status: AssistantStatus;
  isUserSpeaking: boolean;
  isAvatarSpeaking: boolean;
  isMicMuted: boolean;
}

/** What one frame writes onto the DOM. */
export interface OrbFrame {
  state: OrbState;
  /** Multiplies the size of the artwork wrapper. 1 is the resting size. */
  scale: number;
  /** Multiplies the size of the halo behind the artwork. */
  haloScale: number;
  /** Opacity of that halo, 0 to 1. */
  haloOpacity: number;
}

/**
 * How far the agent's voice may push the orb.
 *
 * 8% is the whole budget the design asks for. Anything more stops reading as breathing and
 * starts reading as bouncing.
 */
export const AGENT_SCALE_RANGE = 0.08;

/**
 * How far the user's voice may push the orb.
 *
 * Deliberately tiny. The user's turn is told by the halo, not by size. A completely frozen
 * orb would look broken, so it still moves a little, just not enough to be confused with
 * the agent's turn.
 */
export const USER_SCALE_RANGE = 0.015;

/** The halo the user's turn swells, from resting to loudest. */
export const USER_HALO_OPACITY = { min: 0.2, max: 0.7 } as const;
export const USER_HALO_SCALE = { min: 1.04, max: 1.18 } as const;

/** The agent's turn keeps a steady, dim halo so the two turns never look alike. */
export const AGENT_HALO_OPACITY = 0.14;

/**
 * Time constants for the level smoothing, in seconds.
 *
 * The level rises much faster than it falls, the way a volume meter does. A syllable has to
 * reach the orb at once, but the short gap between two syllables must not flatten it. With
 * these two numbers a syllable is visible and the orb never jitters.
 */
export const LEVEL_ATTACK_S = 0.045;
export const LEVEL_RELEASE_S = 0.22;

/**
 * Set to a number of degrees to rotate the artwork's hue toward the app accent.
 *
 * OFF (0) by default, and it should stay off: the artwork is the user's own, and repainting
 * it is not this component's job. It exists so the choice can be tried in one line instead
 * of being re-implemented. The artwork's own palette measures around hue 330 (magenta); the
 * app accent is hue 308, so about -22 would bring the two together.
 */
export const ORB_HUE_SHIFT_DEG = 0;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * clamp01(amount);
}

/**
 * A stand-in for a speaker's loudness, 0 to 1.
 *
 * Used for the user's turn, where no real microphone level exists (the SDK keeps the local
 * track private), and for the agent's turn when no analyser could be built. Three sines at
 * rates that do not divide into each other: a syllable rate, a slower stress pattern, and a
 * small jitter. The result never visibly repeats, and the same instant always gives the same
 * number, so it can be tested.
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
 * The avatar's turn wins over a muted microphone: the user needs to see who is talking more
 * than they need to be reminded that their own microphone is off.
 */
export function orbState(signals: OrbSignals): OrbState {
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
 * The loudness the orb should be heading toward right now, 0 to 1.
 *
 * `avatarLevel` is the measurement from `useAvatarAudioLevel`, or **null** when no analyser
 * could be built: no track yet, no AudioContext, or a context the browser refuses to start.
 * Null falls back to the synthetic envelope so the orb still looks alive. A level of 0 is a
 * normal reading (silence between words), never an error, so it is used as it is.
 */
export function levelTarget(
  signals: OrbSignals,
  avatarLevel: number | null,
  timeMs: number,
): number {
  switch (orbState(signals)) {
    case 'agent':
      return clamp01(avatarLevel ?? speechEnvelope(timeMs));
    case 'user':
      return speechEnvelope(timeMs);
    default:
      // Idle, muted and ended all rest at zero. The orb's own SMIL keeps it alive there.
      return 0;
  }
}

/**
 * Moves `value` toward `target` and answers the new value.
 *
 * Frame rate independent: a 60 Hz phone and a 120 Hz phone reach the same place after the
 * same amount of wall-clock time, because the step is an exponential of `dt`, not a fixed
 * fraction. Rising uses the short time constant, falling uses the long one.
 *
 * `dt` of 0 or less snaps straight to the target. That is what a single still frame wants.
 */
export function smoothLevel(
  value: number,
  target: number,
  dtSeconds: number,
): number {
  if (!(dtSeconds > 0)) return clamp01(target);
  const tau = target > value ? LEVEL_ATTACK_S : LEVEL_RELEASE_S;
  const next = value + (target - value) * (1 - Math.exp(-dtSeconds / tau));
  return clamp01(next);
}

/**
 * Turns a state and a smoothed level into the numbers one frame writes.
 *
 * The two turns are different in kind, not in degree. The agent's turn BREATHES: the orb
 * swells and settles with the speech. The user's turn HALOS: the orb holds its size and a
 * soft accent-coloured glow behind it brightens and spreads with the voice. Nobody has to
 * compare two sizes to tell who is talking.
 */
export function orbFrame(state: OrbState, level: number): OrbFrame {
  const loudness = clamp01(level);

  switch (state) {
    case 'agent':
      return {
        state,
        scale: 1 + AGENT_SCALE_RANGE * loudness,
        haloScale: 1.02,
        haloOpacity: AGENT_HALO_OPACITY,
      };

    case 'user':
      return {
        state,
        scale: 1 + USER_SCALE_RANGE * loudness,
        haloScale: mix(USER_HALO_SCALE.min, USER_HALO_SCALE.max, loudness),
        haloOpacity: mix(
          USER_HALO_OPACITY.min,
          USER_HALO_OPACITY.max,
          loudness,
        ),
      };

    default:
      // Idle, muted and ended. No halo, resting size. How drained the artwork looks is a
      // CSS job, keyed on `data-sphere-state`, because it is opacity and not movement.
      return { state, scale: 1, haloScale: 1, haloOpacity: 0 };
  }
}
