import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTestBrowserEnv, browserTestOptions } from './helpers/browser-env.mjs';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runEwsWeb } from '../ews-web.mjs';
import { runPreviewFirst } from '../preview-first.mjs';
import { resolveStop1BrowserTools } from '../lib/browser-session.mjs';
import {
  defaultConfig, defaultDesignations, makeLark, writeAssets, writeReadyPack,
} from './helpers/ready-fixture.mjs';

applyTestBrowserEnv();

function tmp(name) {
  return mkdtempSync(join(tmpdir(), name));
}

function buildSyntheticDemo() {
  const root = tmp('ews-preview-');
  const handoff = join(root, 'handoff');
  const docs = writeReadyPack(handoff);
  const assetsDir = join(root, 'assets');
  writeAssets(assetsDir, docs);
  writeFileSync(join(root, 'config.json'), `${JSON.stringify(defaultConfig(docs), null, 2)}\n`);
  writeFileSync(join(root, 'lark.json'), `${JSON.stringify(makeLark(), null, 2)}\n`);
  writeFileSync(join(root, 'designations.json'), `${JSON.stringify(defaultDesignations(), null, 2)}\n`);
  const out = join(root, 'out');
  const built = runEwsWeb([
    '--handoff', handoff,
    '--assets', join(assetsDir, 'asset-map.json'),
    '--config', join(root, 'config.json'),
    '--lark', join(root, 'lark.json'),
    '--designations', join(root, 'designations.json'),
    '--out', out,
  ], { cwd: root });
  assert.equal(built.ok, true, (built.problems || []).join('\n'));
  return { root, handoff, out, docs };
}

test('preview:first missing demo files is red without skip', async () => {
  const empty = tmp('ews-preview-empty-');
  const result = await runPreviewFirst(['--demo', empty, '--handoff', empty], { cwd: empty });
  assert.equal(result.ok, false);
  assert.equal(result.gate, 'preview:first');
  assert.ok(result.problems.some((item) => item.includes('index.html')));
});

test('preview:first missing shared stop1 tools fail closed', async () => {
  const { handoff, out } = buildSyntheticDemo();
  const fakeRoot = tmp('ews-preview-notools-');
  const result = await runPreviewFirst(
    ['--demo', out, '--handoff', handoff, '--artifacts', join(fakeRoot, 'art')],
    { cwd: fakeRoot, skillRoot: fakeRoot },
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((item) => item.includes('缺少仓内 stop1 浏览器工具')));
});

test('preview:first fingerprint mismatch is red', async () => {
  const { handoff, out } = buildSyntheticDemo();
  const provenancePath = join(out, 'provenance.json');
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
  provenance.fingerprint = 'deadbeefdeadbeef';
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
  const result = await runPreviewFirst(
    ['--demo', out, '--handoff', handoff, '--artifacts', join(out, 'artifacts', 'stop1')],
    { cwd: out },
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((item) => item.includes('fingerprint 不一致')));
});

test('browser-session does not name sibling skills', () => {
  const skillRoot = join(process.cwd());
  const tools = resolveStop1BrowserTools(skillRoot);
  assert.equal(tools.ok, true, (tools.problems || []).join('\n'));
  const source = readFileSync(join(skillRoot, 'scripts/lib/browser-session.mjs'), 'utf8');
  assert.equal(source.includes('yise-web-ui'), false);
  assert.equal(source.includes('torchlight-web'), false);
});

test('preview:first synthetic demo is live green or chromium fail-closed', browserTestOptions({ timeout: 120000 }), async () => {
  const { handoff, out } = buildSyntheticDemo();
  const artifacts = join(out, 'artifacts', 'stop1');
  mkdirSync(artifacts, { recursive: true });
  const result = await runPreviewFirst(
    ['--demo', out, '--handoff', handoff, '--artifacts', artifacts],
    { cwd: out },
  );
  if (result.ok) {
    assert.equal(result.gate, 'preview:first');
    assert.ok(existsSync(join(artifacts, 'preview-first.png')));
    assert.ok(existsSync(join(artifacts, 'preview-first.json')));
    assert.ok(result.shot.rootWidth > 1);
    return;
  }
  const text = (result.problems || []).join('\n');
  assert.match(text, /无法启动 Chromium|缺少仓内 stop1 浏览器工具/);
});
