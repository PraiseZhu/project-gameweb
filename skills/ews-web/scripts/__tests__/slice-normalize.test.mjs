import test from 'node:test';
import assert from 'node:assert/strict';
import { sliceCropPlan } from '../lib/slice-normalize.mjs';

test('matching png is kept; mismatch without origin is rejected, not top-left cropped', () => {
  assert.deepEqual(sliceCropPlan({ pngW: 100, pngH: 40, wantW: 100, wantH: 40 }), { action: 'keep' });
  const rejected = sliceCropPlan({ pngW: 3840, pngH: 2268, wantW: 3840, wantH: 2160 });
  assert.equal(rejected.action, 'reject');
  assert.match(rejected.reason, /refuse top-left crop/);
});

test('origin-aware crop stays inside the png', () => {
  const plan = sliceCropPlan({ pngW: 120, pngH: 80, wantW: 100, wantH: 40, origin: { x: 10, y: 20 } });
  assert.deepEqual(plan, { action: 'crop', x: 10, y: 20, w: 100, h: 40 });
  const outside = sliceCropPlan({ pngW: 120, pngH: 80, wantW: 100, wantH: 40, origin: { x: 30, y: 20 } });
  assert.equal(outside.action, 'reject');
});
