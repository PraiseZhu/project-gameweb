/**
 * GPT-6 FAIL 锁（无浏览器）：勾选统一缩放、地区菜单一次缩放、选完必须 off、
 * PC dropmenu 保持清单 on/off、嵌套 @go、LINE 不 invent。
 * brace-match + new Function 抽出 renderer 真函数再喂输入，禁止 t.skip。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveInteractionModel } from '../lib/figma-interaction-contract.mjs';
import { classifyModalTriggers } from '../lib/figma-inventory-v2.mjs';

const rendererSrc = readFileSync(new URL('../../templates/figma-render.js', import.meta.url), 'utf8');

function closeBrace(src, brace) {
  assert.equal(src[brace], '{', `expected '{' at ${brace}`);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  assert.fail(`unclosed brace after ${src.slice(brace, brace + 48)}`);
}

function extractBrace(src, start) {
  const paren = src.indexOf('(', start);
  const brace = src.indexOf('{', paren >= start ? paren : start);
  assert.ok(brace >= 0, `no brace after ${src.slice(start, start + 48)}`);
  const end = closeBrace(src, brace);
  const headerEnd = src.lastIndexOf(')', brace);
  return {
    params: headerEnd > start ? src.slice(src.indexOf('(', start) + 1, headerEnd).trim() : '',
    body: src.slice(brace + 1, end),
    end,
  };
}

function extractObjectLiteral(src, brace) {
  const end = closeBrace(src, brace);
  return { body: src.slice(brace + 1, end), end };
}

function extendToBalanced(src, start, minEnd) {
  let depth = 0;
  let seen = false;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') {
      depth++;
      seen = true;
    } else if (src[i] === '}') depth--;
    if (i >= minEnd - 1 && seen && depth <= 0) return i + 1;
  }
  return minEnd;
}

function extractNamed(src, needle) {
  const start = src.indexOf(needle);
  assert.ok(start >= 0, `missing ${needle}`);
  return { start, ...extractBrace(src, start) };
}

function compileMethod(src, needle) {
  const extracted = extractNamed(src, needle);
  assert.equal(/\bthis\./.test(extracted.body), false, `${needle} unexpectedly uses this.`);
  return new Function(extracted.params, extracted.body);
}

function compileThisMethod(src, needle) {
  const extracted = extractNamed(src, needle);
  return new Function(`return function (${extracted.params}) {\n${extracted.body}\n}`);
}

function compileOwnerSliceHelpers() {
  const geomReady = compileThisMethod(rendererSrc, '_geomReady(box)');
  const sameSpace = compileThisMethod(rendererSrc, '_sameCoordinateSpace(a, b, limit = 8000)');
  const sameGeom = compileThisMethod(rendererSrc, '_sameGeom(a, b, slop = 0.5)');
  const pixelSize = compileThisMethod(rendererSrc, '_pixelSizeOf(assetRec)');
  const pngMatches = compileThisMethod(rendererSrc, '_pngMatchesBox(assetRec, box)');
  const spills = compileThisMethod(rendererSrc, '_boxSpillsOwner(ink, ownerBox)');
  const ownerSlice = compileThisMethod(rendererSrc, '_ownerSliceBox(assetRec, ownerBox, renderBox, extraBox = null, sliceExportBox = null)');
  const self = {};
  self._geomReady = geomReady().bind(self);
  self._sameCoordinateSpace = sameSpace().bind(self);
  self._sameGeom = sameGeom().bind(self);
  self._pixelSizeOf = pixelSize().bind(self);
  self._pngMatchesBox = pngMatches().bind(self);
  self._boxSpillsOwner = spills().bind(self);
  self._ownerSliceBox = ownerSlice().bind(self);
  return self;
}

function makeEl(attrs = {}) {
  const store = { ...attrs };
  const style = {};
  const el = {
    style,
    setAttribute(key, value) { store[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    removeAttribute(key) { delete store[key]; },
    contains(node) { return node === el; },
  };
  return el;
}

function regionGraph() {
  return {
    componentSetId: 'region-set',
    variants: [
      { componentId: 'menu-off', name: 'Property 1=off', interactions: [] },
      { componentId: 'menu-on', name: 'Property 1=on', interactions: [] },
    ],
  };
}

const isUniformInstanceScale = compileMethod(rendererSrc, '_isUniformInstanceScale(ownerBox, rootBox)');
const cssGradient = compileMethod(rendererSrc, '_cssGradient(fill)');
const unrotatedTextLayout = compileMethod(rendererSrc, '_unrotatedTextLayout(n, aabbW, aabbH)');
const sourceLineStroke = (() => {
  const extracted = extractNamed(rendererSrc, '_sourceLineStroke(st)');
  const body = extracted.body.replace(/this\._cssGradient/g, 'cssGradient');
  return new Function('cssGradient', `return function (${extracted.params}) {\n${body}\n}`)(cssGradient);
})();

function btnMountDecision(ownerWidth, ownerHeight, rootBox, root, wantedId = '949:5746') {
  const start = rendererSrc.indexOf('const btnScale = this._isUniformInstanceScale(');
  assert.ok(start >= 0, 'btnScale assignment');
  const scaleSet = "if (btnUniformScale) owner.el.setAttribute('data-btn-variant-scale', String(btnScaleRatio));";
  const end = rendererSrc.indexOf(scaleSet, start);
  assert.ok(end > start, 'btnUniformScale scale attr');
  const snippet = rendererSrc.slice(start, end + scaleSet.length)
    .replace(/this\._isUniformInstanceScale/g, 'isUniformInstanceScale')
    .replace(/\n\s*break;/, '\n            return pack(true);');
  const el = makeEl();
  const run = new Function(
    'isUniformInstanceScale',
    'ownerWidth',
    'ownerHeight',
    'rootBox',
    'root',
    'wantedId',
    'el',
    `
      const owner = { el };
      let mountBlocked = false;
      const pack = (blocked) => ({
        blocked,
        status: el.getAttribute('data-btn-variant-mount-status'),
        scale: el.getAttribute('data-btn-variant-scale'),
        btnUniformScale,
        btnScale,
      });
      ${snippet}
      return pack(mountBlocked);
    `,
  );
  return run(isUniformInstanceScale, ownerWidth, ownerHeight, rootBox, root, wantedId, el);
}

function applyFitToBox(fitToBox, box) {
  const methodStart = rendererSrc.indexOf('_mountOwnerSliceImg(');
  const start = rendererSrc.indexOf('if (fitToBox) {', methodStart);
  assert.ok(start >= 0, 'fitToBox branch');
  const extracted = extractBrace(rendererSrc, start);
  const img = { style: {} };
  const el = makeEl();
  const body = extracted.body.replace(/\breturn;/, '/* fitToBox applied */');
  const run = new Function('fitToBox', 'img', 'box', 'el', `
    if (fitToBox) {
      ${body}
    }
    return {
      resolved: el.getAttribute('data-asset-bounds-resolved'),
      width: img.style.width,
      height: img.style.height,
      objectFit: img.style.objectFit,
    };
  `);
  return run(fitToBox, img, box, el);
}

function checkboxMountFitToBox(btnUniformScale) {
  const start = rendererSrc.indexOf('this._mountOwnerSliceImg(owner.el, variantSliceFile, mountBox, mountBox, {');
  assert.ok(start >= 0, 'checkbox _mountOwnerSliceImg call');
  const brace = rendererSrc.indexOf('{', start + 'this._mountOwnerSliceImg'.length);
  const extracted = extractObjectLiteral(rendererSrc, brace);
  const run = new Function('btnUniformScale', 'root', 'owner', `return { ${extracted.body} };`);
  return run(btnUniformScale, { name: 'btn/勾选按钮' }, { el: makeEl({ 'data-name': 'btn/勾选按钮' }) });
}

const DROPMENU_CLONE_WIDTH_ASSIGN =
  "layer.style.width = (uniformScale ? Number(rootBox.w) : '100%') + (uniformScale ? 'px' : '')";
const DROPMENU_CLONE_TRANSFORM_ASSIGN =
  "layer.style.transform = 'scale(' + instanceScale + ')'";

function extractDropmenuCloneLayout() {
  const ratioStart = rendererSrc.indexOf('const widthRatio = Number.isFinite(ownerWidth) && ownerWidth > 0 && Number.isFinite(rootW) && rootW > 0');
  assert.ok(ratioStart >= 0, 'dropmenu widthRatio');
  const uniformLine = rendererSrc.indexOf('const uniformScale = Number.isFinite(widthRatio) && widthRatio > 0.2 && widthRatio < 5', ratioStart);
  assert.ok(uniformLine > ratioStart, 'dropmenu uniformScale');
  const instanceLine = rendererSrc.indexOf('const instanceScale = Number.isFinite(widthRatio) && widthRatio > 0 ? widthRatio : 1;', uniformLine);
  assert.ok(instanceLine > uniformLine, 'dropmenu instanceScale');
  const paintedLine = rendererSrc.indexOf('const paintedH = Number(rootBox.h) * instanceScale;', instanceLine);
  const layoutStart = rendererSrc.indexOf("layer.style.width = (uniformScale ? Number(rootBox.w) : '100%')", paintedLine);
  assert.ok(layoutStart > paintedLine, 'dropmenu clone width');
  const transformLine = rendererSrc.indexOf("layer.style.transform = 'scale(' + instanceScale + ')';", layoutStart);
  const layoutEnd = rendererSrc.indexOf('}', transformLine) + 1;
  const ratioSnippet = rendererSrc.slice(ratioStart, rendererSrc.indexOf(';', uniformLine) + 1);
  const instanceSnippet = rendererSrc.slice(instanceLine, rendererSrc.indexOf(';', paintedLine) + 1);
  const layoutSnippet = rendererSrc.slice(layoutStart, layoutEnd);
  assert.ok(layoutSnippet.includes(DROPMENU_CLONE_WIDTH_ASSIGN), 'extracted layout missing width assign');
  assert.ok(layoutSnippet.includes(DROPMENU_CLONE_TRANSFORM_ASSIGN), 'extracted layout missing transform scale');
  return { ratioSnippet, instanceSnippet, layoutSnippet };
}

function dropmenuCloneLayout({ ownerWidth, rootW, rootH, forceWidthPercent = false }) {
  const { ratioSnippet, instanceSnippet, layoutSnippet } = extractDropmenuCloneLayout();
  /* Negative lock: keep the renderer transform `if (uniformScale) scale(...)`,
     but force only the width assignment onto the non-uniform `'100%'` branch. */
  const layoutForRun = forceWidthPercent
    ? layoutSnippet.replace(
      DROPMENU_CLONE_WIDTH_ASSIGN,
      DROPMENU_CLONE_WIDTH_ASSIGN.replace(/uniformScale/g, 'false'),
    )
    : layoutSnippet;
  assert.equal(layoutForRun.includes(DROPMENU_CLONE_WIDTH_ASSIGN), !forceWidthPercent);
  if (forceWidthPercent) {
    assert.ok(layoutForRun.includes("layer.style.width = (false ? Number(rootBox.w) : '100%')"));
    assert.ok(layoutForRun.includes(DROPMENU_CLONE_TRANSFORM_ASSIGN));
    assert.match(layoutForRun, /if \(uniformScale\) \{/);
  }
  const run = new Function('ownerWidth', 'rootW', 'rootBox', `
    ${ratioSnippet}
    ${instanceSnippet}
    const layer = { style: {} };
    ${layoutForRun}
    return { widthRatio, uniformScale, instanceScale, paintedH, style: layer.style, rootBox };
  `);
  return { ...run(ownerWidth, rootW, { w: rootW, h: rootH }), layoutSnippet };
}

function cloneVisualBox(style, hostW) {
  const scale = Number((/scale\(([^)]+)\)/.exec(style.transform || '') || [null, 1])[1]);
  const rawW = String(style.width || '');
  const layerW = rawW === '100%' ? hostW : parseFloat(rawW);
  const layerH = parseFloat(style.height);
  return {
    layerW,
    layerH,
    scale: Number.isFinite(scale) ? scale : 1,
    visualW: layerW * (Number.isFinite(scale) ? scale : 1),
    visualH: layerH * (Number.isFinite(scale) ? scale : 1),
    overflow: style.overflow,
  };
}

function dropmenuClickDecision(scenario) {
  const start = rendererSrc.indexOf('const innerBtn = ev.target && ev.target.closest ? ev.target.closest(\'[data-prefix="btn"], [data-btn-name]\') : null;');
  assert.ok(start >= 0, 'dropmenu click innerBtn');
  const toggleAt = rendererSrc.indexOf('toggleDropmenu(dropmenuOwner);', start);
  const returnAt = rendererSrc.indexOf('return;', toggleAt);
  const snippet = rendererSrc.slice(start, extendToBalanced(rendererSrc, start, returnAt + 'return;'.length));
  const calls = [];
  const innerBtn = scenario.innerBtn
    ? {
      textContent: scenario.label || '',
      getAttribute() { return ''; },
    }
    : null;
  const owner = {
    contains(node) { return Boolean(scenario.containsInner && node && node === innerBtn); },
    getAttribute(key) {
      if (key === 'data-dropmenu-state') return scenario.state;
      if (key === 'data-dropmenu-mount-status') return 'owner-local-mutually-exclusive';
      return null;
    },
  };
  const ev = {
    target: {
      closest(sel) {
        if (String(sel).includes('data-prefix="btn"')) return innerBtn;
        if (String(sel).includes('data-dropmenu="true"')) return owner;
        return null;
      },
    },
    preventDefault() { calls.push('preventDefault'); },
    stopPropagation() { calls.push('stopPropagation'); },
  };
  const run = new Function(
    'ev',
    'frame',
    'isLanguageDropmenu',
    'dropmenuLangFromSelfLabel',
    'applyDropmenuLang',
    'closeDropmenuOwners',
    'toggleDropmenu',
    `${snippet}\nreturn { clickedOpenOption, dropmenuOwner };`,
  );
  const result = run(
    ev,
    {},
    () => false,
    () => null,
    () => { calls.push('applyDropmenuLang'); },
    () => { calls.push('closeDropmenuOwners'); },
    () => { calls.push('toggleDropmenu'); },
  );
  return { calls, result };
}

function nextDropmenuState(state, calls) {
  let next = state;
  for (const call of calls) {
    if (call === 'closeDropmenuOwners') next = 'off';
    else if (call === 'toggleDropmenu') next = next === 'on' ? 'off' : 'on';
  }
  return next;
}

function applyDropmenuHostHeight(nextState, fieldH, rootH) {
  const start = rendererSrc.indexOf('const nextH = next.state === \'on\' ? Number(next.rootH) : fieldH;');
  assert.ok(start >= 0, 'applyDropmenuVariant nextH');
  const end = rendererSrc.indexOf("owner.setAttribute('data-dropmenu-host-height', next.state === 'on' ? 'open-variant-root' : 'closed-field');", start);
  assert.ok(end > start, 'applyDropmenuVariant host-height');
  const lineEnd = rendererSrc.indexOf('\n', end);
  const fieldLine = rendererSrc.lastIndexOf('const fieldH = Number(owner.__fxDropmenuFieldH);', start);
  const snippet = rendererSrc.slice(fieldLine, extendToBalanced(rendererSrc, fieldLine, lineEnd));
  const owner = makeEl();
  owner.__fxDropmenuFieldH = fieldH;
  const run = new Function('owner', 'next', `
    ${snippet}
    return {
      height: owner.style.height,
      host: owner.getAttribute('data-dropmenu-host-height'),
    };
  `);
  return run(owner, { state: nextState, rootH });
}

function initialDropmenuHostHeight(state, paintedH, fieldH) {
  const start = rendererSrc.indexOf("const initialH = state === 'on' ? paintedH : fieldH;");
  assert.ok(start >= 0, 'initialH');
  const fieldLine = rendererSrc.lastIndexOf('const fieldH = Number(owner.el.__fxDropmenuFieldH);', start);
  const end = rendererSrc.indexOf("owner.el.setAttribute('data-dropmenu-host-height', 'variant-root');", start);
  const lineEnd = rendererSrc.indexOf('\n', end);
  const snippet = rendererSrc.slice(fieldLine, extendToBalanced(rendererSrc, fieldLine, lineEnd));
  const el = makeEl();
  el.__fxDropmenuFieldH = fieldH;
  const run = new Function('owner', 'state', 'paintedH', `
    ${snippet}
    return {
      height: owner.el.style.height,
      host: owner.el.getAttribute('data-dropmenu-host-height'),
    };
  `);
  return run({ el }, state, paintedH);
}

function dropmenuExactStateFromRenderer() {
  const start = rendererSrc.indexOf('const dropmenuParsePairs = (name) => {');
  assert.ok(start >= 0, 'dropmenuParsePairs');
  const end = rendererSrc.indexOf('/* Main Skill interaction bridge:', start);
  assert.ok(end > start, 'dropmenu helper cluster');
  const block = rendererSrc.slice(start, end);
  const factory = new Function('__u', 'attachPlatformVariantGraph', `${block}\nreturn dropmenuExactState;`);
  const unwrap = (value) => (value && typeof value === 'object' && 'value' in value ? value.value : value);
  return factory(unwrap, (node) => node);
}

function parseAndAssignGo(node) {
  const parseStart = rendererSrc.indexOf('const parse = (n) => {');
  assert.ok(parseStart >= 0, 'interaction parse');
  const parsed = extractBrace(rendererSrc, parseStart);
  const goAt = rendererSrc.indexOf("if (p.params.go) attrs['data-go'] = String(p.params.go);");
  assert.ok(goAt >= 0, 'data-go assignment');
  const goLine = rendererSrc.slice(goAt, rendererSrc.indexOf('\n', goAt));
  const run = new Function('value', `
    return function parseAndGo(n) {
      const parse = (n) => { ${parsed.body} };
      const p = parse(n);
      const attrs = {};
      ${goLine}
      return { p, attrs };
    };
  `);
  const value = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
  return run(value)(node);
}

function openNamedModalFromRenderer(namedModals) {
  const start = rendererSrc.indexOf('const openNamedModal = (entry) => {');
  assert.ok(start >= 0, 'openNamedModal');
  const extracted = extractBrace(rendererSrc, start);
  const closed = [];
  const closeNamedModal = (entry) => {
    closed.push(entry && entry.name);
    if (entry && entry.layer) entry.layer.removeAttribute('data-modal-open');
  };
  const openNamedModal = new Function(
    'namedModals',
    'closeNamedModal',
    'hideInPlace',
    'pinModalToViewport',
    'modalPolicy',
    'lockNamedModalScroll',
    'frame',
    'entry',
    extracted.body,
  );
  const bound = (entry) => openNamedModal(
    namedModals,
    closeNamedModal,
    () => {},
    () => {},
    () => ({ lock: false }),
    () => {},
    {},
    entry,
  );
  return { open: bound, closed };
}

function runOpenerScan({ wired, openers = [], frameGo = [], hostGo = [] }) {
  const start = rendererSrc.indexOf('const goScan = [');
  assert.ok(start >= 0, 'goScan after modal paint');
  const end = rendererSrc.indexOf('frame.__fxNamedModals = wired;', start);
  assert.ok(end > start, 'goScan must finish before __fxNamedModals');
  const snippet = rendererSrc.slice(start, end);
  assert.doesNotMatch(snippet, /layer\.contains\(el\)/);
  assert.match(snippet, /authorizedFrom\.has\(nodeId\)/);
  assert.doesNotMatch(snippet, /name === wantedGo/);
  const frame = { querySelectorAll(sel) { return String(sel).includes('[data-go]') ? frameGo : []; } };
  const host = { querySelectorAll(sel) { return String(sel).includes('[data-go]') ? hostGo : []; } };
  new Function('openers', 'frame', 'host', 'wired', snippet)(openers, frame, host, wired);
  return wired;
}

function resolveGoHit(namedModals, goHit) {
  const start = rendererSrc.indexOf("const goHit = ev.target && ev.target.closest ? ev.target.closest('[data-go]') : null;");
  assert.ok(start >= 0, 'goHit');
  const opened = [];
  const ev = {
    target: { closest(sel) { return String(sel).includes('[data-go]') ? goHit : null; } },
    preventDefault() {},
    stopPropagation() {},
  };
  const snippetStart = start;
  const returnAt = rendererSrc.indexOf('return;', rendererSrc.indexOf('openNamedModal(modal);', start));
  const snippet = rendererSrc.slice(snippetStart, extendToBalanced(rendererSrc, snippetStart, returnAt + 'return;'.length));
  const run = new Function('ev', 'namedModals', 'openNamedModal', `${snippet}\nreturn null;`);
  run(ev, namedModals, (entry) => { opened.push(entry && entry.name); });
  return opened;
}

function applySourceLine(st, extras = {}) {
  const start = rendererSrc.indexOf('const lineStroke = this._sourceLineStroke(st);');
  assert.ok(start >= 0, 'lineStroke');
  const colorIf = rendererSrc.indexOf('} else if (lineStroke.color) {', start);
  const colorBrace = extractBrace(rendererSrc, colorIf);
  const snippet = rendererSrc.slice(start, colorBrace.end + 1)
    .replace(/this\._sourceLineStroke/g, 'sourceLineStroke')
    .replace(/this\._rgba/g, 'rgba');
  const el = makeEl();
  const rgbaCalls = [];
  const n = extras.n || { pageBox: { y: 0, h: 0 }, renderBox: extras.renderBox || { y: 0, h: 0 }, strokeAlign: extras.strokeAlign };
  const box = extras.box || { y: 0 };
  const originY = extras.originY || 0;
  const run = new Function('sourceLineStroke', 'st', 'el', 'rgba', 'n', 'box', 'originY', snippet + '\nreturn el;');
  run(sourceLineStroke, st, el, (color) => {
    rgbaCalls.push(color);
    return 'INVENTED';
  }, n, box, originY);
  return { el, rgbaCalls };
}

test('A 勾选统一缩放：30×25 vs 46.42×38.73 过闸，30×10 aspect-mismatch 必须 block', () => {
  const master = { w: 46.42, h: 38.73 };
  const uniform = isUniformInstanceScale({ w: 30, h: 25 }, master);
  assert.equal(uniform.ok, true, JSON.stringify(uniform));
  assert.ok(Math.abs(uniform.widthRatio - 0.646) < 0.01, JSON.stringify(uniform));
  const squashed = isUniformInstanceScale({ w: 30, h: 10 }, master);
  assert.equal(squashed.ok, false, '只宽比接近、高比差很多，不得当统一缩放');
  assert.equal(squashed.reason, 'aspect-mismatch');

  const root = { id: '949:5746', type: 'COMPONENT' };
  const mounted = btnMountDecision(30, 25, master, root);
  assert.equal(mounted.blocked, false, JSON.stringify(mounted));
  assert.notEqual(mounted.status, 'blocked-owner-extent-mismatch');
  assert.equal(mounted.btnUniformScale, true);
  const mountOpts = checkboxMountFitToBox(mounted.btnUniformScale);
  assert.equal(mountOpts.fitToBox, true, JSON.stringify(mountOpts));
  const fitted = applyFitToBox(mountOpts.fitToBox, { w: 30, h: 25 });
  assert.equal(fitted.resolved, 'instance-uniform-scale-fill');
  assert.equal(fitted.width, '30px');
  assert.equal(fitted.height, '25px');
  assert.equal(fitted.objectFit, 'fill');

  const blocked = btnMountDecision(30, 10, master, root);
  assert.equal(blocked.blocked, true, JSON.stringify(blocked));
  assert.equal(blocked.status, 'blocked-owner-extent-mismatch');
  assert.equal(blocked.btnUniformScale, false);
  const blockedOpts = checkboxMountFitToBox(blocked.btnUniformScale);
  assert.equal(blockedOpts.fitToBox, false, JSON.stringify(blockedOpts));
  const notFitted = applyFitToBox(blockedOpts.fitToBox, { w: 30, h: 10 });
  assert.notEqual(notFitted.resolved, 'instance-uniform-scale-fill');
});

test('B 手机 949:6505 展开 clone 只缩一次；width=100% 再 scale 必须红', () => {
  const ownerW = 95;
  const rootW = 151;
  const rootH = 294.545;
  const layout = dropmenuCloneLayout({ ownerWidth: ownerW, rootW, rootH });
  assert.equal(layout.uniformScale, true, JSON.stringify(layout));
  assert.equal(parseFloat(layout.style.width), rootW);
  assert.equal(parseFloat(layout.style.height), rootH);
  assert.equal(layout.style.overflow, 'hidden');
  const once = cloneVisualBox(layout.style, ownerW);
  assert.ok(Math.abs(once.visualW - ownerW) < 1e-6, JSON.stringify(once));
  assert.ok(Math.abs(once.visualH - rootH * (ownerW / rootW)) < 1e-6, JSON.stringify(once));
  assert.ok(layout.layoutSnippet.includes("layer.style.width = (uniformScale ? Number(rootBox.w) : '100%')"));
  assert.ok(layout.layoutSnippet.includes("layer.style.transform = 'scale(' + instanceScale + ')'"));

  const twiceLayout = dropmenuCloneLayout({ ownerWidth: ownerW, rootW, rootH, forceWidthPercent: true });
  assert.equal(twiceLayout.uniformScale, true, JSON.stringify(twiceLayout));
  assert.equal(twiceLayout.style.width, '100%', JSON.stringify(twiceLayout.style));
  assert.equal(twiceLayout.style.transform, `scale(${ownerW / rootW})`, JSON.stringify(twiceLayout.style));
  const twice = cloneVisualBox(twiceLayout.style, ownerW);
  assert.ok(twice.visualW < ownerW - 1, `二次缩放可视宽 ${twice.visualW} 必须 < ownerW ${ownerW}`);
  const doubleScaleWouldPass = Math.abs(twice.visualW - ownerW) < 0.5;
  assert.equal(doubleScaleWouldPass, false, 'width=100% 再 scale 不得当成一次缩放过闸');
});

test('C 点选项后必须 off；close 后再 toggle 的回归路径必须被禁止', () => {
  const table = [
    { name: 'on + 点选项', state: 'on', innerBtn: true, containsInner: true, expectCalls: ['closeDropmenuOwners'], expectNext: 'off', expectToggle: false },
    { name: 'on + 点宿主非选项', state: 'on', innerBtn: false, containsInner: false, expectCalls: ['toggleDropmenu'], expectNext: 'off', expectToggle: true },
    { name: 'off + 点宿主', state: 'off', innerBtn: false, containsInner: false, expectCalls: ['toggleDropmenu'], expectNext: 'on', expectToggle: true },
  ];
  for (const row of table) {
    const { calls, result } = dropmenuClickDecision(row);
    const next = nextDropmenuState(row.state, calls);
    assert.deepEqual(calls.filter((item) => item === 'closeDropmenuOwners' || item === 'toggleDropmenu'), row.expectCalls, row.name);
    assert.equal(next, row.expectNext, `${row.name} next=${next}`);
    assert.equal(calls.includes('toggleDropmenu'), row.expectToggle, row.name);
    if (row.innerBtn && row.containsInner && row.state === 'on') {
      assert.equal(result.clickedOpenOption, true, row.name);
    }
  }

  const forbiddenNext = nextDropmenuState('on', ['closeDropmenuOwners', 'toggleDropmenu']);
  assert.equal(forbiddenNext, 'on', 'close 后再 toggle 会停在 on，这条路径必须存在于失败回归');
  const optionClick = dropmenuClickDecision({ state: 'on', innerBtn: true, containsInner: true });
  assert.equal(optionClick.calls.includes('toggleDropmenu'), false, '实现禁止 close 后再 toggle');
  assert.equal(nextDropmenuState('on', optionClick.calls), 'off');

  const closed = applyDropmenuHostHeight('off', 40, 294.545);
  assert.equal(closed.host, 'closed-field');
  assert.equal(closed.height, '40px');
});

test('D PC dropmenu 清单 on/off 各一例，初始态保持清单值', () => {
  const graph = regionGraph();
  const offModel = deriveInteractionModel([{
    id: 'menu-off-inst',
    type: 'INSTANCE',
    name: 'dropmenu/切换地区',
    componentId: 'menu-off',
    componentProperties: { 'Property 1': { value: 'off', type: 'VARIANT' } },
    componentVariantGraph: graph,
  }]);
  const onModel = deriveInteractionModel([{
    id: 'menu-on-inst',
    type: 'INSTANCE',
    name: 'dropmenu/切换地区',
    componentId: 'menu-on',
    componentProperties: { 'Property 1': { value: 'on', type: 'VARIANT' } },
    componentVariantGraph: graph,
  }]);
  const offAttrs = offModel.attributes.find((entry) => entry.id === 'menu-off-inst')?.attrs;
  const onAttrs = onModel.attributes.find((entry) => entry.id === 'menu-on-inst')?.attrs;
  assert.equal(offAttrs['data-dropmenu-state'], 'off');
  assert.equal(onAttrs['data-dropmenu-state'], 'on');

  const exactState = dropmenuExactStateFromRenderer();
  const variants = graph.variants;
  assert.equal(exactState({
    componentId: 'menu-off',
    componentProperties: { 'Property 1': { value: 'off' } },
    componentVariantGraph: { variants },
  }), 'off');
  assert.equal(exactState({
    componentId: 'menu-on',
    componentProperties: { 'Property 1': { value: 'on' } },
    componentVariantGraph: { variants },
  }), 'on');
  assert.equal(exactState({
    componentId: 'menu-on',
    componentProperties: {},
    componentVariantGraph: { variants },
  }), 'on', '缺 componentProperties 时仍跟 selected COMPONENT 的 on，不得强制 off');

  const openHost = initialDropmenuHostHeight('on', 294.545, 40);
  const closedHost = initialDropmenuHostHeight('off', 294.545, 40);
  assert.equal(openHost.host, 'open-variant-root');
  assert.equal(openHost.height, '294.545px');
  assert.equal(closedHost.host, 'closed-field');
  assert.equal(closedHost.height, '40px');
  assert.notEqual(openHost.host, closedHost.host);
});

test('E 预约弹窗内嵌套 @go：详细按钮带 data-go，播放钮不得当第二 opener，现码 exclusive 关其它窗', () => {
  const detail = parseAndAssignGo({ name: 'btn/详细按钮@go=modal/pc弹窗详细规则2' });
  assert.equal(detail.p.params.go, 'modal/pc弹窗详细规则2');
  assert.equal(detail.attrs['data-go'], 'modal/pc弹窗详细规则2');
  const play = parseAndAssignGo({ name: 'btn/播放按钮' });
  assert.equal(play.attrs['data-go'], undefined);

  const model = deriveInteractionModel([
    { id: '949:5740', type: 'FRAME', name: 'btn/详细按钮@go=modal/pc弹窗详细规则2', parentId: '949:5675' },
    { id: 'play', type: 'FRAME', name: 'btn/播放按钮', parentId: '949:5675' },
  ]);
  const byId = new Map(model.attributes.map((entry) => [entry.id, entry.attrs]));
  assert.equal(byId.get('949:5740')['data-go'], 'modal/pc弹窗详细规则2');
  assert.equal(byId.get('play')?.['data-go'], undefined);

  const inv = {
    nodes: [
      {
        id: 'page-play',
        name: 'btn/播放按钮',
        parentId: 'page',
        role: 'btn',
        platform: 'pc',
        status: 'determined',
      },
      {
        id: 'play',
        name: 'btn/播放按钮',
        parentId: '949:5675',
        role: 'btn',
        platform: 'pc',
        status: 'determined',
      },
    ],
    attachments: {
      modals: [
        {
          id: '949:5675',
          name: 'modal/pc_kr预约弹窗',
          platform: 'pc',
          nodes: [
            { id: '949:5675', name: 'modal/pc_kr预约弹窗', parentId: null },
            {
              id: '949:5740',
              name: 'btn/详细按钮@go=modal/pc弹窗详细规则2',
              parentId: '949:5675',
              role: 'btn',
              params: { go: 'modal/pc弹窗详细规则2' },
              platform: 'pc',
            },
            {
              id: 'play',
              name: 'btn/播放按钮',
              parentId: '949:5675',
              role: 'btn',
              platform: 'pc',
            },
            {
              id: 'self-go',
              name: 'btn/播放按钮@go=modal/pc_kr预约弹窗',
              parentId: '949:5675',
              role: 'btn',
              params: { go: 'modal/pc_kr预约弹窗' },
              platform: 'pc',
            },
          ],
        },
        { id: '949:5634', name: 'modal/pc弹窗详细规则2', platform: 'pc', nodes: [{ id: '949:5634', name: 'modal/pc弹窗详细规则2' }] },
        { id: 'video', name: 'modal/视频弹窗', platform: 'pc', nodes: [{ id: 'video', name: 'modal/视频弹窗' }] },
      ],
    },
    relations: [
      { kind: 'modal-trigger', status: 'unknown', from: null, to: { id: '949:5634' } },
      { kind: 'modal-trigger', status: 'unknown', from: null, to: { id: 'video' } },
    ],
  };
  const triggers = classifyModalTriggers(inv);
  const rulesFrom = (triggers.get('949:5634') || []).filter((entry) => entry.status === 'determined').map((entry) => entry.fromId);
  assert.deepEqual(rulesFrom, ['949:5740']);
  const videoFrom = (triggers.get('video') || []).filter((entry) => entry.status === 'determined').map((entry) => entry.fromId);
  assert.deepEqual(videoFrom, ['page-play']);
  assert.equal(videoFrom.includes('play'), false, '弹窗内播放钮不得当第二 opener');
  const rsvpFrom = (triggers.get('949:5675') || []).filter((entry) => entry.status === 'determined').map((entry) => entry.fromId);
  assert.equal(rsvpFrom.includes('self-go'), false, '同 host 再 @go 自己必须 skip');

  const rsvp = { name: 'pc_kr预约弹窗', layer: makeEl({ 'data-modal-open': 'true' }), openerEls: [] };
  const rules = { name: 'pc弹窗详细规则2', layer: makeEl(), openerEls: [] };
  const { open, closed } = openNamedModalFromRenderer([rsvp, rules]);
  open(rules);
  assert.equal(rules.layer.getAttribute('data-modal-open'), 'true');
  assert.equal(rsvp.layer.getAttribute('data-modal-open'), null);
  assert.deepEqual(closed, ['pc_kr预约弹窗']);
  const authorizedGo = {
    getAttribute(key) { return key === 'data-go' ? 'modal/pc弹窗详细规则2' : null; },
  };
  rules.openerEls = [authorizedGo];
  assert.deepEqual(resolveGoHit([rsvp, rules], authorizedGo), ['pc弹窗详细规则2']);
  const unauthorizedGo = {
    getAttribute(key) { return key === 'data-go' ? 'modal/pc弹窗详细规则2' : null; },
  };
  assert.deepEqual(resolveGoHit([rsvp, rules], unauthorizedGo), [], '同名未授权 @go 必须 inert');

  const nestedGo = {
    getAttribute(key) {
      if (key === 'data-node') return '949:5740';
      if (key === 'data-go') return 'modal/pc弹窗详细规则2';
      return null;
    },
  };
  const twinGo = {
    getAttribute(key) {
      if (key === 'data-node') return 'unauth-go';
      if (key === 'data-go') return 'modal/pc弹窗详细规则2';
      return null;
    },
  };
  const rsvpLayer = { contains(el) { return el === nestedGo; } };
  const wired = runOpenerScan({
    wired: [
      { name: 'pc_kr预约弹窗', layer: rsvpLayer, authorizedFrom: new Set(['open-rsvp']), openerEls: [] },
      { name: 'pc弹窗详细规则2', layer: { contains() { return false; } }, authorizedFrom: new Set(['949:5740']), openerEls: [] },
    ],
    hostGo: [nestedGo, twinGo],
  });
  assert.equal(wired[1].openerEls.includes(nestedGo), true, '弹窗内嵌套 @go 必须进 openerEls');
  assert.equal(wired[0].openerEls.includes(nestedGo), false, '嵌套 @go 不得绑到宿主弹窗');
  assert.equal(wired[1].openerEls.includes(twinGo), false, '未授权同名 @go 不得进 openerEls');
  assert.equal(Object.prototype.hasOwnProperty.call(wired[1], 'authorizedFrom'), false);
});

test('F LINE 0.5px 缺 strokeColor 不得加粗/补白，缺 color 不写 background', () => {
  const decision = sourceLineStroke({ strokeWeight: 0.5 });
  assert.deepEqual(decision.undetermined, ['strokeColor']);
  assert.equal(decision.heightPx, 0.5);
  assert.equal(decision.color, null);
  assert.notEqual(decision.heightPx, Math.max(1, 0.5));

  const painted = applySourceLine({ strokeWeight: 0.5 });
  assert.equal(painted.el.style.height, '0.5px');
  assert.equal(painted.el.getAttribute('data-source-line-undetermined'), 'strokeColor');
  assert.equal(painted.el.getAttribute('data-source-line-stroke'), '0.5');
  assert.equal(painted.el.style.background, undefined);
  assert.deepEqual(painted.rgbaCalls, []);
  assert.doesNotMatch(String(painted.el.style.background || ''), /#fff|#ffffff|rgb\(\s*255\s*,\s*255\s*,\s*255/i);
});

test('CENTER gradient VECTOR stroke keeps weight height, not renderBox slab', () => {
  const painted = applySourceLine({
    strokeWeight: 3.6,
    strokeAlign: 'CENTER',
    strokeColor: { type: 'GRADIENT_LINEAR', gradientStops: [{ color: { r: 1, g: 1, b: 1, a: 1 }, position: 0.5 }] },
  }, {
    n: { pageBox: { y: 1270, h: 0 }, renderBox: { y: 1268.85, h: 2.92 }, strokeAlign: 'CENTER' },
    box: { y: 1270 },
    originY: 0,
  });
  assert.equal(painted.el.style.height, '3.6px');
  assert.equal(painted.el.getAttribute('data-source-line-align'), 'center');
  assert.equal(painted.el.style.top, (1270 - 3.6 / 2) + 'px');
  assert.notEqual(painted.el.style.height, '2.92px');
  assert.match(rendererSrc, /data-rotated-shape-skipped', 'source-line-stroke'/);
});

test('CENTER source-line top follows already remapped hero y, not raw pageBox', () => {
  const el = makeEl();
  el.style.top = '980px';
  const start = rendererSrc.indexOf('const lineStroke = this._sourceLineStroke(st);');
  const colorIf = rendererSrc.indexOf('} else if (lineStroke.color) {', start);
  const colorBrace = extractBrace(rendererSrc, colorIf);
  const snippet = rendererSrc.slice(start, colorBrace.end + 1)
    .replace(/this\._sourceLineStroke/g, 'sourceLineStroke')
    .replace(/this\._rgba/g, 'rgba');
  const run = new Function('sourceLineStroke', 'st', 'el', 'rgba', 'n', 'box', 'originY', snippet + '\nreturn el;');
  const painted = run(sourceLineStroke, {
    strokeWeight: 3.6,
    strokeAlign: 'CENTER',
    strokeColor: { type: 'GRADIENT_LINEAR', gradientStops: [{ color: { r: 1, g: 1, b: 1, a: 1 }, position: 0.5 }] },
  }, el, () => 'INVENTED', {
    pageBox: { y: 1270, h: 0 },
    renderBox: { y: 1268.85, h: 2.92 },
    strokeAlign: 'CENTER',
  }, { y: 1270 }, 0);
  assert.equal(painted.style.top, (980 - 3.6 / 2) + 'px');
  assert.notEqual(painted.style.top, (1270 - 3.6 / 2) + 'px');
  assert.equal(painted.style.height, '3.6px');
});

test('rotated TEXT box uses Figma size, not skipped Auto Layout maxWidth', () => {
  const skippedMax = unrotatedTextLayout({
    rotation: -0.7853981633974483,
    layout: { maxWidth: 68, maxHeight: 68 },
    fitOwnerFromSkipped: { maxWidth: 68, maxHeight: 68 },
    text: { fontSize: 16, characters: '传奇战斗' },
  }, 56.568541526794434, 56.568541526794434);
  assert.ok(Math.abs(skippedMax.w - 64) < 0.6, JSON.stringify(skippedMax));
  assert.equal(skippedMax.h, 16);
  assert.notEqual(skippedMax.w, 68);
  assert.notEqual(skippedMax.h, 68);
  assert.match(skippedMax.from, /fontSize|aabb-from-height/);

  const withSize = unrotatedTextLayout({
    rotation: -0.7853981633974483,
    localSize: { w: 64, h: 16 },
    layout: { maxWidth: 68, maxHeight: 68 },
    text: { fontSize: 16 },
  }, 56.568541526794434, 56.568541526794434);
  assert.equal(withSize.w, 64);
  assert.equal(withSize.h, 16);
  assert.equal(withSize.from, 'localSize+localSize');

  const pc = unrotatedTextLayout({
    rotation: -0.7853981633974483,
    text: { fontSize: 22.3, characters: '传奇战斗' },
    layout: { maxWidth: 100.65, maxHeight: 100.65 },
  }, 100.64683976021115, 100.64683976021252);
  assert.ok(Math.abs(pc.w - 120.34) < 0.8, JSON.stringify(pc));
  assert.equal(pc.h, 22.3);
  assert.match(rendererSrc, /rotated-single-line/);
  assert.match(rendererSrc, /data-text-rotation-nowrap/);
});

test('rotated TEXT paints against renderBox, not skipped AL max or 0.55 nudge', () => {
  const textRotAt = rendererSrc.indexOf('visual-aabb-flex-center');
  assert.ok(textRotAt > 0);
  const body = rendererSrc.slice(rendererSrc.lastIndexOf('if (typeof n.rotation', textRotAt), rendererSrc.indexOf('if (tf.length) el.style.transform', textRotAt));
  assert.match(body, /_sameCoordinateSpace\(_textRenderBox, box\)/);
  assert.match(body, /visual-aabb-flex-center/);
  assert.match(body, /alignItems = 'center'/);
  assert.match(body, /justifyContent = 'center'/);
  assert.doesNotMatch(body, /fitOwnerFromSkipped && n\.fitOwnerFromSkipped\.box/);
  assert.doesNotMatch(body, /glyphNudge/);
  assert.doesNotMatch(body, /0\.55/);
});
test('G2 carousel img/箭头 paint uses spilling renderBox, not clipped pageBox 50', () => {
  const helpers = compileOwnerSliceHelpers();
  const ownerBox = { x: 2994.365, y: 5430.286, w: 103.063, h: 50.061 };
  const renderBox = { x: 2995.000, y: 5403.785, w: 102.000, h: 103.063 };
  const sliceExportBox = { ...ownerBox };
  const assetRec = { pixelSize: '104x104', exportBox: { x: 2994.365, y: 5403.785, w: 103.063, h: 103.063 } };
  const paint = helpers._ownerSliceBox(assetRec, ownerBox, renderBox, null, sliceExportBox);
  assert.equal(helpers._boxSpillsOwner(renderBox, ownerBox), true);
  assert.ok(Math.abs(Number(paint.h) - 103.063) < 0.5, JSON.stringify(paint));
  assert.ok(Number(paint.h) > Number(ownerBox.h) + 0.5, 'paint must not stay on the 50px layout window');
  assert.notEqual(Math.abs(Number(paint.h) - Number(ownerBox.h)) < 0.5, true);

  const wholeFrame = { x: 0, y: 0, w: 3840, h: 20000 };
  const shortInk = { x: 0, y: 0, w: 3840, h: 18000 };
  const bg = helpers._ownerSliceBox({ pixelSize: '3840x18000' }, wholeFrame, shortInk, null, shortInk);
  assert.equal(bg, wholeFrame);
});

test('SC-5 page scroll follows bg/pc or bg/mobile board bottom', () => {
  assert.match(rendererSrc, /isPageBgBoard/);
  assert.match(rendererSrc, /pageBgBoardBottom/);
  assert.match(rendererSrc, /pageBgBoardBottom\(\)/);
  assert.doesNotMatch(rendererSrc, /A 20000 bg\/pc board past the last CTA/);
  const lockStart = rendererSrc.indexOf('_pageScrollLock({ boardBottom = 0, contentBottom = 0 } = {})');
  const lockHeader = rendererSrc.indexOf(') {', lockStart);
  const lockBrace = lockHeader + 2;
  const lockEnd = closeBrace(rendererSrc, lockBrace);
  const lock = new Function(
    rendererSrc.slice(rendererSrc.indexOf('(', lockStart) + 1, lockHeader).trim(),
    rendererSrc.slice(lockBrace + 1, lockEnd),
  );
  const short = lock({ boardBottom: 1000, contentBottom: 800 });
  assert.equal(short.height, 1000);
  assert.equal(short.overflowPx, 0);
  assert.equal(short.reason, 'board-bottom');
  const over = lock({ boardBottom: 1000, contentBottom: 1300 });
  assert.equal(over.height, 1000);
  assert.equal(over.overflowPx, 300);
  assert.equal(over.contentBottom, 1300);
  assert.equal(over.reason, 'content-past-board');
  assert.notEqual(over.height, 1300);
  const missing = lock({ boardBottom: 0, contentBottom: 1300 });
  assert.equal(missing.height, 1300);
  assert.equal(missing.reason, 'board-missing');
  assert.match(rendererSrc, /data-page-scroll-overflow/);
  assert.doesNotMatch(rendererSrc, /const pageScrollHeight = pageScope && heroSlot\s*\n\s*\? Math\.max/);
});

test('SC-7 freeze-band classifies logo/age left and down-arrow window-center', () => {
  const isCenter = compileMethod(rendererSrc, '_isWindowCenterTopbarChrome(node, pfx)');
  const isTopbar = compileMethod(rendererSrc, '_isTopbarOverlayChrome(node, pfx, evidenceAttrs)');
  const isLeft = compileMethod(rendererSrc, '_isLeftTopbarChrome(box, designW)');
  const isPageLeft = compileMethod(rendererSrc, '_isPageLeftChrome(node, pfx)');
  assert.equal(isCenter({ name: 'fix/下滑箭头示意' }, 'fix'), true);
  assert.equal(isCenter({ name: 'btn/右滑动箭头' }, 'btn'), false);
  assert.equal(isTopbar({ name: 'img/LOGO' }, 'img', null), true);
  assert.equal(isTopbar({ name: 'btn/年龄@go=modal/pc适龄提示@lang=cn' }, 'btn', null), true);
  assert.equal(isTopbar({ name: 'btn/年龄@go=modal/mobile适龄提示@lang=cn' }, 'btn', null), true);
  assert.equal(isTopbar({ name: 'btn/按钮' }, 'btn', null), false);
  assert.equal(isPageLeft({ name: 'img/logo' }, 'img'), true);
  assert.equal(isPageLeft({ name: 'btn/年龄@go=modal/mobile适龄提示@lang=cn' }, 'btn'), true);
  assert.equal(isPageLeft({ name: 'btn/播放按钮' }, 'btn'), false);
  assert.equal(isLeft({ x: 0, w: 1020 }, 3840), true);
  assert.equal(isLeft({ x: 158, w: 125 }, 3840), true);
  assert.match(rendererSrc, /data-page-left-chrome-y', 'source'/);
  assert.match(rendererSrc, /Upper-half logo \/ age keep Figma y/);
  assert.match(rendererSrc, /data-later-cover-axis', 'x'/);
  assert.match(rendererSrc, /isKv && Number\.isFinite\(nodeYForCover\)/);
  assert.doesNotMatch(rendererSrc, /isPageBackgroundRoot && heroLayoutOffsetDesign > 0/);
  const centerShift = extractNamed(rendererSrc, '_topbarWindowCenterShiftDesign(box)');
  const runShift = new Function('box', `
    const self = { _viewportWidth: 1440, scale() { return 0.5; } };
    return (function (${centerShift.params}) { ${centerShift.body} }).call(self, box);
  `);
  const shift = runShift({ x: 1885, w: 70 });
  const windowMid = (1440 / 0.5) / 2;
  const sourceMid = 1885 + 70 / 2;
  assert.ok(Math.abs(shift - (windowMid - sourceMid)) < 0.5, String(shift));
});
