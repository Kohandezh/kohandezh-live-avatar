import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Tailwind's `*-safe` alignment classes compile to `safe center` and the like, with no fallback.
 * iOS WebKit before 17.6 drops such a declaration, so a block loses its centring there (Foreman
 * ruling 12). No component may use one.
 */

const SRC = path.join(process.cwd(), 'src');
const SAFE_ALIGNMENT = /\b(?:justify|items|self|content|place-(?:content|items|self))-[a-z]+-safe\b/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|css)$/.test(name) ? [full] : [];
  });
}

describe('no safe alignment classes (ruling 12)', () => {
  it('no source file uses a *-safe alignment class', () => {
    const found = sourceFiles(SRC).flatMap((file) =>
      (readFileSync(file, 'utf8').match(SAFE_ALIGNMENT) ?? []).map(
        (match) => `${path.relative(SRC, file)}: ${match}`,
      ),
    );
    expect(found).toEqual([]);
  });
});
