import { afterEach, describe, expect, it } from 'vitest';
import {
  findConfigScript,
  readScriptOptions,
  resolveWidgetOptions,
} from '@/app/widget/config';

function addScript(attributes: Record<string, string>): HTMLScriptElement {
  const script = document.createElement('script');
  for (const [name, value] of Object.entries(attributes)) {
    script.setAttribute(name, value);
  }
  document.body.append(script);
  return script;
}

afterEach(() => {
  document.querySelectorAll('script').forEach((script) => script.remove());
});

describe('resolveWidgetOptions', () => {
  it('fills in the defaults when only the embed key is given', () => {
    const config = resolveWidgetOptions({ embedKey: 'key-1' });

    expect(config).toEqual({
      apiBaseUrl: '',
      embedKey: 'key-1',
      // jsdom reports an English browser, so the detected language is English.
      language: 'en',
      mode: 'voice',
      position: 'end',
      open: false,
    });
  });

  it('keeps the values the host page asked for', () => {
    const config = resolveWidgetOptions({
      apiBaseUrl: 'https://api.example.com',
      embedKey: 'key-2',
      language: 'fa',
      mode: 'video',
      position: 'start',
      open: true,
    });

    expect(config).toEqual({
      apiBaseUrl: 'https://api.example.com',
      embedKey: 'key-2',
      language: 'fa',
      mode: 'video',
      position: 'start',
      open: true,
    });
  });

  it('rejects a missing embed key', () => {
    expect(() => resolveWidgetOptions({})).toThrow(/embedKey/);
  });

  it('rejects an api base url that is not a path or an http address', () => {
    expect(() =>
      resolveWidgetOptions({
        embedKey: 'key-3',
        apiBaseUrl: 'api.example.com',
      }),
    ).toThrow(/apiBaseUrl/);
  });

  it('rejects a mode the widget does not have', () => {
    expect(() =>
      resolveWidgetOptions({ embedKey: 'key-4', mode: 'hologram' }),
    ).toThrow(/mode/);
  });
});

describe('readScriptOptions', () => {
  it('reads every supported data attribute', () => {
    const script = addScript({
      'data-api-base': 'https://api.example.com',
      'data-embed-key': 'key-5',
      'data-lang': 'fa',
      'data-mode': 'video',
      'data-position': 'start',
    });

    expect(readScriptOptions(script)).toEqual({
      apiBaseUrl: 'https://api.example.com',
      embedKey: 'key-5',
      language: 'fa',
      mode: 'video',
      position: 'start',
    });
  });

  it('treats a missing data-api-base as the same origin', () => {
    const script = addScript({ 'data-embed-key': 'key-6' });

    expect(readScriptOptions(script)).toEqual({
      apiBaseUrl: '',
      embedKey: 'key-6',
    });
  });

  it('returns null when the tag carries no embed key', () => {
    const script = addScript({ 'data-lang': 'fa' });

    expect(readScriptOptions(script)).toBeNull();
  });
});

describe('findConfigScript', () => {
  it('finds the script that carries an embed key', () => {
    addScript({ src: 'analytics.js' });
    const configured = addScript({ 'data-embed-key': 'key-7' });

    expect(findConfigScript()).toBe(configured);
  });

  it('returns null when no script is configured', () => {
    addScript({ src: 'analytics.js' });

    expect(findConfigScript()).toBeNull();
  });
});
