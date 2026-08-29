import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTruthIndex, compareGeometry, expectedRenderedBox } from '../lib/figma-source-geometry-browser-check.mjs';

const origin = { x: 3660, y: 4656 };
const parent = {
  id: 'detail',
  box: { x: 4356, y: 6067, w: 776, h: 132 },
  layout: { layoutMode: 'HORIZONTAL', paddingTop: 30, paddingLeft: 66 },
};
const detailText = {
  id: 'detail-copy', parentId: 'detail',
  box: { x: 4356, y: 6097, w: 776, h: 72 },
  layout: { layoutAlign: 'INHERIT', layoutSizingHorizontal: 'FIXED' },
};

test('owner-local source geometry consumes HUG detail padding only at equal source origin', () => {
  const index = new Map([[parent.id, parent], [detailText.id, detailText]]);
  /* Auto Layout children are flex items — flexbox handles padding/alignment
     internally, so the truth box is already the final flow position. */
  assert.deepEqual(expectedRenderedBox(detailText, index, origin), { x: 696, y: 1441, w: 776, h: 72 });
});

test('non-auto-layout absolute child still consumes parent padding at equal origin', () => {
  const absoluteParent = { id: 'abs-parent', box: { x: 4356, y: 6067, w: 776, h: 132 }, layout: { paddingTop: 30, paddingLeft: 66 } };
  const absoluteChild = { id: 'abs-child', parentId: 'abs-parent', box: { x: 4356, y: 6067, w: 776, h: 72 }, layout: { layoutAlign: 'INHERIT' } };
  const index = new Map([[absoluteParent.id, absoluteParent], [absoluteChild.id, absoluteChild]]);
  assert.deepEqual(expectedRenderedBox(absoluteChild, index, origin), { x: 762, y: 1441, w: 776, h: 72 });
});

test('geometry comparison fails a card detail placed in the title band', () => {
  const expected = { x: 762, y: 1441, w: 776, h: 72 };
  const misplaced = { x: 762, y: 470, w: 776, h: 72 };
  const result = compareGeometry(expected, misplaced, { position: 10, size: 16 });
  assert.equal(result.ok, false);
  assert.ok(result.delta.y < -900);
});

test('geometry comparison accepts 4K source-scaled bounds within tolerance', () => {
  const result = compareGeometry(
    { x: 762, y: 1441, w: 776, h: 72 },
    { x: 762.2, y: 1444, w: 776.1, h: 72.1 },
    { position: 10, size: 16 },
  );
  assert.equal(result.ok, true);
});

test('truth index keeps fixed-overlay and section nodes addressable', () => {
  const index = buildTruthIndex({
    sections: { sec: { nodes: [{ id: 'section-node' }] } },
    fixedOverlays: { nodes: [{ id: 'fixed-node' }] },
  });
  assert.equal(index.get('section-node').__scope, 'sec');
  assert.equal(index.get('fixed-node').__scope, '__fixed__');
});


import { readFileSync as _readGateSrc } from 'node:fs';
import { fileURLToPath as _f2p } from 'node:url';

test('static geometry gate freezes decorative entry animations before measuring', () => {
  /* Regression: probes scrollIntoView each section, which (re)triggers
     data-motion-role slide/fade keyframes. Mid-animation translate was read
     as a source offset (titles reported 30-50px high). The gate must inject
     its freeze stylesheet before probing, like the motion browser check. */
  const src = _readGateSrc(_f2p(new URL('../lib/figma-source-geometry-browser-check.mjs', import.meta.url)), 'utf8');
  assert.match(src, /data-geometry-gate-freeze/);
  const freezeAt = src.indexOf('data-geometry-gate-freeze');
  const probeAt = src.indexOf('for (const probe of probes || [])');
  assert.ok(freezeAt > -1 && probeAt > -1 && freezeAt < probeAt, 'freeze must be injected before the probe loop');
});
