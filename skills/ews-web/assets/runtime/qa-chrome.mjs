/**
 * Etheria-ews QA chrome. Contracts follow torchlight demo-chrome.md / qa-comments.md:
 * device presets, language, state, simulated viewport, stretch, __qa, realtime comments.
 * Product layout numbers still come from EWS DESIGN.md, not the torchlight freeze ruler.
 */
import { createQaComments } from './qa-comments.mjs';
import { MOBILE_MAX_WIDTH, deviceOf } from './ews-screen-runtime.mjs';

export function isProductView(search = globalThis.location?.search || '') {
  const raw = String(search || '').replace(/^\?/, '');
  const q = new URLSearchParams(raw).get('product');
  return q === '1' || q === 'true' || q === 'yes';
}

export function isStaticGateView(search = globalThis.location?.search || '') {
  const raw = String(search || '').replace(/^\?/, '');
  const q = new URLSearchParams(raw).get('inventory-static-gate');
  return q === '1' || q === 'true' || q === 'yes';
}

export function ewsTreeDevice(innerWidth) {
  return deviceOf(innerWidth);
}

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  ));
}

function clamp(v, lo, hi) {
  const n = Number(v);
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
}

/** Fit scale from real available CSS px. Null if the stage has not laid out yet. Never invent an 80px floor. */
export function qaFitScale(availW, availH, viewW, viewH, fit = true) {
  if (!fit) return 1;
  const w = Number(availW);
  const h = Number(availH);
  const vw = Number(viewW);
  const vh = Number(viewH);
  if (!(w > 1) || !(h > 1) || !(vw > 0) || !(vh > 0)) return null;
  const k = Math.min(1, w / vw, h / vh);
  return Number.isFinite(k) && k > 0 ? k : null;
}

function copy(obj) {
  const out = {};
  for (const key in obj) out[key] = obj[key];
  return out;
}

function mk(tag, cls) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  return el;
}

function canonicalPlat(value) {
  if (value === 'desktop' || value === 'pc') return 'desktop';
  if (value === 'phone' || value === 'mobile') return 'mobile';
  if (value === 'tablet' || value === 'pad') return 'desktop';
  return value;
}

function injectChromeCss() {
  if (document.getElementById('ews-qa-chrome-css')) return;
  const st = document.createElement('style');
  st.id = 'ews-qa-chrome-css';
  st.textContent = [
    ':root{--bar:#171b22;--bar2:#1e232c;--line:#2b323e;--line2:#39424f;--txt:#e6eaf0;--dim:#8b95a6;--dim2:#616c7d;--acc:#3b82f6;--ok:#22c55e;--warn:#f59e0b;--err:#ef4444;--stage:#0c0f14}',
    '*{box-sizing:border-box}',
    'html.ews-qa-shell,html.ews-qa-shell body{margin:0;height:100%}',
    'html.ews-qa-shell body{background:var(--stage);color:var(--txt);display:flex;flex-direction:column;overflow:hidden;font:12px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}',
    'html.ews-qa-shell button,html.ews-qa-shell select,html.ews-qa-shell input{font:inherit;color:inherit}',
    '.bar{background:var(--bar);border-bottom:1px solid var(--line);flex:none}',
    '.row{display:flex;align-items:center;gap:18px;padding:9px 16px;flex-wrap:wrap}',
    '.row+.row{border-top:1px solid var(--line);background:var(--bar2)}',
    '.grp{display:flex;align-items:center;gap:7px}',
    '.title{display:flex;align-items:center;padding-right:8px;border-right:1px solid var(--line)}',
    '.title b{font-size:13px;font-weight:600}',
    '.lbl{font-size:11px;color:var(--dim2);white-space:nowrap}',
    '.seg{display:flex;background:#0f131a;border:1px solid var(--line);border-radius:7px;padding:2px;gap:2px}',
    '.seg button{border:0;background:transparent;color:var(--dim);font:inherit;font-size:12px;padding:4px 11px;border-radius:5px;cursor:pointer;white-space:nowrap}',
    '.seg button:hover{color:var(--txt);background:#1c222c}',
    '.seg button.on{background:var(--acc);color:#fff;font-weight:500}',
    'select,input[type=number]{background:#0f131a;border:1px solid var(--line);border-radius:6px;color:var(--txt);font-size:11.5px;padding:5px 8px;outline:none}',
    '.qa-device-select{min-width:196px}.qa-language-select{min-width:172px}.qa-state-select{min-width:186px}',
    'input[type=range]{width:150px;accent-color:var(--acc)}',
    '.bar [disabled]{opacity:.35;cursor:not-allowed}',
    '.btn{border:1px solid var(--line);background:#0f131a;color:var(--dim);font:inherit;font-size:11.5px;padding:5px 10px;border-radius:6px;cursor:pointer;white-space:nowrap}',
    '.btn:hover{border-color:var(--line2);color:var(--txt)}',
    '.btn.on{background:var(--acc);border-color:var(--acc);color:#fff}',
    '.chk{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--dim);cursor:pointer;white-space:nowrap}',
    '.readout{display:flex;align-items:center;gap:9px;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:var(--dim);background:#0f131a;border:1px solid var(--line);border-radius:6px;padding:5px 10px;font-variant-numeric:tabular-nums;margin-left:auto}',
    '.readout b{color:#fff;font-weight:600;font-size:12.5px}',
    '.stage{position:relative;flex:1;min-height:0;overflow:auto;padding:26px 28px 22px;display:flex;justify-content:center;align-items:center;scrollbar-width:none}',
    '.stage::-webkit-scrollbar,.frame::-webkit-scrollbar{display:none;width:0;height:0}',
    '.stage.tiled{padding:16px;display:block;align-items:stretch}',
    '.stage-wrap{flex:0 0 auto;position:relative;display:inline-block;background:#05070a;border:1px solid #2a3342;border-radius:14px;padding:10px;box-shadow:0 18px 50px rgba(0,0,0,.6)}',
    '.chip{position:absolute;left:10px;top:-21px;font-size:11px;color:var(--dim);white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.chip b{color:#fff}',
    '.frame{background:#180f02;overflow:hidden;transform-origin:0 0;border-radius:6px;position:relative}',
    '.frame .ews-root{height:100%;width:100%}',
    '.resize-rail{display:flex;align-items:center;gap:7px;color:var(--dim);font-size:11px}',
    '.orientation{display:flex;background:#0f131a;border:1px solid var(--line);border-radius:7px;padding:2px;gap:2px}',
    '.orientation button{border:0;background:transparent;color:var(--dim);font:inherit;font-size:11px;padding:4px 9px;border-radius:5px;cursor:pointer}',
    '.orientation button.on{background:var(--acc);color:#fff}',
    '.pop{position:relative}.pop-body{position:absolute;top:calc(100% + 6px);left:0;z-index:60;width:300px;max-height:300px;overflow:auto;background:var(--bar);border:1px solid var(--line2);border-radius:8px;padding:10px;box-shadow:0 18px 44px rgba(0,0,0,.6);display:none}',
    '.pop.open .pop-body{display:block}.pop-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 9px}',
    '.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}',
    '.card{border:1px solid var(--line);border-radius:9px;background:var(--bar);overflow:hidden}',
    '.card-h{padding:6px 10px;font-size:11px;color:var(--warn);border-bottom:1px solid var(--line);background:#0f131a}',
    '.card-b{height:220px;overflow:hidden;background:#180f02;position:relative}',
    '.edge-handle{position:absolute;z-index:5;touch-action:none;border-radius:7px;background:transparent}',
    '.edge-handle-e{top:0;bottom:0;right:-7px;width:14px;cursor:col-resize}',
    '.edge-handle-s{left:0;right:0;bottom:-7px;height:14px;cursor:row-resize}',
    '.edge-handle-se{right:-9px;bottom:-9px;width:18px;height:18px;cursor:nwse-resize;z-index:6}',
    '.edge-handle::after{content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);border-radius:2px;background:#3a4656;opacity:.55}',
    '.edge-handle-e::after{width:4px;height:44px}',
    '.edge-handle-s::after{width:44px;height:4px}',
    '.edge-handle-se::after{width:10px;height:10px;border-radius:50%}',
    '.edge-handle:hover::after,.edge-handle.dragging::after{background:var(--acc);opacity:1}',
    '.edge-handle.disabled{display:none}',
    '.qa-foot{flex:none;padding:6px 16px;color:var(--dim2);font-size:11px;border-top:1px solid var(--line);background:var(--bar)}',
    'html[data-product-view="1"] .bar,html[data-product-view="1"] .qc-root,html[data-product-view="1"] .edge-handle,html[data-product-view="1"] .chip,html[data-product-view="1"] .qa-foot{display:none!important}',
  ].join('');
  document.head.appendChild(st);
}

export function bootQaChrome(cfg) {
  if (!cfg || typeof cfg.renderApp !== 'function') throw new Error('qa-chrome: __qaDemo.renderApp 必填');
  const PRODUCT_VIEW = isProductView();
  const STATIC_GATE_VIEW = isStaticGateView();
  if (PRODUCT_VIEW) document.documentElement.setAttribute('data-product-view', '1');
  if (STATIC_GATE_VIEW) document.documentElement.setAttribute('data-inventory-static-gate', '1');

  const devicesEl = document.getElementById('qa-devices');
  if (!devicesEl || !String(devicesEl.textContent || '').trim()) {
    throw new Error('qa-chrome: 缺 <script id="qa-devices"> 设备预设块');
  }
  const PRESETS = JSON.parse(devicesEl.textContent);
  const GROUPS = PRESETS.deviceGroups || [];
  if (!GROUPS.length) throw new Error('qa-chrome: qa-devices 没有 deviceGroups');
  const BREAKPOINTS = PRESETS.breakpoints || [];
  const STORE_KEY = `qa-hifi:${cfg.name}:prefs`;

  const S = {
    groupIdx: 0,
    devIdx: 0,
    freeW: 1920,
    freeH: 1080,
    fit: !PRODUCT_VIEW && !STATIC_GATE_VIEW,
    fitScale: 1,
    grid: false,
    stateSubset: {},
    orientation: 'portrait',
    prefs: copy(cfg.defaultPrefs || {}),
    state: cfg.initialState,
  };

  (function initDevice() {
    for (let i = 0; i < GROUPS.length; i += 1) {
      if (GROUPS[i].key === 'PC') {
        S.groupIdx = i;
        S.devIdx = GROUPS[i].defaultIndex || 0;
        break;
      }
    }
    const d = curDev();
    S.freeW = d?.width || 1920;
    S.freeH = d?.height || 1080;
  }());

  try {
    const stored = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (stored) for (const key of Object.keys(S.prefs)) if (key in stored) S.prefs[key] = stored[key];
  } catch {
    /* keep defaults */
  }
  try {
    const search = new URLSearchParams(window.location.search);
    for (const key of ['plat', 'region', 'os', 'mode', 'lang']) {
      const fromQuery = search.get(key);
      if (fromQuery) S.prefs[key] = fromQuery;
    }
  } catch {
    /* keep defaults */
  }

  function curGroup() { return GROUPS[S.groupIdx] || GROUPS[0]; }
  function curDev() {
    const g = curGroup();
    if (!g) return null;
    if (S.devIdx < 0 || S.devIdx >= g.devices.length) return { name: '自由状态', free: true };
    return g.devices[S.devIdx];
  }
  function isFree() { return S.devIdx < 0; }
  function canResize() { return Boolean(curGroup()?.freeResize); }
  function canOrient() {
    const g = curGroup();
    return Boolean(g && g.key !== 'PC' && !isFree() && curDev()?.width && curDev()?.height);
  }
  function orientedDevice(d) {
    if (!d || S.orientation !== 'landscape' || !d.width || !d.height) return d;
    return { ...d, width: d.height, height: d.width, orientation: 'landscape' };
  }
  function productViewportSize() {
    if (!PRODUCT_VIEW && !STATIC_GATE_VIEW) return null;
    return {
      w: window.innerWidth || document.documentElement.clientWidth || 0,
      h: window.innerHeight || document.documentElement.clientHeight || 0,
      dpr: window.devicePixelRatio || 1,
      src: 'product-view',
    };
  }
  function viewport() {
    const product = productViewportSize();
    if (product) return { w: product.w, h: product.h, dpr: product.dpr, src: product.src, orientation: S.orientation };
    const d = orientedDevice(curDev());
    if (isFree() || !d || !d.width) return { w: S.freeW, h: S.freeH, dpr: 1, src: '自由状态', orientation: S.orientation };
    return { w: d.width, h: d.height, dpr: d.dpr || 1, src: '机型锁定', orientation: S.orientation };
  }
  function kitBpOf(w) {
    for (const b of BREAKPOINTS) {
      if (w >= b.min && (b.max == null || w <= b.max)) return b;
    }
    return { key: '?', label: '?' };
  }
  function matrixPlatOfWidth(w) {
    return Number(w) <= MOBILE_MAX_WIDTH ? 'mobile' : 'desktop';
  }
  function presetMetric(axis, fallback, reducer) {
    const vals = [];
    const push = (d) => {
      const v = Number(axis === 'w' ? d.width : d.height);
      if (Number.isFinite(v) && v > 0) vals.push(v);
    };
    for (const g of GROUPS) for (const d of g.devices || []) push(d);
    for (const d of PRESETS.otherReference?.devices || []) push(d);
    return vals.length ? vals.reduce(reducer) : fallback;
  }
  const VIEWPORT_MIN_W = presetMetric('w', 240, (a, b) => Math.min(a, b));
  const VIEWPORT_MIN_H = presetMetric('h', 240, (a, b) => Math.min(a, b));
  const VIEWPORT_MAX_W = Math.max(3840, presetMetric('w', 3840, (a, b) => Math.max(a, b)));
  const VIEWPORT_MAX_H = Math.max(8000, presetMetric('h', 8000, (a, b) => Math.max(a, b)));
  const clampW = (v) => clamp(v, VIEWPORT_MIN_W, VIEWPORT_MAX_W);
  const clampH = (v) => clamp(v, VIEWPORT_MIN_H, VIEWPORT_MAX_H);

  function syncDeviceToPlat(p) {
    const wanted = canonicalPlat(p);
    for (let i = 0; i < GROUPS.length; i += 1) {
      const d = GROUPS[i].devices[GROUPS[i].defaultIndex || 0];
      if (d?.width && matrixPlatOfWidth(d.width) === wanted) {
        S.groupIdx = i;
        S.devIdx = GROUPS[i].defaultIndex || 0;
        S.freeW = d.width;
        S.freeH = d.height;
        return;
      }
    }
    const rep = wanted === 'mobile' ? [390, 844] : [1920, 1080];
    S.devIdx = -1;
    S.freeW = rep[0];
    S.freeH = rep[1];
  }

  injectChromeCss();
  if (!PRODUCT_VIEW && !STATIC_GATE_VIEW) document.documentElement.classList.add('ews-qa-shell');

  const bar = PRODUCT_VIEW || STATIC_GATE_VIEW ? null : mk('div', 'bar');
  const row1 = bar ? mk('div', 'row') : null;
  const row2 = bar ? mk('div', 'row') : null;
  if (bar) {
    bar.append(row1, row2);
    document.body.appendChild(bar);
  }
  const stage = mk('div', 'stage');
  stage.setAttribute('data-qa-stage', '1');
  const wrap = mk('div', 'stage-wrap');
  const chip = PRODUCT_VIEW || STATIC_GATE_VIEW ? null : mk('div', 'chip');
  const frame = mk('div', 'frame');
  frame.setAttribute('data-qa-frame', '1');
  if (chip) wrap.appendChild(chip);
  wrap.appendChild(frame);
  stage.appendChild(wrap);
  document.body.appendChild(stage);
  const foot = PRODUCT_VIEW || STATIC_GATE_VIEW ? null : mk('div', 'qa-foot');
  if (foot) {
    foot.textContent = `由 etheria-ews 生成 · QA 壳不是交付物 · 产品视图请用 ?product=1 · 评论 ${cfg.commentApi ? '共享 API 已声明' : '本机 IndexedDB，未配置 commentApi'}`;
    document.body.appendChild(foot);
  }

  const resizeHandles = [];
  function makeResizeHandle(cls, orientation, label, qaValue, moveX, moveY) {
    const handle = mk('div', `edge-handle ${cls} disabled`);
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', orientation);
    handle.setAttribute('aria-label', label);
    handle.setAttribute('data-qa-edge-resize', qaValue);
    wrap.appendChild(handle);
    resizeHandles.push(handle);
    let drag = null;
    handle.addEventListener('pointerdown', (e) => {
      if (!canResize()) return;
      const vp0 = viewport();
      drag = {
        x0: e.clientX,
        y0: e.clientY,
        w0: vp0.w,
        h0: vp0.h,
        scale: S.fitScale > 0 ? S.fitScale : 1,
      };
      handle.classList.add('dragging');
      try { handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = (e.clientX - drag.x0) / drag.scale;
      const dy = (e.clientY - drag.y0) / drag.scale;
      if (moveX) S.freeW = clampW(Math.round(drag.w0 + dx));
      if (moveY) S.freeH = clampH(Math.round(drag.h0 + dy));
      S.devIdx = -1;
      scheduleSyncAll();
    });
    const end = (e) => {
      if (!drag) return;
      drag = null;
      handle.classList.remove('dragging');
      try { handle.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      syncAll();
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    return handle;
  }
  if (!PRODUCT_VIEW && !STATIC_GATE_VIEW) {
    makeResizeHandle('edge-handle-e', 'vertical', '拖拽调整预览宽度', 'width', true, false);
    makeResizeHandle('edge-handle-s', 'horizontal', '拖拽调整预览高度', 'height', false, true);
    makeResizeHandle('edge-handle-se', 'vertical', '拖拽调整预览宽度和高度', 'both', true, true);
  }

  function grp(label, node) {
    const d = mk('div', 'grp');
    if (label) {
      const l = mk('span', 'lbl');
      l.textContent = label;
      d.appendChild(l);
    }
    d.appendChild(node);
    return d;
  }
  function seg(items, getOn, onPick, prefKey) {
    const s = mk('div', 'seg');
    items.forEach((it) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = it.label;
      if (prefKey) b.setAttribute('data-qa-pref', `${prefKey}:${it.v}`);
      if (getOn(it)) b.className = 'on';
      b.onclick = () => onPick(it);
      s.appendChild(b);
    });
    return s;
  }

  let elDevSel;
  let elFit;
  let elRead1;
  let widthInput;
  let heightInput;
  let resizeRange;
  let elGrid;
  let comments = null;

  function stateEntries() {
    const entries = [];
    Object.keys(cfg.states || {}).forEach((id) => {
      const item = cfg.states[id] || {};
      entries.push({ id, label: item.label || item.name || id, kind: 'state' });
    });
    (cfg.tabStates || []).forEach((item) => {
      entries.push({ id: item.id, label: item.label || item.name || item.id, kind: 'tab' });
    });
    return entries;
  }
  function syncStateSubset(entries) {
    entries.forEach((entry) => {
      if (!Object.prototype.hasOwnProperty.call(S.stateSubset, entry.id)) S.stateSubset[entry.id] = true;
    });
    Object.keys(S.stateSubset).forEach((id) => {
      if (!entries.some((entry) => entry.id === id)) delete S.stateSubset[id];
    });
  }
  function selectedStateEntries(entries) {
    return entries.filter((entry) => S.stateSubset[entry.id] !== false);
  }

  function buildBar1() {
    if (!row1) return;
    row1.replaceChildren();
    const brand = mk('div', 'title');
    brand.innerHTML = `<b>${esc(cfg.title || cfg.name)}</b>`;
    row1.appendChild(brand);
    row1.appendChild(grp('设备组', seg(
      GROUPS.map((g) => ({ label: g.key, v: g.key })),
      (it) => curGroup()?.key === it.v,
      (it) => {
        const i = GROUPS.findIndex((g) => g.key === it.v);
        if (i < 0) return;
        S.groupIdx = i;
        S.devIdx = GROUPS[i].defaultIndex || 0;
        const d = curDev();
        if (d?.width) {
          S.freeW = d.width;
          S.freeH = d.height;
        }
        syncAll();
      },
    )));
    elDevSel = document.createElement('select');
    elDevSel.className = 'qa-device-select';
    elDevSel.setAttribute('data-qa-device-select', '1');
    elDevSel.onchange = () => {
      S.devIdx = Number(elDevSel.value);
      const d = curDev();
      if (d?.width) {
        S.freeW = d.width;
        S.freeH = d.height;
      }
      syncAll();
    };
    row1.appendChild(grp('设备', elDevSel));

    const sizeControl = mk('div', 'resize-rail');
    const sizeLabel = mk('span', 'lbl');
    sizeLabel.textContent = '尺寸';
    sizeControl.appendChild(sizeLabel);
    const widthLabel = mk('span', 'lbl');
    widthLabel.textContent = 'W';
    sizeControl.appendChild(widthLabel);
    widthInput = document.createElement('input');
    widthInput.type = 'number';
    widthInput.min = String(VIEWPORT_MIN_W);
    widthInput.max = String(VIEWPORT_MAX_W);
    widthInput.step = '1';
    widthInput.setAttribute('data-qa-viewport-width-input', 'true');
    widthInput.onchange = () => {
      S.freeW = clampW(Number(widthInput.value) || viewport().w);
      S.devIdx = -1;
      syncAll();
    };
    sizeControl.appendChild(widthInput);
    const times = mk('span', 'lbl');
    times.textContent = '×';
    sizeControl.appendChild(times);
    const heightLabel = mk('span', 'lbl');
    heightLabel.textContent = 'H';
    sizeControl.appendChild(heightLabel);
    heightInput = document.createElement('input');
    heightInput.type = 'number';
    heightInput.min = String(VIEWPORT_MIN_H);
    heightInput.max = String(VIEWPORT_MAX_H);
    heightInput.step = '1';
    heightInput.setAttribute('data-qa-viewport-height-input', 'true');
    heightInput.onchange = () => {
      S.freeH = clampH(Number(heightInput.value) || viewport().h);
      S.devIdx = -1;
      syncAll();
    };
    sizeControl.appendChild(heightInput);
    resizeRange = document.createElement('input');
    resizeRange.type = 'range';
    resizeRange.min = String(VIEWPORT_MIN_W);
    resizeRange.max = String(VIEWPORT_MAX_W);
    resizeRange.step = '1';
    resizeRange.setAttribute('data-qa-viewport-resize', 'width');
    resizeRange.oninput = () => {
      S.freeW = clampW(Number(resizeRange.value));
      S.devIdx = -1;
      scheduleSyncAll();
    };
    sizeControl.appendChild(resizeRange);
    row1.appendChild(sizeControl);

    const orient = mk('div', 'orientation');
    for (const key of ['portrait', 'landscape']) {
      const ob = document.createElement('button');
      ob.type = 'button';
      ob.textContent = key === 'portrait' ? '竖屏' : '横屏';
      ob.setAttribute('data-qa-orientation', key);
      ob.className = key === S.orientation ? 'on' : '';
      ob.disabled = !canOrient();
      ob.onclick = () => {
        if (!canOrient()) return;
        S.orientation = key;
        syncAll();
      };
      orient.appendChild(ob);
    }
    row1.appendChild(grp('方向', orient));

    elFit = document.createElement('input');
    elFit.type = 'checkbox';
    elFit.checked = S.fit;
    elFit.onchange = () => {
      S.fit = elFit.checked;
      syncAll();
    };
    const fitWrap = mk('label', 'chk');
    fitWrap.append(elFit, document.createTextNode('缩放到可视区'));
    row1.appendChild(grp('视图', fitWrap));
    elRead1 = mk('div', 'readout');
    row1.appendChild(elRead1);
  }

  function buildBar2() {
    if (!row2) return;
    row2.replaceChildren();
    const m = cfg.matrix || {};
    if (m.plat) {
      row2.appendChild(grp(m.plat.label || '平台', seg(
        m.plat.options || [],
        (it) => S.prefs.plat === it.v,
        (it) => {
          syncDeviceToPlat(it.v);
          syncAll();
        },
        'plat',
      )));
    }
    if (m.region) {
      row2.appendChild(grp(m.region.label || '区域', seg(
        m.region.options || [],
        (it) => S.prefs.region === it.v,
        (it) => applyPref('region', it.v),
        'region',
      )));
    }
    if (m.lang) {
      const langSel = document.createElement('select');
      langSel.className = 'qa-language-select';
      langSel.setAttribute('data-qa-pref-key', 'lang');
      for (const it of m.lang.options || []) {
        const op = document.createElement('option');
        op.value = it.v;
        op.textContent = `${it.label} · ${it.v}`;
        op.setAttribute('data-qa-pref', `lang:${it.v}`);
        if (S.prefs.lang === it.v) op.selected = true;
        langSel.appendChild(op);
      }
      langSel.onchange = () => applyPref('lang', langSel.value);
      row2.appendChild(grp(m.lang.label || '语言', langSel));
    }

    const entries = stateEntries();
    syncStateSubset(entries);
    const stateCount = entries.length;
    if (stateCount < 2) S.grid = false;
    const stSel = document.createElement('select');
    stSel.className = 'qa-state-select';
    stSel.setAttribute('data-qa-state-select', '1');
    entries.forEach((entry) => {
      const op = document.createElement('option');
      op.value = entry.id;
      op.textContent = entry.label;
      op.setAttribute('data-qa-goto', entry.id);
      if (S.state === entry.id) op.selected = true;
      if (entry.kind === 'tab') op.setAttribute('data-qa-state-tab', '1');
      stSel.appendChild(op);
    });
    stSel.disabled = S.grid;
    stSel.onchange = () => {
      S.state = stSel.value;
      syncAll();
    };

    elGrid = document.createElement('input');
    elGrid.type = 'checkbox';
    elGrid.checked = S.grid;
    elGrid.setAttribute('data-qa-state-tile', '1');
    elGrid.disabled = stateCount < 2;
    elGrid.onchange = () => {
      S.grid = elGrid.checked;
      syncAll();
    };
    const gw = mk('label', 'chk');
    gw.append(elGrid, document.createTextNode('平铺全部状态'));
    row2.appendChild(grp('状态', stSel));
    row2.appendChild(grp('', gw));

    if (stateCount >= 2) {
      const tabBtn = document.createElement('button');
      tabBtn.type = 'button';
      tabBtn.className = 'btn';
      tabBtn.setAttribute('data-qa-state-tab', '1');
      tabBtn.textContent = '状态补齐';
      const sub = mk('div', 'pop');
      tabBtn.onclick = () => sub.classList.toggle('open');
      const subBody = mk('div', 'pop-body');
      const subGrid = mk('div', 'pop-grid');
      entries.forEach((entry) => {
        const go = document.createElement('button');
        go.type = 'button';
        go.className = 'btn';
        go.setAttribute('data-qa-goto', entry.id);
        go.textContent = entry.label;
        go.onclick = () => {
          S.state = entry.id;
          S.grid = false;
          sub.classList.remove('open');
          syncAll();
        };
        subGrid.appendChild(go);
      });
      subBody.appendChild(subGrid);
      sub.append(tabBtn, subBody);
      row2.appendChild(grp('', sub));
    }

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = '复制当前组合链接';
    copyBtn.className = 'btn';
    copyBtn.onclick = () => {
      writeHash();
      try {
        navigator.clipboard.writeText(location.href);
        copyBtn.textContent = '已复制 ✓';
        setTimeout(() => { copyBtn.textContent = '复制当前组合链接'; }, 1400);
      } catch {
        copyBtn.textContent = '复制失败，手动拷地址栏';
      }
    };
    row2.appendChild(grp('分享', copyBtn));
    if (comments) row2.appendChild(comments.toolbar);
  }

  function fillDeviceSelect() {
    if (!elDevSel) return;
    elDevSel.replaceChildren();
    const g = curGroup();
    (g?.devices || []).forEach((d, i) => {
      const op = document.createElement('option');
      op.value = String(i);
      op.textContent = `${d.name} · ${d.width}×${d.height}`;
      if (i === S.devIdx) op.selected = true;
      elDevSel.appendChild(op);
    });
    const free = document.createElement('option');
    free.value = '-1';
    free.textContent = '自由状态';
    if (S.devIdx < 0) free.selected = true;
    elDevSel.appendChild(free);
  }

  function stageAvail() {
    const padW = 56;
    const padH = 48;
    const w = Number(stage.clientWidth) || 0;
    const h = Number(stage.clientHeight) || 0;
    if (w > 8 && h > 8) {
      return { w: Math.max(1, w - padW), h: Math.max(1, h - padH), ready: true };
    }
    const chromeH = (bar?.offsetHeight || 0) + (foot?.offsetHeight || 0);
    return {
      w: Math.max(1, (window.innerWidth || 0) - padW),
      h: Math.max(1, (window.innerHeight || 0) - chromeH - padH),
      ready: false,
    };
  }

  function applyFit(vp) {
    if (PRODUCT_VIEW || STATIC_GATE_VIEW) {
      S.fitScale = 1;
      wrap.style.cssText = 'padding:0;border:0;border-radius:0;box-shadow:none;background:transparent;display:block;width:100%;height:100%;';
      frame.style.cssText = `width:${vp.w}px;height:${vp.h}px;transform:scale(1);border-radius:0;`;
      stage.style.padding = '0';
      return;
    }
    const box = stageAvail();
    let k = qaFitScale(box.w, box.h, vp.w, vp.h, S.fit);
    if (k == null) {
      k = 1;
      scheduleSyncAll();
    } else if (!box.ready) {
      scheduleSyncAll();
    }
    S.fitScale = k;
    wrap.style.width = `${vp.w * k + 20}px`;
    wrap.style.height = `${vp.h * k + 20}px`;
    frame.style.width = `${vp.w}px`;
    frame.style.height = `${vp.h}px`;
    frame.style.transform = `scale(${k})`;
    if (chip) chip.innerHTML = `<b>${vp.w}×${vp.h}</b> · ${ewsTreeDevice(vp.w)} · ${S.fit ? `fit ${Math.round(k * 1000) / 10}%` : '1:1'}`;
  }

  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S.prefs)); } catch { /* ignore */ }
  }
  function writeHash() {
    const vp = viewport();
    const parts = [`g=${curGroup()?.key || ''}`, `d=${S.devIdx}`, `w=${vp.w}`, `h=${vp.h}`, `state=${S.state}`];
    for (const key of Object.keys(S.prefs)) parts.push(`${key}=${S.prefs[key]}`);
    if (S.grid) parts.push('grid=1');
    try { history.replaceState(null, '', `#${parts.join('&')}`); } catch { /* ignore */ }
  }
  function readHash() {
    if (!location.hash) return;
    const q = {};
    location.hash.slice(1).split('&').forEach((kv) => {
      const i = kv.indexOf('=');
      if (i > 0) q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    if (q.g) {
      const i = GROUPS.findIndex((g) => g.key === q.g);
      if (i >= 0) S.groupIdx = i;
    }
    if (q.d != null) S.devIdx = Number(q.d);
    if (q.w) S.freeW = Number(q.w);
    if (q.h) S.freeH = Number(q.h);
    const known = cfg.states?.[q.state] || (cfg.tabStates || []).some((t) => t.id === q.state);
    if (q.state && known) S.state = q.state;
    for (const key of Object.keys(S.prefs)) if (q[key]) S.prefs[key] = q[key];
    if (q.grid === '1') S.grid = true;
  }

  function applyPref(key, value) {
    if (!cfg.matrix || !(key in { plat: 1, region: 1, os: 1, mode: 1, lang: 1 })) {
      throw new Error(`__qa.setPref: 未声明的维度 ${key}`);
    }
    if (key === 'plat') syncDeviceToPlat(value);
    if (key === 'lang') {
      const live = window.__ewsStop1?.getState?.()?.screen;
      if (live && cfg.states?.[live]) S.state = live;
    }
    S.prefs[key] = value;
    persist();
    syncAll();
  }

  function noteState(id) {
    if (!cfg.states?.[id] && !(cfg.tabStates || []).some((t) => t.id === id)) return;
    if (S.state === id) return;
    S.state = id;
    const sel = document.querySelector('.qa-state-select');
    if (sel && sel.value !== id) sel.value = id;
    writeHash();
  }

  function renderInto(container, state) {
    const vp = viewport();
    const renderPrefs = copy(S.prefs);
    renderPrefs.plat = matrixPlatOfWidth(vp.w);
    cfg.renderApp({
      prefs: renderPrefs,
      state,
      frame: container,
      viewport: { w: vp.w, h: vp.h, dpr: vp.dpr, src: vp.src },
      productView: Boolean(PRODUCT_VIEW),
      treeDevice: ewsTreeDevice(vp.w),
      setPref: applyPref,
    });
  }

  function render() {
    const vp = viewport();
    applyFit(vp);
    if (S.grid && !PRODUCT_VIEW) {
      stage.classList.add('tiled');
      const tiles = mk('div', 'tiles');
      const entries = selectedStateEntries(stateEntries());
      wrap.hidden = true;
      stage.querySelectorAll('.tiles').forEach((el) => el.remove());
      entries.forEach((entry) => {
        const card = mk('div', 'card');
        const h = mk('div', 'card-h');
        h.textContent = entry.label;
        const body = mk('div', 'card-b');
        card.append(h, body);
        tiles.appendChild(card);
        renderInto(body, entry.id);
      });
      stage.appendChild(tiles);
      return;
    }
    stage.classList.remove('tiled');
    wrap.hidden = false;
    stage.querySelectorAll('.tiles').forEach((el) => el.remove());
    renderInto(frame, S.state);
  }

  function updateRead(vp) {
    if (!elRead1) return;
    const tree = ewsTreeDevice(vp.w);
    const kit = kitBpOf(vp.w);
    elRead1.innerHTML = `读数 <b>${vp.w}×${vp.h} px</b> · DPR <b>${vp.dpr}</b> · 产品树 <b>${tree}</b>（innerWidth≤${MOBILE_MAX_WIDTH} 手机） · kit ${esc(kit.label || kit.key)} · 视图缩放 <b>${Math.round((S.fitScale || 1) * 1000) / 10}%</b> · 来源 <b>${esc(vp.src)}</b>`;
  }

  function syncToolbar() {
    if (!row1) return;
    fillDeviceSelect();
    const lock = !canResize();
    [widthInput, heightInput, resizeRange].forEach((el) => {
      if (!el) return;
      el.disabled = lock;
      el.title = lock ? '仅 PC 设备组可自由拉伸' : '';
    });
    for (const handle of resizeHandles) handle.classList.toggle('disabled', lock);
    const vp = viewport();
    if (widthInput) widthInput.value = String(vp.w);
    if (heightInput) heightInput.value = String(vp.h);
    if (resizeRange) resizeRange.value = String(Math.min(VIEWPORT_MAX_W, Math.max(VIEWPORT_MIN_W, vp.w)));
    if (elFit) elFit.checked = S.fit;
    updateRead(vp);
  }

  function notifyPrefChange() {
    window.dispatchEvent(new CustomEvent('qa-pref-change', { detail: { prefs: copy(S.prefs) } }));
  }

  function syncAll() {
    const platOpts = cfg.matrix?.plat?.options || [];
    const curPlat = matrixPlatOfWidth(viewport().w);
    const curOpt = platOpts.find((o) => canonicalPlat(o.v) === canonicalPlat(curPlat));
    if (curOpt) S.prefs.plat = curOpt.v;
    if (PRODUCT_VIEW || STATIC_GATE_VIEW) {
      render();
      notifyPrefChange();
      return;
    }
    buildBar1();
    buildBar2();
    syncToolbar();
    render();
    if (comments) comments.refresh();
    writeHash();
    notifyPrefChange();
  }

  let syncAllScheduled = false;
  function scheduleSyncAll() {
    if (syncAllScheduled) return;
    syncAllScheduled = true;
    const raf = window.requestAnimationFrame?.bind(window) || ((fn) => setTimeout(fn, 0));
    raf(() => {
      syncAllScheduled = false;
      syncAll();
    });
  }

  if (PRODUCT_VIEW) {
    window.__qa = {
      setPref(key, value) {
        if (key !== 'lang') throw new Error('product view setPref only accepts lang');
        applyPref(key, value);
      },
    };
  } else {
    window.__qaNoteState = noteState;
    window.__qa = {
      current: () => S.state,
      noteState,
      goto(id) {
        if (!cfg.states?.[id] && !(cfg.tabStates || []).some((t) => t.id === id)) {
          throw new Error(`__qa.goto: 未声明的状态 ${id}`);
        }
        S.state = id;
        syncAll();
      },
      prefs: () => copy(S.prefs),
      setPref: applyPref,
      scale: () => (typeof cfg.scale === 'function' ? cfg.scale.call(cfg) : 1),
      resize(w, h) {
        const nextW = clampW(w);
        const nextH = clampH(h);
        if (!Number.isFinite(nextW) || !Number.isFinite(nextH) || nextW <= 0 || nextH <= 0) {
          throw new Error(`__qa.resize: invalid size ${w}x${h} -> ${nextW}x${nextH}`);
        }
        S.freeW = nextW;
        S.freeH = nextH;
        S.devIdx = -1;
        syncAll();
      },
      setOrientation(mode) {
        if (mode !== 'portrait' && mode !== 'landscape') throw new Error('__qa.setOrientation: mode 必须是 portrait 或 landscape');
        if (!canOrient()) throw new Error('__qa.setOrientation: 当前设备组不支持横竖屏切换');
        S.orientation = mode;
        syncAll();
      },
    };
  }

  if (!PRODUCT_VIEW && !STATIC_GATE_VIEW) {
    comments = createQaComments({
      stage,
      pageKey: cfg.commentPageId || location.pathname.replace(/index\.html$/, ''),
      commentApi: cfg.commentApi || null,
      context() {
        return {
          lang: S.prefs.lang,
          region: S.prefs.region,
          state: S.state,
          composition: ewsTreeDevice(viewport().w),
          grid: S.grid,
        };
      },
      navigate(context, savedViewport) {
        const matrix = cfg.matrix || {};
        const langOk = !matrix.lang || matrix.lang.options.some((option) => option.v === context.lang);
        const regionOk = !matrix.region || matrix.region.options.some((option) => option.v === context.region);
        const stateOk = stateEntries().some((entry) => entry.id === context.state);
        if (!langOk || !regionOk || !stateOk) return false;
        S.prefs.lang = context.lang;
        S.prefs.region = context.region;
        S.state = context.state;
        S.grid = false;
        if (ewsTreeDevice(viewport().w) !== context.composition && savedViewport?.w && savedViewport?.h) {
          S.devIdx = -1;
          S.freeW = savedViewport.w;
          S.freeH = savedViewport.h;
        }
        persist();
        syncAll();
        return true;
      },
      viewport,
    });
  }
  if (!PRODUCT_VIEW && !STATIC_GATE_VIEW) readHash();
  let lastStageSize = '';
  function stageSizeChanged() {
    const key = `${stage.clientWidth}x${stage.clientHeight}`;
    if (key === lastStageSize) return false;
    lastStageSize = key;
    return true;
  }
  if (!PRODUCT_VIEW && !STATIC_GATE_VIEW && typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => {
      if (!S.fit) return;
      if (stageSizeChanged()) scheduleSyncAll();
    });
    ro.observe(stage);
  }
  syncAll();
  window.addEventListener('resize', () => {
    if (PRODUCT_VIEW || STATIC_GATE_VIEW || S.fit) scheduleSyncAll();
  });
  if (!PRODUCT_VIEW && !STATIC_GATE_VIEW) {
    const raf = window.requestAnimationFrame?.bind(window) || ((fn) => setTimeout(fn, 0));
    raf(() => raf(() => {
      if (S.fit) scheduleSyncAll();
    }));
    document.fonts?.ready?.then?.(() => {
      if (S.fit) scheduleSyncAll();
    }).catch?.(() => {});
  }
  return { viewport, frame, stage };
}
