# ADR 0011: HeroUI v3 is the component library

## Status

Accepted. 2026-09-11.

## Context

`src/shared/ui` was a small set of hand-made Tailwind components: `Button`, `Card`, `Badge`,
`StatusChip`, `InlineAlert`, `Input`, `TextArea`, `Spinner`, `LoadingState`, `EmptyState`,
`ErrorState`, `KeyValue`, `OfflineBanner`. They used raw Tailwind palette colors (`slate-*`,
`indigo-*`, `emerald-*`, `amber-*`, `red-*`).

Two problems came from this:

1. The MVP looked like a plain responsive web page, not like a product. There was no consistent
   visual language across the four targets.
2. Accessibility had to be re-done by hand in every component: focus rings, pressed state, the
   link between a form field and its label and its error message. This is easy to get wrong and
   easy to forget on a new component.

The product has four targets (`mobile`, `web`, `admin`, `widget`) that need one consistent
design language, not four.

Options considered:

1. **Keep the hand-made components.** No new dependency, but the two problems above stay
   unsolved, and every new screen repeats the accessibility work.
2. **shadcn/ui.** Components are copied into the repository instead of installed as a package,
   built on Radix primitives. Its tooling targets Tailwind v3 first, and it gives no RTL
   guarantee, which matters for the Persian half of this product.
3. **HeroUI v3.** An npm package (`@heroui/react`, `@heroui/styles`), native to Tailwind CSS v4,
   built on React Aria Components for accessibility and RTL. It ships semantic color tokens, no
   provider is needed, it is Apache 2.0 licensed, and it has an MCP server and an agent skill for
   coding agents to fetch its docs.

## Decision

Option 3: HeroUI v3.

Component mapping used by the code migration:

- `Button` stays a thin composition in `src/shared/ui/Button.tsx` over HeroUI `Button` (it adds
  the spinner while `isPending`).
- `Card` comes straight from `@heroui/react` (`Card`, `Card.Header`, `Card.Title`,
  `Card.Content`, `Card.Footer`).
- `StatusChip` and `Badge` are replaced by HeroUI `Chip` (`color`: default | accent | success |
  warning | danger).
- `InlineAlert` stays a project composition over HeroUI `Alert` (status: default | accent |
  success | warning | danger, with a translated Retry button).
- `Input` (label + error + hint) is replaced by HeroUI `TextField` + `Label` + `Input` +
  `Description` + `FieldError`.
- `TextArea`, `Spinner`, `CloseButton`, `SearchField`, `Select`, `ToggleButtonGroup`, `Table`
  come straight from `@heroui/react`.
- `LoadingState`, `EmptyState`, `ErrorState`, `KeyValue`, `OfflineBanner` stay in `src/shared/ui`
  as project compositions built on HeroUI parts and tokens.

Rules that follow from the decision:

- No `HeroUIProvider`. HeroUI v3 needs no provider (that is a v2 pattern).
- Compound components (`Card.Header`, `Alert.Content`), `onPress` instead of `onClick`,
  `isDisabled` / `isPending` instead of `disabled` / `loading`.
- Semantic color tokens instead of raw Tailwind palette colors: `bg-background`,
  `text-foreground`, `text-muted`, `bg-surface`, `bg-surface-secondary`, `border-border`,
  `border-separator`, `bg-default`, `bg-accent text-accent-foreground`, `text-success`,
  `text-warning`, `text-danger`, and the soft variants (`bg-danger-soft
  text-danger-soft-foreground`). No `slate-*`, `indigo-*`, `emerald-*`, `amber-*`, `red-*`, or
  `bg-white` in app code.
- `@import "@heroui/styles";` in `src/styles/globals.css` must come right after
  `@import "tailwindcss"`. Import order matters.

## Consequences

- Two new dependencies, plus the React Aria peers they pull in.
- The stylesheet import order in `src/styles/globals.css` is now a rule to keep, not just a line
  of code: Tailwind first, HeroUI styles right after.
- Every raw palette color in app code is replaced by a token. This is what keeps the four
  targets visually consistent and what will make a future dark theme possible without touching
  component code.
- RTL: React Aria reads the locale. The app wraps its providers with `I18nProvider` from
  `@heroui/react` (locale `fa-IR` or `en-US`, from the Redux language state) and keeps setting
  `dir` on `<html>` (`LanguageSync`). HeroUI v3.2.3+ uses logical CSS properties for RTL, but
  `LanguageSync` and the logical Tailwind class rule do not go away.
- Tests query by role instead of by DOM shape. A `ToggleButtonGroup` with single selection
  renders `radio` roles; HeroUI `Select` is a button plus a listbox, not a native `<select>`, so
  a test cannot use `selectOption` on it. The Playwright language switcher test had to change for
  the same reason.
- The widget target (ADR 0010, Shadow DOM) can use HeroUI at all only because HeroUI v3.2.5
  declares its theme tokens on `:root, :host`. The widget already injects its stylesheet as text
  into the shadow root; that stylesheet now carries the HeroUI tokens too, with no extra plumbing
  needed.
- We ship light theme only for now. Dark mode is possible later with `class="dark"` or
  `data-theme="dark"` on `<html>` and HeroUI's `useTheme` hook, but it is out of scope for this
  change.
- Bundle size grows: HeroUI and React Aria add weight to all four targets, most visibly the
  widget's one-file build (ADR 0010's size budget). No number is given here; watch the widget
  build size after the migration lands.
- AI tooling was added so agents building on this decision have current docs instead of stale
  training data: `.mcp.json` registers the `heroui-react` MCP server, and
  `.claude/skills/heroui-react/` holds the HeroUI agent skill. See `docs/DEVELOPMENT.md`.
