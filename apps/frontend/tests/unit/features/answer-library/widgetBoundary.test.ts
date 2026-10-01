import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The lead card is for `mobile` and `web` only, never the widget (REQ-064, REQ-075). The widget
 * renders `features/assistant`, so neither the widget's entry folder nor that feature may import
 * the answer library. `widget.smoke.spec.ts` checks the running widget; this test fails at the
 * import, before anything runs.
 */

const SRC = path.join(process.cwd(), 'src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe('the widget never reaches the answer library (REQ-064)', () => {
  it.each(['app/widget', 'features/assistant'])(
    'nothing under src/%s imports features/answer-library',
    (folder) => {
      const files = sourceFiles(path.join(SRC, folder));
      expect(files.length).toBeGreaterThan(0);
      const importers = files.filter((file) =>
        /from\s+['"][^'"]*answer-library[^'"]*['"]|import\(\s*['"][^'"]*answer-library/.test(
          readFileSync(file, 'utf8'),
        ),
      );
      expect(importers).toEqual([]);
    },
  );
});
