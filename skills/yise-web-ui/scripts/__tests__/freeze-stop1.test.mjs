import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeDemo, applyStop1Interaction } from '../freeze/freeze-demo.mjs';
import { assessFrozenStop1, STOP1_BUDGET_BYTES } from '../freeze/stop1-ready.mjs';
import { planAssetReplacements } from '../freeze/replaceable-assets.mjs';
import { resolveChromePath } from '../freeze/chrome-path.mjs';
import { normalizeCopy } from '../lib/figma-copy-normalize.mjs';
import { collectFigmaTexts } from '../lib/figma-copy-coverage.mjs';

const FREEZE_CLI = fileURLToPath(new URL('../freeze/freeze-demo.mjs', import.meta.url));

test('stop1 freeze is under 15MB and turns interaction off only on the frozen page', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yise-freeze-'));
  writeFileSync(join(dir, 'index.html'), '<html><body><img data-asset-purpose="kv" data-asset-platform="pc" data-asset-lang="zh-CN" src="assets/old-name.png"></body></html>');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'old-name.png'), 'png-bytes');
  const result = freezeDemo({ demoDir: dir });
  assert.equal(result.ok, true);
  assert.equal(result.presentPage, true);
  assert.ok(result.bytes < STOP1_BUDGET_BYTES);
  assert.ok(result.bytes > 0);
  const html = readFileSync(result.file, 'utf8');
  assert.match(html, /data-ops-interaction="0"/);
  assert.match(html, /static-assets\/kv\.pc\.zh-CN\.png/);
  assert.doesNotMatch(html, /assets\/old-name\.png/);
  assert.equal(existsSync(join(dir, 'assets', 'old-name.png')), true);
  assert.equal(existsSync(join(dir, 'frozen', 'static-assets', 'kv.pc.zh-CN.png')), true);
  assert.equal(existsSync(join(dir, 'review', 'freeze-manifest.json')), true);
  assert.equal(assessFrozenStop1(dir).ok, true);
});

test('interaction freeze is not the human stop1 page', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yise-freeze-live-'));
  const result = freezeDemo({ demoDir: dir, html: '<html><body>live</body></html>', interaction: true });
  assert.equal(result.presentPage, false);
  assert.match(readFileSync(join(dir, 'frozen', 'stop1.static.html'), 'utf8'), /data-ops-interaction="1"/);
  assert.equal(assessFrozenStop1(dir).reason, 'frozen-stop1-still-interactive');
});

test('asset replacement follows purpose platform language, not the old file name', () => {
  const plan = planAssetReplacements([
    { oldName: 'slice-1187.webp', purpose: 'kv', platform: 'mobile', lang: 'zh-TW' },
    { oldName: 'completely-different.webp', purpose: 'kv', platform: 'mobile', lang: 'zh-TW' },
  ]);
  assert.equal(plan[0].to, plan[1].to);
  assert.equal(plan[0].to, 'kv.mobile.zh-TW.webp');
  assert.notEqual(plan[0].to, 'slice-1187.webp');
});

test('chrome path uses Program Files env and does not hardcode a drive letter', () => {
  const src = readFileSync(new URL('../freeze/chrome-path.mjs', import.meta.url), 'utf8');
  assert.match(src, /ProgramFiles/);
  assert.doesNotMatch(src, /[A-Z]:\\\\/);
  assert.equal(typeof resolveChromePath(), 'string');
});

test('line breaks beside a hyphen stay a layout difference, not a different sentence', () => {
  assert.equal(normalizeCopy('badge -' + String.fromCharCode(10) + 'title'), normalizeCopy('badge - title'));
  assert.notEqual(normalizeCopy('SS5 new'), normalizeCopy('SS5new'));
});

test('hidden and component-set text enter the same copy list', () => {
  const texts = collectFigmaTexts({
    nodes: { page: { document: { id: '1', type: 'FRAME', children: [
      { id: '2', type: 'TEXT', name: 'visible', characters: 'see', visible: true },
      { id: '3', type: 'TEXT', name: 'hidden', characters: 'hide', visible: false },
    ] } } },
    componentSets: { set: { document: { id: '4', type: 'TEXT', name: 'paged', characters: 'page 2' } } },
  });
  assert.deepEqual(texts.map((item) => item.nodeId).sort(), ['2', '3', '4']);
});

test('applyStop1Interaction does not invent interaction off when asked to keep it on', () => {
  assert.match(applyStop1Interaction('<html></html>', { interaction: true }), /data-ops-interaction="1"/);
});

test('applyStop1Interaction writes the switch on html, not on inlined renderer CSS', () => {
  const html = '<html><head><style>html:not([data-ops-interaction="0"]) button{cursor:pointer}</style></head><body>page</body></html>';
  const frozen = applyStop1Interaction(html);
  assert.match(frozen, /<html data-ops-interaction="0">/);
  assert.match(frozen, /html:not\(\[data-ops-interaction="0"\]\) button\{cursor:pointer\}/);
  const live = applyStop1Interaction(html, { interaction: true });
  assert.match(live, /<html data-ops-interaction="1">/);
  assert.match(live, /html:not\(\[data-ops-interaction="0"\]\) button\{cursor:pointer\}/);
  assert.doesNotMatch(live, /<html data-ops-interaction="0">/);
});

test('freeze CLI maps --demo onto demoDir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yise-freeze-cli-'));
  writeFileSync(join(dir, 'index.html'), '<html><body>cli</body></html>');
  const res = spawnSync(process.execPath, [FREEZE_CLI, '--demo', dir], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.presentPage, true);
  assert.match(readFileSync(join(dir, 'frozen', 'stop1.static.html'), 'utf8'), /data-ops-interaction="0"/);
});

test('freeze does not copy a src that leaves the demo dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yise-freeze-inside-'));
  writeFileSync(join(dirname(dir), 'secret.png'), 'secret');
  writeFileSync(join(dir, 'index.html'), '<html><body><img data-asset-purpose="kv" data-asset-platform="pc" data-asset-lang="zh-CN" src="../secret.png"></body></html>');
  const result = freezeDemo({ demoDir: dir });
  assert.equal(result.ok, true);
  assert.equal(existsSync(join(dir, 'frozen', 'static-assets', 'kv.pc.zh-CN.png')), false);
  assert.deepEqual(result.copied, []);
});

test('freezeDemo without demoDir does not freeze the current working directory', () => {
  const result = freezeDemo({});
  assert.equal(result.ok, false);
  assert.equal(result.error, 'missing-demo-dir');
});
