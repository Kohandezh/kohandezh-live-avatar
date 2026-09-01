import type { CapacitorConfig } from '@capacitor/cli';

// Native shells (android/, ios/) are generated with `npx cap add android|ios` and are gitignored.
// They are NOT part of Phase 1: this file only keeps the web bundle Capacitor-compatible.
//
// Before a native build can be validated the following must be verified explicitly:
//   Capacitor WebView -> WebRTC -> LiveKit -> microphone/media permissions
// Browser WebRTC behaviour is not assumed to be identical inside a native WebView.
//
// A native build cannot use the same-origin `/api` default: build it with an absolute
// VITE_API_BASE_URL (for example https://live.kohandezh.com/api) in `.env.production.local`.
const config: CapacitorConfig = {
  appId: 'com.kohandezh.liveavatar',
  appName: 'Live Avatar',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
