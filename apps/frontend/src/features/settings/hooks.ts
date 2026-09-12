import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { SupportedLanguage } from '@/i18n';
import {
  selectLanguage,
  selectReduceTransparency,
  selectTheme,
  setLanguage,
  setReduceTransparency,
  setTheme,
  type ThemeMode,
} from './settingsSlice';

export function useLanguage(): [
  SupportedLanguage,
  (language: SupportedLanguage) => void,
] {
  const language = useSelector(selectLanguage);
  const dispatch = useDispatch();

  const change = useCallback(
    (next: SupportedLanguage) => {
      dispatch(setLanguage(next));
    },
    [dispatch],
  );

  return [language, change];
}

export function useTheme(): [ThemeMode, (theme: ThemeMode) => void] {
  const theme = useSelector(selectTheme);
  const dispatch = useDispatch();

  const change = useCallback(
    (next: ThemeMode) => {
      dispatch(setTheme(next));
    },
    [dispatch],
  );

  return [theme, change];
}

/** The reduce-transparency level, 0 to 100. See `SettingsState.reduceTransparency`. */
export function useReduceTransparency(): [number, (value: number) => void] {
  const reduceTransparency = useSelector(selectReduceTransparency);
  const dispatch = useDispatch();

  const change = useCallback(
    (next: number) => {
      dispatch(setReduceTransparency(next));
    },
    [dispatch],
  );

  return [reduceTransparency, change];
}
