import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The app ships in English (LTR) and Persian (RTL), so layout classes must be logical
 * (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`) and not physical (`ml-`, `left-`, ...).
 * A logical class flips with the writing direction. A physical one lands on the wrong side
 * in one of the two languages, and nobody notices until a Persian speaker opens the screen.
 *
 * AGENTS.md states the rule. This test is the part that enforces it. Without it the rule is
 * a sentence in a file that a reviewer has to remember.
 *
 * The one approved exception is the conversation control layer, which is anchored to
 * physical screen corners on purpose. See docs/DECISIONS/0013. That exception is expressed
 * as the named `control-anchor-*` utilities, which is why they are allowed here and why a
 * bare `left-4` in a component still fails.
 */

const SRC = path.join(process.cwd(), 'src');

/**
 * Physical utilities, as they appear inside a `className`.
 *
 * `\b` before each name keeps `overflow-x-auto` and `text-nowrap` out, and the trailing
 * `-value` keeps the word "left" in a comment or a label out: only a real utility matches.
 */
const PHYSICAL = new RegExp(
  [
    String.raw`\b(?:ml|mr|pl|pr)-[a-z0-9.[\]/]+`,
    String.raw`\b(?:left|right)-[a-z0-9.[\]/]+`,
    String.raw`\bborder-[lr]-[a-z0-9.[\]/]+`,
    String.raw`\brounded-(?:[lr]|[tb][lr])-[a-z0-9.[\]/]+`,
    String.raw`\btext-(?:left|right)\b`,
  ].join('|'),
  'g',
);

/**
 * The approved exception. These four names are physical on purpose, they are declared once
 * in globals.css with a comment, and the ADR says who decided it.
 */
const ALLOWED = /\bcontrol-anchor-(?:top|bottom)-(?:left|right)\b/g;

/** A line that genuinely needs a physical value can say so and explain why. */
const OPT_OUT = 'physical-ok:';

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

describe('logical properties', () => {
  it('uses no physical layout utilities in components', () => {
    const offenders: string[] = [];

    for (const file of tsxFiles(SRC)) {
      const lines = readFileSync(file, 'utf8').split('\n');

      lines.forEach((line, index) => {
        if (line.includes(OPT_OUT)) return;

        const found = line.replace(ALLOWED, '').match(PHYSICAL);
        if (!found) return;

        const where = `${path.relative(process.cwd(), file)}:${index + 1}`;
        offenders.push(`${where}  ${found.join(' ')}`);
      });
    }

    expect(
      offenders,
      [
        'Physical layout utilities found. Use the logical form instead:',
        '  ml-/mr- -> ms-/me-, pl-/pr- -> ps-/pe-, left-/right- -> start-/end-,',
        '  border-l-/border-r- -> border-s-/border-e-, text-left/text-right -> text-start/text-end.',
        '',
        'The conversation controls are the one approved exception and they use the named',
        'control-anchor-* utilities. See docs/DECISIONS/0013.',
        '',
        `If a line truly needs a physical value, put "${OPT_OUT} <reason>" on it.`,
      ].join('\n'),
    ).toEqual([]);
  });
});
