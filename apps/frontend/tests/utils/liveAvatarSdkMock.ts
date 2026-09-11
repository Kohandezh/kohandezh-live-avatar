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
  ELEVENLABS_AGENT_EVENT: 'elevenlabs_agent_event',
  SESSION_STOPPED: 'session.stopped',
} as const;

export const AgentType = {
  FULL: 'FULL',
  OPENAI_REALTIME: 'OPENAI_REALTIME',
  ELEVENLABS_AGENT: 'ELEVENLABS_AGENT',
  GEMINI_REALTIME: 'GEMINI_REALTIME',
  UNKNOWN: 'UNKNOWN',
} as const;

export const VoiceChatState = {
  INACTIVE: 'INACTIVE',
  STARTING: 'STARTING',
  ACTIVE: 'ACTIVE',
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
  /** Like the real SDK: no microphone track means muted. */
  isMuted = true;
  state: string = VoiceChatState.INACTIVE;

  /** The real `start()` is what asks the browser for the microphone. */
  async start(config: { defaultMuted?: boolean } = {}): Promise<void> {
    if (sdkState.micError) throw sdkState.micError;
    this.state = VoiceChatState.ACTIVE;
    this.isMuted = config.defaultMuted === true;
    this.emit(this.isMuted ? VoiceChatEvent.MUTED : VoiceChatEvent.UNMUTED);
  }

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

let elevenLabsEventCounter = 0;

/** What the tests set up before a run and assert afterwards. */
export const sdkState = {
  /** Thrown by `start()` when set. */
  startError: null as Error | null,
  /** Holds `start()` open, so a test can watch what happens before it resolves. */
  startGate: null as Promise<void> | null,
  /** Thrown by `mute()` and `unmute()` when set, like a denied microphone. */
  muteError: null as Error | null,
  /** Thrown by `voiceChat.start()` when set. The real SDK swallows it during `start()`. */
  micError: null as Error | null,
  /** What `parseAgentTypeFromToken` answers. Decides which session class the hook builds. */
  agentType: AgentType.FULL as (typeof AgentType)[keyof typeof AgentType],
  sentUserMessages: [] as string[],
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
    if (sdkState.startGate) await sdkState.startGate;
    // The real SDK starts the voice chat inside `start()` and only warns when it fails.
    try {
      await this.voiceChat.start({ defaultMuted: false });
    } catch {
      // Same as the SDK: the conversation still runs, the avatar just cannot hear.
    }
  }

  /** Emits one ElevenLabs agent event, in the shape the SDK forwards it. */
  emitElevenLabsEvent(
    elevenLabsEventType: string,
    data: Record<string, unknown>,
    eventId = `el-${(elevenLabsEventCounter += 1)}`,
  ): void {
    this.emit(AgentEventsEnum.ELEVENLABS_AGENT_EVENT, {
      event_id: eventId,
      event_type: AgentEventsEnum.ELEVENLABS_AGENT_EVENT,
      elevenlabs_event_type: elevenLabsEventType,
      data,
    });
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

/** The Persian path: same lifecycle, a different way to send a typed turn. */
export class FakeElevenLabsAgentSession extends FakeLiveAvatarSession {
  message(): string {
    throw new Error('message() is not supported on ElevenLabsAgentSession');
  }

  sendUserMessage(text: string): string {
    sdkState.sentUserMessages.push(text);
    return `mock-user-message-${sdkState.sentUserMessages.length}`;
  }
}

export function parseAgentTypeFromToken(): string {
  return sdkState.agentType;
}

export function lastFakeSession(): FakeLiveAvatarSession {
  const session = FakeLiveAvatarSession.instances.at(-1);
  if (!session) throw new Error('No LiveAvatarSession was created.');
  return session;
}

export function resetLiveAvatarSdkMock(): void {
  FakeLiveAvatarSession.instances = [];
  elevenLabsEventCounter = 0;
  sdkState.startError = null;
  sdkState.startGate = null;
  sdkState.muteError = null;
  sdkState.micError = null;
  sdkState.agentType = AgentType.FULL;
  sdkState.sentUserMessages = [];
  sdkState.startCount = 0;
  sdkState.stopCount = 0;
  sdkState.attachCount = 0;
  sdkState.interruptCount = 0;
  sdkState.keepAliveCount = 0;
}

export function createLiveAvatarSdkMockModule() {
  return {
    LiveAvatarSession: FakeLiveAvatarSession,
    ElevenLabsAgentSession: FakeElevenLabsAgentSession,
    parseAgentTypeFromToken,
    AgentType,
    SessionEvent,
    SessionState,
    AgentEventsEnum,
    VoiceChatEvent,
    VoiceChatState,
    ConnectionQuality,
  };
}
