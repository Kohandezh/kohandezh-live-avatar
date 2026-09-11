import { describe, expect, it } from 'vitest';
import {
  codeSchema,
  normalizePhone,
  phoneSchema,
} from '@/features/authentication/schemas';

describe('normalizePhone', () => {
  it('turns an Iranian local number into E.164', () => {
    expect(normalizePhone('09121234567')).toBe('+989121234567');
  });

  it('strips spaces and dashes', () => {
    expect(normalizePhone('0912 123-4567')).toBe('+989121234567');
  });

  it('keeps an existing country code', () => {
    expect(normalizePhone('+989121234567')).toBe('+989121234567');
  });

  it('converts 00 country-code prefixes to +', () => {
    expect(normalizePhone('00989121234567')).toBe('+989121234567');
  });

  it('converts Persian digits to ASCII', () => {
    expect(normalizePhone('۰۹۱۲۱۲۳۴۵۶۷')).toBe('+989121234567');
  });

  it('converts Arabic-Indic digits to ASCII', () => {
    expect(normalizePhone('٠٩١٢١٢٣٤٥٦٧')).toBe('+989121234567');
  });
});

describe('phoneSchema', () => {
  it('accepts and normalizes a local Iranian number', () => {
    expect(phoneSchema.parse('09121234567')).toBe('+989121234567');
  });

  it('accepts a generic +<cc><digits> number', () => {
    expect(phoneSchema.parse('+14155552671')).toBe('+14155552671');
  });

  it('rejects an empty value', () => {
    expect(phoneSchema.safeParse('').success).toBe(false);
  });

  it('rejects a number with too few digits', () => {
    expect(phoneSchema.safeParse('+1234').success).toBe(false);
  });

  it('rejects a number with too many digits', () => {
    expect(phoneSchema.safeParse('+1234567890123456').success).toBe(false);
  });

  it('rejects letters', () => {
    expect(phoneSchema.safeParse('phone-number').success).toBe(false);
  });
});

describe('codeSchema', () => {
  it('accepts a 6-digit code', () => {
    expect(codeSchema.parse('123456')).toBe('123456');
  });

  it('normalizes Persian digits', () => {
    expect(codeSchema.parse('۱۲۳۴۵۶')).toBe('123456');
  });

  it('rejects fewer than 6 digits', () => {
    expect(codeSchema.safeParse('1234').success).toBe(false);
  });

  it('rejects non-digit characters', () => {
    expect(codeSchema.safeParse('12345a').success).toBe(false);
  });
});
