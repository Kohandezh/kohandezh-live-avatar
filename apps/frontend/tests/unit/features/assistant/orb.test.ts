import { describe, expect, it } from 'vitest';
import {
  AGENT_SCALE_RANGE,
  LEVEL_ATTACK_S,
  LEVEL_RELEASE_S,
  ORB_HUE_SHIFT_DEG,
  USER_SCALE_RANGE,
  levelTarget,
  orbFrame,
  orbState,
  smoothLevel,
  speechEnvelope,
  type OrbSignals,
} from '@/features/assistant/orb';

function signals(overrides: Partial<OrbSignals> = {}): OrbSignals {
  return {
    status: 'connected',
    isUserSpeaking: false,
    isAvatarSpeaking: false,
    isMicMuted: false,
    ...overrides,
  };
}

describe('orbState (requirement 17)', () => {
  it('is idle before the conversation connects', () => {
    expect(orbState(signals({ status: 'idle' }))).toBe('idle');
    expect(orbState(signals({ status: 'requesting' }))).toBe('idle');
    expect(orbState(signals({ status: 'connecting' }))).toBe('idle');
  });

  it('is ended once the conversation is ending, ended, or failed', () => {
    expect(orbState(signals({ status: 'ending' }))).toBe('ended');
    expect(orbState(signals({ status: 'ended' }))).toBe('ended');
    expect(orbState(signals({ status: 'error' }))).toBe('ended');
  });

  it('is user while connected, unmuted, and the user is speaking', () => {
    expect(orbState(signals({ isUserSpeaking: true }))).toBe('user');
  });

  it('is agent while the avatar is speaking, even if the mic is muted', () => {
    expect(
      orbState(
        signals({
          isAvatarSpeaking: true,
          isMicMuted: true,
          isUserSpeaking: true,
        }),
      ),
    ).toBe('agent');
  });

  it('is muted when the mic is off and nobody is speaking', () => {
    expect(orbState(signals({ isMicMuted: true }))).toBe('muted');
  });

  it('is idle while connected with nothing happening', () => {
    expect(orbState(signals())).toBe('idle');
  });

  it('ended overrides every other flag, since the conversation is already over', () => {
    expect(
      orbState(
        signals({
          status: 'ended',
          isAvatarSpeaking: true,
          isUserSpeaking: true,
        }),
      ),
    ).toBe('ended');
  });
});

describe('speechEnvelope', () => {
  it('is deterministic: the same instant always produces the same value', () => {
    expect(speechEnvelope(1234)).toBe(speechEnvelope(1234));
    expect(speechEnvelope(987_654)).toBe(speechEnvelope(987_654));
  });

  it('always stays inside the 0 to 1 range it promises', () => {
    for (let ms = 0; ms < 5000; ms += 137) {
      const value = speechEnvelope(ms);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('actually moves, so a fallback orb never looks frozen', () => {
    const samples = Array.from({ length: 60 }, (_, i) =>
      speechEnvelope(i * 33),
    );
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.3);
  });
});

describe('levelTarget', () => {
  it('uses the measured avatar level while the agent speaks', () => {
    expect(levelTarget(signals({ isAvatarSpeaking: true }), 0.42, 500)).toBe(
      0.42,
    );
  });

  it('treats a measured zero as real silence, not as a missing reading', () => {
    // A quiet moment between two words reads 0. If that were confused with "no
    // analyser" the orb would start puffing on its own in every gap.
    expect(levelTarget(signals({ isAvatarSpeaking: true }), 0, 500)).toBe(0);
  });

  it('falls back to the synthetic envelope when no level could be measured', () => {
    // Null is what `useAvatarAudioLevel` returns when the browser refuses the
    // AudioContext. The orb still has to look alive.
    const at = 777;
    expect(levelTarget(signals({ isAvatarSpeaking: true }), null, at)).toBe(
      speechEnvelope(at),
    );
  });

  it('clamps a level above 1 that a noisy analyser could hand back', () => {
    expect(levelTarget(signals({ isAvatarSpeaking: true }), 4, 0)).toBe(1);
  });

  it('uses the synthetic envelope for the user, who has no measurable level', () => {
    const at = 321;
    expect(levelTarget(signals({ isUserSpeaking: true }), 0.9, at)).toBe(
      speechEnvelope(at),
    );
  });

  it('rests at zero when nobody holds the turn', () => {
    expect(levelTarget(signals(), null, 400)).toBe(0);
    expect(levelTarget(signals({ isMicMuted: true }), null, 400)).toBe(0);
    expect(levelTarget(signals({ status: 'ended' }), 1, 400)).toBe(0);
    expect(levelTarget(signals({ status: 'connecting' }), 1, 400)).toBe(0);
  });
});

describe('smoothLevel', () => {
  it('snaps to the target when no time passed, which is what a still frame wants', () => {
    expect(smoothLevel(0, 0.8, 0)).toBe(0.8);
    expect(smoothLevel(0.9, 0.1, -1)).toBe(0.1);
  });

  it('rises faster than it falls, so syllables show and gaps do not collapse it', () => {
    const step = 1 / 60;
    const up = smoothLevel(0, 1, step);
    const down = 1 - smoothLevel(1, 0, step);
    expect(up).toBeGreaterThan(down);
  });

  it('reaches about 63 percent of the way after one attack time constant', () => {
    // That is what the exponential promises: 1 - 1/e after one tau.
    const value = smoothLevel(0, 1, LEVEL_ATTACK_S);
    expect(value).toBeCloseTo(1 - Math.exp(-1), 5);
  });

  it('reaches about 63 percent of the way back after one release time constant', () => {
    const value = smoothLevel(1, 0, LEVEL_RELEASE_S);
    expect(value).toBeCloseTo(Math.exp(-1), 5);
  });

  it('is frame rate independent: many small steps land where one big step lands', () => {
    // A 120 Hz phone takes twice as many steps as a 60 Hz phone over the same
    // half second, and both must end up at the same size.
    const total = 0.5;
    let fast = 0;
    for (let i = 0; i < 60; i += 1) fast = smoothLevel(fast, 1, total / 60);
    let slow = 0;
    for (let i = 0; i < 30; i += 1) slow = smoothLevel(slow, 1, total / 30);
    expect(fast).toBeCloseTo(slow, 3);
  });

  it('never leaves the 0 to 1 range, whatever it is handed', () => {
    expect(smoothLevel(0, 5, 0.016)).toBeLessThanOrEqual(1);
    expect(smoothLevel(0.5, -3, 0.016)).toBeGreaterThanOrEqual(0);
    expect(smoothLevel(Number.NaN, 0.5, 0)).toBe(0.5);
  });

  it('settles on the target instead of oscillating around it', () => {
    let value = 0;
    for (let i = 0; i < 200; i += 1) value = smoothLevel(value, 0.6, 1 / 60);
    expect(value).toBeCloseTo(0.6, 4);
  });
});

describe('orbFrame (the agent breathes, the user halos)', () => {
  it('grows the agent orb with loudness, inside the subtle 1 to 1.08 budget', () => {
    expect(orbFrame('agent', 0).scale).toBe(1);
    expect(orbFrame('agent', 1).scale).toBeCloseTo(1 + AGENT_SCALE_RANGE, 6);
    expect(orbFrame('agent', 0.5).scale).toBeGreaterThan(
      orbFrame('agent', 0.2).scale,
    );
    // The whole point of "breathing, not bouncing".
    expect(orbFrame('agent', 1).scale).toBeLessThanOrEqual(1.08);
  });

  it('gives the user a halo instead of size, so the two turns differ in kind', () => {
    const quiet = orbFrame('user', 0);
    const loud = orbFrame('user', 1);

    // The halo carries the user's voice.
    expect(loud.haloOpacity).toBeGreaterThan(quiet.haloOpacity);
    expect(loud.haloScale).toBeGreaterThan(quiet.haloScale);

    // The size barely moves, and never as far as the agent's does.
    expect(loud.scale).toBeCloseTo(1 + USER_SCALE_RANGE, 6);
    expect(loud.scale).toBeLessThan(orbFrame('agent', 1).scale);
  });

  it('never lets the loud user look like the loud agent on either cue', () => {
    const user = orbFrame('user', 1);
    const agent = orbFrame('agent', 1);
    expect(agent.scale).toBeGreaterThan(user.scale);
    expect(user.haloOpacity).toBeGreaterThan(agent.haloOpacity);
  });

  it('rests the quiet states at their resting size with no halo', () => {
    for (const state of ['idle', 'muted', 'ended'] as const) {
      const frame = orbFrame(state, 1);
      expect(frame.scale).toBe(1);
      expect(frame.haloOpacity).toBe(0);
    }
  });

  it('clamps a level outside 0 to 1 rather than overshooting the scale', () => {
    expect(orbFrame('agent', 9).scale).toBeCloseTo(1 + AGENT_SCALE_RANGE, 6);
    expect(orbFrame('agent', -2).scale).toBe(1);
  });

  it('carries the state through, since the wrapper publishes it as data-sphere-state', () => {
    expect(orbFrame('muted', 0).state).toBe('muted');
  });
});

describe('the artwork is not repainted', () => {
  it('ships with the hue shift off', () => {
    // The artwork is the user's own. The constant exists so the choice can be tried
    // in one line, not so it can be shipped on by accident.
    expect(ORB_HUE_SHIFT_DEG).toBe(0);
  });
});
