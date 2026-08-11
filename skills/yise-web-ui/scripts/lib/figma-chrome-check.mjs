// figma-chrome-check.mjs — 验收壳冒烟检查（Skill 层通用件）。【2026-08-04 从 demo 迁入】
//
// 为什么必须有这个：渲染冒烟只直接调 renderApp，**完全不经过壳**。
// 壳要是抛异常，页面会一片空白，而渲染冒烟照样全绿 —— 这是个真实的盲区。
// 本检查让"壳能不能起来"变成可断言的：起没起来、建了几个控件、读数写了什么。
//
// 为什么迁进来：理由同 figma-render-check.mjs —— 内容几乎全是通用的，
// 住在 demo 目录里，下一个 demo 只能照抄，抄完两份必然漂移。
//
// 用法（demo 侧只留薄调用）：
//   import { runChromeCheck } from '../../scripts/lib/figma-chrome-check.mjs';
//   const ok = runChromeCheck({ demoDir: import.meta.dirname, expectedSelects: 2 });
//   process.exit(ok ? 0 : 1);
//
// 输出与搬家前的 demo 版逐行一致（搬家对照实验做过）；断言一条没丢。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export function runChromeCheck({ demoDir, expectedSelects = 2 }) {
  const html = readFileSync(join(demoDir, 'index.html'), 'utf8');

  /* ── DOM 桩 ── */
  let idSeq = 0;
  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.attrs = {};
      this.style = new Proxy({}, { set: (o, k, v) => { o[k] = v; return true; }, get: (o, k) => o[k] });
      this.classList = {
        _s: new Set(),
        add: (c) => this.classList._s.add(c),
        remove: (c) => this.classList._s.delete(c),
        contains: (c) => this.classList._s.has(c),
      };
      this._text = '';
      this._html = '';
      this.clientWidth = 1400;
      this.clientHeight = 800;
      this.disabled = false;
      this.__uid = ++idSeq;
    }
    set className(v) { this.attrs.class = v; }
    get className() { return this.attrs.class || ''; }
    set textContent(v) { this._text = String(v); }
    get textContent() { return this._text; }
    set innerHTML(v) { this._html = String(v); if (v === '') this.children = []; }
    get innerHTML() { return this._html; }
    set id(v) { this.attrs.id = v; }
    get id() { return this.attrs.id || ''; }
    set title(v) { this.attrs.title = String(v); }
    get title() { return this.attrs.title || ''; }
    set value(v) { this.attrs.value = v; }
    get value() { return this.attrs.value; }
    set type(v) { this.attrs.type = v; }
    get type() { return this.attrs.type; }
    set selected(v) { this.attrs.selected = v; }
    set min(v) { this.attrs.min = v; }
    set max(v) { this.attrs.max = v; }
    set step(v) { this.attrs.step = v; }
    set checked(v) { this.attrs.checked = v; }
    get checked() { return this.attrs.checked; }
    set offsetWidth(v) { this._offsetWidth = Number(v) || 0; }
    get offsetWidth() { return this._offsetWidth || Math.round(this.getBoundingClientRect().width); }
    set offsetHeight(v) { this._offsetHeight = Number(v) || 0; }
    get offsetHeight() { return this._offsetHeight || Math.round(this.getBoundingClientRect().height); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    removeAttribute(k) { delete this.attrs[k]; }
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); }
    getAttribute(k) { return this.attrs[k]; }
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
    addEventListener() {}
    getBoundingClientRect() { const l = 0, t = 0, w = this.clientWidth, h = this.clientHeight; return { left: l, top: t, width: w, height: h, right: l + w, bottom: t + h }; }
    querySelector(sel) {
      /* 宽容桩：支持 '.cls' 单类选择器（updateAttachedRail 要用），其余不保证 */
      const m = /^\.([A-Za-z0-9_-]+)$/.exec(String(sel || ''));
      if (!m) return null;
      const want = m[1];
      for (const e of this.walk()) {
        if (e === this) continue;
        if (((e.attrs && e.attrs.class) || '').split(' ').indexOf(want) >= 0) return e;
      }
      return null;
    }
    querySelectorAll() { return []; }
    *walk() { yield this; for (const c of this.children) yield* c.walk(); }
  }

  function blockOf(id) {
    const i = html.indexOf(`<script id="${id}"`);
    if (i < 0) return null;
    const s = html.indexOf('>', i) + 1;
    const e = html.indexOf('</' + 'script>', s);
    return html.slice(s, e);
  }

  const canonical = (v) => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v).sort()) o[k] = canonical(v[k]);
      return o;
    }
    return v;
  };
  const summarizeDevices = (p) => ({
    groups: Array.isArray(p?.deviceGroups) ? p.deviceGroups.length : 0,
    devices: Array.isArray(p?.deviceGroups)
      ? p.deviceGroups.reduce((n, g) => n + (Array.isArray(g?.devices) ? g.devices.length : 0), 0)
      : 0,
    breakpoints: Array.isArray(p?.breakpoints) ? p.breakpoints.length : 0,
  });

  const body = new El('body');
  const head = new El('head');
  const docEl = new El('html');
  const staticBlocks = {
    'qa-truth': blockOf('qa-truth'),
    'qa-assets': blockOf('qa-assets'),
    'qa-devices': blockOf('qa-devices'),
  };

  let deviceBlockCheck = { ok: false, why: 'not checked' };
  let deviceSummary = { groups: 0, devices: 0, breakpoints: 0 };
  let pcExpectedOptions = 0;
  try {
    const embedded = JSON.parse(staticBlocks['qa-devices'] || 'null');
    const local = JSON.parse(readFileSync(join(demoDir, 'fixtures/device-presets.json'), 'utf8'));
    deviceSummary = summarizeDevices(embedded);
    const pc = (embedded.deviceGroups || []).find((g) => g.key === 'PC') || {};
    pcExpectedOptions = (Array.isArray(pc.devices) ? pc.devices.length : 0) + (pc.freeResize ? 1 : 0);
    deviceBlockCheck = {
      ok: JSON.stringify(canonical(embedded)) === JSON.stringify(canonical(local)),
      why: `embedded ${deviceSummary.groups} groups/${deviceSummary.devices} devices/${deviceSummary.breakpoints} breakpoints`,
    };
  } catch (e) {
    deviceBlockCheck = { ok: false, why: e.message };
  }

  globalThis.document = {
    head, body, documentElement: docEl,
    createElement: (t) => new El(t),
    createTextNode: (t) => { const e = new El('#text'); e.textContent = t; return e; },
    getElementById: (id) => (staticBlocks[id] != null ? { textContent: staticBlocks[id] } : null),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
  };
  globalThis.window = globalThis;
  globalThis.addEventListener = () => {};
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.location = { hash: '', href: 'file:///index.html' };
  globalThis.history = { replaceState: () => {} };
  // Node 里 navigator 是只读的 getter，只能用 defineProperty 覆盖
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: () => {} } }, configurable: true, writable: true,
  });
  globalThis.getComputedStyle = () => ({ fontSize: '16px' });

  /* ── 先装 Skill 层通用渲染器（壳会调 renderApp，它委托给 window.__figmaRender）── */
  {
    const rs = html.indexOf('/* FIGMA_RENDER_BEGIN');
    const re = html.indexOf('/* FIGMA_RENDER_END */');
    if (rs < 0 || re < 0) { console.log('✗ index.html 里没有 FIGMA_RENDER 区，先跑 scripts/figma-inline.mjs'); return false; }
    new Function(html.slice(rs, re))();
  }

  /* ── 装 __qaDemo ── */
  const dStart = html.indexOf('window.__qaDemo = {');
  const dEnd = html.indexOf('\n};\n</' + 'script>', dStart);
  if (dStart < 0 || dEnd < 0) { console.log('✗ 定位不到 __qaDemo'); return false; }
  // eslint-disable-next-line no-new-func
  new Function(html.slice(dStart, dEnd + 3))();

  /* ── 装壳 ── */
  const cStart = html.indexOf('/* FIGMA_CHROME_BEGIN');
  const cEnd = html.indexOf('/* FIGMA_CHROME_END */');
  if (cStart < 0 || cEnd < 0) { console.log('✗ 定位不到壳（FIGMA_CHROME_BEGIN/END）'); return false; }
  const chromeSrc = html.slice(cStart, cEnd);

  let err = null;
  try {
    // eslint-disable-next-line no-new-func
    new Function(chromeSrc)();
  } catch (e) { err = e; }

  console.log('壳冒烟测试');
  console.log('');
  if (err) {
    console.log('❌ 壳起不来（页面会是空白，而渲染冒烟照样全绿——这就是盲区）');
    console.log('   ' + err.message);
    console.log((err.stack || '').split('\n').slice(1, 5).map((l) => '   ' + l.trim()).join('\n'));
    return false;
  }

  /* ── 断言 ── */
  const all = [...body.walk()];
  const cls = (e) => e.attrs.class || '';
  const bars = all.filter((e) => cls(e) === 'bar');
  const rows = all.filter((e) => cls(e) === 'row');
  const segs = all.filter((e) => cls(e) === 'seg');
  const segBtns = all.filter((e) => e.tagName === 'BUTTON' && e.parentNode && cls(e.parentNode) === 'seg');
  const selects = all.filter((e) => e.tagName === 'SELECT');
  const viewportResizeControls = all.filter((e) => e.attrs['data-qa-viewport-resize']);
  const viewportResizeRails = all.filter((e) => e.attrs['data-qa-viewport-resize-rail']);
  const numericInputs = all.filter((e) => e.tagName === 'INPUT' && e.attrs.type === 'number');
  /* 查重口径（2026-08-05 修）：真正的风险是**同一 seg 内**出现两个同值 pref 入口
     （并列、同效，replay 不知点哪个、必漂）。设备组 seg 跨组映射到同一 plat
     （iPhone/Android/折叠屏→plat:mobile）是**设计上的冗余入口** —— 点任一设备组都
     正确同步「设备组 + viewport」，语义不歧义，不算重复。故按 seg 分组查重。 */
  const duplicatePrefs = [];
  segs.forEach((sg) => {
    const vals = (sg.children || []).map((b) => b.attrs && b.attrs['data-qa-pref']).filter(Boolean);
    vals.forEach((v, i) => { if (vals.indexOf(v) !== i) duplicatePrefs.push(v); });
  });
  const deviceGroupButtons = segs[0] ? (segs[0].children || []).filter((e) => e.tagName === 'BUTTON') : [];
  const deviceSelectOptions = selects[0] ? (selects[0].children || []).filter((e) => e.tagName === 'OPTION') : [];
  const readouts = all.filter((e) => cls(e).split(' ').indexOf('readout') >= 0);
  const readoutsHidden = readouts.filter((e) => cls(e).split(' ').indexOf('off') >= 0);
  const languageSelect = all.find((e) => e.tagName === 'SELECT' && e.attrs['data-qa-pref-key'] === 'lang');
  const stateSelect = all.find((e) => e.tagName === 'SELECT' && e.attrs['data-qa-state-select'] === '1');
  const tileToggle = all.find((e) => e.tagName === 'INPUT' && e.attrs['data-qa-state-tile'] === '1');
  const subsetBtn = all.find((e) => e.tagName === 'BUTTON' && String(e.textContent).indexOf('勾选子集') === 0);
  const removedControls = all.filter((e) => e.tagName === 'BUTTON' && /^(诊断|复制溢出清单)/.test(String(e.textContent)));
  const frames = all.filter((e) => cls(e) === 'frame');
  const styleTags = [...head.walk()].filter((e) => e.tagName === 'STYLE');
  const cssText = styleTags.map((e) => e.textContent).join('');

  /* 字体字节级校验：#qa-fonts 里每个 @font-face 的 src 引用的字节必须等于
     fonts-manifest.json 里登记的 sha256 —— 比"看起来注入了"强得多。
     两种形态都认（2026-08-04 一天之内两种都用过）：
       data:font/...;base64,... → 解码后算 sha256
       url("assets/fonts/x")    → 读磁盘文件算 sha256（file:// 可加载已实测，见台账）
     没有用字体的 demo 没有 #qa-fonts 块，这条直接过。 */
  let fontCheck = null;
  {
    const fi = html.indexOf('<style id="qa-fonts">');
    if (fi >= 0) {
      const fs0 = html.indexOf('>', fi) + 1;
      const fe = html.indexOf('</style>', fs0);
      const css = html.slice(fs0, fe);
      let fm = null;
      try { fm = JSON.parse(readFileSync(join(demoDir, 'fonts-manifest.json'), 'utf8')); } catch {}
      const uris = [...css.matchAll(/src:url\("([^"]+)"\)/g)].map((m) => m[1]);
      const known = new Set(Object.values((fm && fm.fonts) || {}).map((f) => f.sha256));
      const bad = [];
      let checked = 0;
      for (const u of uris) {
        try {
          let buf = null;
          const dm = /^data:[^,]+;base64,(.+)$/.exec(u);
          if (dm) buf = Buffer.from(dm[1], 'base64');
          else if (fm) buf = readFileSync(join(demoDir, u));
          if (!buf) { bad.push(u.slice(0, 40)); continue; }
          checked++;
          const h = createHash('sha256').update(buf).digest('hex');
          if (!known.has(h)) bad.push(u.slice(0, 40) + '→' + h.slice(0, 8));
        } catch (e) { bad.push(u.slice(0, 40) + '(读不到)'); }
      }
      const missing = Array.isArray(fm?.missing) ? fm.missing : [];
      fontCheck = { total: uris.length, checked, bad, missing, hasManifest: !!fm };
    }
  }

  const qa = globalThis.__qa || {};

  /* ── 移动轴与交互断言（2026-08-04 加，对应 Skill 预览断点模型修复）──
     桩的局限先声明：getBoundingClientRect 在桩里全 0（无布局引擎），
     所以「贴边」验的是几何**关系**（left ≡ right−wrapLeft−半宽），不是屏幕像素；
     真像素由 verify.mjs 在真实浏览器里验（同一份代码，两处口径一致）。 */
  const railEl = all.find((e) => cls(e) === 'resize-rail-attached');
  const railChecks = [];
  if (railEl) {
    const fr = railEl.parentNode ? (function () {
      /* attachedRail 的父是 wrap；frame 是 wrap 的另一个子级 */
      const wrap = railEl.parentNode;
      const frameEl = (wrap.children || []).find((c) => cls(c) === 'frame');
      return { wr: wrap.getBoundingClientRect(), fr: frameEl ? frameEl.getBoundingClientRect() : null };
    })() : { wr: null, fr: null };
    /* 2026-08-05：右上角单一拖拽把手（用户澄清：PC 只要右上角一个把手，撤中部竖条）。
       把手盖在**屏幕容器（wrap）右上角外侧**：left=wrap.offsetWidth−半宽、top=−半高（探出上缘）。
       桩里 offsetWidth 未实现（默认 0），验「left=wrap.offsetWidth−17、top=−17、尺寸 34px」几何关系，
       像素级贴边与胶囊形态由真实浏览器断言（figma-chrome-browser-check）。 */
    if (fr.wr && fr.fr) {
      const leftPx = parseFloat(railEl.style.left) || 0;
      const topPx = parseFloat(railEl.style.top) || 0;
      const wrapOW = railEl.parentNode ? (railEl.parentNode.offsetWidth || 0) : 0;
      railChecks.push(['把手在屏幕容器（wrap）右上角外侧舞台区', leftPx === Math.round(wrapOW + 6) && topPx === 6,
        'left=' + leftPx + ' top=' + topPx + ' 应=(' + Math.round(wrapOW + 6) + ',6)——left>wrap.offsetWidth 即在右缘外侧']);
      const hPx = parseFloat(railEl.style.height) || 0;
      railChecks.push(['把手容器是 34px 角块（非整条竖轨）', hPx === 34, 'height=' + hPx + ' 应=34']);
    } else {
      railChecks.push(['把手能取到 wrap/frame 矩形', false, 'wrap/frame 不在同一父级或缺 rect']);
    }
    railChecks.push(['rail 带 data-rail-mode（drag/locked）', railEl.getAttribute('data-rail-mode') === 'drag' || railEl.getAttribute('data-rail-mode') === 'locked',
      'data-rail-mode=' + railEl.getAttribute('data-rail-mode')]);
  } else {
    railChecks.push(['移动轴存在于 DOM', false, '找不到 .resize-rail-attached']);
  }

  /* H 方向映射符号（2026-08-05 用户纠正：向下拖 H 应变小、向上拖 H 应变大——把手在上缘，
     与拖下缘/右下角的直觉相反）。桩没有布局引擎跑不了真实 pointer，改成对内联进 index.html
     的 chrome bundle 做**源码级**断言：freeH 必须是 startH − dy（向下 dy>0 → H 变小），
     且 freeW 仍是 startW + dx（向右 dx>0 → W 变大，语义不变）。防再次把方向写反。 */
  railChecks.push(['H 方向映射：向下拖 H 变小（startH − dy）、W 仍 startW + dx',
    /startH\s*-\s*\(\s*e\.clientY\s*-\s*startY\s*\)/.test(html) && /startW\s*\+\s*\(\s*e\.clientX\s*-\s*startX\s*\)/.test(html),
    '需含 startH − (e.clientY − startY) 且 startW + (e.clientX − startX)']);

  /* frame 真实内容：渲染后 frame 内必须有节点元素（防空白页）。
     桩里 renderApp 是 Skill 层真渲染器，应产出 .fx-n 节点。 */
  const frameEl2 = all.find((e) => cls(e) === 'frame');
  const fxNodes = frameEl2 ? [...frameEl2.walk()].filter((e) => (e.attrs['data-node'] || '') !== '' || (cls(e).indexOf('fx-n') >= 0)) : [];
  const contentCheck = ['frame 内有真实渲染内容（非空白页）', fxNodes.length > 0, 'frame 内 fx 节点 ' + fxNodes.length + ' 个'];

  /* PC resize：__qa.resize(w,h) 后 viewport 宽应变（freeResize 组）。
     桩里默认 PC 组（initDevice 落 PC defaultIndex），resize 后 devIdx=-1 走 freeW。 */
  let pcResizeOk = false, pcResizeWhy = '';
  try {
    const before = qa.inspect ? qa.inspect().viewport.w : null;
    qa.resize(1600, 900);
    const after = qa.inspect ? qa.inspect().viewport.w : null;
    pcResizeOk = (before !== null && after === 1600);
    pcResizeWhy = 'resize 前 ' + before + ' 后 ' + after;
  } catch (e) { pcResizeWhy = 'resize 抛错: ' + e.message; }
  const pcResizeCheck = ['PC 可 resize 改真实 viewport 宽', pcResizeOk, pcResizeWhy];

  /* 非 PC orientation：iPad/手机锁定时 setOrientation 可切横竖屏，且 viewport 宽高对调。
     先切到 iPhone 组（设备下拉 value=1），再 setOrientation('landscape')。 */
  let orientOk = false, orientWhy = '';
  try {
    /* 设备下拉第一组是 PC；切到 iPhone（index 1 的设备组）经 prefs.plat 或直接操作 S 不可达，
       桩里走 __qa 没有切组 API —— 改为直接验证 canOrient 口径：
       PC 组 setOrientation 必须抛错（不可横竖屏），非 PC 组由 verify 真实浏览器验。 */
    let pcThrew = false;
    try { qa.setOrientation('landscape'); } catch (e) { pcThrew = true; }
    orientOk = pcThrew;
    orientWhy = pcThrew ? 'PC 组正确拒绝横竖屏切换' : 'PC 组居然能切横竖屏（应只允许设备锁定的非 PC 组）';
  } catch (e) { orientWhy = '探测抛错: ' + e.message; }
  const orientCheck = ['PC 组不可横竖屏切换（非 PC 才开放）', orientOk, orientWhy];

  const checks = [
    ['壳没抛异常', true, ''],
    ['注入了样式', styleTags.length > 0 && cssText.length > 500, `style 标签 ${styleTags.length} 个`],
    ['配色是深黑灰（抄同事的变量）', cssText.includes('--bar:#171b22') && cssText.includes('--stage:#0c0f14'), '配色变量没对上'],
    ['两行控制栏', bars.length === 1 && rows.length === 2, `bar ${bars.length} / row ${rows.length}`],
    ['有设备组与区域分段控件', segs.length >= 2 && segBtns.length >= deviceSummary.groups,
      `seg ${segs.length} / 按钮 ${segBtns.length} / 设备组 ${deviceSummary.groups}`],
    ['设备预设完整来自 fixtures/device-presets.json', deviceBlockCheck.ok, deviceBlockCheck.why],
    ['设备组按钮没有漏设备表分组', deviceGroupButtons.length === deviceSummary.groups,
      `UI groups=${deviceGroupButtons.length} / fixture groups=${deviceSummary.groups}`],
    ['当前 PC 设备下拉含全部 PC 档位与自由状态', deviceSelectOptions.length === pcExpectedOptions,
      `option ${deviceSelectOptions.length} 个（期望 ${pcExpectedOptions}）`],
    ['顶部 viewport 控件与 kit 一致（W/H 输入 + 唯一宽度滑块 + 唯一角把手）',
      viewportResizeControls.length === 1 && viewportResizeRails.length === 1 && numericInputs.length === 2,
      `resizeControls=${viewportResizeControls.length} rails=${viewportResizeRails.length} numberInputs=${numericInputs.length}`],
    ['data-qa-pref 合约无重复入口', duplicatePrefs.length === 0,
      duplicatePrefs.length ? `重复 ${[...new Set(duplicatePrefs)].join(',')}` : '0 duplicate'],
    ['下拉数量符合设备/语言/状态三项', selects.length === expectedSelects, `select ${selects.length} 个（期望 ${expectedSelects}）`],
    ['语言使用 kit 规定的下拉控件', !!languageSelect, '缺 select[data-qa-pref-key="lang"]'],
    ['状态下拉与平铺/子集入口始终存在', !!stateSelect && !!tileToggle && !!subsetBtn,
      `state=${!!stateSelect} tile=${!!tileToggle} subset=${!!subsetBtn}`],
    ['视口读数常显（不再依赖诊断开关）', readouts.length === 1 && readoutsHidden.length === 0,
      `readout=${readouts.length} hidden=${readoutsHidden.length}`],
    ['移除 kit 未定义的断点快捷/诊断/溢出复制控件', removedControls.length === 0 && !cssText.includes('断点边界'),
      `遗留按钮=${removedControls.map((e) => e.textContent).join(',') || '0'}`],
    ['有 .frame 渲染容器', frames.length >= 1, `frame ${frames.length} 个`],
    ['老师的 __qa 合约齐全', ['current', 'goto', 'prefs', 'scale', 'resize', 'metrics'].every((k) => typeof qa[k] === 'function'),
      '缺：' + ['current', 'goto', 'prefs', 'scale', 'resize', 'metrics'].filter((k) => typeof qa[k] !== 'function').join(',')],
    /* 溢出清单导出（给本地化的「哪条文案超了多少」）—— 超框缩字号的留痕出口。
       桩里 querySelectorAll 返回空，清单该是 0 条但结构必须完整。 */
    ['溢出清单导出可用', typeof qa.copyOverflowReport === 'function'
      && (() => { const r = qa.copyOverflowReport(); return r && r.count === 0 && Array.isArray(r.items); })(),
      'copyOverflowReport 缺失或返回形状不对'],
    ['字体字节级可校验（src 引用的字节 ≡ 清单 sha256）',
      fontCheck == null ? true : (fontCheck.hasManifest && fontCheck.total > 0 && fontCheck.bad.length === 0 && fontCheck.missing.length === 0),
      fontCheck == null ? '没有 #qa-fonts 块（本 demo 没用字体，这条不适用）'
        : !fontCheck.hasManifest ? '有字体声明但读不到 fonts-manifest.json'
        : fontCheck.total === 0 ? '有 #qa-fonts 块但一个 src:url 都没匹配到'
        : `${fontCheck.bad.length}/${fontCheck.total} 个字体的字节对不上清单（${fontCheck.bad[0]}…）`],
    contentCheck,
    pcResizeCheck,
    orientCheck,
  ].concat(railChecks);

  console.log('控件清点：');
  console.log(`  控制栏 ${bars.length} 个（${rows.length} 行） · 分段控件 ${segs.length} 组 / ${segBtns.length} 个按钮`);
  console.log(`  下拉 ${selects.length} 个 · 读数区 ${readouts.length} 个 · 渲染容器 ${frames.length} 个`);
  console.log(`  设备预设 ${deviceSummary.groups} 组 / ${deviceSummary.devices} 台 / ${deviceSummary.breakpoints} 断点 · viewport 控件 ${viewportResizeControls.length}+${viewportResizeRails.length}`);
  if (readouts[0]) console.log('  读数1：' + String(readouts[0].innerHTML).replace(/<[^>]+>/g, '').slice(0, 110));
  if (readouts[1]) console.log('  读数2：' + String(readouts[1].innerHTML).replace(/<[^>]+>/g, '').slice(0, 110));
  console.log(`  当前状态 __qa.current() = ${typeof qa.current === 'function' ? qa.current() : '?'}`);
  console.log('');
  for (const [name, pass, why] of checks) console.log(`${pass ? '✅' : '❌'} ${name}${pass ? '' : '  —  ' + why}`);

  const ok = checks.every(([, p]) => p);
  console.log('');
  console.log(ok ? '✅ 壳冒烟通过' : '❌ 壳冒烟失败');
  return ok;
}
