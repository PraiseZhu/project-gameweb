// figma-chrome-browser-check.mjs —— 移动轴/断点模型的真实浏览器断言（Skill 层通用件，2026-08-05）。
//
// 为什么必须有这份（与 Node 桩分工）：
//   chrome-check 的 Node 桩没有布局引擎，getBoundingClientRect 全是 0 —— 桩只能验几何**关系**，
//   验不了「移动轴真的贴在屏幕右上角、可见、不被裁」这种**屏幕像素级**事实。
//   上次整页推进就踩过：壳起得来、渲染冒烟全绿，但真实浏览器里移动轴漂/空白没人发现。
//   本文件把这件事变成可断言的：真实浏览器加载**交付原地**的 index.html，
//   现测 wrap/rail 的 getBoundingClientRect，逐条断言。
//
// 与 verify 的快照模型的关系（有意为之，不是绕过）：
//   verify 的门 B/C/D/F 一律从**不可变快照**加载（I-OBSERVE）；
//   本脚本作为 gateX 注册进 spec.customGates 后，verify 用整树副本执行它 ——
//   它服务的是 demo 原地（不是快照），验的是「交付给用户的 index.html」本身。
//   两者字节由 gateA 的双向 manifest + hash 复算对账。
//
// 跑法（gateX 由 verify 用 node <script> --demo <dir> 调用；也可手跑）：
//   node scripts/lib/figma-chrome-browser-check.mjs --demo demos/yise-ss5-preview
//   环境变量 CHROME_PATH 指向本机 Chrome（Windows 用反斜杠路径）。
//
// 通用性：不硬编码任何 demo 专属节点 id / 分区名 / 文案。所有几何都从 DOM 现测。

import { createSafeStaticServer } from './safe-server.mjs';
import { launchChromium } from './resolve-playwright.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadNavRailTruth, probeNavRailContinuity } from './figma-nav-rail-browser-check.mjs';

export async function runChromeBrowserCheck({ demoDir, timeoutMs = 180000 } = {}) {
  const results = [];   // [name, pass, why]
  const P = (name, pass, why) => results.push([name, !!pass, String(why ?? '')]);

  let server = null, browser = null;
  try {
    server = createSafeStaticServer(demoDir);
    const base = await server.listen();
    ({ browser } = await launchChromium(demoDir, { headless: true }));
    const pageErrors = [];
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e).slice(0, 200)));

    await page.goto(base + '/index.html', { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForFunction(() => typeof window.__qa === 'object' && window.__qa !== null, null, { timeout: timeoutMs }).catch(() => {});
    /* Interactive review intentionally defers far-off/inactive proof images.
       This gate audits the deterministic acceptance state instead: force the
       renderer's generic readiness promise before asserting every baked asset
       is complete, so the old eager/complete claim is no longer accidental. */
    await page.evaluate(() => typeof window.__fxAssetsReady === 'function'
      ? window.__fxAssetsReady() : Promise.resolve()).catch(() => {});
    await page.evaluate(() => (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve()).catch(() => {});
    /* Mount CSS animations (motion.config roles) may still be mid-flight right
       after load; their interpolated filter/opacity is a transient, not the
       static Figma paint. Let all [data-motion-role] animations settle before
       the static pixel gates sample computed styles. */
    await page.evaluate(() => {
      const els = [...document.querySelectorAll('[data-motion-role]')];
      return Promise.all(els.map((el) => {
        const anim = el.getAnimations ? el.getAnimations().find((a) => a.playState === 'running') : null;
        if (!anim) return Promise.resolve();
        return new Promise((resolve) => {
          const done = () => { anim.removeEventListener('finish', done); resolve(); };
          anim.addEventListener('finish', done);
          setTimeout(done, 3000);
        });
      }));
    }).catch(() => {});
    await page.waitForTimeout(150);

    /* 0) 开启「缩放到可视区」(S.fit) 再测几何。
       本检查固定用 1600x900 的浏览器视口，而交付默认 PC 1920、壳默认 fit=false(1:1 像素级)
       —— 此时 wrap 必然溢出 stage，「screen 四周有呼吸空间」「把手在视口内可见」这类
       装得下才成立的断言在 1:1 下无意义。真实用户遇到装不下会勾选「缩放到可视区」，
       本检查就按那个姿态测：模拟点击顶栏 fit checkbox(与真实交互同一入口)，等两帧。 */
    const fitOn = await page.evaluate(() => {
      const chk = [...document.querySelectorAll('.bar input[type=checkbox]')]
        .find((c) => ((c.parentElement && c.parentElement.textContent) || '').includes('缩放到可视区'));
      if (!chk) return { found: false };
      if (!chk.checked) chk.click();
      return { found: true, wasChecked: chk.checked };
    });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const fitNow = await page.evaluate(() => {
      const ins = window.__qa.inspect();
      const chk = [...document.querySelectorAll('.bar input[type=checkbox]')]
        .find((c) => ((c.parentElement && c.parentElement.textContent) || '').includes('缩放到可视区'));
      return { scale: ins.viewFitScale, checked: !!(chk && chk.checked) };
    });
    P('已开启「缩放到可视区」fit（几何断言的前提姿态，模拟真实勾选）',
      fitOn.found && fitNow.checked && fitNow.scale < 1,
      'found=' + fitOn.found + ' checked=' + fitNow.checked + ' fitScale=' + Number(fitNow.scale).toFixed(4));


    /* 1) pageerror：bundle 初始化期任何未捕获异常 = 可能空白页，fail-closed */
    P('页面无未捕获异常（pageerror，防空白页）', pageErrors.length === 0,
      pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : '0 条');

    /* 2) frame 内有真实渲染内容（非空白页） */
    const content = await page.evaluate(() => {
      const f = document.querySelector('.frame');
      if (!f) return { hasFrame: false, fxNodes: 0, textLen: 0 };
      const fx = f.querySelectorAll('[data-node], .fx-n, .fx-t, img.fx-img').length;
      return { hasFrame: true, fxNodes: fx, textLen: (f.textContent || '').trim().length };
    });
    P('frame 内有真实渲染内容（非空白页）', content.hasFrame && content.fxNodes > 0,
      'hasFrame=' + content.hasFrame + ' fxNodes=' + content.fxNodes + ' textLen=' + content.textLen);

    const shadowRoute = await page.evaluate(() => {
      const normNone = (v) => !v || v === 'none' || v === 'rgba(0, 0, 0, 0) 0px 0px 0px 0px';
      const nodes = [...document.querySelectorAll('.frame .fx-n')];
      const assetHosts = nodes.filter((el) => [...el.children].some((c) => c.tagName === 'IMG' && c.classList.contains('fx-img')));
      const assetBad = assetHosts.filter((el) => {
        const cs = getComputedStyle(el);
        /* A finished mount animation (e.g. kvTitle blur-scale-in) legitimately
           leaves lur(0px) in the computed filter — it is a pixel no-op and
           must not be mistaken for an extra static effect. Any non-zero blur
           or drop-shadow on a baked asset is still a real duplication. */
        const noopFilter = (cs.filter || '') === 'blur(0px)' || (cs.filter || '') === 'none' || cs.filter === '';
        return !normNone(cs.boxShadow) || (!noopFilter && /drop-shadow|blur\(/.test(cs.filter || ''));
      });
      const filterHosts = nodes.filter((el) => el.getAttribute('data-shadow-via') === 'filter' && !el.classList.contains('fx-t'));
      const filterBad = filterHosts.filter((el) => {
        const cs = getComputedStyle(el);
        return !/drop-shadow/.test(cs.filter || '') || !normNone(cs.boxShadow);
      });
      const baked = assetHosts.filter((el) => el.getAttribute('data-shadow-via') === 'asset-baked' || el.getAttribute('data-blur-via') === 'asset-baked');
      const assetManifest = JSON.parse(document.getElementById('qa-assets')?.textContent || '{}');
      const renderBoundHosts = assetHosts.filter((el) => el.getAttribute('data-asset-bounds') === 'render');
      const renderBoundBad = renderBoundHosts.filter((el) => {
        const raw = String(el.getAttribute('data-node-box') || '').split(',').map(Number);
        if (raw.length !== 4 || raw.some((n) => !Number.isFinite(n))) return true;
        const img = el.querySelector('img.fx-img');
        if (!img) return true;
        /* The asset img is sized to the export renderBox (larger than the
           source box where the effect overflows). Flag only when the img is
           NOT larger than the host box in any direction — that is the case
           where the render-bounds overflow was lost and the effect would be
           clipped. CSS zoom scales both by the same factor, so comparing the
           two computed boxes is scale-independent. */
        const hcs = getComputedStyle(el);
        const hw = parseFloat(hcs.width || '0');
        const hh = parseFloat(hcs.height || '0');
        if (!Number.isFinite(hw) || !Number.isFinite(hh) || hw <= 0 || hh <= 0) return true;
        const cs = getComputedStyle(img);
        const w = parseFloat(cs.width || '0');
        const h = parseFloat(cs.height || '0');
        const rec = assetManifest[el.getAttribute('data-node')];
        const ex = rec && rec.exportBox;
        if (ex && Number.isFinite(Number(ex.w)) && Number.isFinite(Number(ex.h))) {
          const expectedW = Number(ex.w);
          const expectedH = Number(ex.h);
          const expectedOverflowX = Math.max(0, expectedW - raw[2]);
          const expectedOverflowY = Math.max(0, expectedH - raw[3]);
          const measuredOverflowX = w - hw;
          const measuredOverflowY = h - hh;
          const meaningfulOverflow = 4;
          return (expectedOverflowX > meaningfulOverflow && measuredOverflowX + 0.75 < expectedOverflowX)
            || (expectedOverflowY > meaningfulOverflow && measuredOverflowY + 0.75 < expectedOverflowY);
        }
        return w <= hw + 1 && h <= hh + 1;
      });
      /* A baked asset must not redraw its painted children. Structural
         interaction layers (indicator/tab/switch-action hosts, empty flex
         slots used for state switching) are intentionally kept above the PNG;
         they carry interaction evidence and paint nothing themselves. Treat
         only descendants that actually paint (fill, image, border, shadow,
         filter) as baked duplicates. */
      const paints = (child) => {
        const cs = getComputedStyle(child);
        return (cs.backgroundImage && cs.backgroundImage !== 'none')
          || (cs.backgroundColor && !/rgba\(0, 0, 0, 0\)/.test(cs.backgroundColor))
          || child.querySelector('img') != null
          || (cs.boxShadow && cs.boxShadow !== 'none')
          || (cs.filter && cs.filter !== 'none')
          || (cs.outlineStyle && cs.outlineStyle !== 'none');
      };
      /* A blend-lifted layer (data-blend-overlay) is a deliberate mix-blend-mode
         re-composite of a non-default-blend child the baked export flattened. It
         is NOT a boolean/rectangle operand fragment; exclude it from the duplicate
         paint check (its backdrop mix is the intended visual). */
      const assetDescBad = assetHosts.filter((el) =>
        [...el.querySelectorAll('.fx-n')].some((child) => child !== el && !child.hasAttribute('data-blend-overlay') && paints(child)));
      const assetLoadBad = assetHosts.filter((el) => {
        const img = el.querySelector('img.fx-img');
        return !img || img.getAttribute('loading') !== 'eager' || !img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0;
      });
      const frame = document.querySelector('.frame');
      const frameShadow = frame ? getComputedStyle(frame).boxShadow : '';
      return {
        assetHosts: assetHosts.length,
        assetBad: assetBad.slice(0, 6).map((el) => ({ id: el.getAttribute('data-node'), boxShadow: getComputedStyle(el).boxShadow, filter: getComputedStyle(el).filter })),
        filterHosts: filterHosts.length,
        filterBad: filterBad.slice(0, 6).map((el) => ({ id: el.getAttribute('data-node'), boxShadow: getComputedStyle(el).boxShadow, filter: getComputedStyle(el).filter })),
        baked: baked.length,
        renderBoundHosts: renderBoundHosts.length,
        renderBoundBad: renderBoundBad.slice(0, 6).map((el) => { const img = el.querySelector('img.fx-img'); return { id: el.getAttribute('data-node'), cssWidth: img ? getComputedStyle(img).width : null, cssHeight: img ? getComputedStyle(img).height : null, nodeBox: el.getAttribute('data-node-box') }; }),
        assetDescBad: assetDescBad.slice(0, 6).map((el) => ({ id: el.getAttribute('data-node'), children: el.querySelectorAll('.fx-n').length })),
        assetLoadBad: assetLoadBad.slice(0, 6).map((el) => { const img = el.querySelector('img.fx-img'); return { id: el.getAttribute('data-node'), loading: img && img.getAttribute('loading'), complete: !!(img && img.complete), naturalWidth: img ? img.naturalWidth : 0, naturalHeight: img ? img.naturalHeight : 0 }; }),
        frameShadow,
        frameSoftShadow: !!frameShadow && frameShadow !== 'none' && !/ 0px 0px 0px 1px$/.test(frameShadow),
      };
    });
    P('切图资产容器不再叠矩形 box-shadow / CSS filter（避免投影块和重复投影）',
      shadowRoute.assetHosts > 0 && shadowRoute.assetBad.length === 0,
      'assets=' + shadowRoute.assetHosts + ' bakedEffect=' + shadowRoute.baked + ' bad=' + JSON.stringify(shadowRoute.assetBad));
    P('透明/组合节点投影走 filter:drop-shadow，且不走矩形 box-shadow',
      shadowRoute.filterBad.length === 0,
      'filterHosts=' + shadowRoute.filterHosts + ' bad=' + JSON.stringify(shadowRoute.filterBad));
    P('真实 screen frame 本身不加软投影（1px 描边允许，bezel 阴影不落到内容 frame）',
      !shadowRoute.frameSoftShadow,
      'frame box-shadow=' + shadowRoute.frameShadow);

    P('带效果外溢的切图资产在真实浏览器按 render bounds 放大定位',
      shadowRoute.renderBoundHosts > 0 && shadowRoute.renderBoundBad.length === 0,
      'renderBoundHosts=' + shadowRoute.renderBoundHosts + ' bad=' + JSON.stringify(shadowRoute.renderBoundBad));
    P('切图资产子级不再重复绘制（避免布尔/矩形操作数残片盖在 PNG 上）',
      shadowRoute.assetHosts > 0 && shadowRoute.assetDescBad.length === 0,
      'assets=' + shadowRoute.assetHosts + ' bad=' + JSON.stringify(shadowRoute.assetDescBad));
    P('切图资产在确定性验收就绪后已实际加载（避免滚动截图组件空白）',
      shadowRoute.assetHosts > 0 && shadowRoute.assetLoadBad.length === 0,
      'assets=' + shadowRoute.assetHosts + ' bad=' + JSON.stringify(shadowRoute.assetLoadBad));

    const controls = await page.evaluate(() => {
      const presets = JSON.parse(document.getElementById('qa-devices')?.textContent || 'null');
      const groups = presets?.deviceGroups || [];
      const pc = groups.find((g) => g.key === 'PC') || {};
      const deviceGroupSeg = document.querySelector('.bar .row:first-child .seg');
      return {
        groupButtons: deviceGroupSeg ? deviceGroupSeg.querySelectorAll('button').length : 0,
        groups: groups.length,
        deviceOptions: document.querySelectorAll('[data-qa-device-select] option').length,
        pcExpectedOptions: (pc.devices || []).length + (pc.freeResize ? 1 : 0),
        resizeControls: document.querySelectorAll('[data-qa-viewport-resize]').length,
        resizeRails: document.querySelectorAll('[data-qa-viewport-resize-rail]').length,
        numberInputs: document.querySelectorAll('.bar input[type="number"]').length,
        languageSelect: document.querySelectorAll('select[data-qa-pref-key="lang"]').length,
        stateSelect: document.querySelectorAll('select[data-qa-state-select]').length,
        stateOptions: document.querySelectorAll('select[data-qa-state-select] option').length,
        stateTile: document.querySelectorAll('[data-qa-state-tile]').length,
        stateTileDisabled: !!document.querySelector('[data-qa-state-tile]')?.disabled,
        subset: [...document.querySelectorAll('.bar button')].filter((button) => /^勾选子集/.test(button.textContent || '')).length,
        subsetDisabled: !![...document.querySelectorAll('.bar button')].find((button) => /^勾选子集/.test(button.textContent || ''))?.disabled,
        readouts: document.querySelectorAll('.readout').length,
        hiddenReadouts: [...document.querySelectorAll('.readout')].filter((readout) => getComputedStyle(readout).visibility === 'hidden').length,
        removed: [...document.querySelectorAll('.bar button')].filter((button) => /^(诊断|复制溢出清单)/.test(button.textContent || '')).map((button) => button.textContent),
      };
    });
    P('设备组控件完整来自 #qa-devices', controls.groupButtons === controls.groups,
      'UI groups=' + controls.groupButtons + ' / presets groups=' + controls.groups);
    P('当前 PC 设备下拉含完整尺寸表', controls.deviceOptions === controls.pcExpectedOptions,
      'options=' + controls.deviceOptions + ' / expected=' + controls.pcExpectedOptions);
    P('顶部 viewport 控件与 kit 一致（W/H 输入 + 唯一宽度滑块，无旧式角把手轨）',
      controls.resizeControls === 1 && controls.resizeRails === 0 && controls.numberInputs === 2,
      'resizeControls=' + controls.resizeControls + ' rails=' + controls.resizeRails + '（旧式角把手轨=0；右缘把手是 2026-08-11 用户新批准的另一控件 data-qa-edge-resize） W/H inputs=' + controls.numberInputs);
    /* Lead decision: viewport controls must be actually visible AND operable in
       the current browser viewport, not merely present in DOM. Measure real
       bounding rects + drive the slider and confirm the viewport changes. */
    const vpControls = await page.evaluate(() => {
      const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height),
                 inViewport: r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth,
                 enabled: !el.disabled }; };
      return {
        vw: innerWidth, vh: innerHeight,
        slider: rect(document.querySelector('[data-qa-viewport-resize]')),
        w: rect(document.querySelector('[data-qa-viewport-width-input]')),
        h: rect(document.querySelector('[data-qa-viewport-height-input]')),
      };
    });
    P('viewport 控件在当前浏览器视口内实际可见且可点（非仅 DOM 存在）',
      !!(vpControls.slider && vpControls.slider.inViewport && vpControls.slider.enabled
        && vpControls.w && vpControls.w.inViewport && vpControls.w.enabled
        && vpControls.h && vpControls.h.inViewport && vpControls.h.enabled),
      'slider=' + JSON.stringify(vpControls.slider) + ' W=' + JSON.stringify(vpControls.w) + ' H=' + JSON.stringify(vpControls.h));
    const sliderOp = await page.evaluate(async () => {
      const raf2 = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const before = window.__qa.inspect().viewport;
      const sl = document.querySelector('[data-qa-viewport-resize]');
      if (!sl) return { ok: false, why: 'no-slider' };
      const target = before.w === 1600 ? 1680 : 1600;
      sl.value = String(target);
      sl.dispatchEvent(new Event('input', { bubbles: true }));
      /* slider oninput 现为 RAF 合并（syncAll 推迟到下一帧），断言前等两帧。 */
      await raf2();
      const after = window.__qa.inspect().viewport;
      const dev = document.querySelector('[data-qa-device-select]');
      const devText = dev && dev.selectedOptions && dev.selectedOptions[0] ? dev.selectedOptions[0].textContent : '';
      return { ok: after.w === target && /自由状态/.test(devText), before: before.w, after: after.w, devText };
    });
    P('宽度滑块实际可拖动并驱动 viewport 进入自由状态',
      sliderOp.ok === true,
      'before=' + sliderOp.before + ' after=' + sliderOp.after + ' device=' + sliderOp.devText);
    /* 2026-08-11 用户批准恢复 PC 自由模式右缘拖拽把手（data-qa-edge-resize）。
       这里只断言存在性/几何/光标/可访问性/PC 未禁用；真实 pointer 拖拽回归见
       scripts/__tests__/_edge-resize-drag.mjs（headed Chrome 逐帧拖到 1600 并校验同步）。 */
    const edgeMeta = await page.evaluate(() => {
      const h = document.querySelector('[data-qa-edge-resize]');
      if (!h) return null;
      const r = h.getBoundingClientRect();
      const cs = getComputedStyle(h);
      return {
        inViewport: r.width > 0 && r.height > 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.left >= 0 && r.top >= 0,
        cursor: cs.cursor,
        role: h.getAttribute('role'),
        ariaLabel: h.getAttribute('aria-label'),
        notDisabled: !h.classList.contains('disabled'),
      };
    });
    P('PC 自由模式右缘把手存在、在视口内、col-resize、可访问且未禁用',
      !!(edgeMeta && edgeMeta.inViewport && edgeMeta.cursor === 'col-resize' && edgeMeta.role === 'separator' && edgeMeta.ariaLabel && edgeMeta.notDisabled),
      JSON.stringify(edgeMeta));
    P('内容栏对齐 kit：语言/状态下拉、平铺与子集入口常驻，读数可见',
      controls.languageSelect === 1 && controls.stateSelect === 1 && controls.stateOptions >= 1 && controls.stateTile === 1 && controls.subset === 1 && controls.readouts === 1 && controls.hiddenReadouts === 0,
      'lang=' + controls.languageSelect + ' state=' + controls.stateSelect + '/' + controls.stateOptions + ' tile=' + controls.stateTile + ' subset=' + controls.subset + ' readouts=' + controls.readouts + ' hidden=' + controls.hiddenReadouts);
    P('单状态 Demo 保留平铺/子集入口但正确锁定', controls.stateOptions === 1 && controls.stateTileDisabled && controls.subsetDisabled,
      'states=' + controls.stateOptions + ' tileDisabled=' + controls.stateTileDisabled + ' subsetDisabled=' + controls.subsetDisabled);
    P('已移除 kit 未定义的诊断/溢出复制控制', controls.removed.length === 0,
      controls.removed.length ? controls.removed.join('、') : '0 个');

    const dimensionInput = await page.evaluate(async () => {
      const raf2 = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const before = window.__qa.inspect().viewport;
      const set = async (attr, value) => {
        const input = document.querySelector('input[' + attr + '="true"]');
        if (!input) return null;
        input.value = String(value);
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await raf2();
        return window.__qa.inspect().viewport;
      };
      const afterWidth = await set('data-qa-viewport-width-input', 1587);
      const afterHeight = await set('data-qa-viewport-height-input', 932);
      const device = document.querySelector('[data-qa-device-select]');
      const deviceText = device ? device.options[device.selectedIndex].textContent : null;
      /* Restore the original screen before generic frame/rail geometry checks.
         The W/H assertion intentionally changes height, while the later checks
         measure the normal initial screen composition. */
      window.__qa.resize(before.w, before.h);
      await raf2();
      return { before, afterWidth, afterHeight, deviceText, restored: window.__qa.inspect().viewport };
    });
    P('PC 的 W/H 输入进入自由状态并分别更新实际 viewport',
      dimensionInput.afterWidth?.w === 1587 && dimensionInput.afterHeight?.w === 1587 && dimensionInput.afterHeight?.h === 932
        && /^自由状态/.test(dimensionInput.deviceText || ''),
      JSON.stringify(dimensionInput));

    const languageControl = await page.evaluate(async () => {
      const raf2 = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const select = document.querySelector('select[data-qa-pref-key="lang"]');
      if (!select || select.options.length < 2) return { applicable: false, options: select ? select.options.length : 0 };
      const before = select.value;
      const next = [...select.options].map((option) => option.value).find((value) => value !== before);
      select.value = next;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await raf2();
      const after = window.__qa.prefs().lang;
      const restored = document.querySelector('select[data-qa-pref-key="lang"]');
      restored.value = before;
      restored.dispatchEvent(new Event('change', { bubbles: true }));
      await raf2();
      return { applicable: true, before, next, after, restored: window.__qa.prefs().lang };
    });
    P('语言下拉真实写入并恢复 lang 偏好', !languageControl.applicable || (languageControl.after === languageControl.next && languageControl.restored === languageControl.before),
      JSON.stringify(languageControl));

    const visibleInitial = await page.evaluate(() => {
      const f = document.querySelector('.frame');
      const ins = window.__qa.inspect();
      const fr = f.getBoundingClientRect();
      const layoutW = parseFloat(getComputedStyle(f).width) || 0;
      const scale = ins.viewFitScale || 1;
      return { vp: ins.viewport, layoutW, visibleW: fr.width, scale };
    });
    P('viewport 与可见 screen 读数同源（初始态）',
      Math.abs(visibleInitial.layoutW - visibleInitial.vp.w) <= 1
        && Math.abs(visibleInitial.visibleW - visibleInitial.vp.w * visibleInitial.scale) <= 2,
      'viewport=' + visibleInitial.vp.w + ' layout=' + visibleInitial.layoutW.toFixed(1)
        + ' visible=' + visibleInitial.visibleW.toFixed(1) + ' scale=' + visibleInitial.scale.toFixed(4));

    /* 2b) screen 是黑色舞台中独立、完整可见的模拟屏（2026-08-05 用户红框：页面不能上下顶天立地）。
       现测 wrap 相对 stage 的四边间距 —— wrap 完整落在 stage 内（不被裁），四周都有黑色呼吸空间；
       内容在 frame 内部纵向滚动（scrollHeight>clientHeight 且含多分区），外层 stage 不被整页撑满。 */
    const screenGeo = await page.evaluate(() => {
      const q = (x) => document.querySelector(x);
      const stage = q('.stage'); const wrap = q('.stage-wrap'); const frame = q('.frame');
      if (!stage || !wrap || !frame) return { ok: false };
      const sgr = stage.getBoundingClientRect(); const wr = wrap.getBoundingClientRect();
      return {
        ok: true,
        mTop: wr.top - sgr.top, mBottom: sgr.bottom - wr.bottom,
        mLeft: wr.left - sgr.left, mRight: sgr.right - wr.right,
        inStage: wr.top >= sgr.top - 1 && wr.bottom <= sgr.bottom + 1 && wr.left >= sgr.left - 1 && wr.right <= sgr.right + 1,
        fClientH: frame.clientHeight, fScrollH: frame.scrollHeight,
        fOverflowY: getComputedStyle(frame).overflowY,
        fxCount: frame.querySelectorAll('[data-node], .fx-n').length,
        stageScrollH: stage.scrollHeight, stageClientH: stage.clientHeight,
      };
    });
    P('screen 完整落在黑色舞台内、四周有呼吸空间（不顶天立地）',
      screenGeo.ok && screenGeo.inStage && screenGeo.mTop >= 8 && screenGeo.mLeft >= 8 && screenGeo.mBottom >= 4 && screenGeo.mRight >= 8,
      screenGeo.ok ? ('上=' + screenGeo.mTop.toFixed(0) + ' 下=' + screenGeo.mBottom.toFixed(0) + ' 左=' + screenGeo.mLeft.toFixed(0) + ' 右=' + screenGeo.mRight.toFixed(0) + ' inStage=' + screenGeo.inStage) : 'stage/wrap/frame 缺失');
    P('全页内容在 screen 内部纵向滚动（frame 固定一屏高、多分区、stage 不被撑满）',
      screenGeo.ok && screenGeo.fOverflowY === 'auto' && screenGeo.fScrollH > screenGeo.fClientH && screenGeo.fxCount >= 10,
      screenGeo.ok ? ('scrollH=' + screenGeo.fScrollH + ' > clientH=' + screenGeo.fClientH + ' overflowY=' + screenGeo.fOverflowY + ' 分区/节点=' + screenGeo.fxCount) : '');

    /* 2b-1b) 整页共享背景只绘一次、板块衔接无亮线（2026-08-05 方案 A）。
       根因修复后断言：①有 page-scope 时，背景切片集中在 page 层、section 内不再各自重复定位
       同一背景切片（跨 section 重复的同一背景节点 id 只绘一次）；②相邻背景切片在同一坐标系、
       统一 zoom，bottom 与 next.top 差 ≤0.05px（不再出现 52367 那种 0.42px 错位缝）。 */
    const bgOnce = await page.evaluate(() => {
      const frame = document.querySelector('.frame');
      const pageStage = frame.querySelector('[data-node-id="page-scope"]');
      if (!pageStage) return { pageScope: false };
      /* truth 里跨多个 section 的 background.nodes 重复出现的节点 id = 共享背景节点。
         方案 A 把它们在 page 层只绘一次。先从内嵌 truth 收集这些 id。 */
      const unwrap = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
      const truthEl = document.getElementById('qa-truth');
      const truth = truthEl ? JSON.parse(truthEl.textContent) : {};
      const secs = truth.sections || {};
      const idCount = {};
      Object.keys(secs).forEach((sid) => {
        const bg = secs[sid] && secs[sid].background;
        (bg && bg.nodes ? (Array.isArray(bg.nodes) ? bg.nodes : Object.values(bg.nodes)) : []).forEach((n) => {
          const id = unwrap(n && n.id);
          if (id != null) idCount[id] = (idCount[id] || 0) + 1;
        });
      });
      const sharedBgIds = Object.keys(idCount).filter((id) => idCount[id] > 1);
      /* 每个共享背景节点在 DOM 里应恰好一个元素（不再跨 section 重复） */
      const stillDup = sharedBgIds.filter((id) => frame.querySelectorAll('[data-node="' + id + '"]').length > 1);
      const fr = frame.getBoundingClientRect();
      /* 整页背景切片 = page 层里**满幅宽**（≈frame 宽）的 img，它们垂直堆叠成整页背景。
         内容图（立绘/头像/图标）不满幅，排除在外 —— 之前误把所有 img 当背景。 */
      const isFullBleed = (im) => { const r = im.getBoundingClientRect(); return r.width >= fr.width * 0.9; };
      const pImgs = [...pageStage.querySelectorAll('img.fx-img')].filter(isFullBleed);
      /* 同一物理背景切片（同 src）跨 section 重复定位的检测：在**整个 frame** 范围数满幅宽同 src 切片 */
      const allFullBleed = [...frame.querySelectorAll('img.fx-img')].filter(isFullBleed);
      const bySrc = {};
      allFullBleed.forEach((im) => { const k = (im.src || '').split('?')[0]; bySrc[k] = (bySrc[k] || 0) + 1; });
      const dupSlices = Object.entries(bySrc).filter(([, c]) => c > 1).map(([k, c]) => ({ src: k.split('/').slice(-1)[0], count: c }));
      /* page 层满幅背景切片相邻边界：bottom vs next.top（同一坐标系统一 zoom → 应连续） */
      const arr = pImgs.map((im) => { const r = im.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }).sort((a, b) => a.top - b.top);
      let maxGap = 0;
      for (let i = 0; i + 1 < arr.length; i++) { const g = Math.abs(arr[i + 1].top - arr[i].bottom); if (g < 2) maxGap = Math.max(maxGap, g); }
      /* 跨层重复检测：同一满幅背景切片 src 不应同时出现在 page 层和某个 section 内
         （出现即「共享背景被 section 各自重复定位」残留）。section 专属内容图（如首屏 KV 1-953）
         不满幅或不在 page 层，不算。 */
      const pageSrcs = new Set(pImgs.map((im) => (im.src || '').split('?')[0]));
      const secStages = [...frame.querySelectorAll('.fx-stage[data-node-id^="section-"]')];
      const crossDup = [];
      secStages.forEach((st) => {
        [...st.querySelectorAll('img.fx-img')].filter(isFullBleed).forEach((im) => {
          const k = (im.src || '').split('?')[0];
          if (pageSrcs.has(k)) crossDup.push({ sec: st.getAttribute('data-node'), src: k.split('/').slice(-1)[0] });
        });
      });
      return { pageScope: true, dupSlices, maxGap, secBgCount: crossDup.length, crossDup, pageBgCount: pImgs.length, sharedBgCount: sharedBgIds.length, stillDup };
    });
    if (bgOnce.pageScope) {
      P('整页共享背景只绘一次（truth 共享背景节点不跨 section 重复定位）',
        (bgOnce.stillDup || []).length === 0,
        (bgOnce.stillDup || []).length ? '仍重复: ' + JSON.stringify(bgOnce.stillDup.slice(0, 6)) : 'truth 共享背景节点 ' + bgOnce.sharedBgCount + ' 个，各绘一次');
      P('背景切片同一坐标系统一 zoom（相邻边界差 ≤0.05px，无错位缝）',
        bgOnce.maxGap <= 0.05,
        '相邻切片最大边界差=' + bgOnce.maxGap.toFixed(3) + 'px');
      P('共享背景切片不再跨层重复（page 层与 section 不各留一份）',
        (bgOnce.stillDup || []).length === 0,
        (bgOnce.stillDup || []).length ? '重复 id: ' + JSON.stringify(bgOnce.stillDup.slice(0, 6)) : '0 重复');
    }

    /* 2b-1c) 纯文本/透明铭牌不被错套矩形框（2026-08-05 用户报名字/标签矩形框排查的通用回归）。
       规则：①**纯文本节点**（fx-t / data-figma-type=TEXT）不该有矩形 background-color /
       border / box-shadow（文字框应是设计里独立的 RECTANGLE/FRAME 底，不是给文本节点套框）；
       唯一例外是渐变字 background-clip:text（bgImg 是 linear-gradient，合法，不算矩形框）。
       ②任何 data-node 在 DOM 里只出现一次（重复节点会叠出重影/框，方案 A 已去重共享背景）。
       注意：本检查只盯「文本节点被套框」与「重复节点」，**不动**设计稿真实的标签/徽章底
       （RECTANGLE/FRAME 带 SOLID fill 是 Figma 原值，见台账）。 */
    const misFrame = await page.evaluate(() => {
      const frame = document.querySelector('.frame');
      const texts = [...frame.querySelectorAll('.fx-t, [data-figma-type="TEXT"]')];
      const boxed = [];
      texts.forEach((el) => {
        const cs = getComputedStyle(el);
        const bw = parseFloat(cs.borderTopWidth) || 0;
        const hasBorder = bw > 0 && cs.borderTopStyle !== 'none';
        const bgc = cs.backgroundColor;
        const hasSolidBg = bgc && bgc !== 'rgba(0, 0, 0, 0)' && bgc !== 'transparent';
        const hasShadow = cs.boxShadow && cs.boxShadow !== 'none';
        /* 渐变字 background-clip:text 的 bgImg 是 linear-gradient —— 合法，排除 */
        if (hasBorder || hasSolidBg || hasShadow) {
          boxed.push({ node: el.getAttribute('data-node'), text: (el.textContent || '').trim().slice(0, 16), border: hasBorder ? cs.borderTopWidth : null, bg: hasSolidBg ? bgc : null, shadow: hasShadow ? cs.boxShadow.slice(0, 40) : null });
        }
      });
      /* 重复节点检测 */
      const nodes = [...frame.querySelectorAll('[data-node]')];
      const cnt = {};
      nodes.forEach((e) => { const id = e.getAttribute('data-node'); cnt[id] = (cnt[id] || 0) + 1; });
      const dups = Object.entries(cnt).filter(([, v]) => v > 1).map(([k, v]) => ({ id: k, count: v }));
      return { textCount: texts.length, boxed, dups };
    });
    P('纯文本节点不被错套矩形框（无 background-color/border/box-shadow）',
      misFrame.boxed.length === 0,
      misFrame.boxed.length ? '误框文本: ' + JSON.stringify(misFrame.boxed.slice(0, 6)) : '文本 ' + misFrame.textCount + ' 个，0 误框');
    P('无重复节点（data-node 各一次，不叠重影/框）',
      misFrame.dups.length === 0,
      misFrame.dups.length ? '重复: ' + JSON.stringify(misFrame.dups.slice(0, 6)) : '0 重复');

    /* 2b-2) 滚动条视觉隐藏但滚动能力保留（2026-08-05 用户红框：右侧页面滚动条 + 最右浏览器/舞台
       滚动条都不要显示，用户自己滚，但滚动功能必须在）。
       断言：两容器（.frame screen 内部 / .stage 外层舞台）都 scrollbar-width:none 且无可见滚动条占位
       （offsetWidth−clientWidth=0），同时 overflow 仍是 auto/scroll（不是 hidden）、scrollTop 仍可写
       （滚轮/程序化都能改），全页内容仍在（fx 节点数不减）。 */
    const sb = await page.evaluate(async () => {
      const q = (x) => document.querySelector(x);
      const stage = q('.stage'); const frame = q('.frame');
      if (!stage || !frame) return { ok: false };
      const fcs = getComputedStyle(frame); const scs = getComputedStyle(stage);
      const f0 = frame.scrollTop;
      frame.scrollTop = 400;
      await new Promise((r) => setTimeout(r, 30));
      const frameScrollWorks = frame.scrollTop !== f0;
      frame.scrollTop = 0;
      const s0 = stage.scrollTop;
      stage.scrollTop = 50;
      await new Promise((r) => setTimeout(r, 30));
      const stageScrollWorks = (stage.scrollTop !== s0) || (stage.scrollHeight <= stage.clientHeight);
      stage.scrollTop = 0;
      return {
        ok: true,
        fSw: fcs.scrollbarWidth, sSw: scs.scrollbarWidth,
        fOvY: fcs.overflowY, sOv: scs.overflow,
        fBarPx: frame.offsetWidth - frame.clientWidth,
        sBarPx: stage.offsetWidth - stage.clientWidth,
        frameScrollWorks, stageScrollWorks,
        fxCount: frame.querySelectorAll('[data-node], .fx-n').length,
      };
    });
    P('两根滚动条视觉都隐藏（frame + stage，scrollbar-width:none 且无占位）',
      sb.ok && sb.fSw === 'none' && sb.sSw === 'none' && sb.fBarPx === 0 && sb.sBarPx === 0,
      sb.ok ? ('frame sw=' + sb.fSw + ' 占位=' + sb.fBarPx + 'px；stage sw=' + sb.sSw + ' 占位=' + sb.sBarPx + 'px') : '元素缺失');
    P('滚动能力保留（overflow 仍 auto/scroll、scrollTop 可写、内容完整）',
      sb.ok && (sb.fOvY === 'auto' || sb.fOvY === 'scroll') && (sb.sOv === 'auto' || sb.sOv === 'scroll') && sb.frameScrollWorks && sb.stageScrollWorks && sb.fxCount >= 10,
      sb.ok ? ('frameOv=' + sb.fOvY + ' stageOv=' + sb.sOv + ' frameScroll=' + sb.frameScrollWorks + ' stageScroll=' + sb.stageScrollWorks + ' 节点=' + sb.fxCount) : '');

    /* 2c) 顶部不画重复 platform 控件（2026-08-05 用户红框：第二行「端 PC/Pad/手机」与顶部设备组重复）。
       顶部设备组 seg 各项带 plat:* pref（供 replay 点选同步），第二行**不得**再出现任何 plat:* 控件；
       且 __qa.prefs().plat 必须由顶部真实设备选择推出（PC 组 = pc）。 */
    /* Fixed Figma directory navigation belongs to Main Skill. When a complete
       source-backed directory is wired, manual scrolling must move the sole
       selected item. Incomplete source mapping remains explicitly inert. */
    const fixedNavSetup = await page.evaluate(() => {
      const frame = document.querySelector('.frame');
      const items = [...document.querySelectorAll('[data-nav-item]')];
      const wired = items.filter((item) => item.hasAttribute('data-sec-target'));
      if (!items.length) return { state: 'absent' };
      if (!frame || wired.length !== items.length || wired.length < 2)
        return { state: 'unresolved', items: items.length, wired: wired.length };
      const targets = wired.map((item) => item.getAttribute('data-sec-target'));
      const complete = targets.every((target) => document.querySelector('[data-node="' + CSS.escape(target) + '"]'));
      if (!complete) return { state: 'unresolved', items: items.length, wired: wired.length, reason: 'missing DOM target' };
      const index = Math.min(wired.length - 1, Math.max(1, Math.floor(wired.length * 0.65)));
      const first = wired[0].getBoundingClientRect();
      const last = wired[wired.length - 1].getBoundingClientRect();
      const variantVisual = wired.some((item) => item.getAttribute('data-nav-variant') === 'active')
        && wired.some((item) => item.getAttribute('data-nav-variant') === 'normal');
      return {
        state: 'wired', index, target: targets[index], variantVisual,
        clip: {
          x: Math.max(0, Math.floor(Math.min(first.left, last.left))),
          y: Math.max(0, Math.floor(Math.min(first.top, last.top))),
          width: Math.ceil(Math.max(first.right, last.right) - Math.min(first.left, last.left)),
          height: Math.ceil(Math.max(first.bottom, last.bottom) - Math.min(first.top, last.top)),
        },
      };
    });
    let fixedNavResult = { state: fixedNavSetup.state };
    let fixedNavBefore = null;
    let fixedNavAfter = null;
    if (fixedNavSetup.state === 'wired') {
      if (fixedNavSetup.variantVisual && fixedNavSetup.clip.width > 0 && fixedNavSetup.clip.height > 0)
        fixedNavBefore = await page.screenshot({ clip: fixedNavSetup.clip });
      fixedNavResult = await page.evaluate(async ({ index, target }) => {
        const frame = document.querySelector('.frame');
        const items = [...document.querySelectorAll('[data-nav-item][data-sec-target]')];
        const anchor = document.querySelector('[data-node="' + CSS.escape(target) + '"]');
        anchor.scrollIntoView({ behavior: 'auto', block: 'start' });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const active = items.map((item) => item.getAttribute('aria-current') === 'true');
        const visual = items.map((item) => item.hasAttribute('data-active'));
        return { state: 'wired', index, target, active, visual };
      }, fixedNavSetup);
      if (fixedNavBefore) fixedNavAfter = await page.screenshot({ clip: fixedNavSetup.clip });
      await page.evaluate(async () => {
        document.querySelector('.frame').scrollTop = 0;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
    }
    const fixedNavFunctional = fixedNavSetup.state !== 'wired'
      || (fixedNavResult.active?.filter(Boolean).length === 1 && fixedNavResult.active[fixedNavSetup.index]
        && fixedNavResult.visual?.filter(Boolean).length === 1 && fixedNavResult.visual[fixedNavSetup.index]);
    P('fixed directory scrollspy keeps one truth-backed selected item after manual scroll',
      fixedNavFunctional,
      JSON.stringify({ setup: fixedNavSetup, result: fixedNavResult }));
    P('fixed directory active/normal Figma variants visibly change after scroll',
      !fixedNavSetup.variantVisual || (!!fixedNavBefore && !!fixedNavAfter && !fixedNavBefore.equals(fixedNavAfter)),
      fixedNavSetup.variantVisual ? `visualChanged=${!!fixedNavBefore && !!fixedNavAfter && !fixedNavBefore.equals(fixedNavAfter)}` : 'no paired source variants');
    const navRailSource = loadNavRailTruth(demoDir);
    const navRailProbe = await probeNavRailContinuity(page, navRailSource.source);
    P('fixed directory rail is continuously painted through its source extent',
      navRailProbe.ok,
      JSON.stringify(navRailProbe.dom));
    P('fixed directory rail source and markers keep source-backed sibling/anchor count',
      navRailProbe.dom.markerCount >= 2 && navRailProbe.dom.labelCount >= 2,
      JSON.stringify({ markerCount: navRailProbe.dom.markerCount, labelCount: navRailProbe.dom.labelCount, source: navRailSource.source }));

    const platDedup = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.bar .row')];
      const top = rows[0];
      const rest = rows.slice(1);
      const topPlat = top ? top.querySelectorAll('[data-qa-pref^="plat:"]').length : 0;
      let restPlat = 0;
      rest.forEach((r) => { restPlat += r.querySelectorAll('[data-qa-pref^="plat:"]').length; });
      return { topPlat, restPlat, prefsPlat: (window.__qa.prefs() || {}).plat };
    });
    /* 2026-08-08 起 plat 入口改为第二行独立 seg（点它走 syncDeviceToPlat 连带
       切设备组），顶部设备组 seg 不再携带 plat pref —— 否则初始激活 PC 组时 DOM
       里根本不存在 plat:mobile，gateB/C 的 mobile case 无入口可点。故断言反过来：
       顶部 0 个 plat pref，第二行 3 个（pc/pad/mobile 各一）。 */
    P('第二行独立 platform 控件、顶部设备组不再携带 plat pref',
      platDedup.topPlat === 0 && platDedup.restPlat === 3,
      '顶部 plat=' + platDedup.topPlat + ' 其余行 plat=' + platDedup.restPlat + '（应 =0 / =3）');
    P('__qa.prefs().plat 由当前视口断点推出（初始 PC 组 = pc）',
      platDedup.prefsPlat === 'pc',
      'prefs.plat=' + platDedup.prefsPlat);

    /* 3) 2026-08-10 裁决：撤掉右上角拖拽把手，严格对齐同事 Kit —— Kit 规范与 demo 的 resize
       只有 W/H 输入框 + 宽度滑块（PC 自由/非 PC 锁定），并无任何角/边拖拽把手。
       原先的把手几何断言与 pointer 拖拽测试一并移除（不再有这种控件）。 */

    /* 5) PC 组不可横竖屏切换（非 PC 才开放）：PC 下 setOrientation 必须抛错 */
    const pcOrient = await page.evaluate(() => {
      try { window.__qa.setOrientation('landscape'); return { threw: false }; }
      catch (e) { return { threw: true, msg: String(e && e.message || e) }; }
    });
    P('PC 组拒绝横竖屏切换（设备锁定组才开放）', pcOrient.threw, pcOrient.threw ? '正确抛错' : 'PC 居然切了横竖屏');

    /* 6) 非 PC（iPhone）可切横竖屏、宽高对调、所有拉伸入口锁定；拖拽把手已移除。 */
    const nonPc = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.seg button')];
      const grpBtn = btns.find((b) => (b.textContent || '').trim() === 'iPhone');
      if (!grpBtn) return { found: false, segLabels: btns.map((b) => (b.textContent || '').trim()).slice(0, 12) };
      grpBtn.click();
      return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
        const before = window.__qa.inspect().viewport;
        let orientThrew = false;
        try { window.__qa.setOrientation('landscape'); } catch (e) { orientThrew = true; }
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const after = window.__qa.inspect().viewport;
          const widthInput = document.querySelector('[data-qa-viewport-width-input]');
          const heightInput = document.querySelector('[data-qa-viewport-height-input]');
          const slider = document.querySelector('[data-qa-viewport-resize]');
          res({
            found: true, before, after, orientThrew,
            swapped: before.w === after.h && before.h === after.w,
            sizeLocked: !!(widthInput && widthInput.disabled && heightInput && heightInput.disabled && slider && slider.disabled),
            railGone: document.querySelectorAll('.resize-rail-attached, [data-qa-viewport-resize-rail]').length === 0,
            edgeHidden: (() => { const h = document.querySelector('[data-qa-edge-resize]'); if (!h) return true; const cs = getComputedStyle(h); const rc = h.getBoundingClientRect(); return h.classList.contains('disabled') || cs.display === 'none' || rc.width === 0 || rc.height === 0; })(),
          });
        }));
      })));
    });
    if (!nonPc.found) {
      P('非 PC 设备（iPhone）可切换', false, '设备组 seg 里找不到 iPhone 按钮，实见: ' + JSON.stringify(nonPc.segLabels || []));
    } else {
      P('非 PC 可切横竖屏且宽高对调', !nonPc.orientThrew && nonPc.swapped,
        'portrait ' + nonPc.before.w + 'x' + nonPc.before.h + ' → landscape ' + nonPc.after.w + 'x' + nonPc.after.h + ' threw=' + nonPc.orientThrew);
      P('非 PC 的 W/H/滑块保持机型锁定', nonPc.sizeLocked,
        'sizeLocked=' + nonPc.sizeLocked);
      P('旧式角把手轨已移除（非 PC 同样无）', nonPc.railGone,
        'railGone=' + nonPc.railGone);
      P('非 PC 右缘把手禁用/隐藏', nonPc.edgeHidden === true,
        'edgeHidden=' + nonPc.edgeHidden);
    }

    console.log('移动轴/断点模型 · 真实浏览器断言');
    console.log('');
    for (const [name, pass, why] of results) console.log((pass ? '✅' : '❌') + ' ' + name + (pass ? '' : '  — ' + why));
    /* 7) hero scroll-slot: derive the first screen from page structure, never from a
       demo name, section number, or node id. Exercise locked fixture devices plus PC
       free resize, then inspect rendered DOM geometry at scrollTop=0. */
    const heroSlots = await page.evaluate(async () => {
      const presets = JSON.parse(document.getElementById('qa-devices')?.textContent || 'null');
      const groups = presets?.deviceGroups || [];
      const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const probe = async (meta) => {
        const frame = document.querySelector('.frame');
        if (!frame) return { ...meta, ok: false, reason: 'missing-frame' };
        frame.scrollTop = 0; await raf2();
        const fr = frame.getBoundingClientRect();
        const after = [...frame.querySelectorAll('[data-hero-slot-role="after-hero"]')];
        const rects = after.map((el) => el.getBoundingClientRect());
        const visibleAfter = rects.some((r) => r.top < fr.bottom - 0.5 && r.bottom > fr.top + 0.5);
        const firstAfterTop = rects.length ? Math.min(...rects.map((r) => r.top - fr.top)) : null;
        const inspection = window.__qa.inspect();
        const heroId = frame.getAttribute('data-hero-section');
        return {
          ...meta,
          ok: frame.getAttribute('data-hero-scroll-slot') === 'active' && !!heroId
            && after.length > 0 && !visibleAfter && firstAfterTop != null
            && firstAfterTop >= fr.height - 1,
          viewport: inspection.viewport,
          renderBase: frame.getAttribute('data-render-base'),
          fallback: frame.getAttribute('data-plat-fallback'),
          heroId,
          afterCount: after.length,
          sizeLocked: !!(document.querySelector('[data-qa-viewport-width-input]')?.disabled
            && document.querySelector('[data-qa-viewport-height-input]')?.disabled
            && document.querySelector('[data-qa-viewport-resize]')?.disabled),
          firstAfterTop,
          clientHeight: frame.clientHeight,
          visibleHeight: fr.height,
        };
      };
      const selectLocked = async (w, h) => {
        let found = null;
        groups.some((g, gi) => (g.devices || []).some((d, di) => {
          if (d.width === w && d.height === h) { found = { gi, di, group: g.key, device: d.name }; return true; }
          return false;
        }));
        if (!found) return { found: false, expected: { w, h } };
        const buttons = [...document.querySelectorAll('.bar .row:first-child .seg button')];
        if (!buttons[found.gi]) return { found: false, expected: { w, h }, reason: 'missing-group-button' };
        buttons[found.gi].click(); await raf2();
        const select = document.querySelector('.bar select');
        if (!select) return { found: false, expected: { w, h }, reason: 'missing-device-select' };
        const portrait = document.querySelector('[data-qa-orientation="portrait"]');
        if (portrait && !portrait.classList.contains('on')) { portrait.click(); await raf2(); }
        select.value = String(found.di);
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await raf2();
        return probe({ expected: { w, h }, locked: true, group: found.group, device: found.device });
      };
      const results = [];
      results.push(await selectLocked(768, 1024));
      results.push(await selectLocked(1024, 1366));
      results.push(await selectLocked(390, 844));
      window.__qa.resize(1440, 900); await raf2();
      results.push(await probe({ expected: { w: 1440, h: 900 }, locked: false, group: 'PC-free' }));
      return results;
    }).catch((e) => [{ ok: false, error: String(e && e.stack || e) }]);
    const expectedHeroSizes = ['768x1024', '1024x1366', '390x844', '1440x900'];
    heroSlots.forEach((r, i) => {
      const actual = r.viewport ? r.viewport.w + 'x' + r.viewport.h : 'none';
      P('hero scroll-slot isolates later sections at scrollTop=0: ' + expectedHeroSizes[i],
        r.ok && actual === expectedHeroSizes[i],
        'viewport=' + actual + ' hero=' + (r.heroId || '?') + ' after=' + (r.afterCount ?? '?')
          + ' firstAfterTop=' + (r.firstAfterTop == null ? '?' : Number(r.firstAfterTop).toFixed(1))
          + ' visibleH=' + (r.visibleHeight ?? '?') + ' fallback=' + (r.fallback || 'none')
          + (r.error ? ' error=' + r.error.slice(0, 240) : ''));
    });
    const tabletHero = heroSlots[0] || {};
    P('768x1024 tablet keeps explicit PC-tree fallback when tablet Figma truth is absent',
      tabletHero.ok && tabletHero.renderBase === 'pc' && tabletHero.fallback === 'pad-uses-pc-tree',
      'renderBase=' + (tabletHero.renderBase || '?') + ' fallback=' + (tabletHero.fallback || 'none'));
    P('iPad 预设保持尺寸锁定（W/H/滑块不可改）', tabletHero.sizeLocked,
      'sizeLocked=' + tabletHero.sizeLocked);

    /* iPad PC composition: sections must maintain PC horizontal layout, not mobile stack.
       Verify by checking that multiple content nodes exist side-by-side (not single-column).
       We measure the actual rendered layout to prove composition, not just the truth routing. */
    const ipadComposition = await page.evaluate(async () => {
      const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      // Ensure we are on iPad
      const groups = JSON.parse(document.getElementById('qa-devices')?.textContent || 'null')?.deviceGroups || [];
      let found = null;
      groups.some((g, gi) => (g.devices || []).some((d, di) => {
        if (d.width === 768 && d.height === 1024) { found = { gi, di }; return true; } return false;
      }));
      if (!found) return { ok: false, reason: 'ipad-preset-not-found' };
      const buttons = [...document.querySelectorAll('.bar .row:first-child .seg button')];
      if (!buttons[found.gi]) return { ok: false, reason: 'missing-group-button' };
      buttons[found.gi].click(); await raf2();
      const select = document.querySelector('.bar select');
      if (select) { select.value = String(found.di); select.dispatchEvent(new Event('change', { bubbles: true })); await raf2(); }
      const portrait = document.querySelector('[data-qa-orientation="portrait"]');
      if (portrait && !portrait.classList.contains('on')) { portrait.click(); await raf2(); }

      const frame = document.querySelector('.frame');
      const ins = window.__qa.inspect();
      const renderBase = frame.getAttribute('data-render-base');
      const platFallback = frame.getAttribute('data-plat-fallback');

      // Check that sections use PC design width (3840), not mobile (750)
      const sections = [...frame.querySelectorAll('[data-node-id^="section-"]')];
      const sectionWidths = sections.map(s => parseInt(s.style.width)).filter(Boolean);
      const allPcWidth = sectionWidths.every(w => w === 3840);

      // Check PC composition: look for side-by-side content in a card section
      // Find a section with multiple child nodes that are positioned side-by-side
      let sideByeSideCount = 0;
      let mobileStackCount = 0;
      for (const sec of sections.slice(0, 5)) {
        const children = [...sec.querySelectorAll('[data-node]')].filter(el => {
          const r = el.getBoundingClientRect();
          return r.width > 20 && r.height > 10 && r.height < 500;
        });
        // Group by approximate Y position (rows)
        const rows = {};
        children.forEach(el => {
          const r = el.getBoundingClientRect();
          const rowKey = Math.round(r.top / 50) * 50;
          if (!rows[rowKey]) rows[rowKey] = [];
          rows[rowKey].push({ left: Math.round(r.left), width: Math.round(r.width) });
        });
        // Count rows with multiple items side by side
        Object.values(rows).forEach(row => {
          if (row.length >= 2) {
            const sorted = row.sort((a, b) => a.left - b.left);
            const hasGap = sorted[1].left > sorted[0].left + sorted[0].width * 0.5;
            if (hasGap) sideByeSideCount++; else mobileStackCount++;
          }
        });
      }

      return {
        ok: true,
        renderBase, platFallback,
        viewport: ins.viewport,
        sectionCount: sections.length,
        allPcWidth,
        sideByeSideCount,
        mobileStackCount,
        isPcComposition: allPcWidth && sideByeSideCount > 0,
      };
    }).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
    P('iPad 768x1024 保持 PC composition（非 mobile 竖列堆叠）',
      ipadComposition.ok && ipadComposition.isPcComposition && ipadComposition.renderBase === 'pc',
      'renderBase=' + (ipadComposition.renderBase || '?') + ' sections=' + (ipadComposition.sectionCount ?? '?')
        + ' allPcWidth=' + ipadComposition.allPcWidth + ' sideBySide=' + ipadComposition.sideByeSideCount
        + ' mobileStack=' + ipadComposition.mobileStackCount
        + (ipadComposition.error ? ' error=' + ipadComposition.error.slice(0, 200) : ''));
    console.log((ipadComposition.ok && ipadComposition.isPcComposition ? '✅' : '❌') + ' iPad 768x1024 PC composition' + (ipadComposition.ok && ipadComposition.isPcComposition ? '' : '  — renderBase=' + (ipadComposition.renderBase || '?') + ' allPcWidth=' + ipadComposition.allPcWidth + ' sideBySide=' + ipadComposition.sideByeSideCount + ' mobileStack=' + ipadComposition.mobileStackCount));

    heroSlots.forEach((r, i) => {
      const actual = r.viewport ? r.viewport.w + 'x' + r.viewport.h : 'none';
      console.log((r.ok ? '✅' : '❌') + ' hero scroll-slot ' + expectedHeroSizes[i]
        + ' actual=' + actual + ' firstAfterTop=' + (r.firstAfterTop == null ? '?' : Number(r.firstAfterTop).toFixed(1))
        + ' visibleH=' + (r.visibleHeight ?? '?') + ' fallback=' + (r.fallback || 'none')
        + (r.error ? ' error=' + r.error.slice(0, 240) : ''));
    });

    const ok = results.every(([, p]) => p);
    console.log('');
    console.log(ok ? '✅ 移动轴浏览器断言通过' : '❌ 移动轴浏览器断言失败');
    return ok;
  } catch (e) {
    console.log('❌ 浏览器断言执行失败: ' + (e && e.message || e));
    return false;
  } finally {
    try { if (browser) await browser.close(); } catch {}
    try { if (server) await server.close(); } catch {}
  }
}

/* CLI 入口 */
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const di = process.argv.indexOf('--demo');
  const demoDir = di >= 0 ? process.argv[di + 1] : process.cwd();
  const ok = await runChromeBrowserCheck({ demoDir });
  process.exit(ok ? 0 : 1);
}
