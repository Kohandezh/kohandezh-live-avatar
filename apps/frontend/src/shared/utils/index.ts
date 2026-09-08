export * from './redact';
export * from './wav';

/** Joins class names and drops falsy values. Small helper, no dependency needed. */
export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(' ');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Formats an ISO date string for the given locale. Returns the input if it is not a valid date. */
export function formatDate(
  iso: string,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, options).format(date);
}
