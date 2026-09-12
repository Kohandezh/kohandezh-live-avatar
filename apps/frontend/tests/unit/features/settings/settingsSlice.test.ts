import { describe, expect, it } from 'vitest';
import {
  loadInitialSettings,
  persistSettings,
  selectLanguage,
  selectMicPermissionAsked,
  selectReduceTransparency,
  selectTheme,
  setLanguage,
  setMicPermissionAsked,
  setReduceTransparency,
  setTheme,
  settingsReducer,
  type SettingsState,
} from '@/features/settings/settingsSlice';

const baseState: SettingsState = {
  language: 'en',
  theme: 'system',
  reduceTransparency: 0,
  micPermissionAsked: false,
};

describe('settingsSlice', () => {
  it('changes the language', () => {
    const state = settingsReducer(baseState, setLanguage('fa'));

    expect(selectLanguage({ settings: state })).toBe('fa');
  });

  it('restores a saved language', () => {
    persistSettings({ ...baseState, language: 'fa' });

    expect(loadInitialSettings().language).toBe('fa');
  });

  it('ignores an unsupported saved language', () => {
    localStorage.setItem('settings', JSON.stringify({ language: 'xx' }));

    expect(['en', 'fa']).toContain(loadInitialSettings().language);
  });

  it('defaults the theme to system', () => {
    expect(loadInitialSettings().theme).toBe('system');
  });

  it('changes the theme', () => {
    const state = settingsReducer(baseState, setTheme('dark'));

    expect(selectTheme({ settings: state })).toBe('dark');
  });

  it('restores a saved theme', () => {
    persistSettings({ ...baseState, theme: 'dark' });

    expect(loadInitialSettings().theme).toBe('dark');
  });

  it('ignores an unsupported saved theme', () => {
    localStorage.setItem('settings', JSON.stringify({ theme: 'sepia' }));

    expect(loadInitialSettings().theme).toBe('system');
  });

  it('defaults reduceTransparency to 0, the untouched glass', () => {
    expect(loadInitialSettings().reduceTransparency).toBe(0);
  });

  it('changes reduceTransparency to a level in between', () => {
    const state = settingsReducer(baseState, setReduceTransparency(40));

    expect(selectReduceTransparency({ settings: state })).toBe(40);
  });

  it('clamps a level outside the scale', () => {
    expect(
      settingsReducer(baseState, setReduceTransparency(140))
        .reduceTransparency,
    ).toBe(100);
    expect(
      settingsReducer(baseState, setReduceTransparency(-20)).reduceTransparency,
    ).toBe(0);
  });

  it('restores a saved reduceTransparency level', () => {
    persistSettings({ ...baseState, reduceTransparency: 65 });

    expect(loadInitialSettings().reduceTransparency).toBe(65);
  });

  /**
   * The setting used to be a boolean. A user who turned it on before the change has `true` on
   * disk and must land at the top of the scale, not back at 0.
   */
  it('reads a saved boolean from before the setting became a level', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({ reduceTransparency: true }),
    );
    expect(loadInitialSettings().reduceTransparency).toBe(100);

    localStorage.setItem(
      'settings',
      JSON.stringify({ reduceTransparency: false }),
    );
    expect(loadInitialSettings().reduceTransparency).toBe(0);
  });

  it('ignores a saved reduceTransparency value that is neither a number nor a boolean', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({ reduceTransparency: 'yes' }),
    );

    expect(loadInitialSettings().reduceTransparency).toBe(0);
  });

  it('defaults micPermissionAsked to false', () => {
    expect(loadInitialSettings().micPermissionAsked).toBe(false);
  });

  it('changes micPermissionAsked', () => {
    const state = settingsReducer(baseState, setMicPermissionAsked(true));

    expect(selectMicPermissionAsked({ settings: state })).toBe(true);
  });

  it('restores a saved micPermissionAsked flag', () => {
    persistSettings({ ...baseState, micPermissionAsked: true });

    expect(loadInitialSettings().micPermissionAsked).toBe(true);
  });
});
