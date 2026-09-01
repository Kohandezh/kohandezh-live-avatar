import { isNative } from './isNative';

export type PushPermission = 'granted' | 'denied' | 'prompt';

export async function requestPushPermission(): Promise<PushPermission> {
  if (isNative()) {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const result = await PushNotifications.requestPermissions();
    return result.receive === 'granted' ? 'granted' : result.receive === 'denied' ? 'denied' : 'prompt';
  }
  if (!('Notification' in window)) return 'denied';
  const result = await Notification.requestPermission();
  return result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'prompt';
}

/** Returns a device push token on native; null on web (use Web Push via your own service worker). */
export async function registerForPush(): Promise<string | null> {
  if (!isNative()) return null;
  const { PushNotifications } = await import('@capacitor/push-notifications');
  return new Promise((resolve) => {
    void PushNotifications.addListener('registration', (t) => resolve(t.value));
    void PushNotifications.addListener('registrationError', () => resolve(null));
    void PushNotifications.register();
  });
}
