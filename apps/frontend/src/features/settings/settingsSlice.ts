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

/** Both ends of the reduce-transparency scale. 0 is the full glass, 100 is a flat surface. */
export const REDUCE_TRANSPARENCY_MIN = 0;
export const REDUCE_TRANSPARENCY_MAX = 100;

/**
 * Reads a saved reduce-transparency value.
 *
 * The setting used to be a boolean. Anyone who turned it on before this change has `true` in
 * localStorage, so that maps to the top of the scale and `false` to the bottom. Without this
 * their setting would silently reset.
 */
function readReduceTransparency(value: unknown): number {
  if (typeof value === 'boolean') {
    return value ? REDUCE_TRANSPARENCY_MAX : REDUCE_TRANSPARENCY_MIN;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return REDUCE_TRANSPARENCY_MIN;
  }
  return clampReduceTransparency(value);
}

/** Keeps the level inside the scale, so a hand-edited localStorage cannot break the CSS. */
export function clampReduceTransparency(value: number): number {
  return Math.min(
    REDUCE_TRANSPARENCY_MAX,
    Math.max(REDUCE_TRANSPARENCY_MIN, Math.round(value)),
  );
}

export interface SettingsState {
  language: SupportedLanguage;
  theme: ThemeMode;
  /**
   * How much of the glass effect to take away, 0 to 100. 0 leaves it untouched, 100 makes every
   * glass surface flat and opaque.
   *
   * A level rather than a switch so the effect can be dialled down without being turned off.
   * Required on Safari/iOS at any value: they never fire prefers-reduced-transparency, so this
   * is the only control those platforms have.
   */
  reduceTransparency: number;
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
    reduceTransparency: readReduceTransparency(saved?.reduceTransparency),
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
    setReduceTransparency(state, action: PayloadAction<number>) {
      state.reduceTransparency = clampReduceTransparency(action.payload);
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
