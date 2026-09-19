---
name: ui
description: Build or change UI in this repo. React 19, HeroUI v3, Tailwind CSS v4, four build targets (mobile, web, admin, widget), English and Persian with RTL. Load this BEFORE editing anything under src/app/, src/pages/, src/features/*/ components, src/shared/ui/, src/styles/globals.css, or any colour.
---

# UI in this repo

There is one frontend codebase and four builds of it. A UI change is not done until it is right in every target it reaches, in both languages.

Read this whole file before you touch a pixel. The bar is `AGENTS.md`, "UI/UX Engineering Standards" 1 to 15. This file is the map of where things are and how they work here.

## The stack

- **React 19** with TypeScript strict.
- **HeroUI v3** (`@heroui/react`, `@heroui/styles`), built on Tailwind v4 and React Aria Components (ADR 0011).
- **Tailwind CSS v4**, configured in CSS, not in a JS config. The single stylesheet is `src/styles/globals.css`.
- **i18next** for all text, English and Persian.
- **Vazirmatn** as `--font-sans`, so Persian and English both render from one family.

There is no styled-components, no CSS module, no component library other than HeroUI. Do not add one.

## Where the UI lives

```text
src/app/<target>/     the shell: index.html, main.tsx, App.tsx, router.tsx, a layout
src/app/providers.tsx one set of providers for every target
src/pages/            route-level composition (pages/admin/ is admin-only)
src/features/         user-facing workflows and their components
src/shared/ui/        project compositions on top of HeroUI
src/styles/globals.css  the theme, the custom variants, the project utilities
src/i18n/locales/{en,fa}/{common,admin}.json   every user-facing string
```

The four shells differ on purpose:

| Target   | Shell                                | Navigation                 | Notes                                     |
| -------- | ------------------------------------ | -------------------------- | ----------------------------------------- |
| `mobile` | `src/app/mobile/MobileLayout.tsx`    | `FloatingTabBar`           | Capacitor. No service worker.             |
| `web`    | `src/app/web/WebLayout.tsx`          | top navigation             | Installable PWA, `PwaUpdatePrompt`        |
| `admin`  | `src/app/admin/AdminLayout.tsx`      | sidebar                    | Staff only. Never imported by the others. |
| `widget` | `src/app/widget/WidgetPanel.tsx`     | one floating panel         | Shadow DOM, no router, no Redux (ADR 0010) |

Shared user screens (`pages/login`, `pages/settings`, `pages/conversation`, ...) are used by both `mobile` and `web`. A change to one of them is a change to two targets.

## Before you write a component

1. **Open the existing screens of the target.** Match their layout, spacing, and tone. Do not invent a new interaction when one already exists.
2. **Search `src/shared/ui`, `src/features`, and `src/entities` first.** Reuse before create.
3. **Read the HeroUI component page** before using a component. Three ways: the `heroui-react` MCP server, the `/heroui-react` skill, or `https://heroui.com/react/llms.txt`.
4. **Answer the UX questions** in `AGENTS.md` standard 2: the user's goal, the primary action, what happens before, during, and after, and what happens with no data, on failure, on a slow network, offline.

## HeroUI v3 rules

v3 is not v2. These four mistakes cost the most time:

- **No provider.** Do not add `HeroUIProvider`. The app's providers are in `src/app/providers.tsx`.
- **Compound components.** `Card.Header`, `Card.Title`, `Card.Content`, `Alert.Content`. Not flat props.
- **`onPress`, not `onClick`.**
- **`isDisabled` and `isPending`, not `disabled` and `loading`.**

`src/shared/ui` holds the project's own compositions, not copies of HeroUI:

| Export                                    | What it adds                                          |
| ----------------------------------------- | ----------------------------------------------------- |
| `Button`                                  | HeroUI `Button` plus the spinner while `isPending`    |
| `InlineAlert`                             | translated wrapper around HeroUI `Alert`              |
| `LoadingState`, `EmptyState`, `ErrorState`| the three required async states, translated           |
| `KeyValue`                                | label/value row                                       |
| `ScreenHeader`                            | the screen title block                                |
| `OfflineBanner`                           | the offline notice                                    |

Everything else (`Card`, `Chip`, `TextField`, `TextArea`, `Spinner`, `CloseButton`, `SearchField`, `Select`, `ToggleButtonGroup`, `Table`, `toast`, ...) comes straight from `@heroui/react`.

Toasts: there is one `ToastProvider` at the app root, placed `top` so a toast never hides under the floating tab bar. Call `toast(...)` from `@heroui/react` anywhere. Do not add a second provider.

## Colour: tokens only

Use HeroUI's semantic tokens. They follow the theme and keep the four targets consistent. Raw palette classes do not.

```text
bg-background   text-foreground   text-muted
bg-surface      bg-surface-secondary
border-border   border-separator
bg-default      bg-accent text-accent-foreground
text-success    text-warning      text-danger
bg-danger-soft  text-danger-soft-foreground
```

Never `slate-*`, `indigo-*`, `emerald-*`, `amber-*`, `red-*`, or `bg-white` in app code. Never an arbitrary value (`p-[13px]`, `#3b82f6`) where a token exists. `get_theme_variables` on the `heroui-react` MCP server lists the full set.

## The project utilities in globals.css

`src/styles/globals.css` defines more than the theme. Read it before inventing a class:

- **`glass` and `glass-fringe`**: the liquid-glass material. Tuned with `--glass-*` variables and dialled down by the reduce-transparency slider (`--glass-reduce`, written by `ThemeSync`). The contrast was measured at factor 0, which is the worst case, so raising the slider can only make text easier to read. Do not hand-roll a blur.
- **`safe-top`, `safe-bottom`, `safe-inline`, `safe-inline-gutter`, `stage-safe-top`**: device safe areas. Use these instead of a hard-coded padding.
- **`dock-safe`, `dock-clear`, `above-dock`**: keeping content clear of the floating tab bar.
- **`stage-16x9`**: the conversation stage aspect box.
- **`control-anchor-top-left` and the other three corners**: see the RTL exception below.

Tailwind v4 only emits an `@utility` when a scanned source file mentions the class name. A utility that nothing references is pruned from the build. That is why some are referenced from a comment in the CSS itself.

## i18n and RTL

- **Every user-facing string goes through `t()`**, with the key added to **both** `src/i18n/locales/en` and `src/i18n/locales/fa`. Namespaces are `common` and `admin`. A key in one language only is a bug.
- **Redux owns the language.** `LanguageSync` pushes it to i18next and writes `lang` and `dir` on `<html>`. `LocaleProvider` passes `fa-IR` or `en-US` to React Aria's `I18nProvider`, which is how HeroUI components learn the direction. Do not set direction anywhere else.
- **Logical Tailwind classes only**: `ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`, `text-end`, `start-*`, `end-*`. Never `ml-*`, `mr-*`, `left-*`, `right-*`.
- **Persian text is longer than English** for the same idea, and it wraps differently. A layout that only fits the English string is broken.

### The one documented RTL exception

The four corner controls on the conversation screens (`/audio`, `/video`) are anchored to **physical** screen positions and do not mirror with the writing direction (ADR 0013). End sits at the physical top left in both languages, because the screen is a control surface learned by position, not a document.

Use the `control-anchor-*` utilities there. Do not "fix" them to logical properties. If you are about to, read ADR 0013 first: that ADR exists specifically to stop that change.

## The required states

Every data-driven screen handles: initial, loading, success, empty, error, disabled, partial data, 401 and 403, offline, long content, and large data.

Use the shared primitives. Do not build a second spinner or a second error box.

```tsx
if (isLoading) return <LoadingState />;
if (error) return <ErrorState onRetry={() => void refetch()} />;
if (!items.length) return <EmptyState />;
```

`ErrorState` takes `onRetry`. An error with no way forward is not a finished error state. Map `ApiError` to user language through i18n: never a stack trace, never a bare status code, never an English-only server message.

Auth and connectivity: `RequireAuth` and `RequireRole` from `src/features/authentication` (UX only, the backend enforces), and `OfflineBanner`.

## Accessibility

Part of correctness, not a later pass:

- keyboard reachable, with visible focus
- semantic elements (`button`, `nav`, `main`, real headings)
- a label on every input and every icon-only button
- touch targets of at least 44px on mobile
- `prefers-reduced-motion` respected
- error messages linked to their field
- contrast checked, including over the glass material

HeroUI is built on React Aria, so most of this comes free **if** you use the component instead of a `div` with an `onClick`.

## Do not over-design

No decorative animation, gradient, shadow, modal, or effect without a purpose. "Premium" means the task feels obvious, not that the screen looks busy.

## Verify in the running app

Reading the source is not verification (`AGENTS.md`, UI/UX standard 12). For any visible change:

1. Start the affected target from `.claude/launch.json`: `mobile`, `web`, `admin`, `widget`, or the `*-mock` variants when you want the mock API.
2. Walk the flow. Check loading, empty, error, and success.
3. Resize to phone width.
4. Switch the language to `fa`. Check RTL and the longer text.
5. Look for regressions on nearby screens.
6. Report which targets you walked and what you checked.

Then run the gates:

```bash
pnpm lint
pnpm build        # type-checks and builds all four targets
pnpm test
pnpm test:e2e     # when a user flow changed
```

## Checklist before you call a UI change done

- Existing component reused, or a new one justified.
- HeroUI v3 API used correctly (`onPress`, `isPending`, compound parts, no provider).
- Semantic tokens only, no raw palette class, no arbitrary value.
- Logical CSS, except the documented `control-anchor-*` case.
- Every string translated in both `en` and `fa`.
- Loading, empty, error, offline, 401 and 403 all handled.
- Keyboard, focus, labels, 44px targets, reduced motion.
- Walked in every affected target, at phone width, in both languages.
- `pnpm lint`, `pnpm build`, `pnpm test` pass.
