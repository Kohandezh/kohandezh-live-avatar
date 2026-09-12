import { useLayoutEffect } from 'react';
import { useReduceTransparency, useTheme } from './hooks';

type ResolvedTheme = 'light' | 'dark';

/**
 * The browser chrome colour per resolved theme.
 *
 * `light` is the hex of the app accent, oklch(58% 0.215 308), declared in
 * `src/styles/globals.css`. `dark` is a near-black matching the app's dark ground; it is
 * unchanged by the accent work.
 *
 * These two strings must stay byte for byte identical to the values the anti-FOUC script writes
 * in `src/app/{mobile,web,admin}/index.html`. That script sets the meta before first paint and
 * this component rewrites it on the first client render; if the two disagree, the browser chrome
 * flashes the old colour.
 */
const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#9e49d9',
  dark: '#0b0b0e',
};

function resolveTheme(mode: 'light' | 'dark' | 'system'): ResolvedTheme {
  if (mode !== 'system') return mode;
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolved);
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;

  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLOR[resolved]);
}

/**
 * Redux owns the theme (`ThemeMode`: 'light' | 'dark' | 'system'). This
 * component resolves 'system' and pushes the result onto <html> so HeroUI's
 * `dark:` variant and the `glass` utility both pick it up.
 *
 * Do not call HeroUI's own `useTheme`: it keeps a separate `heroui-theme`
 * localStorage key and would fork theme state away from Redux.
 *
 * `useLayoutEffect`, not `useEffect`: applying the theme after paint would
 * flash the previous theme on every client-side route change.
 *
 * Mounted once in `src/app/providers.tsx`, next to `<LanguageSync />`.
 */
export function ThemeSync() {
  const [theme] = useTheme();
  const [reduceTransparency] = useReduceTransparency();

  useLayoutEffect(() => {
    applyTheme(resolveTheme(theme));

    if (theme !== 'system') return;

    const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;

    const onChange = () => applyTheme(resolveTheme(theme));
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  useLayoutEffect(() => {
    // Safari and iOS never fire `prefers-reduced-transparency`, so this
    // attribute is the only way those platforms can turn off the glass.
    document.documentElement.dataset.reduceTransparency =
      String(reduceTransparency);
  }, [reduceTransparency]);

  return null;
}
