import { Capacitor } from '@capacitor/core';

export type RuntimePlatform = 'web' | 'ios' | 'android';

/**
 * The runtime platform is different from the build target:
 * - build target (mobile/web/admin) is decided at build time (vite.config.ts).
 * - runtime platform tells whether the code runs inside a native shell.
 */
export function getPlatform(): RuntimePlatform {
  return Capacitor.getPlatform() as RuntimePlatform;
}

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export type { CameraService } from './camera';
export type { DeepLinkService } from './deepLink';
export type { HapticsService } from './haptics';
export * from './microphone';
export type { NotificationService } from './notifications';
export type { ShareService } from './share';
