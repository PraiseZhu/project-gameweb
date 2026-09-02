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

test('adapter source must not fall back to box ?? pageBox', () => {
  const src = readFileSync(fileURLToPath(new URL('../lib/ready-handoff-truth.mjs', import.meta.url)), 'utf8');
  assert.equal(/entry\?\.box\s*\?\?\s*entry\?\.pageBox/.test(src), false);
  assert.equal(/inventory\.page\?\.box\s*\?\?\s*\{\}/.test(src), false);
  assert.equal(/entry\?\.pageBox/.test(src), true);
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
