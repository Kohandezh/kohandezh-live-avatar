import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { enableShadowDOM } from 'react-stately/private/flags/flags';
import { initI18n } from '@/i18n';
import { apiClient, configureApiClient } from '@/shared/api';
import { env } from '@/shared/config/env';
// The widget has no stylesheet to link on the customer's page, so the app CSS is pulled in as
// text and injected into the Shadow DOM. Tailwind still compiles it: the plugin runs for this
// target and `?inline` only changes how the result is delivered.
import widgetCss from '@/styles/globals.css?inline';
import { App } from './App';
import { resolveWidgetOptions, type WidgetConfig } from './config';

/** What `init()` hands back to the customer's page. */
export interface AssistantWidgetInstance {
  open(): void;
  close(): void;
  /** Stops any running conversation and removes the widget from the page. */
  destroy(): void;
}

/**
 * A zero-size anchor. Everything the visitor sees positions itself against the viewport, so
 * the widget adds no layout to the customer's page.
 */
const HOST_STYLE =
  'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483000;';

/**
 * `all: initial` stops the customer's fonts, colors and line heights from being inherited
 * into the widget. The positioning is repeated here, and inline on the element, so an
 * ordinary page rule cannot move the widget.
 */
const HOST_CSS = `:host{all:initial;${HOST_STYLE}}`;

/**
 * React Aria decides whether a press "left" a button by looking at the element under the
 * pointer on the document. Inside a shadow tree that element is the shadow host, so every
 * mouse click on a HeroUI button was cancelled (touch was fine). This flag makes React Aria
 * look through shadow roots. It must run before the first render.
 */
enableShadowDOM();

/** One page gets one widget. Two launchers is always a mistake in the embed snippet. */
let activeInstance: AssistantWidgetInstance | null = null;

/** Runs before React mounts, because the first request can follow immediately. */
async function prepare(config: WidgetConfig): Promise<void> {
  configureApiClient({
    baseURL: config.apiBaseUrl,
    embedKey: config.embedKey,
  });

  if (env.apiMock) {
    if (env.isProd) {
      console.warn(
        '[KohandezhAssistant] VITE_API_MOCK is on in a production build.',
      );
    }
    // Loaded on demand so the mock never ends up in the embedded script.
    const { installMockApi } = await import('@/data/mock');
    installMockApi(apiClient);
  }

  await initI18n(config.language);
}

function createWidgetInstance(config: WidgetConfig): AssistantWidgetInstance {
  const host = document.createElement('div');
  host.setAttribute('data-kohandezh-assistant', '');
  // HeroUI's light-theme tokens are declared on :host([data-theme="light"]) inside a shadow tree.
  host.setAttribute('data-theme', 'light');
  host.setAttribute('style', HOST_STYLE);

  // Open mode, so the page's own tests and accessibility tools can still read the tree.
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `${HOST_CSS}\n${widgetCss}`;
  const container = document.createElement('div');
  shadow.append(style, container);
  document.body.append(host);

  const root = createRoot(container);
  let isOpen = config.open;
  let isReady = false;
  let isDestroyed = false;

  function render() {
    if (!isReady || isDestroyed) return;
    root.render(
      <StrictMode>
        <App config={config} isOpen={isOpen} onOpenChange={setOpen} />
      </StrictMode>,
    );
  }

  function setOpen(next: boolean) {
    if (isDestroyed || isOpen === next) return;
    isOpen = next;
    render();
  }

  const instance: AssistantWidgetInstance = {
    open: () => setOpen(true),
    close: () => setOpen(false),
    destroy() {
      if (isDestroyed) return;
      isDestroyed = true;
      // Unmounting releases the live session: AssistantPanel stops it in its cleanup.
      root.unmount();
      host.remove();
      if (activeInstance === instance) activeInstance = null;
    },
  };

  // `init()` answers immediately, so the first render waits for i18n in the background.
  void prepare(config)
    .then(() => {
      if (isDestroyed) return;
      isReady = true;
      render();
    })
    .catch((error: unknown) => {
      // Developer-facing. The visitor of the customer's site can do nothing about it.
      console.error('[KohandezhAssistant] the widget could not start.', error);
    });

  return instance;
}

/** Validates the options, mounts the widget, and returns the handle. */
export function mountAssistantWidget(
  options: unknown,
): AssistantWidgetInstance {
  if (activeInstance) {
    console.warn(
      '[KohandezhAssistant] already initialized on this page. Call destroy() first.',
    );
    return activeInstance;
  }

  activeInstance = createWidgetInstance(resolveWidgetOptions(options));
  return activeInstance;
}
