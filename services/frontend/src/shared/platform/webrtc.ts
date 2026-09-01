import { isNative, platformName } from './isNative';

export interface WebRtcCapabilities {
  platform: 'web' | 'ios' | 'android';
  native: boolean;
  /** RTCPeerConnection exists. Required by LiveKit for any media. */
  peerConnection: boolean;
  /** Secure context (https or localhost). Browsers block media APIs otherwise. */
  secureContext: boolean;
  /** Web Audio is needed to preview raw PCM assets. */
  webAudio: boolean;
  /**
   * Native WebViews are NOT assumed to behave like desktop browsers. A Capacitor build must be
   * validated explicitly for WebView -> WebRTC -> LiveKit -> media permissions before it counts.
   */
  requiresNativeValidation: boolean;
}

export function getWebRtcCapabilities(): WebRtcCapabilities {
  const w = typeof window === 'undefined' ? undefined : window;
  const native = isNative();
  return {
    platform: platformName(),
    native,
    peerConnection: !!w && 'RTCPeerConnection' in w,
    secureContext: !!w && (w.isSecureContext ?? false),
    webAudio: !!w && ('AudioContext' in w || 'webkitAudioContext' in w),
    requiresNativeValidation: native,
  };
}
