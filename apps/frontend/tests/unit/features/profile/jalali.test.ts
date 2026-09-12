import { CalendarDate, PersianCalendar, toCalendar } from '@internationalized/date';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EARLIEST_BIRTH_YEAR,
  birthDateLocale,
  earliestBirthDate,
  isValidBirthDate,
  isoToPersianDate,
  latestBirthDate,
  persianDateToIso,
} from '@/features/profile/jalali';

/**
 * The conversion the birthday field depends on: what the user types is Jalali, what the API
 * stores is Gregorian. A bug here is silent, because both ends are plausible-looking dates.
 *
 * The reference pairs below are ordinary published equivalences, including a leap year on each
 * side and the two days around Nowruz, where the year rolls over.
 */
const PAIRS: readonly { iso: string; jalali: [number, number, number] }[] = [
  { iso: '1993-06-21', jalali: [1372, 3, 31] },
  { iso: '2024-03-19', jalali: [1402, 12, 29] }, // last day of a Jalali year
  { iso: '2024-03-20', jalali: [1403, 1, 1] }, // Nowruz, the next day
  { iso: '2024-02-29', jalali: [1402, 12, 10] }, // a Gregorian leap day
  { iso: '2025-03-20', jalali: [1403, 12, 30] }, // a Jalali leap year has a 30th Esfand
  { iso: '1900-01-01', jalali: [1278, 10, 11] },
];

afterEach(() => {
  vi.useRealTimers();
});

describe('isoToPersianDate', () => {
  it.each(PAIRS)('reads $iso as the Jalali day', ({ iso, jalali }) => {
    const value = isoToPersianDate(iso);

    expect(value).not.toBeNull();
    expect([value!.year, value!.month, value!.day]).toEqual(jalali);
    expect(value!.calendar.identifier).toBe('persian');
  });

  it('returns null for no birthday and for a value that is not a date', () => {
    expect(isoToPersianDate(null)).toBeNull();
    expect(isoToPersianDate('')).toBeNull();
    // A bad server value must show an empty field, not throw during render.
    expect(isoToPersianDate('not-a-date')).toBeNull();
    expect(isoToPersianDate('2024-02-31')).toBeNull();
  });
});

describe('persianDateToIso', () => {
  it.each(PAIRS)('writes the Jalali day back as $iso', ({ iso, jalali }) => {
    const value = toCalendar(
      new CalendarDate(new PersianCalendar(), jalali[0], jalali[1], jalali[2]),
      new PersianCalendar(),
    );

    expect(persianDateToIso(value)).toBe(iso);
  });

  it('returns null for an empty field', () => {
    expect(persianDateToIso(null)).toBe(null);
  });

  it('pads a year below four digits instead of printing it short', () => {
    // Guards the format the backend parses: "0999-01-01", never "999-01-01".
    expect(persianDateToIso(new CalendarDate(999, 1, 1))).toBe('0999-01-01');
  });

  it('round-trips every pair', () => {
    for (const { iso } of PAIRS) {
      expect(persianDateToIso(isoToPersianDate(iso))).toBe(iso);
    }
  });
});

describe('isValidBirthDate', () => {
  it('accepts a real day inside the bounds', () => {
    expect(isValidBirthDate('1993-06-21')).toBe(true);
    expect(isValidBirthDate(`${EARLIEST_BIRTH_YEAR}-01-01`)).toBe(true);
  });

  it('rejects a day before the floor', () => {
    expect(isValidBirthDate(`${EARLIEST_BIRTH_YEAR - 1}-12-31`)).toBe(false);
  });

  it('rejects a day in the future and accepts today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T12:00:00Z'));

    expect(isValidBirthDate('2026-09-13')).toBe(true);
    expect(isValidBirthDate('2026-09-14')).toBe(false);
    expect(isValidBirthDate('2030-01-01')).toBe(false);
  });

  it('rejects a string that is not a real day', () => {
    expect(isValidBirthDate('')).toBe(false);
    expect(isValidBirthDate('1993-13-01')).toBe(false);
    expect(isValidBirthDate('2023-02-29')).toBe(false);
    expect(isValidBirthDate('21/06/1993')).toBe(false);
  });
});

describe('birthDateLocale', () => {
  it('forces the Persian calendar in both interface languages', () => {
    expect(birthDateLocale('fa')).toBe('fa-IR-u-ca-persian');
    expect(birthDateLocale('en')).toBe('en-US-u-ca-persian');
    // i18next can hand back a language with a region attached.
    expect(birthDateLocale('fa-IR')).toBe('fa-IR-u-ca-persian');
    expect(birthDateLocale('en-GB')).toBe('en-US-u-ca-persian');
  });

  it('really resolves to the Persian calendar in the platform Intl', () => {
    for (const language of ['fa', 'en']) {
      const resolved = new Intl.DateTimeFormat(
        birthDateLocale(language),
      ).resolvedOptions();
      expect(resolved.calendar).toBe('persian');
    }
  });
});

describe('the picker bounds', () => {
  it('offers the Persian calendar and spans 1900 to today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T12:00:00Z'));

    const earliest = earliestBirthDate();
    const latest = latestBirthDate();

    expect(earliest.calendar.identifier).toBe('persian');
    expect(latest.calendar.identifier).toBe('persian');
    expect(persianDateToIso(earliest)).toBe(`${EARLIEST_BIRTH_YEAR}-01-01`);
    expect(persianDateToIso(latest)).toBe('2026-09-13');
    expect(earliest.compare(latest)).toBeLessThan(0);
  });
});
