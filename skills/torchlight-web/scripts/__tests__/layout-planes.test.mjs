import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLayoutPlanes, validateLayoutPlaneAdjudication, LAYOUT_PLANES_SCHEMA } from '../lib/figma-layout-planes.mjs';

const frame = { id: 'frame:1', name: 'pc', type: 'FRAME', box: { x: 0, y: 0, w: 3840, h: 2160 }, ownerPath: ['frame:1'] };

function verifiedNodes() {
  return [
    { id: 'bg:1', parentId: 'frame:1', orderKey: [0], name: 'bg/season art', type: 'FRAME', box: { x: -400, y: 0, w: 4640, h: 2160 }, ownerPath: ['frame:1', 'bg:1'], clipsContent: false, style: { fills: [{ type: 'IMAGE' }] } },
    { id: 'bg:leaf', parentId: 'bg:1', orderKey: [0, 0], name: 'Vector art', type: 'VECTOR', box: { x: -300, y: 40, w: 4400, h: 2000 }, ownerPath: ['frame:1', 'bg:1', 'bg:leaf'], style: { fills: [{ type: 'SOLID' }] } },
    { id: 'ui:1', parentId: 'frame:1', orderKey: [1], name: 'content/page ui', type: 'FRAME', box: { x: 0, y: 0, w: 3840, h: 2160 }, ownerPath: ['frame:1', 'ui:1'], clipsContent: false },
    { id: 'title:1', parentId: 'ui:1', orderKey: [1, 0], name: 'txt/title', type: 'TEXT', box: { x: 1000, y: 1000, w: 800, h: 120 }, ownerPath: ['frame:1', 'ui:1', 'title:1'] },
    { id: 'btn:1', parentId: 'ui:1', orderKey: [1, 1], name: 'btn/download', type: 'FRAME', box: { x: 1600, y: 1700, w: 300, h: 100 }, ownerPath: ['frame:1', 'ui:1', 'btn:1'] },
  ];
}

test('detects verified two-plane only from sibling source tree, geometry, and UI descendants', () => {
  const result = detectLayoutPlanes({ frame, nodes: verifiedNodes() });
  assert.equal(result.schema, LAYOUT_PLANES_SCHEMA);
  assert.equal(result.status, 'verified-two-plane');
  assert.equal(result.planes.background.nodeId, 'bg:1');
  assert.equal(result.planes.background.responsivePolicy.scaleMode, 'width-scale');
  assert.equal(result.planes.foreground.nodeId, 'ui:1');
  assert.equal(result.planes.foreground.responsivePolicy.scaleMode, 'source-ui-scale');
  assert.equal(result.planes.foreground.responsivePolicy.implementation.pcSeasonal, 'width-scale');
  assert.equal(result.evidence.namingChecks.every((c) => c.note === 'hint-only'), true);
});

test('name-only bg/content hints do not create a verified split without source geometry and UI evidence', () => {
  const nodes = [
    { id: 'bg:bad', parentId: 'frame:1', orderKey: [0], name: 'bg/pc', type: 'FRAME', box: { x: 0, y: 0, w: 100, h: 100 }, ownerPath: ['frame:1', 'bg:bad'] },
    { id: 'content:bad', parentId: 'frame:1', orderKey: [1], name: 'content/ui', type: 'FRAME', box: { x: 0, y: 0, w: 100, h: 100 }, ownerPath: ['frame:1', 'content:bad'] },
  ];
  const result = detectLayoutPlanes({ frame, nodes });
  assert.notEqual(result.status, 'verified-two-plane');
  assert.ok(result.detection.blockers.some((b) => b.code === 'no-source-backed-background-plane' || b.code === 'no-source-backed-foreground-plane'));
  assert.equal(result.planes, null);
});

test('foreground nested under background fails closed instead of inventing sibling planes', () => {
  const nodes = [
    { id: 'bg:1', parentId: 'frame:1', orderKey: [0], name: 'bg/season art', type: 'FRAME', box: { x: -400, y: 0, w: 4640, h: 2160 }, ownerPath: ['frame:1', 'bg:1'], style: { fills: [{ type: 'IMAGE' }] } },
    { id: 'ui:nested', parentId: 'bg:1', orderKey: [0, 1], name: 'content/page ui', type: 'FRAME', box: { x: 0, y: 0, w: 3840, h: 2160 }, ownerPath: ['frame:1', 'bg:1', 'ui:nested'] },
    { id: 'title:1', parentId: 'ui:nested', orderKey: [0, 1, 0], name: 'txt/title', type: 'TEXT', box: { x: 100, y: 100, w: 200, h: 80 }, ownerPath: ['frame:1', 'bg:1', 'ui:nested', 'title:1'] },
  ];
  const result = detectLayoutPlanes({ frame, nodes });
  assert.notEqual(result.status, 'verified-two-plane');
  assert.ok(result.detection.blockers.some((b) => b.code === 'no-source-backed-foreground-plane'));
});

test('paint order must put background below foreground', () => {
  const nodes = verifiedNodes().map((node) => ({ ...node }));
  nodes.find((n) => n.id === 'bg:1').orderKey = [2];
  nodes.find((n) => n.id === 'ui:1').orderKey = [1];
  const result = detectLayoutPlanes({ frame, nodes });
  assert.notEqual(result.status, 'verified-two-plane');
  assert.ok(result.detection.blockers.some((b) => b.code === 'paint-order-not-background-below-foreground'));
});

test('human adjudication is accepted only after node and geometry recheck', () => {
  const nodes = verifiedNodes();
  const ok = {
    schema: LAYOUT_PLANES_SCHEMA + '/adjudication',
    status: 'verified-two-plane',
    backgroundNodeId: 'bg:1',
    foregroundNodeId: 'ui:1',
    rationale: 'Ambiguous names were resolved by source sibling owner tree and geometry.',
    geometry: [
      { nodeId: 'bg:1', box: { x: -400, y: 0, w: 4640, h: 2160 } },
      { nodeId: 'ui:1', box: { x: 0, y: 0, w: 3840, h: 2160 } },
    ],
  };
  assert.equal(validateLayoutPlaneAdjudication(ok, nodes).ok, true);
  const result = detectLayoutPlanes({ frame, nodes, adjudication: ok });
  assert.equal(result.status, 'verified-two-plane');
  assert.equal(result.detection.method, 'human-adjudication+fixture-recheck');
  const drifted = { ...ok, geometry: [{ nodeId: 'bg:1', box: { x: 0, y: 0, w: 4640, h: 2160 } }] };
  const checked = validateLayoutPlaneAdjudication(drifted, nodes);
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.some((e) => e.code === 'geometry-drift'));
});
