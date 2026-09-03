import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { runFromHandoff } from '../figma-from-handoff.mjs';
import { buildHtmlFromHandoff, parsePreviewJson } from '../figma-html-from-handoff.mjs';
import { writeHandoffPack } from '../../../../standards/figma-naming/tool/src/handoff.mjs';
import { rebuildInventoryIndexes } from '../../../../standards/figma-naming/tool/src/inventory.mjs';
import {
  GOLD_MOBILE_PREFIX_CLASSES,
  GOLD_PC_PREFIX_CLASSES,
} from '../../../../standards/figma-naming/tool/scripts/check-draft-asset-completeness.mjs';
import { behaviorOf, stampReadyFields } from '../../../../standards/figma-naming/spec/inventory.mjs';
import { fixtureJudgment } from '../../../../standards/figma-naming/tool/src/judgment.mjs';

function sample(id, extra = {}) {
  const roles = extra.roles ?? GOLD_MOBILE_PREFIX_CLASSES;
  const nodes = roles.map((role, index) => stampReadyFields({
    id: `${id}-${role}`,
    type: role === 'btn' ? 'INSTANCE' : 'FRAME',
    name: role === 'sec' ? 'sec/1-首屏' : `${role}/${role}`,
    status: 'determined',
    role,
    label: role === 'sec' ? '1-首屏' : role,
    behavior: behaviorOf(role),
    via: 'prefix',
    parentId: role === 'ind' ? `${id}-switch` : null,
    box: { x: 0, y: index * 40, w: role === 'hot' ? 400 : 80, h: role === 'hot' ? 220 : 32 },
  }));
  nodes.push({
    id: `${id}-scroll-track`,
    type: 'FRAME',
    name: '轨道',
    status: 'skipped',
    why: 'art-fragment',
    parentId: `${id}-scroll`,
    box: { x: 0, y: 0, w: 80, h: 32 },
  });
  const doc = rebuildInventoryIndexes({
    ok: true,
    schema: 'inventory/v2',
    status: extra.status ?? 'ready',
    fileKey: extra.fileKey ?? 'FILEKEY',
    requestedNodeId: id,
    snapshot: { hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', lastModified: '2026-08-22T00:00:00Z' },
    page: { id, box: { x: 0, y: 0, w: extra.pageWidth ?? 750, h: 1200 } },
    nodes,
    attachments: { componentSets: [], modals: [] },
    relations: [],
    ...extra,
  });
  fixtureJudgment(doc);
  return doc;
}

function packedReady(dir) {
  const pcDoc = sample('1:1', { roles: GOLD_PC_PREFIX_CLASSES, pageWidth: 1920 });
  const mobileDoc = sample('2:2', { roles: GOLD_MOBILE_PREFIX_CLASSES, pageWidth: 750 });
  const pcPath = join(dir, 'pc.json');
  const mobilePath = join(dir, 'mo.json');
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  writeFileSync(mobilePath, JSON.stringify(mobileDoc));
  return writeHandoffPack({
    pcPath, mobilePath, pcDoc, mobileDoc, kind: 'ready', outDir: join(dir, 'out'),
  });
}

test('from-handoff still does not write HTML after a ready pack', () => {
  const dir = mkdtempSync(join(tmpdir(), 'html-from-handoff-consume-'));
  const pack = packedReady(dir);
  const before = new Set(readdirSync(pack.outDir));
  const result = runFromHandoff(pack.outDir);
  assert.equal(result.ok, true, (result.problems || []).join('\n'));
  assert.equal(existsSync(join(pack.outDir, 'index.html')), false);
  assert.deepEqual(new Set(readdirSync(pack.outDir)), before);
  assert.match(result.note, /不写出 HTML/);
});

test('parsePreviewJson reads pretty-printed preview-first stdout', () => {
  const pretty = JSON.stringify({ ok: true, productView: { url: 'http://127.0.0.1:9/index.html?product=1' } }, null, 2);
  assert.equal(parsePreviewJson(pretty).ok, true);
  assert.equal(parsePreviewJson(`noise\n${pretty}\n`).ok, true);
  assert.equal(parsePreviewJson(''), null);
});

test('html-from-handoff writes demo index.html from a ready pack (issue #61)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'html-from-handoff-build-'));
  const pack = packedReady(dir);
  const demoDir = join(dir, 'demo');
  const result = buildHtmlFromHandoff({
    handoffDir: pack.outDir,
    demoDir,
    skipPreview: true,
  });
  assert.equal(result.wroteHtml, true, (result.problems || []).join('\n'));
  assert.equal(result.ok, false);
  assert.equal(result.productViewAllowed, false);
  assert.equal(result.humanStopPreviewAllowed, false);
  assert.equal(result.productView.command, null);
  assert.match((result.problems || []).join('\n'), /preview-first skipped/);
  assert.equal(existsSync(join(demoDir, 'index.html')), true);
  assert.equal(existsSync(join(demoDir, 'truth.json')), true);
  const html = readFileSync(join(demoDir, 'index.html'), 'utf8');
  assert.match(html, /id="qa-truth"/);
  assert.match(html, /FIGMA_RENDER_BEGIN/);
  const truth = JSON.parse(readFileSync(join(demoDir, 'truth.json'), 'utf8'));
  assert.equal(truth.schema, 'yise-ready-platform-truth/v1');
  assert.ok(truth.platforms.pc);
  assert.ok(truth.platforms.mobile);
  const spec = JSON.parse(readFileSync(join(demoDir, 'spec.json'), 'utf8'));
  assert.equal(spec.figma.fileKey, 'FILEKEY');
  assert.equal(spec.figma.pcPageId, '1:1');
  assert.equal(spec.figma.mobilePageId, '2:2');
  assert.equal(spec.figma.exportScale, 1);
  assert.deepEqual(spec.matrix.langs, ['zh-CN']);
  assert.match(html, /lang:\s*\{\s*label:\s*'Language',\s*options:\s*\[\{"v":"zh-CN","label":"简体中文"\}\]/);
  assert.equal(existsSync(join(pack.outDir, 'index.html')), false);
  assert.equal(result.htmlVolume.ok, true);
  assert.equal(existsSync(join(demoDir, 'fonts-manifest.json')), true);
  assert.match(html, /id="qa-design-policy"/);
  assert.match(html, /window\.__designPolicy/);
  assert.match(html, /window\.__qaDemo/);
});

test('html-from-handoff writes a fresh shell when spec.json exists but index.html is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'html-from-handoff-fresh-shell-'));
  const pack = packedReady(dir);
  const demoDir = join(dir, 'demo');
  mkdirSync(demoDir, { recursive: true });
  writeFileSync(join(demoDir, 'spec.json'), JSON.stringify({
    meta: { name: 'stale-demo' },
    figma: { fileKey: 'OLD', exportScale: 1 },
    matrix: { langs: ['zh-CN'] },
    workflow: { claimedCapabilities: {} },
  }, null, 2));
  const result = buildHtmlFromHandoff({
    handoffDir: pack.outDir,
    demoDir,
    skipPreview: true,
  });
  assert.equal(result.wroteHtml, true, (result.problems || []).join('\n'));
  assert.equal(existsSync(join(demoDir, 'index.html')), true);
  const html = readFileSync(join(demoDir, 'index.html'), 'utf8');
  assert.match(html, /id="qa-design-policy"/);
  assert.match(html, /window\.__designPolicy/);
  assert.match(html, /window\.__qaDemo/);
  assert.match(html, /FIGMA_RENDER_BEGIN/);
  const src = readFileSync(new URL('../figma-html-from-handoff.mjs', import.meta.url), 'utf8');
  assert.match(src, /function writeFreshShowcaseIndex/);
  assert.match(src, /existsSync\(join\(demoDir, 'spec\.json'\)\)/);
  assert.match(src, /writeFreshShowcaseIndex\(demoDir, consume\)/);
  assert.match(src, /runNode\(INIT,/);
  assert.ok(src.indexOf("existsSync(join(demoDir, 'spec.json'))") < src.indexOf('runNode(INIT,'));
});

test('html-from-handoff inserts a closed design-policy block into a legacy shell', () => {
  const dir = mkdtempSync(join(tmpdir(), 'html-from-handoff-policy-'));
  const pack = packedReady(dir);
  const demoDir = join(dir, 'demo');
  mkdirSync(demoDir, { recursive: true });
  writeFileSync(join(demoDir, 'index.html'), `<!doctype html>
<body>
<script id="qa-truth" type="application/json">{}</script>
<script id="qa-devices" type="application/json">{}</script>
<script>
window.__qaDemo = { name: 'legacy' };
</script>
</body>`);
  const result = buildHtmlFromHandoff({
    handoffDir: pack.outDir,
    demoDir,
    skipPreview: true,
  });
  assert.equal(result.wroteHtml, true, (result.problems || []).join('\n'));
  const html = readFileSync(join(demoDir, 'index.html'), 'utf8');
  const policyOpen = html.indexOf('<script id="qa-design-policy"');
  const policyClose = html.indexOf('</script>', policyOpen);
  const loaderClose = html.indexOf('</script>', policyClose + 1);
  const qaDemo = html.indexOf('window.__qaDemo');
  assert.ok(policyOpen >= 0);
  assert.ok(policyClose > policyOpen);
  assert.ok(loaderClose > policyClose);
  assert.ok(qaDemo > loaderClose);
  assert.match(html.slice(policyClose, loaderClose + 9), /window\.__designPolicy/);
});

test('html-from-handoff language matrix follows img/ langs and does not invent ja', () => {
  const dir = mkdtempSync(join(tmpdir(), 'html-from-handoff-langs-'));
  const pcDoc = sample('1:1', { roles: GOLD_PC_PREFIX_CLASSES, pageWidth: 1920 });
  const mobileDoc = sample('2:2', { roles: GOLD_MOBILE_PREFIX_CLASSES, pageWidth: 750 });
  const langSet = {
    id: 'img-lang-set',
    name: 'img/模块2可替换素材',
    componentPropertyDefinitions: {
      lang: { type: 'VARIANT', defaultValue: 'cn', variantOptions: ['cn', 'tw', 'en', 'kr'] },
    },
    variants: [
      { id: 'img-cn', type: 'COMPONENT', name: 'lang=cn', componentProperties: { lang: { type: 'VARIANT', value: 'cn' } } },
      { id: 'img-tw', type: 'COMPONENT', name: 'lang=tw', componentProperties: { lang: { type: 'VARIANT', value: 'tw' } } },
      { id: 'img-en', type: 'COMPONENT', name: 'lang=en', componentProperties: { lang: { type: 'VARIANT', value: 'en' } } },
      { id: 'img-kr', type: 'COMPONENT', name: 'lang=kr', componentProperties: { lang: { type: 'VARIANT', value: 'kr' } } },
    ],
  };
  pcDoc.attachments.componentSets.push(langSet);
  mobileDoc.attachments.componentSets.push(langSet);
  rebuildInventoryIndexes(pcDoc);
  rebuildInventoryIndexes(mobileDoc);
  fixtureJudgment(pcDoc);
  fixtureJudgment(mobileDoc);
  const pcPath = join(dir, 'pc.json');
  const mobilePath = join(dir, 'mo.json');
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  writeFileSync(mobilePath, JSON.stringify(mobileDoc));
  const pack = writeHandoffPack({
    pcPath, mobilePath, pcDoc, mobileDoc, kind: 'ready', outDir: join(dir, 'out'),
  });
  const demoDir = join(dir, 'demo');
  const result = buildHtmlFromHandoff({
    handoffDir: pack.outDir,
    demoDir,
    skipPreview: true,
  });
  assert.equal(result.wroteHtml, true, (result.problems || []).join('\n'));
  const spec = JSON.parse(readFileSync(join(demoDir, 'spec.json'), 'utf8'));
  assert.deepEqual(spec.matrix.langs, ['zh-CN', 'zh-TW', 'en', 'ko']);
  const html = readFileSync(join(demoDir, 'index.html'), 'utf8');
  assert.match(html, /lang:\s*\{\s*label:\s*'Language',\s*options:\s*\[\{"v":"zh-CN","label":"简体中文"\},\{"v":"zh-TW","label":"繁體中文"\},\{"v":"en","label":"English"\},\{"v":"ko","label":"한국어"\}\]/);
});

test('html-from-handoff writes a pc-only ready pack without claiming mobile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'html-from-handoff-pc-only-'));
  const pcDoc = sample('1:1', { roles: GOLD_PC_PREFIX_CLASSES, pageWidth: 1920 });
  const pcPath = join(dir, 'pc.json');
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  const pack = writeHandoffPack({
    pcPath, mobilePath: null, pcDoc, mobileDoc: null, kind: 'ready', outDir: join(dir, 'out'),
  });
  const demoDir = join(dir, 'demo');
  const result = buildHtmlFromHandoff({
    handoffDir: pack.outDir,
    demoDir,
    skipPreview: true,
  });
  assert.equal(result.wroteHtml, true, (result.problems || []).join('\n'));
  const truth = JSON.parse(readFileSync(join(demoDir, 'truth.json'), 'utf8'));
  assert.ok(truth.platforms.pc);
  assert.equal(Object.hasOwn(truth.platforms, 'mobile'), false);
  const spec = JSON.parse(readFileSync(join(demoDir, 'spec.json'), 'utf8'));
  assert.deepEqual(spec.figma.sourcePlatforms, ['desktop']);
  assert.equal(spec.figma.pcPageId, '1:1');
  assert.equal(spec.figma.mobilePageId, null);
  assert.equal(spec.workflow.claimedCapabilities.desktopSourcePlatform, 'claimed');
  assert.equal(spec.workflow.claimedCapabilities.mobileSourcePlatform, 'not-claimed');
});

function packedReadyWithFont(dir, family) {
  const pcDoc = sample('1:1', { roles: GOLD_PC_PREFIX_CLASSES, pageWidth: 1920 });
  const mobileDoc = sample('2:2', { roles: GOLD_MOBILE_PREFIX_CLASSES, pageWidth: 750 });
  const textNode = (id) => stampReadyFields({
    id: `${id}-copy`,
    type: 'TEXT',
    name: 'copy/标题',
    status: 'determined',
    role: 'copy',
    label: '标题',
    behavior: behaviorOf('copy'),
    via: 'prefix',
    parentId: `${id}-sec`,
    box: { x: 0, y: 0, w: 80, h: 32 },
    text: { characters: 'x', fontFamily: family, fontWeight: 400, fontSize: 16 },
  });
  pcDoc.nodes.push(textNode('1:1'));
  mobileDoc.nodes.push(textNode('2:2'));
  rebuildInventoryIndexes(pcDoc);
  rebuildInventoryIndexes(mobileDoc);
  fixtureJudgment(pcDoc);
  fixtureJudgment(mobileDoc);
  const pcPath = join(dir, 'pc.json');
  const mobilePath = join(dir, 'mo.json');
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  writeFileSync(mobilePath, JSON.stringify(mobileDoc));
  return writeHandoffPack({
    pcPath, mobilePath, pcDoc, mobileDoc, kind: 'ready', outDir: join(dir, 'out'),
  });
}

test('html-from-handoff fail-closes before HTML when a source font is not in the registry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'html-from-handoff-missing-font-'));
  const pack = packedReadyWithFont(dir, 'Missing Face');
  const demoDir = join(dir, 'demo');
  const consume = runFromHandoff(pack.outDir);
  assert.equal(consume.ok, false);
  assert.match((consume.problems || []).join('\n'), /Missing Face/);
  assert.match((consume.problems || []).join('\n'), /fonts:register/);
  const result = buildHtmlFromHandoff({
    handoffDir: pack.outDir,
    demoDir,
    skipPreview: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.wroteHtml, false);
  assert.equal(existsSync(join(demoDir, 'index.html')), false);
  assert.match((result.problems || []).join('\n'), /Missing Face|fonts:register|登记册/);
});

test('skipPreview still runs inventory static gate and never marks skipped-ok', () => {
  const dir = mkdtempSync(join(tmpdir(), 'html-from-handoff-static-gate-'));
  const pack = packedReady(dir);
  const result = buildHtmlFromHandoff({
    handoffDir: pack.outDir,
    demoDir: join(dir, 'demo'),
    skipPreview: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.productViewAllowed, false);
  assert.equal(result.productView.blocked, true);
  assert.ok(result.inventoryStaticGate);
  assert.notEqual(result.inventoryStaticGate.skipped, true);
  assert.equal(result.inventoryStaticGate.ok, false);
  const src = readFileSync(new URL('../figma-html-from-handoff.mjs', import.meta.url), 'utf8');
  assert.match(src, /attachInventoryStaticGate/);
  assert.match(src, /runInventoryStaticGate/);
  assert.match(src, /attachDesignPolicyMirror/);
  assert.match(src, /attachSliceAssets/);
  assert.match(src, /figma-assets\.mjs/);
  assert.match(src, /reuseExistingAssets/);
  assert.match(src, /--reuse-existing/);
  assert.doesNotMatch(src, /\|\| true/);
  assert.doesNotMatch(src, /--skip-preview/);
  assert.doesNotMatch(src, /design-policy-dom-probe/);
  assert.match(src, /chromeSource/);
  assert.match(src, /renderSource/);
  assert.match(src, /shellSource/);
  assert.doesNotMatch(src, /chromeOfficialRootFontVw: policy\.officialRootFontVw/);
});

test('preview green + static gate red still blocks product view', () => {
  const dir = mkdtempSync(join(tmpdir(), 'html-from-handoff-gate-red-'));
  const pack = packedReady(dir);
  const result = buildHtmlFromHandoff({
    handoffDir: pack.outDir,
    demoDir: join(dir, 'demo'),
    skipPreview: true,
    staticGateProbe: () => ({ nodes: { mismatch: { x: 0, y: 0, w: 1, h: 1 } } }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.productViewAllowed, false);
  assert.match((result.problems || []).join('\n'), /inventory-static-gate red|missing-dom|pageBox-mismatch|probe missing|DOM probe required/);
});

test('official static gate probe is shipped and missing probe/index is fail-closed in source', () => {
  const skillRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
  assert.equal(existsSync(join(skillRoot, 'scripts/lib/inventory-static-gate-probe.mjs')), true);
  const src = readFileSync(new URL('../figma-html-from-handoff.mjs', import.meta.url), 'utf8');
  assert.match(src, /inventory-static-gate-probe\.mjs missing; cannot mark green without DOM/);
  assert.match(src, /demo index.html missing; cannot measure DOM/);
  const probeSrc = readFileSync(join(skillRoot, 'scripts/lib/inventory-static-gate-probe.mjs'), 'utf8');
  assert.match(probeSrc, /inventory-static-gate=1/);
  assert.match(probeSrc, /product=1/);
  assert.match(probeSrc, /measureProductScroll/);
  assert.match(probeSrc, /overlayOwnerOf/);
  assert.match(probeSrc, /fontWeight/);
  assert.match(probeSrc, /inSection/);
});

test('html-from-handoff fails when index.html stays over the HTML volume gate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'html-from-handoff-volume-'));
  const pack = packedReady(dir);
  const result = buildHtmlFromHandoff({
    handoffDir: pack.outDir,
    demoDir: join(dir, 'demo'),
    skipPreview: true,
    htmlLimitBytes: 2048,
  });
  assert.equal(result.ok, false);
  assert.equal(result.productViewAllowed, undefined);
  assert.match((result.problems || []).join('\n'), /exceeds 2048 bytes/);
});
