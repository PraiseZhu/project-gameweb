import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateAssets } from '../lib/asset-contract.mjs';
import { buildPageModel } from '../lib/page-model.mjs';
import { imgLangAxisOfSet } from '../lib/image-language.mjs';

test('empty asset map fails for required slices; Lang axis is not lang', () => {
  const empty = validateAssets({
    pack: { ends: ['pc'], fingerprint: 'x', inventories: { pc: { nodes: [{ id: 'a', role: 'img', status: 'determined', sliceExport: { bounds: 'render', scale: 1, format: 'png', file: 'a.png' } }], attachments: { componentSets: [] } } } },
    assetMap: { schema: 'ews-assets/v1', pc: {} },
    fonts: [],
    assetRoot: mkdtempSync(join(tmpdir(), 'ews-empty-assets-')),
  });
  assert.equal(empty.ok, false);
  const set = {
    name: 'img/x',
    componentPropertyDefinitions: { Lang: { type: 'VARIANT', variantOptions: ['cn', 'en'] } },
    variants: [{ name: 'Lang=cn' }, { name: 'Lang=en' }],
  };
  assert.equal(imgLangAxisOfSet(set), null);
});

test('illegal page locale is rejected', () => {
  const model = buildPageModel({
    truth: { platforms: { pc: { page: { pageBox: { x: 0, y: 0, w: 1920, h: 1080 } }, sections: {}, pageChrome: { nodes: [] }, fixedOverlays: { nodes: [] } } } },
    copy: { byPlatform: {} },
    assets: { pc: {} },
    pack: { ends: ['pc'], inventories: { pc: { nodes: [] } } },
    config: { schema: 'ews-config/v1', locales: ['fr'], defaultLocale: 'fr', screens: [{ key: 'hero', pc: 'missing' }] },
  });
  assert.equal(model.ok, false);
  assert.ok(model.problems.some((item) => /locale/.test(item)));
});

test('display name Etheria-ews, slug etheria-ews, trigger ews出页, not yise/torch', () => {
  const skill = readFileSync(join(process.cwd(), 'SKILL.md'), 'utf8');
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(process.cwd(), 'public-release.json'), 'utf8'));
  assert.match(skill, /^name:\s*etheria-ews\s*$/m);
  assert.match(skill, /^  trigger:\s*ews出页\s*$/m);
  assert.match(skill, /Etheria-ews/);
  assert.match(skill, /不要用于/);
  assert.match(skill, /yisewebui/);
  assert.match(skill, /torchlightweb/);
  assert.equal(pkg.name, 'etheria-ews');
  assert.equal(pkg.scripts.ewsweb, 'node scripts/ews-web.mjs');
  assert.equal(pkg.scripts['ews出页'], 'node scripts/ews-web.mjs');
  assert.equal(manifest.identity, 'etheria-ews');
  assert.equal(manifest.displayName, 'Etheria-ews');
  assert.equal(manifest.trigger, 'ews出页');
  assert.equal(manifest.directory, 'skills/ews-web');
});

test('publishable modules only use relative or node: imports', () => {
  const files = [
    'scripts/ews-web.mjs',
    'scripts/lib/handoff-contract.mjs',
    'assets/runtime/boot.mjs',
    'assets/runtime/render.mjs',
  ];
  const root = join(process.cwd());
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const spec of [...text.matchAll(/from\s+['\"]([^'\"]+)['\"]/g)].map((m) => m[1])) {
      assert.ok(spec.startsWith('.') || spec.startsWith('node:'), `${file} import ${spec}`);
      assert.ok(!spec.includes('yise-web-ui') && !spec.includes('torchlight-web'), `${file} cross-skill ${spec}`);
    }
  }
  writeFileSync(join(mkdtempSync(join(tmpdir(), 'ews-touch-')), 'ok.txt'), 'ok');
});
