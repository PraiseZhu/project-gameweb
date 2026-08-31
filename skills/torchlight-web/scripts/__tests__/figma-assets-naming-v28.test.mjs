import test from 'node:test';
import assert from 'node:assert/strict';
import { pickSliceNodes } from '../figma-assets.mjs';

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
