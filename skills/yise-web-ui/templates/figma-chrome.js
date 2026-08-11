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
    /* ── PC 自由模式右缘拖拽把手（2026-08-11 用户红框：期望在预览画布右边缘拖改宽度）──
       只右缘一条，非四边/四角；贴在屏幕容器（.stage-wrap）右侧外缘，竖向贯穿整条高。
       默认半透明细条，悬停/拖拽时高亮 —— 可发现但不抢眼。非自由模式整体隐藏。*/
    '.edge-handle{position:absolute;top:0;bottom:0;right:-7px;width:14px;cursor:col-resize;',
    'z-index:5;touch-action:none;border-radius:7px;background:transparent;',
    'transition:background .12s ease}',
    '.edge-handle::after{content:"";position:absolute;top:50%;left:50%;width:4px;height:44px;',
    'transform:translate(-50%,-50%);border-radius:2px;background:#3a4656;opacity:.55;',
    'transition:opacity .12s ease,background .12s ease}',
    '.edge-handle:hover::after,.edge-handle.dragging::after{background:var(--acc);opacity:1}',
    '.edge-handle.disabled{display:none}',
  ].join('');

  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  /* ── DOM 骨架：类名结构照 control-bar-demo.html（.bar > .row ×2 / .stage > .stage-wrap）── */
  var bar = mk('div', 'bar');
  var row1 = mk('div', 'row');
  var row2 = mk('div', 'row');
  bar.appendChild(row1); bar.appendChild(row2);
  var stage = mk('div', 'stage');
  var wrap = mk('div', 'stage-wrap');
  var chip = mk('div', 'chip');
  var frame = mk('div', 'frame');
  wrap.appendChild(chip); wrap.appendChild(frame); stage.appendChild(wrap);

  /* PC 自由模式右缘拖拽把手：只改宽度（与 slider/W 输入同一契约，不动高度 ——
     高度由 H 输入/设备 preset 决定，把手不发明新的纵横策略）。
     拖拽横向位移 ÷ 当前 fitScale 换算成设计宽，再走与 slider 相同的
     clamp(240..3840) + devIdx=-1 + scheduleSyncAll() RAF 合并路径。 */
  var edgeHandle = mk('div', 'edge-handle disabled');
  edgeHandle.setAttribute('role', 'separator');
  edgeHandle.setAttribute('aria-orientation', 'vertical');
  edgeHandle.setAttribute('aria-label', '拖拽调整预览宽度');
  edgeHandle.setAttribute('data-qa-edge-resize', 'true');
  wrap.appendChild(edgeHandle);
  (function () {
    var drag = null;
    edgeHandle.addEventListener('pointerdown', function (e) {
      if (!canResize()) return;
      drag = { x0: e.clientX, w0: viewport().w, scale: (typeof S.fitScale === 'number' && S.fitScale > 0) ? S.fitScale : 1 };
      edgeHandle.classList.add('dragging');
      try { edgeHandle.setPointerCapture(e.pointerId); } catch (err) { /* 桩环境无 capture */ }
      e.preventDefault();
    });
    edgeHandle.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = (e.clientX - drag.x0) / drag.scale;
      S.freeW = clamp(Math.round(drag.w0 + dx), 240, 3840);
      S.devIdx = -1;
      scheduleSyncAll();
    });
    var end = function (e) {
      if (!drag) return;
      drag = null;
      edgeHandle.classList.remove('dragging');
      try { edgeHandle.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    };
    edgeHandle.addEventListener('pointerup', end);
    edgeHandle.addEventListener('pointercancel', end);
  })();
  document.body.appendChild(bar); document.body.appendChild(stage);

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
    widthInput = document.createElement('input'); widthInput.type = 'number'; widthInput.min = '240'; widthInput.max = '3840'; widthInput.step = '1';
    widthInput.setAttribute('data-qa-viewport-width-input', 'true');
    widthInput.onchange = function () { S.freeW = clamp(Number(widthInput.value) || viewport().w, 240, 3840); S.devIdx = -1; syncAll(); };
    sizeControl.appendChild(widthInput);
    var times = mk('span', 'lbl'); times.textContent = '×'; sizeControl.appendChild(times);
    var heightLabel = mk('span', 'lbl'); heightLabel.textContent = 'H'; sizeControl.appendChild(heightLabel);
    heightInput = document.createElement('input'); heightInput.type = 'number'; heightInput.min = '240'; heightInput.max = '8000'; heightInput.step = '1';
    heightInput.setAttribute('data-qa-viewport-height-input', 'true');
    heightInput.onchange = function () { S.freeH = clamp(Number(heightInput.value) || viewport().h, 240, 8000); S.devIdx = -1; syncAll(); };
    sizeControl.appendChild(heightInput);
    resizeRange = document.createElement('input'); resizeRange.type = 'range'; resizeRange.min = '240'; resizeRange.max = '3840'; resizeRange.step = '1';
    resizeRange.setAttribute('data-qa-viewport-resize', 'width');
    resizeRange.oninput = function () { S.freeW = Number(resizeRange.value); S.devIdx = -1; scheduleSyncAll(); };
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
    resizeRange.value = Math.min(3840, Math.max(240, vpNow.w));
    widthInput.value = vpNow.w;
    heightInput.value = vpNow.h;

    elRead1 = mk('div', 'readout');
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

  function render() {
    var vp = viewport();
    /* 读数常显会占据真实控制栏高度。先放入与终态同量级的紧凑内容，
       再量舞台可用区，避免用“读数还是空的”旧高度计算 fit。 */
    if (elRead1) elRead1.textContent = '读数 ' + vp.w + '×' + vp.h + ' px · DPR ' + vp.dpr + ' · ' + bpOf(vp.w).label + ' · 视图缩放… · ' + vp.src;
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
      /* 高度方向同样要装下完整 screen（2026-08-05 用户红框：页面不能上下顶天立地）。
         之前 fit 只按宽缩 —— 1080 高的 frame 缩完仍有 843px，加 bezel 后 wrap 1102px
         高过 stage 可视区（约 747px），screen 上下被 stage 裁掉，用户看不到完整屏和
         四周黑色呼吸空间。现在取 stage **可视内框高**（clientHeight − 上下 padding），
         让整台 screen（vp.h*scale + bezel 22）都装得进；取宽/高两个 scale 的较小值。 */
      var BEZEL0 = 22;
      var stagePadV = 0;
      try { var scs2 = getComputedStyle(stage); stagePadV = (parseFloat(scs2.paddingTop) || 0) + (parseFloat(scs2.paddingBottom) || 0); } catch (e) { stagePadV = 0; }
      var availH = stage.clientHeight - stagePadV;   /* stage 可视内框高 */
      if (availH > 0) {
        var scaleH = (availH - 2) / (vp.h + BEZEL0);   /* 留 2px 余量防贴边 */
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
    renderInto(frame, S.state);
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
    elRead1.innerHTML =
      '读数 <b>' + vp.w + '×' + vp.h + ' px</b>' +
      ' · DPR <b>' + vp.dpr + '</b>' +
      ' · ' + esc(bp.label || bp.key) +
      ' · 视图缩放 <b class="' + (Math.abs(scale - 1) < 1e-6 ? 'ok' : 'err') + '">' + (scale * 100).toFixed(1) + '%</b>' +
      ' · 来源 <b>' + esc(vp.src) + '</b>';

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
  function syncToolbar() {
    var g = curGroup();
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
    var lock = !canResize();
    [widthInput, heightInput, resizeRange].forEach(function (e) {
      e.disabled = lock;
      e.title = lock ? '仅 PC 设备组可自由拉伸（防止截出不存在的机型宽度）' : '';
    });
    /* 右缘拖拽把手与 slider/W-H 严格同源：同一 canResize() 判定，锁定即隐藏。 */
    if (edgeHandle) edgeHandle.classList.toggle('disabled', lock);
    var vp = viewport();
    widthInput.value = vp.w;
    heightInput.value = vp.h;
    resizeRange.value = Math.min(3840, Math.max(240, vp.w));
  }

  function syncAll() {
    /* prefs.plat 跟随视口断点（单一规则，两个方向不分叉）：手动点 plat seg 会连带
       切设备（syncDeviceToPlat），切设备/拉伸走到这里统一重算。仅当矩阵真有该选项才写。 */
    var platOpts = (((cfg.matrix || {}).plat || {}).options) || [];
    var curPlat = platOfWidth(viewport().w);
    if (curPlat && platOpts.some(function (o) { return o.v === curPlat; })) S.prefs.plat = curPlat;
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

  /* ── 老师的 __qa 合约：verify.mjs 靠它驱动门 B/C/D/F，必须保住 ── */
  window.__qa = {
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
    resize: function (w, h) { S.freeW = clamp(w, 240, 8000); S.freeH = clamp(h, 240, 8000); S.devIdx = -1; syncAll(); },
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

  readHash();
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
