import { direction, formatNumber, isSupportedLocale, bcp47 } from './index';
import en from './locales/en.json';
import fa from './locales/fa.json';

function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object'
      ? keys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe('i18n helpers', () => {
  it('detects direction and BCP-47 tags', () => {
    expect(direction('fa')).toBe('rtl');
    expect(direction('en')).toBe('ltr');
    expect(bcp47('fa')).toBe('fa-IR');
    expect(isSupportedLocale('de')).toBe(false);
  });
  it('formats numbers per locale', () => {
    expect(formatNumber(1234, 'en')).toBe('1,234');
    expect(formatNumber(1234, 'fa')).toMatch(/۱/);
  });
  it('keeps Persian and English catalogs in sync', () => {
    expect(keys(fa).sort()).toEqual(keys(en).sort());
  });
});
