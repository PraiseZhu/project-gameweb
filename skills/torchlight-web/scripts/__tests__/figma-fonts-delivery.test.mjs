import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appleSdGothicLocalAvailable,
  codepointsToCover,
  hangulLocalFallbackStatus,
  missingGlyphsInFont,
  readFontNameIdentity,
  semiCondensedIdentityOk,
  uncoveredCodepoints,
} from '../lib/font-cmap-coverage.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CLI = join(ROOT, 'scripts/figma-fonts.mjs');
const LATIN_FONT = join(ROOT, 'fonts/NotoSans-Variable-latin.woff2');
const SC_FONT = join(ROOT, 'fonts/NotoSans-SemiCondensed.ttf');
function latinBytes() {
  return readFileSync(LATIN_FONT);
}
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
  const root = fontRoot({ binary: latinBytes(), registry: { families: { 'Test Face': { file: 'test.woff2', weight: 700, format: 'woff2', source: 'local fixture', license: 'test license' } } } });
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

test('YouHei @font-face does not pin Regular named instance so Bold/900 can use wght axis', () => {
  /* CI lock: inventory fontWeight=900 / Bold must reach the wght axis.
     font-named-instance:"Regular" nails wght=600 and fake-bolds 900. */
  const family = 'FZVariable-YouHeiS WT W H';
  const root = fontRoot({
    binary: latinBytes(),
    registry: {
      families: {
        [family]: {
          file: 'test.woff2',
          weight: '100 900',
          format: 'truetype',
          source: 'fixture',
          license: 'fixture',
        },
      },
    },
  });
  const demo = demoWithTruth(family);
  const result = run(demo, root);
  const html = readFileSync(join(demo, 'index.html'), 'utf8');
  const src = readFileSync(join(ROOT, 'scripts/figma-fonts.mjs'), 'utf8');
  assert.match(html, /@font-face\{font-family:"FZVariable-YouHeiS WT W H"/);
  assert.doesNotMatch(html, /font-named-instance/);
  const facePush = src.match(/faces\.push\(\s*`[\s\S]*?`\s*\)/);
  assert.ok(facePush, 'figma-fonts must emit @font-face via faces.push');
  assert.doesNotMatch(facePush[0], /font-named-instance/);
  assert.match(html, /font-weight:100 900/);
});


test('unregistered design family remains missing instead of being silently substituted', () => {
  const root = fontRoot({ binary: latinBytes(), registry: { families: { 'Other Face': { file: 'test.woff2', weight: 400, format: 'woff2', source: 'fixture', license: 'fixture' } } } });
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
  const latin = latinBytes();
  for (const entry of Object.values(families)) writeFileSync(join(root, entry.file), latin);
  return root;
}

test('codepointsToCover skips whitespace and keeps Hangul', () => {
  assert.deepEqual(codepointsToCover('A 한\n').sort((a, b) => a - b), [0x41, 0xd55c]);
});

test('uncoveredCodepoints reports Hangul missing from a latin cmap', () => {
  const latin = new Set([0x41, 0x42]);
  assert.deepEqual(uncoveredCodepoints(latin, 'AB한'), [0xd55c]);
});

test('registered latin file covering Hello stays green', () => {
  assert.deepEqual(missingGlyphsInFont(LATIN_FONT, 'Hello'), []);
});

test('cmap gap for Hangul on SemiCondensed is fail-closed and lists the codepoint', () => {
  const root = mkdtempSync(join(tmpdir(), 'figma-fonts-sc-'));
  writeFileSync(join(root, 'registry.json'), JSON.stringify({
    families: {
      'Noto Sans': { file: 'NotoSans-SemiCondensed.ttf', weight: 400, format: 'truetype', source: 'fixture', license: 'OFL' },
      'Noto Sans SemiCondensed': { file: 'NotoSans-SemiCondensed.ttf', weight: 400, format: 'truetype', source: 'fixture', license: 'OFL' },
    },
  }));
  copyFileSync(SC_FONT, join(root, 'NotoSans-SemiCondensed.ttf'));
  const demo = mkdtempSync(join(tmpdir(), 'figma-fonts-hangul-'));
  writeFileSync(join(demo, 'truth.json'), JSON.stringify({
    design: { fileVersion: 'fixture-hangul' },
    sections: {
      one: {
        nodes: [{
          id: '949:5671',
          name: 'kr legal',
          text: {
            fontFamily: 'Noto Sans',
            fontStyle: 'SemiCondensed',
            fontPostScriptName: 'NotoSans-SemiCondensed',
            fontWeight: 400,
            characters: 'Hello한',
          },
        }],
      },
    },
  }));
  writeFileSync(join(demo, 'index.html'), '<html><head></head><body><script id="qa-assets" type="application/json">{}</script></body></html>');
  const result = run(demo, root);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  const manifest = JSON.parse(readFileSync(join(demo, 'fonts-manifest.json'), 'utf8'));
  const gap = (manifest.missing || []).find((item) => /cmap|盖不住/.test(item.why || ''));
  assert.ok(gap, JSON.stringify(manifest.missing, null, 2));
  assert.equal(gap.family, 'Noto Sans SemiCondensed');
  assert.match(gap.why, /U\+D55C/);
  assert.equal(gap.examples[0].nodeId, '949:5671');
  assert.doesNotMatch(JSON.stringify(gap), /Apple SD Gothic|Noto Sans KR/);
});

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

test('SemiCondensed 登记文件必须是 SemiCondensed 身份，KR-VF 冒充要红', () => {
  const sc = readFontNameIdentity(SC_FONT);
  assert.equal(semiCondensedIdentityOk(sc), true, JSON.stringify(sc));
  const krPath = join(ROOT, 'fonts/NotoSansKR-VF.ttf');
  if (!existsSync(krPath)) return;
  const kr = readFontNameIdentity(krPath);
  assert.equal(semiCondensedIdentityOk(kr), false, JSON.stringify(kr));

  const root = mkdtempSync(join(tmpdir(), 'figma-fonts-kr-as-sc-'));
  writeFileSync(join(root, 'registry.json'), JSON.stringify({
    families: {
      'Noto Sans SemiCondensed': { file: 'NotoSansKR-VF.ttf', weight: 400, format: 'truetype', source: 'wrong', license: 'OFL' },
    },
  }));
  copyFileSync(krPath, join(root, 'NotoSansKR-VF.ttf'));
  const demo = mkdtempSync(join(tmpdir(), 'figma-fonts-kr-demo-'));
  writeFileSync(join(demo, 'truth.json'), JSON.stringify({
    design: { fileVersion: 'fixture-identity' },
    sections: { one: { nodes: [{ id: '949:5671', name: 'kr legal', text: { fontFamily: 'Noto Sans', fontStyle: 'SemiCondensed', fontPostScriptName: 'NotoSans-SemiCondensed', fontWeight: 400, characters: 'Hello한' } }] } },
  }));
  writeFileSync(join(demo, 'index.html'), '<html><head></head><body><script id="qa-assets" type="application/json">{}</script></body></html>');
  const result = run(demo, root);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  const manifest = JSON.parse(readFileSync(join(demo, 'fonts-manifest.json'), 'utf8'));
  const gap = (manifest.missing || []).find((item) => /SemiCondensed 身份|冒充|KR-VF|NotoSansKR/i.test(JSON.stringify(item)));
  assert.ok(gap, JSON.stringify(manifest.missing, null, 2));
});

test('Apple SD Gothic 只许 local()，fonts/ 与产物不得出现 ttc 拷贝', () => {
  const files = readdirSync(join(ROOT, 'fonts'));
  assert.equal(files.filter((name) => /\.ttc$/i.test(name)).length, 0);
  const reg = JSON.parse(readFileSync(join(ROOT, 'fonts/registry.json'), 'utf8'));
  for (const [family, entry] of Object.entries(reg.families || {})) {
    assert.doesNotMatch(String(entry.file || ''), /\.ttc$/i, family);
  }
  const renderer = readFileSync(join(ROOT, 'templates/figma-render.js'), 'utf8');
  const faceAt = renderer.indexOf('font-family:"FX Apple SD Gothic Neo"');
  assert.ok(faceAt > 0);
  const face = renderer.slice(faceAt, faceAt + 280);
  assert.match(face, /src:local\(/);
  assert.doesNotMatch(face, /url\(/);
  assert.doesNotMatch(face, /\.ttc/);
});

test('local() 缺失时 5671 韩文标未验证，不能当已验收', () => {
  const missing = hangulLocalFallbackStatus({
    localAvailable: false,
    nodes: [{ nodeId: '949:5671', characters: '한' }],
    nodeId: '949:5671',
  });
  assert.equal(missing.unverified, true);
  assert.match(missing.why, /未验证/);
  const present = hangulLocalFallbackStatus({
    localAvailable: true,
    nodes: [{ nodeId: '949:5671', characters: '한' }],
  });
  assert.equal(present.unverified, false);
  void appleSdGothicLocalAvailable;
});

