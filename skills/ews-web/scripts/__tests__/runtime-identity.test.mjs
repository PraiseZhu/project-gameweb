import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  publishRuntimeDir,
  runtimeIdentityFromDir,
  stampRuntimeModuleSource,
} from '../lib/runtime-identity.mjs';
import { documentHtml } from '../../assets/runtime/render.mjs';
import { buildSyntheticDemo } from './helpers/build-demo.mjs';

const RUNTIME_SRC = fileURLToPath(new URL('../../assets/runtime', import.meta.url));

test('runtime identity hashes the whole runtime directory, not Figma fingerprint', () => {
  const a = mkdtempSync(join(tmpdir(), 'ews-rt-a-'));
  const b = mkdtempSync(join(tmpdir(), 'ews-rt-b-'));
  writeFileSync(join(a, 'boot.mjs'), "import { x } from './text-style.mjs';\n");
  writeFileSync(join(a, 'text-style.mjs'), 'export const x = 1;\n');
  writeFileSync(join(b, 'boot.mjs'), "import { x } from './text-style.mjs';\n");
  writeFileSync(join(b, 'text-style.mjs'), 'export const x = 1;\n');
  assert.equal(runtimeIdentityFromDir(a), runtimeIdentityFromDir(b));
  writeFileSync(join(b, 'text-style.mjs'), 'export const x = 2;\n');
  assert.notEqual(runtimeIdentityFromDir(a), runtimeIdentityFromDir(b));
});

test('stamp rewrites nested relative imports; documentHtml never uses fingerprint as cache key', () => {
  const stamped = stampRuntimeModuleSource(
    "import { bootQaChrome } from './qa-chrome.mjs';\nexport { isProductView } from './qa-toolbar.mjs';\n",
    'deadbeef',
  );
  assert.match(stamped, /qa-chrome\.mjs\?v=deadbeef/);
  assert.match(stamped, /qa-toolbar\.mjs\?v=deadbeef/);
  assert.doesNotMatch(stamped, /from '\.\/qa-chrome\.mjs';/);
  const html = documentHtml({
    defaultLocale: 'zh-CN',
    locales: ['zh-CN'],
    fingerprint: '5c09dcbad0c4889e',
    screens: ['sec1'],
    assets: { pc: {} },
    platforms: { pc: { designWidth: 1920, nodes: [], screens: [{ key: 'sec1', sectionId: '1:1' }], page: { id: 'page' } } },
    config: { navigation: {}, videos: {}, modals: {}, carousels: [] },
  }, { locale: 'zh-CN', device: 'pc', devices: {}, runtimeIdentity: 'cafe1234' });
  assert.match(html, /boot\.mjs\?v=cafe1234/);
  assert.match(html, /ews\.css\?v=cafe1234/);
  assert.doesNotMatch(html, /boot\.mjs\?v=5c09dcbad0c4889e/);
});

test('generated demo stamps the runtime graph and identity changes when boot changes', () => {
  const { out } = buildSyntheticDemo('ews-runtime-id-');
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  const model = JSON.parse(readFileSync(join(out, 'model.json'), 'utf8'));
  const id = model.runtimeIdentity;
  assert.equal(typeof id, 'string');
  assert.equal(id.length, 16);
  assert.notEqual(id, model.fingerprint);
  assert.match(html, new RegExp(`boot\\.mjs\\?v=${id}`));
  assert.match(html, new RegExp(`ews\\.css\\?v=${id}`));
  const boot = readFileSync(join(out, 'runtime', 'boot.mjs'), 'utf8');
  assert.match(boot, new RegExp(`text-style\\.mjs\\?v=${id}`));
  assert.match(boot, new RegExp(`qa-chrome\\.mjs\\?v=${id}`));
  assert.doesNotMatch(boot, /from '\.\/qa-chrome\.mjs';/);
  const expected = runtimeIdentityFromDir(RUNTIME_SRC);
  assert.equal(id, expected);
  const dest = mkdtempSync(join(tmpdir(), 'ews-rt-pub-'));
  mkdirSync(dest, { recursive: true });
  publishRuntimeDir(RUNTIME_SRC, dest, 'abc');
  assert.match(readFileSync(join(dest, 'ews-screen-runtime.mjs'), 'utf8'), /text-style\.mjs\?v=abc/);
});
