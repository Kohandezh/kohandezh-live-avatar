import { direction, formatNumber } from './index';

describe('i18n helpers', () => {
  it('detects direction', () => {
    expect(direction('fa')).toBe('rtl');
    expect(direction('en')).toBe('ltr');
  });
  it('formats numbers per locale', () => {
    expect(formatNumber(1234, 'en')).toBe('1,234');
    expect(formatNumber(1234, 'fa')).toMatch(/۱/);
  });
});
