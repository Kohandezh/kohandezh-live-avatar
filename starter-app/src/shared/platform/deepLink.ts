import { isNative } from './isNative';

/**
 * Native: listen for app URL opens and hand the path to the router.
 * Web: nothing to do — the browser already routes URLs.
 */
export function initDeepLinks(onPath: (path: string) => void): void {
  if (!isNative()) return;
  void import('@capacitor/app').then(({ App }) => {
    void App.addListener('appUrlOpen', ({ url }) => {
      try {
        const u = new URL(url);
        onPath(u.pathname + u.search + u.hash);
      } catch {
        /* ignore malformed */
      }
    });
  });
}
