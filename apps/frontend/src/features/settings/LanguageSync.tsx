import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getDirection } from '@/i18n';
import { useLanguage } from './hooks';

/**
 * Redux owns the language. This component pushes it to i18next and to the
 * <html> element (lang + dir) so RTL and LTR both work without hard-coding.
 */
export function LanguageSync() {
  const [language] = useLanguage();
  const { i18n } = useTranslation();

  useEffect(() => {
    if (i18n.language !== language) {
      void i18n.changeLanguage(language);
    }

    document.documentElement.lang = language;
    document.documentElement.dir = getDirection(language);
  }, [language, i18n]);

  return null;
}
