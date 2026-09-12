import { describe, expect, it } from 'vitest';
import {
  speechEnvelope,
  sphereState,
  sphereView,
  type SphereSignals,
} from '@/features/assistant/sphere';

function signals(overrides: Partial<SphereSignals> = {}): SphereSignals {
  return {
    status: 'connected',
    isUserSpeaking: false,
    isAvatarSpeaking: false,
    isMicMuted: false,
    ...overrides,
  };
}

describe('sphereState (requirement 17)', () => {
  it('is idle before the conversation connects', () => {
    expect(sphereState(signals({ status: 'idle' }))).toBe('idle');
    expect(sphereState(signals({ status: 'requesting' }))).toBe('idle');
    expect(sphereState(signals({ status: 'connecting' }))).toBe('idle');
  });

  it('is ended once the conversation is ending, ended, or failed', () => {
    expect(sphereState(signals({ status: 'ending' }))).toBe('ended');
    expect(sphereState(signals({ status: 'ended' }))).toBe('ended');
    expect(sphereState(signals({ status: 'error' }))).toBe('ended');
  });

  it('is user while connected, unmuted, and the user is speaking', () => {
    expect(sphereState(signals({ isUserSpeaking: true }))).toBe('user');
  });

  it('is agent while the avatar is speaking, even if the mic is muted', () => {
    expect(
      sphereState(
        signals({ isAvatarSpeaking: true, isMicMuted: true, isUserSpeaking: true }),
      ),
    ).toBe('agent');
  });

  it('is muted when the mic is off and nobody is speaking', () => {
    expect(sphereState(signals({ isMicMuted: true }))).toBe('muted');
  });

  it('is idle while connected with nothing happening', () => {
    expect(sphereState(signals())).toBe('idle');
  });

  it('the avatar speaking wins over the user speaking flag at the same time', () => {
    expect(
      sphereState(signals({ isAvatarSpeaking: true, isUserSpeaking: true })),
    ).toBe('agent');
  });

  it('ended overrides every other flag, since the conversation is already over', () => {
    expect(
      sphereState(
        signals({ status: 'ended', isAvatarSpeaking: true, isUserSpeaking: true }),
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
});

describe('sphereView (requirement 17: user swells, agent does not)', () => {
  it('the user branch swells the radius above its resting size', () => {
    const view = sphereView(signals({ isUserSpeaking: true }), null, 500);
    expect(view.state).toBe('user');
    expect(view.radiusScale).toBeGreaterThan(1);
    // The user's own colour, not a mix toward the agent's.
    expect(view.hueMix).toBe(0);
    expect(view.rings).toBe(false);
  });

  it('the agent branch holds its size instead of swelling with loudness', () => {
    // A loud avatar level (1) is the case most likely to swell the radius if the
    // agent branch behaved like the user branch. It must not.
    const loud = sphereView(signals({ isAvatarSpeaking: true }), 1, 500);
    const quiet = sphereView(signals({ isAvatarSpeaking: true }), 0, 500);

    expect(loud.state).toBe('agent');
    // The agent's radius formula (1 + 0.04 * level) never reaches what the
    // user's formula (1 + 0.18 * level) does at any level above zero.
    expect(loud.radiusScale).toBeLessThan(1.1);
    expect(loud.radiusScale).toBeGreaterThanOrEqual(quiet.radiusScale);
    expect(loud.hueMix).toBe(1);
  });

  it('only the agent branch produces rings', () => {
    expect(sphereView(signals({ isAvatarSpeaking: true }), 0.5, 0).rings).toBe(
      true,
    );
    expect(sphereView(signals({ isUserSpeaking: true }), null, 0).rings).toBe(
      false,
    );
    expect(sphereView(signals(), null, 0).rings).toBe(false);
    expect(sphereView(signals({ isMicMuted: true }), null, 0).rings).toBe(
      false,
    );
  });

  it('falls back to the synthetic envelope when no avatar level was measured', () => {
    // `avatarLevel` is null exactly when no analyser could be built (a blocked
    // AudioContext, for example). The agent branch must still produce a level,
    // not crash or silently draw a zero.
    const view = sphereView(signals({ isAvatarSpeaking: true }), null, 750);
    expect(view.level).toBeGreaterThanOrEqual(0);
    expect(view.level).toBeLessThanOrEqual(1);
  });

  it('the muted branch drains colour and calms the motion instead of turning red', () => {
    const view = sphereView(signals({ isMicMuted: true }), null, 0);
    expect(view.state).toBe('muted');
    expect(view.saturation).toBeLessThan(1);
    expect(view.rings).toBe(false);
  });

  it('the ended branch fades the sphere down to a calm, drained look', () => {
    const view = sphereView(signals({ status: 'ended' }), null, 0);
    expect(view.state).toBe('ended');
    expect(view.alpha).toBeLessThan(1);
    expect(view.saturation).toBeLessThan(1);
  });
});
