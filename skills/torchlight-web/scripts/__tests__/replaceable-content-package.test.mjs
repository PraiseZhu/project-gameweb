import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectReplaceableRecords,
  writeContentPackage,
  rewriteReplaceableSrc,
  embedContentPackageLoader,
  contentPackageLoaderScript,
  normalizeContentRegion,
} from '../lib/replaceable-content-package.mjs';

function node(extra = {}) {
  return {
    id: extra.id || 'n1',
    type: extra.type || 'GROUP',
    name: extra.name || 'img/[replaceable]模块2玩法截图',
    status: extra.status || 'determined',
    replaceable: extra.replaceable ?? true,
    assetKey: extra.assetKey ?? '模块2玩法截图',
    ...extra,
  };
}

test('content package keys come from assetKey, not old 可替换素材 names', () => {
  const inventories = {
    pc: {
      nodes: [
        node({ id: 'pc-shot', name: 'img/[replaceable]模块2玩法截图' }),
        node({
          id: 'pc-old',
          name: 'img/可替换素材',
          replaceable: false,
          assetKey: undefined,
        }),
      ],
    },
  };
  const records = collectReplaceableRecords(inventories, {
    assetsManifest: { 'pc-shot': { file: 'assets/pc-shot.png', pixelSize: '80x40' } },
  });
  assert.deepEqual(Object.keys(records), ['模块2玩法截图']);
  assert.equal(records['模块2玩法截图'].files.pc.common.src, 'assets/pc-shot.png');
  assert.equal(records['模块2玩法截图'].files.pc.common.width, 80);
});

test('content package keeps pc/mobile and lang slots; illegal lang skipped; no set-root common', () => {
  const inventories = {
    pc: {
      nodes: [
        node({ id: 'set', type: 'COMPONENT_SET', name: 'img/[replaceable]模块2玩法截图' }),
        node({ id: 'v-cn', type: 'COMPONENT', name: 'lang=cn' }),
        node({ id: 'v-tw', type: 'COMPONENT', name: 'lang=tw' }),
        node({ id: 'v-bad', type: 'COMPONENT', name: 'lang=CN' }),
      ],
    },
    mobile: {
      nodes: [
        node({ id: 'm-cn', type: 'COMPONENT', name: 'lang=cn' }),
      ],
    },
  };
  const manifest = {
    'v-cn': { file: 'assets/v-cn.png' },
    'v-tw': { file: 'assets/v-tw.png' },
    'v-bad': { file: 'assets/v-bad.png' },
    'm-cn': { file: 'assets/m-cn.png' },
    set: { file: 'assets/set.png' },
  };
  const records = collectReplaceableRecords(inventories, { assetsManifest: manifest });
  const files = records['模块2玩法截图'].files;
  assert.equal(files.pc.common, undefined);
  assert.equal(files.pc['zh-CN'].src, 'assets/v-cn.png');
  assert.equal(files.pc['zh-TW'].src, 'assets/v-tw.png');
  assert.equal(files.pc.CN, undefined);
  assert.equal(files.mobile['zh-CN'].src, 'assets/m-cn.png');
});

test('loader never falls back from missing lang to common or another language', () => {
  const script = contentPackageLoaderScript();
  assert.match(script, /cache:\s*'no-store'/);
  assert.match(script, /content-package\/assets\.json/);
  assert.match(script, /data-asset-error/);
  assert.doesNotMatch(script, /files\.cn|files\['cn'\]/);
  assert.match(script, /hasLang\) return null/);
  assert.match(script, /setAttribute\('data-asset-lang'/);
  assert.match(script, /qa-pref-change/);
  assert.match(script, /typeof qa\.prefs === 'function'/);
  assert.match(script, /ev\.detail\.prefs\[key\]/);
  assert.match(script, /function bind\(index, ev\)/);
  assert.match(script, /unsafe-src/);
  assert.match(script, /content-package\//);
});

test('cn and global are separate regions; overseas aliases to global', () => {
  assert.equal(normalizeContentRegion('cn'), 'cn');
  assert.equal(normalizeContentRegion('global'), 'global');
  assert.equal(normalizeContentRegion('overseas'), 'global');
  const dir = mkdtempSync(join(tmpdir(), 'content-package-global-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets/shot.png'), Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ));
  const packed = writeContentPackage(dir, {
    inventories: { pc: { nodes: [node({ id: 'shot' })] } },
    assetsManifest: { shot: { file: 'assets/shot.png' } },
    region: 'overseas',
    languages: ['en'],
  });
  assert.equal(packed.manifest.region, 'global');
  const json = JSON.parse(readFileSync(join(dir, 'content-package/assets.json'), 'utf8'));
  assert.equal(json.region, 'global');
  const slot = json.assets['模块2玩法截图'].files.pc.common;
  assert.equal(slot.width, 1);
  assert.equal(slot.height, 1);
  assert.equal(slot.hasAlpha, true);
});

test('writeContentPackage refuses missing files and paths that escape the demo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'content-package-escape-'));
  mkdirSync(join(dir, 'assets'));
  mkdirSync(join(dir, 'content-package/assets'), { recursive: true });
  writeFileSync(join(dir, 'content-package/assets/keep.png'), 'keep');
  writeFileSync(join(dir, 'content-package/assets.json'), '{"schemaVersion":1,"region":"cn","assets":{"old":true}}\n');
  assert.throws(
    () => writeContentPackage(dir, {
      inventories: { pc: { nodes: [node({ id: 'shot' })] } },
      assetsManifest: { shot: { file: 'assets/missing.png' } },
    }),
    /replaceable src missing/,
  );
  assert.equal(existsSync(join(dir, 'content-package/assets/keep.png')), true);
  assert.equal(JSON.parse(readFileSync(join(dir, 'content-package/assets.json'), 'utf8')).assets.old, true);
  assert.throws(
    () => writeContentPackage(dir, {
      inventories: { pc: { nodes: [node({ id: 'shot' })] } },
      assetsManifest: { shot: { file: '../outside.png' } },
    }),
    /replaceable src (escapes demo|missing)/,
  );
  assert.equal(existsSync(join(dir, 'content-package/assets/keep.png')), true);
});

test('writeContentPackage rebuilds the package and drops leftover files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'content-package-rebuild-'));
  mkdirSync(join(dir, 'assets'));
  mkdirSync(join(dir, 'content-package/assets'), { recursive: true });
  writeFileSync(join(dir, 'assets/shot.png'), 'png');
  writeFileSync(join(dir, 'content-package/assets/stale.png'), 'old');
  writeFileSync(join(dir, 'content-package/assets.json'), '{"schemaVersion":1,"region":"cn","assets":{}}\n');
  writeContentPackage(dir, {
    inventories: { pc: { nodes: [node({ id: 'shot' })] } },
    assetsManifest: { shot: { file: 'assets/shot.png' } },
    region: 'cn',
    languages: ['zh-CN'],
  });
  assert.equal(existsSync(join(dir, 'content-package/assets/stale.png')), false);
  assert.equal(existsSync(join(dir, 'content-package/assets/shot.png')), true);
  const json = JSON.parse(readFileSync(join(dir, 'content-package/assets.json'), 'utf8'));
  assert.equal(json.assets['模块2玩法截图'].files.pc.common.src, 'content-package/assets/shot.png');
});

test('writeContentPackage copies files and embeds a fetch loader', () => {
  const dir = mkdtempSync(join(tmpdir(), 'content-package-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets/shot.png'), 'png');
  writeFileSync(join(dir, 'index.html'), '<body><img data-asset="模块2玩法截图" data-asset-platform="pc"></body>');
  const packed = writeContentPackage(dir, {
    inventories: {
      pc: { nodes: [node({ id: 'shot' })] },
    },
    assetsManifest: { shot: { file: 'assets/shot.png', pixelSize: '10x10', webp: { alpha: true } } },
    region: 'cn',
    languages: ['zh-CN'],
  });
  assert.equal(packed.ok, true);
  const json = JSON.parse(readFileSync(join(dir, 'content-package/assets.json'), 'utf8'));
  assert.equal(json.schemaVersion, 1);
  assert.equal(json.region, 'cn');
  assert.equal(json.assets['模块2玩法截图'].files.pc.common.src, 'content-package/assets/shot.png');
  assert.equal(existsSync(join(dir, 'content-package/assets/shot.png')), true);
  const html = embedContentPackageLoader(readFileSync(join(dir, 'index.html'), 'utf8'));
  assert.match(html, /id="qa-content-package-loader"/);
  const rewritten = rewriteReplaceableSrc(json, (src) => src.replace(/\.png$/, '.webp'));
  assert.equal(rewritten.assets['模块2玩法截图'].files.pc.common.src, 'content-package/assets/shot.webp');
});
