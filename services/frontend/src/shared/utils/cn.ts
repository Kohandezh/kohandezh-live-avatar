/** Tiny className joiner for our own elements; HeroUI components accept plain className strings. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
