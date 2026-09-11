import { findConfigScript, readScriptOptions } from './config';
import { mountAssistantWidget, type AssistantWidgetInstance } from './mount';

export interface AssistantWidgetGlobal {
  init(options: unknown): AssistantWidgetInstance;
}

declare global {
  interface Window {
    KohandezhAssistant?: AssistantWidgetGlobal;
  }
}

const api: AssistantWidgetGlobal = {
  init: mountAssistantWidget,
};

// The build emits a classic script, so the global is set here rather than through exports.
// That keeps `pnpm dev:widget`, which loads this file as an ES module, working the same way.
window.KohandezhAssistant = api;

// A customer who puts the configuration on the script tag gets the widget without writing
// any JavaScript. Without those attributes the page is expected to call init() itself.
const script = findConfigScript();

if (script) {
  const options = readScriptOptions(script);

  if (options) {
    try {
      api.init(options);
    } catch (error) {
      // Never let a bad snippet break the customer's page.
      console.error(
        '[KohandezhAssistant] bad script tag configuration.',
        error,
      );
    }
  }
}
