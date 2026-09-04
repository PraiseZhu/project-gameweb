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

test('Main static leaves page clicks inert until Interaction opts in', () => {
  assert.match(renderer, /enablePageInteraction === true/);
  assert.match(renderer, /data-page-interaction/);
  assert.match(renderer, /enablePageInteraction && !__motionCarouselOptIn && !frame\.__fxInteractionBridgeInstalled/);
  assert.match(renderer, /if \(!enablePageInteraction\) return;/);
  const shell = readFileSync(new URL('../../templates/demo-shell.html', import.meta.url), 'utf8');
  const chrome = readFileSync(new URL('../../templates/figma-chrome.js', import.meta.url), 'utf8');
  assert.doesNotMatch(shell, /if \(ctx && ctx\.enablePageInteraction == null\) ctx\.enablePageInteraction = true;/);
  const renderIntoAt = chrome.indexOf('function renderInto(container, state)');
  const nextFnAt = chrome.indexOf('\n  function ', renderIntoAt + 1);
  const renderInto = chrome.slice(renderIntoAt, nextFnAt > renderIntoAt ? nextFnAt : chrome.length);
  assert.match(renderInto, /enablePageInteraction: new URLSearchParams\(location\.search\)\.get\('interaction'\) === '1'/);
  assert.doesNotMatch(renderInto, /enablePageInteraction:\s*true/);
  const laterAxes = readFileSync(new URL('../lib/later-axes-probe.mjs', import.meta.url), 'utf8');
  assert.match(laterAxes, /index\.html\?inventory-static-gate=1&interaction=1/);
});

test('selected component tree keeps inner btn @go live', () => {
  const marker = "data-component-instance-mount-status', 'selected-component-tree'";
  const mountAt = renderer.lastIndexOf(marker);
  const paintAt = renderer.lastIndexOf('paint(owner.tree.nodes', mountAt);
  const paintCall = renderer.slice(paintAt, mountAt);
  assert.match(paintCall, /suppressInteractions:\s*false/);
  assert.doesNotMatch(paintCall, /suppressInteractions:\s*true/);
});

test('only language dropmenus consume inner btn as setPref lang', () => {
  assert.match(renderer, /isLanguageDropmenu/);
  assert.match(renderer, /\/多语言\|语言\|language\/i/);
  assert.match(renderer, /Region \/ other dropmenus keep @go \/ @link/);
  assert.match(renderer, /typeof frame\.__fxDropmenuCleanup === 'function'/);
  assert.match(renderer, /Keep the owner host visible/);
  assert.match(renderer, /Keep the COMPONENT root: Property 1=on carries the panel/);
  assert.match(renderer, /Hidden on-state trees keep data-asset-src without src/);
  assert.match(renderer, /frame\.__fxAssetScheduler\.prime\(target\)/);
  assert.match(renderer, /Open panel must sit above later sticky siblings/);
  assert.match(renderer, /owner\.style\.zIndex = '50'/);
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

test('named modal cover fill, scrim, and scroll lock follow DESIGN.md YAML', () => {
  assert.match(renderer, /modalViewportFill/);
  assert.match(renderer, /modalScrimOpacity/);
  assert.match(renderer, /data-modal-scrim/);
  assert.match(renderer, /data-modal-scroll-lock/);
  assert.match(renderer, /Math\.max\(visibleW \/ designW, visibleH \/ designH\)/);
  assert.doesNotMatch(renderer, /const scale = Math\.min\(visibleW \/ designW, visibleH \/ designH\);/);
});

test('named modal pin drops host zoom so Figma sheet is not scaled twice', () => {
  const pinAt = renderer.indexOf('const pinModalToViewport = (entry) =>');
  const unpinAt = renderer.indexOf('const unpinModalHost = (entry) =>');
  const closeAt = renderer.indexOf('const closeNamedModal = (entry) =>', pinAt);
  assert.ok(pinAt > 0 && unpinAt > 0 && closeAt > pinAt);
  const pin = renderer.slice(pinAt, closeAt);
  const unpin = renderer.slice(unpinAt, pinAt);
  assert.match(pin, /host\.style\.zoom = '1'/);
  assert.match(pin, /layer\.style\.zoom = '1'/);
  assert.match(pin, /frame\.style\.width/);
  assert.match(pin, /frame\.clientWidth/);
  assert.match(pin, /host\.style\.position = 'absolute'/);
  assert.doesNotMatch(pin, /frame\.style\.zoom/);
  assert.doesNotMatch(pin, /visibleW = frameRect\.width \/ \(pageZoom/);
  assert.doesNotMatch(pin, /const visibleW = frameRect\.width;/);
  assert.match(unpin, /host\.style\.zoom = String\(pageStageScale \|\| k\)/);
  assert.match(unpin, /host\.__fxNamedModalRest/);
  assert.doesNotMatch(unpin, /pageMeta\.height/);
  assert.match(renderer, /rgba\(0,0,0,' \+ opacity \+ '\)/);
  assert.match(renderer, /frame\.style\.overflowY = 'hidden'/);
});

test('opening a named modal closes every other open named modal first', () => {
  const openAt = renderer.indexOf('const openNamedModal = (entry) =>');
  const closeBtnAt = renderer.indexOf('const closeBtn = this._closeControlFromEvent(ev);', openAt);
  assert.ok(openAt > 0 && closeBtnAt > openAt);
  const open = renderer.slice(openAt, closeBtnAt);
  assert.match(open, /other\.layer\.getAttribute\('data-modal-open'\) === 'true'\) closeNamedModal\(other\)/);
  assert.doesNotMatch(open, /entry\.exclusive && other\.exclusive/);
  assert.doesNotMatch(renderer, /exclusive: parsed\.label !== '视频弹窗'/);
  assert.doesNotMatch(renderer, /exclusive: true/);
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
