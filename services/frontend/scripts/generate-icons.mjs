// Rasterizes public/icons/*.svg into the PNG sizes the web manifest needs.
// Uses macOS QuickLook (qlmanage); on other platforms use rsvg-convert or ImageMagick instead:
//   rsvg-convert -w 512 -h 512 public/icons/icon.svg > public/icons/icon-512.png
import { execFileSync } from 'node:child_process';
import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const icons = resolve(import.meta.dirname, '../public/icons');
const jobs = [
  ['icon.svg', 512, 'icon-512.png'],
  ['icon.svg', 192, 'icon-192.png'],
  ['icon-maskable.svg', 512, 'icon-maskable-512.png'],
];

for (const [source, size, target] of jobs) {
  const work = mkdtempSync(join(tmpdir(), 'icons-'));
  execFileSync('qlmanage', ['-t', '-s', String(size), '-o', work, join(icons, source)], {
    stdio: 'ignore',
  });
  renameSync(join(work, `${source}.png`), join(icons, target));
  rmSync(work, { recursive: true, force: true });
  console.log(`wrote ${target}`);
}
