import { z } from 'zod';

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/**
 * Converts Persian and Arabic-Indic digits to ASCII.
 * Users on a Persian keyboard often type numbers this way.
 * Exported so the OTP input can normalize each keystroke: `InputOTP`'s
 * `pattern` is ASCII-only, so a Persian digit would otherwise be swallowed
 * silently instead of being converted.
 */
export function toAsciiDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (char) => {
    const persianIndex = PERSIAN_DIGITS.indexOf(char);
    if (persianIndex !== -1) return String(persianIndex);
    const arabicIndex = ARABIC_INDIC_DIGITS.indexOf(char);
    return arabicIndex !== -1 ? String(arabicIndex) : char;
  });
}

/**
 * Normalizes a phone number the user typed: ASCII digits only, no spaces or
 * dashes, and an Iranian local number ("09...") becomes E.164 ("+989...").
 * A number that already starts with "+" or "00" keeps its own country code.
 */
export function normalizePhone(input: string): string {
  const compact = toAsciiDigits(input).trim().replace(/[\s-]/g, '');

  if (compact.startsWith('+')) {
    return `+${compact.slice(1).replace(/\D/g, '')}`;
  }
  if (compact.startsWith('0098')) {
    return `+${compact.slice(2).replace(/\D/g, '')}`;
  }
  if (compact.startsWith('09')) {
    return `+98${compact.slice(1).replace(/\D/g, '')}`;
  }
  return compact.replace(/\D/g, '');
}

/** "+" followed by a country code and subscriber number, 8 to 15 digits total. */
const PHONE_PATTERN = /^\+\d{8,15}$/;

/**
 * Messages are i18n keys. The form translates them with t().
 * The schema output is already normalized, so callers get a clean E.164 value.
 */
export const phoneSchema = z
  .string()
  .min(1, { error: 'auth.errors.invalidPhone' })
  .transform((value) => normalizePhone(value))
  .refine((value) => PHONE_PATTERN.test(value), {
    error: 'auth.errors.invalidPhone',
  });

export type PhoneInput = z.infer<typeof phoneSchema>;

/** Exactly 6 digits. Accepts Persian/Arabic-Indic digits and normalizes them first. */
export const codeSchema = z
  .string()
  .transform((value) => toAsciiDigits(value).replace(/\s/g, ''))
  .refine((value) => /^\d{6}$/.test(value), {
    error: 'auth.errors.invalidCode',
  });

export type CodeInput = z.infer<typeof codeSchema>;
