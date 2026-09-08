import { describe, expect, it } from 'vitest';
import {
  loadInitialSettings,
  persistSettings,
  selectLanguage,
  setLanguage,
  settingsReducer,
} from '@/features/settings/settingsSlice';

describe('settingsSlice', () => {
  it('changes the language', () => {
    const state = settingsReducer({ language: 'en' }, setLanguage('fa'));

    expect(selectLanguage({ settings: state })).toBe('fa');
  });

  it('restores a saved language', () => {
    persistSettings({ language: 'fa' });

    expect(loadInitialSettings().language).toBe('fa');
  });

  it('ignores an unsupported saved language', () => {
    localStorage.setItem('settings', JSON.stringify({ language: 'xx' }));

    expect(['en', 'fa']).toContain(loadInitialSettings().language);
  });
});
