import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderInteractionHandoff, buildRendererInteractionPayloadFromNodes } from '../lib/figma-render-interaction-adapter.mjs';

test('handoff fails closed when caller has no source interaction model', () => {
  assert.deepEqual(createRenderInteractionHandoff(), {
    schema: 'figma-render-interaction-handoff/v1', status: 'unavailable',
    reason: 'source interaction model is required; no DOM or raw inventory inference is allowed', payload: null,
  });
});

test('handoff accepts only caller-owned source model and builds renderer payload', () => {
  const nodes = [
    { id: 'switch', type: 'FRAME', name: 'switch/cards' },
    { id: 'page-a', type: 'FRAME', name: 'State A', parentId: 'switch', orderKey: [0] },
    { id: 'page-b', type: 'FRAME', name: 'State B', parentId: 'switch', orderKey: [1] },
  ];
  const handoff = createRenderInteractionHandoff({ sourceModel: buildRendererInteractionPayloadFromNodes(nodes) });
  assert.equal(handoff.status, 'ready');
  assert.equal(handoff.payload.schema, 'figma-render-interaction-payload/v1');
});
