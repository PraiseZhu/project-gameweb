// lib-sync-subdir.test.mjs — figma-lib-sync 子目录结构回归。
//
// 背景：真源 scripts/lib/translation/locale-policy.mjs 住在子目录里，
// figma-copy-coverage.mjs 用 './translation/locale-policy.mjs' 引它。
// sync 若把 demo/lib 平铺成单层（只取 basename），trusted-copy 整树复制后
// './translation/...' 解析不到 → verify 门 A 报 ERR_MODULE_NOT_FOUND（extractorDrift:error）。
// 这条测试锁死「子目录必须保留」，防回退。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SYNC = join(ROOT, 'scripts/figma-lib-sync.mjs');

function runSync(demoDir, extra = []) {
  return spawnSync(process.execPath, [SYNC, '--demo', demoDir, ...extra], { encoding: 'utf8' });
}

test('lib-sync maps ./lib/translation/<x> back to scripts/lib/translation/<x> and keeps the subdir', () => {
  const demo = mkdtempSync(join(tmpdir(), 'libsync-demo-'));
  mkdirSync(join(demo, 'lib'), { recursive: true });
  const extractorSrc = "import { collectFigmaTexts } from './lib/figma-copy-coverage.mjs';\nexport {};\n";
  const coverageSrc = "import { DEFAULT_TRANSLATION_LANGUAGES } from './translation/locale-policy.mjs';\nexport function collectFigmaTexts() { return DEFAULT_TRANSLATION_LANGUAGES; }\n";
  writeFileSync(join(demo, 'extract.mjs'), extractorSrc);
  writeFileSync(join(demo, 'lib', 'figma-copy-coverage.mjs'), coverageSrc);
  const res = runSync(demo);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.ok(existsSync(join(demo, 'lib', 'translation', 'locale-policy.mjs')),
    'translation/locale-policy.mjs must be copied into the subdirectory, not flattened');
});

test('lib-sync closure includes customGate script dependencies (gateX snapshot import fix)', () => {
  /* verify gateX runs customGate scripts inside a trusted-copy tree that only
     contains the demo dir. A gate script importing skill lib via ./lib/<x>
     resolves only when lib-sync copies that dependency into demo/lib. Seed the
     closure from spec.customGates so the gate's own import chain is covered. */
  const demo = mkdtempSync(join(tmpdir(), 'libsync-gatex-'));
  mkdirSync(join(demo, 'lib'), { recursive: true });
  writeFileSync(join(demo, 'extract.mjs'), 'export {};' + String.fromCharCode(10));
  writeFileSync(join(demo, '_gate.mjs'), "import { collectFigmaTexts } from './lib/figma-copy-coverage.mjs';" + String.fromCharCode(10) + 'export { collectFigmaTexts };' + String.fromCharCode(10));
  writeFileSync(join(demo, 'spec.json'), JSON.stringify({ customGates: [{ id: 'g', script: '_gate.mjs' }] }));
  const res = runSync(demo);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.ok(existsSync(join(demo, 'lib', 'figma-copy-coverage.mjs')),
    'customGate script dependency must be copied into demo/lib');
  assert.ok(existsSync(join(demo, 'lib', 'translation', 'locale-policy.mjs')),
    'transitive subdirectory dependency must follow');
});
