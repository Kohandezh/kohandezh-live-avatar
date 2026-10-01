import { formatNumber } from '@/i18n';

/** Which `library.lead.<label>` names a phone number. */
export type ContactPhoneLabel = 'office' | 'sales';

export interface ContactPhone {
  label: ContactPhoneLabel;
  /** As dialled inside Iran, 11 digits. Shown grouped by `formatPhoneNumber`. */
  number: string;
  href: `tel:${string}`;
}

/**
 * The contact channels of the lead card (REQ-076), in the one place they are configured.
 *
 * Fixed values, never built from server data, so no response can change where a `tel:`, `mailto:`
 * or web link points (SEC-007). The same numbers are spoken inside some recorded answers, so a
 * change here also means those answers need a new render.
 */
export const CONTACT_CHANNELS: {
  phones: readonly ContactPhone[];
  email: { address: string; href: `mailto:${string}` };
  website: { address: string; href: `https://${string}` };
} = {
  phones: [
    { label: 'office', number: '02126230054', href: 'tel:+982126230054' },
    { label: 'office', number: '02126230047', href: 'tel:+982126230047' },
    { label: 'sales', number: '02176222351', href: 'tel:+982176222351' },
    { label: 'sales', number: '02176222354', href: 'tel:+982176222354' },
  ],
  email: {
    address: 'info@kohansystemfarda.com',
    href: 'mailto:info@kohansystemfarda.com',
  },
  website: {
    address: 'kohansystemfarda.com',
    href: 'https://kohansystemfarda.com',
  },
};

/**
 * "021 2623 0054": grouped 3-4-4, in Persian digits in `fa`. Digit by digit, because a number
 * format would drop the leading zero and add thousands separators.
 */
export function formatPhoneNumber(number: string, language: string): string {
  const digits = Array.from(number, (digit) => formatNumber(Number(digit), language)).join('');
  return [digits.slice(0, 3), digits.slice(3, 7), digits.slice(7)].join(' ');
}
