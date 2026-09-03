import test from 'node:test';
import assert from 'node:assert/strict';
import { pickSliceNodes } from '../lib/figma-slice-nodes.mjs';

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

test('whole-frame img/ with sliceExport bounds=render exports pageBox, not canvas ink', () => {
  const pageBox = { x: 10, y: 20, w: 200, h: 300 };
  const ink = { x: 0, y: 0, w: 240, h: 340 };
  const picks = pickSliceNodes(truthWith([
    {
      id: 'img-hero',
      type: 'FRAME',
      name: 'img/hero',
      role: 'img',
      pageBox,
      box: pageBox,
      renderBox: ink,
      inkBox: ink,
      sliceExport: { bounds: 'render', scale: 1, format: 'png', file: 'img-hero.png', box: pageBox },
      style: { fills: [{ type: 'IMAGE', visible: true }] },
    },
  ]));
  assert.equal(picks[0].nodeId, 'img-hero');
  assert.equal(picks[0].exportBounds, 'box');
  assert.deepEqual(picks[0].exportBox, pageBox);
  assert.equal(picks[0].w, 200);
  assert.equal(picks[0].h, 300);
  assert.equal(picks[0].cropToVisibleBox, false);
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

test('platform modal trees are sliced when they declare sliceExport or img/', () => {
  const picks = pickSliceNodes({
    platforms: {
      mobile: {
        sections: { 'sec:1': { nodes: [] } },
        modals: [{
          id: '392:27548',
          name: 'modal/顶部导航-1624尺寸',
          nodes: [
            { id: '392:27548', type: 'FRAME', name: 'modal/顶部导航-1624尺寸', box: { x: 0, y: 0, w: 750, h: 1624 } },
            {
              id: '392:27549',
              type: 'FRAME',
              name: 'img/背景',
              box: { x: 0, y: 0, w: 750, h: 1624 },
              sliceExport: { bounds: 'render', scale: 1, format: 'png', file: '392-27549.png' },
            },
            {
              id: '392:27500',
              type: 'FRAME',
              name: 'img/弹窗背景',
              box: { x: 0, y: 306, w: 750, h: 690 },
              sliceExport: { bounds: 'render', scale: 1, format: 'png', file: '392-27500.png' },
            },
          ],
        }],
      },
    },
  });
  assert.deepEqual(picks.map((pick) => pick.nodeId).sort(), ['392:27500', '392:27549']);
});

const TOP_LEVEL_VIDEO_MODAL = {
  id: '392:27629',
  name: 'modal/pc视频弹窗',
  nodes: [
    { id: '392:27629', type: 'FRAME', name: 'modal/pc视频弹窗', box: { x: 0, y: 0, w: 3840, h: 2160 } },
    {
      id: '392:27630',
      type: 'FRAME',
      name: 'img/弹窗背景',
      box: { x: 0, y: 0, w: 3840, h: 2160 },
      sliceExport: { bounds: 'render', scale: 1, format: 'png', file: '392-27630.png' },
    },
    {
      id: '392:27631',
      type: 'FRAME',
      name: 'img/关闭按钮',
      box: { x: 3600, y: 80, w: 80, h: 80 },
      sliceExport: { bounds: 'render', scale: 1, format: 'png', file: '392-27631.png' },
    },
  ],
};

test('top-level truth.modals are sliced without platforms', () => {
  const picks = pickSliceNodes({
    sections: { 'sec:1': { nodes: [] } },
    modals: [TOP_LEVEL_VIDEO_MODAL],
  });
  assert.deepEqual(picks.map((pick) => pick.nodeId).sort(), ['392:27630', '392:27631']);
});

test('top-level truth.modals still slice when the handoff has no sections', () => {
  const picks = pickSliceNodes({
    modals: [TOP_LEVEL_VIDEO_MODAL],
  });
  assert.deepEqual(picks.map((pick) => pick.nodeId).sort(), ['392:27630', '392:27631']);
});

test('platform modal trees still slice when that platform has no sections', () => {
  const picks = pickSliceNodes({
    platforms: {
      pc: {
        modals: [TOP_LEVEL_VIDEO_MODAL],
      },
    },
  });
  assert.deepEqual(picks.map((pick) => pick.nodeId).sort(), ['392:27630', '392:27631']);
});
