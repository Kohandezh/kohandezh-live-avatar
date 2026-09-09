import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enAdmin from './locales/en/admin.json';
import enCommon from './locales/en/common.json';
import faAdmin from './locales/fa/admin.json';
import faCommon from './locales/fa/common.json';
import type { SupportedLanguage } from './types';

export const supportedLanguages: readonly SupportedLanguage[] = ['en', 'fa'];
export const defaultLanguage: SupportedLanguage = 'en';
export const defaultNamespace = 'common';

export const resources = {
  en: { common: enCommon, admin: enAdmin },
  fa: { common: faCommon, admin: faAdmin },
} as const;

export function isSupportedLanguage(
  value: unknown,
): value is SupportedLanguage {
  return (
    typeof value === 'string' &&
    (supportedLanguages as readonly string[]).includes(value)
  );
}

/** Picks the browser language when it is supported, otherwise the default. */
export function detectLanguage(): SupportedLanguage {
  const browser = globalThis.navigator?.language?.slice(0, 2).toLowerCase();
  return isSupportedLanguage(browser) ? browser : defaultLanguage;
}

/** Text direction for a language. Do not hard-code "ltr" anywhere else. */
export function getDirection(language: SupportedLanguage): 'ltr' | 'rtl' {
  return i18n.dir(language);
}

export async function initI18n(language: SupportedLanguage = defaultLanguage) {
  if (i18n.isInitialized) {
    if (i18n.language !== language) {
      await i18n.changeLanguage(language);
    }
    return i18n;
  }

  await i18n.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: defaultLanguage,
    defaultNS: defaultNamespace,
    ns: Object.keys(resources.en),
    interpolation: { escapeValue: false },
    returnNull: false,
  });

  return i18n;
}

export { i18n };
export type { SupportedLanguage } from './types';

/** Persian digits for fa, Latin digits otherwise. Machine ids stay unformatted. */
export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(value);
}

export function formatTime(value: Date | string | number, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}
