import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { SupportedLanguage } from '@/i18n';
import { selectLanguage, setLanguage } from './settingsSlice';

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
