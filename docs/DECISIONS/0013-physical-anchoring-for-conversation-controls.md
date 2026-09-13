# 0013. Physical anchoring for the conversation controls

## Context

The app ships in English (LTR) and Persian (RTL). The house rule is logical CSS properties
everywhere: `ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`. A logical property flips with the
writing direction, so one class gives the correct layout in both languages. That rule is
right for content and it stays.

The conversation screens (`/audio` and `/video`) are different. They are not a document.
They are a control surface that a user operates with one thumb while talking to a doctor.
The buttons are learned by position, the way the buttons on a phone call screen are learned
by position. A user who switches the app language should not have to relearn where the
End button is.

The product owner was asked directly and answered in his own words: "physical, it stays in
its own place." End sits at the physical top left in Persian and in English.

Without a record, this looks like a bug. A reviewer sees `left` in a bilingual app, assumes
somebody forgot the house rule, and "fixes" it. That is the thing this ADR exists to stop.

## Decision

The four corner controls on the conversation screens are anchored to physical screen
positions and do not mirror with the writing direction.

The anchoring is expressed as four named utilities in `apps/frontend/src/styles/globals.css`:

- `control-anchor-top-left`
- `control-anchor-top-right`
- `control-anchor-bottom-left`
- `control-anchor-bottom-right`

No physical Tailwind utility (`left-*`, `right-*`, `ml-*`, `mr-*`) appears in the page's
JSX. The physical word lives in the class name, so anyone who greps `control-anchor` lands
on the comment block that explains why.

There is already a precedent in this file. `safe-inline` uses physical `padding-left` and
`padding-right` with a comment explaining that `env(safe-area-inset-left)` is a physical
measurement, so pairing it with a logical property would put the padding on the wrong side
in RTL. The same reasoning applies here.

### Where the exception stops

The exception is **position, for the four corner controls, and nothing else**.

These still mirror, with logical classes, unchanged:

- The session line, the orb caption, the notice line, the transcript block, the ended
  message and the error card. All text.
- The transcript drawer and the composer drawer, inside and out.
- The floating tab bar. It is navigation and it belongs to the shell.
- The Start and Restart button.
- Any icon that points somewhere. A chevron or a send arrow must mirror. The exception is
  about where a control sits, not about which way a glyph points.

DOM order is **not** part of the exception. Keyboard and screen reader order should follow
reading order. Fixed physical positions cannot match both languages with one DOM order, so
the two rows render from an array that is reversed when `i18n.dir() === 'rtl'`. The pixels
stay put. Only the tab order changes.

## Consequences

- **Two guards, because a comment is not enough.** A unit test greps `className` strings in
  `src/**/*.tsx` for physical utilities and fails with a message pointing at this ADR. The
  four `control-anchor-*` names are allowlisted. An e2e assertion checks that in `fa` the
  End button's bounding box is in the left half of the viewport, the same as in `en`. The
  test is the only thing that actually prevents a silent mirror later.
- **The four names must be written as literal strings.** Tailwind v4 only emits an
  `@utility` when a scanned source file mentions the class name, and it does not scan
  `.css` files. A composed name like `` control-anchor-${row}-${side} `` would prune all
  four from the build with no error. They are listed in `@source inline(...)` next to
  `safe-inline`, which the repo already lost to this once.
- **One comment at the use site**, in `AudioConversationPage.tsx`, saying the controls are
  physically anchored on purpose and pointing back here.
- **A future screen does not inherit this.** If another screen wants physical anchoring, it
  needs its own decision. The exception is named for these controls, not for the app.
