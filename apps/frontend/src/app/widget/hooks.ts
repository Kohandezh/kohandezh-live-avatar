import { useEffect, useSyncExternalStore, type RefObject } from 'react';

/** One step below Tailwind's `sm` breakpoint (40rem). Below it the panel is a full sheet. */
const PHONE_QUERY = '(max-width: 639px)';

function subscribeToPhoneQuery(onChange: () => void): () => void {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * True while the viewport is phone sized. The panel is a modal sheet there and a small
 * anchored card on wider screens, and the two need different ARIA.
 */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribeToPhoneQuery,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'video[controls]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Keeps Tab inside `ref` while `active` is true.
 *
 * A full-screen sheet on a phone is a modal dialog, so tabbing must not walk into the
 * customer's page behind it. The widget lives in a Shadow DOM, where the focused element is
 * on the shadow root, not on `document`.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    const node = ref.current;
    if (!active || !node) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !node) return;

      const items = Array.from(
        node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      const root = node.getRootNode();
      const focused =
        root instanceof ShadowRoot
          ? root.activeElement
          : document.activeElement;

      if (event.shiftKey && (focused === first || focused === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault();
        first.focus();
      }
    }

    node.addEventListener('keydown', handleKeyDown);
    return () => node.removeEventListener('keydown', handleKeyDown);
  }, [ref, active]);
}
