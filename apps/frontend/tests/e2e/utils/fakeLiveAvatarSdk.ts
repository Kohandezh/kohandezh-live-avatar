import type { Page } from '@playwright/test';

/**
 * Serves a stand-in for `@heygen/liveavatar-web-sdk` to the real browser.
 *
 * WHY THIS EXISTS
 * ---------------
 * `VITE_API_MOCK=true` only fakes our own backend. The real SDK still runs in
 * the browser, so a Playwright test could never reach a genuinely connected
 * conversation: the real SDK calls `https://api.liveavatar.com` with a fake
 * token and gets nowhere. That left the states that only exist mid-call
 * (the avatar speaking, the mute/end controls, the glass chrome drawn over a
 * live video) untestable in a browser.
 *
 * `useAssistantSession.ts` loads the SDK with a dynamic `import()`, and the
 * only other import of that package is `import type`, which is erased at
 * build time. So the dynamic import is the single runtime fetch, and Vite
 * serves it from `node_modules/.vite/<target>/deps/`. Intercepting that one
 * URL swaps the whole SDK without touching a line of product code.
 *
 * The event names, payload shapes and enum values below are copied from
 * `tests/utils/liveAvatarSdkMock.ts`, which the vitest suite already drives
 * the same hook with. Keep the two in step.
 *
 * The page gets a `window.__liveAvatar` handle to drive the session:
 *   await page.evaluate(() => window.__liveAvatar.emit('avatar.speak_started'));
 */

/** Matches the Vite pre-bundled dependency, whatever the app target or hash. */
const SDK_URL_GLOB = '**/@heygen_liveavatar-web-sdk.js*';

/** What the fake exposes on `window` so a test can drive a live session. */
export interface LiveAvatarHandle {
  /** Fires one provider event at every handler subscribed to it. */
  emit(event: string, payload?: unknown): void;
  /** How many sessions were stopped. Proves a route change really ended the call. */
  stopCount: number;
  /** Whether a session is currently open. */
  isOpen: boolean;
}

declare global {
  interface Window {
    __liveAvatar: LiveAvatarHandle;
  }
}

const MODULE_SOURCE = `
const SessionEvent = {
  SESSION_STATE_CHANGED: 'session.state_changed',
  SESSION_STREAM_READY: 'session.stream_ready',
  SESSION_CONNECTION_QUALITY_CHANGED: 'session.connection_quality_changed',
  SESSION_DISCONNECTED: 'session.disconnected',
};
const SessionState = {
  INACTIVE: 'INACTIVE',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  DISCONNECTING: 'DISCONNECTING',
  DISCONNECTED: 'DISCONNECTED',
};
const AgentEventsEnum = {
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
};
const AgentType = {
  FULL: 'FULL',
  OPENAI_REALTIME: 'OPENAI_REALTIME',
  ELEVENLABS_AGENT: 'ELEVENLABS_AGENT',
  GEMINI_REALTIME: 'GEMINI_REALTIME',
  UNKNOWN: 'UNKNOWN',
};
const VoiceChatState = { INACTIVE: 'INACTIVE', STARTING: 'STARTING', ACTIVE: 'ACTIVE' };
const VoiceChatEvent = { MUTED: 'MUTED', UNMUTED: 'UNMUTED', STATE_CHANGED: 'STATE_CHANGED' };
const ConnectionQuality = { UNKNOWN: 'UNKNOWN', GOOD: 'GOOD', BAD: 'BAD' };

/** The one live session, so window.__liveAvatar can reach its handlers. */
let current = null;

class Emitter {
  constructor() { this.handlers = new Map(); }
  on(event, handler) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }
  off(event, handler) {
    const list = this.handlers.get(event) ?? [];
    this.handlers.set(event, list.filter((h) => h !== handler));
    return this;
  }
  removeAllListeners() { this.handlers.clear(); return this; }
  emit(event, payload) {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

class FakeVoiceChat extends Emitter {
  constructor() {
    super();
    this.isMuted = false;
    // The granted path: the browser context grants the microphone and the
    // fake device answers, so the real hook's "mic never started" warning
    // must NOT fire. A test that wants that warning sets state itself.
    this.state = VoiceChatState.ACTIVE;
  }
  async start() { this.state = VoiceChatState.ACTIVE; this.isMuted = false; this.emit(VoiceChatEvent.UNMUTED); }
  async mute() { this.isMuted = true; this.emit(VoiceChatEvent.MUTED); }
  async unmute() { this.isMuted = false; this.emit(VoiceChatEvent.UNMUTED); }
}

class FakeSession extends Emitter {
  constructor(token, config) {
    super();
    this.token = token;
    this.config = config;
    this.voiceChat = new FakeVoiceChat();
    // Short enough that the hook never arms its keep-alive interval, which
    // would otherwise leave a timer running for the rest of the test.
    this.maxSessionDuration = 30;
    this.attached = null;
    current = this;
    window.__liveAvatar.isOpen = true;
  }
  async start() {
    // Reach "connected" the way the real SDK does: the stream-ready event is
    // what the hook actually trusts (see subscribe() in useAssistantSession).
    this.emit(SessionEvent.SESSION_STATE_CHANGED, SessionState.CONNECTED);
    this.emit(SessionEvent.SESSION_STREAM_READY);
  }
  async stop() {
    window.__liveAvatar.stopCount += 1;
    window.__liveAvatar.isOpen = false;
    if (current === this) current = null;
  }
  attach(element) { this.attached = element; }
  interrupt() { this.emit(AgentEventsEnum.AVATAR_SPEAK_ENDED); }
  async keepAlive() {}
  async sendText() {}
}

class LiveAvatarSession extends FakeSession {}
class ElevenLabsAgentSession extends FakeSession {}

function parseAgentTypeFromToken() { return AgentType.FULL; }

window.__liveAvatar = {
  stopCount: 0,
  isOpen: false,
  emit(event, payload) {
    if (!current) throw new Error('no live session to emit ' + event + ' on');
    current.emit(event, payload);
  },
};

export {
  SessionEvent, SessionState, AgentEventsEnum, AgentType,
  VoiceChatState, VoiceChatEvent, ConnectionQuality,
  LiveAvatarSession, ElevenLabsAgentSession, parseAgentTypeFromToken,
};
`;

/**
 * Swaps the real SDK for the fake above. Call before the page loads anything
 * that would start a conversation.
 */
export async function installFakeLiveAvatarSdk(page: Page): Promise<void> {
  // `window.__liveAvatar` has to exist before the module runs, because the
  // module's own top-level code writes to it.
  await page.route(SDK_URL_GLOB, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: MODULE_SOURCE,
    }),
  );

  // Nothing should ever leave the machine for the real provider. If the fake
  // ever fails to take, this makes that loud instead of slow and flaky.
  await page.route('https://api.liveavatar.com/**', (route) =>
    route.abort('failed'),
  );
}
