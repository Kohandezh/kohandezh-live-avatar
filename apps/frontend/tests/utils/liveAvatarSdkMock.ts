/**
 * A tiny stand-in for `@heygen/liveavatar-web-sdk`.
 *
 * Tests must never reach the real LiveAvatar service, and the real SDK pulls in LiveKit,
 * which needs WebRTC. The fake emits the same event names with the same payload shapes, so a
 * test can drive the hook through every state.
 *
 * Use it like this:
 *   vi.mock('@heygen/liveavatar-web-sdk', async () => {
 *     const mock = await import('@tests/utils/liveAvatarSdkMock');
 *     return mock.createLiveAvatarSdkMockModule();
 *   });
 */

export const SessionEvent = {
  SESSION_STATE_CHANGED: 'session.state_changed',
  SESSION_STREAM_READY: 'session.stream_ready',
  SESSION_CONNECTION_QUALITY_CHANGED: 'session.connection_quality_changed',
  SESSION_DISCONNECTED: 'session.disconnected',
} as const;

export const SessionState = {
  INACTIVE: 'INACTIVE',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  DISCONNECTING: 'DISCONNECTING',
  DISCONNECTED: 'DISCONNECTED',
} as const;

export const AgentEventsEnum = {
  USER_SPEAK_STARTED: 'user.speak_started',
  USER_SPEAK_ENDED: 'user.speak_ended',
  USER_TRANSCRIPTION: 'user.transcription',
  USER_TRANSCRIPTION_CHUNK: 'user.transcription.chunk',
  AVATAR_TRANSCRIPTION: 'avatar.transcription',
  AVATAR_TRANSCRIPTION_CHUNK: 'avatar.transcription.chunk',
  AVATAR_SPEAK_STARTED: 'avatar.speak_started',
  AVATAR_SPEAK_ENDED: 'avatar.speak_ended',
  SESSION_STOPPED: 'session.stopped',
} as const;

export const VoiceChatEvent = {
  MUTED: 'MUTED',
  UNMUTED: 'UNMUTED',
  STATE_CHANGED: 'STATE_CHANGED',
} as const;

export const ConnectionQuality = {
  UNKNOWN: 'UNKNOWN',
  GOOD: 'GOOD',
  BAD: 'BAD',
} as const;

type Handler = (payload: never) => void;

class FakeEmitter {
  private readonly handlers = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): this {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(event, set);
    return this;
  }

  off(event: string, handler: Handler): this {
    this.handlers.get(event)?.delete(handler);
    return this;
  }

  removeAllListeners(): this {
    this.handlers.clear();
    return this;
  }

  emit(event: string, payload?: unknown): void {
    for (const handler of [...(this.handlers.get(event) ?? [])]) {
      (handler as (value: unknown) => void)(payload);
    }
  }

  get listenerCount(): number {
    let total = 0;
    for (const set of this.handlers.values()) total += set.size;
    return total;
  }
}

class FakeVoiceChat extends FakeEmitter {
  isMuted = false;

  async mute(): Promise<void> {
    if (sdkState.muteError) throw sdkState.muteError;
    this.isMuted = true;
    this.emit(VoiceChatEvent.MUTED);
  }

  async unmute(): Promise<void> {
    if (sdkState.muteError) throw sdkState.muteError;
    this.isMuted = false;
    this.emit(VoiceChatEvent.UNMUTED);
  }
}

/** What the tests set up before a run and assert afterwards. */
export const sdkState = {
  /** Thrown by `start()` when set. */
  startError: null as Error | null,
  /** Thrown by `mute()` and `unmute()` when set, like a denied microphone. */
  muteError: null as Error | null,
  startCount: 0,
  stopCount: 0,
  attachCount: 0,
  interruptCount: 0,
  keepAliveCount: 0,
};

export class FakeLiveAvatarSession extends FakeEmitter {
  static instances: FakeLiveAvatarSession[] = [];

  readonly voiceChat = new FakeVoiceChat();
  readonly sessionId = 'mock-provider-session';
  maxSessionDuration: number | null = 60;

  constructor(
    readonly sessionToken: string,
    readonly config?: unknown,
  ) {
    super();
    FakeLiveAvatarSession.instances.push(this);
  }

  async start(): Promise<void> {
    sdkState.startCount += 1;
    if (sdkState.startError) throw sdkState.startError;
  }

  async stop(): Promise<void> {
    sdkState.stopCount += 1;
  }

  async keepAlive(): Promise<void> {
    sdkState.keepAliveCount += 1;
  }

  attach(): void {
    sdkState.attachCount += 1;
  }

  interrupt(): void {
    sdkState.interruptCount += 1;
  }

  message(): string {
    return 'mock-typed-turn';
  }
}

export function lastFakeSession(): FakeLiveAvatarSession {
  const session = FakeLiveAvatarSession.instances.at(-1);
  if (!session) throw new Error('No LiveAvatarSession was created.');
  return session;
}

export function resetLiveAvatarSdkMock(): void {
  FakeLiveAvatarSession.instances = [];
  sdkState.startError = null;
  sdkState.muteError = null;
  sdkState.startCount = 0;
  sdkState.stopCount = 0;
  sdkState.attachCount = 0;
  sdkState.interruptCount = 0;
  sdkState.keepAliveCount = 0;
}

export function createLiveAvatarSdkMockModule() {
  return {
    LiveAvatarSession: FakeLiveAvatarSession,
    SessionEvent,
    SessionState,
    AgentEventsEnum,
    VoiceChatEvent,
    ConnectionQuality,
  };
}
