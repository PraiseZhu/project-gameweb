import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const STOP1_BUDGET_BYTES = 15 * 1024 * 1024;
export const STOP1_FILE = 'stop1.static.html';

export function directoryBytes(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  const walk = (current) => {
    let names;
    try { names = readdirSync(current); } catch { return; }
    for (const name of names) {
      const child = join(current, name);
      let stat;
      try { stat = lstatSync(child); } catch { continue; }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(child);
      else if (stat.isFile()) total += stat.size;
    }
  };
  walk(dir);
  return total;
}

export function assessFrozenStop1(demoDir) {
  const frozenDir = join(demoDir, 'frozen');
  const file = join(frozenDir, STOP1_FILE);
  if (!existsSync(file)) return { ok: false, reason: 'frozen-stop1-missing', presentPage: false };
  const html = readFileSync(file, 'utf8');
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] || '';
  if (!/\bdata-ops-interaction="0"/.test(htmlTag)) {
    return { ok: false, reason: 'frozen-stop1-still-interactive', presentPage: false, file };
  }
  const bytes = directoryBytes(frozenDir);
  if (bytes > STOP1_BUDGET_BYTES) {
    return { ok: false, reason: 'frozen-over-15mb', bytes, budgetBytes: STOP1_BUDGET_BYTES, presentPage: false, file };
  }
  return { ok: true, file, bytes, budgetBytes: STOP1_BUDGET_BYTES, presentPage: true };
}
