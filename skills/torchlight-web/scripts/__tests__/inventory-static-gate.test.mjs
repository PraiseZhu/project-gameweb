import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { pngMeta } from '../lib/inventory-static-gate-probe.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expectedDrawBox,
  evaluateInventoryStaticGate,
  evaluateProductScrollGate,
  chromeTopBarContract,
  laterKvMeasureIds,
  laterKvPaintNode,
  firstKvMeasureId,
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

function stickyProductScroll(ids = ['fix-1', 'fix-1-btn']) {
  return {
    overlay: { position: 'sticky', transform: 'none', zoom: '1' },
    overlayDeltas: Object.fromEntries(ids.map((id) => [id, { dTop: 0, dLeft: 0 }])),
    scrolled: 1,
    scrollTop: 720,
  };
}

test('fix descendants expect parentBox in the sticky overlay, not later-section page y', () => {
  const box = expectedDrawBox({
    id: 'fix-btn',
    role: 'btn',
    ancestorIds: ['fix-2'],
    pageBox: { x: 2764, y: 2213, w: 516, h: 150 },
    parentBox: { x: 2764, y: 70, w: 516, h: 150 },
  }, new Map([
    ['fix-2', { id: 'fix-2', role: 'fix', pin: 'viewport', pageBox: { x: 0, y: 2143, w: 3793, h: 493 } }],
  ]));
  assert.deepEqual(box, { x: 2764, y: 70, w: 516, h: 150 });
});

test('nested fix img expects overlay-absolute pageBox minus owner, not parentBox', () => {
  const box = expectedDrawBox({
    id: 'fix-img',
    role: 'img',
    ancestorIds: ['fix-2', 'fix-btn'],
    pageBox: { x: 2821, y: 2247, w: 402, h: 84 },
    parentBox: { x: 57, y: 34, w: 402, h: 84 },
  }, new Map([
    ['fix-2', { id: 'fix-2', role: 'fix', pin: 'viewport', pageBox: { x: 0, y: 2143, w: 3793, h: 493 } }],
    ['fix-btn', { id: 'fix-btn', role: 'btn', pageBox: { x: 2764, y: 2213, w: 516, h: 150 } }],
  ]));
  assert.deepEqual(box, { x: 2821, y: 104, w: 402, h: 84 });
});

test('expectation is pageBox, never canvas box', () => {
  const box = expectedDrawBox(inventory().nodes[0]);
  assert.deepEqual(box, PAGE_BOX);
  assert.notEqual(box.x, CANVAS_BOX.x);
});

test('mobile sibling-board sections expect x folded onto the 750-wide page', () => {
  const byId = new Map([
    ['sec-2', { id: 'sec-2', role: 'sec', name: 'sec/2', pageBox: { x: 840, y: 1334, w: 750, h: 1334 } }],
    ['bg-2', { id: 'bg-2', role: 'bg', name: 'bg/移动端背景', ancestorIds: ['sec-2'], pageBox: { x: 840, y: 1334, w: 750, h: 1334 } }],
  ]);
  const box = expectedDrawBox(byId.get('bg-2'), byId);
  assert.deepEqual(box, { x: 0, y: 1334, w: 750, h: 1334 });
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

test('fontWeight mismatch is red', () => {
  const red = evaluateInventoryStaticGate({
    inventory: inventory(),
    measurements: {
      nodes: {
        n1: {
          x: 10, y: 20, w: 200, h: 40, fontSize: 16,
          fontFamily: 'Source Han Sans', fontWeight: 400,
          hasImg: true, imgBox: PAGE_BOX,
        },
      },
    },
  });
  const inv = inventory();
  inv.nodes[0].text.fontWeight = 600;
  const mismatch = evaluateInventoryStaticGate({
    inventory: inv,
    measurements: {
      nodes: {
        n1: {
          x: 10, y: 20, w: 200, h: 40, fontSize: 16,
          fontFamily: 'Source Han Sans', fontWeight: 400,
          hasImg: true, imgBox: PAGE_BOX,
        },
      },
    },
  });
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.problems.some((line) => line.includes('n1: fontWeight-mismatch')), (mismatch.problems || []).join('\n'));
  assert.equal(red.ok, true, (red.problems || []).join('\n'));
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
        n1: {
          x: 10, y: 20, w: 200, h: 40, fontSize: 16,
          fontFamily: 'Source Han Sans', fontWeight: 400,
          hasImg: true, imgBox: PAGE_BOX,
        },
      },
    },
  });
  assert.equal(green.ok, true);
  assert.equal(green.expectationSource, 'handoff-inventory');
});

test('opaque black PNG is not assetEmpty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'png-meta-black-'));
  const file = join(dir, 'black.png');
  const png = new PNG({ width: 16, height: 16 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 0;
    png.data[i + 1] = 0;
    png.data[i + 2] = 0;
    png.data[i + 3] = 255;
  }
  writeFileSync(file, PNG.sync.write(png));
  const meta = pngMeta(file);
  assert.equal(meta.assetEmpty, false);
  assert.equal(meta.assetW, 16);
  assert.equal(meta.assetH, 16);
});

test('probe script is a shipped skill file, not an optional local extra', () => {
  const probe = join(fileURLToPath(new URL('../lib/inventory-static-gate-probe.mjs', import.meta.url)));
  const src = readFileSync(probe, 'utf8');
  assert.match(src, /inventory-static-gate=1/);
  assert.match(src, /product=1/);
  assert.match(src, /measureProductScroll/);
  assert.match(src, /platform === 'mobile' \? 'mobile' : 'desktop'/);
  assert.match(src, /overlayOwnerOf/);
  assert.match(src, /inSection/);
  assert.match(src, /fontWeight/);
  assert.match(src, /laterKvMeasureIds/);
  assert.match(src, /laterKvPaintNode/);
  assert.match(src, /owner-ink-spill-natural/);
  assert.match(src, /viewport: \{[\s\S]*width: viewport\.w/);
  assert.match(src, /setPref\(plat\) after resize/);
  assert.match(src, /data-fix-from-active', 'static-gate'/);
  assert.match(src, /PRODUCT_VIEWPORTS/);
  assert.match(src, /sectionAbut/);
  assert.match(src, /--viewport/);
  assert.match(src, /width: Number\(viewport\.w\)/);
  assert.match(src, /height: Number\(viewport\.h\)/);
  assert.match(src, /data-node-id="section-\$\{cssEscape\(id\)\}"/);
  assert.match(src, /seamPixels/);
  assert.match(src, /seamSample/);
  assert.match(src, /firstScreenFloorSample/);
  assert.match(src, /firstScreenFloor/);
  assert.match(src, /slotDesignHeight/);
  assert.match(src, /frame\.scrollTop = Math\.max\(0, nextTop\)/);
  assert.match(src, /sectionAbutAfter/);
  assert.match(src, /nextRectAfter/);
  assert.match(src, /seamY = sectionAbutAfter && Number\.isFinite\(Number\(sectionAbutAfter\.nextTop\)\)/);
  assert.doesNotMatch(src, /const seamY = sectionAbut && Number\.isFinite\(Number\(sectionAbut\.nextTop\)\)/);
  assert.doesNotMatch(src, /Math\.min\(Number\(viewport\.h\) \|\| 720, 720\)/);
  assert.doesNotMatch(src, /Math\.min\(Math\.round\(firstH\), 1080\)/);
});

test('full-bleed kv IMAGE child is baked, not missing-dom', () => {
  const green = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      nodes: [
        {
          id: 'kv',
          status: 'unknown',
          name: 'kv',
          pageBox: { x: 0, y: 0, w: 3840, h: 2143 },
          sliceExport: { box: { x: 0, y: 0, w: 3840, h: 2143 }, scale: 1, format: 'png', file: 'kv.png' },
        },
        {
          id: 'crop',
          status: 'unknown',
          name: '赛季kv-0623-整理 2',
          parentId: 'kv',
          ancestorIds: ['kv'],
          pageBox: { x: 0, y: -4, w: 3848, h: 2156 },
          style: { fills: [{ type: 'IMAGE', visible: true }] },
        },
      ],
    },
    measurements: {
      nodes: {
        kv: { x: 0, y: 0, w: 3840, h: 2143, hasImg: true, imgBox: { x: 0, y: 0, w: 3840, h: 2143 } },
      },
      productScroll: {
        overlay: { position: 'sticky', transform: 'none', zoom: '1', height: '0px' },
        overlayDeltas: {},
        scrolled: 1,
        scrollTop: 1,
        layers: {},
        firstKv: { imgSrc: 'assets/kv.webp', assetW: 3840, assetH: 2143, assetEmpty: false },
      
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
    },
    },
  });
  assert.equal(green.ok, true, (green.problems || []).join('\n'));
});

test('product viewport rejects a gap between sec/1 and sec/2', () => {
  const inventory = {
    schema: 'inventory/v2',
    sections: [
      { id: 'sec-1', number: 1, pageBox: { x: 0, y: 0, w: 750, h: 1334 } },
      { id: 'sec-2', number: 2, pageBox: { x: 0, y: 1334, w: 750, h: 1334 } },
    ],
    nodes: [
      { id: 'sec-1', status: 'determined', role: 'sec', name: 'sec/1', pageBox: { x: 0, y: 0, w: 750, h: 1334 } },
      { id: 'sec-2', status: 'determined', role: 'sec', name: 'sec/2', pageBox: { x: 0, y: 1334, w: 750, h: 1334 } },
    ],
  };
  const red = evaluateProductScrollGate({
    inventory,
    viewportKind: 'product',
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1', height: '0px' },
      overlayDeltas: {},
      scrolled: 1,
      scrollTop: 1,
      layers: {
        'sec-1': { cropWindow: 'first-section-pagebox', height: 844, overflow: 'hidden' },
        'sec-2': { height: 889, overflow: 'hidden' },
      },
      sectionAbut: { gap: 45 },
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('section-gap')), (red.problems || []).join('\n'));

  const green = evaluateProductScrollGate({
    inventory,
    viewportKind: 'product',
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1', height: '0px' },
      overlayDeltas: {},
      scrolled: 1,
      scrollTop: 1,
      layers: {
        'sec-1': { cropWindow: 'first-section-pagebox', height: 1623, overflow: 'visible' },
        'sec-2': { height: 889, overflow: 'hidden' },
      },
      sectionAbut: { gap: 0 },
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
      slotDesignHeight: 1623,
      viewport: { w: 390, h: 844 },
      firstKv: { hostH: 844, imgSrc: 'assets/kv.webp', assetW: 750, assetH: 1334, assetEmpty: false },
      firstScreenFloor: { minLum: 40, rows: [{ lum: 40 }] },
    },
  });
  assert.equal(green.ok, true, (green.problems || []).join('\n'));

  const blackSeam = evaluateProductScrollGate({
    inventory,
    viewportKind: 'product',
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1', height: '0px' },
      overlayDeltas: {},
      scrolled: 1,
      scrollTop: 1,
      layers: {
        'sec-1': { cropWindow: 'first-section-pagebox', height: 844, overflow: 'hidden' },
        'sec-2': { height: 889, overflow: 'hidden' },
      },
      sectionAbut: { gap: 0 },
      seamPixels: { minLum: 8, variance: 4, mean: [12, 15, 20], rows: [{ lum: 8, rgba: [12, 15, 20, 255] }] },
    },
  });
  assert.equal(blackSeam.ok, false);
  assert.ok(blackSeam.problems.some((line) => line.includes('section-seam-black')), (blackSeam.problems || []).join('\n'));

  const shortKv = evaluateProductScrollGate({
    inventory,
    viewportKind: 'product',
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1', height: '0px' },
      overlayDeltas: {},
      scrolled: 1,
      scrollTop: 1,
      layers: {
        'sec-1': { cropWindow: 'first-section-pagebox', height: 1334, overflow: 'hidden' },
        'sec-2': { height: 889, overflow: 'hidden' },
      },
      sectionAbut: { gap: 0 },
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
      slotDesignHeight: 1623,
      viewport: { w: 390, h: 844 },
      firstKv: { hostH: 693, imgSrc: 'assets/kv.webp', assetW: 750, assetH: 1334, assetEmpty: false },
      firstScreenFloor: { minLum: 8, variance: 1, mean: [12, 14, 22], stageRatio: 1, rows: [{ lum: 8, rgba: [12, 14, 22, 255] }] },
    },
  });
  assert.equal(shortKv.ok, false);
  assert.ok(shortKv.problems.some((line) => line.includes('first-section-shorter-than-pageBox-or-slot')), (shortKv.problems || []).join('\n'));
  assert.ok(shortKv.problems.some((line) => line.includes('first-kv-shorter-than-viewport')), (shortKv.problems || []).join('\n'));
  assert.ok(shortKv.problems.some((line) => line.includes('first-screen-floor-black')), (shortKv.problems || []).join('\n'));
});

test('product viewport rejects a painted IMAGE child of a kv plate', () => {
  const red = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      sections: [{ id: 'sec-1', number: 1, pageBox: { x: 0, y: 0, w: 3840, h: 2143 } }],
      nodes: [
        {
          id: 'kv',
          status: 'unknown',
          name: 'kv',
          pageBox: { x: 0, y: 0, w: 3840, h: 2143 },
          sliceExport: { box: { x: 0, y: 0, w: 3840, h: 2143 }, scale: 1, format: 'png', file: 'kv.png' },
        },
        {
          id: 'crop',
          status: 'unknown',
          name: '赛季kv-0623-整理 2',
          parentId: 'kv',
          ancestorIds: ['kv'],
          pageBox: { x: 0, y: -4, w: 3848, h: 2156 },
          style: { fills: [{ type: 'IMAGE' }] },
        },
      ],
    },
    viewportKind: 'product',
    measurements: {
      nodes: {
        kv: { x: 0, y: 0, w: 1920, h: 728, hasImg: true },
        crop: { x: 0, y: 0, w: 1924, h: 1078, hasImg: true },
      },
      productScroll: {
        overlay: { position: 'sticky', transform: 'none', zoom: '1', height: '0px' },
        overlayDeltas: {},
        scrolled: 1,
        scrollTop: 1,
        layers: { 'sec-1': { cropWindow: 'first-section-pagebox', height: 728, overflow: 'hidden' } },
        firstKv: { imgSrc: 'assets/kv.webp', assetW: 3840, assetH: 2143, assetEmpty: false },
      
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
    },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('full-bleed-child-repainted')), (red.problems || []).join('\n'));
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
        owner: { x: 10, y: 20, w: 200, h: 40, hasImg: true, imgBox: PAGE_BOX, bakedDescendants: true },
      },
    },
  });
  assert.equal(green.ok, true, (green.problems || []).join('\n'));
});

test('BOOLEAN btn ink slice still compares to sliceExport.box, not pageBox', () => {
  const sliceBox = { x: 0, y: 10, w: 52, h: 54 };
  const ownerBox = { x: 10, y: 20, w: 40, h: 40 };
  const green = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      nodes: [
        {
          id: 'n-arrow',
          status: 'determined',
          role: 'btn',
          type: 'BOOLEAN_OPERATION',
          name: 'btn/右滑动箭头',
          pageBox: ownerBox,
          sliceExport: { box: sliceBox, scale: 1, format: 'png', file: 'n-arrow.png', bounds: 'render' },
        },
      ],
    },
    measurements: {
      nodes: {
        'n-arrow': { x: 10, y: 20, w: 40, h: 40, hasImg: true, imgBox: sliceBox },
      },
    },
  });
  assert.equal(green.ok, true, (green.problems || []).join('\n'));
});

test('empty first-screen kv PNG is red', () => {
  const inventory = {
    schema: 'inventory/v2',
    sections: [{ id: 'sec-1', number: 1, pageBox: { x: 0, y: 0, w: 3840, h: 2143 } }],
    nodes: [
      { id: 'sec-1', status: 'determined', role: 'sec', name: 'sec/1', pageBox: { x: 0, y: 0, w: 3840, h: 2143 } },
      {
        id: '721:7868',
        status: 'unknown',
        name: 'kv',
        parentId: 'sec-1',
        ancestorIds: ['sec-1'],
        pageBox: { x: 0, y: 0, w: 3840, h: 2143 },
        sliceExport: { bounds: 'render', scale: 1, format: 'png', file: '721-7868.png', box: { x: 0, y: 0, w: 3840, h: 2143 } },
      },
    ],
  };
  assert.equal(firstKvMeasureId(inventory), '721:7868');
  const empty = evaluateProductScrollGate({
    inventory,
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1', height: '0px' },
      overlayDeltas: {},
      scrolled: 1,
      scrollTop: 1,
      layers: { 'sec-1': { cropWindow: 'first-section-pagebox', height: 2143, overflow: 'hidden' } },
      backgrounds: {},
      firstKv: { imgSrc: 'assets/721-7868.webp', assetW: 3840, assetH: 167, assetEmpty: true },
      samples: [],
    
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
    },
  });
  assert.equal(empty.ok, false);
  assert.ok(empty.problems.some((line) => line.includes('first-kv-png-empty')), (empty.problems || []).join('\n'));
  assert.ok(empty.problems.some((line) => line.includes('first-kv-png-size-mismatch')), (empty.problems || []).join('\n'));
});

test('listed img/ time-bg with shorter ink box expects pageBox, not sliceExport.box', () => {
  const pageBox = { x: 0, y: 1543, w: 3840, h: 260 };
  const inkBox = { x: 0, y: 1539.925, w: 3840, h: 167.075 };
  const green = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      nodes: [
        {
          id: '721:8193',
          status: 'determined',
          role: 'img',
          name: 'img/时间背景',
          pageBox,
          sliceExport: { box: inkBox, scale: 1, format: 'png', file: '721-8193.png', bounds: 'render' },
        },
      ],
    },
    measurements: {
      nodes: {
        '721:8193': { x: 0, y: 1543, w: 3840, h: 260, hasImg: true, imgBox: pageBox, fontSize: 16, fontFamily: 'Source Han Sans', fontWeight: 400 },
      },
    },
  });
  assert.equal(green.ok, true, (green.problems || []).join('\n'));

  const redInk = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      nodes: [
        {
          id: '721:8193',
          status: 'determined',
          role: 'img',
          name: 'img/时间背景',
          pageBox,
          sliceExport: { box: inkBox, scale: 1, format: 'png', file: '721-8193.png', bounds: 'render' },
        },
      ],
    },
    measurements: {
      nodes: {
        '721:8193': { x: 0, y: 1543, w: 3840, h: 260, hasImg: true, imgBox: inkBox, fontSize: 16, fontFamily: 'Source Han Sans', fontWeight: 400 },
      },
    },
  });
  assert.equal(redInk.ok, false);
  assert.ok(redInk.problems.some((line) => line.includes('sliceExport-mismatch')), (redInk.problems || []).join('\n'));
});

test('whole-frame PNG empty or wrong size is red when probe reports asset meta', () => {
  const pageBox = { x: 0, y: 1543, w: 3840, h: 260 };
  const empty = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      nodes: [
        {
          id: '721:8193',
          status: 'determined',
          role: 'img',
          name: 'img/时间背景',
          pageBox,
          sliceExport: { box: pageBox, scale: 1, format: 'png', file: '721-8193.png', bounds: 'render' },
        },
      ],
    },
    measurements: {
      nodes: {
        '721:8193': {
          x: 0, y: 1543, w: 3840, h: 260, hasImg: true, imgBox: pageBox,
          fontSize: 16, fontFamily: 'Source Han Sans', fontWeight: 400,
          assetW: 3840, assetH: 167, assetEmpty: true,
        },
      },
    },
  });
  assert.equal(empty.ok, false);
  assert.ok(empty.problems.some((line) => line.includes('whole-frame-png-empty')), (empty.problems || []).join('\n'));
  assert.ok(empty.problems.some((line) => line.includes('whole-frame-png-size-mismatch')), (empty.problems || []).join('\n'));
});

test('ordinary whole-frame img/ empty or wrong-size PNG is red even when DOM matches pageBox', () => {
  const pageBox = { x: 0, y: 0, w: 100, h: 100 };
  const node = {
    id: 'img-title',
    status: 'determined',
    role: 'img',
    name: 'img/标题',
    pageBox,
    sliceExport: { box: pageBox, scale: 1, format: 'png', file: 'img-title.png', bounds: 'render' },
  };
  const matchingDom = {
    x: 0, y: 0, w: 100, h: 100, hasImg: true, imgBox: pageBox,
    fontSize: 16, fontFamily: 'Source Han Sans', fontWeight: 400,
  };
  const empty = evaluateInventoryStaticGate({
    inventory: { schema: 'inventory/v2', nodes: [node] },
    measurements: { nodes: { 'img-title': { ...matchingDom, assetEmpty: true, assetW: 0, assetH: 0 } } },
  });
  assert.equal(empty.ok, false);
  assert.ok(empty.problems.some((line) => line.includes('whole-frame-png-empty')), (empty.problems || []).join('\n'));

  const wrongSize = evaluateInventoryStaticGate({
    inventory: { schema: 'inventory/v2', nodes: [node] },
    measurements: { nodes: { 'img-title': { ...matchingDom, assetEmpty: false, assetW: 50, assetH: 50 } } },
  });
  assert.equal(wrongSize.ok, true, (wrongSize.problems || []).join('\n'));
  assert.ok(!(wrongSize.problems || []).some((line) => line.includes('whole-frame-png-size-mismatch')));
});

test('listed sliceExport child is missing-dom even if unprefixed parent is baked', () => {
  const red = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      nodes: [
        {
          id: 'slg',
          status: 'unknown',
          name: 'slg',
          pageBox: { x: 0, y: 667, w: 3840, h: 1040 },
        },
        {
          id: 'title',
          status: 'determined',
          role: 'img',
          name: 'img/标题slg',
          parentId: 'slg',
          ancestorIds: ['slg'],
          pageBox: { x: 0, y: 1103, w: 3840, h: 633 },
          sliceExport: { box: { x: 0, y: 1103, w: 3840, h: 604 }, scale: 1, format: 'png', file: 'title.png' },
        },
      ],
    },
    measurements: {
      nodes: {
        slg: { x: 0, y: 667, w: 3840, h: 1040, bakedDescendants: true, hasImg: false },
      },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('title: missing-dom')), (red.problems || []).join('\n'));
});

test('unprefixed parent bake cannot swallow a copy-only child unless owner has sliceExport', () => {
  const red = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      nodes: [
        {
          id: 'kv',
          status: 'unknown',
          name: 'kv',
          pageBox: { x: 0, y: 0, w: 3840, h: 2143 },
          sliceExport: { bounds: 'render', scale: 1, format: 'png', file: 'kv.png', box: { x: 0, y: 0, w: 3840, h: 2143 } },
        },
        {
          id: 'copy',
          status: 'determined',
          role: 'copy',
          parentId: 'kv',
          ancestorIds: ['kv'],
          pageBox: { x: 12, y: 22, w: 40, h: 16 },
          text: { fontFamily: 'Source Han Sans', fontWeight: 400, fontSize: 16 },
        },
      ],
    },
    measurements: {
      nodes: {
        kv: { x: 0, y: 0, w: 3840, h: 2143, hasImg: true, imgBox: { x: 0, y: 0, w: 3840, h: 2143 }, bakedDescendants: true },
      },
      productScroll: {
        overlay: { position: 'sticky', transform: 'none', zoom: '1', height: '0px' },
        overlayDeltas: {},
        scrolled: 1,
        scrollTop: 1,
        layers: {},
        backgrounds: {},
        firstKv: { imgSrc: 'assets/kv.webp', assetW: 3840, assetH: 2143, assetEmpty: false },
        samples: [],
      
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
    },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('copy: missing-dom')), (red.problems || []).join('\n'));
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
        'n-slice': { x: 10, y: 20, w: 200, h: 40, hasImg: true, imgBox: PAGE_BOX },
      },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('missing-sliceExport-box')));
});

test('IMAGE fill without a real img is missing-dom-img, even if the empty box matches pageBox', () => {
  const red = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      nodes: [
        {
          id: 'kv-fill',
          status: 'unknown',
          name: '赛季kv-0610 1',
          pageBox: { x: 0, y: 0, w: 3840, h: 2152 },
          style: { fills: [{ type: 'IMAGE', visible: true }] },
        },
      ],
    },
    measurements: {
      nodes: {
        'kv-fill': { x: 0, y: 0, w: 3840, h: 2152, hasImg: false, imgBox: null },
      },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('kv-fill: missing-dom-img')), (red.problems || []).join('\n'));
});

test('copy comparison treats U+2028 as a newline, not a mismatch', () => {
  const green = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      nodes: [
        {
          id: 'copy',
          status: 'determined',
          role: 'copy',
          pageBox: PAGE_BOX,
          text: { characters: '第一行\u2028第二行', fontFamily: 'Source Han Sans', fontWeight: 400, fontSize: 16 },
        },
      ],
    },
    measurements: {
      nodes: {
        copy: {
          x: 10, y: 20, w: 200, h: 40, fontSize: 16,
          fontFamily: 'Source Han Sans', fontWeight: 400,
          text: '第一行\n第二行',
        },
      },
    },
  });
  assert.equal(green.ok, true, (green.problems || []).join('\n'));
});

test('copy text must appear in the measured DOM', () => {
  const red = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      nodes: [
        {
          id: 'copy',
          status: 'determined',
          role: 'copy',
          pageBox: PAGE_BOX,
          text: { characters: '官方充值', fontFamily: 'Source Han Sans', fontWeight: 400, fontSize: 16 },
        },
      ],
    },
    measurements: {
      nodes: {
        copy: { x: 10, y: 20, w: 200, h: 40, fontSize: 16, text: '' },
      },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('copy: copy-mismatch')), (red.problems || []).join('\n'));
});

test('probe omitting fontWeight is red, never skipped-ok', () => {
  const red = evaluateInventoryStaticGate({
    inventory: inventory(),
    measurements: {
      nodes: {
        n1: { x: 10, y: 20, w: 200, h: 40, fontSize: 16, fontFamily: 'Source Han Sans', hasImg: true, imgBox: PAGE_BOX },
      },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('n1: missing-dom-fontWeight')), (red.problems || []).join('\n'));
});

test('dropped untagged fix clones absent from DOM stay green', () => {
  const green = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      overlays: [
        { id: 'fix-1', role: 'fix', label: '顶部信息', pin: 'viewport' },
        { id: 'fix-2', role: 'fix', label: '顶部信息', pin: 'viewport' },
      ],
      nodes: [
        { id: 'fix-1', status: 'determined', role: 'fix', pin: 'viewport', pageBox: { x: 0, y: 0, w: 3793, h: 493 } },
        { id: 'fix-2', status: 'determined', role: 'fix', pin: 'viewport', pageBox: { x: 0, y: 2143, w: 3793, h: 493 } },
        {
          id: 'fix-1-btn',
          status: 'determined',
          role: 'btn',
          ancestorIds: ['fix-1'],
          pageBox: { x: 2764, y: 70, w: 516, h: 150 },
        },
        {
          id: 'fix-2-btn',
          status: 'determined',
          role: 'btn',
          ancestorIds: ['fix-2'],
          pageBox: { x: 2764, y: 2213, w: 516, h: 150 },
        },
      ],
    },
    measurements: {
      nodes: {
        'fix-1': { x: 0, y: 0, w: 3793, h: 493, inSection: false },
        'fix-1-btn': { x: 2764, y: 70, w: 516, h: 150, inSection: false },
      },
      productScroll: stickyProductScroll(['fix-1', 'fix-1-btn']),
    },
  });
  assert.equal(green.ok, true, (green.problems || []).join('\n'));
});

test('untagged duplicate fix clones still in DOM are red', () => {
  const red = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      overlays: [
        { id: 'fix-1', role: 'fix', label: '顶部信息', pin: 'viewport' },
        { id: 'fix-2', role: 'fix', label: '顶部信息', pin: 'viewport' },
      ],
      nodes: [
        { id: 'fix-1', status: 'determined', role: 'fix', pin: 'viewport', pageBox: { x: 0, y: 0, w: 3793, h: 493 } },
        { id: 'fix-2', status: 'determined', role: 'fix', pin: 'viewport', pageBox: { x: 0, y: 2143, w: 3793, h: 493 } },
        {
          id: 'fix-2-btn',
          status: 'determined',
          role: 'btn',
          ancestorIds: ['fix-2'],
          pageBox: { x: 2764, y: 2213, w: 516, h: 150 },
        },
      ],
    },
    measurements: {
      nodes: {
        'fix-1': { x: 0, y: 0, w: 3793, h: 493, inSection: false },
        'fix-2': { x: 0, y: 2143, w: 3793, h: 493, inSection: true },
        'fix-2-btn': { x: 2764, y: 2213, w: 516, h: 150, inSection: true },
      },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('fix-2: untagged-fix-clone-in-dom')), (red.problems || []).join('\n'));
  assert.ok(red.problems.some((line) => line.includes('fix-2-btn: untagged-fix-clone-in-dom')), (red.problems || []).join('\n'));
});

test('PNG meta alone does not count as untagged-fix-clone-in-dom', () => {
  const green = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      overlays: [
        { id: 'fix-1', role: 'fix', label: '顶部信息', pin: 'viewport' },
        { id: 'fix-2', role: 'fix', label: '顶部信息', pin: 'viewport' },
      ],
      nodes: [
        { id: 'fix-1', status: 'determined', role: 'fix', pin: 'viewport', pageBox: { x: 0, y: 0, w: 3793, h: 493 } },
        { id: 'fix-2', status: 'determined', role: 'fix', pin: 'viewport', pageBox: { x: 0, y: 2143, w: 3793, h: 493 } },
        {
          id: 'fix-2-logo',
          status: 'determined',
          role: 'img',
          name: 'img/logo',
          ancestorIds: ['fix-2'],
          pageBox: { x: 0, y: 2143, w: 1020, h: 360 },
        },
      ],
    },
    measurements: {
      nodes: {
        'fix-1': { x: 0, y: 0, w: 3793, h: 493, inSection: false },
        'fix-2-logo': { assetEmpty: false, assetW: 1020, assetH: 360 },
      },
      productScroll: stickyProductScroll(['fix-1']),
    },
  });
  assert.equal(green.ok, true, (green.problems || []).join('\n'));
});

test('shared INSTANCE ids under a dropped overlay clone are not untagged-fix-clone-in-dom', () => {
  const green = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      overlays: [
        { id: 'fix-1', role: 'fix', label: '顶部信息', pin: 'viewport' },
        { id: 'fix-2', role: 'fix', label: '顶部信息', pin: 'viewport' },
      ],
      nodes: [
        { id: 'fix-1', status: 'determined', role: 'fix', pin: 'viewport', pageBox: { x: 0, y: 0, w: 3793, h: 493 } },
        { id: 'fix-2', status: 'determined', role: 'fix', pin: 'viewport', pageBox: { x: 0, y: 2143, w: 3793, h: 493 } },
        {
          id: 'I758:1693;758:1675',
          status: 'determined',
          role: 'img',
          name: 'img/按钮背景',
          ancestorIds: ['fix-2', 'fix-1'],
          pageBox: { x: 2764, y: 70, w: 402, h: 84 },
          sliceExport: { box: { x: 2764, y: 70, w: 402, h: 84 }, file: 'btn.png' },
        },
      ],
    },
    measurements: {
      nodes: {
        'fix-1': { x: 0, y: 0, w: 3793, h: 493, inSection: false },
        'I758:1693;758:1675': {
          x: 2764, y: 70, w: 402, h: 84, inSection: false,
          hasImg: true, imgBox: { x: 2764, y: 70, w: 402, h: 84 },
          assetEmpty: false, assetW: 468, assetH: 150,
        },
      },
      productScroll: stickyProductScroll(['fix-1']),
    },
  });
  assert.equal(green.ok, true, (green.problems || []).join('\n'));
  assert.ok(!(green.problems || []).some((line) => line.includes('untagged-fix-clone-in-dom')));
});

test('full-bleed bg PNG size mismatch is red', () => {
  const pageBox = { x: 0, y: 0, w: 3840, h: 2160 };
  const red = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      nodes: [{
        id: 'bg-1',
        status: 'determined',
        role: 'bg',
        name: 'bg/首屏',
        pageBox,
        sliceExport: { box: pageBox, scale: 1, format: 'png', file: 'bg.png', bounds: 'render' },
      }],
    },
    measurements: {
      nodes: {
        'bg-1': {
          x: 0, y: 0, w: 3840, h: 2160, hasImg: true, imgBox: pageBox,
          assetEmpty: false, assetW: 1920, assetH: 1080,
        },
      },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('whole-frame-png-size-mismatch')), (red.problems || []).join('\n'));
});

test('soft-spill img/ PNG larger than pageBox is not whole-frame-png-size-mismatch', () => {
  const pageBox = { x: 1858, y: 852, w: 124, h: 124 };
  const green = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      nodes: [{
        id: 'btn-bg',
        status: 'determined',
        role: 'img',
        name: 'img/按钮背景',
        type: 'RECTANGLE',
        pageBox,
        sliceExport: { box: pageBox, scale: 1, format: 'png', file: 'btn.png', bounds: 'render' },
      }],
    },
    measurements: {
      nodes: {
        'btn-bg': {
          x: 1858, y: 852, w: 124, h: 124, hasImg: true, imgBox: pageBox,
          assetEmpty: false, assetW: 188, assetH: 188,
        },
      },
    },
  });
  assert.equal(green.ok, true, (green.problems || []).join('\n'));
});

test('kept fix descendants measured inside a section are red', () => {
  const red = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      overlays: [{ id: 'fix-1', role: 'fix', label: '顶部信息', pin: 'viewport' }],
      nodes: [
        { id: 'fix-1', status: 'determined', role: 'fix', pin: 'viewport', pageBox: { x: 0, y: 0, w: 3793, h: 493 } },
        {
          id: 'fix-btn',
          status: 'determined',
          role: 'btn',
          ancestorIds: ['fix-1'],
          pageBox: { x: 2764, y: 70, w: 516, h: 150 },
        },
      ],
    },
    measurements: {
      nodes: {
        'fix-1': { x: 0, y: 0, w: 3793, h: 493, inSection: false },
        'fix-btn': { x: 2764, y: 70, w: 516, h: 150, inSection: true },
      },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('fix-btn: fix-in-section')), (red.problems || []).join('\n'));
});

test('fix nested sliceExport is compared in overlay space, not page y', () => {
  const pageBox = { x: 2821, y: 2247, w: 402, h: 84 };
  const overlayBox = { x: 2821, y: 104, w: 402, h: 84 };
  const green = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      overlays: [{ id: 'fix-2', role: 'fix', label: '顶部信息', pin: 'viewport' }],
      nodes: [
        { id: 'fix-2', status: 'determined', role: 'fix', pin: 'viewport', pageBox: { x: 0, y: 2143, w: 3793, h: 493 } },
        {
          id: 'fix-img',
          status: 'determined',
          role: 'img',
          ancestorIds: ['fix-2'],
          pageBox,
          sliceExport: { box: pageBox, scale: 1, format: 'png', file: 'fix-img.png', bounds: 'render' },
        },
      ],
    },
    measurements: {
      nodes: {
        'fix-2': { x: 0, y: 0, w: 3793, h: 493, inSection: false },
        'fix-img': {
          x: 2821, y: 104, w: 402, h: 84,
          hasImg: true,
          imgBox: overlayBox,
          inSection: false,
        },
      },
      productScroll: stickyProductScroll(['fix-2', 'fix-img']),
    },
  });
  assert.equal(green.ok, true, (green.problems || []).join('\n'));

  const red = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      overlays: [{ id: 'fix-2', role: 'fix', label: '顶部信息', pin: 'viewport' }],
      nodes: [
        { id: 'fix-2', status: 'determined', role: 'fix', pin: 'viewport', pageBox: { x: 0, y: 2143, w: 3793, h: 493 } },
        {
          id: 'fix-img',
          status: 'determined',
          role: 'img',
          ancestorIds: ['fix-2'],
          pageBox: { x: 2821, y: 2247, w: 402, h: 84 },
          sliceExport: { box: pageBox, scale: 1, format: 'png', file: 'fix-img.png', bounds: 'render' },
        },
      ],
    },
    measurements: {
      nodes: {
        'fix-2': { x: 0, y: 0, w: 3793, h: 493, inSection: false },
        'fix-img': {
          x: 2821, y: 104, w: 402, h: 84,
          hasImg: true,
          imgBox: pageBox,
          inSection: false,
        },
      },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('fix-img: sliceExport-mismatch')), (red.problems || []).join('\n'));
});

test('from-tagged delayed overlay is not required in current overlayDeltas', () => {
  const inventory = {
    schema: 'inventory/v2',
    sections: [
      { id: 'sec-1', number: 1, pageBox: { x: 0, y: 0, w: 750, h: 1334 } },
      { id: 'sec-2', number: 2, pageBox: { x: 0, y: 1334, w: 750, h: 1334 } },
    ],
    overlays: [{ id: 'fix-later', role: 'fix', pin: 'viewport', from: 2, label: '后段钉' }],
    nodes: [
      { id: 'sec-1', status: 'determined', role: 'sec', name: 'sec/1', pageBox: { x: 0, y: 0, w: 750, h: 1334 } },
      { id: 'sec-2', status: 'determined', role: 'sec', name: 'sec/2', pageBox: { x: 0, y: 1334, w: 750, h: 1334 } },
      { id: 'fix-later', status: 'determined', role: 'fix', pin: 'viewport', from: 2, pageBox: { x: 0, y: 0, w: 750, h: 80 } },
    ],
  };
  const green = evaluateProductScrollGate({
    inventory,
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1' },
      overlayDeltas: {},
      scrolled: 1,
      scrollTop: 720,
      layers: {
        'sec-1': { cropWindow: 'first-section-pagebox', height: 1334, overflow: 'hidden' },
      },
    
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
    },
  });
  assert.equal(green.ok, true, (green.problems || []).join('\n'));
  assert.equal((green.problems || []).some((line) => line.includes('overlay-scroll-deltas-empty')), false);
});

test('pin=viewport page without productScroll is red, never skipped-ok', () => {
  const red = evaluateInventoryStaticGate({
    inventory: {
      schema: 'inventory/v2',
      overlays: [{ id: 'fix-1', role: 'fix', label: '顶部信息', pin: 'viewport' }],
      nodes: [
        { id: 'fix-1', status: 'determined', role: 'fix', pin: 'viewport', pageBox: { x: 0, y: 0, w: 3793, h: 493 } },
      ],
    },
    measurements: {
      nodes: {
        'fix-1': { x: 0, y: 0, w: 3793, h: 493, inSection: false },
      },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('product-scroll-missing')), (red.problems || []).join('\n'));
});

test('QA chrome squashing landscape top bar to 100vh is red', () => {
  const inventory = {
    schema: 'inventory/v2',
    sections: [{ id: 'sec-1', number: 1, pageBox: { x: 0, y: 0, w: 750, h: 1334 } }],
    overlays: [{ id: 'fix-1', role: 'fix', pin: 'viewport', label: '顶部固定内容' }],
    nodes: [
      { id: 'sec-1', status: 'determined', role: 'sec', name: 'sec/1', pageBox: { x: 0, y: 0, w: 750, h: 1334 } },
      { id: 'fix-1', status: 'determined', role: 'fix', pin: 'viewport', name: 'fix/顶部固定内容', pageBox: { x: 0, y: 0, w: 736, h: 401 } },
    ],
  };
  const red = evaluateProductScrollGate({
    inventory,
    viewportKind: 'product',
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1', height: '0px' },
      overlayDeltas: { 'fix-1': { dTop: 0, dLeft: 0 } },
      scrolled: 1,
      scrollTop: 400,
      layers: { 'sec-1': { cropWindow: 'first-section-pagebox', height: 1334, overflow: 'visible' } },
      backgrounds: {},
      samples: [],
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
      chromeTopBar: {
        id: 'fix-1',
        navShell: true,
        kind: 'root',
        yScale: 0.6327,
        height: 253.7,
        sourceHeight: 401,
      },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('topbar-chrome-squashed')), (red.problems || []).join('\n'));
  assert.ok(red.problems.some((line) => line.includes('topbar-chrome-treated-as-directory')), (red.problems || []).join('\n'));

  const missing = evaluateProductScrollGate({
    inventory,
    viewportKind: 'product',
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1', height: '0px' },
      overlayDeltas: { 'fix-1': { dTop: 0, dLeft: 0 } },
      scrolled: 1,
      scrollTop: 400,
      layers: { 'sec-1': { cropWindow: 'first-section-pagebox', height: 1334, overflow: 'visible' } },
      backgrounds: {},
      samples: [],
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
    },
  });
  assert.equal(missing.ok, false);
  assert.ok(missing.problems.some((line) => line.includes('topbar-chrome-unmeasured')), (missing.problems || []).join('\n'));

  const productStub = evaluateProductScrollGate({
    inventory,
    viewportKind: 'product',
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1', height: '0px' },
      overlayDeltas: { 'fix-1': { dTop: 0, dLeft: 0 } },
      scrolled: 1,
      scrollTop: 400,
      layers: { 'sec-1': { cropWindow: 'first-section-pagebox', height: 1334, overflow: 'visible' } },
      backgrounds: {},
      samples: [],
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
      chromeTopBar: {
        id: 'fix-1',
        navShell: false,
        topbar: true,
        height: 401,
        sourceHeight: 401,
      },
    },
  });
  assert.equal(productStub.ok, false);
  assert.ok(productStub.problems.some((line) => line.includes('topbar-chrome-unmeasured')), (productStub.problems || []).join('\n'));

  const greenBar = evaluateProductScrollGate({
    inventory,
    viewportKind: 'product',
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1', height: '0px' },
      overlayDeltas: { 'fix-1': { dTop: 0, dLeft: 0 } },
      scrolled: 1,
      scrollTop: 400,
      layers: { 'sec-1': { cropWindow: 'first-section-pagebox', height: 1334, overflow: 'visible' } },
      backgrounds: {},
      samples: [],
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
      chromeTopBar: {
        id: 'fix-1',
        navShell: false,
        topbar: true,
        kind: null,
        yScale: NaN,
        height: 401,
        sourceHeight: 401,
        nodes: {
          'fix-1': { x: 0, y: 0, w: 736, h: 401 },
        },
      },
    },
  });
  assert.equal(greenBar.ok, true, (greenBar.problems || []).join('\n'));

  const probeFailed = evaluateProductScrollGate({
    inventory,
    viewportKind: 'product',
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1', height: '0px' },
      overlayDeltas: { 'fix-1': { dTop: 0, dLeft: 0 } },
      scrolled: 1,
      scrollTop: 400,
      layers: { 'sec-1': { cropWindow: 'first-section-pagebox', height: 1334, overflow: 'visible' } },
      backgrounds: {},
      samples: [],
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
      chromeTopBar: { probeFailed: true, error: 'QA chrome page did not load' },
    },
  });
  assert.equal(probeFailed.ok, false);
  assert.ok(probeFailed.problems.some((line) => line.includes('topbar-chrome-probe-failed')), (probeFailed.problems || []).join('\n'));
});

test('QA chrome top-bar button move, missing slice, and copy change are red', () => {
  const inventory = {
    schema: 'inventory/v2',
    sections: [{ id: 'sec-1', number: 1, pageBox: { x: 0, y: 0, w: 750, h: 1334 } }],
    overlays: [{ id: 'fix-1', role: 'fix', pin: 'viewport', label: '顶部固定内容' }],
    nodes: [
      { id: 'sec-1', status: 'determined', role: 'sec', name: 'sec/1', pageBox: { x: 0, y: 0, w: 750, h: 1334 } },
      { id: 'fix-1', status: 'determined', role: 'fix', pin: 'viewport', name: 'fix/顶部固定内容', pageBox: { x: 0, y: 0, w: 736, h: 401 } },
      { id: 'fix-btn', status: 'determined', role: 'btn', name: 'btn/按钮', ancestorIds: ['fix-1'], parentId: 'fix-1', pageBox: { x: 370, y: 27, w: 310, h: 90 } },
      { id: 'fix-copy', status: 'determined', role: 'copy', name: '官方充值', ancestorIds: ['fix-1', 'fix-btn'], parentId: 'fix-btn', pageBox: { x: 406, y: 59, w: 238, h: 27 }, text: { characters: '官方充值', fontSize: 24 } },
      { id: 'fix-home', status: 'determined', role: 'img', name: 'img/按钮', ancestorIds: ['fix-1'], parentId: 'fix-1', pageBox: { x: 651, y: 98, w: 85, h: 85 }, sliceExport: { box: { x: 651, y: 98, w: 85, h: 85 }, file: 'home.png' } },
    ],
  };
  const contract = chromeTopBarContract(inventory);
  assert.deepEqual(contract.rootIds, ['fix-1']);
  assert.ok(contract.nodeIds.includes('fix-btn'));
  assert.ok(contract.nodeIds.includes('fix-copy'));
  assert.ok(contract.nodeIds.includes('fix-home'));

  const red = evaluateProductScrollGate({
    inventory,
    viewportKind: 'product',
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1', height: '0px' },
      overlayDeltas: { 'fix-1': { dTop: 0, dLeft: 0 } },
      scrolled: 1,
      scrollTop: 400,
      layers: { 'sec-1': { cropWindow: 'first-section-pagebox', height: 1334, overflow: 'visible' } },
      backgrounds: {},
      samples: [],
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
      chromeTopBar: {
        id: 'fix-1',
        navShell: false,
        topbar: true,
        height: 401,
        sourceHeight: 401,
        nodes: {
          'fix-1': { x: 0, y: 0, w: 736, h: 401 },
          'fix-btn': { x: 480, y: 8, w: 310, h: 57 },
          'fix-copy': { x: 406, y: 59, w: 238, h: 8, text: '充' },
          'fix-home': {
            x: 651, y: 98, w: 85, h: 85, hasImg: true, assetEmpty: false, assetW: 40, assetH: 40,
            assetInkHash: 'aaa', assetInkEmpty: false,
            assetSamples: [{ rgba: [10, 10, 10, 255] }],
            screenSamples: [{ rgba: [10, 10, 10, 255] }],
          },
        },
      },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('topbar-chrome-pageBox-mismatch')), (red.problems || []).join('\n'));
  assert.ok(red.problems.some((line) => line.includes('topbar-chrome-copy-mismatch')), (red.problems || []).join('\n'));
  assert.ok(red.problems.some((line) => line.includes('topbar-chrome-png-size-mismatch')), (red.problems || []).join('\n'));

  const green = evaluateProductScrollGate({
    inventory,
    viewportKind: 'product',
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1', height: '0px' },
      overlayDeltas: { 'fix-1': { dTop: 0, dLeft: 0 } },
      scrolled: 1,
      scrollTop: 400,
      layers: { 'sec-1': { cropWindow: 'first-section-pagebox', height: 1334, overflow: 'visible' } },
      backgrounds: {},
      samples: [],
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
      chromeTopBar: {
        id: 'fix-1',
        navShell: false,
        topbar: true,
        height: 401,
        sourceHeight: 401,
        nodes: {
          'fix-1': { x: 0, y: 0, w: 736, h: 401 },
          'fix-btn': { x: 370, y: 27, w: 310, h: 90 },
          'fix-copy': { x: 406, y: 59, w: 238, h: 27, text: '官方充值' },
          'fix-home': {
            x: 651, y: 98, w: 85, h: 85, hasImg: true, assetEmpty: false, assetInkHash: 'aaa', assetInkEmpty: false,
            assetSamples: [{ rgba: [10, 10, 10, 255] }],
            screenSamples: [{ rgba: [10, 10, 10, 255] }],
          },
        },
      },
    },
  });
  assert.equal(green.ok, true, (green.problems || []).join('\n'));
});

test('QA chrome stack, clip, color, weight, and portrait fix are red when they drift', () => {
  const inventory = {
    schema: 'inventory/v2',
    sections: [{ id: 'sec-1', number: 1, pageBox: { x: 0, y: 0, w: 750, h: 1334 } }],
    overlays: [
      { id: 'fix-1', role: 'fix', pin: 'viewport', label: '顶部固定内容' },
      { id: 'fix-side', role: 'fix', pin: 'viewport', label: '左侧目录' },
    ],
    nodes: [
      { id: 'sec-1', status: 'determined', role: 'sec', name: 'sec/1', pageBox: { x: 0, y: 0, w: 750, h: 1334 } },
      { id: 'fix-1', status: 'determined', role: 'fix', pin: 'viewport', name: 'fix/顶部固定内容', pageBox: { x: 0, y: 0, w: 736, h: 401 } },
      {
        id: 'fix-btn',
        status: 'determined',
        role: 'btn',
        name: 'btn/按钮',
        ancestorIds: ['fix-1'],
        parentId: 'fix-1',
        orderKey: '0.0.6.1',
        clipsContent: true,
        pageBox: { x: 370, y: 27, w: 310, h: 90 },
      },
      {
        id: 'fix-copy',
        status: 'determined',
        role: 'copy',
        name: '官方充值',
        ancestorIds: ['fix-1', 'fix-btn'],
        parentId: 'fix-btn',
        orderKey: '0.0.6.1.1',
        pageBox: { x: 406, y: 59, w: 238, h: 27 },
        text: {
          characters: '官方充值',
          fontSize: 24,
          fontWeight: 600,
          color: { type: 'GRADIENT_LINEAR' },
        },
      },
      {
        id: 'fix-home',
        status: 'determined',
        role: 'img',
        name: 'img/按钮',
        ancestorIds: ['fix-1'],
        parentId: 'fix-1',
        orderKey: '0.0.6.4',
        pageBox: { x: 651, y: 98, w: 85, h: 85 },
        sliceExport: { box: { x: 651, y: 98, w: 85, h: 85 }, file: 'home.png' },
      },
      {
        id: 'fix-side',
        status: 'determined',
        role: 'fix',
        pin: 'viewport',
        name: 'fix/左侧目录',
        pageBox: { x: 0, y: 0, w: 80, h: 400 },
      },
      {
        id: 'fix-side-btn',
        status: 'determined',
        role: 'btn',
        name: 'btn/目录',
        ancestorIds: ['fix-side'],
        parentId: 'fix-side',
        pageBox: { x: 8, y: 20, w: 64, h: 40 },
      },
    ],
  };
  const red = evaluateProductScrollGate({
    inventory,
    viewportKind: 'product',
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1', height: '0px' },
      overlayDeltas: { 'fix-1': { dTop: 0, dLeft: 0 }, 'fix-side': { dTop: 0, dLeft: 0 } },
      scrolled: 1,
      scrollTop: 400,
      layers: { 'sec-1': { cropWindow: 'first-section-pagebox', height: 1334, overflow: 'visible' } },
      backgrounds: {},
      samples: [],
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
      chromeTopBar: {
        id: 'fix-1',
        navShell: false,
        topbar: true,
        height: 401,
        sourceHeight: 401,
        nodes: {
          'fix-1': { x: 0, y: 0, w: 736, h: 401, overflow: 'visible', stackIndex: 0 },
          'fix-btn': { x: 370, y: 27, w: 310, h: 90, overflow: 'visible', clips: false, stackIndex: 2 },
          'fix-copy': {
            x: 406, y: 59, w: 238, h: 27, text: '官方充值',
            fontWeight: 400, color: 'rgb(0, 0, 0)', gradient: false, overflow: 'visible', stackIndex: 0,
          },
          'fix-home': {
            x: 651, y: 98, w: 85, h: 85, hasImg: true, assetEmpty: false, assetW: 85, assetH: 85,
            overflow: 'visible', stackIndex: 1, assetInkHash: 'aaa', assetInkEmpty: false,
            assetSamples: [{ rgba: [10, 10, 10, 255] }],
            screenSamples: [{ rgba: [10, 10, 10, 255] }],
          },
          'fix-side': { x: 0, y: 0, w: 80, h: 400, overflow: 'visible', stackIndex: 0 },
          'fix-side-btn': { x: 40, y: 8, w: 64, h: 40, overflow: 'visible', stackIndex: 0 },
        },
      },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('topbar-chrome-clip-mismatch')), (red.problems || []).join('\n'));
  assert.ok(red.problems.some((line) => line.includes('topbar-chrome-fontWeight-mismatch')), (red.problems || []).join('\n'));
  assert.ok(red.problems.some((line) => line.includes('topbar-chrome-color-mismatch')), (red.problems || []).join('\n'));
  assert.ok(red.problems.some((line) => line.includes('topbar-chrome-stack-mismatch')), (red.problems || []).join('\n'));
  assert.ok(red.problems.some((line) => line.includes('fix-side-btn: topbar-chrome-pageBox-mismatch')), (red.problems || []).join('\n'));

  const green = evaluateProductScrollGate({
    inventory,
    viewportKind: 'product',
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1', height: '0px' },
      overlayDeltas: { 'fix-1': { dTop: 0, dLeft: 0 }, 'fix-side': { dTop: 0, dLeft: 0 } },
      scrolled: 1,
      scrollTop: 400,
      layers: { 'sec-1': { cropWindow: 'first-section-pagebox', height: 1334, overflow: 'visible' } },
      backgrounds: {},
      samples: [],
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
      chromeTopBar: {
        id: 'fix-1',
        navShell: false,
        topbar: true,
        height: 401,
        sourceHeight: 401,
        nodes: {
          'fix-1': { x: 0, y: 0, w: 736, h: 401, overflow: 'visible', stackIndex: 0 },
          'fix-btn': { x: 370, y: 27, w: 310, h: 90, overflow: 'hidden', clips: true, stackIndex: 1 },
          'fix-copy': {
            x: 406, y: 59, w: 238, h: 27, text: '官方充值',
            fontWeight: 600, gradient: true, backgroundClip: 'text', overflow: 'visible', stackIndex: 0,
          },
          'fix-home': {
            x: 651, y: 98, w: 85, h: 85, hasImg: true, assetEmpty: false, assetW: 85, assetH: 85,
            overflow: 'visible', stackIndex: 2, assetInkHash: 'aaa', assetInkEmpty: false,
            assetSamples: [{ rgba: [10, 10, 10, 255] }],
            screenSamples: [{ rgba: [10, 10, 10, 255] }],
          },
          'fix-side': { x: 0, y: 0, w: 80, h: 400, overflow: 'visible', stackIndex: 0 },
          'fix-side-btn': { x: 8, y: 20, w: 64, h: 40, overflow: 'visible', stackIndex: 0 },
        },
      },
    },
  });
  assert.equal(green.ok, true, (green.problems || []).join('\n'));
});

test('QA chrome PNG ink and non-copy gradient CSS fill are red when they drift', () => {
  const ink = [
    { x: 21, y: 21, rgba: [200, 180, 90, 255] },
    { x: 42, y: 42, rgba: [180, 160, 70, 255] },
    { x: 63, y: 63, rgba: [120, 90, 40, 255] },
  ];
  const inventory = {
    schema: 'inventory/v2',
    sections: [{ id: 'sec-1', number: 1, pageBox: { x: 0, y: 0, w: 750, h: 1334 } }],
    overlays: [{ id: 'fix-1', role: 'fix', pin: 'viewport', label: '顶部固定内容' }],
    nodes: [
      { id: 'sec-1', status: 'determined', role: 'sec', name: 'sec/1', pageBox: { x: 0, y: 0, w: 750, h: 1334 } },
      { id: 'fix-1', status: 'determined', role: 'fix', pin: 'viewport', name: 'fix/顶部固定内容', pageBox: { x: 0, y: 0, w: 736, h: 401 } },
      {
        id: 'fix-home',
        status: 'determined',
        role: 'img',
        name: 'img/按钮',
        ancestorIds: ['fix-1'],
        parentId: 'fix-1',
        pageBox: { x: 651, y: 98, w: 85, h: 85 },
        sliceExport: { box: { x: 651, y: 98, w: 85, h: 85 }, file: 'home.png' },
      },
      {
        id: 'fix-icon',
        status: 'determined',
        role: 'img',
        name: 'img/icon',
        ancestorIds: ['fix-1'],
        parentId: 'fix-1',
        pageBox: { x: 679, y: 59, w: 27, h: 27 },
        sliceExport: { box: { x: 679, y: 59, w: 27, h: 27 }, file: 'icon.png' },
        style: { fills: [{ type: 'GRADIENT_LINEAR', visible: true }] },
      },
    ],
  };
  const baseNodes = {
    'fix-1': { x: 0, y: 0, w: 736, h: 401 },
    'fix-home': {
      x: 651, y: 98, w: 85, h: 85, hasImg: true, assetEmpty: false, assetW: 85, assetH: 85,
      assetInkEmpty: false, assetInkHash: 'ink-a', assetSamples: ink, screenSamples: ink,
    },
    'fix-icon': {
      x: 679, y: 59, w: 27, h: 27, hasImg: true, assetEmpty: false, assetW: 27, assetH: 27,
      assetInkEmpty: false, assetInkHash: 'icon-a',
      assetSamples: [{ rgba: [177, 194, 203, 180] }],
      screenSamples: [{ rgba: [177, 194, 203, 180] }],
      gradient: false, backgroundClip: 'border-box', webkitTextFillColor: 'rgb(230, 234, 240)', color: 'rgb(230, 234, 240)',
    },
  };
  const productScrollOf = (nodes) => ({
    overlay: { position: 'sticky', transform: 'none', zoom: '1', height: '0px' },
    overlayDeltas: { 'fix-1': { dTop: 0, dLeft: 0 } },
    scrolled: 1,
    scrollTop: 400,
    layers: { 'sec-1': { cropWindow: 'first-section-pagebox', height: 1334, overflow: 'visible' } },
    backgrounds: {},
    samples: [],
    seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
    chromeTopBar: { id: 'fix-1', navShell: false, topbar: true, height: 401, sourceHeight: 401, nodes },
  });

  const unmeasured = evaluateProductScrollGate({
    inventory,
    viewportKind: 'product',
    productScroll: productScrollOf({
      ...baseNodes,
      'fix-home': { x: 651, y: 98, w: 85, h: 85, hasImg: true, assetEmpty: false, assetW: 85, assetH: 85 },
    }),
  });
  assert.equal(unmeasured.ok, false);
  assert.ok(unmeasured.problems.some((line) => line.includes('topbar-chrome-png-pixels-unmeasured')), (unmeasured.problems || []).join('\n'));

  const swapped = evaluateProductScrollGate({
    inventory,
    viewportKind: 'product',
    productScroll: productScrollOf({
      ...baseNodes,
      'fix-home': {
        ...baseNodes['fix-home'],
        assetSamples: ink,
        screenSamples: [{ x: 21, y: 21, rgba: [0, 0, 0, 255] }, { x: 42, y: 42, rgba: [0, 0, 0, 255] }, { x: 63, y: 63, rgba: [0, 0, 0, 255] }],
      },
    }),
  });
  assert.equal(swapped.ok, false);
  assert.ok(swapped.problems.some((line) => line.includes('topbar-chrome-png-pixels-mismatch')), (swapped.problems || []).join('\n'));

  const solidIcon = evaluateProductScrollGate({
    inventory,
    viewportKind: 'product',
    productScroll: productScrollOf({
      ...baseNodes,
      'fix-icon': {
        ...baseNodes['fix-icon'],
        hasImg: false,
        gradient: false,
        backgroundClip: 'border-box',
        webkitTextFillColor: 'rgb(230, 234, 240)',
        color: 'rgb(230, 234, 240)',
      },
    }),
  });
  assert.equal(solidIcon.ok, false);
  assert.ok(solidIcon.problems.some((line) => line.includes('topbar-chrome-color-mismatch')), (solidIcon.problems || []).join('\n'));

  const screenFailed = evaluateProductScrollGate({
    inventory,
    viewportKind: 'product',
    productScroll: productScrollOf({
      ...baseNodes,
      'fix-home': {
        ...baseNodes['fix-home'],
        screenSamples: [],
        screenSampleError: 'canvas tainted',
      },
    }),
  });
  assert.equal(screenFailed.ok, false);
  assert.ok(screenFailed.problems.some((line) => line.includes('topbar-chrome-png-pixels-unmeasured')), (screenFailed.problems || []).join('\n'));

  const fileOnly = evaluateProductScrollGate({
    inventory,
    viewportKind: 'product',
    productScroll: productScrollOf({
      ...baseNodes,
      'fix-home': {
        ...baseNodes['fix-home'],
        screenSamples: [],
      },
    }),
  });
  assert.equal(fileOnly.ok, false);
  assert.ok(fileOnly.problems.some((line) => line.includes('topbar-chrome-png-pixels-unmeasured')), (fileOnly.problems || []).join('\n'));

  const green = evaluateProductScrollGate({
    inventory,
    viewportKind: 'product',
    productScroll: productScrollOf(baseNodes),
  });
  assert.equal(green.ok, true, (green.problems || []).join('\n'));
});

test('product overlay stretched to viewport height is red', () => {
  const inventory = {
    schema: 'inventory/v2',
    sections: [{ id: 'sec-1', number: 1, pageBox: { x: 0, y: 0, w: 750, h: 1334 } }],
    overlays: [{ id: 'fix-1', role: 'fix', pin: 'viewport', label: '顶部固定内容' }],
    nodes: [
      { id: 'sec-1', status: 'determined', role: 'sec', name: 'sec/1', pageBox: { x: 0, y: 0, w: 750, h: 1334 } },
      { id: 'fix-1', status: 'determined', role: 'fix', pin: 'viewport', name: 'fix/顶部固定内容', pageBox: { x: 0, y: 0, w: 736, h: 401 } },
    ],
  };
  const red = evaluateProductScrollGate({
    inventory,
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1', height: '844px' },
      overlayDeltas: { 'fix-1': { dTop: 0, dLeft: 0 } },
      scrolled: 1,
      scrollTop: 400,
      layers: { 'sec-1': { cropWindow: 'first-section-pagebox', height: 1334, overflow: 'hidden' } },
      backgrounds: {},
      samples: [],
    
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('overlay-stretched-to-viewport')), (red.problems || []).join('\n'));
});

test('product overlay that stays position:fixed after scroll is red', () => {
  const red = evaluateProductScrollGate({
    inventory: {
      schema: 'inventory/v2',
      overlays: [{ id: 'fix-1', role: 'fix', label: '顶部信息', pin: 'viewport' }],
      nodes: [
        { id: 'fix-1', status: 'determined', role: 'fix', pin: 'viewport', pageBox: { x: 0, y: 0, w: 3793, h: 493 } },
        { id: 'fix-btn', status: 'determined', role: 'btn', ancestorIds: ['fix-1'], pageBox: { x: 2764, y: 70, w: 516, h: 150 } },
      ],
    },
    productScroll: {
      overlay: { position: 'fixed', transform: 'none', zoom: '1' },
      overlayDeltas: { 'fix-btn': { dTop: 40, dLeft: 0 } },
      scrolled: 1,
      scrollTop: 720,
    
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('overlay-not-sticky')), (red.problems || []).join('\n'));
  assert.ok(red.problems.some((line) => line.includes('overlay-scroll-drift')), (red.problems || []).join('\n'));
});

test('play button 188 filling 228 is red', () => {
  const red = evaluateProductScrollGate({
    inventory: {
      schema: 'inventory/v2',
      nodes: [
        { id: 'play', status: 'determined', role: 'btn', name: 'btn/播放按钮', pageBox: { x: 1806, y: 800, w: 228, h: 228 }, clipsContent: true },
        {
          id: 'play-bg',
          status: 'determined',
          role: 'img',
          name: 'img/按钮背景',
          parentId: 'play',
          pageBox: { x: 1858, y: 852, w: 124, h: 124 },
          sliceExport: { box: { x: 1826, y: 820, w: 188, h: 188 }, file: 'play-bg.png' },
        },
        { id: 'play-tri', status: 'skipped', name: 'Polygon 34', parentId: 'play', paintAsFragment: true },
      ],
    },
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1' },
      overlayDeltas: {},
      scrolled: 1,
      scrollTop: 1,
      play: {
        playHasDirectImg: false,
        ownerW: 124,
        ownerH: 124,
        ownerOverflow: 'hidden',
        imgW: 124,
        imgH: 124,
        imgLeft: 0,
        imgTop: 0,
        objectFit: 'fill',
        fragmentPresent: true,
        polygonVertex: 'up',
        clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)',
      },
    
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('play-slice-owner-clipped')), (red.problems || []).join('\n'));
  assert.ok(red.problems.some((line) => line.includes('play-slice-placement-mismatch')), (red.problems || []).join('\n'));
  assert.ok(red.problems.some((line) => line.includes('play-slice-object-fit-fill')), (red.problems || []).join('\n'));
  assert.ok(red.problems.some((line) => line.includes('play-triangle-not-right')), (red.problems || []).join('\n'));
});

test('play slice listed as pageBox but painted larger keeps object-fit none', () => {
  const green = evaluateProductScrollGate({
    inventory: {
      schema: 'inventory/v2',
      sections: [{ id: 'sec-1', number: 1, pageBox: { x: 0, y: 0, w: 3840, h: 2143 } }],
      nodes: [
        { id: 'play', status: 'determined', role: 'btn', name: 'btn/播放按钮', pageBox: { x: 1806, y: 800, w: 228, h: 228 } },
        {
          id: 'play-bg',
          status: 'determined',
          role: 'img',
          name: 'img/按钮背景',
          parentId: 'play',
          pageBox: { x: 1858, y: 852, w: 124, h: 124 },
          sliceExport: { box: { x: 1858, y: 852, w: 124, h: 124 }, file: 'play-bg.png' },
        },
      ],
    },
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1' },
      overlayDeltas: {},
      scrolled: 1,
      scrollTop: 1,
      layers: {
        'sec-1': { cropWindow: 'first-section-pagebox', height: 2143, overflow: 'hidden' },
      },
      play: {
        playHasDirectImg: false,
        ownerW: 124,
        ownerH: 124,
        ownerOverflow: 'hidden',
        imgW: 188,
        imgH: 188,
        imgLeft: -32,
        imgTop: -32,
        objectFit: 'none',
        fragmentPresent: true,
        polygonVertex: 'right',
      },
    
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
    },
  });
  assert.equal(green.ok, true, (green.problems || []).join('\n'));
});

test('later-section sample of the transparent bg/ plate is red when a KV child exists', () => {
  const inventory = {
    schema: 'inventory/v2',
    sections: [
      { id: 'sec-1', number: 1, pageBox: { x: 0, y: 0, w: 3840, h: 2143 } },
      { id: 'sec-2', number: 2, pageBox: { x: 0, y: 2143, w: 3840, h: 2143 } },
    ],
    nodes: [
      { id: 'sec-1', status: 'determined', role: 'sec', name: 'sec/1', pageBox: { x: 0, y: 0, w: 3840, h: 2143 } },
      { id: 'sec-2', status: 'determined', role: 'sec', name: 'sec/2', pageBox: { x: 0, y: 2143, w: 3840, h: 2143 } },
      {
        id: 'bg-2',
        status: 'determined',
        role: 'bg',
        name: 'bg/pc背景1',
        parentId: 'sec-2',
        ancestorIds: ['sec-2'],
        pageBox: { x: 0, y: 2143, w: 3840, h: 2143 },
      },
      {
        id: 'kv-2',
        status: 'skipped',
        why: 'slice-child',
        name: '赛季kv-0623-整理_2 1',
        parentId: 'bg-2',
        ancestorIds: ['sec-2', 'bg-2'],
        pageBox: { x: 0, y: 2143, w: 4152, h: 2326 },
        style: { fills: [{ type: 'IMAGE', visible: true }] },
      },
    ],
  };
  const red = evaluateProductScrollGate({
    inventory,
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1' },
      overlayDeltas: {},
      scrolled: 1,
      scrollTop: 720,
      layers: { 'sec-1': { cropWindow: 'first-section-pagebox', height: 2143, overflow: 'hidden' } },
      backgrounds: {
        'bg-2': { heroVisualPlane: null, coverCrop: null },
        'kv-2': { heroVisualPlane: null, coverCrop: null, imgSrc: null, imgVisible: false },
      },
      samples: [{
        kind: 'later-bg-solid',
        screenRgba: [29, 41, 65, 255],
        bgRgba: [1, 1, 1, 255],
        kvRgba: [20, 24, 40, 255],
        paintNodeId: 'bg-2',
      }],
    
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('later-bg-img-missing')), (red.problems || []).join('\n'));
});

test('later-section bg matching first-screen KV is red; source sheet is green', () => {
  const inventory = {
    schema: 'inventory/v2',
    sections: [
      { id: 'sec-1', number: 1, pageBox: { x: 0, y: 0, w: 3840, h: 2143 } },
      { id: 'sec-2', number: 2, pageBox: { x: 0, y: 2143, w: 3840, h: 2143 } },
    ],
    nodes: [
      { id: 'sec-1', status: 'determined', role: 'sec', name: 'sec/1', pageBox: { x: 0, y: 0, w: 3840, h: 2143 } },
      { id: 'sec-2', status: 'determined', role: 'sec', name: 'sec/2', pageBox: { x: 0, y: 2143, w: 3840, h: 2143 } },
      {
        id: 'bg-2',
        status: 'determined',
        role: 'bg',
        name: 'bg/pc背景1',
        parentId: 'sec-2',
        ancestorIds: ['sec-2'],
        pageBox: { x: 0, y: 2143, w: 3840, h: 2143 },
      },
    ],
  };
  const red = evaluateProductScrollGate({
    inventory,
    viewportKind: 'product',
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1' },
      overlayDeltas: {},
      scrolled: 1,
      scrollTop: 720,
      layers: { 'sec-1': { cropWindow: 'visual-root', height: 3000, overflow: 'visible' } },
      backgrounds: { 'bg-2': { heroVisualPlane: 'kv', coverCrop: 'cover-crop' } },
      samples: [{
        kind: 'later-bg-solid',
        screenRgba: [23, 25, 30, 255],
        bgRgba: [29, 37, 53, 255],
        kvRgba: [23, 25, 30, 255],
      }],
    
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
    },
  });
  assert.equal(red.ok, false);
  assert.ok(red.problems.some((line) => line.includes('first-section-not-pagebox-clip')), (red.problems || []).join('\n'));
  assert.ok(red.problems.some((line) => line.includes('later-bg-hero-visual-plane')), (red.problems || []).join('\n'));
  assert.ok(red.problems.some((line) => line.includes('later-bg-matches-first-kv')), (red.problems || []).join('\n'));

  const green = evaluateProductScrollGate({
    inventory,
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1' },
      overlayDeltas: {},
      scrolled: 1,
      scrollTop: 720,
      layers: { 'sec-1': { cropWindow: 'first-section-pagebox', height: 2143, overflow: 'hidden' } },
      backgrounds: {
        'bg-2': {
          heroVisualPlane: null,
          coverCrop: null,
          imgSrc: 'assets/bg-2.webp',
          imgVisible: true,
          assetW: 3840,
          assetH: 2143,
          assetEmpty: false,
        },
      },
      samples: [{
        kind: 'later-bg-solid',
        screenRgba: [30, 37, 54, 255],
        bgRgba: [29, 37, 53, 255],
        kvRgba: [23, 25, 30, 255],
      }],
    
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
    },
  });
  assert.equal(green.ok, true, (green.problems || []).join('\n'));
});

function laterMobileInventory() {
  return {
    schema: 'inventory/v2',
    sections: [
      { id: '814:11942', number: 1, pageBox: { x: 0, y: 0, w: 750, h: 1334 } },
      { id: '814:12060', number: 2, pageBox: { x: 840, y: 1334, w: 750, h: 1334 } },
    ],
    nodes: [
      { id: '814:11942', status: 'determined', role: 'sec', name: 'sec/1', pageBox: { x: 0, y: 0, w: 750, h: 1334 } },
      { id: '814:12060', status: 'determined', role: 'sec', name: 'sec/2', pageBox: { x: 840, y: 1334, w: 750, h: 1334 } },
      {
        id: '814:12061',
        status: 'determined',
        role: 'bg',
        name: 'bg/移动端背景',
        parentId: '814:12060',
        ancestorIds: ['814:12060'],
        pageBox: { x: 840, y: 1334, w: 750, h: 1334 },
        sliceExport: { box: { x: 840, y: 1334, w: 750, h: 1334 }, file: '814-12061.png' },
      },
      {
        id: '814:12063',
        status: 'skipped',
        name: '赛季kv-0610 2',
        parentId: '814:12061',
        ancestorIds: ['814:12060', '814:12061'],
        pageBox: { x: 225, y: 1334, w: 2118, h: 1187 },
        style: { fills: [{ type: 'IMAGE', visible: true }] },
      },
      {
        id: '814:12064',
        status: 'skipped',
        name: '赛季kv-0623-整理_竖版_2 1',
        parentId: '814:12061',
        ancestorIds: ['814:12060', '814:12061'],
        pageBox: { x: -344, y: 1334, w: 2404, h: 1347 },
        style: { fills: [{ type: 'IMAGE', visible: true }] },
      },
    ],
  };
}

test('laterKvMeasureIds only lists listed bg/ owners, not skipped slice-children', () => {
  const inventory = laterMobileInventory();
  const owner = inventory.nodes.find((node) => node.id === '814:12061');
  const paint = laterKvPaintNode(inventory, owner);
  assert.equal(paint?.id, '814:12061');
  assert.deepEqual(laterKvMeasureIds(inventory), ['814:12061']);
});

test('product-scroll is red when the listed bg/ PNG is empty or the wrong size', () => {
  const inventory = laterMobileInventory();
  const empty = evaluateProductScrollGate({
    inventory,
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1', height: '0px' },
      overlayDeltas: {},
      scrolled: 1,
      scrollTop: 445,
      layers: { '814:11942': { cropWindow: 'first-section-pagebox', height: 1334, overflow: 'hidden' } },
      backgrounds: {
        '814:12061': {
          heroVisualPlane: null, coverCrop: null,
          imgSrc: 'assets/814-12061.webp', imgVisible: true,
          assetW: 2714, assetH: 1347, assetEmpty: true,
        },
      },
      samples: [{
        kind: 'later-bg-solid',
        paintNodeId: '814:12061',
        screenRgba: [80, 90, 110, 255],
        kvRgba: [40, 50, 70, 255],
      }],
    
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
    },
  });
  assert.equal(empty.ok, false);
  assert.ok(empty.problems.some((line) => line.includes('later-bg-png-empty')), (empty.problems || []).join('\n'));
  assert.ok(empty.problems.some((line) => line.includes('later-bg-png-size-mismatch')), (empty.problems || []).join('\n'));
});

test('product-scroll does not require a later sec/3 bg/ to be on-screen after scrolling to sec/2', () => {
  const inventory = laterMobileInventory();
  inventory.sections.push({ id: '814:12130', number: 3, pageBox: { x: 1680, y: 2668, w: 750, h: 1334 } });
  inventory.nodes.push(
    { id: '814:12130', status: 'determined', role: 'sec', name: 'sec/3', pageBox: { x: 1680, y: 2668, w: 750, h: 1334 } },
    {
      id: '814:12131',
      status: 'determined',
      role: 'bg',
      name: 'bg/移动端背景',
      parentId: '814:12130',
      ancestorIds: ['814:12130'],
      pageBox: { x: 1680, y: 2668, w: 750, h: 1334 },
      sliceExport: { box: { x: 1680, y: 2668, w: 750, h: 1334 }, file: '814-12131.png' },
    },
  );
  const green = evaluateProductScrollGate({
    inventory,
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1', height: '0px' },
      overlayDeltas: {},
      scrolled: 1,
      scrollTop: 445,
      layers: { '814:11942': { cropWindow: 'first-section-pagebox', height: 1334, overflow: 'hidden' } },
      backgrounds: {
        '814:12061': {
          heroVisualPlane: null, coverCrop: null,
          imgSrc: 'assets/814-12061.webp', imgVisible: true,
          assetW: 750, assetH: 1334, assetEmpty: false,
        },
        '814:12131': {
          heroVisualPlane: null, coverCrop: null,
          imgSrc: 'assets/814-12131.webp', imgVisible: false,
          assetW: 750, assetH: 1334, assetEmpty: false,
        },
      },
      samples: [{
        kind: 'later-bg-solid',
        paintNodeId: '814:12061',
        screenRgba: [80, 90, 110, 255],
        kvRgba: [40, 50, 70, 255],
      }],
    
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
    },
  });
  assert.equal(green.ok, true, (green.problems || []).join('\n'));
});

test('product-scroll is green when listed bg/ PNG is visible, sized to pageBox, and not empty', () => {
  const inventory = laterMobileInventory();
  const green = evaluateProductScrollGate({
    inventory,
    productScroll: {
      overlay: { position: 'sticky', transform: 'none', zoom: '1', height: '0px' },
      overlayDeltas: {},
      scrolled: 1,
      scrollTop: 445,
      layers: { '814:11942': { cropWindow: 'first-section-pagebox', height: 1334, overflow: 'hidden' } },
      backgrounds: {
        '814:12061': {
          heroVisualPlane: null, coverCrop: null,
          imgSrc: 'assets/814-12061.webp', imgVisible: true,
          assetW: 750, assetH: 1334, assetEmpty: false,
        },
      },
      samples: [{
        kind: 'later-bg-solid',
        paintNodeId: '814:12061',
        screenRgba: [80, 90, 110, 255],
        kvRgba: [40, 50, 70, 255],
      }],
    
      seamPixels: { minLum: 40, rows: [{ lum: 40 }] },
    },
  });
  assert.equal(green.ok, true, (green.problems || []).join('\n'));
});
