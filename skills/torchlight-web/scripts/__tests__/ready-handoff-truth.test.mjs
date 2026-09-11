import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { platformTruthFromInventory } from '../lib/ready-handoff-truth.mjs';

const PAGE_ID = '100:1';
const CANVAS_BOX = Object.freeze({ x: 9000, y: 8000, w: 3840, h: 17182 });
const PAGE_BOX = Object.freeze({ x: 0, y: 0, w: 1920, h: 1080 });
const SECTION_CANVAS = Object.freeze({ x: 9000, y: 8000, w: 1920, h: 1080 });
const SECTION_PAGE = Object.freeze({ x: 0, y: 0, w: 1920, h: 1080 });
const NODE_CANVAS = Object.freeze({ x: 9120, y: 8200, w: 240, h: 48 });
const NODE_PAGE = Object.freeze({ x: 120, y: 200, w: 240, h: 48 });
const NODE_PARENT = Object.freeze({ x: 0, y: 0, w: 1920, h: 1080 });
const SLICE = Object.freeze({
  box: { x: 120, y: 200, w: 240, h: 48 },
  scale: 1,
  format: 'png',
  file: '100-5.png',
});
const TEXT = Object.freeze({
  fontFamily: 'Source Han Sans',
  fontWeight: 500,
  fontSize: 28,
});
const LAYOUT = Object.freeze({
  constraints: { horizontal: 'LEFT', vertical: 'TOP' },
  layoutMode: 'NONE',
});

function fixture() {
  return {
    schema: 'inventory/v2',
    specVersion: '1.0',
    ok: true,
    status: 'ready',
    fileKey: 'synthetic-file-key',
    requestedNodeId: PAGE_ID,
    snapshot: { hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', lastModified: '2026-08-17T02:59:44Z' },
    page: { id: PAGE_ID, name: 'cn_pc', box: { ...CANVAS_BOX }, pageBox: { ...PAGE_BOX } },
    sections: [
      { id: '100:2', number: 1, label: '1', box: { ...SECTION_CANVAS }, pageBox: { ...SECTION_PAGE }, parentBox: { ...PAGE_BOX } },
    ],
    overlays: [],
    backgrounds: [{ id: '100:3', role: 'kv', label: 'background' }],
    nodes: [
      { id: PAGE_ID, scope: 'page', type: 'FRAME', name: 'cn_pc', parentId: null, orderKey: '0', status: 'unknown', box: { ...CANVAS_BOX }, pageBox: { ...PAGE_BOX } },
      {
        id: '100:2',
        scope: 'page',
        type: 'FRAME',
        name: 'sec/1',
        parentId: PAGE_ID,
        orderKey: '0.0',
        status: 'unknown',
        role: 'sec',
        ancestorIds: [PAGE_ID],
        box: { ...SECTION_CANVAS },
        pageBox: { ...SECTION_PAGE },
        parentBox: { ...PAGE_BOX },
      },
      {
        id: '100:3',
        scope: 'page',
        type: 'RECTANGLE',
        name: 'kv',
        parentId: PAGE_ID,
        orderKey: '0.1',
        status: 'determined',
        role: 'kv',
        behavior: 'slice',
        ancestorIds: [PAGE_ID],
        box: { ...NODE_CANVAS },
        pageBox: { ...NODE_PAGE },
        parentBox: { ...NODE_PARENT },
        sliceExport: { ...SLICE, box: { ...SLICE.box } },
        layout: { ...LAYOUT, constraints: { ...LAYOUT.constraints } },
      },
      {
        id: '100:5',
        scope: 'page',
        type: 'TEXT',
        name: 'copy/title',
        parentId: '100:2',
        orderKey: '0.0.0',
        status: 'determined',
        role: 'copy',
        ancestorIds: [PAGE_ID, '100:2'],
        box: { ...NODE_CANVAS },
        pageBox: { ...NODE_PAGE },
        parentBox: { ...SECTION_PAGE },
        text: { ...TEXT },
        layout: { ...LAYOUT, constraints: { ...LAYOUT.constraints } },
      },
    ],
    attachments: { modals: [], componentSets: [], components: [] },
    relations: [],
    counts: { determined: 2, unknown: 2, skipped: 0 },
  };
}

test('section and page meta draw from pageBox, never canvas box', () => {
  const truth = platformTruthFromInventory(fixture());
  assert.equal(truth.ok, true, (truth.problems || []).join('\n'));
  assert.deepEqual(truth.pageBackground.meta.pageBox, PAGE_BOX);
  assert.equal(truth.pageBackground.meta.x, PAGE_BOX.x);
  assert.equal(truth.pageBackground.meta.y, PAGE_BOX.y);
  assert.notEqual(truth.pageBackground.meta.x, CANVAS_BOX.x);
  assert.deepEqual(truth.pageChrome.meta.pageBox, PAGE_BOX);
  assert.equal(truth.pageChrome.meta.x, PAGE_BOX.x);
  const section = truth.sections['100:2'];
  assert.ok(section);
  assert.deepEqual(section.meta.pageBox, SECTION_PAGE);
  assert.equal(section.meta.x, SECTION_PAGE.x);
  assert.equal(section.meta.width, SECTION_PAGE.w);
  assert.equal(section.meta.height, SECTION_PAGE.h);
  assert.notEqual(section.meta.x, SECTION_CANVAS.x);
});

test('skipped Auto Layout max is locked onto live TEXT so fit can find the owner', () => {
  const inv = fixture();
  inv.nodes.push(
    {
      id: 'clip',
      scope: 'page',
      type: 'FRAME',
      name: '正文',
      parentId: '100:2',
      ancestorIds: [PAGE_ID, '100:2'],
      status: 'unknown',
      clipsContent: true,
      pageBox: { x: 942, y: 3534, w: 1954, h: 263 },
    },
    {
      id: 'wrap',
      scope: 'page',
      type: 'FRAME',
      name: 'Frame 1312316812',
      parentId: 'clip',
      ancestorIds: [PAGE_ID, '100:2', 'clip'],
      status: 'skipped',
      why: 'art-fragment',
      layout: { layoutMode: 'HORIZONTAL', maxWidth: 1954, maxHeight: 250 },
      pageBox: { x: 942, y: 3594, w: 1954, h: 144 },
    },
    {
      id: 'body-copy',
      scope: 'page',
      type: 'TEXT',
      name: '嘉年华正文',
      parentId: 'wrap',
      ancestorIds: [PAGE_ID, '100:2', 'clip', 'wrap'],
      status: 'determined',
      role: 'copy',
      pageBox: { x: 942, y: 3594, w: 1954, h: 144 },
      text: { characters: '正文', fontFamily: 'Source Han Sans', fontWeight: 600, fontSize: 32, letterSpacing: 0 },
    },
  );
  const truth = platformTruthFromInventory(inv);
  assert.equal(truth.ok, true, (truth.problems || []).join('\n'));
  const copy = truth.sections['100:2'].nodes.find((node) => node.id === 'body-copy');
  assert.ok(copy);
  assert.equal(copy.parentId, 'clip');
  assert.equal(copy.layout.maxWidth, 1954);
  assert.equal(copy.layout.maxHeight, 250);
  assert.equal(copy.fitOwnerFromSkipped.sourceId, 'wrap');
  assert.equal(truth.sections['100:2'].nodes.some((node) => node.id === 'wrap'), false);
});

test('live nodes keep inventory pageBox/parentBox/text/sliceExport/constraints', () => {
  const inv = fixture();
  const truth = platformTruthFromInventory(inv);
  assert.equal(truth.ok, true, (truth.problems || []).join('\n'));
  const title = truth.sections['100:2'].nodes.find((node) => node.id === '100:5');
  assert.ok(title);
  assert.deepEqual(title.pageBox, NODE_PAGE);
  assert.deepEqual(title.parentBox, SECTION_PAGE);
  assert.deepEqual(title.text, TEXT);
  assert.deepEqual(title.layout.constraints, LAYOUT.constraints);
  assert.equal(title.layout.layoutMode, LAYOUT.layoutMode);
  const kv = truth.pageChrome.nodes.find((node) => node.id === '100:3');
  assert.ok(kv);
  assert.deepEqual(kv.pageBox, NODE_PAGE);
  assert.deepEqual(kv.sliceExport, SLICE);
  assert.deepEqual(kv.layout.constraints, LAYOUT.constraints);
});

test('section meta keeps clipsContent from the live section node', () => {
  const inv = fixture();
  inv.nodes[1].clipsContent = true;
  const truth = platformTruthFromInventory(inv);
  assert.equal(truth.ok, true, (truth.problems || []).join('\n'));
  assert.equal(truth.sections['100:2'].meta.clipsContent, true);
});

test('section-owned bg paints in its section once, not pageChrome', () => {
  const inv = fixture();
  inv.sections.push({
    id: '100:12',
    number: 2,
    label: '2',
    box: { x: 9000, y: 9080, w: 1920, h: 1080 },
    pageBox: { x: 0, y: 1080, w: 1920, h: 1080 },
    parentBox: { ...PAGE_BOX },
  });
  inv.backgrounds.push({ id: '100:13', role: 'bg', label: 'pc背景1' });
  inv.nodes.push(
    {
      id: '100:12',
      scope: 'page',
      type: 'FRAME',
      name: 'sec/2',
      parentId: PAGE_ID,
      orderKey: '0.2',
      status: 'unknown',
      role: 'sec',
      ancestorIds: [PAGE_ID],
      box: { x: 9000, y: 9080, w: 1920, h: 1080 },
      pageBox: { x: 0, y: 1080, w: 1920, h: 1080 },
    },
    {
      id: '100:13',
      scope: 'page',
      type: 'RECTANGLE',
      name: 'bg/pc背景1',
      parentId: '100:12',
      orderKey: '0.2.0',
      status: 'determined',
      role: 'bg',
      behavior: 'slice',
      ancestorIds: [PAGE_ID, '100:12'],
      box: { x: 9000, y: 9080, w: 1920, h: 1080 },
      pageBox: { x: 0, y: 1080, w: 1920, h: 1080 },
    },
  );
  const truth = platformTruthFromInventory(inv);
  assert.equal(truth.ok, true, (truth.problems || []).join('\n'));
  assert.equal(truth.pageChrome.nodes.some((node) => node.id === '100:13'), false);
  const sectionNodes = (truth.sections['100:12'] && truth.sections['100:12'].nodes) || [];
  assert.equal(sectionNodes.filter((node) => node.id === '100:13').length, 1);
  assert.ok(truth.pageChrome.nodes.some((node) => node.id === '100:3'));
});

test('adapter source must not fall back to box ?? pageBox', () => {
  const src = readFileSync(fileURLToPath(new URL('../lib/ready-handoff-truth.mjs', import.meta.url)), 'utf8');
  assert.equal(/entry\?\.box\s*\?\?\s*entry\?\.pageBox/.test(src), false);
  assert.equal(/inventory\.page\?\.box\s*\?\?\s*\{\}/.test(src), false);
  assert.equal(/entry\?\.pageBox/.test(src), true);
});

test('readyPlatformTruth stamps design.fileVersion from source lastModified', () => {
  const src = readFileSync(fileURLToPath(new URL('../lib/ready-handoff-truth.mjs', import.meta.url)), 'utf8');
  assert.match(src, /source\?\.lastModified \|\| source\?\.snapshotHash \|\| fingerprint/);
  assert.match(src, /design: fileVersion \? \{ fileVersion \} : undefined/);
});

test('section-owned bg/ stays in the section tree, not pageChrome', () => {
  const inv = fixture();
  inv.backgrounds = [
    { id: '100:3', role: 'kv', label: 'background' },
    { id: 'bg-sec2', role: 'bg', label: 'pc背景1' },
  ];
  inv.sections.push({
    id: '100:9',
    number: 2,
    label: '2',
    box: { x: 9000, y: 9080, w: 1920, h: 1080 },
    pageBox: { x: 0, y: 1080, w: 1920, h: 1080 },
    parentBox: { ...PAGE_BOX },
  });
  inv.nodes.push({
    id: '100:9',
    scope: 'page',
    type: 'FRAME',
    name: 'sec/2',
    parentId: PAGE_ID,
    orderKey: '0.2',
    status: 'unknown',
    role: 'sec',
    ancestorIds: [PAGE_ID],
    pageBox: { x: 0, y: 1080, w: 1920, h: 1080 },
    parentBox: { ...PAGE_BOX },
  }, {
    id: 'bg-sec2',
    scope: 'page',
    type: 'FRAME',
    name: 'bg/pc背景1',
    parentId: '100:9',
    orderKey: '0.2.0',
    status: 'determined',
    role: 'bg',
    ancestorIds: [PAGE_ID, '100:9'],
    pageBox: { x: 0, y: 1080, w: 1920, h: 1080 },
    parentBox: { x: 0, y: 0, w: 1920, h: 1080 },
    sliceExport: { box: { x: 0, y: 1080, w: 1920, h: 1080 }, scale: 1, format: 'png', file: 'bg-sec2.png' },
  });
  const truth = platformTruthFromInventory(inv);
  assert.equal(truth.ok, true, (truth.problems || []).join('\n'));
  assert.equal(truth.pageChrome.nodes.some((node) => node.id === 'bg-sec2'), false);
  assert.equal(truth.sections['100:9'].nodes.some((node) => node.id === 'bg-sec2'), true);
  assert.equal(truth.pageChrome.nodes.some((node) => node.id === '100:3'), true);
});

test('section meta keeps clipsContent from the source node', () => {
  const inv = fixture();
  inv.nodes[1].clipsContent = true;
  const truth = platformTruthFromInventory(inv);
  assert.equal(truth.sections['100:2'].meta.clipsContent, true);
});

test('untagged duplicate fix/ copies do not all pin at the sticky origin', () => {
  const inv = fixture();
  inv.overlays = [
    { id: 'fix-1', role: 'fix', label: '顶部信息', pin: 'viewport' },
    { id: 'fix-2', role: 'fix', label: '顶部信息', pin: 'viewport' },
  ];
  inv.nodes.push(
    {
      id: 'fix-1',
      scope: 'page',
      type: 'GROUP',
      name: 'fix/顶部信息',
      parentId: '100:2',
      ancestorIds: [PAGE_ID, '100:2'],
      orderKey: '0.0.1',
      status: 'determined',
      role: 'fix',
      pin: 'viewport',
      pageBox: { x: 0, y: 0, w: 3793, h: 493 },
      parentBox: { x: 0, y: 0, w: 3793, h: 493 },
    },
    {
      id: 'fix-1-btn',
      scope: 'page',
      type: 'INSTANCE',
      name: 'btn/按钮',
      parentId: 'fix-1',
      ancestorIds: [PAGE_ID, '100:2', 'fix-1'],
      orderKey: '0.0.1.0',
      status: 'determined',
      role: 'btn',
      pageBox: { x: 2764, y: 70, w: 516, h: 150 },
      parentBox: { x: 2764, y: 70, w: 516, h: 150 },
    },
    {
      id: 'fix-2',
      scope: 'page',
      type: 'GROUP',
      name: 'fix/顶部信息',
      parentId: '100:2',
      ancestorIds: [PAGE_ID, '100:2'],
      orderKey: '0.0.2',
      status: 'determined',
      role: 'fix',
      pin: 'viewport',
      pageBox: { x: 0, y: 2143, w: 3793, h: 493 },
      parentBox: { x: 0, y: 0, w: 3793, h: 493 },
    },
    {
      id: 'fix-2-btn',
      scope: 'page',
      type: 'INSTANCE',
      name: 'btn/按钮',
      parentId: 'fix-2',
      ancestorIds: [PAGE_ID, '100:2', 'fix-2'],
      orderKey: '0.0.2.0',
      status: 'determined',
      role: 'btn',
      pageBox: { x: 2764, y: 2213, w: 516, h: 150 },
      parentBox: { x: 2764, y: 70, w: 516, h: 150 },
    },
  );
  const truth = platformTruthFromInventory(inv);
  assert.equal(truth.ok, true, (truth.problems || []).join('\n'));
  assert.deepEqual(truth.fixedOverlays.nodes.map((node) => node.id).sort(), ['fix-1', 'fix-1-btn']);
  assert.equal(truth.fixedOverlays.nodes.some((node) => node.id === 'fix-2-btn'), false);
  assert.equal(truth.sections['100:2'].nodes.some((node) => node.id === 'fix-2' || node.id === 'fix-2-btn'), false);
});

test('fix overlay descendants leave sections and keep inventory pageBox', () => {
  const inv = fixture();
  inv.overlays = [{ id: 'fix-2', role: 'fix', label: '顶部信息', pin: 'viewport' }];
  inv.nodes.push(
    {
      id: 'fix-2',
      scope: 'page',
      type: 'GROUP',
      name: 'fix/顶部信息',
      parentId: '100:2',
      ancestorIds: [PAGE_ID, '100:2'],
      orderKey: '0.0.1',
      status: 'determined',
      role: 'fix',
      pin: 'viewport',
      pageBox: { x: 0, y: 2143, w: 3793, h: 493 },
      parentBox: { x: 0, y: 0, w: 3793, h: 493 },
      viewportBox: { x: 0, y: 2143, w: 3793, h: 493 },
    },
    {
      id: 'fix-btn',
      scope: 'page',
      type: 'INSTANCE',
      name: 'btn/按钮',
      parentId: 'fix-2',
      ancestorIds: [PAGE_ID, '100:2', 'fix-2'],
      orderKey: '0.0.1.0',
      status: 'determined',
      role: 'btn',
      pageBox: { x: 2764, y: 2213, w: 516, h: 150 },
      parentBox: { x: 2764, y: 70, w: 516, h: 150 },
      sliceExport: { bounds: 'render', scale: 1, format: 'png', file: 'fix-btn.png', box: { x: 2764, y: 2213, w: 516, h: 150 } },
    },
  );
  const truth = platformTruthFromInventory(inv);
  assert.equal(truth.ok, true, (truth.problems || []).join('\n'));
  assert.equal(truth.sections['100:2'].nodes.some((node) => node.id === 'fix-btn'), false);
  const overlay = truth.fixedOverlays.nodes.find((node) => node.id === 'fix-2');
  const btn = truth.fixedOverlays.nodes.find((node) => node.id === 'fix-btn');
  assert.ok(overlay);
  assert.ok(btn);
  assert.deepEqual(overlay.box, { x: 0, y: 2143, w: 3793, h: 493 });
  assert.deepEqual(btn.box, { x: 2764, y: 2213, w: 516, h: 150 });
  assert.deepEqual(btn.sliceExport.box, { x: 2764, y: 2213, w: 516, h: 150 });
});

test('right-side fix overlay keeps inventory pageBox, not overlay-local 0,0', () => {
  const inv = fixture();
  inv.overlays = [{ id: 'fix-right', role: 'fix', label: '右侧浮层', pin: 'viewport' }];
  inv.nodes.push(
    {
      id: 'fix-right',
      scope: 'page',
      type: 'GROUP',
      name: 'fix/右侧浮层',
      parentId: '100:2',
      ancestorIds: [PAGE_ID, '100:2'],
      orderKey: '0.0.1',
      status: 'determined',
      role: 'fix',
      pin: 'viewport',
      pageBox: { x: 2764, y: 70, w: 1029, h: 423 },
      parentBox: { x: 2764, y: 70, w: 1029, h: 423 },
    },
    {
      id: 'fix-right-dropmenu',
      scope: 'page',
      type: 'INSTANCE',
      name: 'dropmenu/下拉菜单',
      parentId: 'fix-right',
      ancestorIds: [PAGE_ID, '100:2', 'fix-right'],
      orderKey: '0.0.1.0',
      status: 'determined',
      role: 'dropmenu',
      pageBox: { x: 3539, y: 76, w: 254, h: 417 },
      parentBox: { x: 775, y: 6, w: 254, h: 417 },
    },
  );
  const truth = platformTruthFromInventory(inv);
  assert.equal(truth.ok, true, (truth.problems || []).join('\n'));
  const overlay = truth.fixedOverlays.nodes.find((node) => node.id === 'fix-right');
  const child = truth.fixedOverlays.nodes.find((node) => node.id === 'fix-right-dropmenu');
  assert.ok(overlay);
  assert.ok(child);
  assert.deepEqual(overlay.box, { x: 2764, y: 70, w: 1029, h: 423 });
  assert.deepEqual(overlay.pageBox, { x: 2764, y: 70, w: 1029, h: 423 });
  assert.deepEqual(overlay.parentBox, { x: 2764, y: 70, w: 1029, h: 423 });
  assert.deepEqual(child.box, { x: 3539, y: 76, w: 254, h: 417 });
});

test('fix nested sliceExport keeps inventory pageBox, not overlay-local x/y', () => {
  const inv = fixture();
  inv.overlays = [{ id: 'fix-1', role: 'fix', label: '顶部信息', pin: 'viewport' }];
  inv.nodes.push(
    {
      id: 'fix-1',
      scope: 'page',
      type: 'GROUP',
      name: 'fix/顶部信息',
      parentId: '100:2',
      ancestorIds: [PAGE_ID, '100:2'],
      orderKey: '0.0.1',
      status: 'determined',
      role: 'fix',
      pin: 'viewport',
      pageBox: { x: 0, y: 0, w: 3793, h: 493 },
      parentBox: { x: 0, y: 0, w: 3793, h: 493 },
    },
    {
      id: 'fix-btn',
      scope: 'page',
      type: 'INSTANCE',
      name: 'btn/按钮',
      parentId: 'fix-1',
      ancestorIds: [PAGE_ID, '100:2', 'fix-1'],
      orderKey: '0.0.1.0',
      status: 'determined',
      role: 'btn',
      pageBox: { x: 2764, y: 70, w: 516, h: 150 },
      parentBox: { x: 2764, y: 70, w: 516, h: 150 },
    },
    {
      id: 'fix-img',
      scope: 'page',
      type: 'GROUP',
      name: 'img/按钮背景',
      parentId: 'fix-btn',
      ancestorIds: [PAGE_ID, '100:2', 'fix-1', 'fix-btn'],
      orderKey: '0.0.1.0.0',
      status: 'determined',
      role: 'img',
      pageBox: { x: 2821, y: 104, w: 402, h: 84 },
      parentBox: { x: 57, y: 34, w: 402, h: 84 },
      sliceExport: {
        bounds: 'render',
        scale: 1,
        format: 'png',
        file: 'fix-img.png',
        box: { x: 2788, y: 71, w: 468, h: 149 },
      },
    },
  );
  const truth = platformTruthFromInventory(inv);
  const img = truth.fixedOverlays.nodes.find((node) => node.id === 'fix-img');
  assert.ok(img);
  assert.deepEqual(img.box, { x: 2821, y: 104, w: 402, h: 84 });
  assert.deepEqual(img.sliceExport.box, { x: 2788, y: 71, w: 468, h: 149 });
});

test('horizontally offset mobile sections fold onto x=0 and keep inventory y', () => {
  const inv = fixture();
  inv.page = { id: PAGE_ID, name: 'cn_mobile', box: { x: 0, y: 0, w: 2430, h: 2668 }, pageBox: { x: 0, y: 0, w: 2430, h: 2668 } };
  inv.sections = [
    { id: 'm1', number: 1, label: '1', pageBox: { x: 0, y: 0, w: 750, h: 1334 } },
    { id: 'm2', number: 2, label: '2', pageBox: { x: 840, y: 1334, w: 750, h: 1334 } },
  ];
  inv.nodes = [
    { id: PAGE_ID, scope: 'page', type: 'FRAME', name: 'cn_mobile', parentId: null, orderKey: '0', status: 'unknown', pageBox: { x: 0, y: 0, w: 2430, h: 2668 } },
    { id: 'm1', scope: 'page', type: 'FRAME', name: 'sec/1', parentId: PAGE_ID, ancestorIds: [PAGE_ID], orderKey: '0.0', status: 'determined', role: 'sec', pageBox: { x: 0, y: 0, w: 750, h: 1334 } },
    { id: 'm2', scope: 'page', type: 'FRAME', name: 'sec/2', parentId: PAGE_ID, ancestorIds: [PAGE_ID], orderKey: '0.1', status: 'determined', role: 'sec', pageBox: { x: 840, y: 1334, w: 750, h: 1334 } },
    {
      id: 'bg-m2',
      scope: 'page',
      type: 'FRAME',
      name: 'bg/移动端背景',
      parentId: 'm2',
      ancestorIds: [PAGE_ID, 'm2'],
      orderKey: '0.1.0',
      status: 'determined',
      role: 'bg',
      pageBox: { x: 840, y: 1334, w: 750, h: 1334 },
    },
    {
      id: 'kv-m2',
      scope: 'page',
      type: 'RECTANGLE',
      name: '赛季kv-0623-整理_竖版_2 1',
      parentId: 'bg-m2',
      ancestorIds: [PAGE_ID, 'm2', 'bg-m2'],
      orderKey: '0.1.0.0',
      status: 'skipped',
      why: 'slice-child',
      pageBox: { x: -344, y: 1334, w: 2404, h: 1347 },
      style: { fills: [{ type: 'IMAGE', visible: true }] },
    },
  ];
  const truth = platformTruthFromInventory(inv);
  assert.equal(truth.ok, true, (truth.problems || []).join('\n'));
  assert.equal(truth.sections.m2.meta.x, 0);
  assert.equal(truth.sections.m2.meta.y, 1334);
  const bg = truth.sections.m2.nodes.find((node) => node.id === 'bg-m2');
  const kv = truth.sections.m2.nodes.find((node) => node.id === 'kv-m2');
  assert.ok(bg);
  /* bg/ is the listed whole-frame export. Skipped IMAGE slice-children stay
     inside that PNG and must not re-enter the paint tree. */
  assert.equal(kv, undefined);
  assert.equal(bg.pageBox.x, 0);
  assert.equal(bg.pageBox.y, 1334);
});

test('canvas-offset modal draws from pageBox, never canvas box', () => {
  const inv = fixture();
  const modalCanvas = { x: 9000, y: 8000, w: 400, h: 300 };
  const modalPage = { x: 0, y: 0, w: 400, h: 300 };
  const childCanvas = { x: 9100, y: 8100, w: 40, h: 24 };
  const childPage = { x: 100, y: 100, w: 40, h: 24 };
  inv.attachments.modals = [{
    id: '100:20',
    name: 'modal/视频弹窗',
    box: { ...modalCanvas },
    pageBox: { ...modalPage },
    nodes: [
      { id: '100:20', name: 'modal/视频弹窗', status: 'determined', role: 'modal', box: { ...modalCanvas }, pageBox: { ...modalPage } },
      { id: '100:21', name: 'btn/关闭', parentId: '100:20', status: 'determined', role: 'btn', box: { ...childCanvas }, pageBox: { ...childPage } },
    ],
  }];
  const truth = platformTruthFromInventory(inv);
  assert.equal(truth.ok, true, (truth.problems || []).join('\n'));
  const modal = truth.modals.find((entry) => entry.id === '100:20');
  assert.ok(modal);
  assert.deepEqual(modal.pageBox, modalPage);
  assert.deepEqual(modal.box, modalPage);
  assert.notEqual(modal.box.x, modalCanvas.x);
  const child = modal.nodes.find((node) => node.id === '100:21');
  assert.ok(child);
  assert.deepEqual(child.pageBox, childPage);
  assert.deepEqual(child.box, childPage);
  assert.notEqual(child.box.x, childCanvas.x);
});

function bottomFixInventory(pageBox) {
  const inv = fixture();
  inv.page.pageBox = { ...pageBox };
  inv.nodes[0].pageBox = { ...pageBox };
  inv.overlays = [{ id: 'fix-arrow', role: 'fix', label: '箭头', pin: 'viewport' }];
  inv.nodes.push({
    id: 'fix-arrow',
    scope: 'page',
    type: 'GROUP',
    name: 'fix/箭头',
    parentId: PAGE_ID,
    ancestorIds: [PAGE_ID],
    orderKey: '0.3',
    status: 'determined',
    role: 'fix',
    pin: 'viewport',
    pageBox: { x: 1885, y: 2014, w: 70, h: 48 },
    parentBox: { x: 1885, y: 2014, w: 70, h: 48 },
    layout: { constraints: { horizontal: 'CENTER', vertical: 'BOTTOM' } },
  });
  return inv;
}

test('BOTTOM fix/ keeps source size and stores the parent-board bottom gap', () => {
  const overlay = platformTruthFromInventory(bottomFixInventory({ x: 0, y: 0, w: 3840, h: 2160 }))
    .fixedOverlays.nodes.find((node) => node.id === 'fix-arrow');
  assert.ok(overlay);
  assert.deepEqual(overlay.box, { x: 1885, y: 2014, w: 70, h: 48 });
  assert.equal(overlay.pinEdges.vertical, 'BOTTOM');
  assert.equal(overlay.pinEdges.horizontal, 'CENTER');
  assert.equal(overlay.pinEdges.gapBottom, 2160 - (2014 + 48));
  assert.equal(overlay.pinEdges.boardW, 3840);
  assert.equal(overlay.pinEdges.boardH, 2160);
});

test('BOTTOM fix/ uses parent pageBox, not sec/1', () => {
  const overlay = platformTruthFromInventory(bottomFixInventory({ x: 0, y: 0, w: 3840, h: 8000 }))
    .fixedOverlays.nodes.find((node) => node.id === 'fix-arrow');
  assert.equal(overlay.pinEdges.gapBottom, 8000 - (2014 + 48));
  assert.notEqual(overlay.pinEdges.boardH, 1080);
});

test('TOP fix/ still pins at overlay origin', () => {
  const inv = fixture();
  inv.overlays = [{ id: 'fix-1', role: 'fix', label: '顶部信息', pin: 'viewport' }];
  inv.nodes.push({
    id: 'fix-1',
    scope: 'page',
    type: 'GROUP',
    name: 'fix/顶部信息',
    parentId: PAGE_ID,
    ancestorIds: [PAGE_ID],
    orderKey: '0.3',
    status: 'determined',
    role: 'fix',
    pin: 'viewport',
    pageBox: { x: 0, y: 0, w: 3793, h: 493 },
    parentBox: { ...PAGE_BOX },
    layout: { constraints: { horizontal: 'LEFT', vertical: 'TOP' } },
  });
  const truth = platformTruthFromInventory(inv);
  const overlay = truth.fixedOverlays.nodes.find((node) => node.id === 'fix-1');
  assert.ok(overlay);
  assert.deepEqual(overlay.box, { x: 0, y: 0, w: 3793, h: 493 });
  assert.equal(overlay.pinEdges.vertical, 'TOP');
});
