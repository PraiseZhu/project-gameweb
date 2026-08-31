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
  assert.match(renderer, /toggleDropmenu/);
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

test('dropmenu off/on fixtures stay pressable and do not reuse indicatorVariant', () => {
  const graph = {
    componentSetId: 'dropmenu-set',
    variants: [
      { componentId: 'menu-off', name: 'Property 1=off', interactions: [] },
      { componentId: 'menu-on', name: 'Property 1=on', interactions: [] },
    ],
  };
  const offModel = deriveInteractionModel([
    {
      id: 'menu-off',
      type: 'INSTANCE',
      name: 'dropmenu/语言',
      componentProperties: {
        'Property 1': { value: 'off', type: 'VARIANT' },
      },
      componentVariantGraph: graph,
    },
  ]);
  const onModel = deriveInteractionModel([
    {
      id: 'menu-on',
      type: 'INSTANCE',
      name: 'dropmenu/语言',
      componentProperties: {
        'Property 1': { value: 'on', type: 'VARIANT' },
      },
      componentVariantGraph: graph,
    },
  ]);
  const dropmenuOff = offModel.attributes.find((entry) => entry.id === 'menu-off')?.attrs;
  const dropmenuOn = onModel.attributes.find((entry) => entry.id === 'menu-on')?.attrs;
  assert.equal(dropmenuOff['data-dropmenu'], 'true');
  assert.equal(dropmenuOff['data-dropmenu-state'], 'off');
  assert.equal(dropmenuOff['data-btn-press'], 'true');
  assert.equal(dropmenuOn['data-dropmenu-state'], 'on');
  assert.equal(dropmenuOn['data-btn-press'], 'true');
  assert.match(renderer, /applyDropmenuVariant/);
  assert.match(renderer, /toggleDropmenu/);
  assert.match(renderer, /dropmenuLangFromSelfLabel/);
  assert.match(renderer, /DROPMENU_SELF_LABELS/);
  assert.match(renderer, /data-dropmenu-globe-hover/);
  assert.match(renderer, /closeDropmenuOutside/);
  assert.match(renderer, /'简体中文': 'zh-CN'/);
  assert.match(renderer, /'繁體中文': 'zh-TW'/);
  assert.match(renderer, /'English': 'en'/);
  assert.match(renderer, /'日本語': 'ja'/);
  assert.match(renderer, /'한국어': 'ko'/);
  assert.doesNotMatch(renderer, /'English': 'en-US'/);
  assert.doesNotMatch(renderer, /'日本語': 'ja-JP'/);
  assert.doesNotMatch(renderer, /'한국어': 'ko-KR'/);
  assert.match(renderer, /data-dropmenu-self-label/);
  assert.match(renderer, /applyDropmenuDynValue/);
  assert.match(renderer, /dropmenuOptionValue/);
  assert.match(renderer, /closeDropmenuOwners/);
  assert.doesNotMatch(renderer, /selfLabel: 'unresolved'/);
  assert.match(renderer, /dropmenuExactState/);
  assert.match(renderer, /dropmenuParsePairs/);
  assert.match(renderer, /dropmenuAxisName/);
  assert.match(renderer, /dropmenuVariantToken/);
  assert.match(renderer, /isDropmenuGlobeImg/);
  assert.match(renderer, /地球\|globe\|多语言icon/);
  assert.match(renderer, /\.filter\(isDropmenuGlobeImg\)/);
  assert.doesNotMatch(renderer, /split\('='\)\.pop\(\)/);
  assert.doesNotMatch(renderer, /for \(const globe of globes\)/);
  assert.doesNotMatch(renderer, /indicatorVariant\(n\) === 'on'/);
  assert.match(renderer, /On\/OFF\/true must fail-visible/);
  assert.match(renderer, /data-btn-name="多语言按钮"/);
  assert.doesNotMatch(renderer, /data-btn-name="多语言切换按钮"/);
});

test('dropmenu multi-axis k=v variants stay pressable and mountable', () => {
  const graph = {
    componentSetId: 'dropmenu-set',
    variants: [
      { componentId: 'menu-off-en', name: 'State=off, Lang=en', interactions: [] },
      { componentId: 'menu-on-en', name: 'State=on, Lang=en', interactions: [] },
    ],
  };
  const offModel = deriveInteractionModel([
    {
      id: 'menu-off-en',
      type: 'INSTANCE',
      name: 'dropmenu/语言',
      componentProperties: {
        State: { value: 'off', type: 'VARIANT' },
        Lang: { value: 'en', type: 'VARIANT' },
      },
      componentVariantGraph: graph,
    },
  ]);
  const dropmenuOff = offModel.attributes.find((entry) => entry.id === 'menu-off-en')?.attrs;
  assert.equal(dropmenuOff['data-dropmenu-state'], 'off');
  assert.equal(dropmenuOff['data-btn-press'], 'true');
  assert.equal(dropmenuOff['data-dropmenu-set'], 'dropmenu-set');
  assert.match(renderer, /unique \{on,off\} axis counts/);
  assert.match(renderer, /comma-separated k=v/);
});

test('paint-scope dropmenu helpers are defined before paint and execute for k=v names', () => {
  const paintIdx = renderer.indexOf('const paint = (list, rawList, container, options = {}) => {');
  const parseIdx = renderer.indexOf('const dropmenuParsePairs = (name) => {');
  const axisIdx = renderer.indexOf('const dropmenuAxisName = (variants, nameOf) => {');
  const tokensIdx = renderer.indexOf('const dropmenuOnOffTokens = (variants, nameOf) => Boolean(dropmenuAxisName(variants, nameOf));');
  const variantIdx = renderer.indexOf('const dropmenuVariantToken = (name, axis) => {');
  const bridgeIdx = renderer.indexOf('const interactionBridge = (items) => {');
  assert.ok(parseIdx > 0 && parseIdx < bridgeIdx && parseIdx < paintIdx);
  assert.ok(axisIdx > parseIdx && axisIdx < bridgeIdx && axisIdx < paintIdx);
  assert.ok(tokensIdx > axisIdx && tokensIdx < bridgeIdx && tokensIdx < paintIdx);
  assert.ok(variantIdx > tokensIdx && variantIdx < bridgeIdx && variantIdx < paintIdx);
  const start = renderer.indexOf('/* dropmenu open/close is exact lowercase on/off only.');
  const end = renderer.indexOf('/* Main Skill interaction bridge:');
  assert.ok(start > 0 && end > start);
  const helpers = renderer.slice(start, end)
    .replaceAll('__u', '((v) => (v && typeof v === "object" && "value" in v ? v.value : v))')
    .replaceAll('attachPlatformVariantGraph', '((n) => n)')
    .replaceAll('__plain', '((v) => v)');
  const fn = new Function(`${helpers}; return { dropmenuParsePairs, dropmenuAxisName, dropmenuOnOffTokens, dropmenuVariantToken, dropmenuExactState };`);
  const api = fn();
  const variants = [
    { name: 'State=off, Lang=en' },
    { name: 'State=on, Lang=en' },
  ];
  const nameOf = (variant) => variant.name;
  assert.equal(api.dropmenuParsePairs('State=off, Lang=en').State, 'off');
  assert.equal(api.dropmenuParsePairs('State=off, Lang=en').Lang, 'en');
  assert.equal(api.dropmenuAxisName(variants, nameOf), 'State');
  assert.equal(api.dropmenuOnOffTokens(variants, nameOf), true);
  assert.equal(api.dropmenuVariantToken('State=off, Lang=en', 'State'), 'off');
  assert.equal(api.dropmenuExactState({
    componentProperties: { State: { value: 'off' }, Lang: { value: 'en' } },
    componentVariantGraph: { variants },
  }), 'off');
});

test('dropmenu option value prefers visible copy and extracts region codes', () => {
  const start = renderer.indexOf('const dropmenuOptionValue = (btn) => {');
  const end = renderer.indexOf('const applyDropmenuDynValue = (owner, value) => {');
  assert.ok(start > 0 && end > start);
  const fn = new Function(`${renderer.slice(start, end)}; return dropmenuOptionValue;`);
  const dropmenuOptionValue = fn();
  assert.equal(dropmenuOptionValue({
    getAttribute: (name) => (name === 'data-btn-name' ? '台湾' : ''),
    textContent: '台灣+886',
  }), '+886');
  assert.equal(dropmenuOptionValue({
    getAttribute: () => '',
    textContent: '简体中文',
  }), '简体中文');
  assert.equal(dropmenuOptionValue({
    getAttribute: () => '',
    textContent: '1+2',
  }), '1+2');
  assert.equal(dropmenuOptionValue({
    getAttribute: () => '',
    textContent: '+886',
  }), '+886');
});

test('dropmenu language click prefers visible copy over btn name', () => {
  assert.match(renderer, /Visible copy decides/);
  assert.match(renderer, /dropmenuLangFromSelfLabel\(visible \|\| named\)/);
  assert.doesNotMatch(renderer, /dropmenuLangFromSelfLabel\(visible\) \|\| dropmenuLangFromSelfLabel\(named\)/);
  assert.doesNotMatch(renderer, /innerBtn\.getAttribute\('data-btn-name'\)\s*\|\|\s*innerBtn\.textContent/);
});

test('applyDropmenuDynValue finds dyn hosts by layer name when data-prefix is missing', () => {
  const start = renderer.indexOf('const isDropmenuDynHost = (el) => {');
  const end = renderer.indexOf('const closeDropmenuOwners = (root) => {');
  assert.ok(start > 0 && end > start);
  const fn = new Function(`${renderer.slice(start, end)}; return { isDropmenuDynHost, applyDropmenuDynValue };`);
  const api = fn();
  const txt = {
    nodeType: 1,
    matches: (sel) => String(sel).includes('[data-figma-type="TEXT"]') || String(sel).includes('[data-owner-role="txt"]'),
    textContent: '+886',
    getAttribute: (name) => (name === 'data-figma-type' ? 'TEXT' : ''),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const host = {
    nodeType: 1,
    matches: () => false,
    getAttribute: (name) => (name === 'data-name' ? 'dyn/当前区号' : ''),
    querySelector: (sel) => (String(sel).includes('TEXT') || String(sel).includes('txt') ? txt : null),
    querySelectorAll: () => [],
  };
  const owner = {
    nodeType: 1,
    __fxDropmenuLayers: [],
    attrs: {},
    matches: () => false,
    getAttribute: () => '',
    setAttribute(key, value) { this.attrs[key] = value; },
    removeAttribute(key) { delete this.attrs[key]; },
    querySelector: () => null,
    querySelectorAll: (sel) => (String(sel).includes('[data-name]') || String(sel).includes('[data-prefix]') ? [host] : []),
  };
  assert.equal(api.isDropmenuDynHost(host), true);
  assert.equal(api.applyDropmenuDynValue(owner, '+852'), true);
  assert.equal(txt.textContent, '+852');
  assert.equal(owner.attrs['data-dropmenu-option-value'], '+852');
  assert.equal(owner.attrs['data-dropmenu-dyn-miss'], undefined);
});

test('product-view dropmenu language writes chrome S.prefs, not the renderPrefs copy', () => {
  const chrome = readFileSync(new URL('../../templates/figma-chrome.js', import.meta.url), 'utf8');
  assert.match(chrome, /prefs: renderPrefs/);
  assert.match(chrome, /function cp\(o\)/);
  assert.match(chrome, /setPref: applyPref/);
  assert.match(chrome, /function applyPref\(key, value\)/);
  assert.match(chrome, /S\.prefs\[key\] = value/);
  assert.match(chrome, /persist\(\);\s*syncAll\(\)/);
  assert.match(chrome, /if \(!PRODUCT_VIEW\) window\.__qa =/);
  assert.match(renderer, /typeof ctx\.setPref === 'function'/);
  assert.match(renderer, /typeof setPref !== 'function'\) return false/);
  assert.doesNotMatch(renderer, /ctx\.prefs\.lang = lang/);
  assert.match(renderer, /if \(!applyDropmenuLang\(lang\)\)/);
  assert.match(renderer, /selfLabel: 'no-pref-handle'/);
  assert.match(renderer, /if \(!axis\) return 'invalid'/);
  assert.match(renderer, /source-on instance still lands off/);
  assert.match(renderer, /closeDropmenuOwners\(frame\)/);
  assert.match(renderer, /applyDropmenuDynValue\(dropmenuOwner, dropmenuOptionValue\(innerBtn\)\)/);
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
