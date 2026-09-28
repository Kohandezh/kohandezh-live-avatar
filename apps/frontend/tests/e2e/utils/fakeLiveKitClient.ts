import type { Page } from '@playwright/test';

/**
 * Serves a stand-in for `livekit-client` to the real browser.
 *
 * WHY THIS EXISTS
 * ---------------
 * `VITE_API_MOCK=true` fakes our own backend, including the recording chain, but the Record
 * answer screen still joins the avatar's LiveKit room with the real SDK after the session starts
 * (`src/features/avatar-session/livekitRoom.ts`). The mock hands out a room address that does not
 * exist, so the real SDK fails, the session never connects, and every state after it (recording,
 * the finalize job, Save and Attach) could not be reached in a browser.
 *
 * Vite serves the pre-bundled dependency from `node_modules/.vite/<target>/deps/`, the same way
 * `fakeLiveAvatarSdk.ts` swaps the LiveAvatar SDK. Intercepting that one URL replaces the SDK
 * without touching a line of product code. The fake connects at once and never sends a track,
 * so the video area keeps its "waiting for avatar video" state.
 *
 * It covers only what `livekitRoom.ts` uses: `Room` (`on`, `connect`, `disconnect`,
 * `removeAllListeners`, `startAudio`, `canPlaybackAudio`, `remoteParticipants`, `state`),
 * `RoomEvent`, `Track` and `ConnectionState`.
 */

/** Matches the Vite pre-bundled dependency, whatever the app target or hash. */
const SDK_URL_GLOB = '**/livekit-client.js*';

const MODULE_SOURCE = `
const ConnectionState = {
  Disconnected: 'disconnected',
  Connecting: 'connecting',
  Connected: 'connected',
  Reconnecting: 'reconnecting',
};
const RoomEvent = new Proxy({}, { get: (_target, name) => String(name) });
const Track = { Kind: { Audio: 'audio', Video: 'video' } };

class Room {
  constructor() {
    this.state = ConnectionState.Disconnected;
    this.remoteParticipants = new Map();
    this.canPlaybackAudio = true;
    this.handlers = new Map();
  }
  on(event, handler) {
    this.handlers.set(event, [...(this.handlers.get(event) || []), handler]);
    return this;
  }
  removeAllListeners() {
    this.handlers.clear();
    return this;
  }
  async connect() {
    this.state = ConnectionState.Connected;
  }
  async disconnect() {
    this.state = ConnectionState.Disconnected;
  }
  async startAudio() {}
}

export { ConnectionState, Room, RoomEvent, Track };
`;

/** Call before the page loads the app. */
export async function installFakeLiveKitClient(page: Page): Promise<void> {
  await page.route(SDK_URL_GLOB, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: MODULE_SOURCE,
    }),
  );
}
