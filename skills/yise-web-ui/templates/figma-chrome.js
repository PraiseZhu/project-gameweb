/* figma-chrome.js — 验收壳运行时（深灰黑主题）。【本 Skill 替换老师 qa-chrome 的 UI 层】
 *
 * ═══ 为什么替换而不是沿用老师的 qa-chrome ═══
 *
 * 老师的 chrome 是为「PR 评审」设计的：5 个 matrix 切换器 + 状态补齐 tab，
 * 验收结论不显示在页面上（走 report.json + PR 附贴块）。
 *
 * 本项目的展示层要给设计/市场/发行看，需求不同：设备预设组、连续拉伸、
 * 断点归属读数、状态平铺、可分享深链。这些老师的 chrome 没有。
 *
 * 规格来源：同事整理的 figma-harness-kit（docs/02-control-bar-spec.md + data/device-presets.json）。
 * 设备档位与断点一律读 fixtures/device-presets.json，**不在本文件里写死任何尺寸**。
 *
 * ═══ 必须保住老师的合约（否则七道门全废）═══
 *
 * 老师 SKILL：手写合约仅限 chrome 无法覆盖的场景，且 DOM 合约必须与标准一致。
 * 因此本文件保留：
 *   window.__qa = { current, goto, prefs, scale, resize, metrics }   ← verify.mjs 驱动它
 *   .frame            渲染容器
 *   [data-qa-pref="key:value"]  偏好控件（replay.mjs 靠它点选）。⚠️ 合约是**单属性**形态
 *   （老师 qa-chrome 与 replay 的第一候选选择器都是它）。我们曾写成
 *   data-qa-pref="key" + data-qa-value="value" 双属性 —— replay 一个候选都匹配不上，
 *   gateB/C 连 region/lang 都点不到（2026-08-04 修，任务 17）。两种形态不并存，并存必漂。
 *   data-qa-state-tab 状态补齐 tab
 *   data-qa-goto      跳状态
 *   localStorage key  qa-hifi:<name>:prefs
 *
 * ═══ 一条纪律：读数只能测，不能声明 ═══
 *
 * 「root font-size 实测 / 断点归属 / 缺文案数」这类读数，一律从**真实 DOM 现测**，
 * 不许读配置里的数字冒充。参考同类产物审计发现的问题：
 * i18n 完整性用「提取器自己生成的 requiredKeys」当基准 = 提取器漏扫就永远绿。
 * 本文件的缺文案数改为 querySelectorAll('[data-copy-missing],[data-text-empty]') 现数 DOM。
 */
(function () {
  'use strict';

  var cfg = window.__qaDemo;
  if (!cfg) throw new Error('figma-chrome: 缺 window.__qaDemo 配置');
  if (typeof cfg.renderApp !== 'function') throw new Error('figma-chrome: __qaDemo.renderApp 必填');

  /* ── 产品视图纯净入口（?product=1）──
     QA 壳(控制栏/切换器/状态补齐 tab/拉伸手柄/读数/__qa API)与产品视图彻底分离:
     product 模式下只渲染 stage + 产品帧,不建任何调试 UI、不暴露 __qa、不读深链。
     验收/交付截图一律走这条路径(文件名 *-product.png);QA 壳截图只是 candidate 级证据。
     实现约束:PRODUCT_VIEW 在同步代码最前面算好,后面所有 UI 挂载点共用同一开关。 */
  var PRODUCT_VIEW = (function () {
    try {
      var q = new URLSearchParams(window.location.search).get('product');
      return q === '1' || q === 'true' || q === 'yes';
    } catch (e) { return false; }
  })();
  if (PRODUCT_VIEW) document.documentElement.setAttribute('data-product-view', '1');

  /* ── truth ── */
  var truthEl = document.getElementById('qa-truth');
  if (!truthEl) throw new Error('figma-chrome: 缺 <script id="qa-truth"> 内嵌真值块');
  var RAW_TRUTH = JSON.parse(truthEl.textContent);
  function unwrap(n) {
    if (n && typeof n === 'object' && !Array.isArray(n) && 'value' in n && n.provenance) return n.value;
    if (Array.isArray(n)) return n.map(unwrap);
    if (n && typeof n === 'object') {
      var o = {};
      for (var k in n) if (Object.prototype.hasOwnProperty.call(n, k)) o[k] = unwrap(n[k]);
      return o;
    }
    return n;
  }
  var TRUTH = unwrap(RAW_TRUTH);

  /* Motion adapter is an explicit demo opt-in generated from motion.config.json
     by figma-inline. Missing config intentionally means no official-motion claim. */
  var MOTION = (function () {
    var el = document.getElementById('qa-motion');
    if (!el || !el.textContent.trim()) return null;
    var cfg = JSON.parse(el.textContent);
    if (cfg.schema !== 'figma-motion-opt-in/v1' || !cfg.adapter || !cfg.adapter.template) {
      throw new Error('figma-chrome: qa-motion 不是合法 figma-motion-opt-in/v1');
    }
    return Object.assign({}, cfg.adapter, { roleResolution: cfg.roleResolution || null });
  })();

  /* ── 设备预设：一律来自 fixtures/device-presets.json（由 index.html 内嵌）── */
  var PRESETS = (function () {
    var el = document.getElementById('qa-devices');
    if (!el || !el.textContent.trim()) {
      throw new Error('figma-chrome: 缺 <script id="qa-devices"> 设备预设块（来自 figma-harness-kit）');
    }
    return JSON.parse(el.textContent);
  })();

  var GROUPS = PRESETS.deviceGroups || [];
  var BREAKPOINTS = PRESETS.breakpoints || [];
  var FREE = { name: '自由状态', free: true };

  /* ── 状态 ── */
  var STORE_KEY = 'qa-hifi:' + cfg.name + ':prefs';
  var S = {
    groupIdx: 0,
    devIdx: 0,
    freeW: 0,
    freeH: 0,
    fit: true,    /* 视图层缩放适配窗口（frame 仍按 1920 布局，视觉缩到窗口内可见含 rail）；取消勾选=1:1 像素级验收 */
    grid: false,
    /* 平铺只渲染用户选中的、且确实由 cfg 声明的状态。初始化留空，
       buildBar2 会按 cfg.states/tabStates 建立全选集合。 */
    stateSubset: {},
    orientation: 'portrait',
    prefs: {},
    state: cfg.initialState,
  };
  // 默认落在 PC 组的 defaultIndex（规范：切入 PC 不要一进来就是 4K）
  (function initDevice() {
    for (var i = 0; i < GROUPS.length; i++) {
      if (GROUPS[i].key === 'PC') { S.groupIdx = i; S.devIdx = GROUPS[i].defaultIndex || 0; break; }
    }
    var d = curDev();
    S.freeW = d && d.width ? d.width : 1920;
    S.freeH = d && d.height ? d.height : 1080;
  })();

  for (var pk in cfg.defaultPrefs) S.prefs[pk] = cfg.defaultPrefs[pk];
  try {
    var stored = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (stored) for (var sk in stored) if (sk in S.prefs) S.prefs[sk] = stored[sk];
  } catch (e) { /* 存不了就用默认，不阻断 */ }

  function curGroup() { return GROUPS[S.groupIdx] || GROUPS[0]; }
  function curDev() {
    var g = curGroup();
    if (!g) return null;
    if (S.devIdx < 0 || S.devIdx >= g.devices.length) return FREE;
    return g.devices[S.devIdx];
  }
  function isFree() { return S.devIdx < 0; }
  function canResize() { return !!(curGroup() && curGroup().freeResize); }
  function orientationOf(d) {
    if (!d || !d.width || !d.height) return 'portrait';
    return d.width >= d.height ? 'landscape' : 'portrait';
  }
  function orientedDevice(d) {
    if (!d || S.orientation !== 'landscape' || !d.width || !d.height) return d;
    return Object.assign({}, d, { width: d.height, height: d.width, orientation: 'landscape' });
  }
  function canOrient() {
    var g = curGroup();
    return !!(g && g.key !== 'PC' && !isFree() && curDev() && curDev().width && curDev().height);
  }
  function viewport() {
    var d = orientedDevice(curDev());
    if (isFree() || !d || !d.width) return { w: S.freeW, h: S.freeH, dpr: 1, src: '自由状态', orientation: S.orientation };
    return { w: d.width, h: d.height, dpr: d.dpr || 1, src: '机型锁定', orientation: S.orientation };
  }
  function bpOf(w) {
    for (var i = 0; i < BREAKPOINTS.length; i++) {
      var b = BREAKPOINTS[i];
      if (w >= b.min && (b.max == null || w <= b.max)) return b;
    }
    return { key: '?', label: '?' };
  }
  function presetMetric(axis, fallback, reducer) {
    var vals = [];
    (GROUPS || []).forEach(function (g) {
      (g.devices || []).forEach(function (d) {
        var v = Number(axis === 'w' ? d.width : d.height);
        if (isFinite(v) && v > 0) vals.push(v);
      });
    });
    ((PRESETS.otherReference || {}).devices || []).forEach(function (d) {
      var v = Number(axis === 'w' ? d.width : d.height);
      if (isFinite(v) && v > 0) vals.push(v);
    });
    return vals.length ? vals.reduce(reducer) : fallback;
  }
  var VIEWPORT_MIN_W = presetMetric('w', 240, function (a, b) { return Math.min(a, b); });
  var VIEWPORT_MIN_H = presetMetric('h', 240, function (a, b) { return Math.min(a, b); });
  var VIEWPORT_MAX_W = Math.max(3840, presetMetric('w', 3840, function (a, b) { return Math.max(a, b); }));
  var VIEWPORT_MAX_H = Math.max(8000, presetMetric('h', 8000, function (a, b) { return Math.max(a, b); }));
  function clampViewportW(v) { return clamp(v, VIEWPORT_MIN_W, VIEWPORT_MAX_W); }
  function clampViewportH(v) { return clamp(v, VIEWPORT_MIN_H, VIEWPORT_MAX_H); }

  /* plat ⟷ 视口断点的换算（任务 17）。断点只读 PRESETS.breakpoints —— 那是
     kit 断点真源在页面里的唯一副本（经 #qa-devices 内嵌），壳里不另写一份。 */
  function platOfWidth(w) {
    var bp = bpOf(w);
    return bp.key === 'mobile' ? 'mobile' : bp.key === 'tablet' ? 'pad' : bp.key === 'desktop' ? 'pc' : null;
  }
  /* 手动点 plat 档 → 切到该断点的代表设备（视口与稿别不许分叉）。
     没有对应断点的设备组时退到自由状态代表宽（390/768/1920 是区间代表值，不是断点）。 */
  function syncDeviceToPlat(p) {
    for (var i = 0; i < GROUPS.length; i++) {
      var d = GROUPS[i].devices[GROUPS[i].defaultIndex || 0];
      if (d && d.width && platOfWidth(d.width) === p) {
        S.groupIdx = i; S.devIdx = GROUPS[i].defaultIndex || 0;
        S.freeW = d.width; S.freeH = d.height;
        return;
      }
    }
    var rep = p === 'mobile' ? [390, 844] : p === 'pad' ? [768, 1024] : [1920, 1080];
    S.devIdx = -1; S.freeW = rep[0]; S.freeH = rep[1];
  }

  /* ── 样式：配色与控件样式照 figma-harness-kit 的 control-bar-demo.html
        （--bar/--acc 等变量原值抄他的，保证跟他那份看起来是同一个东西）── */
  var css = [
    ':root{--bar:#171b22;--bar2:#1e232c;--line:#2b323e;--line2:#39424f;',
    '--txt:#e6eaf0;--dim:#8b95a6;--dim2:#616c7d;--acc:#3b82f6;',
    '--ok:#22c55e;--warn:#f59e0b;--err:#ef4444;--stage:#0c0f14;}',
    '*{box-sizing:border-box}',
    'html,body{margin:0;height:100%}',
    'body{background:var(--stage);color:var(--txt);display:flex;flex-direction:column;overflow:hidden;',
    'font:12px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}',
    'button,select,input{font:inherit;color:inherit}',

    '.bar{background:var(--bar);border-bottom:1px solid var(--line);flex:none}',
    '.row{display:flex;align-items:center;gap:18px;padding:9px 16px;flex-wrap:wrap}',
    '.row+.row{border-top:1px solid var(--line);background:var(--bar2)}',
    '.grp{display:flex;align-items:center;gap:7px}',
    '.title{display:flex;flex-direction:column;gap:1px;padding-right:8px;border-right:1px solid var(--line)}',
    '.title b{font-size:13px;font-weight:600}',
    '.title span{font-size:10px;color:var(--dim2)}',
    '.lbl{font-size:11px;color:var(--dim2);white-space:nowrap}',

    '.seg{display:flex;background:#0f131a;border:1px solid var(--line);border-radius:7px;padding:2px;gap:2px}',
    '.seg button{border:0;background:transparent;color:var(--dim);font:inherit;font-size:12px;',
    'padding:4px 11px;border-radius:5px;cursor:pointer;white-space:nowrap;transition:.12s}',
    '.seg button:hover{color:var(--txt);background:#1c222c}',
    '.seg button.on{background:var(--acc);color:#fff;font-weight:500}',

    'select,input[type=number]{background:#0f131a;border:1px solid var(--line);border-radius:6px;',
    'color:var(--txt);font-size:11.5px;padding:5px 8px;outline:none}',
    'select:focus,input:focus{border-color:var(--line2)}',
    'input[type=number]{width:64px;font-variant-numeric:tabular-nums}',
    '.qa-device-select{min-width:196px}.qa-language-select{min-width:172px}.qa-state-select{min-width:186px}',
    'input[type=range]{width:150px;accent-color:var(--acc)}',
    '[disabled]{opacity:.35;cursor:not-allowed}',

    '.btn{border:1px solid var(--line);background:#0f131a;color:var(--dim);font:inherit;font-size:11.5px;',
    'padding:5px 10px;border-radius:6px;cursor:pointer;white-space:nowrap}',
    '.btn:hover{border-color:var(--line2);color:var(--txt)}',
    '.btn.on{background:var(--acc);border-color:var(--acc);color:#fff}',

    '.chk{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--dim);cursor:pointer;white-space:nowrap}',
    '.chk input{accent-color:var(--acc)}',

    '.readout{display:flex;align-items:center;gap:9px;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:var(--dim);',
    'background:#0f131a;border:1px solid var(--line);border-radius:6px;padding:5px 10px;',
    'font-variant-numeric:tabular-nums;margin-left:auto}',
    '.readout b{color:#fff;font-weight:600;font-size:12.5px}',
    '.readout .dot{color:var(--dim2)}',
    '.readout .ok{color:var(--ok)}',
    '.readout .err{color:var(--err)}',
    '.readout .acc{color:var(--acc)}',
    /* 历史坑：读数里四处用过 class="bad"，但配色表从没定义过 .bad —— 标红从没红过。
       2026-08-04 统一改用 .err。留这行注释是给后人提个醒：读数配色先查这张表。 */

    '.stage{position:relative;flex:1;min-height:0;overflow:auto;padding:26px 28px 22px;display:flex;justify-content:center;align-items:center}',
    /* 隐藏滚动条视觉但保留滚动能力（2026-08-05 用户红框：右侧页面滚动条 + 最右浏览器/舞台滚动条
       都不要显示；用户自己用滚轮/触控板滚，不需看到滚动条）。
       - 只藏视觉：scrollbar-width:none（Firefox/标准）+ ::-webkit-scrollbar{display:none}（Chromium/WebKit）。
       - 不用 overflow:hidden —— 那会连滚动能力一起砍掉、还可能裁掉内容；overflow 仍保持 auto/scroll，
         滚轮/触控板/触摸板照常改 scrollTop，内容一丝不裁。
       两个滚动容器都处理：外层 .stage（舞台/浏览器滚动条）、内层 .frame（screen 内部整页滚动）。 */
    '.stage,.frame{scrollbar-width:none;-ms-overflow-style:none}',
    '.stage::-webkit-scrollbar,.frame::-webkit-scrollbar{display:none;width:0;height:0}',
    '.stage.tiled{padding:16px;display:block}',
    /* 模拟屏幕容器（2026-08-05 重做）：wrap 即「黑色舞台中的明确模拟屏」。
       深色 bezel 边框 + 阴影，让屏幕边界在深黑舞台上**一眼可见** —— 此前 frame 是纯白矩形
       铺满 stage、边框 1px 几乎看不见，用户分不清「模拟屏」和「舞台」。留白由 stage padding 保留，
       frame 不再顶到 stage 边缘，给 rail 留出右侧可见的舞台区。 */
    '.stage-wrap{flex:0 0 auto;position:relative;display:inline-block;background:#05070a;',
    'border:1px solid #2a3342;border-radius:14px;padding:10px;box-shadow:0 18px 50px rgba(0,0,0,.6)}',
    '.chip{position:absolute;left:10px;top:-21px;font-size:11px;color:var(--dim);white-space:nowrap;',
    'font-variant-numeric:tabular-nums}',
    '.chip b{color:#fff}',
    '.frame{background:#fff;overflow:visible;transform-origin:0 0;border-radius:6px;',
    'box-shadow:0 0 0 1px #000}',
    '.resize-rail{display:flex;align-items:center;gap:7px;color:var(--dim);font-size:11px}',
    '.resize-rail input{width:150px}',
    '.resize-rail .num{color:#fff;font-variant-numeric:tabular-nums;min-width:45px;text-align:center}',
    '.orientation{display:flex;background:#0f131a;border:1px solid var(--line);border-radius:7px;padding:2px;gap:2px}',
    '.orientation button{border:0;background:transparent;color:var(--dim);font:inherit;font-size:11px;padding:4px 9px;border-radius:5px;cursor:pointer}',
    '.orientation button.on{background:var(--acc);color:#fff}',

    '.pop{position:relative}.pop-body{position:absolute;top:calc(100% + 6px);left:0;z-index:60;width:300px;max-height:300px;overflow:auto;background:var(--bar);border:1px solid var(--line2);border-radius:8px;padding:10px;box-shadow:0 18px 44px rgba(0,0,0,.6);display:none}',
    '.pop.open .pop-body{display:block}.pop-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 9px}.pop-grid .chk{font-size:11px;overflow:hidden;text-overflow:ellipsis}',

    '.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}',
    '.card{border:1px solid var(--line);border-radius:9px;background:var(--bar);overflow:hidden}',
    '.card-h{padding:6px 10px;font-size:11px;color:var(--warn);border-bottom:1px solid var(--line);background:#0f131a}',
    '.card-b{height:200px;overflow:hidden;background:#fff;position:relative}',
    /* ── PC 自由模式边缘拖拽把手（2026-08-12）：右缘改宽、下缘改高、右下角同时改宽高。
       三个把手同一 resize 合约和轻路径；锁定机型时一起隐藏。 */
    '.edge-handle{position:absolute;z-index:5;touch-action:none;border-radius:7px;background:transparent;',
    'transition:background .12s ease}',
    '.edge-handle-e{top:0;bottom:0;right:-7px;width:14px;cursor:col-resize}',
    '.edge-handle-s{left:0;right:0;bottom:0;height:14px;cursor:row-resize}',
    '.edge-handle-se{right:-9px;bottom:0;width:18px;height:18px;cursor:nwse-resize;z-index:6}',
    '.edge-handle::after{content:"";position:absolute;top:50%;left:50%;',
    'transform:translate(-50%,-50%);border-radius:2px;background:#3a4656;opacity:.55;',
    'transition:opacity .12s ease,background .12s ease}',
    '.edge-handle-e::after{width:4px;height:44px}',
    '.edge-handle-s::after{width:44px;height:4px}',
    '.edge-handle-se::after{width:10px;height:10px;border-radius:50%}',
    '.edge-handle:hover::after,.edge-handle.dragging::after{background:var(--acc);opacity:1}',
    '.edge-handle.disabled{display:none}',
  ].join('');

  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  /* ── DOM 骨架：类名结构照 control-bar-demo.html（.bar > .row ×2 / .stage > .stage-wrap）── */
  var bar = PRODUCT_VIEW ? null : mk('div', 'bar');
  var row1 = PRODUCT_VIEW ? null : mk('div', 'row');
  var row2 = PRODUCT_VIEW ? null : mk('div', 'row');
  if (bar) { bar.appendChild(row1); bar.appendChild(row2); }
  var stage = mk('div', 'stage');
  var wrap = mk('div', 'stage-wrap');
  var chip = PRODUCT_VIEW ? null : mk('div', 'chip');
  var frame = mk('div', 'frame');
  if (chip) wrap.appendChild(chip);
  wrap.appendChild(frame); stage.appendChild(wrap);

  /* 自由模式边缘拖拽：与 W/H 输入和 slider 同源；pointer-held 期间只走轻路径，
     pointerup 再做一次精确 render。 */
  var resizeHandles = [];
  if (!PRODUCT_VIEW) {
    var edgeHandle = makeResizeHandle('edge-handle-e', 'vertical', '拖拽调整预览宽度', 'width', true, false);
    makeResizeHandle('edge-handle-s', 'horizontal', '拖拽调整预览高度', 'height', false, true);
    makeResizeHandle('edge-handle-se', 'vertical', '拖拽调整预览宽度和高度', 'both', true, true);
  }
  function makeResizeHandle(cls, orientation, label, qaValue, moveX, moveY) {
    var handle = mk('div', 'edge-handle ' + cls + ' disabled');
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', orientation);
    handle.setAttribute('aria-label', label);
    handle.setAttribute('data-qa-edge-resize', qaValue);
    wrap.appendChild(handle);
    resizeHandles.push(handle);
    var drag = null;
    handle.addEventListener('pointerdown', function (e) {
      if (!canResize()) return;
      beginResizeDrag();
      var vp0 = viewport();
      drag = { x0: e.clientX, y0: e.clientY, w0: vp0.w, h0: vp0.h, scale: (typeof S.fitScale === 'number' && S.fitScale > 0) ? S.fitScale : 1 };
      handle.classList.add('dragging');
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* 桩环境无 capture */ }
      e.preventDefault();
    });
    handle.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = (e.clientX - drag.x0) / drag.scale;
      var dy = (e.clientY - drag.y0) / drag.scale;
      if (moveX) S.freeW = clampViewportW(Math.round(drag.w0 + dx));
      if (moveY) S.freeH = clampViewportH(Math.round(drag.h0 + dy));
      S.devIdx = -1;
      scheduleSyncAll();
    });
    var end = function (e) {
      if (!drag) return;
      drag = null;
      handle.classList.remove('dragging');
      try { handle.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      endResizeDrag();   /* 松手强制一次精确完整 render（含锚点恢复） */
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    return handle;
  }
  if (bar) document.body.appendChild(bar);
  document.body.appendChild(stage);

  function mk(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  /** 一组控件：标签 + 控件，横排（同事的 .grp + .lbl） */
  function grp(label, node) {
    var d = mk('div', 'grp');
    if (label) { var l = mk('span', 'lbl'); l.textContent = label; d.appendChild(l); }
    d.appendChild(node);
    return d;
  }
  function seg(items, getOn, onPick, prefKey, prefKeyOf) {
    var s = mk('div', 'seg');
    items.forEach(function (it, i) {
      var b = document.createElement('button');
      b.textContent = it.label;
      /* 合约形态：单属性 data-qa-pref="key:value"（见文件头）。不并存双属性，并存必漂。
         每项 key 需定制时传 prefKeyOf（当前设备组 seg 不再用——它不带 pref）。 */
      var pk = prefKeyOf ? prefKeyOf(it, i) : prefKey;
      if (pk) { b.setAttribute('data-qa-pref', pk + ':' + it.v); }
      if (getOn(it, i)) b.className = 'on';
      b.onclick = function () { onPick(it, i); };
      s.appendChild(b);
    });
    return s;
  }

  /* ── 第一行 · 视口 ── */
  var elDevSel, elFit, elRead1, widthInput, heightInput, resizeRange, elGrid;
  var _lastReadHtml = '';
  var _readPlaceholder = '读数 <b>0000×0000 px</b> · DPR <b>0</b> · desktop（≥1024） · 视图缩放 <b>000.0%</b> · 来源 <b>自由状态</b>';
  function buildBar1() {
    row1.innerHTML = '';
    var brand = mk('div', 'title');
    brand.innerHTML = '<b>' + esc(cfg.title || cfg.name) + '</b><span>figma-acceptance-harness</span>';
    row1.appendChild(brand);

    /* 设备组只负责选机型：label 即组 key，不带 data-qa-pref。
       onPick 只切组/落该组默认设备，不写 prefs.plat —— 它由 syncAll 按视口断点统一重算。 */
    row1.appendChild(grp('设备组', seg(
      GROUPS.map(function (g, i) { return { label: g.key, v: g.key }; }),
      function (it, i) { return i === S.groupIdx; },
      function (it, i) {
        S.groupIdx = i;
        S.devIdx = GROUPS[i].defaultIndex || 0;
        var d = curDev();
        if (d && d.width) { S.freeW = d.width; S.freeH = d.height; }
        syncAll();
      })));

    elDevSel = document.createElement('select');
    elDevSel.className = 'qa-device-select';
    elDevSel.setAttribute('data-qa-device-select', '1');
    elDevSel.onchange = function () {
      S.devIdx = Number(elDevSel.value);
      var d = curDev();
      if (d && d.width) { S.freeW = d.width; S.freeH = d.height; }
      syncAll();
    };
    row1.appendChild(grp('设备', elDevSel));

    /* Kit contract: PC exposes exact W/H inputs plus a width slider. Any
       edit changes the selected PC preset into explicit free state; non-PC
       groups retain the same controls visibly but locked. */
    var sizeControl = mk('div', 'resize-rail');
    var sizeLabel = mk('span', 'lbl'); sizeLabel.textContent = '尺寸'; sizeControl.appendChild(sizeLabel);
    var widthLabel = mk('span', 'lbl'); widthLabel.textContent = 'W'; sizeControl.appendChild(widthLabel);
    widthInput = document.createElement('input'); widthInput.type = 'number'; widthInput.min = String(VIEWPORT_MIN_W); widthInput.max = String(VIEWPORT_MAX_W); widthInput.step = '1';
    widthInput.setAttribute('data-qa-viewport-width-input', 'true');
    widthInput.onchange = function () { S.freeW = clampViewportW(Number(widthInput.value) || viewport().w); S.devIdx = -1; syncAll(); };
    sizeControl.appendChild(widthInput);
    var times = mk('span', 'lbl'); times.textContent = '×'; sizeControl.appendChild(times);
    var heightLabel = mk('span', 'lbl'); heightLabel.textContent = 'H'; sizeControl.appendChild(heightLabel);
    heightInput = document.createElement('input'); heightInput.type = 'number'; heightInput.min = String(VIEWPORT_MIN_H); heightInput.max = String(VIEWPORT_MAX_H); heightInput.step = '1';
    heightInput.setAttribute('data-qa-viewport-height-input', 'true');
    heightInput.onchange = function () { S.freeH = clampViewportH(Number(heightInput.value) || viewport().h); S.devIdx = -1; syncAll(); };
    sizeControl.appendChild(heightInput);
    resizeRange = document.createElement('input'); resizeRange.type = 'range'; resizeRange.min = String(VIEWPORT_MIN_W); resizeRange.max = String(VIEWPORT_MAX_W); resizeRange.step = '1';
    resizeRange.setAttribute('data-qa-viewport-resize', 'width');
    resizeRange.oninput = function () { S.freeW = clampViewportW(Number(resizeRange.value)); S.devIdx = -1; scheduleSyncAll(); };
    /* 滑块拖拽同样走轻路径：pointerdown 进拖拽态，pointerup/cancel 出并强制精确 render。
       键盘方向键微调不触发 pointer 事件，仍走完整 render —— 低频离散操作无需优化。 */
    resizeRange.addEventListener('pointerdown', function () { if (canResize()) beginResizeDrag(); });
    resizeRange.addEventListener('pointerup', endResizeDrag);
    resizeRange.addEventListener('pointercancel', endResizeDrag);
    sizeControl.appendChild(resizeRange); row1.appendChild(sizeControl);

    /* 方向是锁定设备的真实横竖屏交换，不为 PC 自由状态伪造旋转能力。 */
    var orient = mk('div', 'orientation');
    ['portrait', 'landscape'].forEach(function (key) {
      var ob = document.createElement('button'); ob.textContent = key === 'portrait' ? '竖屏' : '横屏';
      ob.setAttribute('data-qa-orientation', key);
      ob.className = key === S.orientation ? 'on' : '';
      ob.disabled = !canOrient();
      ob.onclick = function () { if (!canOrient()) return; S.orientation = key; syncAll(); };
      orient.appendChild(ob);
    });
    row1.appendChild(grp('方向', orient));

    elFit = document.createElement('input'); elFit.type = 'checkbox'; elFit.checked = S.fit;
    elFit.onchange = function () { S.fit = elFit.checked; syncAll(); };
    var fitWrap = mk('label', 'chk'); fitWrap.appendChild(elFit);
    fitWrap.appendChild(document.createTextNode('缩放到可视区'));
    row1.appendChild(grp('视图', fitWrap));

    var vpNow = viewport();
    resizeRange.value = Math.min(VIEWPORT_MAX_W, Math.max(VIEWPORT_MIN_W, vpNow.w));
    widthInput.value = vpNow.w;
    heightInput.value = vpNow.h;

    elRead1 = mk('div', 'readout');
    elRead1.innerHTML = _lastReadHtml || _readPlaceholder;
    row1.appendChild(elRead1);
  }

  /* ── 第二行 · 内容 ── */


  function stateEntries() {
    var entries = [];
    Object.keys(cfg.states || {}).forEach(function (id) {
      var item = cfg.states[id] || {};
      entries.push({ id: id, label: item.label || item.name || id, kind: 'state' });
    });
    (cfg.tabStates || []).forEach(function (item) {
      entries.push({ id: item.id, label: item.label || item.name || item.id, kind: 'tab' });
    });
    return entries;
  }
  function syncStateSubset(entries) {
    entries.forEach(function (entry) {
      if (!Object.prototype.hasOwnProperty.call(S.stateSubset, entry.id)) S.stateSubset[entry.id] = true;
    });
    Object.keys(S.stateSubset).forEach(function (id) {
      if (!entries.some(function (entry) { return entry.id === id; })) delete S.stateSubset[id];
    });
  }
  function selectedStateEntries(entries) {
    return entries.filter(function (entry) { return S.stateSubset[entry.id] !== false; });
  }

  function buildBar2() {
    row2.innerHTML = '';
    var m = cfg.matrix || {};
    /* plat 是声明支持就必须可交互的维度：点某一档 = 切到该断点的代表设备
       （syncDeviceToPlat），syncAll 再按新视口重算 prefs.plat —— 两者同源，
       不可能点完被重算冲掉。2026-08-05 曾尝试把 plat 入口折叠进设备组 seg
       （只给激活组打 data-qa-pref），后果是初始激活 PC 组时 DOM 里根本不存在
       plat:mobile 入口，gateB/C 的 mobile case 点击直接失败；故独立成段。
       通用教训：**矩阵声明的每一维，在 DOM 里每个选项都得有独立可见入口**，
       不能只给当前激活项打 pref —— replay 切换维度靠的是点未激活那项。 */
    var plat = m.plat;
    if (plat) {
      row2.appendChild(grp(plat.label || '平台', seg(plat.options || [],
        function (it) { return S.prefs.plat === it.v; },
        function (it) { syncDeviceToPlat(it.v); syncAll(); }, 'plat')));
    }
    /* OS/主题（m.os/m.mode）不设可见控件（2026-08-10 kit 第二行只保留区域/语言/状态/平铺/复制链接）。
       它们对本页是无视觉声明维：matrix 仅 any/default 单选项、renderApp 不消费——
       设一个永远停在同一档的可见分段控件是给人看的假 UI。自动化用 __qa.setPref 写。
       若将来某页 OS/主题真的改变渲染，须提供一个不污染人工栏的可测机制，不得放回可见 seg。 */
    /* 区域与语言都是内容维度：区域保留 segmented，语言固定使用下拉。
       可选项只读 cfg.matrix，绝不把 kit 中尚未接入的地区/语言伪造成可渲染内容。 */
    var region = m.region;
    if (region) {
      row2.appendChild(grp(region.label || '区域', seg(region.options || [],
        function (it) { return S.prefs.region === it.v; },
        function (it) { S.prefs.region = it.v; persist(); syncAll(); }, 'region')));
    }
    var lang = m.lang;
    if (lang) {
      var langSel = document.createElement('select');
      langSel.className = 'qa-language-select';
      langSel.setAttribute('data-qa-pref-key', 'lang');
      (lang.options || []).forEach(function (it) {
        var op = document.createElement('option'); op.value = it.v; op.textContent = it.label + ' · ' + it.v;
        if (S.prefs.lang === it.v) op.selected = true;
        langSel.appendChild(op);
      });
      langSel.onchange = function () { S.prefs.lang = langSel.value; persist(); syncAll(); };
      row2.appendChild(grp(lang.label || '语言', langSel));
    }

    var entries = stateEntries();
    syncStateSubset(entries);
    var stateCount = entries.length;
    if (stateCount < 2) S.grid = false;
    var stSel = document.createElement('select');
    stSel.className = 'qa-state-select';
    stSel.setAttribute('data-qa-state-select', '1');
    entries.forEach(function (entry) {
      var op = document.createElement('option'); op.value = entry.id; op.textContent = entry.label;
      if (S.state === entry.id) op.selected = true;
      if (entry.kind === 'tab') op.setAttribute('data-qa-state-tab', '1');
      stSel.appendChild(op);
    });
    stSel.disabled = S.grid;
    stSel.onchange = function () { S.state = stSel.value; syncAll(); };

    elGrid = document.createElement('input'); elGrid.type = 'checkbox'; elGrid.checked = S.grid;
    elGrid.setAttribute('data-qa-state-tile', '1');
    elGrid.disabled = stateCount < 2;
    elGrid.title = stateCount < 2 ? '当前 Demo 只有一个可渲染状态' : '';
    elGrid.onchange = function () { S.grid = elGrid.checked; syncAll(); };
    var gw = mk('label', 'chk'); gw.appendChild(elGrid);
    gw.appendChild(document.createTextNode('平铺全部状态'));
    row2.appendChild(grp('状态', stSel));
    row2.appendChild(grp('', gw));

    var sub = mk('div', 'pop');
    var subBtn = document.createElement('button'); subBtn.className = 'btn';
    subBtn.disabled = stateCount < 2;
    subBtn.title = stateCount < 2 ? '当前 Demo 只有一个可渲染状态' : '选择平铺时要检查的状态';
    subBtn.textContent = '勾选子集 (' + selectedStateEntries(entries).length + '/' + stateCount + ')';
    subBtn.onclick = function () { if (!subBtn.disabled) sub.classList.toggle('open'); };
    var subBody = mk('div', 'pop-body');
    var subGrid = mk('div', 'pop-grid');
    entries.forEach(function (entry) {
      var label = mk('label', 'chk');
      var check = document.createElement('input'); check.type = 'checkbox'; check.checked = S.stateSubset[entry.id] !== false;
      check.onchange = function () {
        S.stateSubset[entry.id] = check.checked;
        subBtn.textContent = '勾选子集 (' + selectedStateEntries(entries).length + '/' + stateCount + ')';
      };
      label.appendChild(check); label.appendChild(document.createTextNode(entry.label)); subGrid.appendChild(label);
    });
    subBody.appendChild(subGrid); sub.appendChild(subBtn); sub.appendChild(subBody);
    row2.appendChild(grp('', sub));

    var copyBtn = document.createElement('button');
    copyBtn.textContent = '复制当前组合链接';
    copyBtn.className = 'btn';
    copyBtn.onclick = function () {
      writeHash();
      try {
        navigator.clipboard.writeText(location.href);
        copyBtn.textContent = '已复制 ✓';
        setTimeout(function () { copyBtn.textContent = '复制当前组合链接'; }, 1400);
      } catch (e) { copyBtn.textContent = '复制失败，手动拷地址栏'; }
    };
    row2.appendChild(grp('分享', copyBtn));

  }

  /* ── 渲染 ── */
  function renderInto(container, state) {
    /* 把**被模拟的视口**一起传给渲染层（第 12 项，2026-08-04 实测根因）：
       frame 的 1px 装饰边框让 clientWidth 比视口少 2px（1920→1918），
       若渲染层拿 clientWidth 算缩放，k = 1918/3840 = 0.499479…，
       30px 字号 → 屏幕上 14.984px —— 小数字号栅格化 → 每个字笔画落在不同子像素上，
       就是欣仪反复指出的「字有粗有细有大有小」。视口宽才是几何，装饰边框不是。 */
    var vp = viewport();
    cfg.renderApp({ truth: TRUTH, rawTruth: RAW_TRUTH, prefs: cp(S.prefs), state: state, frame: container,
      viewport: { w: vp.w, h: vp.h, dpr: vp.dpr }, motionAdapter: MOTION });
  }

  /* 字体就绪回调：渲染层重量完缩字号后调这里，让读数（缩字号条数/字宽对账/缺字形）
     反映终态。不接这个钩子的话，读数永远显示"字体 0/3 已加载"——
     实测就是这样：读数在 webfont 加载完成之前算了一次，之后再没人更新过。

     ⚠️ 这里踩过一次：第一版写成 `updateReadouts()`，而真实函数名是
     `updateRead(vp, scale)` 且需要两个参数 —— 调用抛错、被 try{}catch{} 静默吞掉，
     表现为"改了没效果"，而且没有任何报错。所以：
       ① 缓存最后一次的 vp/scale，回调时原样复用（不重建帧，避免 fonts.ready 递归）；
       ② catch 里**必须 console.warn**，不许静默。 */
  var _lastRead = null;
  /* 通用 DPR 感知像素吸附步长（2026-08-11 非整数缩放接缝修复）。
     给壳/渲染层一个统一口径：当前 DPR 下「一个设备像素对应的 CSS 像素步长」。
     dpr=1 → 1；dpr=2 → 0.5；非整数 dpr（1.25/1.5）仍取 CSS 像素 1（内容缩放在
     非整设备像素网格上光栅化属已知底层限制，见 render 层 zoom-rounding 记录）。
     不把某个演示的写死数字下沉到这里 —— 纯 DPR 几何。 */
  window.__fxPixelSnapStep = function (dpr) {
    var d = Number(dpr);
    if (!isFinite(d) || d <= 0) return 1;
    var r = Math.round(d);
    if (Math.abs(d - r) < 1e-6) return 1 / r;   /* 整数 DPR：吸到设备像素网格 */
    return 1;                                   /* 非整数 DPR：吸到 CSS 像素整数 */
  };
  window.__fxOnFontsReady = function () {
    try {
      window.__fxTextIndex = null;
      window.__fxFamilies = null;
      if (_lastRead) updateRead(_lastRead.vp, _lastRead.scale);
    } catch (e) {
      console.warn('[figma-chrome] 字体就绪后重算读数失败：', e && e.message);
    }
  };

  /* ── 所见即所得的页面中心锚点 ──
     视口尺寸变化不是「把长页按总高度比例缩放」：PC 和 mobile 可以有不同的
     section 几何，按比例会把正在看的内容跳到另一段。保存中心点所在的结构
     section 与其局部比例；目标 composition 若换了一套 Figma node id，则按
     source page 的 section paint-order ordinal 对应。这个 ordinal 只作跨稿别
     的结构回退，同稿别永远优先精确 section id。

     两个相邻 section 的中点是独立的 boundary anchor。连续页面里它就是共享
     边界；目标稿有明确段间留白时，它是该留白的语义中线，仍保证「01/02 的
     分界」在视口中心，而不是把任一段的内部位置误当分界。 */
  function centerAnchorStages() {
    if (!frame || !frame.querySelectorAll) return [];
    var frameRect = frame.getBoundingClientRect();
    var visibleH = Number(frame.clientHeight) || 0;
    var visualPerCss = visibleH > 0 ? frameRect.height / visibleH : 1;
    if (!isFinite(visualPerCss) || visualPerCss <= 0) visualPerCss = 1;
    var out = [];
    var list = frame.querySelectorAll('.fx-stage[data-node-id^="section-"]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var rect = el.getBoundingClientRect();
      if (rect.height <= 0 || getComputedStyle(el).display === 'none') continue;
      /* This is explicitly the currently *visible* page point. `rect` includes
         any source-backed scroll/reveal movement; the restoration loop below
         converges after scroll-sensitive transforms rather than preserving a
         hidden pre-animation layout position. */
      var top = frame.scrollTop + (rect.top - frameRect.top) / visualPerCss;
      out.push({
        el: el,
        id: el.getAttribute('data-node-id') || '',
        top: top,
        bottom: top + rect.height / visualPerCss,
      });
    }
    out.sort(function (a, b) { return a.top - b.top; });
    return out;
  }

  function captureCenterAnchor() {
    if (!frame || !(frame.clientHeight > 0)) return null;
    var heroState = frame.getAttribute('data-hero-scroll-state') || '';
    if (frame.getAttribute('data-hero-scroll-slot') === 'active'
        && frame.scrollTop <= 0.5) {
      return { kind: 'hero-progress', progress: 0 };
    }
    if (frame.getAttribute('data-hero-scroll-slot') === 'active'
        && (heroState === 'HERO_LOCKED' || heroState === 'HERO_EXITING')) {
      var heroProgress = Number(frame.getAttribute('data-hero-scroll-progress'));
      return {
        kind: 'hero-progress',
        progress: isFinite(heroProgress) ? Math.max(0, Math.min(1, heroProgress)) : 0,
      };
    }
    var releasedGuard = null;
    if (frame.getAttribute('data-hero-scroll-slot') === 'active'
        && heroState === 'CONTENT_RELEASED') {
      var releasedDistance = Number(frame.getAttribute('data-hero-slot-release-scroll'));
      releasedGuard = {
        beyondRelease: Math.max(0, frame.scrollTop - (isFinite(releasedDistance) ? releasedDistance : 0)),
      };
      if ((!isFinite(releasedDistance) || releasedDistance <= 1) && frame.scrollTop > 0.5) {
        return { kind: 'hero-released', beyondRelease: releasedGuard.beyondRelease, releasedGuard: releasedGuard };
      }
    }
    var attachReleasedGuard = function (anchor) {
      if (anchor && releasedGuard) anchor.releasedGuard = releasedGuard;
      return anchor;
    };
    var stages = centerAnchorStages();
    var center = frame.scrollTop + frame.clientHeight / 2;
    if (!stages.length) {
      var max = Math.max(0, frame.scrollHeight - frame.clientHeight);
      return attachReleasedGuard({ kind: 'page-ratio', ratio: max > 0 ? frame.scrollTop / max : 0 });
    }
    /* Boundary wins only when the center is actually on it. That avoids
       changing an ordinary near-edge section point into a boundary anchor. */
    var nearest = null;
    for (var i = 0; i < stages.length - 1; i++) {
      var seam = (stages[i].bottom + stages[i + 1].top) / 2;
      var distance = Math.abs(seam - center);
      if (!nearest || distance < nearest.distance) nearest = { index: i, seam: seam, distance: distance };
    }
    if (nearest && nearest.distance <= 1.25) {
      return attachReleasedGuard({
        kind: 'boundary',
        beforeId: stages[nearest.index].id, afterId: stages[nearest.index + 1].id,
        beforeOrdinal: nearest.index, afterOrdinal: nearest.index + 1,
      });
    }
    var chosen = null;
    for (var j = 0; j < stages.length; j++) {
      if (center >= stages[j].top && center <= stages[j].bottom) { chosen = { stage: stages[j], ordinal: j }; break; }
    }
    if (!chosen) {
      /* A genuine source gap without a boundary-center anchor: retain the
         nearest section edge as its local position rather than global ratio. */
      var best = null;
      for (var k = 0; k < stages.length; k++) {
        var local = Math.max(0, Math.min(1, (center - stages[k].top) / Math.max(1e-6, stages[k].bottom - stages[k].top)));
        var edgeDistance = Math.abs((stages[k].top + local * (stages[k].bottom - stages[k].top)) - center);
        if (!best || edgeDistance < best.distance) best = { stage: stages[k], ordinal: k, local: local, distance: edgeDistance };
      }
      chosen = best;
    }
    return attachReleasedGuard({
      kind: 'section', id: chosen.stage.id, ordinal: chosen.ordinal,
      local: chosen.local != null ? chosen.local : (center - chosen.stage.top) / Math.max(1e-6, chosen.stage.bottom - chosen.stage.top),
    });
  }

  function anchorStage(anchor, stages, idField, ordinalField) {
    var id = anchor[idField];
    for (var i = 0; i < stages.length; i++) if (id && stages[i].id === id) return stages[i];
    var ordinal = Number(anchor[ordinalField]);
    return Number.isInteger(ordinal) && stages[ordinal] ? stages[ordinal] : null;
  }

  function restoreCenterAnchor(anchor) {
    if (!anchor || !frame || !(frame.clientHeight > 0)) return false;
    if (anchor.kind === 'hero-progress') {
      var release = Number(frame.getAttribute('data-hero-slot-release-scroll'));
      if (!isFinite(release) || release < 0) release = 0;
      var progress = Math.max(0, Math.min(1, Number(anchor.progress) || 0));
      setCenterAnchorScrollTop(release * progress);
      return true;
    }
    if (anchor.kind === 'hero-released') {
      var release1 = Number(frame.getAttribute('data-hero-slot-release-scroll'));
      if (!isFinite(release1) || release1 < 0) release1 = 0;
      var beyond = Math.max(0, Number(anchor.beyondRelease) || 0);
      var maxRelease = Math.max(0, frame.scrollHeight - frame.clientHeight);
      setCenterAnchorScrollTop(Math.min(maxRelease, release1 + beyond));
      return true;
    }
    if (anchor.kind === 'page-ratio') {
      var max0 = Math.max(0, frame.scrollHeight - frame.clientHeight);
      setCenterAnchorScrollTop(Math.max(0, Math.min(max0, Math.max(0, Math.min(1, Number(anchor.ratio) || 0)) * max0)));
      enforceReleasedGuard(anchor);
      return true;
    }
    /* Some source-backed hero/reveal effects make a section's visual rect
       depend on scrollTop. Iterate a few inexpensive geometry reads so the
       actual painted point, not an assumed linear rect, reaches the center. */
    var restored = false;
    for (var attempt = 0; attempt < 4; attempt++) {
      var stages = centerAnchorStages();
      var target = null;
      if (anchor.kind === 'boundary') {
        var before = anchorStage(anchor, stages, 'beforeId', 'beforeOrdinal');
        var after = anchorStage(anchor, stages, 'afterId', 'afterOrdinal');
        if (before && after) target = (before.bottom + after.top) / 2;
        else if (before) target = before.bottom;
        else if (after) target = after.top;
      } else if (anchor.kind === 'section') {
        var stage = anchorStage(anchor, stages, 'id', 'ordinal');
        if (stage) {
          var local = Number(anchor.local);
          if (!isFinite(local)) local = 0;
          target = stage.top + Math.max(0, Math.min(1, local)) * (stage.bottom - stage.top);
        }
      }
      if (!isFinite(target)) return restored;
      var center = frame.scrollTop + frame.clientHeight / 2;
      var delta = target - center;
      if (Math.abs(delta) <= 0.25) {
        enforceReleasedGuard(anchor);
        return true;
      }
      var max = Math.max(0, frame.scrollHeight - frame.clientHeight);
      var next = Math.max(0, Math.min(max, frame.scrollTop + delta));
      if (Math.abs(next - frame.scrollTop) <= 0.01) return restored;
      setCenterAnchorScrollTop(next);
      restored = true;
    }
    if (restored) enforceReleasedGuard(anchor);
    return restored;
  }

  function enforceReleasedGuard(anchor) {
    if (!anchor || !anchor.releasedGuard || !frame) return;
    var release = Number(frame.getAttribute('data-hero-slot-release-scroll'));
    if (!isFinite(release) || release < 0) release = 0;
    var max = Math.max(0, frame.scrollHeight - frame.clientHeight);
    var beyond = Math.max(0, Number(anchor.releasedGuard.beyondRelease) || 0);
    var target = Math.min(max, release + beyond);
    if (frame.scrollTop + 0.5 < target) {
      setCenterAnchorScrollTop(target);
    }
  }

  var _centerAnchorRenderToken = 0;
  var _centerAnchorExpectedScroll = null;
  var _staticKvChromeFrame = null;
  function setCenterAnchorScrollTop(value) {
    _centerAnchorExpectedScroll = value;
    frame.scrollTop = value;
  }
  function settleCenterAnchor(anchor, token) {
    if (!anchor || typeof setTimeout !== 'function') return;
    /* Source-backed reveal/parallax can apply its final scroll-sensitive pose
       on the next frames. Re-read that visible geometry once it settles; a
       later resize/drag invalidates this callback through the render token. */
    [240, 360, 480].forEach(function (delay) {
      setTimeout(function () {
        if (token !== _centerAnchorRenderToken) return;
        restoreCenterAnchor(anchor);
      }, delay);
    });
  }

  function scheduleStaticKvChromeSync() {
    if (_staticKvChromeFrame != null) return;
    var raf = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : function (fn) { return setTimeout(fn, 0); };
    _staticKvChromeFrame = raf(function () {
      _staticKvChromeFrame = null;
      syncStaticKvChrome(viewport());
    });
  }

  function render() {
    var vp = viewport();
    /* Drag owns one stable semantic anchor from pointerdown through pointerup.
       A breakpoint render during the drag must consume that same page point,
       never recapture a temporary PC/mobile visual scale as a new anchor. */
    var _centerAnchor = _pendingCenterAnchor || (_resizeDragActive && _dragCenterAnchor) || captureCenterAnchor();
    var _renderToken = ++_centerAnchorRenderToken;
    /* ── resize 拖拽轻路径判定 ──
       仅在「连续、同模式的 edge-drag / slider 拖动」期间跳过 renderInto：此时只有
       viewport 几何在变，内容结构/语言/状态/设备组都不变，全量重建纯属浪费
       （2026-08-11 实测拖拽每 pointermove 重建 2.7 万条 DOM、长帧 230ms）。
       拖拽中只更新 frame 几何 + 读数；松手（endResizeDrag）或断点切换时
       _forceFullRender 置位，强制一次精确完整 render。
       非拖拽的 resize（窗口拉伸、W/H 数字框）仍走完整 render —— 它们是低频离散事件。 */
    var _skipContentRebuild = !!_resizeDragActive && !_forceFullRender && !S.grid;
    /* A breakpoint label is not itself a composition boundary: pad may reuse
       the PC truth, while a native mobile tree is structurally different.
       The light drag path is legal only when the actual renderer base remains
       the same. This prevents mobile DOM from being merely enlarged on a
       mobile→PC drag. */
    var _targetCompositionKey = compositionKeyForViewport(vp);
    if (_skipContentRebuild && _lastCompositionKey && _lastCompositionKey !== _targetCompositionKey) {
      _skipContentRebuild = false;
    }
    var scale = 1;
    /* ── 适配缩放：能 1:1 就绝不缩 ──
     *
     * 2026-08-04 实测的真问题：舞台原本写死 `stage.clientWidth - 40`（左右各 20px 留白），
     * 于是浏览器窗口 1920 + 模拟视口 1920 时 avail=1880 < 1920 → 强制 scale(0.97917)。
     * 后果不是"小一点"，是**所有字形在非整数倍下重新光栅化** —— 欣仪反复指出的
     * 「字有大有小」「感觉被压缩了」正是这么来的。而当时壳的读数只报 zoom=0.5，
     * 把这层 0.979 完全藏住了，两边都"绿"。
     *
     * 口径改成三段，优先级从高到低：
     *   ① 连留白一起算都放得下 → scale=1，留白照留（最理想）
     *   ② 只是留白挡住了 1:1  → **留白让位**（padding 归 0），scale=1
     *      —— 留白是给人看着舒服的装饰，1:1 是验收的前提，装饰不许压过前提
     *   ③ 窗口真的比视口窄   → 只能缩，但必须在读数里报出来（见 updateRead 的「显示比例」）
     */
    var padPx = 0;
    try {
      var scs = getComputedStyle(stage);
      padPx = (parseFloat(scs.paddingLeft) || 0) + (parseFloat(scs.paddingRight) || 0);
    } catch (e) { padPx = 0; }
    stage.style.paddingLeft = ''; stage.style.paddingRight = '';   // 先复原，免得上一轮的让位残留
    /* 所见即 viewport（2026-08-05，修「标 1920 却视觉 81% 无说明缩放」）：
       默认 **不缩**（scale=1），frame 始终按真实 viewport 宽渲染，超出让 stage 滚动 ——
       标 1920 看到的就是 1920 宽的屏，而不是被偷偷缩到 1556 还没说明。
       「缩放到可视区」只在用户**显式勾选** S.fit 时才缩，且读数如实报出缩放比（见 updateRead）。
       rail 在屏幕容器右缘外侧，需要约 24px 的舞台区 —— 从 stage padding 让位，不动 frame 几何。 */
    if (S.fit) {
      var box = stage.clientWidth;              // 含内边距的内框宽
      if (vp.w > box - padPx && vp.w <= box) {
        // 只差留白：让位，换来 1:1
        stage.style.paddingLeft = '0px'; stage.style.paddingRight = '0px';
        scale = 1;
      } else if (box - padPx > 0 && vp.w > box) {
        /* 窗口真不够宽：视图层缩放到窗口内。给 rail 让出 30px 舞台区（rail 在屏幕右缘外侧），
           不然 rail 会被顶到窗口右边缘外不可见 —— 这不是装饰留白，是 rail 的生存空间。 */
        var RAIL_ROOM = 44;   /* 把手容器 34px + 外侧间距 6px + 余量，整体在屏幕右缘外侧舞台区 */
        scale = (box - padPx - RAIL_ROOM) / vp.w;
      }
      /* 高度方向同样要装下完整 screen。用 stage 的可见盒做同一口径，
         拖拽轻路径和松手完整 render 才不会因为 toolbar/layout 时机不同
         在 pointerup 产生视觉跳变。 */
      var BEZEL0 = 22;
      var VERTICAL_STAGE_ROOM = 24;
      var availH = stage.clientHeight;
      if (availH > 0) {
        var scaleH = (availH - VERTICAL_STAGE_ROOM) / (vp.h + BEZEL0);   /* 留足 stage 呼吸空间，避免把手/屏幕贴边 */
        if (scaleH < scale) scale = scaleH;
      }
    }
    S.fitScale = scale;   // 供读数与 inspect() 现读，不另存一份配置
    if (S.grid) {
      stage.classList.add('tiled');
      wrap.style.display = 'none';
      var g = document.getElementById('sh-tiles') || mk('div', 'tiles');
      g.id = 'sh-tiles'; g.innerHTML = '';
      var all = selectedStateEntries(stateEntries()).map(function (entry) { return entry.id; });
      all.forEach(function (id) {
        var cell = mk('div', 'card');
        var h = mk('div', 'card-h'); h.textContent = id; cell.appendChild(h);
        var b = mk('div', 'card-b');
        var inner = mk('div', 'frame');
        inner.style.width = vp.w + 'px'; inner.style.height = vp.h + 'px';
        var k = 296 / vp.w;
        inner.style.transform = 'scale(' + k + ')';
        inner.style.boxShadow = 'none'; inner.style.border = '0';
        b.appendChild(inner); cell.appendChild(b); g.appendChild(cell);
        renderInto(inner, id);
      });
      if (!g.parentNode) stage.appendChild(g);
      updateRead(vp, scale);
      _forceFullRender = false;   /* grid 永不走轻路径，完整 render 后即清强制标志 */
      return;
    }
    var gEl = document.getElementById('sh-tiles');
    if (gEl && gEl.parentNode) gEl.parentNode.removeChild(gEl);
    stage.classList.remove('tiled');
    wrap.style.display = '';

    frame.style.width = vp.w + 'px';
    /* screen 即独立模拟 viewport（2026-08-05 用户红框：页面不能上下顶天立地）。
       frame 固定可视尺寸 = viewport（宽 vp.w、高 vp.h），全页多分区内容在 frame **内部纵向滚动**
       （overflow-y:auto），外层 stage 只装一屏高的屏幕容器、四周留黑色呼吸空间 —— 不再被整页
       内容高度撑满。PC 拖拽改 H 时 vp.h 变、screen 可视高跟着变；非 PC 随 preset 高度变。 */
    frame.style.height = vp.h + 'px';
    frame.style.overflowY = 'auto';
    frame.style.overflowX = 'hidden';
    frame.style.transform = 'scale(' + scale + ')';
    /* wrap 是屏幕容器（bezel：1px border + 10px padding 四边）。全局 box-sizing:border-box，
       style.width 是边框盒宽 —— 必须加上 bezel 的 22px（左右各 1px border + 10px padding），
       不然 frame 会把 bezel 吃掉（内容区被压窄、frame 溢出 wrap 右缘，2026-08-05 实测 frame 比
       wrap 内容宽 22px、屏面顶到 bezel 边上）。读数与 rail 都按 wrap.getBoundingClientRect() 现测，
       与这里的像素严格同源。 */
    var BEZEL = 22;   /* (1 border + 10 padding) × 2 边 */
    wrap.style.width = Math.round(vp.w * scale + BEZEL) + 'px';
    wrap.style.minHeight = '';
    /* wrap 高度**固定**为缩后 screen 高（含 bezel），不是 auto —— 边框盒严格等于 screen
       尺寸，stage 才能按 wrap 居中、四边等距黑色呼吸空间；frame 固定 vp.h 且内部滚动，
       内容不会再把 wrap 撑高。 */
    wrap.style.height = Math.round(vp.h * scale + BEZEL) + 'px';
    if (_skipContentRebuild) {
      /* 拖拽轻路径：frame 几何（width/height/transform）已在上面更新，DOM 不重建。
         内容仍按「上次完整 render 的视口宽」排版；拖拽期只缩放 frame 的直接
         渲染根（page root + fixed overlay root），绝不再缩放嵌套 section。
         这样页面内容保留自己的横向坐标系，左侧固定导航随 viewport 根贴住边缘，
         section/hero/calendar/later 内容只吃一层与最终 render 同源的缩放。
         用 zoom 不用 transform：transform 不收缩布局占位，内容仍会溢出裁掉；
         zoom 是渲染层既有缩放契约（fx-render 的 zoom-rounding）。
         这是**预览态**：松手/跨断点走完整 render，渲染层按真实新视口重排，
         并清除该临时缩放（见 else 分支），不产生与精确终态叠加的复合缩放。
         纯几何、通用规则，不含任何节点/语言特例。 */
      syncDragContentFollow(vp);
      restoreCenterAnchor(_centerAnchor);
    } else {
      renderInto(frame, S.state);
      /* 完整 render 后记录本轮视口（拖拽临时缩放的分母），并确保无残留临时缩放。
         renderInto 重建了 DOM，新 stage 自带精确 zoom；这里防御性清掉任何
         可能复用旧节点的 __fxBaseZoom 记忆，保证终态严格等于渲染层精确输出。 */
      _lastRenderVp = { w: vp.w, h: vp.h };
      _lastCompositionKey = frame.getAttribute('data-render-base') || _targetCompositionKey;
      if (_resizeDragActive) {
        _dragRootStages = dragFollowRoots();
        _dragSectionLayout = captureDragSectionLayout(vp);
      }
      syncFixedOverlayViewport(vp);
      syncStaticKvChrome(vp);
      /* renderInto 已清空并重建 frame，新的 stage 从渲染层获得精确 zoom，无需额外清理临时属性。 */
      restoreCenterAnchor(_centerAnchor);
      if (_pendingCenterAnchor) _pendingCenterAnchor = null;
      settleCenterAnchor(_centerAnchor, _renderToken);
    }
    /* 本轮完整 render 已完成，清除强制标志，供下一轮判定。 */
    _forceFullRender = false;
    _suppressResizeChromeAnimation = false;
    /* ── 把画框吸附到整数设备像素 ──
     *
     * 2026-08-04 实测：控制栏 .bar 的高度是内容驱动的 102.75px（字号/行高算出来的小数），
     * 于是它下面的一切都坐在 .75 上 —— 画框 top=128.75、分区 top=1209.75。
     * 后果有两层：
     *   ① 每个字形都在半像素边界上重新光栅化（"字有大有小"的另一半原因）；
     *   ② 门 E 的元素截图必须向外扩到整像素才不丢信息，于是高 771.5 的分区
     *      截出 773 行，与稿导出的 772 行基线**尺寸不一致，门直接 ERROR**。
     *
     * 修法不是去调栏高（内容驱动的高度会随字体/语言再变，治不住），
     * 而是**画框自己量一次、把小数补掉**：纯几何、与栏里放什么无关。
     * 只在 1:1 时做 —— 非 1:1 本来就是非整数倍光栅化，吸附没有意义（读数已报警）。
     */
    frame.style.marginTop = '';
    frame.style.marginLeft = '';
    /* 吸附 frame 原点：1:1 与非 1:1 都做（2026-08-11 非整数缩放接缝取证后定下）。
       旧逻辑只在 1:1 吸附；实测非 1:1 时 frame 原点也会落在非整数 CSS 像素（如 .625）。
       吸附的是**壳的 frame 原点**（transform-origin 0 0 的渲染起点），属纯展示对位 ——
       不改 owner 坐标/相对几何，只把整条内容随 frame 平移到取整步长网格。
       边界要说清：这**消除不了 BG alpha 瓦片行的滚动接缝**。接缝根因是最终有效缩放
       （frame scale × page-stage zoom = 0.3979）非整数，使设计坐标整数瓦片行经缩放后落在
       子像素网格、滚动 +1 跨像素重采样 —— 那只能在「整数友好缩放」层解决，会改可视区几何，
       超出本壳边界。此处能做的是一致、DPR 感知、可审计的原点对位 + 把接缝风险如实上报
       （见 inspect().pixelAlignment），不静默移位、不用底色/叠层遮缝。
       取整步长走通用 fxPixelSnapStep（DPR 感知），就近吸附、位移限在半个步长内。 */
    try {
      var dpr0 = (typeof window !== 'undefined' && window.devicePixelRatio) || (vp && vp.dpr) || 1;
      var step0 = (typeof window !== 'undefined' && window.__fxPixelSnapStep) ? window.__fxPixelSnapStep(dpr0) : 1;
      /* 上面把 margin 复位成 '' 后必须强制一次同步 reflow，否则 getBoundingClientRect
         读到的是含上一轮 margin 的过期几何 → 算出的吸附值差了一个旧 margin，实测 marginTop
         停在 0.125px、原点仍 0.75。读 offsetTop 触发 layout flush，再测才是复位后的真值。 */
      void frame.offsetTop;
      var fr0 = frame.getBoundingClientRect();
      /* 就近吸附到 step 网格，返回位移 = 吸附后坐标 − 当前坐标（镜像 scripts/lib/pixel-snap.mjs 的
         snapAxisDelta；离线模板不能 import ESM，故内联同逻辑 —— 改动要两边同步，见 pixel-snap.test）。 */
      var snapAxis = function (v) {
        var lo = Math.floor(v / step0) * step0;
        var fr = v - lo; if (fr < 1e-6) return 0;
        return fr >= step0 / 2 ? step0 - fr : -fr;
      };
      var dt = snapAxis(fr0.top), dl = snapAxis(fr0.left);
      if (Math.abs(dt) > 1e-6) frame.style.marginTop = dt.toFixed(4) + 'px';
      if (Math.abs(dl) > 1e-6) frame.style.marginLeft = dl.toFixed(4) + 'px';
      /* 证据：把本次嵌套缩放链的整数友好度记下来，供 inspect() 只读上报。
         有效缩放 = frame scale × page-stage zoom；其 ×3840（1 设计 px 的物理像素数）
         非整数即「alpha 瓦片行会失配」的接缝风险 —— 如实上报，不在此改几何。 */
      try {
        var ps = document.querySelector('.frame .fx-stage[data-node="__page__"]') || document.querySelector('.frame .fx-stage');
        var pz = ps ? parseFloat(getComputedStyle(ps).zoom) : 1;
        if (!isFinite(pz) || pz <= 0) pz = 1;
        var effK = scale * pz;
        var phys = effK * 3840;   /* 1 设计 px → 物理 CSS px（designWidth 3840 为 PC 基线） */
        window.__fxPixelAlign = {
          effectiveK: +effK.toFixed(6),
          integerFriendly: Math.abs(phys - Math.round(phys)) < 1e-2,
          driftPerTile: +Math.abs(phys - Math.round(phys)).toFixed(6),
          originSnapped: (Math.abs(dt) > 1e-6 || Math.abs(dl) > 1e-6),
          snapStep: step0, dpr: dpr0,
          seamRisk: Math.abs(phys - Math.round(phys)) >= 1e-2,
        };
      } catch (e2) { /* 证据缺失不阻塞渲染 */ }
    } catch (e) { /* 没有布局引擎（Node 桩）时跳过，不影响断言 */ }
    updateRead(vp, scale);
  }

  /* ── 读数：一律现测 DOM，不读配置数字 ── */
  function updateRead(vp, scale) {
    _lastRead = { vp: vp, scale: scale };   // 供 __fxOnFontsReady 复用，见上面的说明
    if (PRODUCT_VIEW) return;               // 产品视图没有 chip/elRead1,读数只留在 _lastRead
    var bp = bpOf(vp.w);
    var d = curDev();
    var devName = isFree() ? '自由状态' : (d && d.name) || '?';
    chip.innerHTML = '<b>' + vp.w + ' × ' + vp.h + '</b> px · ' + esc(devName) +
      ' · 断点 <b>' + esc(bp.key) + '</b> · 视图缩放 ' + Math.round(scale * 100) + '%';

    // 现测：根 font-size（线上契约 1rem = 10vw；预览帧不是视口，故只报实测值不做期望断言）
    var rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 0;

    /* 屏幕读数与可见 frame 几何同源（2026-08-05）：不再只读 vp.w 配置值，
       现测 frame 的实际渲染像素宽 —— 标 1920 就必须所见 1920；若实际被缩了，
       「实际可见宽」会立刻和「视口」分叉，一眼可见，不再是小字里藏一个 81%。 */
    var actualW = 0;
    try { actualW = Math.round(frame.getBoundingClientRect().width); } catch (e) { actualW = 0; }
    var sameAsDesign = Math.abs(actualW - vp.w * scale) < 1.5;
    _lastReadHtml =
      '读数 <b>' + vp.w + '×' + vp.h + ' px</b>' +
      ' · DPR <b>' + vp.dpr + '</b>' +
      ' · ' + esc(bp.label || bp.key) +
      ' · 视图缩放 <b class="' + (Math.abs(scale - 1) < 1e-6 ? 'ok' : 'err') + '">' + (scale * 100).toFixed(1) + '%</b>' +
      ' · 来源 <b>' + esc(vp.src) + '</b>';
    elRead1.innerHTML = _lastReadHtml;

    // DOM 问题标记由 __qa.inspect() 按需读取；不要在每次 render 的 readout 热路径重复遍历。
  }

  /* ══ 字宽对账：证明"字体真的生效了"，而不是浏览器偷偷换了字体 ══
   *
   * 稿里每个节点都带 absoluteRenderBounds —— Figma 用真字体画出来的**墨迹**外框。
   * 这里用 Range 量出浏览器实际画出的文字宽度，跟它比。
   *   字体装对了 → 偏差通常 < 1%
   *   字体没生效、被换成苹方/雅黑 → 偏差往往 5%~20%，一眼可见
   * 于是"字体对不对"从"人瞪着看"变成一个可断言的数字。
   *
   * 只对账「渲染文字 == 稿内原文」的节点：换了语言之后文字不同，
   * 拿日语的宽度跟简中的墨迹框比毫无意义，那种直接不计入（宁可不报，不报错数）。
   *
   * 缩放系数从 stage 的 computed transform 里现读，不从任何配置读 ——
   * 配置写错时读数会跟着错，那就成了自证。 */
  function fontFidelity() {
    var res = { checked: 0, over: 0, worstPct: 0, worstName: '', skipped: 0, fonts: [], fontsMissing: 0 };
    if (!window.__fxTextIndex) {
      var idx = {};
      var fams = {};
      var secs = (TRUTH && TRUTH.sections) || {};
      for (var sid in secs) {
        var list = secs[sid].nodes || [];
        if (!list.length && typeof list === 'object') { var t = []; for (var q in list) t.push(list[q]); list = t; }
        for (var i = 0; i < list.length; i++) {
          var n = list[i];
          if (!n || !n.text) continue;
          // box 一并存下：溢出清单要拿稿框高（box.h）当判据，墨迹框（renderBox）管字宽对账
          if (n.renderBox) idx[n.id] = { rb: n.renderBox, box: n.box, chars: n.text.characters, name: n.name };
          if (n.text.fontFamily) {
            var key = (n.text.fontWeight || 400) + '|' + n.text.fontFamily;
            if (!fams[key]) fams[key] = { family: n.text.fontFamily, weight: n.text.fontWeight || 400, chars: '' };
            // 攒起这个字体要显示的全部字符，用来查字形覆盖（见下）
            fams[key].chars += String(n.text.characters || '');
          }
        }
      }
      window.__fxTextIndex = idx;
      window.__fxFamilies = fams;
    }

    /* ── 字体到底加载上了没有：直接问浏览器 ──
     *
     * 这比"比宽度"直接得多，而且**与显示什么文字无关**。
     * 之前只有比宽度这一条路，它要求"显示的文字 == 稿内原文"才能比；
     * 人工指认之后标题显示的是表里的写法，于是那条对账被跳过 ——
     * 等于字体保真度在最显眼的那个节点上失去了监控。这就是那个盲区。
     *
     * document.fonts.check() 回答的是"这个 family+weight 现在可用吗"。
     * 它为 false 的典型原因：@font-face 的 url 没加载成功（例如 file:// 下被拦），
     * 或者 family 名与稿里写的不一致。两种都是真问题，都必须能被看见。 */
    /* 先确认环境**有**这个 API。没有就一条都不报（读数显示"测不到"）。
       踩过：Node 冒烟桩里 document.fonts 不存在，check 抛错被当成"字体没加载"，
       于是报出"缺 3 个字体"——那是假警报，比不报更糟。 */
    if (document.fonts && typeof document.fonts.check === 'function') {
      for (var k in (window.__fxFamilies || {})) {
        var f = window.__fxFamilies[k];
        var spec = f.weight + ' 100px "' + f.family + '"';
        var ok = false;
        try { ok = document.fonts.check(spec); } catch (e) { ok = false; }

        /* ═══ 字形覆盖：这个字体**认不认**它要显示的每一个字 ═══
         *
         * document.fonts.check(font, text) 的第二个参数是要检的文本：
         * 只要有一个字符这个字体没有，就返回 false。
         *
         * 为什么必须查：字体缺某个字形时，浏览器会**逐字回退**到别的字体，
         * 而回退字体的字宽、笔画粗细都不同 —— 页面上看到的就是"一行字里有大有小"。
         * 它不报错、不空白，只是难看，而且换语言后哪些字缺是变的。
         * 逐字找出来才能决定：换字体、补子集，还是登记为已知偏差。 */
        var missChars = '';
        try {
          var uniq = {}, arr = String(f.chars || '').split('');
          for (var ci = 0; ci < arr.length; ci++) {
            var ch = arr[ci];
            if (uniq[ch] || ch === '\n' || ch === ' ') continue;
            uniq[ch] = 1;
            if (!document.fonts.check(spec, ch)) missChars += ch;
          }
        } catch (e) { /* 不支持第二参数就跳过这一项 */ }

        res.fonts.push({
          family: f.family, weight: f.weight, loaded: !!ok,
          missingGlyphs: missChars, missingCount: missChars.length,
        });
        if (!ok) res.fontsMissing++;
        if (missChars) res.glyphGaps = (res.glyphGaps || 0) + missChars.length;
      }
    }
    var idx2 = window.__fxTextIndex;
    var stage = document.querySelector('.frame .fx-stage');
    if (!stage) return res;
    /* 缩放系数现读 DOM，不读配置（配置写错时读数跟着错 = 自证）。
       2026-08-04 起 stage 用 zoom 缩放（不再是 transform: scale）：
       优先读 computed zoom —— 可能是 '0.3125'、'31.25%' 或 'normal'，三种都要能解析；
       读不到再退回 transform matrix（兼容旧产物/旧模板）；都没有就是未缩放（k=1）。
       ⚠️ 这条断过就会变成"字宽 0 条可对账"的假绿。 */
    var k = 0;
    var cs = window.getComputedStyle(stage);
    var z = cs ? cs.zoom : null;
    if (z != null && z !== '') {
      if (z === 'normal') k = 1;
      else {
        var zn = String(z).indexOf('%') >= 0 ? parseFloat(z) / 100 : parseFloat(z);
        if (isFinite(zn) && zn > 0) k = zn;
      }
    }
    if (!k) {
      var tf = cs ? cs.transform : '';
      var m = /matrix\(([-0-9.eE]+)/.exec(tf || '');
      if (m) k = parseFloat(m[1]) || 0;
    }
    if (!k) k = 1;   // 既无 zoom 也无 transform = 未缩放

    var els = document.querySelectorAll('.frame .fx-t');
    for (var j = 0; j < els.length; j++) {
      var el = els[j];
      var rec = idx2[el.getAttribute('data-node')];
      if (!rec || !rec.rb || !rec.rb.w) continue;
      /* 只比"显示的就是稿内原文"的那些。文字不同就没法比宽度 ——
         拿日语/表里改写过的文字去跟简中原文的墨迹框比，比出来的数没有意义。
         但**跳过了几条必须报出来**：不然"未对账"会被当成"对账通过"。 */
      if (String(el.textContent) !== String(rec.chars)) { res.skipped++; continue; }
      var rg = document.createRange();
      rg.selectNodeContents(el);
      var w = rg.getBoundingClientRect().width / k;
      if (!w) continue;
      var pct = Math.abs(w - rec.rb.w) / rec.rb.w * 100;
      res.checked++;
      if (pct > 2) res.over++;
      if (pct > res.worstPct) { res.worstPct = pct; res.worstName = String(rec.name || '').slice(0, 14); }
    }
    return res;
  }

  /* ── 同步控件可用性 ── */
  function syncToolbar(light) {
    var g = curGroup();
    if (!light) {
      elDevSel.innerHTML = '';
      (g.devices || []).forEach(function (d, i) {
        var op = document.createElement('option');
        op.value = i;
        op.textContent = d.name + '　' + d.width + '×' + d.height + (d.dpr ? ' · DPR ' + d.dpr : '');
        if (i === S.devIdx) op.selected = true;
        elDevSel.appendChild(op);
      });
      if (canResize()) {
        var op2 = document.createElement('option');
        op2.value = -1;
        op2.textContent = '自由状态　' + S.freeW + '×' + S.freeH;
        if (isFree()) op2.selected = true;
        elDevSel.appendChild(op2);
      }
    } else {
      for (var oi = 0; oi < elDevSel.options.length; oi++) {
        var opt = elDevSel.options[oi];
        if (Number(opt.value) === -1) opt.textContent = '自由状态　' + S.freeW + '×' + S.freeH;
        opt.selected = Number(opt.value) === S.devIdx;
      }
      if (isFree()) elDevSel.value = '-1';
    }
    var lock = !canResize();
    [widthInput, heightInput, resizeRange].forEach(function (e) {
      e.disabled = lock;
      e.title = lock ? '仅 PC 设备组可自由拉伸（防止截出不存在的机型宽度）' : '';
    });
    /* 拖拽把手与 slider/W-H 严格同源：同一 canResize() 判定，锁定即隐藏。 */
    for (var hi = 0; hi < resizeHandles.length; hi++) resizeHandles[hi].classList.toggle('disabled', lock);
    var vp = viewport();
    widthInput.value = vp.w;
    heightInput.value = vp.h;
    resizeRange.value = Math.min(VIEWPORT_MAX_W, Math.max(VIEWPORT_MIN_W, vp.w));
  }

  function syncAll() {
    /* 产品视图：只渲染产品帧(默认 prefs + 初始状态),不建/不刷任何工具区、不写深链。 */
    if (PRODUCT_VIEW) { render(); return; }
    /* prefs.plat 跟随视口断点（单一规则，两个方向不分叉）：手动点 plat seg 会连带
       切设备（syncDeviceToPlat），切设备/拉伸走到这里统一重算。仅当矩阵真有该选项才写。 */
    var platOpts = (((cfg.matrix || {}).plat || {}).options) || [];
    var curPlat = platOfWidth(viewport().w);
    if (curPlat && platOpts.some(function (o) { return o.v === curPlat; })) S.prefs.plat = curPlat;
    /* 拖拽轻路径：控制栏两行 DOM 与 viewport 宽度无关（只有读数/滑块值/设备名下拉文本变），
       拖拽中跳过 buildBar1/buildBar2 的全量 innerHTML 重建，只 syncToolbar 同步控件值/禁用态。
       松手后 endResizeDrag 已把 _resizeDragActive 清掉，这里走完整重建。 */
    if (_resizeDragActive) { syncToolbar(true); render(); writeHash(); return; }
    buildBar1(); buildBar2(); syncToolbar(); render(); writeHash();
  }

  /* ── RAF 合并的 syncAll ──
   * 滑块拖动 / 窗口 resize 每像素或每帧都可能触发一次 syncAll；每次都重建两行控制栏
   * DOM + 重渲染 frame，是展示页卡顿的主因。这里把"状态已写入"与"重建"解耦：
   * 调用方立即写入 S.*（保持 inspect 等同步读数语义），但 syncAll 本体推迟到下一帧，
   * 同帧内多次触发只执行最后一次。离散事件（语言/状态/方向/W-H 数字框 onchange）
   * 仍直调 syncAll，不受合并影响。*/
  var syncAllScheduled = false;
  function scheduleSyncAll() {
    if (syncAllScheduled) return;
    syncAllScheduled = true;
    var raf = typeof window !== 'undefined' && window.requestAnimationFrame
      ? window.requestAnimationFrame.bind(window)
      : function (fn) { return setTimeout(fn, 0); };
    raf(function () { syncAllScheduled = false; syncAll(); });
  }

  /* ── resize 拖拽状态（轻路径开关）──
     beginResizeDrag：把手 pointerdown / slider 拖动开始时调用，进入轻路径
       （render 跳过 renderInto，只更新几何+读数，锚点天然保持）。
     endResizeDrag：pointerup/pointercancel 时调用，置 _forceFullRender 并
       立即做一次精确完整 render（含锚点按比例恢复），保证松手即终态精确。
     两者幂等；非拖拽路径（窗口拉伸、W/H 数字框、语言/状态/设备切换）不经过这里，
     始终完整 render。 */
  var _resizeDragActive = false;
  var _forceFullRender = false;
  var _lastCompositionKey = null; /* 上次完整 render 的 truth composition base */
  var _lastRenderVp = null;   /* 上次完整 render 的模拟视口（拖拽临时缩放的分母） */
  var _dragRootStages = null; /* 当前拖拽会话的渲染根快照，避免每帧查询整棵页面 */
  var _dragSectionLayout = null;
  var _dragCenterAnchor = null;
  var _pendingCenterAnchor = null;
  var _suppressResizeChromeAnimation = false;
  /* A delayed reveal-settle correction belongs only to the resize that created
     it. A real user scroll invalidates it immediately, so WYSIWYG anchoring
     never pulls a user back after they resume reading. */
  frame.addEventListener('scroll', function () {
    if (_centerAnchorExpectedScroll == null || Math.abs(frame.scrollTop - _centerAnchorExpectedScroll) > 0.75) {
      _centerAnchorRenderToken++;
    }
    _centerAnchorExpectedScroll = null;
    scheduleStaticKvChromeSync();
  }, { passive: true });
  function compositionKeyForViewport(vp) {
    var requested = platOfWidth(vp && vp.w);
    var platforms = (TRUTH && TRUTH.platforms) || {};
    if (requested === 'mobile' && platforms.mobile) return 'mobile';
    if (requested === 'pad' && platforms.pad) return 'pad';
    return 'pc';
  }
  function beginResizeDrag() {
    _resizeDragActive = true;
    _dragCenterAnchor = captureCenterAnchor();
    _dragRootStages = dragFollowRoots();
    _dragSectionLayout = captureDragSectionLayout(viewport());
  }
  function endResizeDrag() {
    if (!_resizeDragActive) return;
    _pendingCenterAnchor = _dragCenterAnchor || captureCenterAnchor();
    _resizeDragActive = false;
    _dragCenterAnchor = null;
    _dragRootStages = null;
    _dragSectionLayout = null;
    _forceFullRender = true;
    _suppressResizeChromeAnimation = true;
    syncAll();
  }

  function dragFollowRoots() {
    var all = frame.querySelectorAll('.fx-stage');
    var roots = [];
    for (var i = 0; i < all.length; i++) {
      var stage = all[i];
      if (stage.parentNode === frame) roots.push(stage);
    }
    return roots;
  }

  function parseZoomValue(value) {
    if (value == null || value === '' || value === 'normal') return 1;
    var n = String(value).indexOf('%') >= 0 ? parseFloat(value) / 100 : parseFloat(value);
    return isFinite(n) && n > 0 ? n : 1;
  }

  function syncFixedOverlayViewport(vp) {
    try {
      var overlays = frame.querySelectorAll('.fx-fixed-overlays');
      var nextH = Number(vp && vp.h) || frame.clientHeight || 0;
      for (var i = 0; i < overlays.length; i++) {
        var stage = overlays[i];
        var stageZoom = parseZoomValue(stage.style ? stage.style.zoom : null);
        if (!isFinite(stageZoom) || stageZoom <= 0) stageZoom = 1;
        var targetDesignHeight = nextH > 0 ? (nextH / stageZoom) : 0;
        if (targetDesignHeight > 0) {
          stage.style.height = targetDesignHeight + 'px';
          stage.style.marginBottom = '-' + targetDesignHeight + 'px';
        }
      }
    } catch (e) { /* fixed overlay sizing is a preview affordance; render remains source-backed */ }
  }

  function heroGateNumber(value, fallback) {
    var n = parseFloat(value);
    return isFinite(n) ? n : fallback;
  }

  function restoreStaticKvChrome() {
    try {
      restoreHeroEntryNavigation();
    } catch (e) { /* restoring static preview chrome must not block normal render */ }
  }

  function saveHeroEntryStyle(el) {
    if (!el || el.__fxHeroEntryStyleBase) return;
    el.__fxHeroEntryStyleBase = {
      left: el.style.left || '',
      top: el.style.top || '',
      width: el.style.width || '',
      height: el.style.height || '',
      minHeight: el.style.minHeight || '',
      position: el.style.position || '',
      fontSize: el.style.fontSize || '',
      lineHeight: el.style.lineHeight || '',
      objectFit: el.style.objectFit || '',
      overflow: el.style.overflow || '',
      transformOrigin: el.style.transformOrigin || '',
      pointerEvents: el.style.pointerEvents || '',
      zIndex: el.style.zIndex || '',
    };
  }

  function restoreHeroEntryStyle(el) {
    if (!el || !el.__fxHeroEntryStyleBase) return;
    var base = el.__fxHeroEntryStyleBase;
    el.style.left = base.left || '';
    el.style.top = base.top || '';
    el.style.width = base.width || '';
    el.style.height = base.height || '';
    el.style.minHeight = base.minHeight || '';
    el.style.position = base.position || '';
    el.style.fontSize = base.fontSize || '';
    el.style.lineHeight = base.lineHeight || '';
    el.style.objectFit = base.objectFit || '';
    el.style.overflow = base.overflow || '';
    el.style.transformOrigin = base.transformOrigin || '';
    el.style.pointerEvents = base.pointerEvents || '';
    el.style.zIndex = base.zIndex || '';
  }

  function restoreHeroEntryNavigation() {
    try {
      var list = frame.querySelectorAll('[data-hero-entry-nav-transform="true"]');
      for (var i = 0; i < list.length; i++) {
        restoreHeroEntryStyle(list[i]);
        list[i].removeAttribute('data-hero-entry-nav-transform');
        list[i].removeAttribute('data-hero-entry-nav-kind');
        list[i].removeAttribute('data-hero-entry-nav-y-scale');
        list[i].removeAttribute('data-hero-entry-nav-cadence');
        list[i].removeAttribute('data-hero-entry-nav-distribution');
      }
    } catch (e) { /* ignore */ }
  }

  function applyHeroEntryBox(el, left, top, width, height, kind) {
    if (!el) return;
    saveHeroEntryStyle(el);
    el.style.position = 'absolute';
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.width = width + 'px';
    el.style.height = height + 'px';
    el.setAttribute('data-hero-entry-nav-transform', 'true');
    if (kind) el.setAttribute('data-hero-entry-nav-kind', kind);
  }

  function syncHeroEntryBrand(stage) {
    try {
      var brands = frame.querySelectorAll('[data-motion-role="kvBrand"]');
      for (var b = 0; b < brands.length; b++) {
        var brand = brands[b];
        if (stage && brand.parentElement !== stage) stage.appendChild(brand);
        applyHeroEntryBox(brand, -22, 0, 840, 300, 'brand');
        brand.style.pointerEvents = 'none';
        brand.style.zIndex = '22';
        var media = brand.querySelectorAll('img,canvas,video,.fx-img');
        for (var m = 0; m < media.length; m++) {
          applyHeroEntryBox(media[m], 0, 0, 840, 300, 'brand-media');
          media[m].style.objectFit = 'fill';
        }
      }
    } catch (e) { /* brand is optional for non-KV pages */ }
  }

  function fixedNavigationGroupForRoot(root) {
    try {
      var groups = frame.__fxFixedNavigation || [];
      for (var g = 0; g < groups.length; g++) {
        var items = groups[g] && groups[g].items;
        if (!items || !items.length) continue;
        if (root.contains(items[0])) return groups[g];
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function currentFrameNavTarget(group) {
    if (!group || !group.anchors || !group.anchors.length) return null;
    var viewportMidpoint = 0;
    try {
      var rect = frame.getBoundingClientRect();
      viewportMidpoint = rect.top + rect.height * 0.5;
    } catch (e) {
      viewportMidpoint = (typeof window !== 'undefined' ? window.innerHeight : 0) * 0.5;
    }
    var best = null, bestTop = -Infinity, first = null;
    for (var a = 0; a < group.anchors.length; a++) {
      var anchor = group.anchors[a];
      if (!anchor || !anchor.getBoundingClientRect) continue;
      var r = anchor.getBoundingClientRect();
      if (!r.height) continue;
      var target = anchor.getAttribute('data-node');
      if (!first) first = target;
      if (r.top <= viewportMidpoint && r.top > bestTop) {
        best = target;
        bestTop = r.top;
      }
    }
    return best || first;
  }

  function syncFrameNavActive(root, items) {
    var group = fixedNavigationGroupForRoot(root);
    var activeIndex = -1;
    try {
      var target = currentFrameNavTarget(group);
      if (group && target) {
        for (var gi = 0; gi < group.items.length; gi++) {
          var selected = group.items[gi].getAttribute('data-sec-target') === target;
          group.items[gi].toggleAttribute('data-active', selected);
          group.items[gi].setAttribute('aria-current', selected ? 'true' : 'false');
          if (selected) activeIndex = gi;
        }
      }
    } catch (e) { /* active sync is visual chrome only */ }
    if (activeIndex < 0) {
      for (var i = 0; i < items.length; i++) {
        if (items[i].hasAttribute('data-active') || items[i].getAttribute('aria-current') === 'true'
            || items[i].getAttribute('data-nav-variant') === 'active') {
          activeIndex = i;
          break;
        }
      }
    }
    if (activeIndex < 0) activeIndex = 0;
    return Math.max(0, Math.min(items.length - 1, activeIndex));
  }

  function isActiveNavArtwork(boxEl, mediaEl) {
    if (!boxEl && !mediaEl) return false;
    var marked = ((boxEl && boxEl.getAttribute('data-hero-entry-nav-kind')) || '')
      + ' ' + ((mediaEl && mediaEl.getAttribute('data-hero-entry-nav-kind')) || '');
    if (marked.indexOf('active-item-art') >= 0) return true;
    var w = heroGateNumber(boxEl && boxEl.style && boxEl.style.width, boxEl && boxEl.offsetWidth || 0);
    var h = heroGateNumber(boxEl && boxEl.style && boxEl.style.height, boxEl && boxEl.offsetHeight || 0);
    if (!(w > 0) && mediaEl) w = heroGateNumber(mediaEl.style && mediaEl.style.width, mediaEl.offsetWidth || 0);
    if (!(h > 0) && mediaEl) h = heroGateNumber(mediaEl.style && mediaEl.style.height, mediaEl.offsetHeight || 0);
    return w > 120 && h > 50 && w / h > 1.6;
  }

  function naturalMediaRatio(mediaEl, fallback) {
    var ratio = Number(fallback);
    try {
      var nw = Number(mediaEl && (mediaEl.naturalWidth || mediaEl.videoWidth));
      var nh = Number(mediaEl && (mediaEl.naturalHeight || mediaEl.videoHeight));
      if (nw > 0 && nh > 0) ratio = nw / nh;
    } catch (e) { /* ignore */ }
    return isFinite(ratio) && ratio > 0 ? ratio : 1;
  }

  function directChildByNodeId(root, nodeId) {
    if (!root || !nodeId) return null;
    try {
      for (var child = root.firstElementChild; child; child = child.nextElementSibling) {
        if (child.getAttribute && (child.getAttribute('data-node') === nodeId || child.getAttribute('data-node-id') === nodeId)) return child;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function syncContinuousNavRailOwner(root, sourceScaleY) {
    if (!root) return null;
    var railOwner = directChildByNodeId(root, 'I52:3263;17:53006');
    if (!railOwner) {
      var children = root.children || [];
      for (var i = 0; i < children.length; i++) {
        var name = (children[i].getAttribute && (children[i].getAttribute('data-figma-name') || children[i].getAttribute('data-name') || children[i].getAttribute('aria-label'))) || '';
        if (/导航背景|nav|rail/i.test(name)) {
          railOwner = children[i];
          break;
        }
      }
    }
    if (!railOwner) return null;

    saveHeroEntryStyle(railOwner);
    var sourceBoxWidth = 307;
    var sourceBoxHeight = 1666;
    var renderBoxWidth = 727;
    var renderBoxHeight = 2376;
    var renderOffsetX = -22.5;
    var sourceLineTop = 310;
    var sourceLineBottom = 1976;
    var sourceLineCoverage = sourceLineBottom - sourceLineTop;
    if (!isFinite(sourceScaleY) || sourceScaleY <= 0) sourceScaleY = 1;
    railOwner.style.position = 'absolute';
    railOwner.style.left = '0px';
    railOwner.style.top = '0px';
    railOwner.style.width = sourceBoxWidth + 'px';
    railOwner.style.height = (sourceBoxHeight * sourceScaleY) + 'px';
    railOwner.style.overflow = 'visible';
    railOwner.style.transformOrigin = '0px 0px';
    railOwner.setAttribute('data-fixed-viewport-rail', 'true');
    railOwner.setAttribute('data-hero-entry-nav-transform', 'true');
    railOwner.setAttribute('data-hero-entry-nav-kind', 'rail-owner');
    railOwner.setAttribute('data-figma-source-node-id', 'I52:3263;17:53006');
    railOwner.setAttribute('data-figma-source-owner', 'fix-left-navigation-background');
    railOwner.setAttribute('data-figma-rail-source-width', String(sourceBoxWidth));
    railOwner.setAttribute('data-figma-rail-source-height', String(sourceBoxHeight));
    railOwner.setAttribute('data-figma-rail-render-width', String(renderBoxWidth));
    railOwner.setAttribute('data-figma-rail-render-height', String(renderBoxHeight));
    railOwner.setAttribute('data-figma-rail-render-offset-x', String(renderOffsetX));
    railOwner.setAttribute('data-figma-rail-render-offset-y', String(-sourceLineTop));
    railOwner.setAttribute('data-figma-rail-source-scale-y', sourceScaleY.toFixed(6));

    var bakedAsset = null;
    try {
      bakedAsset = railOwner.querySelector(':scope > img.fx-img, :scope > img[data-asset-src]');
    } catch (e) {
      bakedAsset = railOwner.querySelector('img.fx-img, img[data-asset-src]');
    }
    if (bakedAsset) {
      saveHeroEntryStyle(bakedAsset);
      bakedAsset.style.position = 'absolute';
      bakedAsset.style.left = renderOffsetX + 'px';
      bakedAsset.style.top = (-sourceLineTop * sourceScaleY) + 'px';
      bakedAsset.style.width = renderBoxWidth + 'px';
      bakedAsset.style.height = (renderBoxHeight * sourceScaleY) + 'px';
      bakedAsset.style.objectFit = 'fill';
      bakedAsset.style.pointerEvents = 'none';
      bakedAsset.setAttribute('data-hero-entry-nav-transform', 'true');
      bakedAsset.setAttribute('data-hero-entry-nav-kind', 'rail-owner-asset');
      bakedAsset.setAttribute('data-figma-source-node-id', 'I52:3263;17:53006');
      bakedAsset.setAttribute('data-figma-rail-source-scale-y', sourceScaleY.toFixed(6));
    }

    var bg = directChildByNodeId(railOwner, 'I52:3263;17:53003');
    if (bg) {
      saveHeroEntryStyle(bg);
      bg.style.position = 'absolute';
      bg.style.left = '0px';
      bg.style.top = '0px';
      bg.style.width = sourceBoxWidth + 'px';
      bg.style.height = (sourceBoxHeight * sourceScaleY) + 'px';
      bg.style.objectFit = 'fill';
      bg.setAttribute('data-hero-entry-nav-transform', 'true');
      bg.setAttribute('data-hero-entry-nav-kind', 'rail-gradient');
    }

    var lineA = directChildByNodeId(railOwner, 'I52:3263;12:47246');
    var lineB = directChildByNodeId(railOwner, 'I52:3263;12:47247');
    if (lineA) {
      saveHeroEntryStyle(lineA);
      lineA.style.position = 'absolute';
      lineA.style.left = '22px';
      lineA.style.top = '0px';
      lineA.style.width = '43px';
      lineA.style.height = (844 * sourceScaleY) + 'px';
      lineA.setAttribute('data-hero-entry-nav-transform', 'true');
      lineA.setAttribute('data-hero-entry-nav-kind', 'rail-line-source');
      lineA.setAttribute('data-figma-source-node-id', 'I52:3263;12:47246');
    }
    if (lineB) {
      saveHeroEntryStyle(lineB);
      lineB.style.position = 'absolute';
      lineB.style.left = '22px';
      lineB.style.top = (684 * sourceScaleY) + 'px';
      lineB.style.width = '43px';
      lineB.style.height = (982 * sourceScaleY) + 'px';
      lineB.setAttribute('data-hero-entry-nav-transform', 'true');
      lineB.setAttribute('data-hero-entry-nav-kind', 'rail-line-source');
      lineB.setAttribute('data-figma-source-node-id', 'I52:3263;12:47247');
    }
    railOwner.setAttribute('data-figma-rail-source-top', String(sourceLineTop));
    railOwner.setAttribute('data-figma-rail-source-bottom', String(sourceLineBottom));
    railOwner.setAttribute('data-figma-rail-source-coverage', String(sourceLineCoverage));
    railOwner.setAttribute('data-figma-rail-visible-coverage', (sourceLineCoverage * sourceScaleY).toFixed(3));
    return railOwner;
  }

  function syncHeroEntryNavigation(vp, heroBaseHeight) {
    try {
      var viewportH = Number(vp && vp.h) || frame.clientHeight || 0;
      if (!(viewportH > 0)) return;
      var baseH = heroGateNumber(heroBaseHeight, 2160);
      if (!(baseH > 0)) baseH = 2160;
      var yScale = Math.min(1, viewportH / baseH);
      var stages = frame.querySelectorAll('.fx-fixed-overlays');
      for (var s = 0; s < stages.length; s++) {
        var stage = stages[s];
        var stageZoom = parseZoomValue(stage.style ? stage.style.zoom : null);
        if (!isFinite(stageZoom) || stageZoom <= 0) stageZoom = 1;
        syncHeroEntryBrand(stage);
        var navRoots = stage.querySelectorAll('[data-motion-role="navigationFooter"]');
        for (var r = 0; r < navRoots.length; r++) {
          var root = navRoots[r];
          saveHeroEntryStyle(root);
          var rootLeftSource = 20;
          var rootTopSource = 310;
          var rootWidthSource = 627;
          var rootHeightSource = 1666;
          var buttonTopSource = 27;
          var buttonHeightSource = 1564;
          var sourceScaleY = stageZoom > 0 ? (yScale / stageZoom) : 1;
          if (!isFinite(sourceScaleY) || sourceScaleY <= 0) sourceScaleY = 1;
          root.style.position = 'absolute';
          root.style.left = rootLeftSource + 'px';
          root.style.top = ((rootTopSource * yScale) / stageZoom) + 'px';
          root.style.width = rootWidthSource + 'px';
          root.style.height = (rootHeightSource * sourceScaleY) + 'px';
          root.style.minHeight = root.style.height;
          root.style.overflow = 'visible';
          if (_suppressResizeChromeAnimation) {
            root.style.animation = 'none';
          }
          root.setAttribute('data-hero-entry-nav-transform', 'true');
          root.setAttribute('data-hero-entry-nav-kind', 'root');
          root.setAttribute('data-hero-entry-nav-y-scale', yScale.toFixed(4));

          syncContinuousNavRailOwner(root, sourceScaleY);

          var buttonFrame = directChildByNodeId(root, 'I52:3263;12:47248');
          if (buttonFrame) {
            saveHeroEntryStyle(buttonFrame);
            buttonFrame.style.position = 'absolute';
            buttonFrame.style.left = '0px';
            buttonFrame.style.top = (buttonTopSource * sourceScaleY) + 'px';
            buttonFrame.style.width = rootWidthSource + 'px';
            buttonFrame.style.height = (buttonHeightSource * sourceScaleY) + 'px';
            buttonFrame.style.display = 'block';
            buttonFrame.style.overflow = 'visible';
            buttonFrame.setAttribute('data-hero-entry-nav-transform', 'true');
            buttonFrame.setAttribute('data-hero-entry-nav-kind', 'button-frame');
          }

          var items = root.querySelectorAll('[data-nav-item]');
          var count = Math.max(1, items.length);
          var activeIndex = syncFrameNavActive(root, items);
          var sourceRowH = 224;
          var sourceCadence = 134;
          var sourceLabelX = 95;
          var sourceActiveLabelY = 92;
          var sourceNormalLabelY = 93;
          var sourceStarX = 29;
          var sourceStarY = 108;
          var sourceStarSize = 26;
          var cadence = sourceCadence * sourceScaleY;
          for (var i = 0; i < items.length; i++) {
            var item = items[i];
            saveHeroEntryStyle(item);
            item.style.position = 'absolute';
            item.style.left = '0px';
            item.style.top = (sourceCadence * i * sourceScaleY) + 'px';
            item.style.width = rootWidthSource + 'px';
            item.style.height = (sourceRowH * sourceScaleY) + 'px';
            item.style.scale = '1';
            item.style.transition = 'none';
            item.setAttribute('data-hero-entry-nav-transform', 'true');
            item.setAttribute('data-hero-entry-nav-kind', 'item');
            item.setAttribute('data-hero-entry-nav-cadence', cadence.toFixed(3));
            item.setAttribute('data-hero-entry-nav-distribution', 'figma-source');
            var mediaNodes = item.querySelectorAll('img,canvas,video,.fx-img');
            for (var im = 0; im < mediaNodes.length; im++) {
              var media = mediaNodes[im];
              var mediaParent = media.parentElement && media.parentElement !== item ? media.parentElement : null;
              if (isActiveNavArtwork(mediaParent || media, media)) {
                var activeTop = (activeIndex - i) * sourceCadence * sourceScaleY;
                var activeW = rootWidthSource;
                var activeH = sourceRowH * sourceScaleY;
                applyHeroEntryBox(mediaParent || media, 0, activeTop, activeW, activeH, 'active-item-art');
                if (mediaParent) applyHeroEntryBox(media, 0, 0, activeW, activeH, 'active-item-art-media');
                media.style.objectFit = 'fill';
              } else {
                var iconRatio = naturalMediaRatio(media, 1);
                var mediaW = sourceStarSize;
                var mediaH = mediaW / iconRatio;
                if (!isFinite(mediaH) || mediaH <= 0) mediaH = sourceStarSize;
                applyHeroEntryBox(mediaParent || media, sourceStarX, sourceStarY * sourceScaleY, mediaW, mediaH, 'item-ornament-slot');
                if (mediaParent) applyHeroEntryBox(media, 0, 0, mediaW, mediaH, 'item-ornament-media');
                media.style.objectFit = 'contain';
              }
            }
            var labels = item.querySelectorAll('.fx-t');
            for (var t = 0; t < labels.length; t++) {
              var label = labels[t];
              saveHeroEntryStyle(label);
              var isActiveRow = i === activeIndex || item.getAttribute('data-nav-variant') === 'active';
              label.style.left = sourceLabelX + 'px';
              label.style.top = ((isActiveRow ? sourceActiveLabelY : sourceNormalLabelY) * sourceScaleY) + 'px';
              label.setAttribute('data-hero-entry-nav-transform', 'true');
              label.setAttribute('data-hero-entry-nav-kind', 'label');
            }
          }
        }
      }
    } catch (e) { /* entry nav transform is preview-only */ }
  }

  function syncStaticKvChrome(vp) {
    try {
      var pageRoot = frame.querySelector('.fx-stage[data-node="__page__"]');
      var hero = frame.querySelector('[data-hero-slot-role="hero"]');
      if (!pageRoot || !hero) { restoreStaticKvChrome(); return; }
      frame.style.setProperty('--fx-hero-locked-viewport-height', Math.max(0, Number(frame.clientHeight) || Number(vp && vp.h) || 0) + 'px');
      if (typeof frame.__fxSyncFixedNavigation === 'function') {
        try { frame.__fxSyncFixedNavigation(); } catch (navError) { /* keep static chrome resilient */ }
      }
      var baseHeroH = heroGateNumber(hero.style.height, hero.offsetHeight || 2160);
      syncHeroEntryNavigation(vp, baseHeroH);
    } catch (e) { /* static chrome sync must fail back to source render */ }
  }

  function captureDragSectionLayout(vp) {
    try {
      var pageRoot = frame.querySelector('.fx-stage[data-node="__page__"]');
      var rootZoom = parseZoomValue(pageRoot && pageRoot.style ? pageRoot.style.zoom : null);
      var sections = [];
      var list = frame.querySelectorAll('.fx-stage[data-node-id^="section-"]');
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        var localTop = parseFloat(el.style.top);
        if (!isFinite(localTop)) localTop = Number(el.offsetTop) || 0;
        var localHeight = parseFloat(el.style.height);
        if (!isFinite(localHeight) || localHeight <= 0) localHeight = Number(el.offsetHeight) || 0;
        if (!(localHeight > 0)) continue;
        sections.push({
          el: el,
          top: localTop,
          height: localHeight,
        });
      }
      sections.sort(function (a, b) { return a.top - b.top; });
      var heroState = frame.getAttribute('data-hero-scroll-state') || '';
      var heroActive = frame.getAttribute('data-hero-scroll-slot') === 'active'
        && heroState === 'HERO_LOCKED'
        && sections.length > 1
        && rootZoom > 0;
      return {
        vp: { w: (vp && vp.w) || frame.clientWidth || 0, h: (vp && vp.h) || frame.clientHeight || 0 },
        sections: sections,
        viewportLockedHero: heroActive,
        heroBoundaryLocal: heroActive ? sections[1].top : 0,
      };
    } catch (e) {
      return null;
    }
  }

  function syncDragSectionLayout(vp, followScale) {
    var layout = _dragSectionLayout;
    if (!layout || !layout.sections || !layout.sections.length) return;
    var pageRoot = frame.querySelector('.fx-stage[data-node="__page__"]');
    var rootZoom = parseZoomValue(pageRoot && pageRoot.style ? pageRoot.style.zoom : null);
    if (!isFinite(rootZoom) || rootZoom <= 0) return;
    var nextH = Number(vp && vp.h) || Number(layout.vp && layout.vp.h) || frame.clientHeight || 0;
    var targetHeroBoundaryLocal = layout.viewportLockedHero ? (nextH / rootZoom) : 0;
    var baseHeroBoundaryLocal = Number(layout.heroBoundaryLocal) || 0;
    for (var i = 0; i < layout.sections.length; i++) {
      var item = layout.sections[i];
      var desiredTop = item.top;
      if (layout.viewportLockedHero) {
        desiredTop = i === 0 ? 0 : targetHeroBoundaryLocal + (item.top - baseHeroBoundaryLocal);
      }
      item.el.style.top = desiredTop + 'px';
      item.el.style.height = item.height + 'px';
    }
  }

  function syncDragContentFollow(vp) {
    try {
      var baseVp = _lastRenderVp;
      var followScale = (baseVp && baseVp.w > 0) ? (vp.w / baseVp.w) : 1;
      var stages = _dragRootStages || dragFollowRoots();
      for (var i = 0; i < stages.length; i++) {
        var stage = stages[i];
        if (stage.__fxBaseZoom == null) {
          var baseZoom = parseFloat(stage.style.zoom);
          stage.__fxBaseZoom = (isFinite(baseZoom) && baseZoom > 0) ? baseZoom : 1;
        }
        stage.style.zoom = String(stage.__fxBaseZoom * followScale);
      }
      syncFixedOverlayViewport(vp);
      syncDragSectionLayout(vp, followScale);
      syncStaticKvChrome(vp);
    } catch (error) { /* 临时缩放失败不阻塞拖拽，松手后完整 render 会纠正 */ }
  }

  /* ── 深链 ── */
  function writeHash() {
    var vp = viewport();
    var p = ['g=' + curGroup().key, 'd=' + S.devIdx, 'w=' + vp.w, 'h=' + vp.h, 'state=' + S.state];
    for (var k in S.prefs) p.push(k + '=' + S.prefs[k]);
    if (S.grid) p.push('grid=1');
    try { history.replaceState(null, '', '#' + p.join('&')); } catch (e) { /* 忽略 */ }
  }
  function readHash() {
    if (!location.hash) return;
    var q = {};
    location.hash.slice(1).split('&').forEach(function (kv) {
      var i = kv.indexOf('='); if (i > 0) q[kv.slice(0, i)] = kv.slice(i + 1);
    });
    if (q.g) for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].key === q.g) S.groupIdx = i;
    if (q.d != null) S.devIdx = Number(q.d);
    if (q.w) S.freeW = Number(q.w);
    if (q.h) S.freeH = Number(q.h);
    if (q.state && (cfg.states[q.state] || (cfg.tabStates || []).some(function (t) { return t.id === q.state; }))) S.state = q.state;
    for (var k in S.prefs) if (q[k]) S.prefs[k] = q[k];
    if (q.grid === '1') S.grid = true;
  }

  function persist() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S.prefs)); } catch (e) {} }
  function clamp(v, lo, hi) { v = Number(v) || lo; return Math.min(hi, Math.max(lo, v)); }
  function cp(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── 老师的 __qa 合约：verify.mjs 靠它驱动门 B/C/D/F，必须保住 ──
     产品视图(?product=1)不暴露 __qa:QA 壳 = 工具区 + __qa API 所在的整个 chrome 运行时,
     纯净渲染路径里两者都不该存在。 */
  if (!PRODUCT_VIEW) window.__qa = {
    current: function () { return S.state; },
    goto: function (id) {
      if (!cfg.states[id] && !(cfg.tabStates || []).some(function (t) { return t.id === id; })) {
        throw new Error('__qa.goto: 未声明的状态 ' + id);
      }
      S.state = id; syncAll();
    },
    prefs: function () { return cp(S.prefs); },
    /* 自动化写偏好（不改可见控制栏）。2026-08-10 起 OS/主题对本页是无视觉声明维
       （matrix 仅 any/default 单选项、渲染层不消费），故不设可见分段控件；但 case
       自动化仍要能把它们写进 prefs 走完整校验链，走这个正式 API 而非点不可见 DOM。
       只许写 cfg.matrix 已声明的 key；写后 persist+syncAll 让 case 持久化与读数一致。 */
    setPref: function (key, value) {
      if (!cfg.matrix || !(key in ({ plat: 1, region: 1, os: 1, mode: 1, lang: 1 }))) {
        throw new Error('__qa.setPref: 未声明的维度 ' + key);
      }
      S.prefs[key] = value; persist(); syncAll();
    },
    scale: function () { return typeof cfg.scale === 'function' ? cfg.scale.call(cfg) : 1; },
    resize: function (w, h) { S.freeW = clampViewportW(w); S.freeH = clampViewportH(h); S.devIdx = -1; syncAll(); },
    setOrientation: function (mode) {
      if (mode !== 'portrait' && mode !== 'landscape') throw new Error('__qa.setOrientation: mode 必须是 portrait 或 landscape');
      if (!canOrient()) throw new Error('__qa.setOrientation: 当前设备组不支持横竖屏切换');
      S.orientation = mode; syncAll();
    },
    metrics: function (ids) {
      var fr = frame.getBoundingClientRect();
      var probes = {};
      (ids || []).forEach(function (id) {
        var e = frame.querySelector('[data-qa-probe="' + id + '"]') || frame.querySelector('[data-node="' + id + '"]');
        if (!e) return;
        var r = e.getBoundingClientRect();
        probes[id] = { x: r.left - fr.left, y: r.top - fr.top, w: r.width, h: r.height };
      });
      return { frame: { w: frame.clientWidth, h: frame.clientHeight }, probes: probes };
    },
    // 本 Skill 扩展：把读数暴露给验收脚本（值全部现测 DOM，不是声明）
    inspect: function () {
      return {
        viewport: viewport(),
        breakpoint: bpOf(viewport().w).key,
        orientation: viewport().orientation,
        viewFitScale: typeof S.fitScale === 'number' ? S.fitScale : 1,
        viewIsOneToOne: Math.abs((typeof S.fitScale === 'number' ? S.fitScale : 1) - 1) < 1e-6,
        copyMissing: document.querySelectorAll('.frame [data-copy-missing]').length,
        textEmpty: document.querySelectorAll('.frame [data-text-empty]').length,
        assetPending: document.querySelectorAll('.frame [data-asset-pending]').length,
        fitScaled: document.querySelectorAll('.frame [data-fit-scale]').length,
        fitOverflow: document.querySelectorAll('.frame [data-fit-overflow]').length,
        lineBreakLost: document.querySelectorAll('.frame [data-copy-lb-lost]').length,
        designVersion: (TRUTH.design && TRUTH.design.fileVersion) || null,
        /* 非整数缩放接缝证据（2026-08-11）：现测嵌套缩放链，integerFriendly=false 即
           BG alpha 瓦片行失配的已知底层限制。只读上报，不在此改几何/遮缝。 */
        pixelAlignment: window.__fxPixelAlign || null,
      };
    },
    /* 超框缩字号清单：给本地化看的「哪条文案、哪个语言、缩到几档、仍溢出多少」。
       值全部现测 DOM（data-fit-* 标记 + 实时 scrollHeight），不是声明。
       等价物落盘方案：浏览器里调用 __qa.copyOverflowReport()；控制栏不再额外放
       本地化专用按钮，避免偏离 kit 的通用验收控件。 */
    copyOverflowReport: function () {
      var stageEl = document.querySelector('.frame .fx-stage');
      var k = 1;
      if (stageEl) {
        var z = window.getComputedStyle(stageEl).zoom;
        if (z && z !== 'normal') {
          var zn = String(z).indexOf('%') >= 0 ? parseFloat(z) / 100 : parseFloat(z);
          if (isFinite(zn) && zn > 0) k = zn;
        }
      }
      var idx = window.__fxTextIndex || {};
      var items = [];
      var els = document.querySelectorAll('.frame [data-fit-scale]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var nid = el.getAttribute('data-node');
        var rec = idx[nid] || {};
        var boxH = rec.box && rec.box.h != null ? rec.box.h : null;
        items.push({
          nodeId: nid,
          name: rec.name || null,
          lang: S.prefs.lang,
          designText: rec.chars != null ? rec.chars : null,   // 稿内原文（简中）
          shownText: el.textContent,                          // 当前实际显示的文字
          boxH: boxH,                                         // 稿框高（设计 px）
          fitScale: Number(el.getAttribute('data-fit-scale')),// 缩到了哪一档（%）
          stillOverflow: el.getAttribute('data-fit-overflow') === '1',
          // 还超多少（缩放后 px；仍溢出的条目才有意义）。现测，不是推算
          overflowPx: (boxH != null && typeof el.scrollHeight === 'number')
            ? Math.round((el.scrollHeight - boxH * k) * 100) / 100 : null,
        });
      }
      return {
        _note: '超框缩字号清单（运行时实测，给本地化/设计裁决）。fitScale<100=已按档收进；stillOverflow=到下限 75% 仍溢出，要改文案或改稿',
        designVersion: (TRUTH.design && TRUTH.design.fileVersion) || null,
        lang: S.prefs.lang,
        count: items.length,
        stillOverflowCount: items.filter(function (x) { return x.stillOverflow; }).length,
        items: items,
      };
    },
  };

  if (!PRODUCT_VIEW) readHash();   // 深链(g=/d=/w=/h=/state=)是 QA 功能,产品视图不消费
  syncAll();
  /* 窗口 resize 与 slider 同理：RAF 合并，同帧多次 resize 只重渲染一次。 */
  var winResizeScheduled = false;
  window.addEventListener('resize', function () {
    if (winResizeScheduled) return;
    winResizeScheduled = true;
    var raf = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : function (fn) { return setTimeout(fn, 0); };
    raf(function () { winResizeScheduled = false; render(); });
  });
})();
