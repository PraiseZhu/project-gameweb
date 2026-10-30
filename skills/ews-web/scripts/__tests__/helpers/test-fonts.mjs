/**
 * Register the tracked OFL Source Han Sans woff2 under the CSS family names a test needs.
 * Do not read season fonts from `_tmp/`.
 */
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEST_FONT_WOFF2 = fileURLToPath(new URL('../fixtures/media/source-han-sans.woff2', import.meta.url));

function fileToken(family, weight) {
  return `${String(family).replace(/\s+/g, '-')}-${weight}.woff2`;
}

export function registerTestFont(outDir, { family, weight = 400, fileName } = {}) {
  if (!family) throw new TypeError('registerTestFont 需要 family');
  const fontsDir = join(outDir, 'fonts');
  mkdirSync(fontsDir, { recursive: true });
  const relative = `fonts/${fileName || fileToken(family, weight)}`;
  cpSync(TEST_FONT_WOFF2, join(outDir, relative));
  return {
    family,
    weight,
    format: 'woff2',
    relative,
    url: `./${relative}`,
  };
}

export function registerTestFonts(outDir, slots) {
  return (slots || []).map((slot) => registerTestFont(outDir, slot));
}
