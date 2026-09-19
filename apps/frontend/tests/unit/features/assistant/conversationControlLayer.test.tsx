import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  CONTROL_REASONS,
  ControlButton,
  ConversationControlLayer,
} from '@/features/assistant/controls';
import { i18n } from '@/i18n';
import { renderWithProviders } from '../../../utils/renderWithProviders';

/**
 * The four physically anchored controls of `/audio` and `/video`.
 *
 * These tests guard the three promises that are easy to break by accident and impossible to
 * see in a diff: every circle has a name, a refused circle still explains itself instead of
 * eating the tap, and the controls do not mirror in Persian while the tab order does.
 */

function renderLayer(
  props: Partial<
    React.ComponentProps<typeof ConversationControlLayer>
  > = {},
  locale: 'en' | 'fa' = 'en',
) {
  const onBlocked = vi.fn();
  const handlers = {
    onEnd: vi.fn(),
    onToggleMic: vi.fn(),
    onInterrupt: vi.fn(),
    onType: vi.fn(),
    onBlocked,
  };

  renderWithProviders(
    <ConversationControlLayer
      isEndPending={false}
      isMicMuted={false}
      micReason={null}
      interruptReason={null}
      typeReason={null}
      {...handlers}
      {...props}
    />,
    {
      locale,
      // Redux owns the language, and `LanguageSync` pushes it back into i18next on mount. A
      // `locale` alone would be overwritten by the store's default the moment it renders.
      preloadedState: {
        settings: {
          language: locale,
          theme: 'system',
          reduceTransparency: 0,
          micPermissionAsked: false,
        },
      },
    },
  );

  return handlers;
}

// The RTL case below changes the shared i18n instance, so put it back for anything after it.
afterAll(async () => {
  await i18n.changeLanguage('en');
});

describe('the conversation control layer', () => {
  it('gives every circle an accessible name', () => {
    renderLayer();

    // Every circle is icon-only now, so the name lives in `aria-label` and nothing on the
    // screen repeats it.
    for (const name of [
      'End',
      'Type instead',
      'Interrupt',
      'Mute the microphone',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('keeps End pressable while the conversation is ending', async () => {
    // The shared Button forces `isDisabled` whenever it is pending, which also sets the real
    // `disabled` attribute and drops the element out of the tab order. The way out of a call
    // must stay reachable, which is why these four are a native button instead.
    const user = userEvent.setup();
    const { onEnd } = renderLayer({ isEndPending: true });

    const end = screen.getByRole('button', { name: 'End' });
    expect(end).toBeEnabled();

    await user.click(end);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('refuses a blocked control without swallowing the press', async () => {
    const user = userEvent.setup();
    const { onInterrupt, onBlocked } = renderLayer({
      interruptReason: CONTROL_REASONS.avatarNotSpeaking,
    });

    const interrupt = screen.getByRole('button', { name: 'Interrupt' });
    expect(interrupt).toHaveAttribute('aria-disabled', 'true');

    await user.click(interrupt);

    // The action did not run, but the press was not silently dropped either: it reports the
    // reason, which the notice line then shows. A dead button teaches the user nothing.
    expect(onInterrupt).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledWith(CONTROL_REASONS.avatarNotSpeaking);
  });

  it('names the microphone by what the press will do, with no aria-pressed', () => {
    renderLayer({ isMicMuted: true });

    const mic = screen.getByRole('button', {
      name: 'Turn the microphone on',
    });
    // A changing action name plus `aria-pressed` makes a screen reader say "unmute, pressed".
    expect(mic).not.toHaveAttribute('aria-pressed');
  });

  it('keeps the four corners physical in Persian and mirrors only the tab order', async () => {
    // The position is a class name, not a computed style: jsdom lays nothing out, and the
    // class is what carries the physical anchor. The e2e suite checks real geometry.
    const anchors = () =>
      screen
        .getAllByRole('button')
        .map((button) => button.className.match(/control-anchor-\S+/)?.[0]);

    renderLayer();

    expect(screen.getByRole('button', { name: 'End' })).toHaveClass(
      'control-anchor-top-left',
    );
    // English reading order: End first, then the typing control.
    expect(anchors()).toEqual([
      'control-anchor-top-left',
      'control-anchor-top-right',
      'control-anchor-bottom-left',
      'control-anchor-bottom-right',
    ]);

    cleanup();
    // Awaited, not handed to `renderWithProviders`: that helper fires the change without
    // waiting for it, so the first render would still be in English.
    await i18n.changeLanguage('fa');
    renderLayer({}, 'fa');

    // Same physical corner. End is at the top left in Persian too.
    expect(screen.getByRole('button', { name: 'پایان' })).toHaveClass(
      'control-anchor-top-left',
    );

    // Only the DOM order flipped, so Tab and a screen reader still run start to end.
    expect(anchors()).toEqual([
      'control-anchor-top-right',
      'control-anchor-top-left',
      'control-anchor-bottom-right',
      'control-anchor-bottom-left',
    ]);
  });
});

/**
 * The colour of the glyph inside a circle.
 *
 * `cn()` is a plain `join(' ')`, not tailwind-merge, so the ORDER OF ITS ARGUMENTS DECIDES
 * NOTHING. Two classes that set the same property both land in the attribute and the
 * stylesheet picks the winner. That is how End shipped grey: the circle carried
 * `text-foreground` and `text-danger` at once, `.text-danger` is emitted first, and
 * `.text-foreground` won on source order.
 *
 * jsdom loads no stylesheet, so a computed colour would answer nothing here. What these tests
 * can prove, and what the bug actually was, is that only ONE colour ever reaches the element.
 */
const COLOR_CLASS = /^text-(?:danger|foreground|muted|accent-foreground)$/;

/** The circle is the button's first child. The label and the reason follow it. */
function circleOf(button: HTMLElement): HTMLElement {
  const circle = button.firstElementChild;
  if (!(circle instanceof HTMLElement)) throw new Error('no circle');
  return circle;
}

function colorsOf(button: HTMLElement): string[] {
  return [...circleOf(button).classList].filter((name) =>
    COLOR_CLASS.test(name),
  );
}

describe('the shape of a control', () => {
  it('draws all four as the same circle, with no visible label on any of them', () => {
    renderLayer();

    const circles = screen.getAllByRole('button').map(circleOf);
    expect(circles).toHaveLength(4);
    for (const circle of circles) {
      // One size and one material. A control that is bigger or solid reads as the important
      // one, and on this screen none of them is.
      expect(circle).toHaveClass('size-12');
      expect(circle).toHaveClass('glass');
      expect(circle).not.toHaveClass('size-16');
    }

    // No circle carries a word beside it. End was the one that did, and it made the row of
    // four look like three controls and a labelled button.
    for (const button of screen.getAllByRole('button')) {
      expect(button.textContent).toBe('');
    }
  });
});

describe('the colour of a control icon', () => {
  it('paints End with the danger token, and with nothing else', () => {
    renderLayer();

    expect(colorsOf(screen.getByRole('button', { name: 'End' }))).toEqual([
      'text-danger',
    ]);
  });

  it('paints the live microphone like every other control', () => {
    // It used to be a 64 px solid accent disc, which made it the loudest thing on a screen
    // whose subject is the person talking.
    renderLayer();

    const mic = screen.getByRole('button', { name: 'Mute the microphone' });
    expect(colorsOf(mic)).toEqual(['text-foreground']);
    expect(circleOf(mic)).not.toHaveClass('bg-accent');
  });

  it('dims a refused control with a colour instead of raw opacity', () => {
    // `opacity: 0.4` on the glyph measured 2.58:1 against its own circle in light, under the
    // 3:1 a non-text element needs. `--muted` is the secondary-text token and clears it in
    // both themes, in the reduced-transparency fallback, and in forced colours.
    renderLayer({ interruptReason: CONTROL_REASONS.avatarNotSpeaking });

    const interrupt = screen.getByRole('button', { name: 'Interrupt' });
    expect(colorsOf(interrupt)).toEqual(['text-muted']);
    expect(interrupt.innerHTML).not.toContain('opacity-40');
    // Not the press dim either. 70% of an already dimmed glyph measures 2.85:1 in light, so
    // the refused press answers in the notice line instead of in the glyph.
    expect(interrupt.innerHTML).not.toContain('group-active:opacity-70');

    // A control that can be pressed still dims under the finger.
    expect(
      screen.getByRole('button', { name: 'Type instead' }).innerHTML,
    ).toContain('group-active:opacity-70');
  });

  it('keeps a blocked control on the same glass as the rest', () => {
    renderWithProviders(
      <ControlButton
        anchorClassName="control-anchor-bottom-right"
        label="Mute"
        icon={<svg />}
        isBlocked
        blockedReason="not yet"
        onPress={vi.fn()}
        onBlockedPress={vi.fn()}
      />,
    );

    const button = screen.getByRole('button', { name: 'Mute' });
    expect(colorsOf(button)).toEqual(['text-muted']);
    expect(circleOf(button)).toHaveClass('glass');
  });
});
