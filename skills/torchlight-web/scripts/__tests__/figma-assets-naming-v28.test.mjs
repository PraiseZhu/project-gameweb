import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pickSliceNodes, pageAlignedExportBox, isReadyHandoffTruth } from '../figma-assets.mjs';

function truthWith(nodes) {
  return {
    sections: {
      'sec:1': { nodes },
    },
  };
}

test('figma-naming v2.9 visual prefixes override TEXT for asset slicing', () => {
  const picks = pickSliceNodes(truthWith([
    { id: 'copy', type: 'TEXT', name: 'Plain editable copy', box: { x: 0, y: 0, w: 100, h: 20 }, style: { fills: [{ type: 'SOLID' }] } },
    { id: 'visual-text', type: 'TEXT', name: 'IMG / title art', box: { x: 0, y: 30, w: 220, h: 80 }, style: { fills: [{ type: 'SOLID' }] } },
    { id: 'fullwidth-slash', type: 'TEXT', name: 'img\uFF0Fbad', box: { x: 0, y: 120, w: 220, h: 80 }, style: { fills: [{ type: 'SOLID' }] } },
    { id: 'bad-fullwidth-backslash', type: 'TEXT', name: 'img\uFF3Cbad', box: { x: 0, y: 165, w: 220, h: 80 }, style: { fills: [{ type: 'SOLID' }] } },
    { id: 'bad-backslash', type: 'TEXT', name: 'img\\bad', box: { x: 0, y: 210, w: 220, h: 80 }, style: { fills: [{ type: 'SOLID' }] } },
  ]));
  const ids = picks.map((pick) => pick.nodeId);
  assert.deepEqual(ids, ['visual-text', 'fullwidth-slash']);
  assert.match(picks[0].reason, /img\//);
});

test('unlabelled image fill can still be exported by fill evidence without becoming a naming role', () => {
  const picks = pickSliceNodes(truthWith([
    { id: 'image-fill', type: 'RECTANGLE', name: 'Rectangle 1', box: { x: 0, y: 0, w: 100, h: 100 }, style: { fills: [{ type: 'IMAGE', visible: true }] } },
  ]));
  assert.deepEqual(picks.map((pick) => pick.nodeId), ['image-fill']);
  assert.match(picks[0].reason, /image/);
});

test('clipped unknown IMAGE fill exports the visible box, not the overflowing layout box', () => {
  const picks = pickSliceNodes(truthWith([
    {
      id: '0:1788',
      type: 'RECTANGLE',
      name: '赛季kv-最终 1',
      box: { x: -823, y: -46, w: 2443, h: 1380 },
      renderBox: { x: 0, y: 0, w: 750, h: 1334 },
      style: { fills: [{ type: 'IMAGE', visible: true }, { type: 'SOLID', visible: true }] },
    },
  ]));
  assert.equal(picks[0].nodeId, '0:1788');
  assert.equal(picks[0].exportBounds, 'box');
  assert.deepEqual(picks[0].exportBox, { x: 0, y: 0, w: 750, h: 1334 });
  assert.equal(picks[0].w, 750);
  assert.equal(picks[0].h, 1334);
  assert.equal(picks[0].cropToVisibleBox, true);
});

test('named modal sliceExport nodes are collected from platform.modals', () => {
  const picks = pickSliceNodes({
    platforms: {
      pc: {
        sections: { '721:7867': { nodes: [] } },
        modals: [{
          id: '721:8449',
          name: 'modal/pc_cn订阅赛季日程',
          nodes: [
            { id: '721:8449', type: 'FRAME', name: 'modal/pc_cn订阅赛季日程', box: { x: 0, y: 0, w: 3840, h: 2160 }, style: { fills: [] } },
            {
              id: '721:8464',
              type: 'FRAME',
              name: 'img/弹窗背景',
              box: { x: 0, y: 410, w: 3840, h: 1340 },
              sliceExport: { bounds: 'render', scale: 1, format: 'png', file: '721-8464.png' },
              style: { fills: [] },
            },
          ],
        }],
      },
    },
  });
  assert.equal(picks.some((pick) => pick.nodeId === '721:8464'), true);
  assert.match(picks.find((pick) => pick.nodeId === '721:8464').reason, /sliceExport/);
});

test('BOOLEAN btn with sliceExport is sliced without an img/ prefix', () => {
  const picks = pickSliceNodes(truthWith([
    {
      id: '395:35371',
      type: 'BOOLEAN_OPERATION',
      name: 'btn/右滑动箭头',
      box: { x: 0, y: 0, w: 16, h: 16 },
      sliceExport: { bounds: 'render', scale: 1, format: 'png', file: '395-35371.png' },
      style: { fills: [{ type: 'SOLID', visible: true }] },
    },
    {
      id: 'plain-btn',
      type: 'FRAME',
      name: 'btn/播放',
      box: { x: 60, y: 0, w: 80, h: 32 },
      style: { fills: [{ type: 'SOLID', visible: true }] },
    },
  ]));
  assert.deepEqual(picks.map((pick) => pick.nodeId), ['395:35371']);
  assert.match(picks[0].reason, /sliceExport/);
});

test('BOOLEAN btn arrows are sliced even when inventory left sliceExport unset', () => {
  const picks = pickSliceNodes(truthWith([
    {
      id: '395:35371',
      type: 'BOOLEAN_OPERATION',
      name: 'btn/右滑动箭头',
      box: { x: 0, y: 0, w: 52, h: 54 },
      style: { fills: [{ type: 'SOLID', visible: true }] },
    },
    {
      id: '392:24682',
      type: 'BOOLEAN_OPERATION',
      name: 'btn/左划动箭头',
      box: { x: 80, y: 0, w: 16, h: 16 },
      style: { fills: [{ type: 'GRADIENT_LINEAR', visible: true }] },
    },
    {
      id: 'plain-btn',
      type: 'FRAME',
      name: 'btn/播放',
      box: { x: 160, y: 0, w: 80, h: 32 },
      style: { fills: [{ type: 'SOLID', visible: true }] },
    },
  ]));
  assert.deepEqual(picks.map((pick) => pick.nodeId).sort(), ['392:24682', '395:35371']);
  assert.match(picks.find((pick) => pick.nodeId === '392:24682').reason, /btn 箭头轮廓/);
});

test('ind variant roots with sliceExport are sliced from componentVariantGraph', () => {
  const picks = pickSliceNodes({
    sections: { 'sec:1': { nodes: [] } },
    componentVariantGraph: {
      componentSets: [{
        componentSetId: '397:35948',
        variants: [
          {
            id: '397:35947',
            componentId: '397:35947',
            name: 'Property 1=highlight',
            type: 'COMPONENT',
            status: 'determined',
            role: 'ind',
            behavior: 'indicator',
            sliceExport: { bounds: 'render', scale: 1, format: 'png', file: '397-35947.png' },
            nodes: [{ id: '397:35946', type: 'RECTANGLE', name: '选中 1', status: 'skipped', why: 'slice-child' }],
          },
          {
            id: '397:35949',
            componentId: '397:35949',
            name: 'Property 1=normal',
            type: 'COMPONENT',
            status: 'determined',
            role: 'ind',
            behavior: 'indicator',
            sliceExport: { bounds: 'render', scale: 1, format: 'png', file: '397-35949.png' },
            nodes: [{ id: '397:35951', type: 'RECTANGLE', name: 'Rectangle 3468570', status: 'skipped', why: 'art-fragment' }],
          },
        ],
      }],
      components: [],
      variantTrees: {},
    },
  });
  assert.deepEqual(picks.map((pick) => pick.nodeId).sort(), ['397:35947', '397:35949']);
  assert.match(picks[0].reason, /sliceExport/);
});

test('img/ lang variant roots with sliceExport are sliced from componentVariantGraph', () => {
  const picks = pickSliceNodes({
    sections: { 'sec:1': { nodes: [] } },
    componentVariantGraph: {
      componentSets: [{
        componentSetId: '700:10241',
        name: 'img/模块2可替换素材',
        variants: [
          {
            id: '700:10242',
            componentId: '700:10242',
            name: 'lang=cn',
            type: 'COMPONENT',
            status: 'determined',
            role: 'img',
            sliceExport: { bounds: 'render', scale: 1, format: 'png', file: '700-10242.png' },
            nodes: [],
          },
          {
            id: '700:10243',
            componentId: '700:10243',
            name: 'lang=en',
            type: 'COMPONENT',
            status: 'determined',
            role: 'img',
            sliceExport: { bounds: 'render', scale: 1, format: 'png', file: '700-10243.png' },
            nodes: [],
          },
        ],
      }],
      components: [],
      variantTrees: {},
    },
  });
  assert.deepEqual(picks.map((pick) => pick.nodeId).sort(), ['700:10242', '700:10243']);
  assert.match(picks[0].reason, /sliceExport/);
});

test('ready-handoff slices listed sliceExport and visible IMAGE fills, not empty exportSettings frames', () => {
  const truth = {
    schema: 'yise-ready-platform-truth/v1',
    source: { schema: 'inventory/v2' },
    platforms: {
      pc: {
        sections: {
          'sec:1': {
            nodes: [
              {
                id: 'kv-unknown',
                type: 'FRAME',
                name: 'kv',
                status: 'unknown',
                pageBox: { x: 0, y: 0, w: 3840, h: 2143 },
                sliceExport: { bounds: 'render', scale: 1, format: 'png', file: 'kv-unknown.png', box: { x: 0, y: 0, w: 3840, h: 2143 } },
                exportSettings: [{ format: 'PNG' }],
                style: { fills: [] },
              },
              {
                id: 'kv-fill',
                type: 'RECTANGLE',
                name: '赛季kv-0610 1',
                status: 'unknown',
                parentId: 'kv-unknown',
                pageBox: { x: 0, y: 0, w: 3840, h: 2152 },
                style: { fills: [{ type: 'IMAGE', visible: true }] },
              },
              {
                id: 'title-img',
                type: 'INSTANCE',
                name: 'img/标题slg',
                status: 'determined',
                role: 'img',
                pageBox: { x: 0, y: 1103, w: 3840, h: 633 },
                sliceExport: { bounds: 'render', scale: 1, format: 'png', file: 'title.png', box: { x: 0, y: 1103, w: 3840, h: 604 } },
              },
            ],
          },
        },
      },
    },
  };
  assert.equal(isReadyHandoffTruth(truth), true);
  const picks = pickSliceNodes(truth);
  assert.deepEqual(picks.map((pick) => pick.nodeId).sort(), ['kv-unknown', 'title-img']);
  assert.match(picks.find((pick) => pick.nodeId === 'title-img').reason, /sliceExport/);
  assert.equal(picks.find((pick) => pick.nodeId === 'kv-unknown')?.exportBounds, 'box');
  assert.deepEqual(picks.find((pick) => pick.nodeId === 'kv-unknown')?.exportBox, { x: 0, y: 0, w: 3840, h: 2143 });
});

test('listed img/ time-bg and unnamed kv FRAME export the owner pageBox, not ink', () => {
  const truth = {
    schema: 'yise-ready-platform-truth/v1',
    source: { schema: 'inventory/v2' },
    platforms: {
      pc: {
        sections: {
          'sec:1': {
            nodes: [
              {
                id: '721:8193',
                type: 'FRAME',
                name: 'img/时间背景',
                status: 'determined',
                role: 'img',
                pageBox: { x: 0, y: 1543, w: 3840, h: 260 },
                box: { x: 0, y: 1543, w: 3840, h: 260 },
                renderBox: { x: -14764, y: 1560.925, w: 3840, h: 167.075 },
                sliceExport: { bounds: 'render', scale: 1, format: 'png', file: '721-8193.png', box: { x: 0, y: 1539.925, w: 3840, h: 167.075 } },
                style: { fills: [] },
              },
              {
                id: '721:7868',
                type: 'FRAME',
                name: 'kv',
                status: 'unknown',
                pageBox: { x: 0, y: 0, w: 3840, h: 2143 },
                box: { x: 0, y: 0, w: 3840, h: 2143 },
                sliceExport: { bounds: 'render', scale: 1, format: 'png', file: '721-7868.png', box: { x: 0, y: 0, w: 3840, h: 2143 } },
                style: { fills: [] },
              },
              {
                id: '721:7869',
                type: 'RECTANGLE',
                name: '赛季kv-0610 1',
                status: 'unknown',
                parentId: '721:7868',
                pageBox: { x: 0, y: 0, w: 3840, h: 2152 },
                style: { fills: [{ type: 'IMAGE', visible: true }] },
              },
            ],
          },
        },
      },
    },
  };
  const picks = pickSliceNodes(truth);
  const timeBg = picks.find((pick) => pick.nodeId === '721:8193');
  const kvOwner = picks.find((pick) => pick.nodeId === '721:7868');
  assert.equal(timeBg?.exportBounds, 'box');
  assert.deepEqual(timeBg?.exportBox, { x: 0, y: 1543, w: 3840, h: 260 });
  assert.equal(kvOwner?.exportBounds, 'box');
  assert.deepEqual(kvOwner?.exportBox, { x: 0, y: 0, w: 3840, h: 2143 });
});

test('unnamed kv without sliceExport still exports the owner pageBox', () => {
  const truth = {
    schema: 'yise-ready-platform-truth/v1',
    source: { schema: 'inventory/v2' },
    platforms: {
      mobile: {
        sections: {
          'sec:1': {
            nodes: [
              {
                id: '814:11943',
                type: 'FRAME',
                name: 'kv',
                status: 'unknown',
                pageBox: { x: 0, y: 0, w: 750, h: 1334 },
                box: { x: 0, y: 0, w: 750, h: 1334 },
                style: { fills: [] },
              },
              {
                id: '814:11944',
                type: 'RECTANGLE',
                name: '赛季kv-最终 1',
                status: 'unknown',
                parentId: '814:11943',
                pageBox: { x: -823, y: -46, w: 2443, h: 1380 },
                style: { fills: [{ type: 'IMAGE', visible: true }, { type: 'SOLID', visible: true }] },
              },
            ],
          },
        },
      },
    },
  };
  const picks = pickSliceNodes(truth);
  assert.deepEqual(picks.map((pick) => pick.nodeId), ['814:11943']);
  assert.equal(picks[0].exportBounds, 'box');
  assert.deepEqual(picks[0].exportBox, { x: 0, y: 0, w: 750, h: 1334 });
});

test('listed bg/ with inventory bounds=render still exports the node box, not canvas ink', () => {
  const truth = {
    schema: 'yise-ready-platform-truth/v1',
    source: { schema: 'inventory/v2' },
    platforms: {
      pc: {
        sections: {
          'sec:2': {
            nodes: [
              {
                id: '721:8244',
                type: 'FRAME',
                name: 'bg/pc背景1',
                status: 'determined',
                role: 'bg',
                pageBox: { x: 0, y: 2143, w: 3840, h: 2143 },
                box: { x: 0, y: 2143, w: 3840, h: 2143 },
                renderBox: { x: -14764, y: 2657, w: 3840, h: 2143 },
                sliceExport: { bounds: 'render', scale: 1, format: 'png', file: '721-8244.png', box: { x: 0, y: 2143, w: 3840, h: 2143 } },
                style: { fills: [], descendantEffects: [{ effectType: 'LAYER_BLUR' }] },
              },
              {
                id: '721:8245',
                type: 'RECTANGLE',
                name: '赛季kv-0623-整理_2 1',
                status: 'skipped',
                why: 'slice-child',
                parentId: '721:8244',
                pageBox: { x: 0, y: 2143, w: 4152, h: 2326 },
                style: { fills: [{ type: 'IMAGE', visible: true }] },
              },
            ],
          },
        },
      },
    },
  };
  const picks = pickSliceNodes(truth);
  assert.deepEqual(picks.map((pick) => pick.nodeId), ['721:8244']);
  assert.equal(picks[0].exportBounds, 'box');
  assert.deepEqual(picks[0].exportBox, { x: 0, y: 2143, w: 3840, h: 2143 });
});

test('exportBox is page-aligned, never canvas renderBox', () => {
  const page = { x: 0, y: 1103, w: 3840, h: 633 };
  const listed = { x: 0, y: 1103, w: 3840, h: 604 };
  const canvas = { x: -14764, y: 1124, w: 3840, h: 604 };
  const box = pageAlignedExportBox({
    pageBox: page,
    sliceExport: { bounds: 'render', box: listed },
    renderBox: canvas,
  }, { exportBounds: 'render', renderBox: canvas });
  assert.deepEqual(box, {
    x: 0,
    y: 1103,
    w: 3840,
    h: 604,
  });
  assert.notEqual(box.x, canvas.x);
});

test('whole-frame box export requests use_absolute_bounds=true', () => {
  const src = readFileSync(fileURLToPath(new URL('../figma-assets.mjs', import.meta.url)), 'utf8');
  assert.match(src, /listedInkBox \? 'box'/);
  assert.match(src, /if \(chunk\[0\]\.exportBounds !== 'render'\) q\.set\('use_absolute_bounds', 'true'\)/);
  const timeBg = pickSliceNodes({
    schema: 'yise-ready-platform-truth/v1',
    source: { schema: 'inventory/v2' },
    platforms: {
      pc: {
        sections: {
          'sec:1': {
            nodes: [{
              id: 'img-hero',
              type: 'FRAME',
              name: 'img/标题',
              status: 'determined',
              role: 'img',
              pageBox: { x: 10, y: 20, w: 200, h: 300 },
              box: { x: 10, y: 20, w: 200, h: 300 },
              renderBox: { x: 0, y: 0, w: 240, h: 340 },
              sliceExport: { bounds: 'render', scale: 1, format: 'png', file: 'img-hero.png' },
              style: { fills: [] },
            }],
          },
        },
      },
    },
  }).find((pick) => pick.nodeId === 'img-hero');
  assert.equal(timeBg?.exportBounds, 'box');
  assert.deepEqual(timeBg?.exportBox, { x: 10, y: 20, w: 200, h: 300 });
});

test('reuse-existing skips Figma fetch when the PNG is already on disk', () => {
  const src = readFileSync(fileURLToPath(new URL('../figma-assets.mjs', import.meta.url)), 'utf8');
  assert.match(src, /--reuse-existing/);
  assert.match(src, /reusedPicks/);
  assert.match(src, /fetchPicks/);
  assert.match(src, /fetchPicks\.length \? readToken\(demoDir\) : null/);
  assert.match(src, /reuseExisting && fetchPicks\.length/);
  assert.match(src, /拒绝打 Figma/);
  assert.match(src, /AbortController/);
  assert.match(src, /Figma API 超时/);
});

test('reuse-existing fail-closes when any listed PNG is missing', () => {
  const src = readFileSync(fileURLToPath(new URL('../figma-assets.mjs', import.meta.url)), 'utf8');
  assert.match(src, /reuseExisting && fetchPicks\.length/);
  assert.match(src, /--reuse-existing 缺 PNG，拒绝打 Figma/);
});

test('collapsed webp under 2KB keeps serving pngFile', () => {
  const src = readFileSync(fileURLToPath(new URL('../figma-assets.mjs', import.meta.url)), 'utf8');
  assert.match(src, /webpCollapsed/);
  assert.match(src, /hit\.bytes\) < 2048 && rec\.pngFile/);
});
