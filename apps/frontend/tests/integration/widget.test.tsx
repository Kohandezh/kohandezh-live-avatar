import { act, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mountAssistantWidget } from '@/app/widget/mount';
import type { AssistantWidgetInstance } from '@/app/widget/mount';
import { apiClient } from '@/shared/api';
import { setEmbedKey } from '@/shared/api/interceptors';
import { i18n } from '@/i18n';

const baseURL = apiClient.defaults.baseURL;
const withCredentials = apiClient.defaults.withCredentials;

let widget: AssistantWidgetInstance | null = null;

afterEach(async () => {
  act(() => widget?.destroy());
  widget = null;
  apiClient.defaults.baseURL = baseURL;
  apiClient.defaults.withCredentials = withCredentials;
  setEmbedKey(null);
  await i18n.changeLanguage('en');
});

/** Mounts the widget and waits until React has rendered inside the shadow root. */
async function mountWidget(options: Record<string, unknown> = {}) {
  widget = mountAssistantWidget({
    apiBaseUrl: '',
    embedKey: 'mock-embed-key',
    language: 'en',
    ...options,
  });

  const host = document.querySelector('[data-kohandezh-assistant]');
  if (!host?.shadowRoot) throw new Error('The widget host was not created.');
  const shadowRoot = host.shadowRoot;

  // The last child is the React container; the first one is the injected stylesheet.
  const container = await waitFor(() => {
    const candidate = shadowRoot.lastElementChild;
    if (
      !(candidate instanceof HTMLElement) ||
      candidate.childElementCount === 0
    ) {
      throw new Error('The widget has not rendered yet.');
    }
    return candidate;
  });

  return { host, container, ui: within(container) };
}

describe('website widget', () => {
  it('puts a launcher on the page inside a shadow root', async () => {
    const { host, ui } = await mountWidget();

    expect(host.shadowRoot).not.toBeNull();
    expect(
      ui.getByRole('button', { name: 'Talk to Dr. Kohandezh' }),
    ).toBeInTheDocument();
    // Nothing of the widget leaks into the customer's own document.
    expect(document.body.textContent).toBe('');
  });

  it('opens the assistant panel from the launcher', async () => {
    const { ui } = await mountWidget();

    fireEvent.click(ui.getByRole('button', { name: 'Talk to Dr. Kohandezh' }));

    const dialog = await ui.findByRole('dialog', { name: 'Dr. Kohandezh Assistant' });
    expect(
      within(dialog).getByRole('button', { name: 'Start the conversation' }),
    ).toBeInTheDocument();
  });

  it('moves focus into the panel and back to the launcher', async () => {
    const { host, ui } = await mountWidget();
    const shadowRoot = host.shadowRoot;
    if (!shadowRoot) throw new Error('Missing shadow root.');

    fireEvent.click(ui.getByRole('button', { name: 'Talk to Dr. Kohandezh' }));
    const dialog = await ui.findByRole('dialog', { name: 'Dr. Kohandezh Assistant' });
    await waitFor(() => expect(shadowRoot.activeElement).toBe(dialog));

    // The header button, not the launcher, which also closes the panel on a wide screen.
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Close' }),
    );

    await waitFor(() =>
      expect(shadowRoot.activeElement).toBe(
        ui.getByRole('button', { name: 'Talk to Dr. Kohandezh' }),
      ),
    );
  });

  it('closes the panel with Escape', async () => {
    const { ui } = await mountWidget();

    fireEvent.click(ui.getByRole('button', { name: 'Talk to Dr. Kohandezh' }));
    const dialog = await ui.findByRole('dialog', { name: 'Dr. Kohandezh Assistant' });

    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(ui.queryByRole('dialog')).toBeNull());
  });

  it('opens right away and reads right to left in Persian', async () => {
    const { container, ui } = await mountWidget({ language: 'fa', open: true });

    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
    expect(
      await ui.findByRole('dialog', { name: 'دستیار دکتر کهن‌دژ' }),
    ).toBeInTheDocument();
  });

  it('switches the panel language from the header', async () => {
    const { ui } = await mountWidget();

    fireEvent.click(ui.getByRole('button', { name: 'Talk to Dr. Kohandezh' }));
    const dialog = await ui.findByRole('dialog', {
      name: 'Dr. Kohandezh Assistant',
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'فارسی' }));

    expect(
      await ui.findByRole('dialog', { name: 'دستیار دکتر کهن‌دژ' }),
    ).toBeInTheDocument();
  });

  it('removes itself from the page on destroy', async () => {
    await mountWidget();

    act(() => widget?.destroy());
    widget = null;

    expect(document.querySelector('[data-kohandezh-assistant]')).toBeNull();
  });
});
