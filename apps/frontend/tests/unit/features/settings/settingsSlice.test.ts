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
  reduceTransparency: false,
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

  it('defaults reduceTransparency to false', () => {
    expect(loadInitialSettings().reduceTransparency).toBe(false);
  });

  it('changes reduceTransparency', () => {
    const state = settingsReducer(baseState, setReduceTransparency(true));

    expect(selectReduceTransparency({ settings: state })).toBe(true);
  });

  it('restores a saved reduceTransparency flag', () => {
    persistSettings({ ...baseState, reduceTransparency: true });

    expect(loadInitialSettings().reduceTransparency).toBe(true);
  });

  it('ignores a non-boolean saved reduceTransparency value', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({ reduceTransparency: 'yes' }),
    );

    expect(loadInitialSettings().reduceTransparency).toBe(false);
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
