import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runEwsWeb } from '../ews-web.mjs';
import { runReconcilePage } from '../lib/page-reconcile.mjs';
import { PNG_1x1, defaultConfig, defaultDesignations, makeLark, writeAssets, writeReadyPack } from './helpers/ready-fixture.mjs';

function tmp(name) {
  return mkdtempSync(join(tmpdir(), name));
}

function buildSyntheticDemo() {
  const root = tmp('ews-recon-');
  const handoff = join(root, 'handoff');
  const docs = writeReadyPack(handoff);
  const assetsDir = join(root, 'assets');
  writeAssets(assetsDir, docs);
  const configPath = join(root, 'config.json');
  writeFileSync(configPath, `${JSON.stringify(defaultConfig(docs), null, 2)}\n`);
  writeFileSync(join(root, 'lark.json'), `${JSON.stringify(makeLark(), null, 2)}\n`);
  writeFileSync(join(root, 'designations.json'), `${JSON.stringify(defaultDesignations(), null, 2)}\n`);
  const out = join(root, 'out');
  const built = runEwsWeb([
    '--handoff', handoff,
    '--assets', join(assetsDir, 'asset-map.json'),
    '--config', configPath,
    '--lark', join(root, 'lark.json'),
    '--designations', join(root, 'designations.json'),
    '--out', out,
  ], { cwd: root });
  assert.equal(built.ok, true, (built.problems || []).join('\n'));
  return { root, handoff, assetsDir, configPath, out };
}

test('synthetic demo asset reconcile is green for tool regression only', () => {
  const { handoff, assetsDir, configPath, out } = buildSyntheticDemo();
  const result = runReconcilePage([
    '--demo', out,
    '--handoff', handoff,
    '--assets', join(assetsDir, 'asset-map.json'),
    '--config', configPath,
  ], { cwd: out });
  assert.equal(result.ok, true, (result.problems || []).join('\n'));
  assert.equal(result.gate, 'assets-reconcile');
  assert.equal(result.unknownDrawOnly, true);
  assert.ok(result.items.some((item) => item.id === 'pc/100:3'));
});

test('tampered copied PNG keeps original map but is red', () => {
  const { handoff, assetsDir, configPath, out } = buildSyntheticDemo();
  const model = JSON.parse(readFileSync(join(out, 'model.json'), 'utf8'));
  const dest = join(out, model.assets.pc['100:3'].relative);
  writeFileSync(dest, PNG_1x1);
  const result = runReconcilePage([
    '--demo', out,
    '--handoff', handoff,
    '--assets', join(assetsDir, 'asset-map.json'),
    '--config', configPath,
  ], { cwd: out });
  assert.equal(result.ok, false);
  const text = result.problems.join('\n');
  assert.match(text, /sha256 与原输入不符|PNG 空或过小|不等于 pageBox|与目标/);
});

test('missing demo files fail closed', () => {
  const empty = tmp('ews-recon-empty-');
  const result = runReconcilePage([
    '--demo', empty,
    '--handoff', empty,
    '--assets', join(empty, 'asset-map.json'),
    '--config', join(empty, 'config.json'),
  ], { cwd: empty });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((item) => item.includes('缺少')));
});

test('missing copied font is red', () => {
  const { handoff, assetsDir, configPath, out } = buildSyntheticDemo();
  const model = JSON.parse(readFileSync(join(out, 'model.json'), 'utf8'));
  const fontRel = model.assets.fonts[0].relative;
  writeFileSync(join(out, fontRel), '');
  const result = runReconcilePage([
    '--demo', out,
    '--handoff', handoff,
    '--assets', join(assetsDir, 'asset-map.json'),
    '--config', configPath,
  ], { cwd: out });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((item) => /字体|font|sha256/i.test(item)));
});

