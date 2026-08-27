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

test('renderer consumes @go modal names and fix/@from scroll-gated pin', () => {
  assert.match(renderer, /data-go/);
  assert.match(renderer, /data-fix-from/);
  assert.match(renderer, /syncFixFromOverlays/);
  assert.match(renderer, /modalKey/);
  assert.match(renderer, /name-param:@go|data-go/);
});

test('named modal runtime only wires openers listed in triggerFrom', () => {
  assert.match(renderer, /authorizedFrom/);
  assert.match(renderer, /modal.triggerFrom/);
  assert.match(renderer, /authorizedFrom\.has\(nodeId\)/);
  assert.match(renderer, /entry\.openerEls\.includes\(goHit\)/);
  assert.match(renderer, /entry\.openerEls\.includes\(openerHit\)/);
  assert.doesNotMatch(renderer, /entry\.name === wanted/);
  assert.doesNotMatch(renderer, /entry\.name === '视频弹窗' && name === '播放按钮'/);
});

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

test('left/right switch arrows are commands and do not wait on deferred assets', () => {
  assert.match(renderer, /data-switch-action/);
  assert.match(renderer, /const next = action === 'prev' \? active - 1 : action === 'next' \? active \+ 1 : current/);
  assert.match(renderer, /never leave prev\/next inert/);
  assert.match(renderer, /Owner index must/);
  assert.match(renderer, /btn-component-set/);
  assert.match(renderer, /getAttribute\('data-nav-item'\) !== 'true'/);
  assert.doesNotMatch(renderer, /source-file-swap/);
  assert.match(renderer, /多语言切换按钮/);
  assert.doesNotMatch(renderer, /ready\.then\(\(\) => applySwitch\(sid, idx, true\)\)/);
});

test('renderer loops applySwitch and keeps calendar/hscroll commands off native overflow', () => {
  assert.match(renderer, /data-switch-loop['"\]]+\s*=\s*'true'/);
  assert.match(renderer, /\(\(current % count\) \+ count\) % count/);
  assert.match(renderer, /data-hscroll-action/);
  assert.match(renderer, /data-calendar-now-state/);
  assert.match(renderer, /dyn-today-date-runtime-swap/);
  assert.match(renderer, /user-select:none/);
  assert.match(renderer, /overflowX = 'hidden'/);
  assert.match(renderer, /data-calendar-now-state="return-today"/);
  assert.match(renderer, /data-btn-press', 'inert'/);
  assert.doesNotMatch(renderer, /activity-calendar-reveal/);
  assert.doesNotMatch(renderer, /左滑\|前/);
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
