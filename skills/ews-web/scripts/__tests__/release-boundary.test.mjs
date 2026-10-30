import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateAssets } from '../lib/asset-contract.mjs';
import { buildPageModel } from '../lib/page-model.mjs';
import { imgLangAxisOfSet } from '../lib/image-language.mjs';
import { PREFIX_ROLES } from '../lib/inventory-ready-fields.mjs';

test('published naming contract matches the actual consumed prefix roles', () => {
  const contract = JSON.parse(readFileSync(new URL('../../naming-contract.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(readFileSync(new URL('../../public-release.json', import.meta.url), 'utf8'));
  assert.equal(typeof contract.targetSpecVersion, 'string');
  assert.ok(contract.targetSpecVersion.trim());
  assert.deepEqual(contract.rolesUsed.slice().sort(), PREFIX_ROLES.slice().sort());
  assert.ok(manifest.publishable.includes('naming-contract.json'));
});

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
  assert.equal(pkg.scripts['figma:from-handoff'], 'node scripts/figma-from-handoff.mjs');
  assert.equal(pkg.scripts['policy-mirror'], 'node scripts/policy-mirror.mjs');
  assert.equal(pkg.scripts['preview:first'], 'node scripts/preview-first.mjs');
  assert.equal(pkg.scripts['reconcile-page'], 'node scripts/reconcile-page.mjs');
  assert.equal(pkg.scripts['product-viewport'], 'node scripts/product-viewport.mjs');
  assert.equal(pkg.scripts['live-copy'], 'node scripts/live-copy.mjs');
  assert.equal(pkg.scripts.stop1, 'node scripts/stop1.mjs');
  assert.equal(manifest.identity, 'etheria-ews');
  assert.equal(manifest.displayName, 'Etheria-ews');
  assert.equal(manifest.trigger, 'ews出页');
  assert.equal(manifest.directory, 'skills/ews-web');
});

test('publishable modules only use relative or node: imports', () => {
  const files = [
    'scripts/ews-web.mjs',
    'scripts/figma-from-handoff.mjs',
    'scripts/lib/from-handoff.mjs',
    'scripts/lib/handoff-contract.mjs',
    'scripts/lib/comment-share.mjs',
    'scripts/lib/runtime-identity.mjs',
    'scripts/policy-mirror.mjs',
    'scripts/lib/policy-implementation.mjs',
    'scripts/preview-first.mjs',
    'scripts/lib/browser-session.mjs',
    'scripts/reconcile-page.mjs',
    'scripts/lib/page-reconcile.mjs',
    'scripts/lib/paged-switch.mjs',
    'scripts/lib/variant-switch.mjs',
    'scripts/lib/variant-assets.mjs',
    'scripts/lib/nav-map.mjs',
    'scripts/lib/dropmenu.mjs',
    'scripts/lib/modal-triggers.mjs',
    'scripts/lib/presence.mjs',
    'assets/runtime/modal-close.mjs',
    'scripts/lib/demo-refs.mjs',
    'assets/runtime/text-style.mjs',
    'assets/runtime/locale-fonts.mjs',
    'scripts/lib/font-identity.mjs',
    'assets/runtime/dropmenu-lang.mjs',
    'assets/runtime/dropmenu-runtime.mjs',
    'scripts/lib/paint-slices.mjs',
    'scripts/lib/slice-normalize.mjs',
    'scripts/lib/live-copy.mjs',
    'scripts/lib/copy-bind-clones.mjs',
    'scripts/lib/asset-contract.mjs',
    'scripts/product-viewport.mjs',
    'scripts/live-copy.mjs',
    'scripts/stop1-pixel.mjs',
    'scripts/lib/ews-pixel-adapter.mjs',
    'scripts/stop1.mjs',
    'assets/runtime/qa-toolbar.mjs',
    'assets/runtime/page-interaction.mjs',
    'assets/runtime/qa-chrome.mjs',
    'assets/runtime/qa-comments.mjs',
    'assets/runtime/paged-switch-runtime.mjs',
    'assets/runtime/variant-switch-runtime.mjs',
    'assets/runtime/boot.mjs',
    'assets/runtime/content-protection.mjs',
    'assets/runtime/render.mjs',
    'assets/runtime/ews-screen-runtime.mjs',
    'assets/runtime/design-policy.generated.mjs',
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
