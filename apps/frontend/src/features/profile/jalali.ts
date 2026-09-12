import {
  CalendarDate,
  GregorianCalendar,
  PersianCalendar,
  getLocalTimeZone,
  parseDate,
  toCalendar,
  today,
  type DateValue,
} from '@internationalized/date';

/**
 * The Jalali (Solar Hijri) birthday, and the one place that converts between it and the
 * Gregorian `YYYY-MM-DD` string the API stores.
 *
 * Why no new date library: `@internationalized/date` ships `PersianCalendar` and is already the
 * engine behind every HeroUI date component (it comes in through React Aria). Declaring it in
 * package.json costs no extra download and gives a conversion that React Aria itself uses, so
 * the picker and the stored value can never disagree.
 *
 * Wire format is Gregorian on purpose. It is what PostgreSQL `DATE` holds, what every other
 * system understands, and it sorts. Jalali exists only in the UI layer.
 */

/**
 * Oldest birthday the app accepts. Anything earlier is a typo, not a person.
 * Mirrors `EARLIEST_BIRTH_DATE` in `apps/api/services/orchestrator/src/schemas.py`; change both
 * together.
 */
export const EARLIEST_BIRTH_YEAR = 1900;

/**
 * "Today" has to be the user's own today. Iran is UTC+3:30, so between midnight and 03:30 local
 * the UTC day is still yesterday, and a birthday entered as today would be read as a future
 * date. Only used for the upper bound, never stored.
 */
function currentDay(): CalendarDate {
  return today(getLocalTimeZone());
}

/**
 * The locale the birthday field runs under: the app's language, with the calendar forced to
 * Persian through the Unicode `-u-ca-` extension.
 *
 * Forcing the calendar rather than relying on the language is deliberate. `fa-IR` already
 * resolves to the Persian calendar, but `en-US` does not, and the birthday has to stay Jalali in
 * both languages. Keeping the language half intact is what gives each one the right digits and
 * the right text direction: `fa-IR-u-ca-persian` prints "۳۱ خرداد ۱۳۷۲" right to left,
 * `en-US-u-ca-persian` prints "Khordad 31, 1372 AP" left to right.
 *
 * Takes the raw i18next language string, which can carry a region ("fa-IR"), so it matches on
 * the prefix rather than on equality.
 */
export function birthDateLocale(language: string): string {
  return language.startsWith('fa')
    ? 'fa-IR-u-ca-persian'
    : 'en-US-u-ca-persian';
}

/** Today, in the Persian calendar. The newest birthday anyone can have. */
export function latestBirthDate(): CalendarDate {
  return toCalendar(currentDay(), new PersianCalendar());
}

/** 1 Farvardin of the Gregorian year `EARLIEST_BIRTH_YEAR`, in the Persian calendar. */
export function earliestBirthDate(): CalendarDate {
  return toCalendar(
    new CalendarDate(EARLIEST_BIRTH_YEAR, 1, 1),
    new PersianCalendar(),
  );
}

/**
 * Gregorian `YYYY-MM-DD` from the API to a Persian-calendar value for the picker.
 * Returns null for null and for anything that is not a real date, so a bad server value shows an
 * empty field instead of throwing during render.
 */
export function isoToPersianDate(iso: string | null): CalendarDate | null {
  if (!iso) return null;
  try {
    return toCalendar(parseDate(iso), new PersianCalendar());
  } catch {
    return null;
  }
}

/**
 * A picker value back to the Gregorian `YYYY-MM-DD` the API stores.
 *
 * `toCalendar` to the Gregorian calendar first: `toString()` on a Persian-calendar date prints
 * the Persian year, which the backend would read as a Gregorian one.
 */
export function persianDateToIso(value: DateValue | null): string | null {
  if (!value) return null;
  const gregorian = toCalendar(value, new GregorianCalendar());
  const year = String(gregorian.year).padStart(4, '0');
  const month = String(gregorian.month).padStart(2, '0');
  const day = String(gregorian.day).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Whether an ISO day is a birthday a living person could have.
 *
 * The same two bounds the picker enforces and the backend re-checks. Kept here as a plain
 * function so the Zod schema can use it without importing React.
 */
export function isValidBirthDate(iso: string): boolean {
  let parsed: CalendarDate;
  try {
    parsed = parseDate(iso);
  } catch {
    return false;
  }
  if (parsed.year < EARLIEST_BIRTH_YEAR) return false;
  return parsed.compare(currentDay()) <= 0;
}
