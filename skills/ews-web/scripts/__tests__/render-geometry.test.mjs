import test from 'node:test';
import assert from 'node:assert/strict';
import { renderOutsetOf } from '../lib/render-geometry.mjs';
import { sliceRenderCoverageGaps } from '../ews-web.mjs';
import { renderOutsetImgCss } from '../../assets/runtime/render.mjs';

test('render-origin slice keeps its left overhang and rejects missing pixels', () => {
  const node = { id: 'slice', pageBox: { x: 100, y: 20, w: 200, h: 100 }, renderBox: { x: 80, y: 20, w: 220, h: 100 }, sliceExport: { bounds: 'render', scale: 1 } };
  node.renderOutset = renderOutsetOf(node);
  assert.deepEqual(node.renderOutset, { l: 20, t: 0, r: 0, b: 0 });
  const model = { platforms: { pc: { nodes: [node] } } };
  const incomplete = { slice: { width: 200, height: 100 } };
  assert.equal(sliceRenderCoverageGaps(model, { pc: incomplete }).length, 1);
  const css = renderOutsetImgCss(node, incomplete);
  assert.match(css, /left:-20px/);
  assert.match(css, /width:200px/);
  assert.equal(sliceRenderCoverageGaps(model, { pc: { slice: { width: 220, height: 100 } } }).length, 0);
});

test('render bounds contained by the layout do not imply missing export pixels', () => {
  assert.equal(renderOutsetOf({ pageBox: { x: 0, y: 0, w: 200, h: 200 }, renderBox: { x: 10, y: 10, w: 180, h: 180 } }), null);
});
