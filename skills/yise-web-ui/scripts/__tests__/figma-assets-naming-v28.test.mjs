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
