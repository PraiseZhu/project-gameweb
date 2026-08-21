import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveInteractionModel } from '../lib/figma-interaction-contract.mjs';
import { buildRendererInteractionPayload } from '../lib/figma-render-interaction-adapter.mjs';

function sourceModel({ active = 'tab-a', controls = true } = {}) {
  const nodes = [
    { id: 'section', type: 'FRAME', name: 'sec/one' },
    { id: 'switch', type: 'FRAME', name: 'switch/cards', parentId: 'section' },
    { id: 'page-a', type: 'FRAME', name: 'State A', parentId: 'switch', orderKey: [0] },
    { id: 'page-b', type: 'FRAME', name: 'State B', parentId: 'switch', orderKey: [1] },
    { id: 'prev', type: 'FRAME', name: 'btn/prev', parentId: 'section' },
    { id: 'next', type: 'FRAME', name: 'btn/next', parentId: 'section' },
  ];
  if (controls) nodes.push(
    { id: 'tab-a', type: 'FRAME', name: 'tab/a', parentId: 'section', componentProperties: { State: { value: active === 'tab-a' ? 'active' : 'normal' } } },
    { id: 'tab-b', type: 'FRAME', name: 'tab/b', parentId: 'section', componentProperties: { State: { value: active === 'tab-b' ? 'active' : 'normal' } } },
    { id: 'ind-a', type: 'FRAME', name: 'ind/a', parentId: 'section', componentProperties: { State: { value: active === 'ind-a' ? 'active' : 'normal' } } },
    { id: 'ind-b', type: 'FRAME', name: 'ind/b', parentId: 'section', componentProperties: { State: { value: active === 'ind-b' ? 'active' : 'normal' } } },
  );
  return deriveInteractionModel(nodes);
}

const attrs = (payload) => new Map(payload.attributes.map((entry) => [entry.id, entry.attrs]));

test('adapts direct-child pages with a source-selected initial tab state', () => {
  const payload = buildRendererInteractionPayload(sourceModel({ active: 'tab-b' }));
  const byId = attrs(payload);
  assert.equal(payload.schema, 'figma-render-interaction-payload/v1');
  assert.deepEqual(payload.switches, [{ id: 'switch', source: 'switch-direct-child', pageIds: ['page-a', 'page-b'], initialIndex: 1, initialEvidence: 'component-property-active-variant' }]);
  assert.equal(byId.get('switch')['data-switch-page-source'], 'switch-direct-child');
  assert.equal(byId.get('switch')['data-switch-index'], '1');
  assert.equal(byId.get('page-a')['data-switch-page'], '0');
  assert.equal(byId.get('page-b')['data-switch-page'], '1');
  assert.equal(byId.get('tab-a')['aria-selected'], 'false');
  assert.equal(byId.get('tab-b')['aria-selected'], 'true');
  assert.equal(byId.get('tab-b')['data-active'], 'true');
  assert.equal(byId.get('ind-b')['aria-selected'], 'true', 'all complete source control families mirror the validated initial page index');
});

test('preserves all legacy attributes while only promoting verified direct-child pages', () => {
  const model = sourceModel({ active: 'tab-a' });
  const payload = buildRendererInteractionPayload(model);
  const byId = attrs(payload);
  assert.equal(byId.get('prev')['data-switch-action'], 'prev');
  assert.equal(byId.get('next')['data-switch-action'], 'next');
  assert.equal(byId.get('prev')['data-switch-page'], undefined);
  assert.equal(byId.get('tab-a')['data-tab'], 'true');
  assert.equal(byId.get('ind-a')['data-indicator'], 'true');
});

test('leaves incomplete direct-child models inert', () => {
  const model = deriveInteractionModel([
    { id: 'section', type: 'FRAME', name: 'sec/one' },
    { id: 'switch', type: 'FRAME', name: 'switch/cards', parentId: 'section' },
    { id: 'page-a', type: 'FRAME', name: 'State A', parentId: 'switch' },
    { id: 'page-b', type: 'FRAME', name: 'State B', parentId: 'switch' },
    { id: 'tab-a', type: 'FRAME', name: 'tab/a', parentId: 'section' },
  ]);
  const payload = buildRendererInteractionPayload(model);
  const byId = attrs(payload);
  assert.equal(payload.switches.length, 0);
  assert.equal(byId.get('page-a')?.['data-switch-page'], undefined);
  assert.equal(byId.get('switch')?.['data-switch-owner'], undefined);
  assert.ok(payload.unresolved.some((entry) => entry.id === 'switch'));
});

test('leaves direct-child model without source-selected control inert', () => {
  const model = deriveInteractionModel([
    { id: 'section', type: 'FRAME', name: 'sec/one' },
    { id: 'switch', type: 'FRAME', name: 'switch/cards', parentId: 'section' },
    { id: 'page-a', type: 'FRAME', name: 'State A', parentId: 'switch', orderKey: [0] },
    { id: 'page-b', type: 'FRAME', name: 'State B', parentId: 'switch', orderKey: [1] },
  ]);
  const payload = buildRendererInteractionPayload(model);
  assert.equal(payload.switches.length, 0);
  assert.ok(payload.unresolved.some((entry) => entry.id === 'switch'));
  assert.equal(payload.attributes.some((entry) => entry.attrs['data-switch-page'] != null), false);
});
