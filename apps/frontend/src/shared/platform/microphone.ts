/**
 * Microphone permission handling.
 *
 * `getUserMedia` is the correct call everywhere this app runs today: on the
 * web, in the Capacitor Android WebView (its `BridgeWebChromeClient` forwards
 * the request to the native runtime-permission dialog), and in iOS WKWebView.
 * There is exactly one implementation, so this file has no interface split.
 *
 * Capacitor follow-up, not needed today: neither `android/` nor `ios/`
 * exists yet. When `npx cap add android|ios` runs, add `RECORD_AUDIO` and
 * `MODIFY_AUDIO_SETTINGS` to `AndroidManifest.xml` and
 * `NSMicrophoneUsageDescription` to `Info.plist`. No Capacitor plugin needed.
 */

export type MicPermissionState =
  | 'unknown'
  | 'prompt'
  | 'granted'
  | 'denied'
  | 'unavailable';

/**
 * Non-invasive hint, for copy decisions only. Never shows a prompt.
 * Returns 'unknown' when the browser has no Permissions API, or when it does
 * but keeps reporting 'prompt' after a persistent denial (Safari does this).
 * `requestMicrophonePermission` (real `getUserMedia`) is the only real truth.
 */
export async function checkMicrophonePermission(): Promise<MicPermissionState> {
  try {
    const status = await navigator.permissions?.query({ name: 'microphone' });

    if (status?.state === 'granted') return 'granted';
    if (status?.state === 'denied') return 'denied';
    if (status?.state === 'prompt') return 'prompt';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * The real gate. MUST be called from inside a user gesture: on iOS Safari,
 * and inside a standalone PWA, `getUserMedia` called outside one can be
 * silently ignored.
 *
 * Stops every returned track immediately. Leaving the stream open keeps the
 * OS recording indicator lit, which reads as a bug.
 */
export async function requestMicrophonePermission(): Promise<MicPermissionState> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return 'granted';
  } catch (error) {
    return mapGetUserMediaError(error);
  }
}

function mapGetUserMediaError(error: unknown): MicPermissionState {
  const name = error instanceof DOMException ? error.name : undefined;

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'unavailable';
    case 'NotReadableError':
    case 'AbortError':
      // Device busy or failed to start. The recovery is "try again", not
      // "change your browser settings", so this is not `denied`.
      return 'unavailable';
    default:
      return 'unknown';
  }
}
