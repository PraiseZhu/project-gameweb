import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expectedDrawBox,
  evaluateInventoryStaticGate,
  runInventoryStaticGate,
} from '../lib/inventory-static-gate.mjs';

const PAGE_BOX = { x: 10, y: 20, w: 200, h: 40 };
const CANVAS_BOX = { x: 9000, y: 8000, w: 200, h: 40 };

function inventory() {
  return {
    schema: 'inventory/v2',
    nodes: [
      {
        id: 'n1',
        status: 'determined',
        role: 'copy',
        box: CANVAS_BOX,
        pageBox: PAGE_BOX,
        text: { fontFamily: 'Source Han Sans', fontWeight: 400, fontSize: 16 },
        sliceExport: { box: PAGE_BOX, scale: 1, format: 'png', file: 'n1.png' },
      },
    ],
  };
}

test('expectation is pageBox, never canvas box', () => {
  const box = expectedDrawBox(inventory().nodes[0]);
  assert.deepEqual(box, PAGE_BOX);
  assert.notEqual(box.x, CANVAS_BOX.x);
});

test('design-viewport zh-CN mismatch is red; resize viewport is skipped not red', () => {
  const inv = inventory();
  const red = evaluateInventoryStaticGate({
    inventory: inv,
    lang: 'zh-CN',
    viewportKind: 'design',
    measurements: { nodes: { n1: { x: 10, y: 20, w: 400, h: 40, fontSize: 16 } } },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('pageBox-mismatch')));

  const skipped = evaluateInventoryStaticGate({
    inventory: inv,
    lang: 'zh-CN',
    viewportKind: 'resize',
    measurements: { nodes: { n1: { x: 0, y: 0, w: 1, h: 1 } } },
  });
  assert.equal(skipped.ok, true);
  assert.equal(skipped.skipped, true);
});

test('fontSize step-fit change is red', () => {
  const red = evaluateInventoryStaticGate({
    inventory: inventory(),
    measurements: { nodes: { n1: { x: 10, y: 20, w: 200, h: 40, fontSize: 14 } } },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('fontSize-mismatch')));
});

test('missing probe / throw / no JSON is fail-closed red, never skipped-ok', () => {
  const dir = mkdtempSync(join(tmpdir(), 'static-gate-'));
  writeFileSync(join(dir, 'inventory-pc.json'), JSON.stringify(inventory()));
  writeFileSync(join(dir, 'inventory-mobile.json'), JSON.stringify(inventory()));
  assert.equal(runInventoryStaticGate({ handoffDir: dir }).ok, false);
  assert.equal(runInventoryStaticGate({
    handoffDir: dir,
    probe: () => { throw new Error('boom'); },
  }).ok, false);
  assert.equal(runInventoryStaticGate({
    handoffDir: dir,
    probe: () => null,
  }).ok, false);
});

test('missing pageBox on a live node is red, never skipped-ok', () => {
  const red = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      nodes: [
        {
          id: 'n-missing',
          status: 'determined',
          role: 'copy',
          box: CANVAS_BOX,
        },
      ],
    },
    measurements: {
      nodes: {
        'n-missing': { x: CANVAS_BOX.x, y: CANVAS_BOX.y, w: CANVAS_BOX.w, h: CANVAS_BOX.h },
      },
    },
  });
  assert.equal(red.ok, false);
  assert.equal(red.skipped, false);
  assert.ok(red.problems.some((line) => line.includes('missing-pageBox')));
});

test('matching DOM pageBox + fontSize + slice is green', () => {
  const green = evaluateInventoryStaticGate({
    inventory: inventory(),
    measurements: {
      nodes: {
        n1: { x: 10, y: 20, w: 200, h: 40, fontSize: 16, imgBox: PAGE_BOX },
      },
    },
  });
  assert.equal(green.ok, true);
  assert.equal(green.expectationSource, 'handoff-inventory');
});

test('probe script is a shipped skill file, not an optional local extra', () => {
  const probe = join(fileURLToPath(new URL('../lib/inventory-static-gate-probe.mjs', import.meta.url)));
  const src = readFileSync(probe, 'utf8');
  assert.match(src, /withQaShell\(`\$\{base\}\/index\.html\?inventory-static-gate=1`\)/);
  assert.match(src, /platform === 'mobile' \? 'mobile' : 'desktop'/);
});

test('descendants baked into an ancestor PNG are not missing-dom', () => {
  const green = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      nodes: [
        {
          id: 'owner',
          status: 'determined',
          role: 'img',
          pageBox: PAGE_BOX,
          sliceExport: { box: PAGE_BOX, scale: 1, format: 'png', file: 'owner.png' },
        },
        {
          id: 'skipped-parent',
          status: 'skipped',
          parentId: 'owner',
          pageBox: PAGE_BOX,
        },
        {
          id: 'child',
          status: 'determined',
          role: 'copy',
          parentId: 'skipped-parent',
          ancestorIds: ['owner', 'skipped-parent'],
          pageBox: { x: 12, y: 22, w: 40, h: 16 },
          text: { fontFamily: 'Source Han Sans', fontWeight: 400, fontSize: 16 },
        },
      ],
    },
    measurements: {
      nodes: {
        owner: { x: 10, y: 20, w: 200, h: 40, imgBox: PAGE_BOX, bakedDescendants: true },
      },
    },
  });
  assert.equal(green.ok, true, (green.problems || []).join('\n'));
});

test('render-bound slice imgBox is compared to sliceExport.box, not owner pageBox', () => {
  const sliceBox = { x: 0, y: 10, w: 220, h: 320 };
  const ownerBox = { x: 10, y: 20, w: 200, h: 300 };
  const green = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      nodes: [
        {
          id: 'n-spill',
          status: 'determined',
          role: 'img',
          pageBox: ownerBox,
          sliceExport: { box: sliceBox, scale: 1, format: 'png', file: 'n-spill.png', bounds: 'render' },
        },
      ],
    },
    measurements: {
      nodes: {
        'n-spill': { x: 10, y: 20, w: 200, h: 300, imgBox: sliceBox },
      },
    },
  });
  assert.equal(green.ok, true, (green.problems || []).join('\n'));

  const red = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      nodes: [
        {
          id: 'n-spill',
          status: 'determined',
          role: 'img',
          pageBox: ownerBox,
          sliceExport: { box: sliceBox, scale: 1, format: 'png', file: 'n-spill.png', bounds: 'render' },
        },
      ],
    },
    measurements: {
      nodes: {
        'n-spill': { x: 10, y: 20, w: 200, h: 300, imgBox: ownerBox },
      },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('sliceExport-mismatch')));
});

test('sliceExport without box is red, never skipped-ok', () => {
  const red = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      nodes: [
        {
          id: 'n-slice',
          status: 'determined',
          role: 'img',
          sliceExport: { bounds: 'render', scale: 1, format: 'png', file: 'n-slice.png' },
        },
      ],
    },
    measurements: {
      nodes: {
        'n-slice': { x: 10, y: 20, w: 200, h: 40, imgBox: PAGE_BOX },
      },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('missing-sliceExport-box')));
});
