import test from 'node:test';
import assert from 'node:assert/strict';
import { extraPaintSliceIds, isExtraPaintSlice, paintSliceIdsOf } from '../lib/paint-slices.mjs';
import { sliceIdsOf } from '../lib/handoff-contract.mjs';

function byId(nodes) {
  return new Map(nodes.map((node) => [String(node.id), node]));
}

test('owner paints once: nested slice-child and mask are not extra', () => {
  const nodes = [
    { id: '1', type: 'FRAME', role: 'img', status: 'determined', parentId: null, sliceExport: { bounds: 'render', scale: 1, format: 'png' } },
    { id: '2', type: 'VECTOR', status: 'skipped', why: 'slice-child', parentId: '1' },
    { id: '2b', type: 'FRAME', status: 'skipped', why: 'slice-child', parentId: '1' },
    { id: '2c', type: 'VECTOR', status: 'skipped', why: 'slice-child', parentId: '2b' },
    { id: 'mask', type: 'VECTOR', status: 'skipped', why: 'slice-child', parentId: '1', isMask: true },
    { id: '3', type: 'VECTOR', role: 'ind', status: 'determined', parentId: null, name: 'ind/轮播点-选中' },
    { id: '4', type: 'VECTOR', status: 'skipped', why: 'invisible', parentId: null },
    { id: '5', type: 'VECTOR', status: 'skipped', why: 'art-fragment', parentId: null },
    { id: '6', type: 'RECTANGLE', status: 'unknown', parentId: null, style: { fills: [{ type: 'IMAGE', visible: true }] } },
  ];
  const map = byId(nodes);
  assert.equal(isExtraPaintSlice(nodes[1], map), false);
  assert.equal(isExtraPaintSlice(nodes[3], map), false);
  assert.equal(isExtraPaintSlice(nodes[4], map), false);
  assert.equal(isExtraPaintSlice(nodes[5], map), true);
  assert.equal(isExtraPaintSlice(nodes[6], map), false);
  assert.equal(isExtraPaintSlice(nodes[7], map), true);
  assert.equal(isExtraPaintSlice(nodes[8], map), true);
  const doc = { nodes, attachments: { componentSets: [], components: [], modals: [] } };
  const extra = extraPaintSliceIds(doc);
  assert.deepEqual(extra.sort(), ['3', '5', '6']);
  const all = paintSliceIdsOf(doc);
  assert.ok(all.includes('1'));
  assert.equal(all.includes('2c'), false);
  assert.equal(all.includes('mask'), false);
  assert.equal(all.includes('2'), false);
  assert.ok(sliceIdsOf(doc).includes('1'));
  assert.equal(sliceIdsOf(doc).includes('3'), false);
});
