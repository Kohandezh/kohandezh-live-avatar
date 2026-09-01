/** Tiny className joiner; replace with clsx if the project grows. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
