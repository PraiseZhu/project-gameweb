import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const INIT = join(ROOT, 'scripts/init.mjs');
const INLINE = join(ROOT, 'scripts/figma-inline.mjs');

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
  });
}

function json(res) {
  return JSON.parse(res.stdout);
}

test('fresh classic init can run the first figma-inline step without manual marker edits', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'inline-contract-')), 'demo');
  const init = run(INIT, ['--dir', dir, '--name', 'fresh-demo']);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  const indexPath = join(dir, 'index.html');
  assert.ok(existsSync(indexPath), 'init must create index.html');

  const before = readFileSync(indexPath, 'utf8');
  for (const marker of [
    'FIGMA_RENDER_BEGIN',
    'FIGMA_RENDER_END',
    'FIGMA_CHROME_BEGIN',
    'FIGMA_CHROME_END',
    'QA_CHROME_BEGIN',
    'QA_CHROME_END',
  ]) {
    assert.ok(before.includes(marker), `fresh index.html missing ${marker}`);
  }
  assert.ok(!before.includes('{{FIGMA_RENDER}}'));
  assert.ok(!before.includes('{{FIGMA_CHROME}}'));
  assert.ok(!before.includes('{{QA_CHROME}}'));

  const inline = run(INLINE, ['--demo', dir]);
  assert.equal(inline.status, 0, inline.stderr || inline.stdout);
  const inlineOut = json(inline);
  assert.equal(inlineOut.ok, true);
  assert.deepEqual(inlineOut.parts.map((p) => p.part), ['render', 'chrome']);

  const check = run(INLINE, ['--demo', dir, '--check']);
  assert.equal(check.status, 0, check.stderr || check.stdout);
  const checkOut = json(check);
  assert.equal(checkOut.ok, true);
  assert.deepEqual(checkOut.parts.map((p) => [p.part, p.same]), [['render', true], ['chrome', true]]);
});

test('init and figma-inline share the inline marker contract module', () => {
  const initSrc = readFileSync(INIT, 'utf8');
  const inlineSrc = readFileSync(INLINE, 'utf8');
  assert.match(initSrc, /from '\.\/lib\/inline-markers\.mjs'/);
  assert.match(inlineSrc, /from '\.\/lib\/inline-markers\.mjs'/);
  assert.ok(!/begin:\s*['"`]\/\* FIGMA_RENDER_BEGIN/.test(inlineSrc), 'figma-inline must not define render markers locally');
  assert.ok(!/end:\s*['"`]\/\* FIGMA_RENDER_END/.test(inlineSrc), 'figma-inline must not define render markers locally');
});
