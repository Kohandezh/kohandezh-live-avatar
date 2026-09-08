import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import {
  detectLanguage,
  isSupportedLanguage,
  type SupportedLanguage,
} from '@/i18n';
import { localStore } from '@/shared/storage/localStorage';

/**
 * Client-owned global settings (ADR 0003). Nothing here comes from the server.
 */
export interface SettingsState {
  language: SupportedLanguage;
}

const STORAGE_KEY = 'settings';

export function loadInitialSettings(): SettingsState {
  const saved = localStore.get<Partial<SettingsState>>(STORAGE_KEY);

  return {
    language: isSupportedLanguage(saved?.language)
      ? saved.language
      : detectLanguage(),
  };
}

export function persistSettings(state: SettingsState): void {
  localStore.set(STORAGE_KEY, state);
}

export const settingsSlice = createSlice({
  name: 'settings',
  initialState: loadInitialSettings,
  reducers: {
    setLanguage(state, action: PayloadAction<SupportedLanguage>) {
      state.language = action.payload;
    },
  },
});

export const { setLanguage } = settingsSlice.actions;
export const settingsReducer = settingsSlice.reducer;

/** Minimal state shape this feature needs. Keeps the feature independent from app/store. */
export interface SettingsRootState {
  settings: SettingsState;
}

export const selectLanguage = (state: SettingsRootState) =>
  state.settings.language;
