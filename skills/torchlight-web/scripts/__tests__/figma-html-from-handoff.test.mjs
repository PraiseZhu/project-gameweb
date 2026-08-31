import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  assert.equal(existsSync(join(pack.outDir, 'index.html')), false);
  assert.equal(result.htmlVolume.ok, true);
  assert.equal(existsSync(join(demoDir, 'fonts-manifest.json')), true);
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
