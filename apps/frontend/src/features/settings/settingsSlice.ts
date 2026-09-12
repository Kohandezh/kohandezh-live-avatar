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
export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

function isThemeMode(value: unknown): value is ThemeMode {
  return (
    typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value)
  );
}

export interface SettingsState {
  language: SupportedLanguage;
  theme: ThemeMode;
  /** Turns off the glass effect. Required on Safari/iOS: they never fire prefers-reduced-transparency. */
  reduceTransparency: boolean;
  /** Whether onboarding already asked for the microphone once, so a later login does not nag again. */
  micPermissionAsked: boolean;
}

const STORAGE_KEY = 'settings';

export function loadInitialSettings(): SettingsState {
  const saved = localStore.get<Partial<SettingsState>>(STORAGE_KEY);

  return {
    language: isSupportedLanguage(saved?.language)
      ? saved.language
      : detectLanguage(),
    theme: isThemeMode(saved?.theme) ? saved.theme : 'system',
    reduceTransparency:
      typeof saved?.reduceTransparency === 'boolean'
        ? saved.reduceTransparency
        : false,
    micPermissionAsked:
      typeof saved?.micPermissionAsked === 'boolean'
        ? saved.micPermissionAsked
        : false,
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
    setTheme(state, action: PayloadAction<ThemeMode>) {
      state.theme = action.payload;
    },
    setReduceTransparency(state, action: PayloadAction<boolean>) {
      state.reduceTransparency = action.payload;
    },
    setMicPermissionAsked(state, action: PayloadAction<boolean>) {
      state.micPermissionAsked = action.payload;
    },
  },
});

export const {
  setLanguage,
  setTheme,
  setReduceTransparency,
  setMicPermissionAsked,
} = settingsSlice.actions;
export const settingsReducer = settingsSlice.reducer;

/** Minimal state shape this feature needs. Keeps the feature independent from app/store. */
export interface SettingsRootState {
  settings: SettingsState;
}

export const selectLanguage = (state: SettingsRootState) =>
  state.settings.language;
export const selectTheme = (state: SettingsRootState) => state.settings.theme;
export const selectReduceTransparency = (state: SettingsRootState) =>
  state.settings.reduceTransparency;
export const selectMicPermissionAsked = (state: SettingsRootState) =>
  state.settings.micPermissionAsked;
