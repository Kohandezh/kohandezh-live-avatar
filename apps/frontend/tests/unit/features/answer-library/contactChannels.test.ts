import { describe, expect, it } from 'vitest';
import {
  CONTACT_CHANNELS,
  formatPhoneNumber,
} from '@/features/answer-library/contactChannels';

/**
 * The contact channels of REQ-076. The links are fixed values, never built from server data
 * (SEC-007), so this file is the one place a reviewer checks where a `tel:`, `mailto:` or web link
 * points.
 */
describe('contact channels (REQ-076, SEC-007, SC-037)', () => {
  it('lists the two office and the two sales numbers, each with its tel: link', () => {
    expect(CONTACT_CHANNELS.phones).toEqual([
      { label: 'office', number: '02126230054', href: 'tel:+982126230054' },
      { label: 'office', number: '02126230047', href: 'tel:+982126230047' },
      { label: 'sales', number: '02176222351', href: 'tel:+982176222351' },
      { label: 'sales', number: '02176222354', href: 'tel:+982176222354' },
    ]);
  });

  it('has the email address and its mailto: link', () => {
    expect(CONTACT_CHANNELS.email).toEqual({
      address: 'info@kohansystemfarda.com',
      href: 'mailto:info@kohansystemfarda.com',
    });
  });

  it('has the website and its https link', () => {
    expect(CONTACT_CHANNELS.website).toEqual({
      address: 'kohansystemfarda.com',
      href: 'https://kohansystemfarda.com',
    });
  });

  it('every tel: link is the number in international form', () => {
    for (const phone of CONTACT_CHANNELS.phones) {
      expect(phone.href).toBe(`tel:+98${phone.number.slice(1)}`);
    }
  });
});

describe('formatPhoneNumber (REQ-076)', () => {
  it('groups the number 3-4-4 with Latin digits in English', () => {
    expect(formatPhoneNumber('02126230054', 'en')).toBe('021 2623 0054');
  });

  it('groups the number 3-4-4 with Persian digits in Persian, keeping the leading zero', () => {
    expect(formatPhoneNumber('02126230054', 'fa')).toBe('۰۲۱ ۲۶۲۳ ۰۰۵۴');
  });
});
