import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { FloatingTabBar } from '@/features/navigation/FloatingTabBar';

/**
 * D2 regression test: on `/audio` the screenshot in the review looked like
 * two tabs were marked current (Video and Audio both tinted). This renders
 * the real component at `/audio` and checks the real DOM instead of trusting
 * the screenshot. Exactly one item may carry `aria-current` and the active
 * tint (`bg-accent-soft`).
 */
describe('FloatingTabBar', () => {
  it('marks exactly one item current on /audio, not two', () => {
    render(
      <MemoryRouter initialEntries={['/audio']}>
        <FloatingTabBar liveRoute={null} />
      </MemoryRouter>,
    );

    const buttons = [
      screen.getByRole('button', { name: /Settings/ }),
      screen.getByRole('button', { name: /Video/ }),
      screen.getByRole('button', { name: /Audio/ }),
    ];

    const current = buttons.filter(
      (button) => button.getAttribute('aria-current') === 'page',
    );
    expect(current).toHaveLength(1);
    expect(current[0]).toBe(screen.getByRole('button', { name: /Audio/ }));

    const tinted = buttons.filter((button) =>
      button.className.includes('bg-accent-soft'),
    );
    expect(tinted).toHaveLength(1);
    expect(tinted[0]).toBe(current[0]);
  });

  it('marks exactly one item current on /video, with the live dot only on the live route', () => {
    render(
      <MemoryRouter initialEntries={['/video']}>
        <FloatingTabBar liveRoute="/video" />
      </MemoryRouter>,
    );

    const buttons = [
      screen.getByRole('button', { name: /Settings/ }),
      screen.getByRole('button', { name: /Video/ }),
      screen.getByRole('button', { name: /Audio/ }),
    ];
    const current = buttons.filter(
      (button) => button.getAttribute('aria-current') === 'page',
    );
    expect(current).toHaveLength(1);
    expect(current[0]).toBe(screen.getByRole('button', { name: /Video/ }));

    // The live dot has an sr-only "Live" label, a visually separate marker
    // from aria-current, and it only exists on the item whose route is live.
    expect(screen.getAllByText('Live')).toHaveLength(1);
  });

  it('shows the icons only, and still answers to every name', () => {
    // The words made the pill wide enough to crowd the conversation controls
    // above it on a phone. Losing the pixels must not lose the name: a screen
    // reader and voice control both still reach each item by its word.
    render(
      <MemoryRouter initialEntries={['/audio']}>
        <FloatingTabBar liveRoute={null} />
      </MemoryRouter>,
    );

    for (const name of ['Settings', 'Video', 'Audio']) {
      const button = screen.getByRole('button', { name: new RegExp(name) });
      expect(button).toBeInTheDocument();
      // The label is present for assistive technology and hidden from sight.
      const label = screen.getByText(name);
      expect(label).toHaveClass('sr-only');
    }
  });
});
