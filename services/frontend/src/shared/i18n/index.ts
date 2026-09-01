import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import fa from './locales/fa.json';
import en from './locales/en.json';

export const SUPPORTED_LOCALES = ['fa', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const RTL_LOCALES: ReadonlySet<string> = new Set(['fa', 'ar', 'he', 'ur']);

export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  resources: { fa: { translation: fa }, en: { translation: en } },
  lng: 'fa',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function direction(locale: string): 'rtl' | 'ltr' {
  return RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';
}

/** BCP-47 tag handed to React Aria so its components lay out and announce correctly. */
export function bcp47(locale: SupportedLocale): string {
  return locale === 'fa' ? 'fa-IR' : 'en-US';
}

/** Components must not hard-code LTR/RTL; the document root carries it. */
export function applyDocumentDirection(locale: string): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = direction(locale);
}

export function formatNumber(n: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(n);
}

export function formatTime(d: Date | string | number, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(d));
}
