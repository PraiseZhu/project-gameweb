import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CLI = join(ROOT, 'scripts/figma-fonts.mjs');
function demoWithTruth(family = 'Test Face') {
  const demo = mkdtempSync(join(tmpdir(), 'figma-fonts-demo-'));
  writeFileSync(join(demo, 'truth.json'), JSON.stringify({ design: { fileVersion: 'fixture' }, sections: { one: { nodes: [{ id: 'text-1', name: 'title', text: { fontFamily: family, fontWeight: 700, characters: 'Hello' } }] } } }));
  writeFileSync(join(demo, 'index.html'), '<html><head></head><body><script id="qa-assets" type="application/json">{}</script></body></html>');
  return demo;
}
function fontRoot({ registry = null, binary = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'figma-fonts-root-'));
  if (registry) writeFileSync(join(root, 'registry.json'), JSON.stringify(registry));
  if (binary != null) writeFileSync(join(root, 'test.woff2'), Buffer.from(binary));
  return root;
}
function run(demo, root, extra = []) {
  return spawnSync(process.execPath, [CLI, '--demo', demo, '--font-root', root, ...extra], { cwd: ROOT, encoding: 'utf8' });
}

test('font registry missing is a hard blocked failure', () => {
  const result = run(demoWithTruth(), mkdtempSync(join(tmpdir(), 'figma-fonts-none-')));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /缺字体登记册/);
});

test('registered font file missing exits fail-closed and records no silent substitute', () => {
  const root = fontRoot({ registry: { families: { 'Test Face': { file: 'test.woff2', weight: 700, format: 'woff2', source: 'fixture', license: 'fixture' } } } });
  const demo = demoWithTruth();
  const result = run(demo, root);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  const manifest = JSON.parse(readFileSync(join(demo, 'fonts-manifest.json'), 'utf8'));
  assert.equal(manifest.counts.missing, 1);
  assert.match(manifest.missing[0].why, /文件不在/);
  assert.equal(Object.keys(manifest.fonts).length, 0);
});

test('known font copies to demo, writes provenance manifest, and injects exact @font-face', () => {
  const root = fontRoot({ binary: 'licensed-test-font', registry: { families: { 'Test Face': { file: 'test.woff2', weight: 700, format: 'woff2', source: 'local fixture', license: 'test license' } } } });
  const demo = demoWithTruth();
  const result = run(demo, root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(existsSync(join(demo, 'assets/fonts/test.woff2')));
  const manifest = JSON.parse(readFileSync(join(demo, 'fonts-manifest.json'), 'utf8'));
  assert.equal(manifest.counts.missing, 0);
  assert.equal(manifest.fonts['Test Face'].file, 'assets/fonts/test.woff2');
  assert.equal(manifest.fonts['Test Face'].source, 'local fixture');
  const html = readFileSync(join(demo, 'index.html'), 'utf8');
  assert.match(html, /@font-face\{font-family:"Test Face";src:url\("assets\/fonts\/test\.woff2"\)/);
});


test('unregistered design family remains missing instead of being silently substituted', () => {
  const root = fontRoot({ binary: 'some-other-font', registry: { families: { 'Other Face': { file: 'test.woff2', weight: 400, format: 'woff2', source: 'fixture', license: 'fixture' } } } });
  const demo = demoWithTruth('Missing Face');
  const result = run(demo, root);
  assert.equal(result.status, 2);
  const manifest = JSON.parse(readFileSync(join(demo, 'fonts-manifest.json'), 'utf8'));
  assert.equal(manifest.fonts['Missing Face'], undefined);
  assert.equal(manifest.missing[0].family, 'Missing Face');
});

function demoWithPlatformsTruth() {
  const demo = mkdtempSync(join(tmpdir(), 'figma-fonts-platforms-'));
  writeFileSync(join(demo, 'truth.json'), JSON.stringify({
    design: { fileVersion: 'fixture-platforms' },
    platforms: {
      desktop: {
        sections: { one: { nodes: [{ id: 'desktop-section', name: 'desktop title', text: { fontFamily: 'Desktop Face', fontWeight: 700, characters: 'Desktop' } }] } },
        fixedOverlays: { nodes: [{ id: 'desktop-nav', name: 'desktop nav', text: { fontFamily: { value: 'Overlay Face', provenance: { source: 'figma' } }, fontWeight: { value: 400, provenance: { source: 'figma' } }, characters: { value: 'Overlay', provenance: { source: 'figma' } } } }] },
      },
      mobile: {
        sections: { one: { nodes: [{ id: 'mobile-section', name: 'mobile title', text: { fontFamily: 'Mobile Face', fontWeight: 400, characters: 'Mobile' } }] } },
        modals: [{ nodes: [{ id: 'mobile-modal', name: 'modal label', text: { fontFamily: 'Modal Face', fontWeight: 400, characters: 'Modal' } }] }],
        pageChrome: { nodes: [{ id: 'mobile-chrome', name: 'chrome', text: { fontFamily: 'Chrome Face', fontWeight: 400, characters: 'Chrome' } }] },
      },
    },
  }));
  writeFileSync(join(demo, 'index.html'), '<html><head></head><body><script id="qa-assets" type="application/json">{}</script></body></html>');
  return demo;
}

function multiFaceRoot() {
  const families = {};
  for (const family of ['Desktop Face', 'Overlay Face', 'Mobile Face', 'Modal Face', 'Chrome Face']) {
    const file = family.replace(/ /g, '-').toLowerCase() + '.woff2';
    families[family] = { file, weight: family === 'Desktop Face' ? 700 : 400, format: 'woff2', source: 'local fixture', license: 'test license' };
  }
  const root = fontRoot({ registry: { families } });
  for (const entry of Object.values(families)) writeFileSync(join(root, entry.file), Buffer.from(entry.file));
  return root;
}

test('platforms-only truth collects desktop and mobile section fonts plus modal, fixed overlay, and page chrome text', () => {
  const demo = demoWithPlatformsTruth();
  const result = run(demo, multiFaceRoot());
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const manifest = JSON.parse(readFileSync(join(demo, 'fonts-manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest.fonts).sort(), ['Chrome Face', 'Desktop Face', 'Mobile Face', 'Modal Face', 'Overlay Face']);
  assert.equal(manifest.fonts['Overlay Face'].nodes, 1);
  assert.equal(manifest.fonts['Desktop Face'].nodes, 1);
  assert.equal(manifest.fonts['Mobile Face'].nodes, 1);
});

test('wrapped provenance font text is unwrapped before font usage collection', () => {
  const demo = demoWithPlatformsTruth();
  const result = run(demo, multiFaceRoot());
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const manifest = JSON.parse(readFileSync(join(demo, 'fonts-manifest.json'), 'utf8'));
  assert.equal(manifest.fonts['Overlay Face'].designWeights[0], 400);
  assert.equal(manifest.fonts['Overlay Face'].nodes, 1);
});

