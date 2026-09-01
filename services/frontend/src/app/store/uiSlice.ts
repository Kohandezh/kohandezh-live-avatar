import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { SupportedLocale } from '@shared/i18n';
import { isOnlineNow } from '@shared/platform';

// CLIENT STATE ONLY. Anything whose source of truth is the backend belongs in TanStack Query.
export type Locale = SupportedLocale;
export type Theme = 'light' | 'dark' | 'system';

export interface UiState {
  locale: Locale;
  theme: Theme;
  online: boolean;
}

const initialState: UiState = { locale: 'fa', theme: 'system', online: isOnlineNow() };

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setLocale(state, action: PayloadAction<Locale>) {
      state.locale = action.payload;
    },
    setTheme(state, action: PayloadAction<Theme>) {
      state.theme = action.payload;
    },
    setOnline(state, action: PayloadAction<boolean>) {
      state.online = action.payload;
    },
  },
});

export const { setLocale, setTheme, setOnline } = uiSlice.actions;
export const uiReducer = uiSlice.reducer;
