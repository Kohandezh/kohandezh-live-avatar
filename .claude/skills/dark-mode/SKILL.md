---
name: dark-mode
description: Light and dark mode in this app. Redux owns a three-way ThemeMode (light, dark, system), ThemeSync writes it to <html>, and an anti-FOUC script applies it before first paint. Load before adding a dark-mode rule, changing a colour that must differ per theme, touching ThemeSync or the anti-FOUC script, or giving a new surface a theme.
---

# Light and dark mode

## What actually exists

This app has a real, app-wide theme system. Three parts, and they must stay in step.

1. **Redux owns the mode.** `ThemeMode` is `'light' | 'dark' | 'system'` (`src/features/settings/settingsSlice.ts`). It is client-owned global state (ADR 0003), persisted to `localStorage` under the `settings` key.
2. **`ThemeSync` resolves and applies it** (`src/features/settings/ThemeSync.tsx`). It is mounted once in `src/app/providers.tsx`, next to `LanguageSync`.
3. **An anti-FOUC script applies it before first paint** in `src/app/{mobile,web,admin}/index.html`.

The user changes it on the appearance screen (`src/pages/settings/AppearancePage.tsx`).

## What `ThemeSync` writes on `<html>`

```text
class="light"  or  class="dark"     (the old one removed first)
data-theme="light" | "dark"
style.colorScheme = "light" | "dark"
<meta name="theme-color" content=...>
--glass-reduce: <0 to 1>
data-reduce-transparency: "true" | "false"
```

**Both the class and the attribute, always.** App CSS never relies on `prefers-color-scheme`. `globals.css` redeclares HeroUI's `dark` variant keyed on the class and the attribute:

```css
@custom-variant dark (&:is(.dark, .dark *, [data-theme='dark'], [data-theme='dark'] *));
```

Two reasons it is there: `@heroui/styles@3.2.5` ships a broken media-query branch for its own `dark:` variant, and a user whose OS is dark but who chose light in the app must get light. It uses `:is(...)`, not `:where(...)`, because `:where()` has zero specificity and every `dark:` utility would lose to a plain utility of the same property. It must stay **after** both `@import` lines, or HeroUI's own definition wins.

## The rules

### Use tokens, not `dark:`

The HeroUI semantic tokens already resolve per theme. `bg-surface` is the right surface in both modes. Reach for a `dark:` utility only when a value genuinely has to differ beyond what a token gives. There are five `dark:` rules in `globals.css` today, and that number should stay small.

If you find yourself writing `dark:bg-slate-900`, you wanted `bg-surface`.

### `system` is a real third state

`resolveTheme` maps `'system'` through `matchMedia('(prefers-color-scheme: dark)')`, and `ThemeSync` subscribes to that media query **only while the mode is `system`**. Code that assumes the theme is a boolean breaks the OS-follows case. Read the resolved value from `<html>`, or read the mode from Redux and resolve it the same way.

### Do not call HeroUI's `useTheme`

It keeps its own `heroui-theme` localStorage key and would fork theme state away from Redux. Use `useTheme` from `src/features/settings/hooks.ts`.

### `useLayoutEffect`, not `useEffect`

Applying the theme after paint flashes the previous theme on every client-side route change. `ThemeSync` uses `useLayoutEffect` for that reason. Keep it.

### The two theme-color strings must match byte for byte

`THEME_COLOR` in `ThemeSync.tsx` and the string the anti-FOUC script writes in each `index.html` are the same values in two places:

```text
light: #9e49d9    the app accent, oklch(58% 0.215 308) in globals.css
dark:  #0b0b0e    the dark ground
```

The script sets the meta before first paint; `ThemeSync` rewrites it on the first client render. If the two disagree, the browser chrome flashes. **Change one, change all of them**, and change the accent in `globals.css` in the same commit.

### The anti-FOUC script is a classic inline script

It must stay the very first child of `<head>`, ahead of the theme-color meta and every stylesheet. It reads the saved `settings` object from `localStorage` directly, because no bundle has run yet. It has to keep working when `localStorage` is empty, blocked, or holds an older shape: wrap the read, fall back to `system`.

There are three copies, one per HTML target. They must agree.

## The widget is different

The widget renders inside a Shadow DOM and has **no Redux and no router** (ADR 0010), so it never mounts `ThemeSync`. HeroUI v3.2.5 declares its theme tokens on `:root, :host`, which is why the stylesheet injected as text into the shadow root carries the theme at all.

`globals.css` also declares `--glass-reduce: 0` on `:root, :host` so a target that never mounts `ThemeSync` still gets the tuned look instead of an unset variable.

When you add anything theme-dependent, check it inside the widget. A rule that keys off `html.dark` will not reach the shadow root.

## Reduce transparency

Not a dark-mode feature, but it lives in the same component and the same slice, so it is easy to break by accident.

- A **level**, 0 to 100, not a switch (`reduceTransparency` in the settings slice). An older boolean value still in `localStorage` maps to the ends of the scale, so an existing user's setting is not reset.
- `ThemeSync` writes it as `--glass-reduce`, a 0-to-1 factor that the `glass` and `glass-fringe` utilities interpolate with. 0 is the tuned look, 1 is a flat opaque surface.
- Every value it scales moves toward opaque, so the measured worst-case contrast is at factor 0. Raising the level can only make text easier to read.
- At the top of the scale, `data-reduce-transparency="true"` makes the utilities drop `backdrop-filter` entirely, rather than leaving a `blur(0px)` that still costs a compositing layer.
- Safari and iOS never fire `prefers-reduced-transparency`, so this control is the only way those platforms can turn the glass off.

## Checklist for a theme-touching change

- Used a semantic token, and reached for `dark:` only where a token genuinely could not carry it.
- The three modes all work: `light`, `dark`, and `system` (test `system` by flipping the OS setting with the app open).
- No flash on first load and none on a client-side route change.
- `THEME_COLOR` and all three anti-FOUC scripts still agree, and agree with the accent in `globals.css`.
- Checked in the widget, where there is no `ThemeSync`.
- Checked at both ends of the reduce-transparency slider.
- Contrast still passes in both themes, including over glass.
- Walked `mobile`, `web`, `admin`, and `widget` from `.claude/launch.json`.
