import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRendererInteractionPayload } from '../lib/figma-render-interaction-adapter.mjs';
import { deriveInteractionModel } from '../lib/figma-interaction-contract.mjs';

const renderer = readFileSync(new URL('../../templates/figma-render.js', import.meta.url), 'utf8');

function payload() {
  return buildRendererInteractionPayload(deriveInteractionModel([
    { id: 'section', type: 'FRAME', name: 'sec/one' },
    { id: 'switch', type: 'FRAME', name: 'switch/cards', parentId: 'section' },
    { id: 'page-a', type: 'FRAME', name: 'State A', parentId: 'switch', orderKey: [0] },
    { id: 'page-b', type: 'FRAME', name: 'State B', parentId: 'switch', orderKey: [1] },
    { id: 'tab-a', type: 'FRAME', name: 'tab/a', parentId: 'section', componentProperties: { State: { value: 'normal' } } },
    { id: 'tab-b', type: 'FRAME', name: 'tab/b', parentId: 'section', componentProperties: { State: { value: 'active' } } },
    { id: 'ind-a', type: 'FRAME', name: 'ind/a', parentId: 'section', componentProperties: { State: { value: 'normal' } } },
    { id: 'ind-b', type: 'FRAME', name: 'ind/b', parentId: 'section', componentProperties: { State: { value: 'active' } } },
    { id: 'prev', type: 'FRAME', name: 'btn/prev', parentId: 'section' },
    { id: 'next', type: 'FRAME', name: 'btn/next', parentId: 'section' },
  ]));
}

test('renderer consumes pure direct-child interaction payload without raw switch classification', () => {
  assert.match(renderer, /ctx\.interactionPayload \|\| ctx\.renderInteractionPayload/);
  assert.match(renderer, /interactionPayload\.attributes/);
  assert.match(renderer, /interactionAttrs\.set\(id, \{ \.\.\.\(interactionAttrs\.get\(id\) \|\| \{\}\), \.\.\.attrs \}\)/);
  assert.match(renderer, /data-switch-page-source="switch-direct-child"/);
  assert.match(renderer, /applySwitch\(owner\.getAttribute\('data-switch'\), Number\(owner\.getAttribute\('data-switch-initial-index'\) \|\| 0\)\)/);
});

test('direct-child payload carries the runtime contract for initial state, clicks, and arrows', () => {
  const byId = new Map(payload().attributes.map((entry) => [entry.id, entry.attrs]));
  assert.equal(byId.get('switch')['data-switch-initial-index'], '1');
  assert.equal(byId.get('page-a')['data-switch-page'], '0');
  assert.equal(byId.get('page-b')['data-switch-page'], '1');
  assert.equal(byId.get('tab-b')['aria-selected'], 'true');
  assert.equal(byId.get('ind-b')['aria-selected'], 'true');
  assert.equal(byId.get('prev')['data-switch-action'], 'prev');
  assert.equal(byId.get('next')['data-switch-action'], 'next');
  assert.match(renderer, /el\.hidden = !active/);
  assert.match(renderer, /el\.setAttribute\('aria-selected', active \? 'true' : 'false'\)/);
  assert.match(renderer, /const next = action === 'prev' \? active - 1 : action === 'next' \? active \+ 1 : current/);
});

test('unresolved model does not emit a direct-child runtime bridge', () => {
  const unresolved = buildRendererInteractionPayload(deriveInteractionModel([
    { id: 'section', type: 'FRAME', name: 'sec/one' },
    { id: 'switch', type: 'FRAME', name: 'switch/cards', parentId: 'section' },
    { id: 'page-a', type: 'FRAME', name: 'State A', parentId: 'switch' },
    { id: 'page-b', type: 'FRAME', name: 'State B', parentId: 'switch' },
    { id: 'tab-a', type: 'FRAME', name: 'tab/a', parentId: 'section' },
  ]));
  assert.equal(unresolved.switches.length, 0);
  assert.ok(!unresolved.attributes.some((entry) => entry.attrs['data-switch-page'] != null));
});
