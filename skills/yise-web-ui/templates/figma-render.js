/* figma-render.js — Figma 稿 → DOM 的通用渲染器。【本 Skill 新增】
 *
 * ═══ 为什么必须在 Skill 层，而不是抄在每个 demo 的 index.html 里 ═══
 *
 * 这段代码消费的是 truth 的**固定形状**（sections[].nodes[] 的 box/style/text/renderBox），
 * 与具体是哪个页面、哪个项目无关 —— 它天然是通用件。
 *
 * 而它一度只存在于 demos/yise-ss5-preview/index.html 里。后果是实测过的：
 * 嵌套还原、裁剪生效、渐变字、文字投影用 text-shadow、图层模糊、排版模式 ——
 * 这六项修复全都只落在那一个页面上，**下一个页面一样都拿不到**。
 * 那不叫做了一套可复用的 Skill，叫改了一个页面的效果。
 *
 * 所以：渲染器住在这里，由 scripts/figma-inline.mjs 机械内联进每个 demo 的
 * index.html（禁止手抄，与 figma-chrome.js 同一套办法，并且有 --check 防漂移）。
 *
 * ═══ 与 demo 的分工 ═══
 *
 * 本文件（Skill，通用）：怎么把 truth 画成 DOM —— 换算、嵌套、裁剪、上色、排版、切图。
 * demo 的 index.html（项目专属）：这个页面叫什么、有哪些端/语言/状态、初始状态是什么。
 * demo 通过 window.__figmaRender 调用本文件，不复制其中任何一行。
 */
(function () {
  'use strict';
  window.__figmaRender = {

  /* ═══ 渲染层支持清单 ═══
   *
   * 由 scripts/render-coverage.mjs 与 truth 里**实际出现**的属性种类对账：
   * 稿里有、这里没声明 → 报红并进「没读懂清单」，绝不静默画错。
   *
   * 为什么需要这个（这是踩出来才明白的）：
   * 提取器按"一个都别删"的规矩把 50 个 effect、30 个渐变、15 个多层填充全提进了 truth，
   * 但渲染层只消费了 DROP_SHADOW 一种，还把文字投影用成了 box-shadow。
   * 结果是 30 个视觉效果被静默丢掉、5 个标题外面糊出矩形框 ——
   * **而当时 8 条冒烟断言全绿**，因为它们只数元素个数，不看画成什么样。
   *
   * ⚠️ 光有这份声明是不够的：自己声明"我支持"就是自证。
   * 所以 _render-smoke.mjs 里配了**行为探针**：逐条断言带 INNER_SHADOW 的节点
   * 其 box-shadow 真的含 inset、渐变字真的落了 background-clip:text。
   * 声明与探针两边都过，才算真支持。
   */
  supports: {
    nodeTypes: ['FRAME', 'GROUP', 'INSTANCE', 'RECTANGLE', 'VECTOR', 'STAR', 'TEXT', 'ELLIPSE', 'REGULAR_POLYGON'],
    fillTypes: ['SOLID', 'GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_DIAMOND', 'IMAGE'],
    effectTypes: ['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR'],
    textAutoResize: ['HEIGHT', 'WIDTH_AND_HEIGHT', 'WIDTH', 'NONE', 'TRUNCATE'],
    textAlignVertical: ['TOP', 'CENTER', 'BOTTOM'],
    textAlignHorizontal: ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'],
    /* 描边对齐三值（11-B）：CSS outline-offset 都能精确表达，见渲染处映射 */
    strokeAligns: ['INSIDE', 'OUTSIDE', 'CENTER'],
    /* 节点级混合模式：列出 CSS mix-blend-mode 有等价物的（PASS_THROUGH/NORMAL 不写样式）。
       ⚠️ LINEAR_BURN / LINEAR_DODGE 故意**不在**这里 —— CSS 没有等价物，只能近似，
       它们登记在 knownGaps 里，覆盖门会把它们报成 ⚠️ 近似而不是 ✅ 精确支持。
       写进本数组 = 声明"精确支持"，近似的东西混进来就成了谎报。 */
    blendModes: ['PASS_THROUGH', 'NORMAL', 'MULTIPLY', 'SCREEN', 'OVERLAY', 'DARKEN', 'LIGHTEN',
      'COLOR_DODGE', 'COLOR_BURN', 'HARD_LIGHT', 'SOFT_LIGHT', 'DIFFERENCE', 'EXCLUSION',
      'HUE', 'SATURATION', 'COLOR', 'LUMINOSITY'],
    // 明确记下还没做到的，别让"没声明"和"做不到"混在一起
    // ⚠️ 方法纪律（2026-08-04 踩过）：knownGaps 只登记"做不到/近似"的备注；
    //    「稿里出现了哪些取值」必须由覆盖门枚举对账，写在这里的散文不进对账 = 静默放过。
    knownGaps: {
      'GRADIENT_ANGULAR': '扇形渐变还没实现（本分区没出现）',
      'multiFill': '多层填充只取首个可见层。本分区 15 个多层节点全部走切图导出，整张 PNG 里已含叠层，所以不影响；但若哪天多层出现在非切图节点上，会只画到第一层',
      'LAYER_BLUR-radius': 'Figma 的模糊半径与 CSS blur() 的标准差不是同一个量，这里按 radius/2 近似，属已知偏差',
      'LINEAR_BURN': 'CSS 无等价物，按最接近的 multiply 近似，元素打 data-blend-approx 留痕（本分区背景层 8 处）',
      'LINEAR_DODGE': 'CSS 无等价物，按最接近的 screen 近似，元素打 data-blend-approx 留痕（本分区未出现）',
      'mix-blend-mode-stacking': 'mix-blend-mode 受层叠上下文影响：父级有 filter/opacity 会隔断混合（混合范围被收进该父级），与 Figma 的整组合成有出入，属已知偏差',
      /* 背景层入枚举对账后暴露的既有缺口（2026-08-04）：布尔并集形状画成矩形。 */
      'BOOLEAN_OPERATION': '矢量布尔形状的几何轮廓不还原，按外接矩形+填充近似绘制（本分区背景层 1 处：Union 524×1399 实心形状）',
      'vector-geometry': 'VECTOR/BOOLEAN_OPERATION 的轮廓 CSS 画不出。≥24px 的已由 figma-assets 切图（第 13 项，PNG 里轮廓是准的）；<24px 未切图的按外接矩形近似（6×6 色点等肉眼无差），元素打 data-shape-approx="rect" 留痕、探针数着，不许静默',
      'degenerate-shape': '宽或高为 0 的退化形状（如 Vector 88 的 0×644）Figma 可能导不出图 —— 那时落在 assets-manifest 的 noUrl 里报出来；其填充本是 0 宽细线，矩形近似无视觉差异',
      'zoom-rounding': '预览缩放用 zoom：每个数值按系数在最终尺寸重算（与产品层 rem 契约同源），但浏览器对 zoom 的取整方式与 rem 不完全一致，极端宽度下可有亚像素级出入，属已知偏差',
      'fit-letterSpacing': '文字超框只按档缩字号（100→92→85→78→75），不缩字距 —— 字距随语言逐条不同，开发无法实现成统一规则；字距方案留作后备，未实现',
      'stroke-nonrect': '非矩形节点（VECTOR/BOOLEAN_OPERATION/STAR/POLYGON/ELLIPSE/LINE）的描边沿轮廓走，CSS outline 只能画矩形边框 —— 不画并打 data-stroke-unrendered 留痕（画错=多一个框，比不画=少一条细线更糟）；要还原应走切图',
      'layout-not-consumed': 'constraints/layoutMode/itemSpacing 等自动布局字段已提取（truth 里 layout.*）但渲染层尚未消费 —— 那是门 F（适配还原）的依据。「已提未消费」与「没提取」是两笔账，别混',
      'cornerSmoothing': 'squircle 圆角平滑系数，CSS 无对应，按普通圆角近似（角部曲率不同），属已知偏差',
    },
  },

  /* 当前「设计 px → CSS px」的缩放系数。门 D 的 scaled 绑定与门 F 都读它。
     计算：帧可用宽度 ÷ 当前端的设计稿宽度。
     注意这里不用 rem —— 线上站点的 1rem = 10vw 是相对【视口】的，
     而预览帧只是页面里的一个 div，宽度 ≠ 视口宽。所以预览用 zoom
     按设计 px 等比缩，几何关系与线上完全一致，且 __qa.scale() 能如实报出系数。
     真正产出给开发的产品层会用 rem（那时容器就是视口），见 FIGMA-ADAPT.md §4。 */
  scale() {
    const dw = this._designWidth || 3840;
    const fw = this._frameWidth || dw;
    return fw / dw;
  },

  /* Schedule proof-image fetch/decode from rendered structure, never node ids
     or section names. The Figma DOM keeps every intrinsic owner box in place;
     only assigning img.src is deferred. A deterministic full-ready API is
     exposed for visual gates, while interactive review prioritizes the active
     viewport and a generous near-viewport band. */
  _installAssetScheduler(frame) {
    if (!frame || typeof window === 'undefined' || !window.document
      || typeof frame.querySelectorAll !== 'function' || typeof frame.getBoundingClientRect !== 'function') return null;
    const images = Array.from(frame.querySelectorAll('img[data-asset-src]') || []);
    if (!images.length) return null;
    let stopped = false;
    let scheduled = null;
    const query = new URLSearchParams(window.location && window.location.search || '');
    const fullMode = query.get('qa-assets') === 'full' || window.__QA_ASSET_MODE === 'full';
    const active = (img) => {
      const hiddenOwner = img.closest && img.closest('[hidden], [aria-hidden="true"]');
      return !hiddenOwner || hiddenOwner === frame;
    };
    const activate = (img, priority = 'auto') => {
      if (!img || !img.getAttribute) return null;
      const state = img.getAttribute('data-asset-state');
      if (state === 'loaded') return null;
      if (state === 'loading') return img.__fxAssetReady || null;
      const src = img.getAttribute('data-asset-src');
      if (!src) return null;
      img.setAttribute('data-asset-state', 'loading');
      if ('fetchPriority' in img && priority === 'high') img.fetchPriority = 'high';
      const settle = () => {
        img.setAttribute('data-asset-state', img.naturalWidth > 0 ? 'loaded' : 'error');
        return Promise.resolve();
      };
      /* An img without src is already `complete` with naturalWidth=0. Install
         listeners first, then assign the source and check complete once more:
         this covers both uncached loads and memory-cache completion without a
         lost load event. decode() must not gate switch replacement: a hung
         decode left prev/next inert while the next layer stayed hidden. */
      let settled = false;
      img.__fxAssetReady = new Promise((resolve) => {
        const done = () => {
          if (settled) return;
          settled = true;
          resolve(settle());
        };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        img.setAttribute('src', src);
        if (img.complete) done();
        else setTimeout(done, 1200);
      });
      return img.__fxAssetReady;
    };
    const imagesIn = (scope) => {
      if (!scope || typeof scope.querySelectorAll !== 'function') return [];
      const own = scope.matches && scope.matches('img[data-asset-src]') ? [scope] : [];
      return [...own, ...scope.querySelectorAll('img[data-asset-src]')];
    };
    const prepare = (scope, priority = 'high') => {
      const waits = imagesIn(scope).map((img) => activate(img, priority)).filter(Boolean);
      return waits.length ? Promise.allSettled(waits) : null;
    };
    const sync = () => {
      scheduled = null;
      if (stopped) return;
      const root = frame.getBoundingClientRect();
      const margin = Math.max(320, (root.height || window.innerHeight || 0) * 1.25);
      for (const img of images) {
        if (!active(img)) continue;
        const rect = img.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const near = rect.bottom >= root.top - margin && rect.top <= root.bottom + margin
          && rect.right >= root.left - margin && rect.left <= root.right + margin;
        if (!near) continue;
        const visible = rect.bottom >= root.top && rect.top <= root.bottom
          && rect.right >= root.left && rect.left <= root.right;
        activate(img, visible ? 'high' : 'auto');
      }
    };
    const schedule = () => {
      if (stopped || scheduled != null) return;
      const run = () => sync();
      scheduled = window.requestAnimationFrame ? window.requestAnimationFrame(run) : setTimeout(run, 0);
    };
    const fullReady = () => {
      const pending = prepare(frame, 'high') || Promise.resolve();
      return pending.then(() => {
        /* Some browsers can complete a memory-cached image between src
           assignment and listener registration. The pixels are valid, but
           normalize the bookkeeping at this explicit readiness boundary. */
        for (const img of images) {
          if (img.getAttribute('data-asset-state') === 'loading' && img.complete) {
            img.setAttribute('data-asset-state', img.naturalWidth > 0 ? 'loaded' : 'error');
          }
        }
      });
    };
    const api = {
      mode: fullMode ? 'full' : 'interactive',
      prepare,
      prime: (scope) => { prepare(scope, 'high'); },
      prepareSwitch(switchId, index) {
        const owners = Array.from(frame.querySelectorAll('[data-switch-owner]') || [])
          .filter((el) => el.getAttribute('data-switch') === String(switchId));
        const variantTargets = owners.flatMap((owner) => Array.from(owner.querySelectorAll(':scope > [data-switch-variant-content]') || [])
          .filter((layer) => Number(layer.getAttribute('data-switch-variant-index')) === Number(index)));
        const pageTargets = Array.from(frame.querySelectorAll('[data-switch][data-switch-page]') || [])
          .filter((page) => page.getAttribute('data-switch') === String(switchId)
            && Number(page.getAttribute('data-switch-page')) === Number(index));
        const targets = [...new Set([...variantTargets, ...pageTargets])];
        const waits = targets.map((target) => prepare(target, 'high')).filter(Boolean);
        return waits.length ? Promise.allSettled(waits) : null;
      },
      ready: fullReady,
      schedule,
    };
    frame.__fxAssetScheduler = api;
    frame.__fxAssetSchedulerCleanup = () => {
      stopped = true;
      frame.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (scheduled != null && window.cancelAnimationFrame) window.cancelAnimationFrame(scheduled);
      if (window.__fxAssets === api) delete window.__fxAssets;
      if (window.__fxAssetsReady === fullReady) delete window.__fxAssetsReady;
    };
    frame.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    window.__fxAssets = api;
    window.__fxAssetsReady = fullReady;
    frame.setAttribute('data-asset-scheduler', api.mode);
    if (fullMode) fullReady();
    else sync();
    return api;
  },

  /* The offline renderer cannot import ESM at runtime, so this mirrors the
     pure `scripts/lib/motion-role.mjs` resolver. It only consumes captured
     component labels and page structure, never node IDs, section numbers, or
     visible section titles. */
  _deriveMotionRoleMap(truth) {
    const arr = (v) => Array.isArray(v) ? v : Object.values(v || {});
    const norm = (v) => String(v || '').trim().toLowerCase();
    const out = new Map();
    const add = (node, role, step, evidence) => {
      const id = node && node.id;
      if (id == null || out.has(String(id))) return;
      out.set(String(id), { role, step, evidenceStatus: 'truth-backed', evidence });
    };
    /* Transparent semantic owners can be omitted from truth. Target only their
       direct rendered children so nested labels do not inherit motion twice. */
    const isDirectChildOfAncestor = (node, re) => {
      const ancestry = Array.isArray(node?.ancestorNames) ? node.ancestorNames : [];
      const path = Array.isArray(node?.ownerPath) ? node.ownerPath : [];
      const semanticIndex = ancestry.findIndex((name) => re.test(norm(name)));
      return semanticIndex >= 0 && path.length > 1
        && String(path[semanticIndex] ?? '') === String(path[path.length - 2] ?? '');
    };
    const sections = arr(truth && truth.sections).slice().sort((a, b) => Number(a?.meta?.y || 0) - Number(b?.meta?.y || 0));
    for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
      for (const node of arr(sections[sectionIndex] && sections[sectionIndex].nodes)) {
        const own = norm(node && node.name);
        if (sectionIndex === 0 && /^kv\/(?:background|背景|backdrop)$/.test(own)) {
          add(node, 'kv-background', 0, 'first-section + kv/background component label');
        } else if (sectionIndex === 0 && /^kv\/(?:foreground|前景|midground|middle|中景|character|角色)$/.test(own)) {
          add(node, 'kv-foreground', 0, 'first-section + kv/depth component label');
        } else if (sectionIndex === 0 && /^img\/(?:title|\u6807\u9898)(?:-?logo)?$/.test(own)) {
          add(node, 'kvTitle', 0, 'first-section + title component label');
        } else if (sectionIndex === 0 && /^img\/logo$/.test(own)) {
          add(node, 'kvBrand', 0, 'first-section + brand-logo component label');
        } else if (sectionIndex === 0 && isDirectChildOfAncestor(node, /^btn\/(?:download|\u4e0b\u8f7d)/)) {
          add(node, 'kvPrimaryAction', 0, 'first-section + direct child of download-button component');
        } else if (/^(?:mix\/)?calendar$/.test(own) || /^mix\/(?:calendar|日历)$/.test(own)) {
          add(node, 'activityCalendar', 0, 'calendar component label');
        } else if (/^switch\/(?:source|源器)$/.test(own)) {
          add(node, 'sourceDevice', 0, 'source-device switch component label');
        } else if (/^(?:switch\/(?:character|角色)|skill\d*|技能\d*)$/.test(own)) {
          add(node, 'characterSkill', /^(?:skill|技能)/.test(own) ? 1 : 0, 'character/skill component label');
        } else if (/^(?:heading|title|标题)$/.test(own)) {
          add(node, 'headingContentCard', 0, 'heading component label');
        } else if (/^(?:content(?:-?card)?|card(?:\/.*)?|内容框|内容\d+)$/.test(own)) {
          add(node, 'headingContentCard', 1, 'content-card component structure');
        } else if (/^(?:img\/)?(?:scroll(?:-?indicator)?|arrow|下滑箭头)$/.test(own)) {
          add(node, 'scrollIndicator', 0, 'scroll indicator component label');
        }
      }
    }
    for (const node of arr(truth && truth.pageChrome && truth.pageChrome.nodes)) {
      const own = norm(node && node.name);
      if (/^kv\/(?:background|背景|backdrop)$/.test(own)) {
        add(node, 'kv-background', 0, 'page chrome + kv/background component label');
      } else if (/^kv\/(?:foreground|前景|midground|middle|中景|character|角色)$/.test(own)) {
        add(node, 'kv-foreground', 0, 'page chrome + kv/depth component label');
      } else if (/^(?:img\/)?(?:scroll(?:-?indicator)?|arrow|下滑箭头)$/.test(own)) {
        add(node, 'scrollIndicator', 0, 'page chrome + scroll indicator component label');
      }
    }
    for (const node of arr(truth && truth.fixedOverlays && truth.fixedOverlays.nodes)) {
      if (!/^(?:fix|nav|navigation|footer)\//.test(norm(node && node.name))) continue;
      add(node, 'navigationFooter', 0, 'fixed overlay component label');
      const rec = out.get(String(node.id));
      if (rec) rec.navigation = true;
    }
    return out;
  },

  /* ═══ 派生换算：全部是 truth 原值的纯函数，truth 里不存派生结果 ═══
     理由：派生值无法被值绑定校验，放进 truth 会让"每个值都可证"这个定性失效，
     还会出现两份真相。门 D 对账时用同一份原值做同一套换算，两边不会漂。 */

  /** Figma 的 {r,g,b,a}（0~1）→ CSS。opacity 单独乘在元素上，这里只出颜色。 */
  _rgba(c) {
    if (!c) return null;
    const n = (v) => Math.round((v ?? 0) * 255);
    const a = c.a == null ? 1 : c.a;
    return a >= 1 ? `rgb(${n(c.r)} ${n(c.g)} ${n(c.b)})` : `rgba(${n(c.r)} ${n(c.g)} ${n(c.b)} / ${a})`;
  },

  /** 富文本/字符级样式渲染：按 characterStyleOverrides 把 characters 切成段，
     每段一个 span，消费 styleOverrideTable 里该段的 fills/fontWeight 等覆盖。
     只覆盖纯色 SOLID fills（颜色）；渐变覆盖暂不支持则留痕。无覆盖字符用基础样式。 */
  _renderRichText(el, characters, overrides, table, baseTx) {
    /* 文本节点常挂在 display:flex;flex-direction:column 的容器里（模块卡片文案列）。
       这种容器把每个**顶层子节点**都当成一个 flex item，纵向堆叠且不折行：
       若把「基础文本 + 覆盖 span」直接并列 append 进 el，浏览器会把它排成两列/多行，
       scrollHeight 凭空多出 1~2 个 lineHeight，step-fit 据此误判"超框"并一路缩到 75% 下限，
       页面表现为"字号被压小、文字错位"。修复：把所有富文本片段包进**一个**
       display:block;width:100% 的内联容器，让它成为容器里唯一的 flex item，
       片段在该容器内部进入同一行内格式化上下文正常折行，几何与纯文本一致。 */
    el.textContent = '';
    const flow = document.createElement('span');
    flow.setAttribute('data-richtext-flow', '1');
    Object.assign(flow.style, { display: 'block', width: '100%' });
    const source = String(characters);
    let i = 0;
    let segIndex = 0;
    while (i < source.length) {
      const key = Number(overrides[i] || 0);
      let j = i;
      while (j + 1 < source.length && Number(overrides[j + 1] || 0) === key) j++;
      const text = source.substring(i, j + 1);
      const entry = key !== 0 ? table[String(key)] : null;
      if (entry && typeof entry === 'object') {
        const span = document.createElement('span');
        span.textContent = text;
        span.setAttribute('data-richtext-seg', String(segIndex));
        const fills = Array.isArray(entry.fills) ? entry.fills : null;
        const col = fills ? this._solidFill(fills) : null;
        if (col) span.style.color = col;
        else if (fills) span.setAttribute('data-richtext-fill-unrendered', '1');
        if (entry.fontWeight != null) span.style.fontWeight = String(entry.fontWeight);
        if (entry.fontSize != null) span.style.fontSize = entry.fontSize + 'px';
        if (entry.fontFamily != null) span.style.fontFamily = '"' + entry.fontFamily + '", "PingFang SC", "Microsoft YaHei", sans-serif';
        if (entry.letterSpacing != null) span.style.letterSpacing = entry.letterSpacing + 'px';
        if (entry.textCase === 'UPPER') span.style.textTransform = 'uppercase';
        if (entry.textDecoration === 'UNDERLINE') span.style.textDecoration = 'underline';
        else if (entry.textDecoration === 'STRIKETHROUGH') span.style.textDecoration = 'line-through';
        flow.appendChild(span);
      } else {
        flow.appendChild(document.createTextNode(text));
      }
      segIndex++;
      i = j + 1;
    }
    el.appendChild(flow);
    el.setAttribute('data-richtext', '1');
  },

  /** 取第一个可见 SOLID 填充的颜色；渐变/图片填充返回 null（走占位） */
  _solidFill(fills) {
    if (!Array.isArray(fills)) return null;
    for (const f of fills) {
      if (f && f.visible !== false && f.type === 'SOLID') {
        return this._rgba(f.color && f.opacity != null ? { ...f.color, a: (f.color.a ?? 1) * f.opacity } : f.color);
      }
    }
    return null;
  },

  /** fills 里有没有渐变/图片（需要占位而不是纯色） */
  _fillKind(fills) {
    if (!Array.isArray(fills)) return 'none';
    for (const f of fills) {
      if (!f || f.visible === false) continue;
      if (f.type === 'SOLID') return 'solid';
      if (String(f.type).startsWith('GRADIENT')) return 'gradient';
      if (f.type === 'IMAGE') return 'image';
    }
    return 'none';
  },

  /** Figma 渐变 fill → CSS linear-gradient。
      角度换算：Figma 的 gradientHandlePositions[0]→[1] 是渐变方向向量（y 轴朝下、
      归一化到 0~1）；CSS 的角度是「从朝上方向起、顺时针」。所以
        CSS 角度 = atan2(dx, -dy)
      验算：标题的手柄是 (0.5,0)→(0.5,1)，dx=0 dy=1 → atan2(0,-1)=180° → 从上到下，对。 */
  _cssGradient(fill) {
    if (!fill || !String(fill.type || '').startsWith('GRADIENT')) return null;
    const h = fill.gradientHandlePositions || [];
    const stops = fill.gradientStops || [];
    if (stops.length < 1) return null;
    const list = stops.map((s) => {
      const c = s.color || {};
      const a = (c.a == null ? 1 : c.a) * (fill.opacity == null ? 1 : fill.opacity);
      const n = (v) => Math.round((v ?? 0) * 255);
      return `rgba(${n(c.r)} ${n(c.g)} ${n(c.b)} / ${a}) ${(s.position ?? 0) * 100}%`;
    }).join(', ');
    if (fill.type === 'GRADIENT_RADIAL' || fill.type === 'GRADIENT_DIAMOND') {
      return `radial-gradient(${list})`;
    }
    let deg = 180;
    if (h.length >= 2) {
      const dx = (h[1].x ?? 0) - (h[0].x ?? 0);
      const dy = (h[1].y ?? 0) - (h[0].y ?? 0);
      deg = Math.atan2(dx, -dy) * 180 / Math.PI;
    }
    return `linear-gradient(${deg.toFixed(2)}deg, ${list})`;
  },

  /** effects → CSS 阴影。
      ⚠️ 文字与非文字必须分开，这是踩出来的：
      Figma 里文字的 DROP_SHADOW 是**沿字形**投影，CSS 的对应物是 text-shadow。
      之前一律用 box-shadow —— box-shadow 绕的是**元素矩形**，于是 4 个带投影的标题
      外面各糊出一个矩形光晕，看起来就是"字周围有个框"。页面上一眼就能看到，
      但没有任何报错，冒烟也测不出来（它只数元素、不看画成什么样）。 */
  _shadow(effects, isText, asFilter) {
    if (!Array.isArray(effects)) return null;
    const parts = [];
    for (const e of effects) {
      if (!e || e.visible === false) continue;
      const o = e.offset || {};
      const x = o.x ?? 0, y = o.y ?? 0, r = e.radius ?? 0;
      if (asFilter) {
        // drop-shadow() 只接受 x y blur color，没有 spread、没有 inset
        if (e.type !== 'DROP_SHADOW') continue;
        parts.push(`drop-shadow(${x}px ${y}px ${r}px ${this._rgba(e.color)})`);
        continue;
      }
      if (isText) {
        // text-shadow 没有 spread 参数，也没有 inset；内阴影在文字上无对应物，跳过
        if (e.type !== 'DROP_SHADOW') continue;
        parts.push(`${x}px ${y}px ${r}px ${this._rgba(e.color)}`);
      } else if (e.type === 'DROP_SHADOW') {
        parts.push(`${x}px ${y}px ${r}px ${e.spread ? e.spread + 'px ' : ''}${this._rgba(e.color)}`);
      } else if (e.type === 'INNER_SHADOW') {
        parts.push(`inset ${x}px ${y}px ${r}px ${e.spread ? e.spread + 'px ' : ''}${this._rgba(e.color)}`);
      }
    }
    // filter 用空格连接（drop-shadow(...) drop-shadow(...)），阴影列表用逗号
    return parts.length ? parts.join(asFilter ? ' ' : ', ') : null;
  },

  /** LAYER_BLUR / BACKGROUND_BLUR → CSS filter。稿里 84345 那批模糊圆斑用的就是它。 */
  _blur(effects) {
    if (!Array.isArray(effects)) return null;
    for (const e of effects) {
      if (!e || e.visible === false) continue;
      if (e.type === 'LAYER_BLUR') return `blur(${(e.radius ?? 0) / 2}px)`;
      if (e.type === 'BACKGROUND_BLUR') return `blur(${(e.radius ?? 0) / 2}px)`;
    }
    return null;
  },

  /* 节点级 blendMode → CSS mix-blend-mode。
     PASS_THROUGH / NORMAL 是默认合成，不写样式。
     LINEAR_BURN / LINEAR_DODGE 在 CSS 里没有等价物 —— 用最接近的近似并打
     data-blend-approx 留痕（近似不许伪装成精确支持，覆盖门把它报 ⚠️）。
     映射表之外的取值不许猜：打 data-blend-unknown 让探针/人能找到它。 */
  _blendCss(bm) {
    const M = {
      MULTIPLY: 'multiply', SCREEN: 'screen', OVERLAY: 'overlay',
      DARKEN: 'darken', LIGHTEN: 'lighten', COLOR_DODGE: 'color-dodge', COLOR_BURN: 'color-burn',
      HARD_LIGHT: 'hard-light', SOFT_LIGHT: 'soft-light', DIFFERENCE: 'difference', EXCLUSION: 'exclusion',
      HUE: 'hue', SATURATION: 'saturation', COLOR: 'color', LUMINOSITY: 'luminosity',
      LINEAR_BURN: 'multiply', LINEAR_DODGE: 'screen',   // ← 近似，不是等价
    };
    if (!bm || bm === 'PASS_THROUGH' || bm === 'NORMAL') return null;
    const css = M[bm] || null;
    const approx = bm === 'LINEAR_BURN' || bm === 'LINEAR_DODGE';
    return { css, approx, raw: String(bm) };
  },

  /** 资产路径表（nodeId → assets/xxx.png）。
      由 scripts/figma-assets.mjs 写入 #qa-assets 块，禁止手抄。
      为什么不放 truth：图片是二进制，没有 JSON locator，做不成可校验叶子；
      路径是构建产物，字节由 assets-manifest.json 里的 sha256 校验（门 D 的 asset-sha）。 */
  _assets() {
    if (this.__assetCache) return this.__assetCache;
    let m = {};
    try {
      const el = document.getElementById('qa-assets');
      if (el && el.textContent.trim()) m = JSON.parse(el.textContent);
    } catch (e) { /* 没有资产块时按"全部缺图"处理，走占位 */ }
    this.__assetCache = m;
    return m;
  },

  _assetRec(id, platform = null) {
    let key = id;
    while (key && typeof key === 'object' && 'value' in key) key = key.value;
    const assets = this._assets();
    /* Asset manifests produced from a dual-platform handoff use `pc:<id>` /
       `mobile:<id>` to prevent same Figma ids in two source trees colliding.
       Painting works with bare ids from truth, so resolve the active platform
       first, then retain the bare-id path for single-platform demos.
       A platform-prefixed record can be a thin file/imageRef pointer. Merge
       it with the bare-id record so exportBox / exportBounds / sliceExport
       survive; otherwise an img/ owner is painted at the layout box and the
       delivered render canvas (shadow/overhang) overflows the visible frame. */
    const normalize = (rec) => {
      if (!rec) return null;
      return (typeof rec === 'string') ? { file: rec } : rec;
    };
    const platformRec = platform ? normalize(assets[`${platform}:${key}`]) : null;
    const bareRec = normalize(assets[key]);
    if (!platformRec && !bareRec) return null;
    if (platformRec && bareRec && platformRec !== bareRec) {
      return { ...bareRec, ...platformRec, file: platformRec.file || bareRec.file };
    }
    return platformRec || bareRec;
  },

  /* Ready pack slices the selected `ind/` COMPONENT root (`2:2424`), not the
     page INSTANCE. CONSUMER.md: consume by instance componentId. Do not invent
     a CSS diamond, and do not reuse a sibling IMAGE fill as the whole mark. */
  _assetRecForNode(n, platform = null) {
    const rec = this._assetRec(n && n.id, platform);
    if (rec) return rec;
    const componentId = String((n && n.componentId) || '');
    if (!componentId) return null;
    const pfx = ((/^([a-z]+)\//.exec(String(n && n.name || '')) || [])[1] || '');
    if (pfx !== 'ind' && String(n && n.role || '') !== 'ind') return null;
    return this._assetRec(componentId, platform);
  },

  /* Resolve a source IMAGE fill to its own delivered file. A node-level
     manifest record may legitimately contain several imageRefs but retain
     only the first file for backwards compatibility; never reuse that first
     file for a later fill. Prefer an exact filename/ref match, then a
     single-ref record. Missing refs remain missing and are rendered as a
     placeholder so the visual gate stays fail-closed. */
  _assetFileForImageRef(imageRef, preferredRec = null) {
    const ref = String(imageRef || '');
    if (!ref) return null;
    const preferred = preferredRec && typeof preferredRec === 'object' ? preferredRec : null;
    if (preferred && preferred.file) {
      const preferredRefs = Array.isArray(preferred.imageRefs) ? preferred.imageRefs.map(String) : [];
      if (!preferredRefs.length || preferredRefs.includes(ref)) return String(preferred.file);
    }
    const assets = this._assets();
    for (const value of Object.values(assets || {})) {
      const rec = typeof value === 'string' ? { file: value } : value;
      if (!rec || !rec.file) continue;
      if (String(rec.file).includes(`image-ref-${ref}`)) return String(rec.file);
    }
    for (const value of Object.values(assets || {})) {
      const rec = typeof value === 'string' ? { file: value } : value;
      if (!rec || !rec.file || !Array.isArray(rec.imageRefs)) continue;
      const refs = rec.imageRefs.map(String);
      if (refs.length === 1 && refs[0] === ref) return String(rec.file);
    }
    /* A node export can legitimately bake several IMAGE fills into one
       composite PNG. When no single-ref alias exists, reuse that source
       composite instead of turning the later fill into a placeholder. */
    for (const value of Object.values(assets || {})) {
      const rec = typeof value === 'string' ? { file: value } : value;
      if (!rec || !rec.file || !Array.isArray(rec.imageRefs)) continue;
      if (rec.imageRefs.map(String).includes(ref)) return String(rec.file);
    }
    return null;
  },

  /** 从 id 叶子的 locator 里解析 children 索引序列 —— 这就是树位置 + 绘制顺序。
      结构信息不是我们编的派生数据，而是从被门 A 校验过的 locator 里推出来的。 */
  _orderKey(locator) {
    const out = [];
    const re = /\/children\/(\d+)/g;
    let m;
    while ((m = re.exec(locator || ''))) out.push(Number(m[1]));
    return out;
  },

  /* Font source-truth routing — single source of truth is
     scripts/lib/translation/font-routing.mjs; mirrored inline here because this
     renderer is a self-contained inlined artifact. Keyed ONLY by normalized
     language + generic role (title/button/body), never by page/node id.
     A missing local file is NOT faked: the truth family is still routed, and the
     missing load surfaces via fonts-manifest `missing` + evidence font.loaded. */
  /* 字体角色以【源字体家族】为真源签名，不靠脆弱的名称正则：Figma 里
     title/button 用 display 家族（Alimama ShuHeiTi 700 / Bebas Neue），body 正文用
     FontquanXinYiGuanHeiTi 400。源家族是 display 类 → 该节点在目标语言里也用
     display/标题/按钮家族；源是正文类 → 目标语言用正文家族。这比从 role 字符串猜
     更稳：同一 heading-content-card 角色里既有标题也有正文，但它们的源家族不同。 */
  _fontRoleFor({ sourceFamily = '', role = '', semanticClass = '' } = {}) {
    const fam = String(sourceFamily || '');
    /* Bebas Neue 只承载 latin/ASCII 字形（日期/兑换码/计数），任何语言都保持
       Bebas（weight 400）：换成 CJK display 家族会改字重并撑爆固定框（如兑换码）。 */
    if (/Bebas/i.test(fam)) return 'latin-display';
    if (/Alimama/i.test(fam)) {
      /* display 家族：再分 title / button。按钮标签由结构 role 决定。 */
      const hay = (String(role || '') + ' ' + String(semanticClass || '')).toLowerCase();
      if (/button|btn|skill-label|tag|label|badge/.test(hay)) return 'button';
      return 'title';
    }
    return 'body';
  },
  _routeFontFamily({ language = 'unknown', role = '', semanticClass = '', sourceFamily = null, sourceWeight = 400 } = {}) {
    const raw = String(language || '').replace('_', '-').toLowerCase();
    const lang = raw.startsWith('zh-tw') || raw.startsWith('zh-hk') ? 'zh-TW'
      : raw.startsWith('zh') ? 'zh-CN' : raw.startsWith('ja') ? 'ja'
      : raw.startsWith('ko') ? 'ko' : raw.startsWith('en') ? 'en' : raw;
    const TABLE = {
      'zh-CN': { title: 'Alimama ShuHeiTi', button: 'Alimama ShuHeiTi', body: 'FontquanXinYiGuanHeiTi' },
      'en':    { title: 'Bebas Neue',       button: 'Bebas Neue',       body: 'Noto Sans' },
      'ja':    { title: 'Noto Sans JP',     button: 'Noto Sans JP',     body: 'Noto Sans JP' },
      'ko':    { title: 'Noto Sans KR',     button: 'Noto Sans KR',     body: 'Noto Sans KR' },
      'zh-TW': { title: 'Noto Sans HK',     button: 'Noto Sans HK',     body: 'Noto Sans HK' },
    };
    const fontRole = this._fontRoleFor({ sourceFamily, role, semanticClass });
    /* latin-only display 家族全语言原样保留：本地化不是替换成 CJK display（那是回归）。 */
    if (fontRole === 'latin-display') {
      return { family: sourceFamily, weight: sourceWeight, role: fontRole, language: lang, routed: false };
    }
    const t = TABLE[lang];
    if (!t) return { family: sourceFamily, weight: sourceWeight, role: fontRole, language: lang, routed: false };
    const family = /^Noto Sans/i.test(String(sourceFamily || ''))
      ? (lang === 'zh-CN' ? sourceFamily : (t.body || sourceFamily))
      : (t[fontRole] || t.body || sourceFamily);
    /* zh-CN title/button are weight-700 display fonts (Alimama); body is 400.
       en Bebas Neue only ships 400. The routed weight follows the family, so the
       CJK display face does not get a synthetic-700 from a 400 file and vice versa. */
    const requestedWeight = Number(sourceWeight);
    const weight = /Alimama/.test(family) ? 700
      : /Bebas/i.test(family) ? 400
      : Number.isFinite(requestedWeight) ? requestedWeight : 400;
    return { family, weight, role: fontRole, language: lang, routed: family !== sourceFamily };
  },

  /* 双真源 locale 目标字号（镜像 scripts/lib/translation/typography-policy.mjs 的
     officialTargetDesignSize / LOCALE_FONT_SCALE）。证据 artifacts/official-locale-typography-20260810.json：
     本地 2× 高清稿，官网运行时约为一半，语言比 = 官网该语言视觉字号 / 官网 zh-CN 视觉字号。
     标题各语言同级（en 拉丁略小），正文 ja/en/ko=0.8、zh-TW=1.0。未收录角色/语言回退 1。 */
    _officialTargetDesignSize({ sourceFontSize, sourceLineHeight = null, role = 'unknown', language = 'zh-CN', fontWeight = 400 } = {}) {
    /* 镜像 scripts/lib/translation/typography-policy.mjs#officialTargetDesignSize（tier-aware）。
       证据 artifacts/official-tier-ratio-20260810.json：同一 fw700 标题按【源字号档】分缩放——
       卡片标题(源>40) ja/zh-TW 0.833、en/ko 1.0；技能/小节标题(源<=40)全语言 1.0；正文 fw<600
       ja/en/ko 0.8、zh-TW 1.0。zh-CN 返回 null（不动、保 Figma）。en 标题字重压 400 是 font
       routing 的字体缺口，不在此处处理。不按文案/node 特判。 */
    const lang = String(language || 'zh-CN');
    if (lang === 'zh-CN') return null;
    const src = Number(sourceFontSize);
    if (!Number.isFinite(src) || src <= 0) return null;
    /* tier 分类镜像 classifySourceSizeTier：fw<600=body；fw>=600 且源>40=card-title；否则 heading。 */
    const tier = Number(fontWeight) < 600 ? 'body' : (src > 40 ? 'card-title' : 'heading');
    const SCALE = {
      body: { en: 0.8, ja: 0.8, ko: 0.8, 'zh-TW': 1 },
      'card-title': { en: 1, ja: 0.833, ko: 1, 'zh-TW': 0.833 },
      heading: { en: 1, ja: 1, ko: 1, 'zh-TW': 1 },
    };
    const row = SCALE[tier] || {};
    const ratio = Number.isFinite(row[lang]) ? row[lang] : 1;
    const fontSize = src * ratio;
    /* ja/zh-TW 卡片标题档官网把行高收紧到≈字号（1.0×），其余按源行高同比。 */
    let lineHeight = Number.isFinite(Number(sourceLineHeight)) && Number(sourceLineHeight) > 0 ? Number(sourceLineHeight) * ratio : null;
    if (tier === 'card-title' && (lang === 'ja' || lang === 'zh-TW')) lineHeight = fontSize;
    return { fontSize, lineHeight, ratio, tier, kind: tier === 'body' ? 'body' : 'title', role, language: lang };
  },

  /* Step-fit authorization policy — single source of truth is
     scripts/lib/figma-typography.mjs#fitAuthorization; mirrored inline here
     because this renderer is a self-contained inlined artifact. A fixed UI
     frame may shrink translated copy to fit its maximum owner/content range;
     open-flow / unbounded HEIGHT text keeps source metrics and grows instead. */
  _fitAuthorization({ autoResize = 'FIXED', truncation = null, clipsContent = false, isMask = false, explicitFit = false, openFlow = false, boundedOwner = false, layoutSizingVertical = null } = {}) {
    const truncating = String(autoResize || 'FIXED').toUpperCase() === 'TRUNCATE' || truncation === 'ENDING';
    if (openFlow) return { authorized: false, reason: 'open-flow-natural-growth' };
    if (explicitFit) return { authorized: true, reason: 'explicit-fit-grant' };
    if (truncating) return { authorized: true, reason: 'truncation' };
    if (clipsContent === true || isMask === true) return { authorized: true, reason: 'clip-or-mask' };
    // mirrored from scripts/lib/figma-typography.mjs#fitAuthorization
    if (String(layoutSizingVertical || '').toUpperCase() === 'HUG') return { authorized: false, reason: 'hug-vertical-natural-growth' };
    if (boundedOwner) return { authorized: true, reason: 'framed-bounded-owner' };
    return { authorized: false, reason: 'preserve-source-metrics' };
  },

  /* Measure the actual single-line glyph run rather than the text element's
     fixed box.  A title slot has a fixed width, so scrollWidth only repeats
     that box and cannot prove whether glyphs have reached its inner edges. */
  _measureInlineText(el, text, style = {}) {
    const doc = el && (el.ownerDocument || (typeof document !== 'undefined' ? document : null));
    if (!doc || !doc.body || text == null) return 0;
    const computed = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    const probe = doc.createElement('span');
    probe.textContent = String(text);
    probe.style.position = 'fixed';
    probe.style.left = '-100000px'; probe.style.top = '-100000px';
    probe.style.display = 'inline-block'; probe.style.width = 'max-content';
    probe.style.minWidth = '0'; probe.style.maxWidth = 'none';
    probe.style.whiteSpace = 'pre'; probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    probe.style.fontFamily = style.fontFamily || (computed && computed.fontFamily) || '';
    probe.style.fontSize = style.fontSize != null ? Number(style.fontSize) + 'px' : ((computed && computed.fontSize) || '');
    probe.style.lineHeight = style.lineHeight != null ? Number(style.lineHeight) + 'px' : ((computed && computed.lineHeight) || '');
    probe.style.fontWeight = style.fontWeight != null ? String(style.fontWeight) : ((computed && computed.fontWeight) || '');
    probe.style.fontStyle = (computed && computed.fontStyle) || '';
    probe.style.letterSpacing = style.letterSpacing != null ? String(style.letterSpacing) : ((computed && computed.letterSpacing) || '');
    probe.style.textTransform = (computed && computed.textTransform) || '';
    doc.body.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return Number.isFinite(width) ? width : 0;
  },

  /* 超框自动缩字号（2026-08-04 欣仪需求，lead 定的档）：
     定宽折行文字换语言后实测超出稿框高度 → 按档缩：100% → 92% → 85% → 78% → 75%（下限）。
     到下限仍溢出 → 停在下限、打 data-fit-overflow 标红交人裁决，**不再缩也不回弹**。
     按档不连续缩：连续缩会让每种语言字号都不同，开发实现不出来，
     也没法写成交付给开发的适配规则。字距不缩（同理），后备方案记在 knownGaps。
     行高与字号同比例缩 —— 只缩字号不缩行高，三行变两行之前高度一点省不出来。
     判定全部靠运行时实测（scrollHeight），Node 冒烟桩没有布局测不了 → 直接跳过，
     机制由冒烟里的模拟探针验证（不许在无布局环境装样子）。 */
  _fitText(el, tx, box, opts = {}) {
    /* An approved semantic line layout is content truth. It must retain the
       shared locale base size and its authored line count, never be squeezed
       back to one line by height/width step-fit. */
    if (opts.semanticBreak) return;
    /* locale 基准优先：官方 locale 缩放后的字号是该 locale 的真实基准（存于 data-locale-base-*），
       group-fit/step-fit 在其上做最严格统一；无缩放时回退 Figma 源字号（zh-CN 保真）。 */
    const _lbFs = el ? Number(el.getAttribute('data-locale-base-fontsize')) : NaN;
    const _lbLh = el ? Number(el.getAttribute('data-locale-base-lineheight')) : NaN;
    const fs = (Number.isFinite(_lbFs) && _lbFs > 0) ? _lbFs : (tx && tx.fontSize);
    const lh = (Number.isFinite(_lbLh) && _lbLh > 0) ? _lbLh : (tx && tx.lineHeight);
    const bh = box && box.h;
    if (typeof fs !== 'number' || typeof lh !== 'number' || !lh || typeof bh !== 'number' || !bh) return;
    /* Bounded hugging labels (button/tag) fit on WIDTH against the owner frame,
       not on height: they are single-line content-sized leaves whose adopted
       string may be wider than the source. The owner width is the hard bound. */
    const widthFit = Number.isFinite(Number(opts.widthFit)) ? Number(opts.widthFit) : null;
    if (widthFit != null) {
      const measuredW = () => this._measureInlineText(el, el.textContent || '');
      if (!measuredW()) return;
      const fitsW = () => measuredW() <= widthFit + 0.5;
      if (fitsW()) return;
      /* Source-anchored one-line title slots may take the documented 70/65%
         terminal tiers after the official locale base, so every sibling keeps
         source-derived clearance rather than one long title touching a frame. */
      const FLOORW = opts.sourceTitleInlineSafe ? 65 : 75;
      const stepsW = opts.sourceTitleInlineSafe ? [92, 85, 78, 75, 70, FLOORW] : [92, 85, 78, FLOORW];
      for (const s of stepsW) {
        el.style.fontSize = (fs * s / 100) + 'px';
        el.style.lineHeight = (lh * s / 100) + 'px';
        el.setAttribute('data-fit-scale', String(s));
        if (s === FLOORW) el.setAttribute('data-fit-floor', String(FLOORW));
        if (fitsW()) return;
      }
      el.setAttribute('data-fit-overflow', '1');
      el.setAttribute('data-fit-needs-review', 'floor-exceeded');
      return;
    }
    /* 阈值与测量必须同坐标系。这里踩过一个错：曾写成 `limit = bh * this.scale()`，
       注释说"scrollHeight 量出来的是缩放后的 px" —— **实测这个假设是错的**。
       用 playwright 在真 Chrome 里量到（stage zoom = 0.4995）：
           scrollHeight = 72     ← 元素自身坐标系，等于稿内 box.h
           getBoundingClientRect().height = 35.95   ← 这个才是 zoom 之后的
       也就是 scrollHeight / offsetHeight / clientHeight 都**不含祖先 zoom**。
       错误的后果不是差一点，是每一条都恒真溢出：72 <= 72*0.4995 永远为假 →
       6 条文字全部一路缩到 75% 下限并标 data-fit-overflow，
       页面上表现为"字号完全不对 + 缩到 11px 后笔画糊成一团、看着大大小小"。
       所以：limit 直接用 bh，两边都在元素自身坐标系里。 */
    /* Authored multi-line Figma text is already a source layout decision.
       Compact source boxes can have a few pixels of browser ink overflow, but
       that is not permission to shrink the designed line rhythm. */
    const authoredLineCountEarly = Array.isArray(tx && tx.lineTypes)
      ? tx.lineTypes.length
      : (typeof tx?.characters === 'string' && tx.characters.includes('\n')
        ? tx.characters.split('\n').length : 0);
    const authoredMultiline = authoredLineCountEarly > 1
      && typeof tx?.characters === 'string'
      && tx.characters.includes('\n');
    if (authoredMultiline && !tx?.fit && !tx?.truncation) {
      el.setAttribute('data-fit-policy', 'authored-multiline-source-metrics');
      return;
    }
    const limit = bh;
    const measured = () => (typeof el.scrollHeight === 'number' && isFinite(el.scrollHeight) ? el.scrollHeight : 0);
    if (!measured()) return;
    /* 单行 HEIGHT 文字的行高取整容忍（与 classifyTypographyRange 的 hugMetricDrift
       同一标准）。踩过的坑：单行文字 fontSize == lineHeight（如 40/40、32/32），
       Chrome 对单行框按近似 normal 度量的行高比稿值略大（32→34.78、40→42.x），
       scrollHeight 量出 limit+2~3px，被误判成"超框"，于是一路缩字号 —— 连源语言
       zh-CN 的单行短标题都集体缩到 92%，页面上看着"整体字变小了/错位"。
       这是浏览器 vs Figma 的行框度量能差，不是真溢出。
       只对【单行】（内容里没有 \n，折行只能靠宽度，而单行 HEIGHT 框宽足够）
       放宽；多行 HEIGHT 仍然实测，真换行溢出照缩不误。 */
    /* 单行框签名：box 高度≈一个 lineHeight（fs==lh==box.h 的标题/标签都是这种）。
       多行框（box.h 明显大于一个 lh）不给这个容忍 —— 译文折行多一行是真溢出，
       必须照常缩。用几何签名判断，不依赖 characters 里有没有 \n（译文可能带 \n
       而源文本不带，或反之，不可靠）。 */
    /* 容忍按【源行数】累计，不按测量行数 —— 译文多折一行不能自己抬高容忍度，
       否则真溢出会被自己的折行数稀释掉。源行数 = box.h / lineHeight（稿里几行）。
       每行给 max(2, lh*0.25) 的行框取整容忍（与 hugMetricDrift 同一标准）：
       Chrome 单行框按近似 normal 度量的行高比稿值大 ~2-3px，2 行就累计 ~5px。 */
    /* 每行容忍按真实度量的行框取整差标定：实测 fs==lh 单行框 Chrome 比稿值
       大 ~2-3px（32→34.78、40→42.x），这是 em 内容区(≈1.15em)超出 fontSize 的
       固定量，不是 lh 的 25%。用每行 max(2, lh*0.09)（lh=32→2.9px）就够覆盖
       取整差，又不至于把"译文多折一行"的真溢出（多一行=多一个 lh≈36px）放过去。
       lh*0.25 太松：lh=36 给 9px/行，2 行就 18px，把英文折 3 行(超 12px)也误判
       成"取整差"而停在 78%，卡片文字因此溢出底边 —— 这是实测抓到的回归。 */
    /* 单行框的取整差实测可达 ~4px（en 长字 40px 框差 4px），是误缩主源，给足容忍；
       多行框收紧到 max(2, lh*0.09)/行，避免把"译文多折一行"的真溢出放过去。 */
    /* Prefer authored Figma line metadata over a geometry-derived estimate.
       Multi-line text can have a compact source box (especially CJK card
       labels), so rounding box.h / lineHeight down to one line falsely
       authorizes the 75% shrink floor and changes the visual font size. */
    const authoredLineCount = Array.isArray(tx && tx.lineTypes)
      ? tx.lineTypes.length
      : (typeof tx?.characters === 'string' && tx.characters.includes('\n')
        ? tx.characters.split('\n').length : 0);
    const geometryLineCount = lh > 0 ? Math.max(1, Math.round(bh / lh)) : 1;
    const sourceLines = Math.max(1, authoredLineCount || 0, geometryLineCount);
    const singleLine = sourceLines <= 1;
    const perLine = singleLine ? Math.max(5, lh * 0.15) : Math.max(2, lh * 0.09);
    const lineRoundingSlack = perLine * sourceLines;
    const fits = () => measured() <= limit + 0.5 + lineRoundingSlack;
    if (fits()) return;
    /* Hard floor: never shrink below 75% of the source size. Steps are
       discrete (not continuous) so the delivered rule is implementable, and
       fontSize/lineHeight scale together to preserve leading & vertical
       centering. Reaching the floor without fitting is a human-review state,
       not a silent pass. */
    const FLOOR = 75;
    for (const s of [92, 85, 78, FLOOR]) {
      el.style.fontSize = (fs * s / 100) + 'px';
      el.style.lineHeight = (lh * s / 100) + 'px';
      el.setAttribute('data-fit-scale', String(s));
      if (s === FLOOR) el.setAttribute('data-fit-floor', String(FLOOR));
      if (fits()) return;
    }
    /* Still overflowing at the floor: stop, stay at the floor, and flag for
       human review. Do not shrink further and do not pretend it fit. */
    el.setAttribute('data-fit-overflow', '1');
    el.setAttribute('data-fit-needs-review', 'floor-exceeded');
  },

  /* ═══ 通用 Hero Scroll-Slot 状态机 ═══
     几何仍由 Figma page/section truth 决定；浏览器只负责把 scrollTop 映射成
     LOCKED → EXITING → RELEASED。没有遮罩、display:none 或页面专用选择器。
     这个状态也作为 DOM 证据输出，供 Chrome gate 验证回顶和 resize。 */
  _buildHeroScrollSlot({ viewportHeight, scale, pageOriginY = 0, firstSection = {}, followingSections = [], contentRootId = null } = {}) {
    const viewport = Number(viewportHeight);
    const factor = Number(scale);
    const heroHeight = Number(firstSection.height);
    const firstY = Number(firstSection.y);
    const valid = Number.isFinite(viewport) && viewport > 0 && Number.isFinite(factor) && factor > 0
      && Number.isFinite(heroHeight) && heroHeight > 0 && Number.isFinite(firstY);
    if (!valid || Math.abs(firstY - Number(pageOriginY || 0)) > 0.5 || contentRootId == null) return null;
    const designHeight = viewport / factor;
    const extra = Math.max(0, designHeight - heroHeight);
    const layoutOffsetDesign = extra;
    const releaseDistance = extra * factor;
    return {
      stateVersion: 'hero-scroll-slot/v3',
      sectionId: firstSection.id == null ? null : String(firstSection.id),
      contentRootId: String(contentRootId),
      viewportHeight: viewport,
      scale: factor,
      heroHeight,
      designHeight,
      extra,
      layoutOffsetDesign,
      releaseDistance,
      revealSections: [],
      revealSectionId: null,
      revealDistance: 0,
      stateAt(scrollTop = 0) {
        const top = Math.max(0, Number(scrollTop) || 0);
        if (top <= 0.5) return { state: 'HERO_LOCKED', progress: 0, scrollTop: top };
        const progress = releaseDistance > 0 ? Math.min(1, Math.max(0, top / releaseDistance)) : 1;
        return { state: top + 0.5 >= releaseDistance ? 'CONTENT_RELEASED' : 'HERO_EXITING', progress, scrollTop: top };
      },
    };
  },

  /* Optional official-motion adapter bridge. The adapter contains semantic
     roles and generic primitives only; it never supplies page IDs/selectors.
     No adapter means no claim of official-site motion fidelity. */
  _installMotionAdapter(frame, adapter) {
    if (typeof frame?.__motionAdapterCleanup === 'function') frame.__motionAdapterCleanup();
    if (typeof frame?.__motionCarouselCleanup === 'function') frame.__motionCarouselCleanup();
    if (!frame || !adapter || !adapter.template || !adapter.template.roles
      || typeof frame.querySelectorAll !== 'function') return;
    const doc = frame.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;
    const carouselContract = adapter.carousel || adapter.interaction?.carousel
      || adapter.template.interaction?.carousel || null;
    if (carouselContract) this._installCarouselMotion(frame, carouselContract);
    if (!doc.querySelector('style[data-figma-motion-keyframes]') && doc.head) {
      const style = doc.createElement('style');
      style.setAttribute('data-figma-motion-keyframes', 'generic-v1');
      style.textContent = [
        /* Use composite properties so motion never replaces a Figma static
           transform (rotation/scale/placement). */
        '@keyframes figma-motion-blur-scale-in{from{opacity:0;filter:blur(6px);scale:.95}to{opacity:1;filter:blur(0);scale:1}}',
        '@keyframes figma-motion-slide-up{from{opacity:0;translate:0 50px}to{opacity:1;translate:0 0}}',
        '@keyframes figma-motion-slide-down{from{opacity:0;translate:0 -50px}to{opacity:1;translate:0 0}}',
        '@keyframes figma-motion-slide-left{from{opacity:0;translate:16px 0}to{opacity:1;translate:0 0}}',
        '@keyframes figma-motion-slide-right{from{opacity:0;translate:-16px 0}to{opacity:1;translate:0 0}}',
        '@keyframes figma-motion-fade-in-from-left{from{clip-path:inset(0 100% 0 0);opacity:0}to{clip-path:inset(0);opacity:1}}',
        '@keyframes figma-motion-clip-center{from{clip-path:inset(90%);opacity:0}to{clip-path:inset(0);opacity:1}}',
        '@keyframes figma-motion-clip-circle{from{clip-path:circle(0);opacity:0}to{clip-path:circle(100%);opacity:1}}',
        '@keyframes figma-motion-arrow-loop-y{0%,to{translate:0 -.0833rem}50%{translate:0 0}}',
        '@keyframes figma-motion-arrow-loop-x{0%,to{translate:10px 0}50%{translate:0 0}}',
        '.frame[data-hero-scroll-slot="active"][data-hero-scroll-state="HERO_LOCKED"][data-hero-scroll-progress="0.0000"]>.fx-stage[data-hero-slot-role="after-hero"]{clip-path:inset(0 0 100% 0)}',
        '@media (prefers-reduced-motion: reduce){[data-motion-role]{animation:none!important;animation-name:none!important;transition:none!important;filter:none!important;opacity:1!important}[data-hero-slot-role="hero"]{transition:none!important}}',
      ].join('');
      doc.head.appendChild(style);
    }
    const keyframes = {
      'blur-scale-in': 'figma-motion-blur-scale-in',
      'slide-up': 'figma-motion-slide-up',
      'slide-down': 'figma-motion-slide-down',
      'slide-left': 'figma-motion-slide-left',
      'slide-right': 'figma-motion-slide-right',
      'clip-circle': 'figma-motion-clip-circle',
      'arrow-loop-y': 'figma-motion-arrow-loop-y',
      'arrow-loop-x': 'figma-motion-arrow-loop-x',
    };
    const observers = [];
    const cleanups = [];
    const installEntry = (el, role, spec) => {
      const requestedStep = Number(el.getAttribute('data-motion-step'));
      const step = Number.isFinite(requestedStep) && requestedStep >= 0 ? requestedStep : 0;
      const entry = spec && Array.isArray(spec.entries) ? spec.entries[Math.min(step, spec.entries.length - 1)] : null;
      const animationName = entry && keyframes[entry.primitive];
      if (!animationName || !el.style) return;
      const duration = Number(entry.durationMs);
      const delay = Number(entry.delayMs || 0);
      if (!Number.isFinite(duration) || duration <= 0) return;
      el.style.animationName = animationName;
      el.style.animationDuration = duration + 'ms';
      el.style.animationDelay = delay + 'ms';
      el.style.animationTimingFunction = entry.easing || 'ease-out';
      el.style.animationFillMode = 'both';
      el.style.animationIterationCount = entry.iteration || '1';
      el.setAttribute('data-motion-adapter-status', adapter.status || 'unverified');
      el.setAttribute('data-motion-primitive', entry.primitive);
      el.setAttribute('data-motion-trigger', spec.trigger || 'mount');
    };
    for (const el of Array.from(frame.querySelectorAll('[data-motion-role]') || [])) {
      const role = el.getAttribute('data-motion-role');
      const spec = adapter.template.roles[role];
      if (!spec) continue;
      const trigger = String(spec.trigger || 'mount');
      const needsIntersection = /^intersection/.test(trigger) || trigger === 'intersection-or-slide-active';
      if (needsIntersection) {
        el.setAttribute('data-motion-adapter-status', 'pending-intersection');
        let started = false;
        const tryStart = () => {
          if (started || !el.getBoundingClientRect || !frame.getBoundingClientRect) return;
          const fr = frame.getBoundingClientRect();
          const er = el.getBoundingClientRect();
          const overlap = Math.min(fr.bottom, er.bottom) - Math.max(fr.top, er.top);
          const visible = overlap > 0 && er.right > fr.left && er.left < fr.right;
          if (!visible) return;
          started = true;
          installEntry(el, role, spec);
          if (observer) observer.unobserve(el);
          if (typeof frame.removeEventListener === 'function') frame.removeEventListener('scroll', tryStart);
          if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') window.removeEventListener('resize', tryStart);
        };
        /* The frame is the actual scroll container. Using the viewport as the
           observer root can reveal a section while it is still outside the
           app viewport, especially when the QA chrome scales the frame. */
        const observer = typeof IntersectionObserver === 'function'
          ? new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) tryStart(); }, { root: frame, threshold: 0.01 }) : null;
        if (observer) { observer.observe(el); observers.push(observer); }
        if (typeof frame.addEventListener === 'function') frame.addEventListener('scroll', tryStart, { passive: true });
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('resize', tryStart, { passive: true });
        cleanups.push(() => {
          if (observer) observer.disconnect();
          if (typeof frame.removeEventListener === 'function') frame.removeEventListener('scroll', tryStart);
          if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') window.removeEventListener('resize', tryStart);
        });
        tryStart();
      } else {
        installEntry(el, role, spec);
      }
    }

    /* KV mouse parallax is opt-in and semantic: the adapter specifies depth
       ranges; the renderer only looks for background/foreground roles. CSS
       `translate` is used instead of replacing transform so a Figma rotation,
       scale, or static placement remains intact. */
    const parallax = adapter.template.mouseParallax;
    const background = frame.querySelector('[data-motion-role="kv-background"]');
    const foreground = frame.querySelector('[data-motion-role="kv-foreground"]');
    const heroRoot = frame.querySelector('[data-hero-slot-role="hero"]') || frame;
    const canParallax = parallax && background && foreground && heroRoot
      && typeof heroRoot.addEventListener === 'function';
    if (!canParallax) {
      frame.__motionAdapterCleanup = () => {
        for (const observer of observers) observer.disconnect();
        for (const cleanup of cleanups) cleanup();
        frame.__motionAdapterCleanup = null;
      };
      return;
    }
    const transitionMs = Math.max(0, Number(parallax.transitionMs) || 0);
    const easing = parallax.easing || 'ease-out';
    const setParallax = (clientX) => {
      const heroRect = typeof heroRoot.getBoundingClientRect === 'function' ? heroRoot.getBoundingClientRect() : null;
      const width = Number(heroRect?.width) || 0;
      if (width < Number(parallax.minViewportWidth || 0)) return;
      const progress = width > 0 ? Math.min(1, Math.max(0, (Number(clientX) - Number(heroRect?.left || 0)) / width)) : 0.5;
      const bg = (Number(parallax.backgroundRangePercent) || 0) * (1 - (2 * progress));
      const fg = (Number(parallax.foregroundRangePercent) || 0) * ((2 * progress) - 1);
      for (const [el, value, layer] of [[background, bg, 'background'], [foreground, fg, 'foreground']]) {
        el.style.translate = value.toFixed(4) + '% 0';
        el.style.transition = 'translate ' + transitionMs + 'ms ' + easing;
        el.style.willChange = 'translate';
        el.setAttribute('data-motion-parallax-layer', layer);
        el.setAttribute('data-motion-parallax-x', value.toFixed(4) + '%');
      }
    };
    const isWithinHero = (event) => {
      const heroRect = typeof heroRoot.getBoundingClientRect === 'function' ? heroRoot.getBoundingClientRect() : null;
      const x = Number(event?.clientX);
      const y = Number(event?.clientY);
      return !!heroRect && Number.isFinite(x) && Number.isFinite(y)
        && x >= heroRect.left && x <= heroRect.right && y >= heroRect.top && y <= heroRect.bottom;
    };
    const onMove = (event) => {
      if (!isWithinHero(event)) {
        onLeave();
        return;
      }
      const target = event && event.target;
      if (target && typeof target.closest === 'function'
        && target.closest('[data-motion-navigation]')) return;
      setParallax(event && event.clientX);
    };
    const onLeave = () => {
      const heroRect = typeof heroRoot.getBoundingClientRect === 'function' ? heroRoot.getBoundingClientRect() : null;
      setParallax(Number(heroRect?.left || 0) + (Number(heroRect?.width) || 0) / 2);
    };
    /* Decorative page layers frequently own the visible KV pixels while the
       semantic hero stage is their sibling, so it is not the browser hit-test
       target. Listen at the stable scroll frame, then gate by the real hero
       rectangle; this preserves the desktop KV interaction without relying on
       any page-specific DOM node or selector. */
    frame.addEventListener('pointermove', onMove, { passive: true });
    frame.addEventListener('mouseleave', onLeave, { passive: true });
    frame.__motionAdapterCleanup = () => {
      frame.removeEventListener('pointermove', onMove);
      frame.removeEventListener('mouseleave', onLeave);
      for (const observer of observers) observer.disconnect();
      for (const cleanup of cleanups) cleanup();
      frame.__motionAdapterCleanup = null;
    };
    onLeave();
  },

  /* Generic carousel interaction bridge. Main Skill owns the semantic graph
     ([data-motion-carousel-page], tabs, arrows, indicators); this method only
     supplies gesture tracking and the settle timeline. It is inert when the
     graph is absent, so incomplete truth cannot become a fake visual carousel. */
  _installCarouselMotion(frame, contract) {
    if (!frame || !contract || typeof frame.querySelectorAll !== 'function') return;
    const hosts = Array.from(frame.querySelectorAll('[data-motion-carousel]'));
    if (!hosts.length) return;
    const cleanups = [];
    const reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const duration = () => reduced?.matches ? 0 : Math.max(0, Number(contract.settle?.durationMs) || 300);
    const easing = String(contract.settle?.easing || 'ease-out');
    const ratio = Math.min(1, Math.max(0, Number(contract.gesture?.thresholdRatio) || 0.5));
    const thresholdPx = Math.max(0, Number(contract.gesture?.thresholdPx) || 24);
    const flickMs = Math.max(0, Number(contract.gesture?.flickMs) || 300);
    const loop = contract.loop === true;

    for (const host of hosts) {
      const pages = () => Array.from(host.querySelectorAll('[data-motion-carousel-page]'));
      const tabs = () => Array.from(host.querySelectorAll('[data-motion-carousel-tab]'));
      const indicators = () => Array.from(host.querySelectorAll('[data-motion-carousel-indicator]'));
      let index = Math.max(0, Number(host.getAttribute('data-motion-carousel-index')) || 0);
      let drag = null;
      let wasDragged = false;

      const normalize = (next) => {
        const count = pages().length;
        if (!count) return 0;
        if (loop) return ((next % count) + count) % count;
        return Math.min(count - 1, Math.max(0, next));
      };
      const marker = (el, active) => {
        el.toggleAttribute('data-motion-active', active);
        el.setAttribute('aria-selected', active ? 'true' : 'false');
      };
      const layout = (animate, dragPx = 0) => {
        const step = Math.max(1, host.clientWidth || host.getBoundingClientRect().width || 1);
        const pagesNow = pages();
        for (const [i, page] of pagesNow.entries()) {
          page.style.translate = `${((i - index) * step) + dragPx}px 0`;
          page.style.transition = animate ? `translate ${duration()}ms ${easing}` : 'none';
          page.setAttribute('aria-hidden', i === index ? 'false' : 'true');
          page.toggleAttribute('data-motion-active', i === index);
        }
        for (const tab of tabs()) marker(tab, Number(tab.getAttribute('data-motion-carousel-index')) === index);
        for (const ind of indicators()) marker(ind, Number(ind.getAttribute('data-motion-carousel-index')) === index);
        host.setAttribute('data-motion-carousel-index', String(index));
        host.setAttribute('data-motion-carousel-status', contract.behaviorEvidence?.status || 'unverified');
      };
      const moveTo = (next, animate = true) => { index = normalize(next); layout(animate); };
      const finish = () => { if (drag) { layout(true); drag = null; } };
      const onPointerDown = (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (event.target?.closest?.('[data-motion-carousel-no-swipe]')) return;
        const step = Math.max(1, host.clientWidth || host.getBoundingClientRect().width || 1);
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp, step };
        wasDragged = false;
        host.setPointerCapture?.(event.pointerId);
        layout(false);
      };
      const onPointerMove = (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (Math.abs(dx) < Math.abs(dy)) return;
        if (Math.abs(dx) >= 3) wasDragged = true;
        layout(false, dx);
        if (wasDragged) event.preventDefault();
      };
      const onPointerUp = (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const dx = event.clientX - drag.x;
        const elapsed = Math.max(0, event.timeStamp - drag.t);
        const commit = Math.abs(dx) >= Math.max(thresholdPx, drag.step * ratio)
          || (Math.abs(dx) > 0 && elapsed <= flickMs);
        const delta = commit ? (dx < 0 ? 1 : -1) : 0;
        host.releasePointerCapture?.(event.pointerId);
        drag = null;
        if (delta) moveTo(index + delta, true); else layout(true);
      };
      const onClick = (event) => {
        const target = event.target?.closest?.('[data-motion-carousel-prev],[data-motion-carousel-next],[data-motion-carousel-tab],[data-motion-carousel-indicator]');
        if (!target || wasDragged) { wasDragged = false; return; }
        const explicit = target.getAttribute('data-motion-carousel-index');
        if (explicit != null && Number.isFinite(Number(explicit))) moveTo(Number(explicit), true);
        else if (target.hasAttribute('data-motion-carousel-prev')) moveTo(index - 1, true);
        else if (target.hasAttribute('data-motion-carousel-next')) moveTo(index + 1, true);
      };
      host.addEventListener('pointerdown', onPointerDown, { passive: true });
      host.addEventListener('pointermove', onPointerMove, { passive: false });
      host.addEventListener('pointerup', onPointerUp, { passive: true });
      host.addEventListener('pointercancel', onPointerUp, { passive: true });
      host.addEventListener('click', onClick);
      layout(false);
      cleanups.push(() => {
        host.removeEventListener('pointerdown', onPointerDown);
        host.removeEventListener('pointermove', onPointerMove);
        host.removeEventListener('pointerup', onPointerUp);
        host.removeEventListener('pointercancel', onPointerUp);
        host.removeEventListener('click', onClick);
      });
    }
    const previous = frame.__motionCarouselCleanup;
    if (typeof previous === 'function') previous();
    frame.__motionCarouselCleanup = () => {
      for (const cleanup of cleanups) cleanup();
      frame.__motionCarouselCleanup = null;
    };
  },

  _installHeroScrollSlot(frame, contract) {
    if (!frame) return;
    if (typeof frame.__heroScrollSlotCleanup === 'function') frame.__heroScrollSlotCleanup();
    if (!contract) {
      frame.setAttribute('data-hero-scroll-state', 'UNVERIFIED');
      frame.removeAttribute('data-hero-scroll-progress');
      return;
    }
    const heroStage = typeof frame.querySelector === 'function'
      ? frame.querySelector('[data-hero-slot-role="hero"]') : null;
    const revealStages = typeof frame.querySelectorAll === 'function'
      ? [...frame.querySelectorAll('[data-hero-slot-reveal="true"]')] : [];
    const sync = () => {
      /* A narrow device can have less remaining document range than the
         source-derived reveal distance. Clamp only the runtime release range,
         never section coordinates: reaching the real end must still release
         the temporary reveal instead of leaving the page half-exited. */
      const maxScroll = Math.max(0, Number(frame.scrollHeight) - Number(frame.clientHeight));
      const releaseDistance = Math.min(Math.max(0, Number(contract.releaseDistance) || 0), maxScroll);
      const top = Math.max(0, Number(frame.scrollTop) || 0);
      const progress = top <= 0.5 ? 0 : (releaseDistance > 0 ? Math.min(1, Math.max(0, top / releaseDistance)) : 1);
      const state = {
        state: top <= 0.5 ? 'HERO_LOCKED' : (top + 0.5 >= releaseDistance ? 'CONTENT_RELEASED' : 'HERO_EXITING'),
        progress,
        scrollTop: top,
      };
      frame.setAttribute('data-hero-scroll-state', state.state);
      frame.setAttribute('data-hero-scroll-progress', state.progress.toFixed(4));
      frame.setAttribute('data-hero-slot-release-scroll', String(releaseDistance));
      frame.setAttribute('data-hero-slot-state-version', contract.stateVersion);
      frame.style.setProperty('--fx-hero-locked-viewport-height', Math.max(0, Number(frame.clientHeight) || 0) + 'px');
      const reduce = typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      /* 可见离场只消费通用 hero slot 语义，不依赖页面标题、节点 id 或序号。
         这是滚动进度驱动的通用视觉接入；Figma 未提供 motion truth 时明确留痕，
         不把它冒充成精确 easing/duration。静态首屏与释放后的布局仍由 geometry
         contract 决定，不能用 display:none、遮罩或白块制造“离场”。 */
      if (heroStage && heroStage.style) {
        const offset = (-6 * progress).toFixed(3);
        const opacity = (1 - (0.16 * progress)).toFixed(4);
        heroStage.style.transformOrigin = '50% 0';
        heroStage.style.translate = reduce ? '0 0' : '0 ' + offset + '%';
        heroStage.style.opacity = reduce ? '1' : opacity;
        heroStage.style.transition = reduce ? 'none' : 'translate 180ms linear, opacity 180ms linear';
        heroStage.style.willChange = reduce ? 'auto' : 'translate, opacity';
        heroStage.setAttribute('data-hero-visual-motion', 'scroll-scrub-generic-unverified');
        heroStage.setAttribute('data-hero-visual-progress', progress.toFixed(4));
      }
      /* Only the immediate successor that leaks into the viewport receives a
         temporary reveal translate. Every other section is painted at its
         original Figma y from the start; this is not a page-wide offset. */
      for (const stage of revealStages) {
        if (!stage || !stage.style) continue;
        const revealDistance = Math.max(0, Number(stage.getAttribute('data-hero-slot-reveal-distance')) || 0);
        stage.style.translate = '0 ' + (revealDistance * (1 - progress)).toFixed(3) + 'px';
        stage.style.transition = reduce ? 'none' : 'translate 0ms linear';
        stage.style.willChange = reduce ? 'auto' : 'translate';
        stage.setAttribute('data-hero-reveal-progress', progress.toFixed(4));
      }
    };
    /* Node render smoke 使用最小 frame stub，没有事件 API；仍写入首屏状态，
       浏览器环境才安装真实 scroll/resize listener。 */
    if (typeof frame.addEventListener !== 'function') {
      sync();
      return;
    }
    frame.addEventListener('scroll', sync, { passive: true });
    const onResize = () => sync();
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', onResize, { passive: true });
    }
    frame.__heroScrollSlotCleanup = () => {
      if (typeof frame.removeEventListener === 'function') frame.removeEventListener('scroll', sync);
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('resize', onResize);
      }
      frame.__heroScrollSlotCleanup = null;
    };
    sync();
  },

  renderApp(ctx) {
    const t = ctx.truth;                       // provenance 已被 chrome 解包成裸值
    const frame = ctx.frame;
    if (typeof frame.__heroScrollSlotCleanup === 'function') frame.__heroScrollSlotCleanup();
    if (typeof frame.__motionAdapterCleanup === 'function') frame.__motionAdapterCleanup();
    if (typeof frame.__fxAssetSchedulerCleanup === 'function') frame.__fxAssetSchedulerCleanup();
    if (typeof frame.__fxDropmenuCleanup === 'function') frame.__fxDropmenuCleanup();
    frame.innerHTML = '';

    // 当前端对应的设计稿宽度。规范只有 mobile(750) 与 pc(3840) 两套稿；
    // tablet 区间用哪套稿在 spec.adaptation.knownDeviations 里标着 TODO，未定，暂按 pc。
    const DW = { pc: 3840, pad: 3840, mobile: 750 };
    const __platforms = t.platforms || {};
    /* The acceptance shell uses matrix vocabulary (`desktop` / `tablet`), while
       ready platform truth is keyed by its source compositions (`pc` / `pad`).
       Normalize at this single consumer boundary.  Previously `desktop` happened
       to fall through to PC, but it was not a declared mapping; that made a shell
       deep link and the renderer speak different platform dialects. */
    const __plat = (ctx.prefs && ctx.prefs.plat) || 'pc';
    const __normalizedPlat = { desktop: 'pc', tablet: 'pad', phone: 'mobile' }[__plat] || __plat;
    const __platBases = {
      pc: 'pc',
      pad: __platforms.pad ? 'pad' : 'pc',
      mobile: __platforms.mobile ? 'mobile' : 'pc',
    };
    const __base = __platBases[__normalizedPlat] || 'pc';
    const __hasNative = (__base === __normalizedPlat);
    /* Static mobile scale: native 20:2205 tree at designWidth 750.
       Fallback to the PC tree on a phone viewport is not a scale fix. */
    const __activeTruth = __platforms[__base] || t;
    const motionAdapter = ctx.motionAdapter || ctx.motion || null;
    const __rawRoot = (ctx.rawTruth && ctx.rawTruth.platforms && ctx.rawTruth.platforms[__base])
      || ctx.rawTruth || {};
    /* Programmatic hover/press is Interaction Skill owned. It is not a Figma
       variant and must not replace source-backed highlight COMPONENT_SET trees. */
    (function installButtonPressFeel() {
      const doc = frame && (frame.ownerDocument || (typeof document !== 'undefined' ? document : null));
      if (!doc || !doc.head || doc.querySelector('style[data-fx-button-press]')) return;
      const payload = ctx.interactionPayload || ctx.renderInteractionPayload
        || motionAdapter && (motionAdapter.interactionPayload || motionAdapter.interaction && motionAdapter.interaction.rendererPayload);
      const css = payload && payload.buttonPress && payload.buttonPress.css
        || [
          ':root{--fx-hover-brightness:1.12;--fx-press-brightness:.88}',
          '[data-hscroll],[data-hscroll] img,[data-hscroll-surface],[data-switch-owner] img,[data-switch-swipe-host] img{-webkit-user-select:none;user-select:none;-webkit-user-drag:none;-webkit-touch-callout:none}',
          'button,[role="button"],[data-link],[data-go],[data-sec-target],[data-switch-action],[data-hscroll-action],[data-calendar-now-state="return-today"],[data-tab],[data-indicator],[data-copy-code],[data-btn-press="true"]{cursor:pointer}',
          '@media (hover: hover){button:hover,[role="button"]:hover,[data-link]:hover,[data-go]:hover,[data-sec-target]:hover,[data-switch-action]:hover,[data-hscroll-action]:hover,[data-calendar-now-state="return-today"]:hover,[data-tab]:hover,[data-indicator]:hover,[data-copy-code]:hover,[data-btn-press="true"]:hover{filter:brightness(var(--fx-hover-brightness))}}',
          'button:active,[role="button"]:active,[data-link]:active,[data-go]:active,[data-sec-target]:active,[data-switch-action]:active,[data-hscroll-action]:active,[data-calendar-now-state="return-today"]:active,[data-tab]:active,[data-indicator]:active,[data-copy-code]:active,[data-btn-press="true"]:active{filter:brightness(var(--fx-press-brightness))}',
          '[data-btn-press="inert"],[data-btn-press="inert"]:hover,[data-btn-press="inert"]:active{cursor:default;filter:none}',
          '[data-dropmenu="true"]:hover,[data-dropmenu="true"]:active{filter:none}',
          '[data-dropmenu-state="on"] [data-prefix="img"]{filter:none}',
        ].join('');
      const style = doc.createElement('style');
      style.setAttribute('data-fx-button-press', 'figma-button-press-contract/v1');
      style.textContent = css;
      doc.head.appendChild(style);
      if (!doc.documentElement || doc.documentElement.getAttribute('data-fx-button-press-keys') === 'true') return;
      doc.documentElement.setAttribute('data-fx-button-press-keys', 'true');
      doc.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
        const el = ev.target;
        if (!el || !el.getAttribute || el.getAttribute('role') !== 'button') return;
        if (el.getAttribute('data-btn-press') === 'inert' || el.getAttribute('aria-disabled') === 'true') return;
        ev.preventDefault();
        el.click();
      });
    }());
    frame.setAttribute('data-render-plat', __plat);
    frame.setAttribute('data-render-base', __base);
    if (motionAdapter && motionAdapter.roleResolution?.platformEvidence) {
      frame.setAttribute('data-motion-platform-evidence', String(motionAdapter.roleResolution.platformEvidence[__normalizedPlat] || 'unverified'));
    } else {
      frame.removeAttribute('data-motion-platform-evidence');
    }
    frame.removeAttribute('data-plat-fallback');
    if (!__hasNative) frame.setAttribute('data-plat-fallback', __plat + '-uses-' + __base + '-tree');
    /* Directory stretch and KV plane roles are Resize-owned structure, not an
       optional motion-adapter extra. Always derive them from source labels. */
    const motionRoleMap = this._deriveMotionRoleMap(__activeTruth);
    const designWidth = DW[__base] ?? DW[__plat] ?? 3840;
    this._designWidth = designWidth;
    /* 缩放系数的分母端：用**被模拟的设备视口宽**（壳经 ctx.viewport 传入），
       不是 frame.clientWidth —— 帧的边框/内边距是壳的装饰，不属于被模拟的视口。
       实测（2026-08-04）：1px 装饰边框让 clientWidth 变成 1918，
       k = 1918/3840 = 0.49947916… → 30px 字号在屏幕上 14.984px ——
       小数字号栅格化 → 每个字笔画落在不同子像素上 → 「字有粗有细有大有小」。
       用 1920：k = 0.5 → 30×0.5 = 15px 整数，笔画落整像素。
       取不到 viewport（直调 renderApp 的旁路）才退回 clientWidth。 */
    this._frameWidth = (ctx.viewport && ctx.viewport.w) || frame.clientWidth || designWidth;
    const k = this.scale();

    const sections = __activeTruth.sections || {};
    /* 分区绘制顺序按【稿内 y 升序】，不按 truth 里的键序。
       键序 = extract 的写入顺序 = 我们这边的实现细节；稿内 y 才是稿的事实。
       实测：spec.figma.sections 写的是 [sec/1, sec/3]，而 truth 键序出来是
       [1:467, 1:952]（sec/3 在前）—— 靠键序就会把首屏画到赛季奖励下面。
       meta.y 缺失的排到最后并保持相对次序（缺 y 是提取器的 bug，不在这里兜） */
    const ids = Object.keys(sections).sort((a, b) => {
      const ya = sections[a] && sections[a].meta && sections[a].meta.y;
      const yb = sections[b] && sections[b].meta && sections[b].meta.y;
      if (typeof ya !== 'number' && typeof yb !== 'number') return 0;
      if (typeof ya !== 'number') return 1;
      if (typeof yb !== 'number') return -1;
      return ya - yb;
    });
    const pageScope = __activeTruth.pageChrome || __activeTruth.fixedOverlays || null;
    if (ids.length === 0 && !pageScope) {
      const empty = document.createElement('div');
      empty.className = 'fx-empty';
      empty.setAttribute('data-node-id', 'no-sections');
      empty.textContent = 'truth 里还没有分区节点数据。';
      frame.appendChild(empty);
      return;
    }

    /* ═══ 页面背景 owner：保持 Figma 的合成树，不从各 section 的几何相交结果重拼 ═══
       bg/pc 可能包含渐变 alpha mask、叠放切片和局部装饰。旧方案先把后代按 section
       相交拆散，再按 id 提升到 page 层，丢失了 mask owner / sibling paint order，造成
       DNA 等局部图案跨区出现。extract 现在把配置的 bg/* root 作为 pageBackground
       整体保留；assets 从 Figma 导出该 owner 的合成 PNG，renderer 只定位这一个 root。
       老 truth 没有 pageBackground 时保留旧的按 id 去重路径，但会带降级标记。 */
    const __u = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
    const __plain = (v) => {
      const one = __u(v);
      if (Array.isArray(one)) return one.map(__plain);
      if (one && typeof one === 'object') return Object.fromEntries(Object.entries(one).map(([key, item]) => [key, __plain(item)]));
      return one;
    };
    const directPageBackground = __activeTruth.pageBackground || null;
    const directRawPageBackground = __rawRoot.pageBackground || null;
    let pageBgNodes = directPageBackground && directPageBackground.nodes
      ? (Array.isArray(directPageBackground.nodes) ? directPageBackground.nodes : Object.values(directPageBackground.nodes))
      : [];
    let pageBgRaw = directRawPageBackground && directRawPageBackground.nodes
      ? (Array.isArray(directRawPageBackground.nodes) ? directRawPageBackground.nodes : Object.values(directRawPageBackground.nodes))
      : [];
    const __usesLegacyBackgroundPlacement = pageBgNodes.length === 0;
    if (__usesLegacyBackgroundPlacement) {
      const __bgSeen = new Set();
      const __u = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
      for (const sid of ids) {
        const sb = sections[sid] && sections[sid].background;
        if (!sb || !sb.nodes) continue;
        const list = Array.isArray(sb.nodes) ? sb.nodes : Object.values(sb.nodes);
        const rawList = (__rawRoot.sections && __rawRoot.sections[sid]
          && __rawRoot.sections[sid].background && __rawRoot.sections[sid].background.nodes) || [];
        const rawArr = Array.isArray(rawList) ? rawList : Object.values(rawList);
        for (let bi = 0; bi < list.length; bi++) {
          const nid = __u(list[bi] && list[bi].id);
          if (nid == null || __bgSeen.has(nid)) continue;
          __bgSeen.add(nid);
          pageBgNodes.push(list[bi]);
          pageBgRaw.push(rawArr[bi]);
        }
      }
    }
    const hasPageBg = pageBgNodes.length > 0;
    /* Page frame height is a layout hint, not always the full painted extent. Figma can
       contain a section or a background owner that extends beyond the frame by a few
       pixels. The preview scroll surface must cover every captured visible extent;
       otherwise the browser reveals a white tail even though the Figma paint exists. */
    const pageOriginY = Number((pageScope && pageScope.meta && pageScope.meta.y) || 0);
    const pageContentHeight = pageScope
      ? Math.max(
        Number((pageScope.meta && pageScope.meta.height) || 0),
        ...ids.map((id) => {
          const m = sections[id] && sections[id].meta;
          return (Number((m && m.y) || 0) + Number((m && m.height) || 0)) - pageOriginY;
        }),
        ...pageBgNodes.map((n) => {
          const b = n && n.box;
          return (Number((b && b.y) || 0) + Number((b && b.h) || 0)) - pageOriginY;
        }),
      )
      : 0;
    const pagePaintOrder = Array.isArray(__activeTruth.pagePaintOrder) ? __activeTruth.pagePaintOrder : null;
    const rawPagePaintOrder = Array.isArray(__rawRoot.pagePaintOrder) ? __rawRoot.pagePaintOrder : null;
    /* The continuous document plane always follows the declared platform
       scale. A cover crop is a hero-only visual treatment: applying that
       scale to the page root turns every released section into a widened,
       horizontally cropped hero. */
    let pageStageScale = k;
    let pageStageCropLeft = 0;
    let heroVisualScale = k;
    let heroVisualCropLeft = 0;
    let heroCropWindowDesign = 0;

    /* ═══ 首屏 scroll-slot ═══
       Figma 的静态首屏分区高度不一定等于被模拟设备的可视高度：同一 3840 稿在
       1024×1366 的 viewport 中缩放后，首分区可能只占 576px。若继续按原 y 画，
       第二分区会在 scrollTop=0 就露出来，等同把 PC 缩放误当成完整设备首屏。

       此处不依赖节点名称、序号或特定页面 id。成立条件全部来自页面结构：
       ① page frame 的第一实际 section 从 page origin 开始；②它属于
       pagePaintOrder 中真实的内容 root。满足即把该 section 定义为 hero；若紧邻
       后续分区会漏进 viewport，只在 hero 活跃期临时 reveal 它，到释放点恢复原始坐标。
       pageChrome/fixed overlay 仍按 Figma sibling 原顺序和自身坐标绘制，因此首屏 KV
       及允许的固定层不被重新命名或重排。没有这份结构证据的旧 truth 显式降级，不猜。
    */
    const heroSlot = (() => {
      if (!pageScope || !pagePaintOrder || !ids.length || !Number.isFinite(k) || k <= 0) return null;
      const sectionId = ids[0];
      const first = sections[sectionId] && sections[sectionId].meta;
      const viewportH = Number(ctx.viewport && ctx.viewport.h);
      if (!first || !Number.isFinite(Number(first.y)) || !Number.isFinite(Number(first.height)) || Number(first.height) <= 0
        || !Number.isFinite(viewportH) || viewportH <= 0) return null;
      const startsAtPageOrigin = Math.abs(Number(first.y) - pageOriginY) <= 0.5;
      const listedRoot = pagePaintOrder.find((entry) => {
        const sectionIds = Array.isArray(entry && entry.sectionIds) ? entry.sectionIds : [];
        return sectionIds.some((id) => String(__u(id)) === String(sectionId));
      });
      /* Official first screen is 100vh. A lone page-paint sibling without
         sectionIds is still the content root when the first section starts at
         page origin (SS6 mobile). Do not invent a layout; do not skip the slot. */
      const contentRoot = listedRoot || (pagePaintOrder.length === 1 ? pagePaintOrder[0] : null);
      if (!startsAtPageOrigin || !contentRoot) return null;
      /* Cover-crop belongs to the KV visual plane (the page-chrome `kv` root),
         not the hero section that holds title/download UI. Applying slotScale
         to the section turns the title into a height-driven poster and leaves
         the actual KV artwork on width-scale with later sections. */
      const slotScale = Math.max(k, viewportH / Number(first.height));
      if (Number.isFinite(slotScale) && slotScale > 0) {
        heroVisualScale = slotScale;
        heroVisualCropLeft = (this._frameWidth / slotScale - designWidth) / 2;
        heroCropWindowDesign = viewportH / slotScale;
      }
      /* Cover-crop fills the viewport visually. Later sections stay on their
         Figma y and only follow width-scale; do not push the document down to
         reserve the leftover viewport, or the page background stays put and
         the next block "runs away". */
      const following = ids.map((id) => ({ id, meta: sections[id] && sections[id].meta }))
        .filter((entry) => String(entry.id) !== String(sectionId) && Number(entry.meta && entry.meta.y) > Number(first.y))
        .sort((a, b) => Number(a.meta.y) - Number(b.meta.y));
      return this._buildHeroScrollSlot({
        viewportHeight: viewportH,
        scale: pageStageScale,
        pageOriginY,
        firstSection: { id: sectionId, y: first.y, height: first.height },
        followingSections: following.map((entry) => ({ id: entry.id, y: entry.meta.y })),
        contentRootId: String(__u(contentRoot.id)),
      });
    })();
    const heroLayoutOffsetDesign = heroSlot ? Number(heroSlot.layoutOffsetDesign || 0) : 0;
    const heroUiYRatio = heroSlot && Number(heroSlot.heroHeight) > 0
      ? Math.max(1, Number(heroSlot.designHeight) / Number(heroSlot.heroHeight))
      : 1;
    const shiftedSectionBottom = (id) => {
      const m = sections[id] && sections[id].meta;
      if (!m) return 0;
      const afterHero = heroSlot && String(id) !== String(heroSlot.sectionId) && Number(m.y) > pageOriginY + 0.5;
      return (Number(m.y || 0) + Number(m.height || 0) + (afterHero ? heroLayoutOffsetDesign : 0)) - pageOriginY;
    };
    const pageScrollHeight = pageScope && heroLayoutOffsetDesign > 0
      ? Math.max(pageContentHeight, ...ids.map((id) => shiftedSectionBottom(id)))
      : pageContentHeight;
    /* Hero slot only moves after-hero *sections*. pageBackground stays at Figma
       y, so the last painted bg slice ends early and the shifted tail looks like
       a short background / white card. Keep the first-screen KV at page origin;
       only nodes whose Figma y is below the first section bottom receive the
       same layoutOffsetDesign. Do not translate the whole paint layer. */
    const heroSectionBottomY = heroSlot
      ? Number(heroSlot.firstSectionY != null ? heroSlot.firstSectionY : (sections[heroSlot.sectionId] && sections[heroSlot.sectionId].meta && sections[heroSlot.sectionId].meta.y) || pageOriginY)
        + Number((sections[heroSlot.sectionId] && sections[heroSlot.sectionId].meta && sections[heroSlot.sectionId].meta.height) || heroSlot.heroHeight || 0)
      : 0;
    const afterHeroBackgroundShift = (node) => {
      if (!(heroLayoutOffsetDesign > 0) || !heroSlot) return 0;
      const y = Number(node && node.box && node.box.y);
      if (!Number.isFinite(y)) return 0;
      return y > heroSectionBottomY + 0.5 ? heroLayoutOffsetDesign : 0;
    };
    frame.setAttribute('data-hero-scroll-slot', heroSlot ? 'active' : 'fallback-missing-page-structure');
    if (heroSlot) {
      frame.setAttribute('data-hero-section', heroSlot.sectionId);
      frame.setAttribute('data-hero-content-root', heroSlot.contentRootId);
      frame.setAttribute('data-hero-slot-design-height', String(heroSlot.designHeight));
      frame.setAttribute('data-hero-layout-offset-design', String(heroSlot.layoutOffsetDesign || 0));
      frame.setAttribute('data-hero-page-scale', String(pageStageScale));
      frame.setAttribute('data-hero-page-crop-left', String(pageStageCropLeft));
      frame.setAttribute('data-hero-visual-scale', String(heroVisualScale));
      frame.setAttribute('data-hero-visual-crop-left', String(heroVisualCropLeft));
      frame.setAttribute('data-hero-crop-window-design', String(heroCropWindowDesign));
      frame.setAttribute('data-hero-ui-y-ratio', String(heroUiYRatio));
    } else {
      frame.removeAttribute('data-hero-section');
      frame.removeAttribute('data-hero-content-root');
      frame.removeAttribute('data-hero-slot-design-height');
      frame.removeAttribute('data-hero-layout-offset-design');
      frame.removeAttribute('data-hero-page-scale');
      frame.removeAttribute('data-hero-page-crop-left');
      frame.removeAttribute('data-hero-visual-scale');
      frame.removeAttribute('data-hero-visual-crop-left');
      frame.removeAttribute('data-hero-crop-window-design');
      frame.removeAttribute('data-hero-ui-y-ratio');
    }
    const sectionLayerById = new Map();

    const renderIds = pageScope ? ['__page__', ...ids] : ids;
    let pageStage = null;
    let fixedStage = null;
    /* The ready handoff keeps a fixed owner in fixedOverlays but may keep its
       truth-backed descendants in the section where Figma placed them.  Track
       that explicit owner subtree once so it can be painted in fixedStage and
       omitted from the section paint pass (no flattening, no guessed nodes). */
    let fixedDescendantIds = new Set();
    /* Text fitting happens only after every stage is mounted.  The collection
       must therefore belong to renderApp, rather than a single paint pass. */
    const fitCandidates = [];
    const hugGrowthOwners = [];
    const asArr = (v) => (Array.isArray(v) ? v : Object.values(v || {}));
    const hideInPlace = (node, hidden) => {
      if (!node || node.nodeType !== 1) return;
      if (node.__fxOriginalDisplay === undefined) node.__fxOriginalDisplay = node.style.display;
      node.hidden = hidden;
      node.style.display = hidden ? 'none' : node.__fxOriginalDisplay;
      node.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    };
    const closestIn = (target, selector) => (target && target.closest ? target.closest(selector) : null);
    let namedModalPaint = null;
    for (const sid of renderIds) {
      const pageStageMode = sid === '__page__';
      const sec = pageStageMode ? (__activeTruth.pageChrome || { meta: (__activeTruth.fixedOverlays && __activeTruth.fixedOverlays.meta) || {}, nodes: [] }) : sections[sid];
      const meta = sec.meta || {};
      // nodes 是数组，顺序即 Figma 的 DFS 先序 = 绘制顺序（后面的盖前面的）
      const nodes = Array.isArray(sec.nodes) ? sec.nodes : Object.values(sec.nodes || {});
      // 分区自身的绝对坐标：算相对偏移要减掉它
      /* 分区原点【只从本分区 meta 取】。以前读的是 t.section?.x —— 全局一个值，
         单分区时侥幸对，多分区必错：sec/1 在 y=658、sec/3 在 y=4656，
         用同一个原点会把其中一块整体搬走约 4000px。
         t.section 已从 truth 删除（两份真相是下一个 bug 的入口）。 */
      const pageMeta = (pageScope && pageScope.meta) || {};
      const pageX = pageMeta.x ?? 0;
      const pageY = pageMeta.y ?? 0;
      const secX = meta.x ?? 0;
      const secY = meta.y ?? 0;
      if (!pageStageMode && (typeof meta.x !== 'number' || typeof meta.y !== 'number')) {
        console.warn('[figma-render] 分区 ' + sid + ' 的 meta 缺 x/y，子节点位置会算错（提取器该补上）');
      }

      const stage = document.createElement('div');
      stage.className = 'fx-stage';
      stage.setAttribute('data-node', sid);
      stage.setAttribute('data-node-id', pageStageMode ? 'page-scope' : 'section-' + sid);
      if (pageStageMode && pageScope) {
        stage.style.position = 'relative';
        stage.style.left = pageStageCropLeft + 'px';
        stage.setAttribute('data-page-stage-scale', String(pageStageScale));
        stage.setAttribute('data-page-stage-crop-left', String(pageStageCropLeft));
      }
      /* Page composition has one continuous content-root coordinate system.
         A Figma section root is a sibling component, not an implicit crop
         viewport; only a concrete source node with clipsContent:true may
         establish a clip later in `paint()`. Keep the page stage's own
         document viewport semantics, but never let the stylesheet default
         turn every content section into an overflow:hidden slice. */
      if (!pageStageMode) {
        /* Section roots share the content-root coordinate plane. Their crop is
           not inferred from a CSS default: consume the Figma root's explicit
           clipsContent leaf. This keeps 03 (false) open for the card-frame
           render canvas while preserving a genuine 01/02 viewport clip. */
        const sectionClipsContent = __u(meta.clipsContent) === true;
        stage.style.overflow = sectionClipsContent ? 'hidden' : 'visible';
        stage.setAttribute('data-section-composition', sectionClipsContent
          ? 'content-root-sibling-source-clip'
          : 'content-root-sibling-visible');
        stage.setAttribute('data-section-source-clips-content', String(sectionClipsContent));
      }
      if (!pageStageMode && heroSlot && String(sid) === heroSlot.sectionId) {
        stage.setAttribute('data-motion-role', 'kv');
        stage.setAttribute('data-motion-step', '0');
        stage.setAttribute('data-motion-evidence', 'truth-backed:first-section-page-origin');
        /* Record the KV cover numbers on the hero section for inspect, but do
           not apply them here. Title / download stay on width-scale. */
        stage.setAttribute('data-hero-visual-scale', String(heroVisualScale));
        stage.setAttribute('data-hero-visual-crop-left', String(heroVisualCropLeft));
        stage.setAttribute('data-hero-ui-scale', 'width-k');
        stage.setAttribute('data-hero-ui-plane', 'source-ui-scale');
        stage.setAttribute('data-hero-ui-y-ratio', String(heroUiYRatio));
      }
      stage.style.width = designWidth + 'px';
      /* 分区高度往上取整到【缩放后的整数 CSS px】。
         2026-08-04 实测：sec/3 稿高 1543，k=0.5 → 771.5px，半像素。
         半像素的后果不是"矮了半格"：
           ① 分区边界坐在像素边界之间，字形在半像素上重新光栅化；
           ② 门 E 的元素截图要向外扩到整像素，截出 773 行，
              与稿导出裁剪的 772 行基线尺寸不符 → 门直接 ERROR（不是差异，是跑不了）。
         往上取整最多让分区高出不到 1 个设计 px（本例 1543 → 1544），
         而分区之间在稿里本来就是首尾相接的，抬高 0.5px 不会露出缝
         —— 背景是整页一张、跨分区连续的，缝隙不可见。 */
      const _rawH = meta.height ?? 0;
      const isHeroStage = !pageStageMode && heroSlot && String(sid) === heroSlot.sectionId;
      const _snapH = k > 0 ? Math.ceil(_rawH * k) / k : _rawH;
      /* Official first screen is a 100vh crop window. Keep the Figma hero
         height on the visual plane. The UI stage itself must be tall enough
         for source Y × uiYRatio (vh/k), or a lower-hero UI title stays in
         the top half. */
      const heroUiHeight = isHeroStage && heroSlot && Number(heroSlot.designHeight) > 0
        ? Number(heroSlot.designHeight)
        : _snapH;
      stage.style.height = (pageStageMode ? (pageScrollHeight || meta.height || _snapH) : heroUiHeight) + 'px';
      if (isHeroStage) {
        stage.style.overflow = 'hidden';
        stage.setAttribute('data-hero-source-height', String(_rawH));
      }
      if (pageScope && !pageStageMode) {
        stage.style.position = 'absolute';
        /* `left` belongs to the unscaled page plane. KV cover crop is applied
           to the KV/bg visual nodes, not this UI section, so later sections
           stay put. */
        stage.style.left = (secX - pageX) + 'px';
        const afterHeroLayout = heroSlot && !isHeroStage && Number(secY) > pageY + 0.5;
        const responsiveSecTop = (secY - pageY) + (afterHeroLayout ? heroLayoutOffsetDesign : 0);
        stage.style.top = responsiveSecTop + 'px';
        if (afterHeroLayout) stage.setAttribute('data-hero-layout-shift-design', String(heroLayoutOffsetDesign));
        if (heroSlot) {
          stage.setAttribute('data-hero-slot-role', isHeroStage ? 'hero' : 'after-hero');
          const reveal = (heroSlot.revealSections || []).find((entry) => String(entry.id) === String(sid));
          if (reveal) {
            stage.setAttribute('data-hero-slot-reveal', 'true');
            stage.setAttribute('data-hero-slot-reveal-distance', String(reveal.distance));
          }
        }
      }
      /* 用 zoom 不用 transform: scale —— 欣仪实测指出简中正文「字有大有小」（2026-08-04）。
         根因：transform 是先在 3840px 排版、光栅化成位图后**整块缩小**，
         每个字的像素捕捉各不一致；字体回退已排除（解析过 FontquanXinYiGuanHeiTi
         的 cmap：本页 304 字缺 129 个，但缺的全是日韩，简中一个不缺）。
         zoom 让浏览器在**最终尺寸**下重新排版与光栅化，字形清晰一致。
         连带好处：zoom 改布局占位，stage 在文档流里就占缩放后的高度，
         transform 时代补占位的 .fx-spacer 就此退役（见本函数末尾）。 */
      /* Hero UI size stays on platform width-scale k. Vertical place uses
         Figma y as a fraction of the 100vh slot, not y×k. KV cover-crop is
         applied to the kv/bg visual plane, not this UI section. */
      stage.style.zoom = String(pageStageMode ? pageStageScale : (pageScope ? 1 : k));
      if (pageStageMode && __activeTruth.fixedOverlays && __activeTruth.fixedOverlays.nodes) {
        frame.style.position = frame.style.position || 'relative';
        fixedStage = document.createElement('div');
        fixedStage.className = 'fx-stage fx-fixed-overlays';
        fixedStage.setAttribute('data-node', '__fixed__');
        fixedStage.setAttribute('data-node-id', 'page-fixed-overlays');
        fixedStage.style.position = 'sticky';
        fixedStage.style.left = '0';
        fixedStage.style.top = '0';
        fixedStage.style.width = designWidth + 'px';
        fixedStage.style.height = '0';
        fixedStage.style.overflow = 'visible';
        fixedStage.style.pointerEvents = 'none';
        fixedStage.style.zIndex = '20';
        fixedStage.style.zoom = String(k);
      }

      /* ═══ 还原 Figma 的父子嵌套 ═══
         为什么必须嵌套、不能摊平成兄弟（这是实测踩出来的）：
         摊平之后 clipsContent 的 overflow:hidden **完全失效** —— 容器底下没有子元素，
         子元素是它的兄弟。本分区 9 个裁剪容器实测全都有内容溢出：
           scroll/奖励列表 657×124 里有 10 个节点超边界（页面上就是奖励小图标冲出卡片）
           1:468 奖励展示 1060×1219 里 9 个超边界（边框图 913×1267 比框还高 48）
         顺带失效的还有：父级 opacity 不向子级传递、组内层叠只靠摊平顺序侥幸对上。

         树位置从哪来：每个节点 id 叶子的 locator 里那串 children 索引
         （/nodes/1:467/document/children/1/children/0/...），它是**被门 A 校验过的**，
         不是我们另编的派生数据。
         nodes 是 DFS 先序，所以用一个栈就能 O(n) 认亲：
         栈顶序列若不是当前序列的前缀就弹出，弹完剩下的栈顶即父节点。
         纯容器被提取器穿过（不出节点），序列会跳档 —— 前缀匹配天然容忍跳档，
         孩子会挂到「最近的**有渲染**的祖先」上。 */
      /* paint：把一个节点列表画进一个容器。
         背景层与内容层都走这一个函数 —— 嵌套认亲、裁剪、上色、排版、切图的规则
         只允许有一份实现。今天已经因为"一条规则两份实现"误报过一次。 */
      /* Page INSTANCE records often omit componentVariantGraph. The same
         snapshot still keeps the complete COMPONENT_SET inventory under
         platforms.*.componentVariantGraph; join it here by componentId. */
      const platformVariantIndex = (() => {
        const graph = __plain(__activeTruth && __activeTruth.componentVariantGraph) || {};
        const byComponentId = new Map();
        const sets = Array.isArray(graph.componentSets) ? graph.componentSets : [];
        const treesBySet = graph.variantTrees && typeof graph.variantTrees === 'object' && !Array.isArray(graph.variantTrees)
          ? graph.variantTrees : {};
        for (const set of sets) {
          const setId = String(__u(set && (set.componentSetId || set.id)) || '');
          const variants = (Array.isArray(set && set.variants) ? set.variants : [])
            .filter((variant) => String(__u(variant && variant.componentId) || ''));
          const trees = Array.isArray(treesBySet[setId]) ? treesBySet[setId] : [];
          if (!setId || variants.length < 2 || trees.length !== variants.length) continue;
          const aligned = variants.map((variant, index) => {
            const componentId = String(__u(variant && variant.componentId) || '');
            const tree = trees.find((item) => String(__u(item && item.componentId) || '') === componentId) || trees[index];
            if (String(__u(tree && tree.componentId) || '') !== componentId) return null;
            if (!Array.isArray(tree && tree.nodes) || !tree.nodes.length) return null;
            return { variant, tree, componentId };
          });
          if (aligned.some((entry) => !entry)) continue;
          const resolved = {
            componentSetId: setId,
            variants: aligned.map((entry) => entry.variant),
            variantTrees: aligned.map((entry) => entry.tree),
          };
          for (const entry of aligned) byComponentId.set(entry.componentId, resolved);
        }
        return byComponentId;
      })();
      const attachPlatformVariantGraph = (n) => {
        if (!n || n.componentVariantGraph && Array.isArray(n.componentVariantGraph.variantTrees)
          && n.componentVariantGraph.variantTrees.length) return n;
        const componentId = String(__u(n && n.componentId) || '');
        const resolved = componentId ? platformVariantIndex.get(componentId) : null;
        if (!resolved) return n;
        n.componentVariantGraph = {
          ...(n.componentVariantGraph || {}),
          componentSetId: resolved.componentSetId,
          variants: resolved.variants,
          variantTrees: resolved.variantTrees,
        };
        return n;
      };
      /* Figma preserves authored soft/hard line separators as U+2028 / U+2029.
         HTML text nodes do not treat those characters as an authorial line
         break under every white-space mode. Normalize at the renderer boundary;
         each replacement is one code unit, so rich-text offsets remain valid. */
      const normalizeFigmaLineBreaks = (value) => String(value ?? '')
        .replace(/\r\n?|\u2028|\u2029/g, '\n');
      const nodeParentId = (n) => String(__u(n && n.parentId) || '');
      /* dropmenu open/close is exact lowercase on/off only. Do not reuse
         indicatorVariant's i-flag: On/OFF/true must fail-visible, not open.
         Axis name is unlocked. Multi-axis variants keep Lang=en; only the
         unique {on,off} axis counts. Variant names are comma-separated k=v.
         These helpers live next to paint, not inside interactionBridge:
         paint mounts dropmenu owners and would ReferenceError otherwise. */
      const dropmenuParsePairs = (name) => {
        const pairs = {};
        for (const part of String(name || '').split(',')) {
          const cut = part.indexOf('=');
          if (cut <= 0) continue;
          const key = part.slice(0, cut).trim();
          const val = part.slice(cut + 1).trim();
          if (key) pairs[key] = val;
        }
        return pairs;
      };
      const dropmenuPropertyMap = (n) => {
        const raw = n && (n.componentProperties || n.properties || n.prototype?.componentProperties) || {};
        const props = __plain(raw) || {};
        const out = {};
        for (const [key, item] of Object.entries(props)) {
          const current = __u(item && typeof item === 'object' && item && 'value' in item ? item.value : item);
          if (typeof current === 'string') out[key] = current;
        }
        return out;
      };
      const dropmenuAxisName = (variants, nameOf) => {
        const byAxis = new Map();
        for (const variant of variants || []) {
          const pairs = dropmenuParsePairs(nameOf(variant));
          for (const [key, val] of Object.entries(pairs)) {
            if (!byAxis.has(key)) byAxis.set(key, new Set());
            byAxis.get(key).add(val);
          }
        }
        const matches = [];
        for (const [key, values] of byAxis) {
          if (values.size === 2 && values.has('on') && values.has('off')) matches.push(key);
        }
        if (matches.length === 1) return matches[0];
        if (matches.length > 1) return null;
        const tokens = (variants || []).map((variant) => {
          const raw = String(nameOf(variant) || '').trim();
          const values = Object.values(dropmenuParsePairs(raw));
          if (values.length === 1) return values[0];
          if (raw === 'on' || raw === 'off') return raw;
          return null;
        });
        const unique = [...new Set(tokens)];
        return unique.length === 2 && unique.includes('on') && unique.includes('off') && !unique.includes(null)
          ? '*'
          : null;
      };
      const dropmenuExactState = (n) => {
        attachPlatformVariantGraph(n);
        const graph = n && n.componentVariantGraph;
        const variants = Array.isArray(graph && graph.variants) ? graph.variants : [];
        const axis = dropmenuAxisName(variants, (variant) => __u(variant && variant.name));
        if (!axis) return 'invalid';
        const props = dropmenuPropertyMap(n);
        if (axis !== '*' && Object.prototype.hasOwnProperty.call(props, axis)) {
          const current = props[axis];
          return current === 'on' || current === 'off' ? current : 'invalid';
        }
        if (axis === '*') {
          const onOff = Object.entries(props).filter(([, current]) => current === 'on' || current === 'off');
          if (onOff.length === 1) return onOff[0][1];
        }
        return 'invalid';
      };
      const dropmenuOnOffTokens = (variants, nameOf) => Boolean(dropmenuAxisName(variants, nameOf));
      const dropmenuVariantToken = (name, axis) => {
        const raw = String(name || '').trim();
        const pairs = dropmenuParsePairs(raw);
        if (axis && axis !== '*' && Object.prototype.hasOwnProperty.call(pairs, axis)) return pairs[axis];
        const values = Object.values(pairs);
        if (values.length === 1) return values[0];
        if (raw === 'on' || raw === 'off') return raw;
        return '';
      };
      /* Main Skill interaction bridge: derive evidence attributes from the
         source-backed owner path/name contract. No page IDs or selectors. */
      const interactionBridge = (items) => {
        const value = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
        const id = (n) => String(value(n && n.id));
        const parse = (n) => {
          const raw = String(value(n && n.name) || '');
          const m = /^([A-Za-z]+)\s*[\/／]\s*([^@]*)(.*)$/.exec(raw);
          const role = m ? m[1].toLowerCase() : null;
          const label = m ? String(m[2] || '').trim() : '';
          const params = {};
          if (m) for (const part of m[3].split('@').slice(1)) {
            const eq = part.indexOf('='); if (eq > 0) params[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
          }
          return { role, label, params };
        };
        const byId = new Map(items.map((n) => [id(n), n]));
        /* Fixed overlay roots are rendered in the page stage, while their
           truth-backed descendants can legitimately live in the section
           table (the ready handoff preserves the source paint ownership this
           way).  Navigation owner lookup must therefore consult the explicit
           fixedOverlays scope as well as this section-local table.  This only
           resolves an existing owner; it never promotes skipped structure or
           invents a navigation node. */
        const fixedOverlayNodes = Array.isArray(__activeTruth.fixedOverlays?.nodes)
          ? __activeTruth.fixedOverlays.nodes
          : Object.values(__activeTruth.fixedOverlays?.nodes || {});
        const fixedById = new Map(fixedOverlayNodes.map((n) => [id(n), n]));
        const parentId = (n) => String(value(n && n.parentId) || '');
        const boxXw = (raw) => {
          const box = __plain(raw && raw.box || {});
          const x = Number(box.x), w = Number(box.w);
          return Number.isFinite(x) && Number.isFinite(w) && w > 0 ? { x, w, right: x + w } : null;
        };
        const childOverflowsHost = (child, host) => {
          const box = boxXw(child);
          return !!(box && (box.x < host.x - 0.5 || box.right > host.right + 0.5));
        };
        const hscrollAxis = (node, parsed) => {
          const namedScroll = parsed.role === 'scroll';
          const calendarMix = parsed.role === 'mix' && /^(?:calendar|日历)$/i.test(String(parsed.label || ''));
          const clipHost = value(node && node.clipsContent) === true;
          if ((!namedScroll && !calendarMix) || !clipHost) return null;
          const host = boxXw(node);
          if (!host) return null;
          const overflows = items.some((candidate) => parentId(candidate) === id(node) && childOverflowsHost(candidate, host));
          if (!overflows) return null;
          /* Named scroll/ is the explicit host. Calendar mix is the one
             product window whose overflowing child must translate without
             turning the mix itself into native overflow-x. A random
             clipsContent frame is not a host. */
          return parsed.params.axis || 'x';
        };
        const calendarNowLabel = (node, parsed) => parsed.role === 'dyn'
          && /今日日期|today\s*date|current\s*date/i.test(String(parsed.label || ''));
        const hscrollCommand = (node) => {
          const label = String(value(node && node.name) || '').toLowerCase();
          if (/\bprev(?:ious)?\b|\bleft\b|上一|左划|左滑|左滑动/.test(label)) return 'prev';
          if (/\bnext\b|\bright\b|下一|右划|右滑|右滑动/.test(label)) return 'next';
          return null;
        };
        const nearestHscrollId = (node) => {
          let current = node;
          for (let guard = 0; guard < 12 && current; guard++) {
            const pid = parentId(current);
            if (!pid) break;
            const parentNode = byId.get(pid);
            if (!parentNode) break;
            if (hscrollAxis(parentNode, parse(parentNode))) return pid;
            current = parentNode;
          }
          const pid = parentId(node);
          if (!pid) return null;
          const siblings = items.filter((candidate) => parentId(candidate) === pid && hscrollAxis(candidate, parse(candidate)));
          return siblings.length === 1 ? id(siblings[0]) : null;
        };
        const propertyValues = (raw, out = []) => {
          const v = value(raw);
          if (v == null) return out;
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') { out.push(String(v)); return out; }
          if (Array.isArray(v)) { for (const item of v) propertyValues(item, out); return out; }
          if (typeof v === 'object') { for (const item of Object.values(v)) propertyValues(item, out); }
          return out;
        };
        const indicatorVariant = (n) => {
          const values = propertyValues(n && (n.componentProperties || n.properties || n.prototype?.componentProperties));
          if (values.some((v) => /^(disabled?|disable|unavailable)$/i.test(v))) return 'disabled';
          if (values.some((v) => /^(active|selected|highlight|current|on)$/i.test(v))) return 'active';
          if (values.some((v) => /^(normal|inactive|default|off)$/i.test(v))) return 'normal';
          return null;
        };
        const componentVariantGraph = (n) => {
          attachPlatformVariantGraph(n);
          const graph = n && n.componentVariantGraph;
          const variants = Array.isArray(graph && graph.variants) ? graph.variants : [];
          const trees = Array.isArray(graph && graph.variantTrees) ? graph.variantTrees : [];
          /* An alternate state can be rendered only if this exact snapshot
             retained every direct component variant and every corresponding
             render tree. A control count alone is never a substitute. */
          if (variants.length < 2 || trees.length !== variants.length) {
            if (n) n.__componentVariantGraphBlock = `variant-count:${variants.length}/${trees.length}`;
            return null;
          }
          if (!trees.every((tree, index) => String(value(tree && tree.componentId)) === String(value(variants[index] && variants[index].componentId))
            && Array.isArray(tree && tree.nodes) && tree.nodes.length)) {
            if (n) n.__componentVariantGraphBlock = 'variant-tree-mismatch';
            return null;
          }
          const ownerBox = __plain(n && n.box || {});
          const ownerW = Number(ownerBox.w), ownerH = Number(ownerBox.h);
          if (!Number.isFinite(ownerW) || !Number.isFinite(ownerH)) {
            if (n) n.__componentVariantGraphBlock = 'owner-box-missing';
            return null;
          }
          const selectedId = String(__u(n && n.componentId) || '');
          const treeBox = (tree) => {
            const root = asArr(tree && tree.nodes).find((node) => String(__u(node && node.id)) === String(__u(tree && tree.componentId)));
            return __plain((root && root.box) || (tree && tree.box) || {});
          };
          const selected = trees.find((tree) => String(__u(tree && tree.componentId) || '') === selectedId);
          const selectedBox = treeBox(selected);
          if (!selected || Math.abs(Number(selectedBox.w) - ownerW) > 0.5 || Math.abs(Number(selectedBox.h) - ownerH) > 0.5) {
            if (n) n.__componentVariantGraphBlock = 'variant-owner-extent-mismatch';
            return null;
          }
          const widthMismatch = trees.some((tree) => {
            const box = treeBox(tree);
            const w = Number(box.w), h = Number(box.h);
            return !Number.isFinite(w) || !Number.isFinite(h) || Math.abs(w - ownerW) > 0.5;
          });
          if (widthMismatch) {
            if (n) n.__componentVariantGraphBlock = 'variant-owner-width-mismatch';
            return null;
          }
          return { variants, trees };
        };
        const ownerSwitch = (n) => {
          const path = Array.isArray(value(n && n.ownerPath)) ? value(n.ownerPath) : [];
          for (let i = path.length - 2; i >= 0; i--) {
            const owner = byId.get(String(value(path[i])));
            if (owner && parse(owner).role === 'switch') return id(owner);
          }
          /* Components such as tab/* and ind/* are often siblings of the
             switch owner rather than descendants. Walk the source parent
             chain and resolve a switch sibling by parentId. */
          let cur = n;
          for (let guard = 0; guard < 12 && cur; guard++) {
            const pid = parentId(cur);
            if (!pid) break;
            const sibling = items.find((candidate) => parentId(candidate) === pid && parse(candidate).role === 'switch');
            if (sibling) return id(sibling);
            cur = byId.get(pid);
          }
          /* Directional commands can sit beside a switch under the same
             section owner rather than below the switch itself. Resolve that
             only when the closest shared owner path has exactly one switch
             with a complete component-set graph; ties remain inert. */
          const label = String(value(n && n.name) || '').toLowerCase();
          if (/\b(prev(?:ious)?|next|left|right)\b|上一|下一|左划|右划|左滑|右滑|左滑动|右滑动/.test(label)) {
            const currentPath = path.map((entry) => String(value(entry)));
            const candidates = items.filter((candidate) => parse(candidate).role === 'switch'
              && componentVariantGraph(candidate)).map((candidate) => {
              const candidatePathRaw = value(candidate && candidate.ownerPath);
              const candidatePath = Array.isArray(candidatePathRaw) ? candidatePathRaw.map((entry) => String(value(entry))) : [];
              let common = 0;
              while (common < currentPath.length && common < candidatePath.length
                && currentPath[common] === candidatePath[common]) common++;
              return { candidate, common };
            }).filter(({ common }) => common > 0);
            const maxCommon = Math.max(0, ...candidates.map(({ common }) => common));
            const best = candidates.filter(({ common }) => common === maxCommon);
            if (best.length === 1) return id(best[0].candidate);
          }
          return null;
        };
        const ownerFixed = (n) => {
          const path = Array.isArray(value(n && n.ownerPath)) ? value(n.ownerPath) : [];
          for (let i = path.length - 2; i >= 0; i--) {
            const owner = byId.get(String(value(path[i])));
            if (owner && parse(owner).role === 'fix') return id(owner);
          }
          /* Some ready consumers flatten fixed component descendants into the
             page-shared table and omit the fixed owner from ownerPath.  The
             source ancestor chain still carries the explicit fix/ owner role;
             resolve it from ancestorIds only, never from a guessed display name. */
          const ancestorIds = Array.isArray(n && n.ancestorIds) ? n.ancestorIds.map((x) => String(value(x))) : [];
          const ancestorFix = ancestorIds.map((ancestor) => byId.get(ancestor) || fixedById.get(ancestor))
            .find((candidate) => candidate && parse(candidate).role === 'fix');
          if (ancestorFix) return id(ancestorFix);
          return null;
        };
        const ancestorRole = (n, role) => {
          const path = Array.isArray(n && n.ownerPath) ? n.ownerPath : [];
          for (let i = path.length - 2; i >= 0; i--) {
            const owner = byId.get(String(value(path[i])));
            if (owner && parse(owner).role === role) return id(owner);
          }
          let cur = n;
          for (let guard = 0; guard < 12 && cur; guard++) {
            const pid = parentId(cur);
            if (!pid) break;
            const owner = byId.get(pid);
            if (owner && parse(owner).role === role) return id(owner);
            cur = owner;
          }
          return null;
        };
        const componentVariantControlFamily = ({ n, p }) => {
          const state = indicatorVariant(n);
          if (state !== 'active' && state !== 'normal') return null;
          /* A component-set controller can have several visual affordance
             families near the same owner.  Only one complete source-backed
             family may map to component variants.  In particular, arrow
             buttons are commands, never page entries; thumbnail buttons are
             selectable only when their tab owner proves that lineage. */
          if (p.role === 'ind') return 'ind:' + parentId(n);
          if (p.role === 'tab') return 'tab:' + parentId(n);
          if (p.role === 'btn') {
            const tabOwner = ancestorRole(n, 'tab');
            return tabOwner ? 'tab-button:' + tabOwner : null;
          }
          return null;
        };
        /* Generic owner-based redeem-code copy: a `btn/…` whose button label
           text node carries the copy semantics and whose sibling (within the
           nearest shared owner that contains both) is a TEXT holding the code.
           This is a naming-hint heuristic, NOT a Figma prototype action — the
           source exposes no reactions/interactions, so the bridge marks the
           result data-action-source="naming-hint" and never invents behavior
           when the code sibling cannot be resolved. */
        const textOf = (n) => String(value(n && n.text && n.text.characters) || '');
        const isCodeText = (n) => {
          if (String(value(n && n.type) || '') !== 'TEXT') return false;
          const t = textOf(n).trim();
          if (!t || t.length < 4 || t.length > 64) return false;
          if (/[\u4e00-\u9fff]/.test(t)) return false;                 // CJK = label, not code
          if (/\s/.test(t)) return false;                              // codes have no spaces
          return /^[A-Za-z0-9][A-Za-z0-9_\-]*$/.test(t);               // token-like
        };
        /* The copy affordance is the TEXT node carrying the copy/复制 label,
           nested under a `btn/*` owner. The owner may be a passthrough container
           that never renders its own element, so the interaction anchors on the
           rendered TEXT leaf, not the (possibly absent) owner element. We then
           climb owners to find the sibling code TEXT inside the nearest shared
           owner (the redeem-code group). */
        /* Ancestor owners (btn/兑换码按钮, 兑换码, …) are passthrough containers that
           never appear as truth items, so byId lookups on them miss. Their names
           ARE captured in ancestorNames (parallel to ancestorTypes/ownerPath), and
           ids carry the Figma name prefix only in ancestorNames — so derive a
           role prefix directly from the ancestor-name list. */
        const ancestorNamesOf = (n) => {
          const raw = value(n && n.ancestorNames);
          return Array.isArray(raw) ? raw.map((x) => String(value(x))) : [];
        };
        const roleOfName = (nm) => {
          const m = /^([A-Za-z]+)\s*\//.exec(String(nm || ''));
          return m ? m[1].toLowerCase() : null;
        };
        const copyBtnInfo = (n, p) => {
          if (String(value(n && n.type) || '') !== 'TEXT') return null;
          const label = textOf(n).trim();
          if (!/复制|拷贝|copy/i.test(label)) return null;
          /* btn/* owner is a passthrough container absent from items — confirm it
             via the ancestor-name list instead of a byId lookup. */
          if (!ancestorNamesOf(n).some((nm) => roleOfName(nm) === 'btn')) return null;
          /* The redeem-code owner (兑换码) is a passthrough container absent from
             truth items, so the parentId/byId chain is broken above the button.
             Instead pair by the shared owner-name prefix: the copy leaf and the
             code leaf share every ancestor name up to and including the redeem
             owner (… / 兑换码 / …), differing only below it. Match on that name
             lineage — no node-id or copy-text hardcoding. */
          const myAnc = ancestorNamesOf(n);
          const btnDepth = myAnc.findIndex((nm) => roleOfName(nm) === 'btn');
          if (btnDepth < 0) return null;
          const sharedPrefix = myAnc.slice(0, btnDepth);   // owners above the btn/*
          let best = null;
          for (const cand of items) {
            if (id(cand) === id(n) || !isCodeText(cand)) continue;
            const ca = ancestorNamesOf(cand);
            if (ca.length < sharedPrefix.length) continue;
            let common = 0;
            while (common < sharedPrefix.length && ca[common] === sharedPrefix[common]) common++;
            if (common === sharedPrefix.length) {
              /* code must not itself sit under a btn/* (that would be another button) */
              if (ca.some((nm) => roleOfName(nm) === 'btn')) continue;
              if (!best || common > best.common) best = { cand, common };
            }
          }
          if (best) return { codeId: id(best.cand), codeText: textOf(best.cand).trim() };
          return null;
        };
        /* Owner-prefix sibling match shared by interaction checks: candidates share
           every ancestor-name above `n`'s btn/* owner and are not themselves buttons. */
        const ownerPrefixSibling = (n, pred) => {
          const myAnc = ancestorNamesOf(n);
          const btnDepth = myAnc.findIndex((nm) => roleOfName(nm) === 'btn');
          if (btnDepth < 0) return null;
          const sharedPrefix = myAnc.slice(0, btnDepth);
          for (const cand of items) {
            if (id(cand) === id(n) || !pred(cand)) continue;
            const ca = ancestorNamesOf(cand);
            if (ca.length < sharedPrefix.length) continue;
            let common = 0;
            while (common < sharedPrefix.length && ca[common] === sharedPrefix[common]) common++;
            if (common === sharedPrefix.length && !ca.some((nm) => roleOfName(nm) === 'btn')) return cand;
          }
          return null;
        };
        const out = new Map();
        const groups = new Map();
        for (const n of items) {
          const p = parse(n); const switchId = p.role === 'switch' ? id(n) : ownerSwitch(n);
          if (switchId && ['switch', 'swpage', 'tab', 'ind', 'btn'].includes(p.role)) {
            if (!groups.has(switchId)) groups.set(switchId, []);
            groups.get(switchId).push({ n, p });
          }
        }
        /* A source snapshot may already expose the selected component variant.
           Capture that as the initial DOM state, rather than assuming a page
           index from a name or a screenshot position. If no selected variant
           exists, page/source order is only a resting state (not permission to
           fabricate sibling pages). */
        const switchDefault = new Map();
        const componentVariantSwitches = new Map();
        for (const [switchId, members] of groups) {
          const owner = members.find((entry) => entry.p.role === 'switch');
          const graph = owner && componentVariantGraph(owner.n);
          if (!graph) {
            if (owner && owner.n && !owner.n.__componentVariantGraphBlock) {
              owner.n.__componentVariantGraphBlock = 'incomplete-variant-tree-evidence';
            }
            continue;
          }
          const families = new Map();
          for (const entry of members) {
            const family = componentVariantControlFamily(entry);
            if (!family) continue;
            if (!families.has(family)) families.set(family, []);
            families.get(family).push(entry);
          }
          const completeFamilies = [...families.values()].filter((controls) => controls.length === graph.variants.length
            && controls.filter(({ n }) => indicatorVariant(n) === 'active').length === 1);
          /* More than one complete family is ambiguous (for example tabs and
             indicators that have not been explicitly paired), so it remains
             inert instead of borrowing positional order across families. */
          if (completeFamilies.length !== 1) {
            const ownerEntry = owner;
            if (ownerEntry && ownerEntry.n) {
              ownerEntry.n.__componentVariantGraphBlock = completeFamilies.length === 0
                ? 'missing-complete-control-family' : 'ambiguous-complete-control-families';
            }
            continue;
          }
          const selectable = completeFamilies[0];
          const selectedComponentId = String(value(owner.n && owner.n.componentId) || '');
          const selectedIndex = graph.variants.findIndex((variant) => String(value(variant && variant.componentId)) === selectedComponentId);
          if (selectedIndex < 0) continue;
          componentVariantSwitches.set(switchId, {
            graph,
            initialIndex: selectedIndex,
            controls: new Map(selectable.map((entry, index) => [id(entry.n), index])),
          });
        }
        const memberIndex = (switchId, role, node) => (groups.get(switchId) || [])
          .filter((entry) => entry.p.role === role)
          .findIndex((entry) => id(entry.n) === id(node));
        for (const [switchId, members] of groups) {
          const componentVariant = componentVariantSwitches.get(switchId);
          let index = componentVariant ? componentVariant.initialIndex : 0;
          let evidence = componentVariant ? 'instance-componentId-in-component-set-order' : 'source-order-resting-state';
          for (const role of ['tab', 'ind']) {
            const active = members.filter((entry) => entry.p.role === role)
              .find((entry) => indicatorVariant(entry.n) === 'active');
            if (active) {
              index = memberIndex(switchId, role, active.n);
              evidence = 'component-property-active-variant';
              break;
            }
          }
          switchDefault.set(switchId, { index: Math.max(0, index), evidence });
        }
        for (const n of items) {
          const p = parse(n); const attrs = {};
          const target = p.params.target || p.params.sec || p.params.section || p.params.to || p.params.dest;
          if (target) attrs['data-sec-target'] = target;
          if (p.params.link) attrs['data-link'] = String(p.params.link);
          if (p.params.go) attrs['data-go'] = String(p.params.go);
          let switchId = p.role === 'switch' ? id(n) : ownerSwitch(n);
          if (p.role === 'btn' && switchId) {
            const label = String(value(n && n.name) || '').toLowerCase();
            const directional = /\bprev(?:ious)?\b|\bleft\b|\bnext\b|\bright\b|上一|下一|左划|右划|左滑|右滑|左滑动|右滑动/.test(label);
            if (!directional) switchId = null;
          }
          if (switchId) attrs['data-switch'] = switchId;
          const componentVariant = switchId && componentVariantSwitches.get(switchId);
          const componentVariantIndex = componentVariant && componentVariant.controls.get(id(n));
          const staticSelectable = (p.role === 'tab' || p.role === 'ind') && !componentVariant;
          if (switchId && (p.role === 'swpage' || staticSelectable || componentVariantIndex != null)) {
            /* Commands are deliberately excluded: prev/next operate on the
               active index and are not extra pages in the switch graph. */
            const same = (groups.get(switchId) || []).filter((x) => x.p.role === p.role);
            const idx = componentVariantIndex != null ? componentVariantIndex : same.findIndex((x) => id(x.n) === id(n));
            if (idx >= 0) attrs['data-swpage'] = String(idx);
          }
          if (p.role === 'switch') {
            const initial = switchDefault.get(switchId) || { index: 0, evidence: 'source-order-resting-state' };
            attrs['data-switch-owner'] = 'true';
            attrs['data-switch-index'] = String(initial.index);
            attrs['data-switch-initial-index'] = String(initial.index);
            attrs['data-switch-default-evidence'] = initial.evidence;
            if (n.__componentVariantGraphBlock) attrs['data-switch-graph-block-reason'] = n.__componentVariantGraphBlock;
            if (componentVariant) {
              attrs['data-switch-page-source'] = 'component-set-variant';
              attrs['data-switch-transition'] = 'immediate';
              attrs['data-switch-variant-count'] = String(componentVariant.graph.variants.length);
            } else {
              attrs['data-motion-carousel'] = 'true';
              attrs['data-motion-carousel-index'] = String(initial.index);
            }
            attrs['data-switch-loop'] = 'true';
          }
          if (switchId && p.role === 'btn') {
            const label = String(value(n && n.name) || '').toLowerCase();
            if (/\bprev(?:ious)?\b|\bleft\b|上一|左划|左滑|左滑动/.test(label)) attrs['data-switch-action'] = 'prev';
            else if (/\bnext\b|\bright\b|下一|右划|右滑|右滑动/.test(label)) attrs['data-switch-action'] = 'next';
          }
          if (p.role === 'btn' && !attrs['data-switch-action']) {
            const command = hscrollCommand(n);
            const hostId = command ? nearestHscrollId(n) : null;
            if (command && hostId) {
              attrs['data-hscroll-host'] = hostId;
              attrs['data-hscroll-action'] = command;
            }
          }
          if (calendarNowLabel(n, p)) {
            attrs['data-calendar-now'] = 'true';
            attrs['data-calendar-now-state'] = 'today';
            attrs['data-calendar-now-evidence'] = 'dyn-today-date-runtime-swap';
            attrs['data-btn-press'] = 'inert';
          }
          /* Independent btn/ with a real normal+highlight COMPONENT_SET is not a
             missing switch. Directory `btn/导航状态` is that family. Static still
             owns 切换按钮 / 角色头像 and draw-only controls. */
          if (p.role === 'dropmenu') {
            const menuState = dropmenuExactState(n);
            attrs['data-dropmenu'] = 'true';
            attrs['data-dropmenu-state'] = menuState;
            if (menuState === 'invalid') {
              attrs['data-dropmenu-invalid'] = 'true';
              attrs['data-btn-press'] = 'inert';
              attrs['aria-disabled'] = 'true';
            } else {
              attachPlatformVariantGraph(n);
              const graph = n && n.componentVariantGraph;
              const variants = Array.isArray(graph && graph.variants) ? graph.variants : [];
              if (dropmenuOnOffTokens(variants, (variant) => value(variant && variant.name))) {
                attrs['data-dropmenu-set'] = String(value(graph.componentSetId) || '');
              }
            }
          }
          if (p.role === 'btn' && !switchId && !attrs['data-switch-action']) {
            const btnLabel = String(value(n && n.name) || '').replace(/^btn\s*[\/／]\s*/i, '').split('@')[0].trim();
            const staticOwned = /^(切换按钮|角色头像|下载按钮|充值按钮|官网按钮|播放按钮|关闭按钮|兑换码按钮|复制按钮|更多按钮)$/.test(btnLabel);
            attachPlatformVariantGraph(n);
            const graph = n && n.componentVariantGraph;
            const variants = Array.isArray(graph && graph.variants) ? graph.variants : [];
            const trees = Array.isArray(graph && graph.variantTrees) ? graph.variantTrees : [];
            const names = variants.map((variant) => String(value(variant && variant.name) || '').toLowerCase());
            const hasNormal = names.some((name) => /(^|[=\s])normal(\b|$)/.test(name));
            const hasHighlight = names.some((name) => /(^|[=\s])highlight(\b|$)/.test(name));
            const state = indicatorVariant(n);
            const selectedId = String(value(n && n.componentId) || '');
            const selectedName = String(value((variants.find((variant) => String(value(variant && variant.componentId)) === selectedId) || {}).name) || '').toLowerCase();
            if (!staticOwned && hasNormal && hasHighlight && trees.length === variants.length && variants.length >= 2
              && state !== 'disabled' && !/disable/.test(selectedName)) {
              attrs['data-btn-variant'] = 'true';
              attrs['data-btn-variant-set'] = String(value(graph.componentSetId) || '');
              attrs['data-btn-variant-state'] = state === 'active' || /highlight/.test(selectedName) ? 'highlight' : 'normal';
              attrs['data-btn-variant-component'] = selectedId;
              attrs['data-btn-variant-group'] = parentId(n) || id(n);
            }
          }
          if ((staticSelectable && p.role === 'tab' || (componentVariantIndex != null && p.role !== 'ind')) && switchId) {
            attrs['data-tab'] = 'true';
            const variant = indicatorVariant(n);
            if (variant) attrs['data-switch-variant'] = variant;
          }
          if ((staticSelectable && p.role === 'ind' || (componentVariantIndex != null && p.role === 'ind')) && switchId) {
            attrs['data-indicator'] = 'true';
            const variant = indicatorVariant(n);
            if (variant) {
              attrs['data-indicator-variant'] = variant;
              attrs['data-switch-variant'] = variant;
            }
          }
          /* A fixed navigation item is only targetable later if its complete
             source-ordered set can be paired 1:1 with page sections. */
          const fixedOwner = p.role === 'btn' ? ownerFixed(n) : null;
          if (fixedOwner) {
            attrs['data-nav-item'] = 'true';
            attrs['data-nav-owner'] = fixedOwner;
            const variant = indicatorVariant(n);
            if (variant) attrs['data-nav-variant'] = variant;
          } else if (p.role === 'fix') {
            /* The sticky rail must stay visually above content, but its empty
               box must not swallow sibling switch arrows. Only explicit nav
               items re-enable pointer targeting. @from=N is scroll-gated pin,
               not a stretch rule. */
            attrs['data-nav-shell'] = 'true';
            attrs['data-fix-pin'] = 'viewport';
            const fromRaw = p.params.from;
            if (fromRaw != null && /^[1-9]\d*$/.test(String(fromRaw))) attrs['data-fix-from'] = String(fromRaw);
          }
          if (switchId && p.role === 'swpage') {
            attrs['data-motion-carousel-page'] = 'true';
            attrs['data-motion-carousel-index'] = attrs['data-swpage'];
          }
          if (switchId && (staticSelectable && p.role === 'tab' || (componentVariantIndex != null && p.role !== 'ind'))) {
            attrs['data-motion-carousel-tab'] = 'true';
            attrs['data-motion-carousel-index'] = attrs['data-swpage'];
          }
          if (switchId && (staticSelectable && p.role === 'ind' || (componentVariantIndex != null && p.role === 'ind'))) {
            attrs['data-motion-carousel-indicator'] = 'true';
            attrs['data-motion-carousel-index'] = attrs['data-swpage'];
          }
          if (switchId && p.role === 'btn' && attrs['data-switch-action']) {
            attrs['data-motion-carousel-' + attrs['data-switch-action']] = 'true';
            attrs['data-switch-command'] = 'true';
          }
          const copyInfo = copyBtnInfo(n, p);
          if (copyInfo) {
            attrs['data-copy-code'] = copyInfo.codeId;
            attrs['data-action-source'] = 'naming-hint';
          } else if (isCodeText(n)) {
            /* Expose token-like code strings so the copy fallback can surface the
               exact redeem text without hardcoding node ids or copy values. */
            attrs['data-code-text'] = 'true';
          }
          /* Only a source-labelled swpage can be a rendered page. Direct
             descendants such as artwork, labels, and button bodies are not a
             carousel graph; tagging them as page=-1 hid real content on click.
             A missing swpage stays state-only rather than becoming a fake
             sliding carousel. */
          if (switchId && p.role === 'swpage' && attrs['data-swpage'] != null) {
            attrs['data-switch-page'] = attrs['data-swpage'];
          }
          if (switchId && (staticSelectable || componentVariantIndex != null) && attrs['data-swpage'] != null) {
            const active = Number(attrs['data-swpage']) === (switchDefault.get(switchId)?.index || 0);
            attrs['aria-selected'] = active ? 'true' : 'false';
            if (active) attrs['data-active'] = 'true';
          }
          const axis = hscrollAxis(n, p);
          if (axis) {
            attrs['data-hscroll'] = axis;
            attrs['data-hscroll-pointer'] = 'true';
            attrs['data-hscroll-drag'] = 'true';
            attrs['data-hscroll-evidence'] = 'source-clip-and-child-geometry-overflow';
            const hostBox = boxXw(n);
            if (hostBox) {
              for (const child of items.filter((candidate) => parentId(candidate) === id(n))) {
                if (!childOverflowsHost(child, hostBox)) continue;
                const childId = id(child);
                const childAttrs = out.get(childId) || {};
                childAttrs['data-hscroll-overflow-child'] = 'true';
                out.set(childId, childAttrs);
              }
            }
            if (axis === 'x') {
              const hostBox = __plain(n && n.box || {});
              const hx = Number(hostBox.x), hy = Number(hostBox.y);
              const hw = Number(hostBox.w), hh = Number(hostBox.h);
              if (Number.isFinite(hx) && Number.isFinite(hy) && hw > 0 && hh > 0) {
                let gTop = 0, gBottom = 0, gLeft = 0, gRight = 0;
                for (const track of items.filter((c) => parentId(c) === id(n))) {
                  for (const child of items.filter((c) => parentId(c) === id(track))) {
                    const childStyle = __plain(child && child.style || {});
                    const childEffects = (Array.isArray(childStyle.effects) ? childStyle.effects : [])
                      .map((e) => __plain(e));
                    if (!childEffects.some((e) => e && e.type === 'DROP_SHADOW' && e.visible !== false)) continue;
                    const childRb = __plain(child && child.renderBox || {});
                    const rx = Number(childRb.x), ry = Number(childRb.y);
                    const rw = Number(childRb.w), rh = Number(childRb.h);
                    if (![rx, ry, rw, rh].every(Number.isFinite) || rw <= 0 || rh <= 0) continue;
                    gTop = Math.max(gTop, hy - ry);
                    gBottom = Math.max(gBottom, ry + rh - (hy + hh));
                    gLeft = Math.max(gLeft, hx - rx);
                    gRight = Math.max(gRight, rx + rw - (hx + hw));
                  }
                }
                /* Source renderBoxes are captured already clipped at the
                   viewport, so a child whose shadow reaches the host edge
                   reports zero bleed there. Figma's real shadow extent is
                   |offset| + radius from the content edge. Derive the
                   cross-axis gutter from the effect itself, capped by what
                   the captured renderBox allows on each side; never invent
                   main-axis gutter. */
                const crossMax = { top: 0, bottom: 0 };
                for (const track of items.filter((c) => parentId(c) === id(n))) {
                  for (const child of items.filter((c) => parentId(c) === id(track))) {
                    const childStyle = __plain(child && child.style || {});
                    const childEffects = (Array.isArray(childStyle.effects) ? childStyle.effects : [])
                      .map((e) => __plain(e));
                    const shadow = childEffects.find((e) => e && e.type === 'DROP_SHADOW' && e.visible !== false);
                    if (!shadow) continue;
                    const radius = Math.max(0, Number(shadow.radius) || 0);
                    const offY = Number(shadow.offset && shadow.offset.y) || 0;
                    const offX = Number(shadow.offset && shadow.offset.x) || 0;
                    const needT = Math.max(0, radius - offY);
                    const needB = Math.max(0, radius + offY);
                    const childBox = __plain(child && child.box || {});
                    const childTop = Number(childBox.y), childH = Number(childBox.h);
                    if (!Number.isFinite(childTop) || !Number.isFinite(childH)) continue;
                    const roomTop = Math.max(0, childTop - hy);
                    const roomBottom = Math.max(0, (hy + hh) - (childTop + childH));
                    /* A shadow clipped to zero room on a side is exactly the
                       bug this gutter repairs; grant the full need there.
                       Positive room means the shadow already fits; only top
                       up the difference. */
                    if (roomTop < needT) crossMax.top = Math.max(crossMax.top, needT);
                    if (roomBottom < needB) crossMax.bottom = Math.max(crossMax.bottom, needB);
                    if (offX !== 0) {
                      const roomLeft = Math.max(0, Number(childBox.x) - hx);
                      const roomRight = Math.max(0, (hx + hw) - (Number(childBox.x) + Number(childBox.w)));
                      const needL = Math.max(0, radius - offX);
                      const needR = Math.max(0, radius + offX);
                      if (roomLeft < needL) gLeft = Math.max(gLeft, needL);
                      if (roomRight < needR) gRight = Math.max(gRight, needR);
                    }
                  }
                }
                gTop = Math.max(gTop, crossMax.top);
                gBottom = Math.max(gBottom, crossMax.bottom);
                if (gTop > 0.5 || gBottom > 0.5 || gLeft > 0.5 || gRight > 0.5) {
                  attrs['data-hscroll-shadow-gutter'] = [gTop, gRight, gBottom, gLeft]
                    .map((v) => String(Math.max(0, Math.ceil(v * 100) / 100))).join(' ');
                }
              }
            }
          }
          const pressable = p.role === 'btn' || p.role === 'tab' || p.role === 'ind' || p.role === 'hot'
            || p.role === 'dropmenu'
            || attrs['data-sec-target'] != null
            || attrs['data-switch-action'] != null
            || attrs['data-hscroll-action'] != null
            || attrs['data-copy-code'] != null
            || attrs['data-nav-item'] === 'true'
            || attrs['data-btn-variant'] === 'true'
            || attrs['data-calendar-now-state'] === 'return-today';
          const disabledPress = (p.role === 'dropmenu'
            ? attrs['data-dropmenu-state'] === 'invalid'
            : indicatorVariant(n) === 'disabled')
            || /disable/i.test(String(attrs['data-btn-variant-state'] || ''));
          if (attrs['data-calendar-now'] === 'true' && attrs['data-calendar-now-state'] !== 'return-today') {
            attrs['data-btn-press'] = 'inert';
          } else if (pressable && disabledPress) {
            attrs['data-btn-press'] = 'inert';
            attrs['aria-disabled'] = 'true';
          } else if (pressable) {
            attrs['data-btn-press'] = 'true';
            attrs.role = attrs.role || 'button';
            attrs.tabindex = attrs.tabindex || '0';
            if (p.role === 'btn' && !attrs['data-link'] && !attrs['data-go'] && !attrs['data-sec-target']
              && !attrs['data-switch-action'] && !attrs['data-hscroll-action'] && !attrs['data-copy-code']
              && !attrs['data-btn-variant'] && !attrs['data-nav-item'] && !attrs['data-tab']
              && attrs['data-calendar-now-state'] !== 'return-today') {
              attrs['data-btn-action'] = 'unresolved';
            }
          }
          if (Object.keys(attrs).length) out.set(id(n), attrs);
        }
        return out;
      };
      /* Semantic evidence is derived from truth ancestry, never from page IDs.
         Names remain hints; owner/clip/paint structure is still consumed from
         the original node fields. Keeping this helper local makes the same
         renderer usable for any Figma page and lets Chrome audit the context
         actually attached to each text element. */
      const textContext = (n) => {
        const ancestors = Array.isArray(n.ancestorNames) ? n.ancestorNames.filter(Boolean).map(String) : [];
        const explicit = String(n.textRole || n.role || '').trim().toLowerCase();
        const haystack = [n.name, ...ancestors].filter(Boolean).join(' ').toLowerCase();
        let role = ['nav', 'activity-calendar', 'heading-content-card', 'character-skill-label', 'unknown'].includes(explicit)
          ? explicit : 'unknown';
        /* Component-owned labels prefer their immediate structural owner over
           broad section words. A heading inside a switch/card remains a card
           heading even when the section is named activity/content. */
        if (role === 'unknown' && /character|operator|skill|ability|label|tag|role|hero|unit|\u89d2\u8272|\u6280\u80fd|\u6807\u7b7e|\u79f0\u53f7/.test(haystack)) role = 'character-skill-label';
        else if (role === 'unknown' && /heading|title|headline|content|card|panel|tile|\u6807\u9898|\u5185\u5bb9|\u5361\u7247|\u9762\u677f|\u65b0\u624b|\u4f53\u9a8c/.test(haystack)) role = 'heading-content-card';
        else if (role === 'unknown' && /nav|menu|sidebar|directory|\u5bfc\u822a|\u76ee\u5f55|\u83dc\u5355|\u4fa7\u680f|\u5de6\u4fa7/.test(haystack)) role = 'nav';
        else if (role === 'unknown' && /calendar|schedule|date|month|day|time|\u65e5\u5386|\u65e5\u671f|\u65f6\u95f4|\u65e5\u7a0b/.test(haystack)
          && !/\u6d3b\u52a8\u5185\u5bb9|\u65b0\u624b|\u4f53\u9a8c|content|event content/.test(haystack)) role = 'activity-calendar';
        const scene = role === 'nav' ? 'nav' : role === 'activity-calendar' ? 'activity' : 'content';
        return { role, scene, ancestors, contextKey: [scene, ...ancestors].join('/') || scene };
      };
      const compactHugLabelEvidence = ({ role, align, autoResize, ownerNode, ownerBox, directOwner, sourceBox }) => {
        const layout = ownerNode?.layout || {};
        const horizontal = String(__u(layout.layoutSizingHorizontal) || '').toUpperCase();
        const vertical = String(__u(layout.layoutSizingVertical) || '').toUpperCase();
        const hugWidth = horizontal === 'HUG';
        const hugHeight = vertical === 'HUG';
        const ownerW = Number(ownerBox?.w);
        const ownerH = Number(ownerBox?.h);
        const hasOwner = Number.isFinite(ownerW) && ownerW > 0
          && Number.isFinite(ownerH) && ownerH > 0;
        const truncation = String(__u(ownerNode?.style?.truncation) || '').toUpperCase();
        /* 紧凑标签闸：「角色/技能标签」的 hug-owner 居中是给**短徽章**（几字、
           文本框几乎贴满 owner、单行高）的。一段说明性长句（如 07 活动说明 71 字、
           定宽 FIXED 框 w1074、HEIGHT 多行 h72）即便祖先链里出现「角色/技能/内容」，
           也不是紧凑标签——它的 owner 比自身高很多（垂直大片留白），把它当标签会
           触发 hug-owner-content-sized（width:max-content），把定宽说明文撑成单行
           超框、破坏 Figma 折行与垂直落点。用**纯几何**判据区分，不看文案、不看
           节点 ID：紧凑标签要求源文本框在垂直方向接近填满 owner（间隙 <= 源高度的 60%，
           另加 0.5px Figma 浮点坐标容差）。说明长文 owner 远高于自身，直接排除。 */
        const sourceW = Number(sourceBox?.w);
        const sourceH = Number(sourceBox?.h);
        const hasSource = Number.isFinite(sourceW) && sourceW > 0
          && Number.isFinite(sourceH) && sourceH > 0;
        const verticalSlack = hasSource && hasOwner ? ownerH - sourceH : Infinity;
        const compactLabel = hasSource && hasOwner
          && verticalSlack <= sourceH * 0.6 + 0.5
          && sourceW >= ownerW * 0.55;
        const eligible = role === 'character-skill-label'
          && __u(ownerNode?.type) === 'FRAME'
          && directOwner === true
          && hasOwner
          && String(align || '').toUpperCase() === 'CENTER'
          && (hugWidth || hugHeight)
          && __u(ownerNode?.clipsContent) !== true
          && !truncation
          && compactLabel
          && String(autoResize || 'FIXED').toUpperCase() !== 'TRUNCATE';
        return { eligible, hugWidth, hugHeight, compactLabel, ownerWidth: hasOwner ? ownerW : null, ownerHeight: hasOwner ? ownerH : null, layout };
      };
      const ownerSizingPolicy = (input) => {
        const evidence = compactHugLabelEvidence(input);
        const role = input.role;
        const reason = evidence.eligible ? 'truth-hug-owner-content-sized'
          : role === 'character-skill-label' && !evidence.compactLabel ? 'long-form-not-compact-label'
            : 'fixed-or-unproven-owner';
        return {
          ...evidence,
          reason,
        };
      };
      const textContainerConstraint = (n, tx, box, semantic, parent, directOwnerBox = null, directOwnerEvidence = false, directOwnerNode = null, directSiblings = []) => {
        const ancestors = Array.isArray(n.ancestorNames) ? n.ancestorNames : [];
        // The semantic role is derived from truth ancestry immediately before
        // this call. The previous implementation ignored it and only checked
        // leaf fields, so bounded card text was misclassified as open-flow.
        const role = String(semantic?.role || n.role || n.textRole || '').toLowerCase();
        const haystack = [role, n.name, ...ancestors].filter(Boolean).join(' ').toLowerCase();
        const framedHint = /nav|calendar|card|panel|tile|button|btn|tag|label|badge|discount|table|sidebar|menu|modal|drawer|fixed|tab|\u5361\u7247|\u9762\u677f|\u6309\u94ae|\u6807\u7b7e|\u6807|\u6298\u6263|\u8868\u683c/.test(haystack);
        const ar = String(tx.autoResize || 'FIXED').toUpperCase();
        const explicitOpen = n.openFlow === true || tx.openFlow === true;
        /* A section-wide locator-stack parent loses to the direct-owner box.
           Only accept the rendered parent when it is genuinely tighter than the
           text's own box; otherwise the direct owner (or source box) constrains. */
        const parentSectionWide = parent && parent.box
          && Number.isFinite(Number(box.w)) && Number(box.w) > 0
          && Number(parent.box.w) > Number(box.w) * 1.5;
        /* A truth-backed direct owner is stronger evidence than the locator
           stack's section-wide geometry.  The old order let a broad parent
           win first, so a HUG status host was reported as section-wide and
           localized text/background synchronization lost its owner proof. */
        const truthDirectOwner = directOwnerEvidence === true
          && directOwnerBox && directOwnerBox.sectionWide !== true;
        const directOwnerLayout = directOwnerNode?.layout || {};
        const directOwnerHugFrame = truthDirectOwner
          && __u(directOwnerNode?.type) === 'FRAME'
          && (String(__u(directOwnerLayout.layoutSizingHorizontal) || '').toUpperCase() === 'HUG'
            || String(__u(directOwnerLayout.layoutSizingVertical) || '').toUpperCase() === 'HUG');
        const compactDirectOwnerHugLabel = directOwnerHugFrame && compactHugLabelEvidence({
          role: semantic?.role,
          align: tx.align,
          autoResize: tx.autoResize,
          ownerNode: directOwnerNode,
          ownerBox: directOwnerBox,
          directOwner: true,
          sourceBox: box,
        }).eligible;
        const authoredLineCount = Array.isArray(tx.lineTypes) ? tx.lineTypes.length
          : String(tx.characters || '').split('\n').length;
        const sourceMultilineText = authoredLineCount > 1 || String(tx.characters || '').includes('\n')
          || (Number(tx.lineHeight) > 0 && Number(box.h) > Number(tx.lineHeight) * 1.35);
        const arForOwner = String(tx.autoResize || 'FIXED').toUpperCase();
        const sourceWidthHugText = directOwnerHugFrame && !compactDirectOwnerHugLabel
          && (arForOwner === 'HEIGHT' || (arForOwner === 'WIDTH_AND_HEIGHT' && sourceMultilineText));
        /* A fixed-size text item needs its own source width only when a real
           sibling follows it on the Auto Layout main axis. Without that proof,
           a one-item owner still uses the normal parent-bound text policy. */
        const directOwnerAutoLayoutMode = truthDirectOwner
          ? String(__u(directOwnerLayout.layoutMode) || '').toUpperCase() : '';
        const textLayout = n.layout || {};
        const fixedOnMainAxis = (directOwnerAutoLayoutMode === 'HORIZONTAL'
          && String(__u(textLayout.layoutSizingHorizontal) || '').toUpperCase() === 'FIXED')
          || (directOwnerAutoLayoutMode === 'VERTICAL'
            && String(__u(textLayout.layoutSizingVertical) || '').toUpperCase() === 'FIXED');
        const ownRight = Number(box.x) + Number(box.w);
        const ownBottom = Number(box.y) + Number(box.h);
        const hasFollowingSibling = fixedOnMainAxis && Array.isArray(directSiblings) && directSiblings.some((sibling) => {
          if (!sibling || String(__u(sibling.id)) === String(__u(n.id))) return false;
          const siblingBox = sibling.box || {};
          const siblingX = Number(__u(siblingBox.x));
          const siblingY = Number(__u(siblingBox.y));
          const siblingW = Number(__u(siblingBox.w));
          const siblingH = Number(__u(siblingBox.h));
          if (!Number.isFinite(siblingW) || !Number.isFinite(siblingH) || siblingW <= 0 || siblingH <= 0) return false;
          return directOwnerAutoLayoutMode === 'HORIZONTAL'
            ? Number.isFinite(siblingX) && siblingX >= ownRight - 0.5
            : Number.isFinite(siblingY) && siblingY >= ownBottom - 0.5;
        });
        const fixedAutoLayoutTextItem = fixedOnMainAxis && hasFollowingSibling;
        /* A fixed-width leaf that Figma explicitly centers inside its direct
           owner owns its source text box. It is neither an Auto Layout track
           nor a flexible owner-wide label: expanding it from its source left
           edge to the owner's right edge changes the text's center. Require
           all three source facts (fixed sizing, CENTER alignment/constraint,
           and coincident source centers) before preserving the leaf width. */
        const sourceHorizontalConstraint = String(__u(textLayout.constraints?.horizontal)
          || __u(n.constraints?.horizontal) || '').toUpperCase();
        const sourceFixedCenteredTextBox = truthDirectOwner
          && !fixedOnMainAxis
          && arForOwner !== 'WIDTH' && arForOwner !== 'WIDTH_AND_HEIGHT'
          && String(tx.align || '').toUpperCase() === 'CENTER'
          && sourceHorizontalConstraint === 'CENTER'
          && Number.isFinite(Number(box.x)) && Number.isFinite(Number(box.w)) && Number(box.w) > 0
          && Number.isFinite(Number(directOwnerBox.x)) && Number.isFinite(Number(directOwnerBox.w))
          && Number(directOwnerBox.w) > 0
          && Math.abs(
            Number(box.x) + Number(box.w) / 2
            - (Number(directOwnerBox.x) + Number(directOwnerBox.w) / 2)
          ) <= 1;
        const parentBox = truthDirectOwner
          ? directOwnerBox
          : (parent && parent.box && !parentSectionWide ? parent.box : null) || directOwnerBox || null;
        const hasBoundedOwner = parentBox
          && Number.isFinite(Number(parentBox.x)) && Number.isFinite(Number(parentBox.w))
          && Number(parentBox.w) > 0;
        const ownerRight = hasBoundedOwner ? Number(parentBox.x) + Number(parentBox.w) : null;
        const semanticFrame = role === 'nav' || role === 'activity-calendar'
          || role === 'character-skill-label'
          || (role === 'heading-content-card' && hasBoundedOwner);
        const explicitFrame = n.clipsContent === true || n.isMask === true
          || ar === 'TRUNCATE' || tx.truncation === 'ENDING'
          || semanticFrame || (hasBoundedOwner && framedHint);
        const sectionWidth = Number.isFinite(Number(meta.width)) && Number.isFinite(Number(secX))
          && Number.isFinite(Number(box.x)) ? Math.max(0, Number(secX) + Number(meta.width) - Number(box.x)) : null;
        /* When no truth-backed owner box exists (the direct parent was a
           passed-through pure container absent from truth), fall back to the
           text own source box width -- never to the section width. */
        /* Coordinate-grid copy (calendar cells, table labels) must keep the
           authored Figma text box. The nearest painted parent is often the
           whole grid shell; stretching a leaf from its left edge to that
           parent's right edge recenters the label across every column. */
        const sourceTextWidth = Number.isFinite(Number(box.w)) && Number(box.w) > 0 ? Number(box.w) : null;
        const sourceLayoutMode = String(__u(n.layout?.layoutMode ?? n.layoutMode) || '').toUpperCase();
        const coordinateGridText = sourceTextWidth != null
          && Number.isFinite(Number(box.h)) && Number(box.h) > 0
          && hasBoundedOwner
          && Number(parentBox.w) > sourceTextWidth * 1.5
          && (sourceLayoutMode === 'NONE' || sourceLayoutMode === '');
        const keepSourceTextWidth = coordinateGridText
          || (fixedAutoLayoutTextItem && sourceTextWidth != null)
          || sourceFixedCenteredTextBox
          || (sourceWidthHugText && sourceTextWidth != null);
        const ownerWidth = keepSourceTextWidth
          ? sourceTextWidth
          : compactDirectOwnerHugLabel
          ? Number(parentBox.w)
          : hasBoundedOwner && Number.isFinite(Number(box.x))
          ? Math.max(0, ownerRight - Number(box.x))
          : sourceTextWidth;
        /* Open-flow is explicit-only. The old `HEIGHT && !framedHint` heuristic
           leaked bounded card/column text into section-wide open flow; HEIGHT text
           now stays framed-fixed on its nearest owner box unless truth says open. */
        const openFlow = !explicitFrame && explicitOpen;
        return {
          mode: openFlow ? 'open-flow' : 'framed-fixed',
          openFlow,
          sectionWidth,
          ownerWidth: openFlow ? null : ownerWidth,
          ownerHeight: openFlow || !hasBoundedOwner || !Number.isFinite(Number(parentBox.h)) ? null : Number(parentBox.h),
          ownerEvidence: hasBoundedOwner
            ? (fixedAutoLayoutTextItem
              ? 'source-fixed-auto-layout-item'
              : sourceFixedCenteredTextBox
              ? 'source-fixed-centered-text-box'
              : sourceWidthHugText
              ? 'source-width-hug-text'
              : truthDirectOwner
              ? 'truth-direct-owner-box'
              : directOwnerBox && directOwnerBox.sectionWide
              ? 'source-box-after-section-parent'
              : parent && parent.box
                ? (Number.isFinite(Number(box.w)) && Number(box.w) > 0 && Number(parent.box.w) > Number(box.w) * 1.5
                  ? 'stack-parent-section-wide' : 'nearest-rendered-owner-box')
                : 'truth-direct-owner-box')
            : (ownerWidth != null ? 'source-box-fallback' : null),
          sourceBoxHeight: Number.isFinite(Number(box.h)) ? Number(box.h) : null,
          sourceFixedCenteredTextBox,
          sourceWidthHugText,
          evidence: explicitOpen && !explicitFrame ? 'truth-open-flow' : explicitFrame ? (hasBoundedOwner ? 'truth-role-and-owner-box' : 'truth-framed-or-clipped') : openFlow ? 'autoResize-and-ancestor-evidence' : 'default-fixed',
        };
      };
      const paint = (list, rawList, container, options = {}) => {
       const paintOriginX = options.originX ?? secX;
       const paintOriginY = options.originY ?? secY;
       const backgroundHeroShift = options.backgroundHeroShift === true;
       const heroVisualPlane = options.heroVisualPlane === true;
       const suppressInteractions = options.suppressInteractions === true;
       /* A component-set tree includes its canvas COMPONENT root.  When that
          tree is mounted inside an already-rendered INSTANCE, the root is a
          coordinate-system declaration, not a second piece of content.  The
          caller may therefore consume it as the owner-local origin and paint
          only its descendants.  Keeping the root in the DOM created a second
          nested 3840/1177px box and made alternate state geometry depend on
          component-set canvas coordinates. */
       const skipNodeIds = options.skipNodeIds instanceof Set ? options.skipNodeIds : new Set();
       /* Hero UI vertical mapping bookkeeping: top-level blocks take the
          100vh-slot Y ratio; flat text leaves must ride their containing
          block's stretched top instead of being stretched themselves, or a
          top-bar button label drifts out of its button frame. heroUiHalf is
          the generic top/bottom-chrome split at half the Figma hero height. */
       const heroUiBlocks = isHeroStage && heroUiYRatio > 1.001 ? [] : null;
       const heroUiHalf = heroUiBlocks && heroSlot ? Number(heroSlot.heroHeight || 0) / 2 : Infinity;
       const heroUiOwnerBlock = (blocks, centerX, centerY) => {
         let best = null;
         for (const blk of blocks) {
           if (blk.w <= 0 || blk.h <= 0) continue;
           if (centerX < blk.x || centerX > blk.x + blk.w) continue;
           if (centerY < blk.y || centerY > blk.y + blk.h) continue;
           if (!best || blk.area < best.area) best = blk;
         }
         return best;
       };
       const renderedById = new Map();
       /* truth node index: a text leaf direct Figma parent is often a pure
          container (passed through by the extractor, absent from the render
          list), so renderedById cannot find it. The owner must then fall back
          to the real parent frame named by truth parentId/ownerPath (it has a
          box) -- never to the section. Calendar dates previously inherited a
          1909px section width as their constraint that way. */
       const truthNodeById = new Map();
       for (const item of list) {
         const itemId = __u(item && item.id);
         if (itemId != null) truthNodeById.set(String(itemId), item);
       }
       const truthChildrenByParentId = new Map();
       for (const item of list) {
         const parentId = nodeParentId(item);
         if (!parentId) continue;
         const children = truthChildrenByParentId.get(parentId) || [];
         children.push(item);
         truthChildrenByParentId.set(parentId, children);
       }
       const interactionAttrs = suppressInteractions ? new Map() : interactionBridge(rawList || list);
       /* Offline demos cannot import ESM at runtime. The build/onboarding
          boundary may provide the pure adapter payload produced from
          deriveInteractionModel(); it augments only source-validated direct
          child switch pages. The renderer continues to own geometry and the
          existing runtime applySwitch path. */
       const interactionPayload = ctx.interactionPayload || ctx.renderInteractionPayload
         || motionAdapter?.interactionPayload || motionAdapter?.interaction?.rendererPayload || null;
       const adapterAttrs = new Map((interactionPayload && Array.isArray(interactionPayload.attributes)
         ? interactionPayload.attributes : []).map((entry) => [String(entry.id), entry.attrs || {}]));
       for (const [id, attrs] of adapterAttrs) {
         interactionAttrs.set(id, { ...(interactionAttrs.get(id) || {}), ...attrs });
       }
       /* A designer-export composite on a clip/mix ancestor is the rest-state
          snapshot of the whole subtree, including the first page of a nested
          scroll/. Once that descendant is a live hscroll host, the bake would
          stay pinned under the moving tracks. Release only the clip/mix window
          that covers the host; a random img/ ancestor stays baked. Named by
          structure, not by a product node id. */
       const liveHscrollBakeRelease = new Set();
       const paintNodeById = (id) => {
         if (!id) return null;
         if (truthNodeById.has(id)) return truthNodeById.get(id);
         for (const it of (rawList || list)) {
           if (String(__u(it && it.id) || '') === id) return it;
         }
         return null;
       };
       if (!suppressInteractions) {
         for (const item of (rawList || list)) {
           const itemId = String(__u(item && item.id) || '');
           const hostAttrs = interactionAttrs.get(itemId);
           if (!itemId || !hostAttrs || hostAttrs['data-hscroll'] == null) continue;
           const seen = new Set([itemId]);
           const climb = [];
           if (Array.isArray(item.ownerPath)) climb.push(...item.ownerPath);
           if (Array.isArray(item.ancestorIds)) climb.push(...item.ancestorIds);
           climb.push(item.parentId);
           for (const rawId of climb) {
             const ancestorId = String(__u(rawId) || '');
             if (!ancestorId || seen.has(ancestorId)) continue;
             seen.add(ancestorId);
             if (!this._assetRec(ancestorId, __base)) continue;
             const ancestor = paintNodeById(ancestorId);
             const ancestorName = String(__u(ancestor && ancestor.name) || '');
             const ancestorPfx = ((/^([a-z]+)\//.exec(ancestorName) || [])[1] || '');
             const ancestorClips = ancestor && ancestor.clipsContent === true;
             if (ancestorPfx === 'mix' || ancestorPfx === 'scroll' || ancestorClips) {
               liveHscrollBakeRelease.add(ancestorId);
             }
           }
         }
       }
       const componentVariantOwners = [];
       /* A ready package may reference a small component instance directly
          (indicator, tab/icon button) while the page node intentionally has
          no duplicated child tree.  Its selected component variant is still
          carried, source-backed, in componentVariantGraph.  Index those
          trees once so the consumer can mount the *selected* instance tree
          into an otherwise empty owner.  This is deliberately not a generic
          fallback drawing path: the component id, single root, and exact
          owner extent must all agree before any pixels are added. */
       const componentInstanceTrees = new Map();
       for (const set of asArr(__activeTruth && __activeTruth.componentVariantGraph
         && __activeTruth.componentVariantGraph.componentSets)) {
         for (const variant of asArr(set && set.variants)) {
           const componentId = String(__u(variant && variant.componentId) || '');
           const nodes = asArr(variant && variant.nodes);
           const roots = nodes.filter((node) => String(__u(node && node.id)) === componentId
             && String(node && node.type || '') === 'COMPONENT');
           if (!componentId || roots.length !== 1 || nodes.length < 2 || componentInstanceTrees.has(componentId)) continue;
           componentInstanceTrees.set(componentId, { componentId, root: roots[0], nodes });
         }
       }
       const componentInstanceOwners = [];
       const independentButtonOwners = [];
       const dropmenuOwners = [];
       const seqOf = (i) => {
         const r = rawList[i];
         const anchor = r && (r.orderKey || r.id);
         const loc = anchor && anchor.provenance ? anchor.provenance.locator : '';
         return this._orderKey(loc);
       };
      const isPrefix = (a, b) => a.length < b.length && a.every((v, i) => v === b[i]);
      const stack = [];   // [{ seq, el, box }]

      for (let ni = 0; ni < list.length; ni++) {
        const n = list[ni];
        if (skipNodeIds.has(String(__u(n && n.id)))) continue;
        /* 遮罩节点（Figma 不画本体，isMask:true）：防御性跳过。它们本不进 nodes
           （figma-assets 把 mask owner 整体烘焙成 PNG），但老 truth/手工 truth 可能带入，
           显式跳过确保渐变实心块不会糊住兄弟。 */
        if (n.notPainted === true || n.isMask === true) continue;
        const nid = n.id;
        const box = n.box || {};
        const st = n.style || {};
         const seq = seqOf(ni);
         while (stack.length && !isPrefix(stack[stack.length - 1].seq, seq)) stack.pop();
         /* 新 truth 优先消费 ownerPath：它保留纯容器穿透前的真实 Figma owner 链，
            page/fixed owner 根不会再因扁平列表或几何提升而丢失。旧 truth 才回退 locator 栈。 */
         const ownerPath = Array.isArray(n.ownerPath) ? n.ownerPath : [];
        /* Truth parent IDs are the structural source of record. ownerPath is
           retained for passed-through ancestors, but it can omit the immediately
           rendered owner in expanded INSTANCE trees. Resolve parentId first;
           only then climb ownerPath, and finally retain the legacy stack fallback. */
        const directParentId = nodeParentId(n);
        const directParentRecord = directParentId ? renderedById.get(directParentId) : null;
        const parent = directParentRecord
          || (ownerPath.length
            ? ownerPath.slice(0, -1).reverse().map((id) => renderedById.get(String(__u(id)))).find(Boolean)
            : null)
          || (stack.length ? stack[stack.length - 1] : null);
        /* The source-component fallback replaces the whole ind instance. Its
           original highlight child is still present in the flattened truth list;
           do not paint that same child over the supplied complete component or it
           recreates the known missing-image placeholder. The exact child id keeps
           this exclusion scoped to this one source component only. */
        if (directParentRecord?.el?.hasAttribute('data-source-component-fallback')
          && /;397:35946$/.test(String(nid))) continue;
        // Exported image/asset owners still need to expose structural interaction
        // descendants (indicators, tabs, switches, etc.).  The extraction contract
        // keeps those descendants in truth; only non-interactive painted children
        // remain covered by the asset lock.
        const evidenceAttrs = interactionAttrs.get(String(nid));
        /* `data-switch` identifies the switch a node belongs to, not that the
           node itself is actionable.  It is intentionally inherited through
           the whole source subtree for state lookup, so it must never by itself
           punch through an exported asset lock.  Only explicit page/tab/button/
           indicator/scroll/navigation evidence may remain above baked pixels. */
        const hasStructuralInteraction = !!evidenceAttrs && (
          evidenceAttrs['data-switch-owner'] === 'true'
          || evidenceAttrs['data-switch-page'] != null
          || evidenceAttrs['data-swpage'] != null
          || evidenceAttrs['data-switch-action'] != null
          || evidenceAttrs['data-hscroll'] != null
          || evidenceAttrs['data-hscroll-overflow-child'] === 'true'
          || evidenceAttrs['data-hscroll-action'] != null
          || evidenceAttrs['data-calendar-now'] != null
          || evidenceAttrs['data-sec-target'] != null
          || evidenceAttrs['data-copy-code'] != null
          || evidenceAttrs['data-nav-item'] === 'true'
          || evidenceAttrs['data-btn-press'] === 'true'
          || evidenceAttrs['data-btn-variant'] === 'true'
          || evidenceAttrs['data-dropmenu'] === 'true'
        );
        /* The rendered-parent stack is only a convenience for DOM nesting.  It
           can be incomplete when a pure Figma container is passed through or a
           flattened list loses one locator level.  Asset locking is a truth
           ownership rule, so also inspect the serialized ownerPath directly.
           This prevents Boolean operands (often gray solid rectangles) from
           being painted on top of an already-exported compound asset while
           preserving truth-backed interaction descendants. */
        const bakedOwnerId = ownerPath.slice(0, -1).map((id) => String(__u(id)))
          .reverse().find((id) => !!this._assetRec(id));
        /* Non-default blend layers (SOFT_LIGHT/OVERLAY/…) punched through by the
           extractor: a baked export rasterizes them on a transparent canvas, so the
           blend loses its page backdrop and flattens to a near-white fill (06 barcode
           14:50476 = SOFT_LIGHT over a blue band). Lift the layer above the baked
           pixels and re-blend it against the real background with CSS mix-blend-mode,
           reusing the baked owner's exported PNG for the exact vector shape. */
        const __blendLift = (() => {
          const bm = String(__u(st.blendMode) || '').toUpperCase();
          return bm !== '' && bm !== 'PASS_THROUGH' && bm !== 'NORMAL';
        })();
        /* A blend layer with no SOLID base fill cannot be re-composited in CSS (an
           IMAGE/GRADIENT sub-fill has no per-layer asset here). Lift only layers we
           can honestly rebuild; the rest stay inside the baked PNG (their blend was
           already flattened at export, which is the documented approximation). */
        const __blendHasSolidBase = (st.fills || []).some((fl) => fl && fl.visible !== false && fl.type === 'SOLID');
        const __blendLiftable = __blendLift && __blendHasSolidBase;
        const bakedOwnerReleased = !!(bakedOwnerId && liveHscrollBakeRelease.has(String(bakedOwnerId)));
        const underHscrollSurface = !!(parent && parent.hscrollSurface)
          || evidenceAttrs?.['data-hscroll-overflow-child'] === 'true'
          || (parent && parent.el && parent.el.closest && parent.el.closest('[data-hscroll-surface="true"]'));
        if ((parent && parent.assetLock || (bakedOwnerId && !bakedOwnerReleased))
          && !hasStructuralInteraction && !underHscrollSurface && !__blendLiftable) continue;
        /* Direct-owner fallback for text constraint. The locator-stack parent is
           often the SECTION layer for a deeply nested text leaf; it must not win
           over a tighter truth owner. Accept a rendered direct parent only when
           its box is genuinely tight (not a whole-section span). */
        const nodeOwnW = Number(box.w);
        const tightEnough = (candidate) => candidate && Number.isFinite(Number(candidate.x)) && Number.isFinite(Number(candidate.w))
          && Number(candidate.w) > 0 && !(Number.isFinite(nodeOwnW) && nodeOwnW > 0 && Number(candidate.w) > nodeOwnW * 8);
        const renderedDirectId = nodeParentId(n) || (ownerPath.length ? String(__u(ownerPath[ownerPath.length - 1])) : '');
        const renderedDirect = renderedDirectId ? renderedById.get(renderedDirectId) : null;
        const directOwnerNode = renderedDirectId ? truthNodeById.get(renderedDirectId) : null;
        const directOwnerEl = renderedDirect?.el || null;
        const stackParentSectionWide = parent && parent.box && Number.isFinite(nodeOwnW) && nodeOwnW > 0
          && Number(parent.box.w) > nodeOwnW * 1.5;
        let directOwnerBox = tightEnough(renderedDirect && renderedDirect.box) ? renderedDirect.box : null;
        /* A section-wide stack parent loses ownership to the text own source box;
           the width below is clamped so the section can never be the constraint. */
        if (!directOwnerBox && stackParentSectionWide && Number.isFinite(nodeOwnW) && nodeOwnW > 0) {
          directOwnerBox = { x: Number(box.x) || 0, w: nodeOwnW, sectionWide: true };
        }
        if (!directOwnerBox) {
          let cursor = renderedDirectId;
          let hops = 0;
          const seenOwner = new Set();
          while (cursor && hops < 16 && !seenOwner.has(cursor)) {
            seenOwner.add(cursor);
            hops++;
            const rendered = renderedById.get(cursor);
            const truthNode = truthNodeById.get(cursor);
            /* Prefer the truth node box over the rendered record: the rendered
               record can be the section layer itself. */
            const candidateBox = (truthNode && truthNode.box) || (rendered && rendered.box) || null;
            if (tightEnough(candidateBox)) { directOwnerBox = candidateBox; break; }
            const nextParent = truthNode ? (nodeParentId(truthNode) || (Array.isArray(truthNode.ownerPath) && truthNode.ownerPath.length ? String(__u(truthNode.ownerPath[truthNode.ownerPath.length - 1])) : '')) : '';
            if (!nextParent || nextParent === cursor) break;
            cursor = nextParent;
          }
        }

        // 前缀语义由图层名现算（name 是叶子，前缀是派生，所以不放 truth）
        const pfxMatch = /^([a-z]+)\//.exec(String(n.name ?? ''));
        const pfx = pfxMatch ? pfxMatch[1] : null;
        /* 页面 frame id 提到节点循环外太重；这里只在 pageStage 时从 ownerPath 根
           原值取一次（ownerPath[0] 即 page frame），供 data-owner-scope 判定
           page-frame-root。无 ownerPath 的老 truth 恒不等于空串，自动降级。 */
        const __ownerPageFrameId = pageStageMode
          ? String(__u((Array.isArray(n.ownerPath) && n.ownerPath[0]) || (pageScope && pageScope.meta && pageScope.meta.id) || ''))
          : '';

        const isText = n.type === 'TEXT';
        const kind = this._fillKind(st.fills);
        const SLICE = { img: 1, bg: 1, kv: 1 };
        const needsAsset = !isText && (SLICE[pfx] || kind === 'gradient' || kind === 'image');
        const assetRec = this._assetRecForNode(n, __base);
        const bakeReleasedForLiveHscroll = liveHscrollBakeRelease.has(String(__u(nid)));
        /* `ind/进度条` is a source component set whose two *component roots*
           intentionally have no page-level slice.  The ready truth does retain
           their exact component ids; the selected child has an IMAGE fill, but
           that imageRef is absent from assets-manifest, so the old consumer
           generated a transparent placeholder.  These two local reference PNGs
           are the Figma component-context exports for those exact roots (58×61),
           not re-drawn UI or inferred carousel state.  Keep the mapping narrow:
           it cannot promote arbitrary unknown/skipped nodes to pixels. */
        const __componentId = String(__u(n && n.componentId) || '');
        const __indComponentFallback = pfx === 'ind' && ({
          '397:35947': { file: 'assets/figma-indicator-active-alpha.webp', state: 'highlight', sourceNodeId: '397:35946' },
          '397:35949': { file: 'assets/figma-indicator-normal-alpha.webp', state: 'normal', sourceNodeId: '397:35949' },
        })[__componentId] || null;
        /* Baked-owner descendants punched through by the extractor (blend/structural
           walk) must not be re-painted when they are neutral decor already inside
           the baked PNG. Only a structural interaction (switch/tab/scroll/copy/nav)
           or a genuinely CSS-rebuildable blend layer may remain above baked pixels;
           every other baked-subtree paint node is skipped to avoid double-draw. */
        const __inBakedSubtree = !!(bakedOwnerId) && !assetRec;
        if (__inBakedSubtree && !bakedOwnerReleased && !hasStructuralInteraction && !underHscrollSurface && !__blendLiftable) continue;
        const assetUrl = (assetRec && !bakeReleasedForLiveHscroll)
          ? (assetRec.file || assetRec.url || assetRec.src || null)
          : (__indComponentFallback && __indComponentFallback.file);
        const NONRECT_SHAPE = { VECTOR: 1, BOOLEAN_OPERATION: 1, STAR: 1, POLYGON: 1, REGULAR_POLYGON: 1, ELLIPSE: 1, LINE: 1 };

        /* 这里**不再判断"是不是纯容器"**。
           判定规则（无 fill/stroke/effect 且 clipsContent≠true → 穿过）已经在提取器里，
           truth 的 nodes 数组里只剩该渲染的节点，纯容器进了 extract-report 的 skipped。
           渲染层再判一遍就成了同一条规则的第二份实现 —— 两边一旦漂移，
           页面会莫名少东西且不报错（clipsContent 那 6 个容器就是这么差点被我跳掉的）。 */

        const el = document.createElement('div');
        el.className = 'fx-n';
        el.setAttribute('data-node', nid);
        el.setAttribute('data-figma-type', n.type ?? '');
        /* Stamp the authored Figma layer name (`导航背景` / `导航长线` / …)
           for generic consumers; chrome must not guess from node ids. Both
           attribute spellings stay for main-side and branch-side readers. */
        const layerName = String(n.name ?? '').trim();
        if (layerName) {
          el.setAttribute('data-name', layerName);
          el.setAttribute('data-node-name', layerName);
        }
        if (pfx) el.setAttribute('data-prefix', pfx);
        if (bakeReleasedForLiveHscroll) el.setAttribute('data-asset-lock-released', 'live-hscroll-descendant');
        if (pfx === 'btn') {
          const btnLabel = String(n.name || '').replace(/^btn\s*[\/／]\s*/i, '').split('@')[0].trim();
          if (btnLabel) el.setAttribute('data-btn-name', btnLabel);
        }
        if (pfx === 'dropmenu') {
          const menuLabel = String(n.name || '').replace(/^dropmenu\s*[\/／]\s*/i, '').split('@')[0].trim();
          if (menuLabel) el.setAttribute('data-dropmenu-name', menuLabel);
        }
        /* Named `bg/` owners are page/section backdrops. They retain their
           source geometry, but must sit below the sibling paint tree even if
           Figma's exported child order places the backdrop after its content.
           This is a semantic prefix rule (not a page or node-id exception):
           otherwise a legitimate full-height background with a dark top band
           masks the KV and makes an apparently "missing" first screen. */
        el.style.zIndex = pfx === 'bg' ? '0' : '1';
        /* owner-model 结构证据（切片 2，lead 决策落地）。
           truth 叶子纪律：scope/assetPolicy/role 是派生值不进 truth；renderer 从
           owner 原值（name 前缀 / 类型 / parentId）渲染期重推并落 DOM 证据，
           让 renderer 消费 owner tree 变成可对账断言而非隐式假设。
           isMask/maskType 消费 extract 落的源叶子；maskChildren 是 owner 对直接
           mask 子级引用，用来定位并显式排除遮罩节点（不画出实心渐变）。 */
        el.setAttribute('data-owner-role', String(pfx || (n.type === 'TEXT' ? 'txt' : 'frame')));
        if (__indComponentFallback) {
          el.setAttribute('data-source-component-fallback', 'figma-component-context');
          el.setAttribute('data-source-component-id', __componentId);
          el.setAttribute('data-source-component-node', __indComponentFallback.sourceNodeId);
          el.setAttribute('data-source-component-state', __indComponentFallback.state);
        }
        if (assetRec && String(__u(n && n.componentId) || '') && (pfx === 'ind' || String(n.role || '') === 'ind')
          && !this._assetRec(nid, __base)) {
          el.setAttribute('data-source-component-id', String(__u(n.componentId)));
          el.setAttribute('data-ind-variant-slice', 'componentId');
        }
        if (n.paintAsFragment === true) el.setAttribute('data-paint-as-fragment', 'art-fragment');
        const __ownerAssetPolicy = (n.exportSettings && (Array.isArray(n.exportSettings) ? n.exportSettings.length : true)) ? 'export'
          : (assetUrl ? 'slice'
            : ((pfx === 'img' || pfx === 'bg' || pfx === 'kv') ? 'asset-missing'
              : (isText ? 'text' : (n.type === 'INSTANCE' || n.type === 'COMPONENT' ? 'owner' : 'css'))));
        el.setAttribute('data-owner-asset-policy', __ownerAssetPolicy);
        el.setAttribute('data-owner-scope', pageStageMode
          ? (directParentId && String(directParentId) === String(__ownerPageFrameId || '') ? 'page-frame-root'
            : (directParentId ? 'page-shared' : 'page-root'))
          : (pfx === 'bg' && !directParentId ? 'section-bg-root'
            : (pfx === 'bg' ? 'bg' : (directParentId ? 'section-local' : 'section-root'))));
        if (n.isMask !== undefined) el.setAttribute('data-owner-is-mask', String(__u(n.isMask)));
        if (n.maskType != null) el.setAttribute('data-owner-mask-type', String(__u(n.maskType)));
        if (n.maskChildren && (Array.isArray(n.maskChildren) ? n.maskChildren.length : true)) {
          const __mc = Array.isArray(n.maskChildren) ? n.maskChildren : [];
          el.setAttribute('data-owner-mask-children', __mc.map((entry) => String(__u(entry && entry.id))).join(' '));
          const __mt = __mc.map((entry) => __u(entry && entry.maskType)).find((t) => t != null);
          if (__mt != null) el.setAttribute('data-owner-mask-type', String(__mt));
        }
        if (evidenceAttrs) {
          for (const [key, value] of Object.entries(evidenceAttrs)) el.setAttribute(key, String(value));
          /* The copy affordance is a TEXT leaf whose owner never renders, so the
             leaf itself must look/behave clickable. */
          if (evidenceAttrs['data-copy-code'] != null) {
            el.style.cursor = 'pointer';
            el.style.pointerEvents = 'auto';
          }
          // Root paint layers are transparent hit-test surfaces.  Re-enable
          // pointer targeting only for truth-backed interaction nodes.
          el.style.pointerEvents = 'auto';
          /* Directional commands sit beside a clipped switch. Keep them above
             neighboring paint so the captured 84x112 hit box remains clickable
             without changing Figma geometry. */
          if (evidenceAttrs['data-switch-action']) {
            el.style.cursor = 'pointer';
            el.style.zIndex = '30';
          }
          if (evidenceAttrs['data-nav-shell'] === 'true') {
            el.style.pointerEvents = 'none';
          }
          if (evidenceAttrs['data-nav-item'] === 'true') {
            el.style.pointerEvents = 'auto';
            el.style.cursor = 'pointer';
          }
          if (evidenceAttrs['data-btn-variant'] === 'true' || evidenceAttrs['data-dropmenu'] === 'true') {
            el.style.pointerEvents = 'auto';
            el.style.cursor = 'pointer';
          }
          if (evidenceAttrs['data-btn-press'] === 'true') {
            el.style.pointerEvents = 'auto';
            el.style.cursor = 'pointer';
            if (!el.getAttribute('role')) el.setAttribute('role', 'button');
            if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
          } else if (evidenceAttrs['data-btn-press'] === 'inert') {
            el.setAttribute('aria-disabled', 'true');
          }
        }
        const motionRec = motionRoleMap.get(String(nid));
        if (motionRec) {
          el.setAttribute('data-motion-role', String(motionRec.role));
          el.setAttribute('data-motion-step', String(motionRec.step || 0));
          el.setAttribute('data-motion-evidence', String(motionRec.evidenceStatus || 'unverified') + ':' + String(motionRec.evidence || ''));
          if (motionRec.navigation) el.setAttribute('data-motion-navigation', 'true');
        } else if (n.motionRole != null) el.setAttribute('data-motion-role', String(n.motionRole));
        /* Directory stretch does not require a motion adapter. A fix/ overlay
           owner is the left rail; chrome reads this role to map source y onto
           the current viewport height. */
        if (pfx === 'fix' && !el.getAttribute('data-motion-role')) {
          el.setAttribute('data-motion-role', 'navigationFooter');
          el.setAttribute('data-motion-navigation', 'true');
        }

        /* 相对偏移 = 节点绝对坐标 − **父级**绝对坐标（没有父级时减分区坐标）。
           两个操作数都是 truth 里的原值，纯减法；门 D 用同一份原值对账。
           嵌套之后必须减父级：否则子元素会按分区坐标定位在父容器内部，整个跑飞。 */
        /* A passed-through Figma owner can be absent from the rendered list.
           In that case ownerPath may find a more distant visual ancestor, but
           direct parentId remains the true coordinate-system origin. Retain
           that source box for x/y subtraction without pretending it is a DOM
           parent, which fixes expanded-instance children that otherwise jump
           by their missing owner's absolute coordinates. */
        const directParentNode = directParentId ? truthNodeById.get(directParentId) : null;
        const coordinateOwnerBox = directParentRecord?.box || directParentNode?.box || parent?.box || null;
        const originX = coordinateOwnerBox ? (coordinateOwnerBox.x ?? 0) : paintOriginX;
        const originY = coordinateOwnerBox ? (coordinateOwnerBox.y ?? 0) : paintOriginY;
        /* A ready handoff's declared slice is exported on the bounds named by
           `sliceExport`.  Older/portable consumers only carry that declaration
           in qa-assets, not a duplicate `exportBox` record.  For a render-bound
           slice, the truth node's renderBox is therefore the authoritative
           visual canvas: putting its PNG into the ordinary owner box stretches
           shadows/overhang and makes a card image look larger than its frame.
           Prefer an explicit delivered exportBox; otherwise derive it solely
           from the same source declaration + source renderBox.  Page/owner
           geometry remains untouched, and non-render/page-bound assets keep
           the original owner-box behavior. */
        const renderBox = n.renderBox || {};
        const renderBoxReady = [renderBox.x, renderBox.y, renderBox.w, renderBox.h].every((v) => Number.isFinite(Number(v)))
          && Number(renderBox.w) > 0 && Number(renderBox.h) > 0;
        const _renderSliceBox = assetRec
          && String(assetRec?.sliceExport?.bounds || assetRec?.exportBounds || '').toLowerCase() === 'render'
          && renderBoxReady
          ? n.renderBox
          : null;
        const exportBox = (assetRec && assetRec.exportBox) || _renderSliceBox || null;
        /* 消费 truth 的 auto-layout（layoutMode HORIZONTAL/VERTICAL）。这些 frame
           的子节点在 truth 里被穿透成顶层 sibling（children=[]，靠 ownerPath 关联），
           若仍按源坐标绝对定位，译文变宽后：按钮 icon 被顶出框、跟随标签压住文字、
           左装饰-标题-右装饰不再居中 —— 全是同一根因（台账 knownGap「layout-not-consumed」）。
           修法：父是 auto-layout 时把它变成 flex 容器（gap/padding/对齐用 truth 原值），
           子节点改成 flex item（relative + auto），交给浏览器按真实内容宽度重排。
           通用规则，只认 layoutMode，不认 node id。仅对【已渲染为该 frame 直接子级】
           的节点生效；其余（如被 assetLock 烘焙、跨 owner）保持原绝对定位不动。 */
        const parentLayout = parent && parent.layout ? parent.layout : null;
        const parentAutoLayoutMode = parentLayout ? String(__u(parentLayout.layoutMode) || '').toUpperCase() : '';
        const inAutoLayout = !!(parent && parent.el && (parentAutoLayoutMode === 'HORIZONTAL' || parentAutoLayoutMode === 'VERTICAL'));
          /* Auto-layout is owner-specific. A child participates only when its
             Figma source declares layoutAlign; otherwise it is an absolute
             overlay anchored by its owner-local source box. This preserves card
             frames, art and captions layered inside a vertical Auto Layout card
             instead of turning their paint stack into a column. */
          const childLayoutAlign = String(__u(n.layout?.layoutAlign) || '').toUpperCase();
          const childLayoutGrow = Number(__u(n.layout?.layoutGrow) || 0);
          const childLayoutSizing = String(__u(n.layout?.layoutSizingHorizontal) || '').toUpperCase();
          /* `layoutAlign: INHERIT` alone is insufficient: Figma also emits it
             on absolutely overlaid frames inside a HUG card. Horizontal rows
             use their ordered direct children as the source flow; vertical
             cards only admit a child when it starts at the owner's main-axis
             origin (or explicitly grows/fills). Everything else keeps its
             owner-local x/y overlay placement. */
          const mainAxisOffset = parentAutoLayoutMode === 'HORIZONTAL'
            ? Number(box.x) - Number(parent?.box?.x)
            : Number(box.y) - Number(parent?.box?.y);
          const sourceParticipatesInFlow = parentAutoLayoutMode === 'HORIZONTAL'
            || (Number.isFinite(mainAxisOffset) && mainAxisOffset <= 0.5
              && (mainAxisOffset >= -0.5 || childLayoutGrow > 0 || childLayoutSizing === 'FILL'));
          const participatesInAutoLayout = inAutoLayout && childLayoutAlign === 'INHERIT' && sourceParticipatesInFlow;
          if (participatesInAutoLayout) {
          const pel = parent.el;
          /* A horizontal HUG owner with a FILL text track between fixed flow
             siblings is a self-sizing title/ornament group. Its source width is
             only the zh-CN snapshot result, not a ceiling: translated glyphs
             must enlarge the track and push the following ornament by the
             source itemSpacing. Keep this deliberately narrow: ordinary fixed
             frames, HUG rows without a FILL text child, and overlay children
             retain their existing source-box behavior. */
          const sourceFlowChildren = truthChildrenByParentId.get(String(parent.nid || '')) || [];
          const hugFillTextFixedSiblings = parentAutoLayoutMode === 'HORIZONTAL'
            && String(__u(parentLayout.layoutSizingHorizontal) || '').toUpperCase() === 'HUG'
            && sourceFlowChildren.some((child) => String(__u(child.type) || '').toUpperCase() === 'TEXT'
              && String(__u(child.layout?.layoutAlign) || '').toUpperCase() === 'INHERIT'
              && String(__u(child.layout?.layoutSizingHorizontal) || '').toUpperCase() === 'FILL')
            && sourceFlowChildren.filter((child) => String(__u(child.layout?.layoutAlign) || '').toUpperCase() === 'INHERIT'
              && String(__u(child.layout?.layoutSizingHorizontal) || '').toUpperCase() === 'FIXED').length >= 2;
          /* A HUG text item in a horizontal HUG row is its own intrinsic
             track.  The row's source width is the complete zh-CN snapshot
             (text + gap + sibling badges), never the text item's minimum
             width.  Treat it structurally, rather than by locale/copy: a
             translated glyph run may grow and moves the following direct
             sibling through the source itemSpacing. */
          const hugTextIntrinsicTrack = parentAutoLayoutMode === 'HORIZONTAL'
            && String(__u(parentLayout.layoutSizingHorizontal) || '').toUpperCase() === 'HUG'
            && isText
            && childLayoutAlign === 'INHERIT'
            && childLayoutSizing === 'HUG';
          if (backgroundHeroShift && parentAutoLayoutMode === 'VERTICAL'
              && heroLayoutOffsetDesign > 0
              && afterHeroBackgroundShift(n) > 0
              && !(parent.el.getAttribute('data-hero-bg-gap-inserted') === '1')) {
            /* Vertical auto-layout owns slice stacking. Insert one spacer at the
               first after-hero slice so later slices travel with sections, while
               the first-screen slice stays at Figma y. */
            const gap = document.createElement('div');
            gap.setAttribute('data-hero-bg-gap', '1');
            gap.style.flex = '0 0 ' + heroLayoutOffsetDesign + 'px';
            gap.style.width = '100%';
            gap.style.height = heroLayoutOffsetDesign + 'px';
            gap.style.pointerEvents = 'none';
            parent.el.appendChild(gap);
            parent.el.setAttribute('data-hero-bg-gap-inserted', '1');
            parent.el.setAttribute('data-hero-bg-gap-design', String(heroLayoutOffsetDesign));
          }
          if (pel.getAttribute('data-auto-layout') !== parentAutoLayoutMode) {
            const padT = Number(__u(parentLayout.paddingTop) || 0);
            const padR = Number(__u(parentLayout.paddingRight) || 0);
            const padB = Number(__u(parentLayout.paddingBottom) || 0);
            const padL = Number(__u(parentLayout.paddingLeft) || 0);
            const gap = Number(__u(parentLayout.itemSpacing) || 0);
            const prim = String(__u(parentLayout.primaryAxisAlignItems) || '').toUpperCase();
            const counter = String(__u(parentLayout.counterAxisAlignItems) || '').toUpperCase();
            pel.style.display = 'flex';
            pel.style.flexDirection = parentAutoLayoutMode === 'HORIZONTAL' ? 'row' : 'column';
            pel.style.flexWrap = 'nowrap';
            pel.style.boxSizing = 'border-box';
            pel.style.padding = padT + 'px ' + padR + 'px ' + padB + 'px ' + padL + 'px';
            const jc = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between' };
            const ai = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', BASELINE: 'baseline' };
            /* Figma omits axis-alignment fields when they retain their MIN
               default. CSS must not invent `center`: it moves every child of a
               HUG owner, including overlapping card columns and fixed side-nav
               rows, away from their source x/y relationship. */
            pel.style.justifyContent = jc[prim] || 'flex-start';
            pel.style.alignItems = ai[counter] || 'flex-start';
            /* CSS gap rejects negative values, while Figma itemSpacing permits
               them to express deliberate card overlap. Positive spacing uses
               native gap; negative spacing is applied per subsequent direct
               item below as a source-backed negative main-axis margin. */
            if (gap > 0) pel.style.gap = gap + 'px';
            else if (gap < 0) pel.setAttribute('data-auto-layout-negative-gap', String(gap));
            pel.setAttribute('data-auto-layout', parentAutoLayoutMode);
          }
          if (hugFillTextFixedSiblings) {
            const sourceOwnerWidth = Number(parent.box?.w);
            const sourceOwnerHeight = Number(parent.box?.h);
            pel.style.width = 'max-content';
            if (Number.isFinite(sourceOwnerWidth) && sourceOwnerWidth > 0) pel.style.minWidth = sourceOwnerWidth + 'px';
            if (Number.isFinite(sourceOwnerHeight) && sourceOwnerHeight > 0) {
              pel.style.height = 'max-content';
              pel.style.minHeight = sourceOwnerHeight + 'px';
            }
            /* A HUG group positioned directly on the stage grows around its
               source center. A group already flowing in another Auto Layout
               owner must not receive an absolute transform. */
            const parentFlows = pel.getAttribute('data-auto-layout-item') === '1';
            const sourceCentered = String(__u(parentLayout.constraints?.horizontal) || '').toUpperCase() === 'CENTER';
            if (!parentFlows && sourceCentered && !pel.getAttribute('data-auto-layout-hug-fill-center-anchor')) {
              const sourceLeft = Number.parseFloat(pel.style.left || '');
              if (Number.isFinite(sourceLeft) && Number.isFinite(sourceOwnerWidth)) {
                pel.style.left = (sourceLeft + sourceOwnerWidth / 2) + 'px';
                pel.style.transform = (pel.style.transform ? pel.style.transform + ' ' : '') + 'translateX(-50%)';
                pel.setAttribute('data-auto-layout-hug-fill-center-anchor', 'source-center');
              }
            }
            pel.setAttribute('data-auto-layout-hug-fill-fixed-siblings', '1');
          }
          if (hugTextIntrinsicTrack) {
            const sourceOwnerWidth = Number(parent.box?.w);
            /* Preserve the source row as a floor, while allowing its true
               HUG contents to determine the final main-axis extent. */
            pel.style.width = 'max-content';
            if (Number.isFinite(sourceOwnerWidth) && sourceOwnerWidth > 0) pel.style.minWidth = sourceOwnerWidth + 'px';
            pel.setAttribute('data-auto-layout-hug-text-track-owner', '1');
          }
          el.style.position = 'relative';
          el.style.left = 'auto';
          el.style.top = 'auto';
          el.style.flexShrink = '0';
          if (hugFillTextFixedSiblings && isText && childLayoutSizing === 'FILL') {
            /* CSS flex-grow inside max-content is circular. The Figma HUG
               response is the rendered text's intrinsic track with the source
               FILL width as a minimum, followed by the real item gap. */
            el.style.flex = '0 0 auto';
            el.style.flexGrow = '0';
            el.style.width = 'max-content';
            /* The title's rendered glyph, not the stale source FILL track,
               is the HUG group's main-axis input. `min-width: max-content`
               avoids the flex sizing algorithm resolving width back to the
               old track before the locale font finishes shaping. */
            el.style.minWidth = 'max-content';
            el.setAttribute('data-auto-layout-hug-fill-text-track', 'intrinsic-min-source');
          }
          if (hugTextIntrinsicTrack) {
            /* The source leaf box, not its complete HUG-row owner, is the
               translation-safe floor for this direct Auto Layout item. */
            el.setAttribute('data-auto-layout-hug-text-track', 'source-leaf-floor');
          }
          const negativeGap = Number(parent.el.getAttribute('data-auto-layout-negative-gap') || 0);
          if (negativeGap < 0 && parent.el.children.length > 0) {
            if (parentAutoLayoutMode === 'HORIZONTAL') el.style.marginLeft = negativeGap + 'px';
            else el.style.marginTop = negativeGap + 'px';
            el.setAttribute('data-auto-layout-negative-gap-item', String(negativeGap));
          }
          el.setAttribute('data-auto-layout-item', '1');
        } else {
          /* Figma paint siblings use absolute coordinates inside their source
             owner. `left`/`top` alone do not establish that in CSS: when an
             asset mount later makes a node `position:relative`, siblings start
             consuming normal-flow space and a KV's background/portrait/shadow
             stack vertically. Only a proven Auto Layout child may flow. */
          el.style.position = 'absolute';
          el.style.left = ((box.x ?? 0) - originX) + 'px';
          const sourceTop = ((box.y ?? 0) - originY);
          /* Size stays on k. When the first-screen slot is taller than the
             Figma hero, top-level blocks anchor their BOTTOM fraction of the
             slot so a lower-hero title stays at the first-screen bottom. A
             flat text leaf (its Figma owner was pass-through) rides the
             containing block's stretched top and keeps its local offset —
             stretching the leaf itself would push button labels out of
             their button frames. */
          let heroUiTop = sourceTop;
          let heroUiAnchored = false;
          if (heroUiBlocks && !parent && Number.isFinite(sourceTop)) {
            const localX = (box.x ?? 0) - originX;
            const sourceH = Number(box.h ?? 0);
            const sourceBottom = sourceTop + sourceH;
            /* Generic split, no node names: blocks whose Figma bottom sits in
               the upper half of the hero are top chrome and keep their top
               fraction; blocks ending in the lower half (a hero title, a
               download CTA) anchor their BOTTOM fraction so they keep the
               Figma distance above the first-screen bottom edge — pinned to
               the lower first screen at every viewport instead of drifting
               to the middle. */
            heroUiTop = sourceBottom > heroUiHalf
              ? sourceBottom * heroUiYRatio - sourceH
              : sourceTop * heroUiYRatio;
            const best = heroUiOwnerBlock(heroUiBlocks, localX + (box.w ?? 0) / 2, sourceTop + sourceH / 2);
            if (best) {
              heroUiTop = best.stretchedTop + (sourceTop - best.y);
              heroUiAnchored = true;
            }
            heroUiBlocks.push({
              x: localX,
              y: sourceTop,
              w: Number(box.w ?? 0),
              h: sourceH,
              stretchedTop: heroUiTop,
              area: Math.max(1, (box.w ?? 0) * sourceH),
            });
          }
          el.style.top = heroUiTop + 'px';
          if (heroUiTop !== sourceTop) {
            el.setAttribute('data-hero-ui-y', String(heroUiYRatio));
            el.setAttribute('data-hero-ui-anchor', heroUiAnchored ? 'owner-block' : 'slot-ratio');
          }
        }
        /* Cover-crop the first-screen visual plane (KV + long bg/*) to 100vh.
           Inventory still owns one bg/* sheet; this only scales the locked
           first-screen view. Later sections stay on platform scale k. Do not
           shrink the owner box: that would squash the long sheet and keep the
           next-screen seam inside the first screen. */
        if (heroVisualPlane && heroSlot && heroVisualScale > 0 && pageStageScale > 0
          && !parent && Number.isFinite(Number(box.h)) && Number(box.h) > 0) {
          const planeRatio = heroVisualScale / pageStageScale;
          const nodeY = Number(box.y);
          const isFirstScreenVisual = !Number.isFinite(nodeY) || nodeY <= heroSectionBottomY + 0.5;
          const layerName = String(n.name || '');
          const isBg = /^bg(?:\/|$)/i.test(layerName);
          const isKv = /^kv(?:\/|$)/i.test(layerName);
          if (isFirstScreenVisual && (isBg || isKv)) {
            if (planeRatio > 1.001) {
              const planeLeft = Number.parseFloat(el.style.left || '0') || 0;
              el.style.left = (planeLeft + heroVisualCropLeft) + 'px';
              el.style.transformOrigin = '0 0';
              el.style.transform = ((el.style.transform ? el.style.transform + ' ' : '') + 'scale(' + planeRatio + ')').trim();
              el.setAttribute('data-hero-visual-plane-scale', String(planeRatio));
            }
            const sourceH = Number(box.h);
            const clipH = heroCropWindowDesign > 0 ? Math.min(sourceH, heroCropWindowDesign) : sourceH;
            if (isBg && heroLayoutOffsetDesign > 0 && clipH > 0 && clipH < sourceH - 0.5) {
              el.style.clipPath = 'inset(0 0 ' + (sourceH - clipH) + 'px 0)';
              el.setAttribute('data-hero-visual-clip', String(clipH));
            }
            el.setAttribute('data-hero-visual-plane', isBg ? 'bg' : 'kv');
          }
        }
        el.style.width = (box.w ?? 0) + 'px';
        /* absoluteRenderBounds 是 Figma 已经算完 mask/clip/effect 后的可见范围。
           对没有切图的 CSS 节点，如果 renderBox 是 box 的真子集，必须按它裁掉不可见部分；
           否则被 Figma mask 裁掉的渐变会从原始 box 继续画出来，形成整块错误底色。
           资产节点不走这里：它们的 render bounds 已在 assets-manifest.exportBox 里消费。 */
        const rb = n.renderBox || {};
        /* A rotated shape's absoluteRenderBounds is the AABB of its already-rotated
           geometry, while its `box` is the UNROTATED layout box (rotation is applied
           separately as a CSS transform below). Mapping rb-vs-box into an inset clip
           is only valid when the two share the same frame. For a rotated non-rect
           shape (REGULAR_POLYGON/VECTOR/STAR/ELLIPSE/LINE/BOOLEAN_OPERATION) the
           transform rotates the painted content inside the box, and a renderBox inset
           would slice off the rotated corners — e.g. the 09 "更多" arrow (1:850,
           REGULAR_POLYGON rotation=90°) was clipped into a square sliver. Skip the
           renderBox clip for rotated shapes; the rotation transform is the truth. */
        const _rotatedShape = typeof n.rotation === 'number' && Math.abs(n.rotation) > 1e-4
          && !isText && !assetRec;
        if (_rotatedShape) el.setAttribute('data-renderbox-clip-skipped', 'rotated-shape');
        const rbInside = !assetRec && !isText && !_rotatedShape
          && typeof rb.x === 'number' && typeof rb.y === 'number'
          && typeof rb.w === 'number' && typeof rb.h === 'number'
          && typeof box.x === 'number' && typeof box.y === 'number'
          && typeof box.w === 'number' && typeof box.h === 'number'
          && rb.x >= box.x - 0.01 && rb.y >= box.y - 0.01
          && rb.x + rb.w <= box.x + box.w + 0.01
          && rb.y + rb.h <= box.y + box.h + 0.01
          && (Math.abs(rb.x - box.x) > 0.01 || Math.abs(rb.y - box.y) > 0.01
            || Math.abs(rb.w - box.w) > 0.01 || Math.abs(rb.h - box.h) > 0.01);
        /* A source scroll viewport is captured in its resting position. Its
           overflowing track, and groups inside that track, can inherit a
           renderBox clipped exactly at that viewport edge. Keeping those
           inner static clips makes scrollLeft move the track while later
           items stay unpainted, and also crops hugging descendants that
           later paint wider than the captured rest-state ink.
           Transfer only this provable host-edge clip to the real scroll
           host; unrelated renderBox clips remain intact. */
        const hscrollHostEl = (() => {
          let cursor = parent && parent.el;
          for (let hops = 0; cursor && hops < 16; hops++) {
            if (cursor.getAttribute && cursor.getAttribute('data-hscroll') === 'x') return cursor;
            cursor = cursor.parentElement;
          }
          return null;
        })();
        const hscrollHostRecord = hscrollHostEl
          ? (hscrollHostEl === (parent && parent.el) ? parent : renderedById.get(String(hscrollHostEl.getAttribute('data-node') || '')))
          : null;
        const parentBox = hscrollHostRecord && hscrollHostRecord.box || null;
        const hscrollTrackOverflow = parentBox
          && Number.isFinite(Number(parentBox.x)) && Number.isFinite(Number(parentBox.w))
          && Number.isFinite(Number(box.x)) && Number.isFinite(Number(box.w))
          && (box.x < parentBox.x - 0.5 || box.x + box.w > parentBox.x + parentBox.w + 0.5);
        const hscrollTrackClipRelease = !!(hscrollHostRecord && rbInside && hscrollTrackOverflow
          && (Math.abs(rb.x - parentBox.x) <= 0.75
            || Math.abs(rb.x + rb.w - (parentBox.x + parentBox.w)) <= 0.75));
        if (rbInside) {
          const insetTop = Math.max(0, rb.y - box.y);
          const insetRight = Math.max(0, (box.x + box.w) - (rb.x + rb.w));
          const insetBottom = Math.max(0, (box.y + box.h) - (rb.y + rb.h));
          const insetLeft = Math.max(0, rb.x - box.x);
          if (hscrollTrackClipRelease) {
            el.setAttribute('data-hscroll-track', 'true');
            el.setAttribute('data-hscroll-track-clip-released', 'parent-viewport-renderbox-edge');
            /* Direct overflowing child of the clip host is the scroll surface.
               Nested groups only release their rest-state clip; they do not
               become a second scroller. */
            if (hscrollHostEl && parent && parent.el === hscrollHostEl) {
              el.setAttribute('data-hscroll-surface', 'true');
              el.style.overflow = 'visible';
              el.style.overflowX = 'visible';
              el.style.overflowY = 'visible';
              const restLeft = Number.parseFloat(el.style.left || '0');
              if (Number.isFinite(restLeft)) el.setAttribute('data-hscroll-rest-left', String(restLeft));
              const hostW = Number(hscrollHostRecord && hscrollHostRecord.box && hscrollHostRecord.box.w);
              const trackW = Number(box.w);
              const restX = Number(box.x);
              const hostX = Number(hscrollHostRecord && hscrollHostRecord.box && hscrollHostRecord.box.x);
              if ([hostW, trackW, restX, hostX].every(Number.isFinite) && (restX + trackW > hostX + hostW + 0.5 || restX < hostX - 0.5)) {
                el.setAttribute('data-hscroll-max', String(Math.max(0, (restX + trackW) - (hostX + hostW))));
              }
              /* Host overflow cannot clip this track without also clipping the
                 rest-state left labels that sit as siblings. Clip the track
                 at its own rest left edge so translated dates never paint
                 left of that column into the labels. Rest clip is 0: the
                 track box already starts to the right of the labels. */
              if (Number.isFinite(restLeft)) {
                /* inset(0) still clips hugging descendants that paint past the
                   track box. Rest state keeps clip none so 06.11 stays whole. */
                el.style.clipPath = 'none';
                el.setAttribute('data-hscroll-host-clip', '0');
              }
            }
            /* The host keeps its Figma box and expresses shadow gutter as
               border-box padding. .fx-n children are position:absolute, so
               they anchor to the host's padding box and the padding alone
               never moves this track — the shadow would still clip at the
               same content edge. Consume the gutter here by shifting the
               track's absolute inset: this preserves every painted child
               coordinate (host shifts up/left, track shifts down/right by
               the same amount) while overflow clips at the gutter's outer
               edge instead of the content edge. */
            const hostGutter = String(hscrollHostEl.getAttribute('data-hscroll-shadow-gutter') || '').split(/\s+/).map(Number);
            if (hostGutter.length === 4 && hostGutter.some((v) => Number.isFinite(v) && v > 0)) {
              const gT = Number.isFinite(hostGutter[0]) ? Math.max(0, hostGutter[0]) : 0;
              const gL = Number.isFinite(hostGutter[3]) ? Math.max(0, hostGutter[3]) : 0;
              if (gT > 0 || gL > 0) {
                el.style.top = (Number.parseFloat(el.style.top || '0') + gT) + 'px';
                el.style.left = (Number.parseFloat(el.style.left || '0') + gL) + 'px';
                el.setAttribute('data-hscroll-track-gutter', [gT, gL].map((v) => String(v)).join(' '));
              }
            }
          } else {
            el.style.clipPath = `inset(${insetTop}px ${insetRight}px ${insetBottom}px ${insetLeft}px)`;
            el.setAttribute('data-renderbox-clip', [insetTop, insetRight, insetBottom, insetLeft].map((v) => v.toFixed(3)).join(','));
          }
        }
        if (exportBox) {
          el.setAttribute('data-asset-bounds', assetRec.exportBounds || 'render');
          el.setAttribute('data-node-box', [box.x, box.y, box.w, box.h].map((v) => Number(v ?? 0).toFixed(3)).join(','));
        }
        if (assetRec) el.setAttribute('data-asset-descendants', 'baked');

        /* 导出资产已经按 Figma 节点的不透明度合成：再次设置 CSS opacity 会把
           半透明 PNG 再乘一次，导致波形、装饰等资产异常变淡。无资产节点仍需
           由 CSS 消费源不透明度。 */
        if (st.opacity != null && st.opacity !== 1) {
          if (assetUrl) el.setAttribute('data-opacity-via', 'asset-baked');
          else el.style.opacity = String(st.opacity);
        }

        /* 节点级混合模式 → mix-blend-mode（映射见 _blendCss）。
           近似与未知都留痕：data-blend-approx / data-blend-unknown。
           ⚠️ 父级有 filter/opacity 会隔断混合（层叠上下文），与 Figma 整组合成有出入，
           已登记在 supports.knownGaps —— 不静默。 */
        const bmc = this._blendCss(st.blendMode);
        if (bmc) {
          if (bmc.css) {
            el.style.mixBlendMode = bmc.css;
            if (bmc.approx) el.setAttribute('data-blend-approx', bmc.raw + '→' + bmc.css);
          } else {
            el.setAttribute('data-blend-unknown', bmc.raw);
          }
        }

        /* clipsContent:true 的容器真的会裁剪子级（实测：1267 高的边框图被 1219 高的框裁掉一截）。
           不落 overflow:hidden 的话，被裁的部分会溢出来盖到别处，而且看不出是哪来的。
           ⚠️ 读 n.clipsContent，**不是 n.style.clipsContent** —— 提取器把它放在条目顶层。
           之前写成 st.clipsContent，条件永远为假，overflow 一次都没生效过，
           而且不报错、页面只是"多出一截"，肉眼极难发现。是新加的裁剪断言把它揪出来的。 */
        if (n.clipsContent === true && !hscrollTrackClipRelease) {
          /* After-hero sections are shifted by layoutOffsetDesign. A page
             background root that still clips to its Figma height cuts the
             shifted tail, which reads as a short background. Keep first-screen
             KV unmoved; only release this clip when the layer is following. */
          const isPageBackgroundRoot = backgroundHeroShift && pageStageMode
            && /^bg\//i.test(String(n.name || ''));
          if (isPageBackgroundRoot && heroLayoutOffsetDesign > 0) {
            el.style.overflow = 'visible';
            el.style.height = (pageScrollHeight || box.h || 0) + 'px';
            el.setAttribute('data-hero-bg-clip', 'released-to-page-scroll-height');
          } else {
            el.style.overflow = 'hidden';
          }
        }
        if (evidenceAttrs && evidenceAttrs['data-hscroll'] === 'x') {
          /* This same Figma node is the clipped viewport. Native overflow-x
             on the host would also pan siblings that stay inside the rest
             box (calendar left labels). Keep the host as clip-only; the
             overflowing track is the scroll surface. */
          el.style.overflow = 'hidden';
          el.style.overflowX = 'hidden';
          el.style.overflowY = 'hidden';
          el.style.touchAction = 'pan-x';
          el.style.userSelect = 'none';
          el.style.webkitUserSelect = 'none';
          el.style.webkitTouchCallout = 'none';
          /* Absorb source-proven cross-axis shadow bleed into the host's own
             padding box, so overflow:hidden clips at the shadow's true outer
             edge instead of at the content bounds. Main-axis scroll viewport
             semantics are unchanged: content wider than the viewport still
             scrolls and its right edge still clips the off-screen remainder.
             The host's absolute position shifts by the same top/left gutter,
             so painted content coordinates do not move. */
          const shadowGutter = String(evidenceAttrs['data-hscroll-shadow-gutter'] || '').split(/\s+/).map(Number);
          if (shadowGutter.length === 4 && shadowGutter.some((v) => Number.isFinite(v) && v > 0)) {
            const [gT, gR, gB, gL] = shadowGutter.map((v) => Number.isFinite(v) ? Math.max(0, v) : 0);
            /* 2026-08-08 修正：border-box + 固定 height 会把 padding 从内容盒里吃掉（124px 总高
               → 内容盒只剩 104px），overflow:hidden 反而把出血投影裁得更狠。改为【扩大 host 总盒】
               让内容盒覆盖原视口 + 出血，overflow 在 padding 外沿（投影真外缘）裁切；位置反向偏移
               保持视口原屏幕位置。横向滚动语义不变：内容仍比视口宽，右侧越界部分仍被裁。 */
            el.style.boxSizing = 'border-box';
            el.style.padding = gT + 'px ' + gR + 'px ' + gB + 'px ' + gL + 'px';
            const curW = Number.parseFloat(el.style.width || '0');
            const curH = Number.parseFloat(el.style.height || '0');
            if (Number.isFinite(curH) && curH > 0) el.style.height = (curH + gT + gB) + 'px';
            if (Number.isFinite(curW) && curW > 0 && (gL + gR) > 0) el.style.width = (curW + gL + gR) + 'px';
            /* 记录扩展量：下游通用 height 赋值（box.h）会无条件覆盖，必须在那一处把 gutter 加回，
               否则 124px 又被压回、内容盒只剩 104px 把出血投影裁掉（2026-08-08 实测）。
               用 data 属性挂在元素上（不用 var，避免函数作用域跨节点泄漏）。 */
            el.setAttribute('data-hscroll-gutter-h', String(gT + gB));
            const curLeft = Number.parseFloat(el.style.left || '0');
            const curTop = Number.parseFloat(el.style.top || '0');
            if (Number.isFinite(curLeft)) el.style.left = (curLeft - gL) + 'px';
            if (Number.isFinite(curTop)) el.style.top = (curTop - gT) + 'px';
            el.setAttribute('data-hscroll-shadow-gutter-applied', 'true');
          }
        }

        const rr = st.rectangleCornerRadii;
        if (Array.isArray(rr) && rr.length === 4) el.style.borderRadius = rr.map((v) => v + 'px').join(' ');
        else if (st.radius != null) el.style.borderRadius = st.radius + 'px';
        else if (st.cornerRadius != null) el.style.borderRadius = st.cornerRadius + 'px';
        /* ELLIPSE ???? 50% ?? ?? CSS ?????????????????
           ???? stroke-nonrect ??????outline ??????????? */
        if (n.type === 'ELLIPSE') el.style.borderRadius = '50%';

        /* 阴影落到哪个 CSS 属性，取决于这个节点是"文字"还是"图形"，
           以及文字是不是**渐变字** —— 三种情况，都是踩出来的：

           图形   → box-shadow（绕元素矩形）
           纯色字 → text-shadow（绕字形；字色在文字层，阴影画在文字层之下，正确）
           渐变字 → filter: drop-shadow（**不能用 text-shadow**）

           渐变字为什么不同：渐变字是用 background-clip:text 实现的，字形的填充
           实际住在**背景层**。而 CSS 里 text-shadow 画在背景层**之上** ——
           于是那两个 radius 16/20 的柔光阴影糊在渐变字面上，字看起来就是"模糊的"。
           这正是欣仪指出的「模糊阴影层在文字层上方了」，是 CSS 的真实绘制顺序，
           不是浏览器 bug。
           filter: drop-shadow 作用于元素**渲染完的结果**（含被裁成字形的背景），
           且阴影合成在内容之下，所以渐变字 + 阴影只有这一条路是对的。 */
        const isGradText = isText && !!this._cssGradient((n.text || {}).color);
        const transparentShadowHost = !isText && !assetUrl
          && (n.type === 'GROUP' || n.type === 'INSTANCE' || kind === 'none' || NONRECT_SHAPE[n.type]);
        const shadow = this._shadow(st.effects, isText);
        if (shadow) {
          if (assetUrl) {
            el.setAttribute('data-shadow-via', 'asset-baked');
          } else if (isGradText) {
            const ds = this._shadow(st.effects, true, true);   // drop-shadow() 语法：无 spread
            if (ds) el.style.filter = ds;
            el.setAttribute('data-shadow-via', 'filter');
          } else if (transparentShadowHost) {
            const ds = this._shadow(st.effects, false, true);
            if (ds) {
              el.style.filter = ds;
              el.setAttribute('data-shadow-via', 'filter');
            }
          } else {
            el.style[isText ? 'textShadow' : 'boxShadow'] = shadow;
            el.setAttribute('data-shadow-via', isText ? 'text-shadow' : 'box-shadow');
          }
        }
        const blur = this._blur(st.effects);
        // 已经用 filter 画阴影时要把模糊接在同一个 filter 里，否则后写的会覆盖前一个
        if (blur) {
          if (assetUrl) el.setAttribute('data-blur-via', 'asset-baked');
          else el.style.filter = el.style.filter ? el.style.filter + ' ' + blur : blur;
        }

        /* 描边分三种情况（2026-08-04 欣仪指出"切角素材图外面多了个矩形框"）：

           ① 已切图的节点**不画**：Figma 导出 PNG 时描边已经烤进图里，
              再画一圈 outline 就是多一个矩形框（16 个节点都是这种）。
              判据沿用资产清单（_assets()[nid] 有没有它）——"该不该切图"的规则
              只有一份实现（在 figma-assets），这里重新判一遍就是第二份，必漂移。
           ② 非矩形节点（VECTOR/BOOLEAN_OPERATION/STAR/POLYGON/ELLIPSE/LINE）
              即使没切图也**不用 outline**：描边沿轮廓走，outline 只能画矩形边框，
              画错（多一个框）比不画（少一条细线）更糟 —— 打 data-stroke-unrendered
              留痕，登记在 supports.knownGaps。
           ③ 没切图 + 矩形类（RECTANGLE/FRAME/GROUP/INSTANCE）才用 outline。

           ⚠️ 继续用 outline + 负 offset，**不许改回 border**：嵌套之后 border 会把
           子元素的坐标原点往里推 strokeWeight 个像素，43 条描边就是 43 处偏移。
           outline 不参与布局，画在哪儿都不动孩子。 */
        if (st.strokeColor && st.strokeWeight) {
          const sc = st.strokeColor.color ? this._rgba(st.strokeColor.color) : this._rgba(st.strokeColor);
          if (sc) {
            const NONRECT = { VECTOR: 1, BOOLEAN_OPERATION: 1, STAR: 1, POLYGON: 1, ELLIPSE: 1, LINE: 1 };
            if (assetRec) {
              /* ① 描边已烤进 PNG，不画 */
            } else if (NONRECT[n.type]) {
              el.setAttribute('data-stroke-unrendered', '非矩形轮廓，CSS outline 画不出');
            } else if (n.type === 'TEXT') {
              /* TEXT 不画矩形 outline（2026-08-05 用户指「名字文字外的浅色矩形/边框外圈」）。
                 Figma 的 TEXT strokes 是**文字描边**（沿字形轮廓），CSS outline 只能画外接矩形 ——
                 画出来就是名字外面一圈矩形框（实测 12:48354「04/10」红框、I14:50693;14:50651
                 「超限·原相异格者」蓝框，都是设计稿里没有的多余矩形）。文字描边的正确实现是
                 -webkit-text-stroke / paint-order，那套还没接，先不画并留痕，
                 画错（多一个矩形框）比不画（少一圈描边）更糟。 */
              el.setAttribute('data-stroke-unrendered', 'TEXT 描边沿字形，CSS outline 只能画矩形外框');
            } else {
              el.style.outline = st.strokeWeight + 'px solid ' + sc;
              /* ③ 描边位置按稿里的 strokeAlign（11-B）：outline 不参与布局，
                 向外画不会推开兄弟，与 Figma 一致（stroke 只影响 renderBounds）。
                 此前一律 -weight（=INSIDE），OUTSIDE 26 + CENTER 20 = 46 处画错。 */
              const align = st.strokeAlign || 'INSIDE';
              const off = align === 'OUTSIDE' ? 0 : align === 'CENTER' ? -st.strokeWeight / 2 : -st.strokeWeight;
              el.style.outlineOffset = off + 'px';
            }
          }
        }

        if (isText) {
          el.classList.add('fx-t');
          const tx = n.text || {};
          const semantic = textContext(n);
          const constraint = textContainerConstraint(n, tx, box, semantic, parent, directOwnerBox,
            !!directOwnerEl && renderedDirectId === String(nodeParentId(n) || ''), directOwnerNode,
            truthChildrenByParentId.get(String(nodeParentId(n) || '')) || []);
          const ownerSizing = ownerSizingPolicy({
            role: semantic.role,
            align: tx.align,
            autoResize: tx.autoResize,
            ownerNode: directOwnerNode,
            ownerBox: directOwnerBox,
            directOwner: !!directOwnerEl && renderedDirectId === String(nodeParentId(n) || ''),
            sourceBox: box,
          });
          el.setAttribute('data-text-role', semantic.role);
          el.setAttribute('data-text-scene', semantic.scene);
          el.setAttribute('data-text-context-key', semantic.contextKey);
          if (semantic.ancestors.length) el.setAttribute('data-text-ancestor-names', semantic.ancestors.join(' > '));
          if (Array.isArray(n.ancestorTypes) && n.ancestorTypes.length) {
            el.setAttribute('data-text-ancestor-types', n.ancestorTypes.filter(Boolean).map(String).join(' > '));
          }
          if (n.parentId != null) el.setAttribute('data-text-parent-id', String(n.parentId));
          if (tx.fontSize != null) el.style.fontSize = tx.fontSize + 'px';
          if (tx.fontWeight != null) el.style.fontWeight = String(tx.fontWeight);
          if (typeof tx.lineHeight === 'number') el.style.lineHeight = tx.lineHeight + 'px';
          if (tx.letterSpacing) el.style.letterSpacing = tx.letterSpacing + 'px';
          if (tx.align) el.style.textAlign = String(tx.align).toLowerCase();
          if (tx.textCase === 'UPPER') el.style.textTransform = 'uppercase';
          /* 字体按【语言 + 语义角色】路由到 Figma 真源字体（见 _routeFontFamily），
             不再对所有语言一律用 zh 源字体。zh-CN 路由结果与源一致；其它语言换成
             各自的真源家族。缺本地文件的家族仍按真源路由（不拿别的字体冒充），
             加载失败由 fonts-manifest.missing + 证据 font.loaded 如实暴露。

             【2026-08-12 缺译字体回退】翻译采用判定必须早于字体路由：
             缺译文本显示的是**源 Figma 原文**（多为中文），若仍按当前 locale 路由
             （如 en→Bebas Neue / ja→Noto Sans JP），会用拉丁/日文字体渲染中文字形，
             回退字体与源 Alimama ShuHeiTi 视觉不一致 —— 09「源格觉醒」标题即此错。
             规则（通用、不看文案/node id）：仅当**采用了真实译文**才走 locale 路由；
             缺译回退原文时保留源 Figma family/weight，不路由。data-copy-missing 在
             下方照常打标留痕。 */
          const _copyByNode = t.copy && t.copy.byNode ? t.copy.byNode[nid] : null;
          const _adoptedVal = _copyByNode ? _copyByNode[ctx.prefs.lang] : null;
          const _hasAdoptedCopy = _adoptedVal != null && _adoptedVal !== '';
          const fontRoute = _hasAdoptedCopy
            ? this._routeFontFamily({
              language: ctx.prefs && ctx.prefs.lang,
              role: semantic.role,
              semanticClass: semantic.role,
              sourceFamily: tx.fontFamily,
              sourceWeight: tx.fontWeight,
            })
            : { family: tx.fontFamily, weight: tx.fontWeight, role: null, language: ctx.prefs && ctx.prefs.lang, routed: false };
          if (!_hasAdoptedCopy && String(ctx.prefs.lang || '') !== 'zh-CN') {
            el.setAttribute('data-font-source-fallback', 'unadopted-copy-keeps-source-family');
          }
          const effectiveFamily = fontRoute.family || tx.fontFamily;
          if (fontRoute.routed) {
            el.setAttribute('data-font-routed', fontRoute.language + '/' + fontRoute.role + ':' + effectiveFamily);
          }
          if (effectiveFamily) el.style.fontFamily = '"' + effectiveFamily + '", "PingFang SC", "Microsoft YaHei", sans-serif';
          if (fontRoute.routed && fontRoute.weight != null) el.style.fontWeight = String(fontRoute.weight);
          el.setAttribute('data-text-container', constraint.mode);
          el.setAttribute('data-text-container-evidence', constraint.evidence);
          if (constraint.openFlow && constraint.sectionWidth != null) el.setAttribute('data-text-section-width', String(constraint.sectionWidth));
          if (constraint.ownerWidth != null) el.setAttribute('data-text-owner-width', String(constraint.ownerWidth));
          if (constraint.ownerEvidence) el.setAttribute('data-text-owner-evidence', constraint.ownerEvidence);
          if (constraint.sourceBoxHeight != null) el.setAttribute('data-text-source-height', String(constraint.sourceBoxHeight));
          if (constraint.sourceFixedCenteredTextBox) el.setAttribute('data-text-source-centered-box', 'true');
          el.setAttribute('data-text-owner-size-policy', ownerSizing.reason);
          if (constraint.openFlow) {
            // Open-flow text keeps source font metrics and only receives the
            // section's right bound.
            if (constraint.sectionWidth != null) el.style.width = constraint.sectionWidth + 'px';
            el.style.height = 'auto';
            el.style.minHeight = (box.h ?? 0) + 'px';
            el.style.overflow = 'visible';
            el.setAttribute('data-text-vertical-growth', 'expected');
          }

          /* ═══ 按稿里的排版模式渲染，而不是一律"给个宽度自己折行" ═══
             实测的错法与后果：标题 ss5新赛季奖励 在稿里是 WIDTH_AND_HEIGHT
             （宽度由内容撑开 = 673，本来就一行），我给它 673 宽又允许折行，
             结果折成「SS5新赛季奖」+「励」两行 —— 页面上一眼就不对。

             WIDTH_AND_HEIGHT / WIDTH：宽高由内容决定 → pre，绝不折行。
               本机字体跟稿不同时行会变宽，配 text-align 让它**对称溢出**，
               视觉中心仍与稿对齐（overflow 保持 visible，不裁不藏）。
             HEIGHT / FIXED：稿里是定宽自动折行 → pre-wrap。
               pre-wrap 而不是 normal，是为了保住稿里的**真换行符**
               （2:31229「解锁赛季历战通行证，\n即可获得赛季专属奖励。」稿里就有 \n，
                当空格处理折行位置会变）。 */
          const ar = tx.autoResize || 'FIXED';
          const hugs = ar === 'WIDTH_AND_HEIGHT' || ar === 'WIDTH';
          const sourceWidthHugText = constraint.sourceWidthHugText === true;
          const inlineHugs = hugs && !sourceWidthHugText;
          /* A source-authored one-line display text is a non-wrapping title,
             not generic fixed-width body copy.  The evidence is the Figma
             lineTypes leaf (exactly one authored line) plus the display-font
             role; this preserves zh-CN source metrics and lets the existing
             locale group-fit policy scale the whole heading group when needed.
             Manual newlines remain authoritative and ordinary body text keeps
             the existing wrapping behaviour. */
          const sourceSingleLine = Array.isArray(tx.lineTypes) && tx.lineTypes.length === 1
            && String(tx.lineTypes[0] || '').toUpperCase() === 'NONE'
            && !String(tx.characters || '').includes('\n');
          const displayTitle = this._fontRoleFor({ sourceFamily: tx.fontFamily, role: semantic.role, semanticClass: semantic.className }) === 'title';
          const sourceNoWrapTitle = sourceSingleLine && displayTitle;
          el.style.whiteSpace = (inlineHugs || sourceNoWrapTitle) ? 'pre' : 'pre-wrap';
          if (sourceNoWrapTitle) el.setAttribute('data-text-layout-policy', 'source-single-line-display-title');
          if (!constraint.openFlow && !inlineHugs && constraint.ownerWidth != null) {
            // Framed text wraps within its nearest rendered Figma owner. The
            // source box remains the anchor; owner width is the available
            // local content bound for adopted languages.
            el.style.width = constraint.ownerWidth + 'px';
          }
          if (constraint.openFlow) {
            // Generic widow/orphan mitigation for open-flow translations.
            // It preserves source metrics and lets the browser choose a
            // better break; the evidence collector still records real lines.
            el.style.textWrap = 'pretty';
            el.setAttribute('data-text-layout-policy', 'pretty-wrap');
          }
          /* Figma WIDTH/WIDTH_AND_HEIGHT text grows with its adopted string.
             Keeping the source-language box as a hard width makes longer
             locales overflow even though the source explicitly hugs content.
             Preserve the source box as a minimum anchor while allowing the
             rendered leaf to expand; WIDTH_AND_HEIGHT also hugs vertically. */
          if (inlineHugs && box.w != null) {
            el.style.width = 'max-content';
            el.style.minWidth = box.w + 'px';
            if (ar === 'WIDTH_AND_HEIGHT' && box.h != null) {
              el.style.height = 'auto';
              el.style.minHeight = box.h + 'px';
            }
          }
          if (sourceWidthHugText && box.w != null) {
            el.style.width = box.w + 'px';
            el.style.minWidth = box.w + 'px';
            el.style.height = 'auto';
            el.style.minHeight = (box.h ?? 0) + 'px';
            el.style.overflow = 'visible';
            el.setAttribute('data-text-owner-width-policy', 'source-width-hug-text');
            el.setAttribute('data-text-vertical-growth', 'expected');
          }
          /* 仅紧凑标签（贴满 owner 的短徽章）才把文本框对齐到 owner 高/宽。
             说明长文（owner 远高于自身、多行）保持源框，避免把文本高度拉到
             owner 高、被 step-fit 量出 owner 高而误判超框缩字。 */
          if (semantic.role === 'character-skill-label' && directOwnerBox && ownerSizing.compactLabel === true) {
            const ownerW = Number(directOwnerBox.w ?? 0);
            const ownerH = Number(directOwnerBox.h ?? 0);
            const parentMatchesOwner = parent && parent.box
              && Math.abs(Number(parent.box.x ?? 0) - Number(directOwnerBox.x ?? 0)) <= 0.5
              && Math.abs(Number(parent.box.y ?? 0) - Number(directOwnerBox.y ?? 0)) <= 0.5
              && Math.abs(Number(parent.box.w ?? 0) - ownerW) <= 0.5
              && Math.abs(Number(parent.box.h ?? 0) - ownerH) <= 0.5;
            const centeredOwnerLabel = tx.autoResize === 'HEIGHT'
              && String(tx.align || '').toUpperCase() === 'CENTER'
              && parentMatchesOwner
              && ownerW > Number(box.w ?? 0) + 0.5
              && Math.abs((Number(box.x ?? 0) + Number(box.w ?? 0) / 2)
                - (Number(directOwnerBox.x ?? 0) + ownerW / 2)) <= 1;
            if (centeredOwnerLabel) {
              /* The text's source box is centered in the truth owner. Use the
                 full owner as the local centered label host so a longer
                 locale (e.g. a single Latin word) does not spill by a few px
                 from the text-box left anchor. */
              el.style.left = ((Number(directOwnerBox.x ?? 0) - originX)) + 'px';
              el.style.width = ownerW + 'px';
              el.style.minWidth = ownerW + 'px';
              el.setAttribute('data-text-owner-width-policy', 'truth-centered-direct-owner');
            }
            if (ownerW > Number(box.w ?? 0) + 0.5) {
              if (!centeredOwnerLabel) {
                el.style.width = ownerW + 'px';
                el.style.minWidth = ownerW + 'px';
                el.setAttribute('data-text-owner-width-policy', 'truth-direct-owner-width');
              }
            }
            if (ownerH > Number(box.h ?? 0) + 0.5 && ar === 'HEIGHT') {
              el.style.height = ownerH + 'px';
              el.style.minHeight = ownerH + 'px';
              el.style.justifyContent = 'center';
              el.setAttribute('data-text-owner-height-policy', 'truth-direct-owner-height');
            }
            if (!sourceWidthHugText && ownerW > Number(box.w ?? 0) + 0.5 && ar === 'WIDTH_AND_HEIGHT') {
              el.style.width = 'max-content';
              el.style.minWidth = ownerW + 'px';
              el.setAttribute('data-text-owner-width-policy', 'truth-direct-owner-width');
            }
          }
          if (ownerSizing.eligible && directOwnerEl) {
            const layout = ownerSizing.layout || {};
            const padTop = Number(__u(layout.paddingTop) || 0);
            const padRight = Number(__u(layout.paddingRight) || 0);
            const padBottom = Number(__u(layout.paddingBottom) || 0);
            const padLeft = Number(__u(layout.paddingLeft) || 0);
            /* HUG owners are the one generic case where the background host
               must follow a localized label. Flex makes the truth padding,
               centered alignment, and multi-line height explicit; the text
               remains source-sized in font metrics and is never shrunk. */
            directOwnerEl.style.display = 'flex';
            directOwnerEl.style.boxSizing = 'border-box';
            directOwnerEl.style.alignItems = 'center';
            directOwnerEl.style.justifyContent = 'center';
            directOwnerEl.style.width = ownerSizing.hugWidth ? 'max-content' : ownerSizing.ownerWidth + 'px';
            directOwnerEl.style.minWidth = ownerSizing.ownerWidth + 'px';
            directOwnerEl.style.height = ownerSizing.hugHeight ? 'max-content' : ownerSizing.ownerHeight + 'px';
            directOwnerEl.style.minHeight = ownerSizing.ownerHeight + 'px';
            directOwnerEl.style.padding = `${padTop}px ${padRight}px ${padBottom}px ${padLeft}px`;
            el.style.position = 'relative';
            el.style.left = 'auto';
            el.style.top = 'auto';
            el.style.width = 'max-content';
            el.style.minWidth = '0';
            el.style.height = 'auto';
            el.style.minHeight = '0';
            el.style.whiteSpace = 'pre-wrap';
            el.setAttribute('data-text-owner-size-policy', 'truth-hug-owner-content-sized');
            el.setAttribute('data-text-owner-background-sync', 'padding-flex-centered');
            directOwnerEl.setAttribute('data-owner-size-policy', 'truth-hug-owner-content-sized');
            directOwnerEl.setAttribute('data-owner-background-sync', 'padding-flex-centered');
          }
          /* TRUNCATE????????????????????
              ? overflow:hidden ?????? ?? ??????"???????"?
              ?? text-overflow:ellipsis?Chrome ? whiteSpace:pre-wrap ???????????
              ???"?????"????? */
          if (ar === 'TRUNCATE') {
            el.style.overflow = 'hidden';
            /* style.textTruncation=ENDING?2026-08-04 ?????????????????
               ?????whiteSpace:pre?? text-overflow:ellipsis ?????
               ???pre-wrap?Chrome ??????????????????????? */
            if (tx.truncation === 'ENDING' && inlineHugs) el.style.textOverflow = 'ellipsis';
          }
          /* 定宽折行配 text-wrap:balance（第 14 项）：本地化表没有稿里的手动换行
             （表行没 \n），折行位置由框宽决定 —— balance 让两行长度均衡，
             避免「励。」这种孤字。这是排版兜底，不是造假：
             丢了换行这件事本身由 data-copy-lb-lost 留痕 + 壳读数报数，不许只兜底不报。 */

          /* 文字块的高度与垂直对齐。稿里 9/9 都有实测高度且 vAlign=TOP。
             定宽折行的那些**只给 min-height 不给 height**：换语言或换字体多折一行时，
             宁可让它顶出来被冒烟测出来，也不要 height 写死后悄悄裁掉一行。 */
          if (box.h != null) el.style[inlineHugs ? 'height' : 'minHeight'] = box.h + 'px';
          const V = { TOP: 'flex-start', CENTER: 'center', BOTTOM: 'flex-end' };
          el.style.display = 'flex';
          el.style.flexDirection = 'column';
          el.style.justifyContent = V[tx.vAlign] || 'flex-start';

          /* transform 串统一在这里拼，谁要加谁 push —— 各自直接赋 el.style.transform
             会互相覆盖（渐变字居中 与 旋转 就是两个来源；filter 不在此列，它与
             transform 本就共存）。 */
          const grad = this._cssGradient(tx.color);
          const tf = [];
          /* auto-layout 的 flex item 由容器 gap/justify 排列，不能再按源坐标手动
             居中/右锚（left+translateX）——否则译文变宽后 flex 重排被这个手写
             left 抵消，标签/标题装饰又错位。只对非 auto-layout 的 hugging 文本保留。 */
          if (inlineHugs && !grad && box.w != null && tx.align && !inAutoLayout) {
            const align = String(tx.align).toUpperCase();
            if (align === 'CENTER') {
              el.style.left = (((box.x ?? 0) - originX) + (box.w ?? 0) / 2) + 'px';
              tf.push('translateX(-50%)');
            } else if (align === 'RIGHT') {
              el.style.left = (((box.x ?? 0) - originX) + (box.w ?? 0)) + 'px';
              tf.push('translateX(-100%)');
            }
          }
          /* ═══ 渐变字不定宽：background-clip:text 只在元素背景绘制区（边框盒）内上色 ═══
             实测（2026-08-04）：标题稿内框 673 宽、墨迹 702 宽 —— 稿本身就溢出 29px；
             固定框宽下，溢出部分的字形拿不到颜色 → 直接消失（「励」字被吃掉）。
             改法：宽度交给内容（max-content，min-width 保底稿框宽），水平位置锚在
             **稿框中心**：left = 中心点，translateX(-50%) 回半宽。字变长变短都对称
             涨缩，视觉中心始终与稿一致；text-align 保持稿里的值。
             纯色字不走这条：它的颜色在文字层，不受背景绘制区限制。 */
          if (grad) {
            el.style.width = 'max-content';
            if (box.w != null) el.style.minWidth = box.w + 'px';
            el.style.left = (((box.x ?? 0) - originX) + (box.w ?? 0) / 2) + 'px';
            tf.push('translateX(-50%)');
          }
          /* ═══ 半行距补偿：文字要往【下】挪半个行距 ═══
           *
           * 门 E 第一次跑就抓到的真错位（2026-08-04，用像素位移搜索逐块定量，不靠目测）：
           *   卡片标题「新赛季启程庆典」比稿【高】3 个 CSS px。
           *   稿内 字号 60 / 行高 72 → (72−60)/2 = 6 设计px = 3 CSS px。数值恰好相等。
           *   补偿后该块 MAE 26.3 → 5.01，且最佳位移归零（低于美术图的噪声底 7.4）。
           *
           * ⚠️ 方向我第一版搞反了（按"CSS 多分半行距、该往上挪"推的），改完差异反而涨。
           *    留个记号：位移搜索的 dy 是「拿 demo 的 y+dy 去对稿的 y」，
           *    dy=−3 意味着 demo 内容比稿【高】3px，不是低。别再读反。
           *
           * 机制（与实测方向一致的解释）：Figma 把**字号方框(em box)**居中放进行高里，
           * 上方留 (行高−字号)/2；CSS 居中放进去的是**字体的内容区**（ascent+descent，
           * 通常比字号高，本页 CJK 字体约 1.15em），于是 CSS 上方留得更少 ——
           * 我们的字因此偏高。这不是某个标题的偏移，是**每一页每一段文字**都有。
           *
           * 只对 vAlign=TOP 生效：
           *   CENTER —— 两边都是对称居中，本来就一致，补了反而错；
           *   BOTTOM —— 稿里 0 个样本，没有实测依据，不许猜（出现时由提取覆盖门/台账暴露）。
           *
           * 只对【非 hugs】生效（HEIGHT / FIXED / NONE），这条是实测逼出来的：
           *   WIDTH / WIDTH_AND_HEIGHT 的 box 是**墨迹撑出来的**，不是文本框
           *   —— 证据：ETHERIASS4 框高 60.96 ≠ 行高 60。给它补偿后 MAE 13.68 → 15.49 变差，
           *   限定成非 hugs 后回到 13.68。它自身还剩 dx=−1 dy=−1 的小偏移，
           *   是另一件事（hugs 文字的墨迹框与浏览器字形盒的差异），未修，别混进这条。
           *
           * 多行也对：后续各行的行距 CSS 与 Figma 同为 lineHeight，整块统一平移即可。
           */
          /* renderBox is this document's source-backed visual target. Do not
             reuse a cross-page half-leading translation: it was calibrated on
             an earlier design and shifts this page's text down. Store the
             source visual bounds for browser evidence instead. */
          const _textRenderBox = n.renderBox || {};
          const textRenderBoxReady = [_textRenderBox.x, _textRenderBox.y, _textRenderBox.w, _textRenderBox.h]
            .every((v) => Number.isFinite(Number(v)));
          if (textRenderBoxReady) {
            el.setAttribute('data-render-box-x', String(_textRenderBox.x));
            el.setAttribute('data-render-box-y', String(_textRenderBox.y));
            el.setAttribute('data-render-box-w', String(_textRenderBox.w));
            el.setAttribute('data-render-box-h', String(_textRenderBox.h));
          }
          el.setAttribute('data-text-baseline-policy', textRenderBoxReady
            ? 'source-renderbox-no-global-offset'
            : 'source-renderbox-unavailable');

          /* 文本旋转：Figma 弧度逆时针为正、CSS 顺时针，取负。
             通用（含非文本形状）的旋转在统一的 else 分支一次性应用，见该处的
             data-rotated-shape —— 这里保留文本路径，行为不变。 */
          if (typeof n.rotation === 'number' && Math.abs(n.rotation) > 1e-4) {
            tf.push('rotate(' + (-n.rotation) + 'rad)');
          }
          if (tf.length) el.style.transform = tf.join(' ');
          /* 字色。稿里两种情况，必须分开处理：
               纯色字 → text.color 是 {r,g,b,a}     → CSS color
               渐变字 → text.color 是整个 fill 对象 → CSS 渐变 + background-clip:text
             之前只走了第一条路：渐变字的 fill 对象里没有 r/g/b，_rgba 把 undefined 当 0，
             于是**渐变标题被画成纯黑**。而且它返回的是个看起来合法的黑色，
             所以 `|| '#000'` 兜底也没触发 —— 不报错、就是颜色错，这类最难发现。 */
          if (grad) {
            el.style.backgroundImage = grad;
            el.style.webkitBackgroundClip = 'text';
            el.style.backgroundClip = 'text';
            el.style.webkitTextFillColor = 'transparent';
            el.style.color = 'transparent';
            el.setAttribute('data-text-gradient', '1');
          } else {
            const col = tx.color && tx.color.color ? this._rgba(tx.color.color)
              : (tx.color && tx.color.r != null ? this._rgba(tx.color) : null);
            /* 取不到字色时**不许**默认黑 —— 黑字在深色稿上看着像"就该是黑的"，
               会把"没提到字色"伪装成"字色是黑的"。宁可打标记让它可被发现。 */
            if (col) el.style.color = col;
            else el.setAttribute('data-text-color-missing', '1');
          }

          /* 文案三级兜底，每级都留痕，不许静默变空白：
             ① 表里查到该语言 → 用它
             ② 查不到但稿里有原文 → 用原文 + data-copy-missing（门 C 抓）
             ③ 连原文都没有 → data-text-empty（说明 truth 缺 characters 叶子） */
          const hit = t.copy && t.copy.byNode ? t.copy.byNode[nid] : null;
          const val = hit ? normalizeFigmaLineBreaks(hit[ctx.prefs.lang]) : null;
          const semanticLayout = t.copy && t.copy.semanticLayout && t.copy.semanticLayout.byNode
            ? t.copy.semanticLayout.byNode[nid] : null;
          const semanticBreak = semanticLayout && semanticLayout[ctx.prefs.lang]
            && Array.isArray(semanticLayout[ctx.prefs.lang].lines)
            && semanticLayout[ctx.prefs.lang].lines.length > 1
            ? semanticLayout[ctx.prefs.lang] : null;
          /* A status visual is a locale+semantic contract, not a text override:
             retain the adopted Lark value for accessibility/audit, and replace
             only the drawn layer when a pinned official raster is registered. */
          const statusVisual = t.copy && t.copy.statusVisual ? t.copy.statusVisual : null;
          const statusBinding = statusVisual && statusVisual.byNode ? statusVisual.byNode[nid] : null;
          const statusKey = statusBinding ? String(__u(statusBinding.status)) : '';
          const statusRole = statusBinding ? String(__u(statusBinding.semanticRole)) : '';
          const statusVariant = statusBinding && statusVisual && statusVisual.variants
            && statusVisual.variants[statusKey] ? statusVisual.variants[statusKey][ctx.prefs.lang] : null;
          const fallback = normalizeFigmaLineBreaks(n.characters ?? (n.text && n.text.characters));
          /* 富文本/字符级样式覆盖：truth 带 characterStyleOverrides + styleOverrideTable 时，
             按字符下标分段渲染 span，消费每段的 fills/fontWeight 等覆盖（如「修罗」红字）。
             只有【兜底显示原文】时区间才与字符一一对应；采用译文（不同语言不同长度）时
             源字符区间不可映射，富文本不适用，退为整段单色并打 data-richtext-skipped 留痕。 */
          const _richOverrides = tx.characterStyleOverrides;
          const _richTable = tx.styleOverrideTable;
          const _hasRich = Array.isArray(_richOverrides) && _richOverrides.some((v) => Number(v) !== 0)
            && _richTable && typeof _richTable === 'object';
          if (val != null && val !== '') {
            /* 双真源（用户 2026-08-10 最终决策）：zh-CN 严守 Figma 静态字号；非 zh-CN
               且有真实译文时，按官网实测的 locale+角色目标等级重设设计坐标字号/行高
               （officialTargetDesignSize = Figma zh-CN 源 × 语言比），再交给后续组级
               统一与容器自然增长。缺译（走 fallback 原文）不进此分支，保持 Figma 字号
               并已有 data-copy-missing 标记。不改简中、不按文案/node 特判。 */
            if (String(ctx.prefs.lang || '') !== 'zh-CN' && typeof this._officialTargetDesignSize === 'function') {
              const _ot = this._officialTargetDesignSize({ sourceFontSize: tx.fontSize, sourceLineHeight: tx.lineHeight, role: semantic.role, language: ctx.prefs.lang, fontWeight: tx.fontWeight });
              if (_ot && Number.isFinite(_ot.fontSize) && _ot.ratio !== 1) {
                el.style.fontSize = _ot.fontSize + 'px';
                if (Number.isFinite(_ot.lineHeight)) el.style.lineHeight = _ot.lineHeight + 'px';
                el.setAttribute('data-official-typography-scale', String(_ot.ratio));
                /* locale 基准：官方缩放后的字号/行高是该 locale 的真实基准，后续 group-fit/runFit
                   必须在这个基准上做最严格统一，不能从 Figma 源字号重来（否则官方缩放被 runFit
                   的 tx.fontSize 重置冲掉）。存 data 供 runFit/_fitText 读取。 */
                el.setAttribute('data-locale-base-fontsize', String(_ot.fontSize));
                if (Number.isFinite(_ot.lineHeight)) el.setAttribute('data-locale-base-lineheight', String(_ot.lineHeight));
                }
            }
            /* 译文与源原文相同（如 zh-CN 恒等行）时字符区间一一对应，富文本仍适用；
               译文不同（其它语言改写了文字、长度/区间对不上源 override）时不可映射，
               退为整段并打 data-richtext-skipped 留痕，绝不把红字错位到错的字符上。 */
            if (_hasRich && String(val) === String(fallback) && !semanticBreak) this._renderRichText(el, String(val), _richOverrides, _richTable, tx);
            else {
              if (_hasRich) el.setAttribute('data-richtext-skipped', 'translated-copy-differs');
              el.textContent = semanticBreak ? semanticBreak.lines.join('\n') : val;
            }
            if (semanticBreak) {
              /* Preserve only data-approved break boundaries. This is neither
                 a node selector nor browser width wrapping: semantic layout
                 belongs to copy truth and carries its own provenance. */
              el.style.whiteSpace = 'pre-wrap';
              el.style.height = 'auto';
              el.style.minHeight = (Number(box.h) || 0) + 'px';
              el.setAttribute('data-text-layout-policy', 'semantic-explicit-break');
              el.setAttribute('data-semantic-break-lines', String(semanticBreak.lines.length));
              el.setAttribute('data-semantic-break-provenance', String((semanticBreak.provenance || {}).kind || 'unspecified'));
            }
            /* 手动换行丢失留痕（第 14 项）：稿内原文带 \n 而表行没有 —— 显示的译文
               按框宽自然折行，折的位置与稿不同。打标让壳能现数（读数「换行丢失 N 条」），
               不许静默。（显示原文兜底时不算丢失：原文里的 \n 还在。） */
            if (String(fallback ?? '').includes('\n') && !String(val).includes('\n')) {
              el.setAttribute('data-copy-lb-lost', '1');
              /* text-wrap:balance 只给【真的丢了换行】的这条加，不给所有定宽文字加。
                 这条限定是门 E 逼出来的（2026-08-04）：balance 会改折行位置，
                 而卡片三正文的文案与稿**完全相同**，套上 balance 后折行与稿不一致，
                 像素比对报出一整段差异（该块 MAE 32，位移搜索也对不上 —— 因为不是位移）。
                 原来的写法是 `if (!hugs) textWrap='balance'`，一刀切在所有定宽文字上：
                 为了救 1 条丢换行的，把另外 N 条本来对的折乱了。 */
              if (!inlineHugs) el.style.textWrap = 'balance';
            }
          } else if (fallback != null && fallback !== '') {
            if (_hasRich) this._renderRichText(el, String(fallback), _richOverrides, _richTable, tx);
            else el.textContent = fallback;
            el.setAttribute('data-copy-missing', ctx.prefs.lang);
          } else {
            el.textContent = '';
            el.setAttribute('data-text-empty', '1');
          }
          if (statusBinding && statusVariant && statusRole === String(semantic.role || '')) {
            const visual = document.createElement('img');
            visual.className = 'fx-status-visual-asset';
            visual.setAttribute('data-asset-src', String(__u(statusVariant.file)));
            visual.setAttribute('data-asset-state', 'deferred');
            visual.alt = '';
            visual.setAttribute('loading', 'eager');
            visual.decoding = 'async';
            visual.setAttribute('data-status-visual-asset', String(__u(statusVariant.assetKey)));
            visual.style.position = 'absolute';
            visual.style.left = '50%'; visual.style.top = '50%';
            visual.style.width = Number(__u(statusVariant.intrinsic.width)) + 'px';
            visual.style.height = Number(__u(statusVariant.intrinsic.height)) + 'px';
            visual.style.transform = 'translate(-50%, -50%)';
            visual.style.objectFit = 'contain';
            el.textContent = '';
            el.setAttribute('aria-label', String(val ?? fallback ?? ''));
            el.setAttribute('data-copy-visual-substituted', 'status-visual-asset');
            el.setAttribute('data-status-visual-status', statusKey);
            el.setAttribute('data-status-visual-evidence', String(__u((statusVariant.provenance || {}).evidenceStatus) || 'verified'));
            el.style.position = 'relative'; el.style.width = '100%'; el.style.height = '100%';
            el.style.minWidth = '0'; el.style.minHeight = '0'; el.style.overflow = 'visible';
            el.appendChild(visual);
            if (directOwnerEl && __u(statusVariant.backgroundIncluded) === true) {
              directOwnerEl.style.background = 'transparent';
              directOwnerEl.setAttribute('data-status-visual-owner-background', 'asset-baked');
            }
          } else if (statusBinding) {
            el.setAttribute('data-status-visual-unavailable-locale', String(ctx.prefs.lang));
          }
          /* This must run after the framed-text constraint above: that
             general rule assigns the stale source owner width to translated
             HEIGHT text.  A source HUG row with a FILL title is different:
             its title track participates in the row's intrinsic width, so
             the rendered locale glyph width is the true main-axis input.
             Keep this narrowly structural (the parent is already proven to
             be HUG + FILL text + fixed siblings), never a title/node rule. */
          if (el.getAttribute('data-auto-layout-hug-fill-text-track')) {
            el.style.flex = '0 0 auto';
            el.style.flexGrow = '0';
            el.style.width = 'max-content';
            el.style.minWidth = 'max-content';
          }
          if (el.getAttribute('data-auto-layout-hug-text-track') === 'source-leaf-floor') {
            const sourceLeafWidth = Number(box.w);
            el.style.flex = '0 0 auto';
            el.style.flexGrow = '0';
            el.style.width = 'max-content';
            el.style.minWidth = Number.isFinite(sourceLeafWidth) && sourceLeafWidth > 0
              ? sourceLeafWidth + 'px' : '0';
          }
          /* Step-fit shrink is an explicit-permission tool, not a default.
             Only Figma-explicit fixed/clip/truncate (or a truth fit authorization)
             may shrink; HEIGHT translation text without explicit truncation keeps
             its source fontSize/lineHeight and may grow vertically instead. */
          /* Stepped font-size fit is an authorized, floor-bounded tool, not a
             default. Who may shrink comes from the shared policy helper
             (mirrored _fitAuthorization): a bounded framed owner is an
             authorized fixed-UI range, so translated copy fits it instead of
             overflowing; open-flow / unbounded HEIGHT keeps source metrics. */
          const fitAuth = this._fitAuthorization({
            autoResize: ar,
            truncation: tx.truncation,
            clipsContent: n.clipsContent === true,
            isMask: n.isMask === true,
            explicitFit: tx.fit === true || n.fit === true,
            openFlow: constraint.openFlow === true,
            boundedOwner: constraint.openFlow !== true && constraint.ownerWidth != null,
            layoutSizingVertical: sourceWidthHugText
              ? 'HUG'
              : __u(n.layout && n.layout.layoutSizingVertical),
          });
          const fitAuthorized = fitAuth.authorized;
          el.setAttribute('data-fit-policy', fitAuth.reason);
          /* 组级 fit：同级标题/正文组共享一个组件级祖先。ownerPath 末两段是节点自身
             与直接父（各卡不同），去掉后用共享祖先前缀做组标识，同组兄弟落到同一组。
             组标识来自 truth 祖先路径，不看节点 id、不看文案。runFit 时同组统一 scale，
             避免逐节点独立 step-fit 造成同组字号不一（官网实证：同一组件组统一字号）。 */
          /* 组标识 = 最内层容器祖先（ancestorNames 末项）+ 语义角色 + 源字号。
             同级标题/正文组（02 奖励卡组、角色名卡组等）共享同一个最内层组件容器
             （如奖励卡行的 Frame、角色名行的 Frame），文案/节点 id 不参与。
             这比 ownerPath 固定截层级稳：组件嵌套深度不一，但同级组的最内层容器一致。 */
          const _ancestorNames = Array.isArray(n.ancestorNames) ? n.ancestorNames.map((a) => String(__u(a) || a || '')).filter(Boolean) : [];
          /* 组标识 = 直接父容器名 + 语义角色 + 源字号。同级同位文本（各卡标题位/正文位）
             共享同一个直接父容器名（02/03 标题槽都复用同一组件 Frame 名）。比 ancestorNames
             末项稳：末项可能是节点自身/更深层包装，同组件位兄弟的直接父容器才同名。 */
          const _parentName = String(__u(directOwnerNode && directOwnerNode.name) || '');
          const _fallbackContainer = _ancestorNames.length ? _ancestorNames[_ancestorNames.length - 1] : '';
          const _fitGroupKey = (_parentName || _fallbackContainer) + '|' + String(semantic.role || '') + '|' + String(tx.fontSize ?? '');
          /* Figma's fixed single-line display-title slot is a genuine inner
             content bound.  For translated siblings, preserve the widest
             source sibling's glyph clearance inside that slot; longest target
             decides a shared step scale. zh-CN remains Figma-exact. */
          const _localizedSourceTitle = sourceNoWrapTitle && !semanticBreak
            && String(ctx.prefs && ctx.prefs.lang || '') !== 'zh-CN'
            && val != null && !inlineHugs && !constraint.openFlow && Number(box.w) > 0;
          /* zh-CN static copy keeps Figma fontSize/lineHeight/align/wrap.
             Official-site wrap/weight is a later Translation axis. Step-fit on
             zh-CN was shrinking 体验优化 titles that already match the source. */
          const _zhSourceExact = String(ctx.prefs && ctx.prefs.lang || '') === 'zh-CN';
          if (_zhSourceExact) {
            el.setAttribute('data-fit-policy', 'zh-cn-figma-exact');
            el.setAttribute('data-text-layout-policy',
              el.getAttribute('data-text-layout-policy') || 'figma-exact');
          }
          if (!_zhSourceExact && !inlineHugs && !constraint.openFlow && (fitAuthorized || _localizedSourceTitle || semanticBreak)) {
            el.setAttribute('data-fit-group', _fitGroupKey);
            if (_localizedSourceTitle) {
              el.setAttribute('data-fit-inline-policy', 'source-title-group-glyph-safe-width');
              el.setAttribute('data-fit-inline-slot-width', String(Number(box.w)));
            }
            fitCandidates.push({
              el, tx, box, groupKey: _fitGroupKey,
              sourceTitleInlineSafe: _localizedSourceTitle,
              sourceTitleText: _localizedSourceTitle ? String(fallback || '') : '',
              semanticBreak: !!semanticBreak,
            });
          }
          else if (!inlineHugs && !constraint.openFlow) {
            /* HEIGHT wrapped text keeps source metrics; growth is evidence, not error. */
            el.setAttribute('data-fit-growth', 'natural');
            /* 垂直 HUG 文本所在的 HUG owner 容器也要随内容增高（官网实证：02 奖励卡
               三卡容器高度随文案 29/43/58 增长，不钉死源高、不对字多的卡缩字号）。
               只认 truth 的 layoutSizingVertical:HUG，不看节点 id；把 owner 元素记进
               hugGrowthOwners，runFit 之后按其内容所需高度放开（min-height 保源高）。 */
            if (String(fitAuth.reason || '') === 'hug-vertical-natural-growth') {
              /* 文本元素自身高度随内容（height:auto + min-height 保源高）：钉死 height
                 会让 scrollHeight 量出比 clientHeight 大一个 CJK 行框取整差（~1.15em），
                 被检查器误判成 verticalOverflow。官网同字号下这些框本来就随内容。 */
              el.style.height = 'auto';
              el.style.minHeight = (box.h ?? 0) + 'px';
              if (directOwnerEl && String(__u((directOwnerNode && directOwnerNode.layout) && directOwnerNode.layout.layoutSizingVertical) || '').toUpperCase() === 'HUG') {
                hugGrowthOwners.push({ ownerEl: directOwnerEl, textEl: el, sourceOwnerH: Number(directOwnerBox && directOwnerBox.h) || null });
              }
            }
          }
          /* A hugging (WIDTH_AND_HEIGHT) label inside a bounded fixed frame is a
             button/tag label: the frame is a hard horizontal bound, so a longer
             adopted string must shrink to fit the owner range instead of
             spilling past the button edge. Fit it on WIDTH (single-line labels),
             still floor-bounded and review-flagged; centering is preserved. */
          /* Only a genuine compact button/tag label gets the bounded width fit.
             A content heading/title (left-aligned, or a frame much wider than
             the text, or a multi-line-height frame) must keep hugging its
             content and never be squeezed; the button label is the case where a
             small centered label sits in a frame only slightly larger than the
             source text, so a longer adopted string would spill the frame edge. */
          const _ownerH = directOwnerBox && Number.isFinite(Number(directOwnerBox.h)) ? Number(directOwnerBox.h) : null;
          const _ownerW = constraint.ownerWidth;
          const _srcW = Number(box.w ?? 0), _srcH = Number(box.h ?? 0);
          const _centered = String(tx.align || '').toUpperCase() === 'CENTER';
          /* A real button/tag label nearly fills its frame (the frame exists to
             hold that one label). A card title/heading is much smaller than its
             card, so the source-text-to-owner ratio separates the two: labels
             fill most of the owner in both axes; headings do not. */
          const _fillsOwner = _ownerW != null && _ownerH != null && _srcW > 0 && _srcH > 0
            && _srcH >= _ownerH * 0.6 && _srcW >= _ownerW * 0.55;
          const boundedHugLabel = inlineHugs && !constraint.openFlow && _centered && _fillsOwner;
          if (boundedHugLabel) {
            el.setAttribute('data-fit-policy', 'bounded-hug-label');
            fitCandidates.push({ el, tx, box, widthFit: _ownerW, heightFit: _ownerH });
          }
        } else {
          el.style.height = ((box.h ?? 0) + (Number(el.getAttribute('data-hscroll-gutter-h')) || 0)) + 'px';
          /* 通用旋转：Figma rotation 对**所有**节点类型生效，不只 TEXT。此前只有
             TEXT 分支消费 rotation，非文本形状（箭头/斜切装饰等）被画成未旋转的
             盒子 —— 09「更多」右箭头(1:850 REGULAR_POLYGON rotation=90°)因此没有转向。
             box 是未旋转布局框、AABB(absoluteRenderBounds)已是旋转后外框，所以这里
             只对**未切图**的节点施加 rotate 变换（切图 PNG 已烘焙旋转，不可再转）。
             Figma 弧度逆时针为正、CSS 顺时针，取负。 */
          if (!assetUrl && typeof n.rotation === 'number' && Math.abs(n.rotation) > 1e-4) {
            el.style.transform = (el.style.transform ? el.style.transform + ' ' : '') + 'rotate(' + (-n.rotation) + 'rad)';
            el.setAttribute('data-rotated-shape', String(n.rotation));
          }
          /* ═══ 「有图用图，没图用 CSS，只有 IMAGE 填充缺图才算缺」 ═══
             判据是**资产清单里有没有这个节点**，不是在这儿再判一遍"该不该切图"。
             之前渲染层自己判（前缀 img/bg/kv 或填充是渐变/图片 → 要图），
             与 figma-assets 的规则是两份实现 —— 今天规则一改（纯渐变不再切图），
             渲染层立刻多出一堆"缺图"占位。一条规则只能有一处。
             IMAGE 填充是唯一必须靠导出的情况：位图 CSS 画不出来，没图就是真缺图。 */
          const hasImageFill = Array.isArray(st.fills)
            && st.fills.some((f) => f && f.visible !== false && f.type === 'IMAGE');
          /* A source image fill must have an exported asset; every other
             asset decision is owned by assets-manifest. Do not re-create the
             extractor's img/bg/kv or gradient slicing heuristic here. */
          const requiresAsset = hasImageFill;
          /* 非矩形节点没切到图 → 只能按外接矩形画填充（轮廓 CSS 画不出）。
             ≥24px 的已被 figma-assets 切走（第 13 项）；剩下 <24px 的（6×6 色点等）
             矩形近似肉眼无差 —— 但近似不许静默：打 data-shape-approx 留痕，
             探针会数。有资产（切了图）的走 <img>，轮廓在 PNG 里是准的，不标。 */
          const NONRECT_T = { VECTOR: 1, BOOLEAN_OPERATION: 1, STAR: 1, POLYGON: 1, REGULAR_POLYGON: 1, ELLIPSE: 1, LINE: 1 };
          if (NONRECT_T[n.type] && !assetUrl) el.setAttribute('data-shape-approx', 'rect');
          /* REGULAR_POLYGON(3 点=三角形)未切图时，用 clip-path 画出真实三角轮廓，
             而不是外接矩形。Figma 正多边形内接于 box、首顶点朝上，三角形轮廓即
             上顶点+左下+右下；旋转交给下面的 transform（box 是未旋转布局框，AABB
             已含旋转），两者正交。这把 09「更多」右侧箭头(1:850, rotation=90°)从
             白色小方块还原成指向右的三角箭头。pointCount 缺省按 Figma 默认 3。 */
          const _pc = Number(n.pointCount ?? n.pointcount ?? 3);
           if (n.type === 'REGULAR_POLYGON' && !assetUrl && (!Number.isFinite(_pc) || _pc === 3)) {
             el.style.clipPath = 'polygon(50% 0%, 0% 100%, 100% 100%)';
             el.setAttribute('data-shape-polygon', 'triangle');
             el.removeAttribute('data-shape-approx');
           }
           /* BOOLEAN/VECTOR btn arrows are composite contours. Inventing CSS
              chevrons or diamonds is forbidden. A missing slice stays a
              missing-shape mark (`data-shape-approx`), never a white rectangle
              pretending to be the Figma boolean. */
          /* Blend-overlay layer (extractor punched it through the asset lock). A baked
             export rasterizes this node on a transparent canvas, so the node-level
             SOFT_LIGHT loses its page backdrop and the PNG already bakes to a flat
             near-white fill — re-blending that PNG cannot recover the lost mix. Draw
             the node's own SOLID base fill (the Figma source color) and let the
             node-level mix-blend-mode compose it against the real painted background,
             which is the documented SOFT_LIGHT contract. An OVERLAY/IMAGE texture
             sub-fill has no exported per-layer asset here; that sub-layer is recorded
             as a known gap rather than guessed. */
          const __blendBmc = this._blendCss(__u(st.blendMode));
          if (__blendLiftable && !assetUrl && __blendBmc && __blendBmc.css) {
            const __solidBase = (st.fills || []).find((fl) => fl && fl.visible !== false && fl.type === 'SOLID');
            const __hasOverlayTexture = (st.fills || []).some((fl) => fl && fl.visible !== false && fl.type === 'IMAGE');
            const __ownerRec = bakedOwnerId ? this._assetRec(bakedOwnerId) : null;
            const __ownerUrl = __ownerRec ? (__ownerRec.file || __ownerRec.url || __ownerRec.src || null) : null;
            const __ownerNode = bakedOwnerId ? truthNodeById.get(bakedOwnerId) : null;
            const __ownerBox = __ownerNode && __ownerNode.box ? __ownerNode.box : null;
            /* The owner PNG's opaque pixels inside this layer's box are exactly the
               vector shape (barcode + caption); its transparent pixels are the gaps.
               Use it as a mask-image (alpha) so the SOLID base fill only lands on the
               shape, never filling the gaps into a solid band. mask is sized/offset to
               the owner box so this layer's box crops the correct sub-region. */
            if (__solidBase && __ownerUrl && __ownerBox && !(__ownerRec && __ownerRec.exportBox)) {
              el.style.background = this._solidFill([__solidBase]);
              el.style.mixBlendMode = __blendBmc.css;
              const mx = (Number(box.x ?? 0) - Number(__ownerBox.x));
              const my = (Number(box.y ?? 0) - Number(__ownerBox.y));
              el.style.webkitMaskImage = 'url("' + __ownerUrl + '")';
              el.style.maskImage = 'url("' + __ownerUrl + '")';
              el.style.webkitMaskRepeat = 'no-repeat';
              el.style.maskRepeat = 'no-repeat';
              el.style.webkitMaskSize = Number(__ownerBox.w) + 'px ' + Number(__ownerBox.h) + 'px';
              el.style.maskSize = Number(__ownerBox.w) + 'px ' + Number(__ownerBox.h) + 'px';
              el.style.webkitMaskPosition = (-mx) + 'px ' + (-my) + 'px';
              el.style.maskPosition = (-mx) + 'px ' + (-my) + 'px';
              el.setAttribute('data-blend-overlay', String(__u(st.blendMode)));
              if (__hasOverlayTexture) el.setAttribute('data-blend-overlay-texture-gap', '1');
            } else {
              /* This blend layer was deliberately punched through the asset lock by
                 the extractor, but cannot be CSS-rebuilt right now (owner has an
                 expanded exportBox so no aligned mask, or no SOLID base). Its paint
                 is already inside the owner PNG; drawing it again would double the
                 visual. Tag it so the duplicate-paint gate excludes it exactly the
                 way it excludes data-blend-overlay, and leave the pixel to the bake. */
              el.setAttribute('data-blend-overlay-unresolved', __solidBase ? 'no-owner-mask' : 'no-solid-base');
              el.setAttribute('data-blend-overlay', String(__u(st.blendMode)) + ':baked');
            }
          } else if (assetUrl || requiresAsset) {
            const url = assetUrl;
            /* A non-default-blend layer rendered from its own exported PNG is a
               deliberate re-composite above the baked owner (the owner PNG flattened
               the blend against a transparent canvas). Tag it so the duplicate-paint
               gate recognizes this as the intended mix, not a boolean/rect fragment. */
            if (__blendLift) {
              el.setAttribute('data-blend-overlay', String(__u(st.blendMode)) + ':png');
              if (!__blendLiftable) el.setAttribute('data-blend-overlay-texture-gap', '1');
            }
            const imageFills = (st.fills || [])
              .map((fill, index) => ({ fill, index }))
              .filter((entry) => entry.fill && entry.fill.visible !== false && entry.fill.type === 'IMAGE');
            /* A ready package's node-level slice is the declared composite
               output for this owner.  Prefer it over a global imageRef lookup:
               the same imageRef can legitimately appear in PC/mobile contexts
               with different crop/export ownership.  Resolving the fill first
               used the wrong (PC) EWS panorama in the mobile owner and then
               stretched it into the mobile source box.  Packed qa-assets may
               omit sliceExport/sha256/kind and keep only `{file,imageRefs}`;
               that thin record is still this owner's delivered composite.
               Only fall back to a global imageRef when this owner has no file. */
            const hasDeliveredComposite = !!(assetRec && url);
            const resolvedFillEntries = imageFills.map((entry) => ({
              fill: entry.fill,
              index: entry.index,
              url: hasDeliveredComposite
                ? url
                : (this._assetFileForImageRef(entry.fill && entry.fill.imageRef, assetRec)
                  || (imageFills.length === 1 ? url : null)),
            }));
            const imageEntries = String(assetRec?.kind || '').toUpperCase() === 'SVG' && url
              ? [{ fill: null, index: 0, url, composite: true }]
              : (imageFills.length ? resolvedFillEntries : [{ fill: null, index: 0, url }]);
            /* Figma paints multi-fill nodes bottom-to-top. An IMAGE fill does
               not replace a preceding SOLID fill: many calendar/card cells use
               a translucent texture over a colored base. Preserve the source
               SOLID base on the host only when this owner actually has IMAGE
               fills that need that plate.

               A delivered BOOLEAN/VECTOR slice already bakes the SOLID fill
               into the contour. Painting that SOLID as CSS background turns
               the owner box into a white rectangle under the chevron.
               SVG composite owners stay a single source asset and must not
               receive an inferred CSS fill either. */
            const hostNeedsSolidPlate = imageFills.length > 0
              && String(assetRec?.kind || '').toUpperCase() !== 'SVG';
            if (hostNeedsSolidPlate) {
              const solidBase = (st.fills || []).find((fill) => fill && fill.visible !== false && fill.type === 'SOLID');
              if (solidBase) {
                const solidCss = this._solidFill([solidBase]);
                if (solidCss) {
                  el.style.background = solidCss;
                  el.setAttribute('data-solid-base-fill', 'source-multifill');
                }
              }
            }
            let mountedImageCount = 0;
            for (const entry of imageEntries) {
              if (!entry.url) {
                if (entry.fill && entry.fill.imageRef) {
                  el.setAttribute('data-asset-fill-missing', String(entry.fill.imageRef));
                  el.setAttribute('data-asset-fill-index', String(entry.index));
                }
                continue;
              }
              const img = document.createElement('img');
              img.className = 'fx-img';
              if (el.getAttribute('data-shadow-via') === 'asset-baked') img.setAttribute('data-shadow-source', 'asset');
              if (el.getAttribute('data-blur-via') === 'asset-baked') img.setAttribute('data-blur-source', 'asset');
              /* ═══ fx-img 必须填满 owner 盒，禁止用原始像素尺寸 ═══
                 exportBox：已有精确的 mask/export 边界，按它绝对定位到 owner 内。
                 无 exportBox：img 必须 100% 填满 owner（width/height/object-fit:fill），
                 禁止走 intrinsic 尺寸 —— 页面缩 0.5 时原图会 2 倍溢出 owner 框。 */
              img.style.position = 'absolute';
              if (exportBox) {
                img.style.left = ((exportBox.x ?? box.x ?? 0) - (box.x ?? 0)) + 'px';
                img.style.top = ((exportBox.y ?? box.y ?? 0) - (box.y ?? 0)) + 'px';
                img.style.width = (exportBox.w ?? box.w ?? 0) + 'px';
                img.style.height = (exportBox.h ?? box.h ?? 0) + 'px';

                /* `sliceExport.bounds: render` says where the node was visible
                   in the source canvas; it does not guarantee that the delivered
                   PNG canvas itself was cropped to that visible range.  Scroll
                   tracks and switch previews deliberately export a full owner
                   canvas even when their source renderBox is just the clipped
                   viewport.  Detect that from the *delivered bytes* on load:
                   when their intrinsic aspect follows the owner box rather than
                   the renderBox, keep the complete asset in its real owner and
                   let the already-proven source clip ancestor do the cropping.
                   This is geometry-based (not node/name special casing) and keeps
                   genuinely render-bound shadows/overhang exports unchanged. */
                const fillOwnerCanvas = (objectFit, policy, extra = {}) => {
                  img.style.left = '0';
                  img.style.top = '0';
                  img.style.width = '100%';
                  img.style.height = '100%';
                  img.style.objectFit = objectFit;
                  Object.assign(img.style, extra);
                  el.setAttribute('data-asset-bounds-resolved', policy);
                };
                const fitDeliveredCanvas = () => {
                  const nw = Number(img.naturalWidth), nh = Number(img.naturalHeight);
                  const ow = Number(box.w), oh = Number(box.h);
                  const rw = Number(exportBox.w), rh = Number(exportBox.h);
                  if (![nw, nh, ow, oh, rw, rh].every(Number.isFinite)
                    || nw <= 0 || nh <= 0 || ow <= 0 || oh <= 0 || rw <= 0 || rh <= 0) return;
                  const aspectDistance = (w, h) => Math.abs((nw / nh) - (w / h));
                  const ownerDistance = aspectDistance(ow, oh);
                  const renderDistance = aspectDistance(rw, rh);
                  /* Require a clear winner so an expanded shadow box that shares
                     the same aspect ratio does not lose its render-bound mapping. */
                  if (ownerDistance <= 0.035 && ownerDistance + 0.08 < renderDistance) {
                    fillOwnerCanvas('fill', 'owner-canvas-from-delivered-png');
                  } else {
                    el.setAttribute('data-asset-bounds-resolved', 'render-canvas-from-delivered-png');
                  }
                };
                img.addEventListener('load', fitDeliveredCanvas, { once: true });
              } else {
                img.style.top = '0';
                img.style.left = '0';
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'fill';
              }
              img.setAttribute('data-asset-src', entry.url);
              img.setAttribute('data-image-fill-index', String(entry.index));
              if (entry.fill && entry.fill.imageRef) img.setAttribute('data-image-ref', String(entry.fill.imageRef));
              if (entry.composite) img.setAttribute('data-asset-composite', 'source-svg');
              /* Indicator component-context PNGs are tiny and sit on the initial
                 Figma snapshot. Deferring src leaves an empty 24x25 box, which
                 reads as a missing progress mark. Keep every other asset deferred. */
              if (__indComponentFallback) {
                img.setAttribute('src', entry.url);
                img.setAttribute('data-asset-state', 'eager');
              } else {
                img.setAttribute('data-asset-state', 'deferred');
              }
              img.setAttribute('alt', n.name ?? '');
              img.setAttribute('loading', 'eager');
              img.setAttribute('decoding', 'async');
              el.appendChild(img);
              mountedImageCount += 1;
            }
            if (mountedImageCount) {
              /* Asset owner must clip its baked image and serve as the containing
                 block for its absolute-positioned fx-img. Without this, a scaled
                 page exposes the image's intrinsic edge beyond the owner box.
                 img/ frames whose PNG is a render-bound spill canvas must still
                 clip to the layout box so the visible border, not the shadow
                 canvas, is the frame the rest of the module is measured against. */
              if (!el.style.overflow || el.style.overflow === 'visible') el.style.overflow = 'hidden';
              if (!el.style.position) el.style.position = 'relative';
              if (mountedImageCount > 1) el.setAttribute('data-multifill-images', String(mountedImageCount));
              if (exportBox && pfx === 'img') el.setAttribute('data-owner-box-clip', 'img-frame');
            } else {
              // 宁可显示"这里缺一张图"，也不要用纯色糊过去假装做好了
              el.classList.add('fx-img-ph');
              el.setAttribute('data-asset-pending', pfx || kind);
              el.title = String(n.name ?? '');
            }
          } else if (kind === 'solid') {
            /* ?????SOLID+SOLID ???Figma fills ????????
               CSS background ??????????? ?? ?????????????
               ? SOLID ???? background ?????? IMAGE/GRADIENT ???
               ? figma-assets ??????????????????? ? ???? */
            const visFills = (st.fills || []).filter((f) => f && f.visible !== false);
            if (visFills.length > 1 && visFills.every((f) => f.type === 'SOLID')) {
              const cols = visFills.map((f) => this._solidFill([f]));
              el.style.background = cols.join(', ');
              el.setAttribute('data-multifill', String(visFills.length));
            } else {
              el.style.background = this._solidFill(st.fills);
            }
          } else if (kind === 'gradient') {
            /* 单层渐变由 CSS 精确绘制（角度与色标都是稿里的原值）。
               figma-assets 已经把这类节点排除在切图之外 —— 原因是实测两张满页高的
               渐变被 Figma 在 16384px 处静默截断，拉伸后把渐变压扁了约 5%。 */
            const g = this._cssGradient((st.fills || []).filter((f) => f && f.visible !== false)[0]);
            if (g) {
              el.style.backgroundImage = g;
              el.setAttribute('data-css-gradient', '1');
            } else {
              // 画不出来也不许静默：留标记，让探针能抓到
              el.setAttribute('data-gradient-unrendered', '1');
            }
          }
        }

        // 挂到父节点下（没有父节点才挂 stage）。DFS 先序 → 同级 append 顺序即绘制顺序。
        (parent ? parent.el : container).appendChild(el);
        /* One inventory bg/* sheet, two views: the clipped first-screen crop
           and the unscaled tail that continues behind later sections. */
        if (!parent && el.getAttribute('data-hero-visual-plane') === 'bg'
          && heroLayoutOffsetDesign > 0 && heroCropWindowDesign > 0) {
          const sourceH = Number(box.h);
          const clipH = Number(el.getAttribute('data-hero-visual-clip') || 0);
          if (sourceH > clipH + 0.5 && clipH > 0) {
            const tail = el.cloneNode(true);
            tail.style.transform = '';
            tail.style.left = ((box.x ?? 0) - originX) + 'px';
            tail.style.clipPath = 'inset(' + clipH + 'px 0 0 0)';
            tail.style.top = ((Number.parseFloat(el.style.top) || 0) + heroLayoutOffsetDesign) + 'px';
            tail.removeAttribute('data-hero-visual-plane-scale');
            tail.setAttribute('data-hero-visual-plane', 'bg-tail');
            container.appendChild(tail);
          }
        }
        const record = {
          seq,
          el,
          box,
          assetLock: !!assetRec && !bakeReleasedForLiveHscroll && evidenceAttrs?.['data-hscroll'] == null,
          nid: String(__u(nid)),
          layout: n.layout || null,
          hscrollSurface: el.getAttribute('data-hscroll-surface') === 'true'
            || evidenceAttrs?.['data-hscroll-overflow-child'] === 'true'
            || !!(parent && parent.hscrollSurface),
        };
        renderedById.set(String(__u(nid)), record);
        stack.push(record);
        /* Direct component instances normally include their descendants in
           the page list.  If they do not, consume the exact selected variant
           tree from the ready component graph after the main tree finishes.
           Waiting avoids duplicate content when a regular instance does have
           page descendants later in DFS order. */
        const componentId = String(__u(n.componentId) || '');
        const componentTree = componentId ? componentInstanceTrees.get(componentId) : null;
        if (!suppressInteractions && componentTree && pfx !== 'switch') {
          componentInstanceOwners.push({ el, tree: componentTree, ownerBox: box, ownerId: String(__u(nid)), prefix: pfx });
        }
        if (!suppressInteractions && evidenceAttrs && evidenceAttrs['data-switch-page-source'] === 'component-set-variant'
          && evidenceAttrs['data-btn-variant'] !== 'true') {
          attachPlatformVariantGraph(n);
          const rawGraph = __plain((n && n.componentVariantGraph)
            || (rawList && rawList[ni] && rawList[ni].componentVariantGraph));
          const selectedComponentId = String(__u(n.componentId) || '');
          const variantIndex = Array.isArray(rawGraph && rawGraph.variants)
            ? rawGraph.variants.findIndex((variant) => String(variant && variant.componentId) === selectedComponentId) : -1;
          const trees = Array.isArray(rawGraph && rawGraph.variantTrees) ? rawGraph.variantTrees : [];
          if (variantIndex >= 0 && trees.length === Number(evidenceAttrs['data-switch-variant-count'])) {
            componentVariantOwners.push({ el, trees, initialIndex: variantIndex, switchId: evidenceAttrs['data-switch'], ownerBox: box });
          }
        }
        if (!suppressInteractions && evidenceAttrs && evidenceAttrs['data-dropmenu'] === 'true'
          && evidenceAttrs['data-dropmenu-state'] !== 'invalid') {
          attachPlatformVariantGraph(n);
          const rawGraph = __plain((n && n.componentVariantGraph)
            || (rawList && rawList[ni] && rawList[ni].componentVariantGraph));
          const selectedComponentId = String(__u(n.componentId) || '');
          const variants = Array.isArray(rawGraph && rawGraph.variants) ? rawGraph.variants : [];
          const trees = Array.isArray(rawGraph && rawGraph.variantTrees) ? rawGraph.variantTrees : [];
          const variantIndex = variants.findIndex((variant) => String(variant && variant.componentId) === selectedComponentId);
          if (variantIndex >= 0 && trees.length === variants.length
            && dropmenuOnOffTokens(variants, (variant) => __u(variant && variant.name))) {
            dropmenuOwners.push({
              el,
              trees,
              variants,
              initialIndex: variantIndex,
              ownerBox: box,
            });
          }
        }
        if (!suppressInteractions && evidenceAttrs && evidenceAttrs['data-btn-variant'] === 'true') {
          attachPlatformVariantGraph(n);
          const rawGraph = __plain((n && n.componentVariantGraph)
            || (rawList && rawList[ni] && rawList[ni].componentVariantGraph));
          const selectedComponentId = String(__u(n.componentId) || '');
          const variants = Array.isArray(rawGraph && rawGraph.variants) ? rawGraph.variants : [];
          const trees = Array.isArray(rawGraph && rawGraph.variantTrees) ? rawGraph.variantTrees : [];
          const variantIndex = variants.findIndex((variant) => String(variant && variant.componentId) === selectedComponentId);
          if (variantIndex >= 0 && trees.length === variants.length && variants.length >= 2) {
            independentButtonOwners.push({
              el,
              trees,
              variants,
              initialIndex: variantIndex,
              ownerBox: box,
              group: evidenceAttrs['data-btn-variant-group'] || String(__u(nid)),
            });
          }
        }
      }
      /* Keep the rendered instance tree as the initial Figma component state,
         then materialize only source-backed alternate component trees. The
         layers are mutually exclusive and have no CSS transition: component
         variants with explicit-empty prototype evidence mean replacement,
         not a fabricated track or easing curve. */
      for (const owner of componentVariantOwners) {
        const base = document.createElement('div');
        base.setAttribute('data-switch-variant-base', 'true');
        base.setAttribute('data-switch-variant-content', 'true');
        base.setAttribute('data-switch', String(owner.switchId));
        base.setAttribute('data-switch-variant-index', String(owner.initialIndex));
        base.setAttribute('aria-hidden', 'false');
        base.style.position = 'absolute';
        base.style.left = '0'; base.style.top = '0';
        base.style.width = '100%'; base.style.height = '100%';
        const originalChildren = [...owner.el.children];
        for (const child of originalChildren) base.appendChild(child);
        owner.el.appendChild(base);
        /* Flattened INSTANCE descendants can paint as siblings of the switch
           owner. Moving them into the owner changes their coordinate origin and
           breaks accepted static geometry. Keep them in place and only mark
           them as the selected variant's external source tree. */
        const ownerId = String(owner.el.getAttribute('data-node') || '');
        const instancePrefix = ownerId ? `I${ownerId};` : '';
        const host = owner.el.parentElement;
        const external = [];
        if (host && instancePrefix) {
          for (const sibling of [...host.children]) {
            if (sibling === owner.el) continue;
            const siblingId = sibling.getAttribute && sibling.getAttribute('data-node');
            if (!siblingId || !String(siblingId).startsWith(instancePrefix)) continue;
            sibling.setAttribute('data-switch-variant-external', 'instance-sibling');
            sibling.setAttribute('data-switch', String(owner.switchId));
            sibling.setAttribute('data-switch-variant-index', String(owner.initialIndex));
            /* Flattened artwork sits beside the owner, so a swipe on those
               pixels never reaches [data-switch-owner]. Keep geometry in place
               and only mark the sibling as a hit-test host for that switch. */
            sibling.setAttribute('data-switch-swipe-host', String(owner.switchId));
            sibling.style.pointerEvents = sibling.style.pointerEvents || 'auto';
            external.push(sibling);
          }
        }
        owner.el.__fxVariantExternal = external;
        /* Alternate component variants keep their captured Figma geometry,
           including off-owner neighboring cards. The selected INSTANCE already
           clips that overflow; the replacement layers must do the same so a
           swipe never reveals two pages at once. Do not stretch the accepted
           owner box. */
        if (!owner.el.style.overflow || owner.el.style.overflow === 'visible') {
          owner.el.style.overflow = 'hidden';
        }
        owner.el.setAttribute('data-switch-variant-clip', 'owner-local');
        owner.el.style.isolation = 'isolate';
        base.style.overflow = 'hidden';
        base.style.contain = 'paint';
        let mountBlocked = false;
        for (const [index, tree] of owner.trees.entries()) {
          if (index === owner.initialIndex) continue;
          const treeNodes = tree && tree.nodes || [];
          const wantedId = String(__u(tree && tree.componentId) || '');
          const root = treeNodes.find((node) => String(__u(node && node.id)) === wantedId && String(node && node.type || '') === 'COMPONENT')
            || null;
          const rootBox = __plain(root && root.box || tree && tree.box || {});
          const ownerBox = __plain(owner.ownerBox || {});
          const ownerWidth = Number(ownerBox.w);
          const rootWidth = Number(rootBox.w || 0);
          const rootHeight = Number(rootBox.h || 0);
          /* Mapping a component-set canvas tree into an INSTANCE is legal
             only when the captured root is exactly one complete variant root
             and it shares the owner width. Alternate Figma variants may be a
             few pixels taller/shorter; keep the owner box and clip, rather
             than stretching the accepted static geometry. */
          if (!root || !Number.isFinite(rootWidth) || !Number.isFinite(rootHeight)
            || !Number.isFinite(ownerWidth) || Math.abs(rootWidth - ownerWidth) > 0.5) {
            mountBlocked = true;
            owner.el.setAttribute('data-switch-variant-mount-status', 'blocked-invalid-owner-local-root');
            owner.el.setAttribute('data-switch-variant-mount-detail', JSON.stringify({
              wantedId, rootType: root && root.type || null, rootWidth, ownerWidth, nodeCount: treeNodes.length,
            }));
            break;
          }
          const layer = document.createElement('div');
          layer.setAttribute('data-switch-variant-layer', 'true');
          layer.setAttribute('data-switch-variant-content', 'true');
          layer.setAttribute('data-switch', String(owner.switchId));
          layer.setAttribute('data-switch-variant-index', String(index));
          layer.setAttribute('data-switch-variant-root-node', String(__u(root.id)));
          layer.setAttribute('data-switch-variant-root-origin', `${rootBox.x},${rootBox.y}`);
          layer.setAttribute('aria-hidden', 'true');
          layer.style.position = 'absolute';
          layer.style.left = '0'; layer.style.top = '0';
          layer.style.width = '100%'; layer.style.height = '100%';
          layer.style.overflow = 'hidden';
          layer.style.contain = 'paint';
          layer.hidden = true;
          owner.el.appendChild(layer);
          paint(treeNodes, (tree && tree.nodes) || [], layer, {
            originX: Number(rootBox.x) || 0,
            originY: Number(rootBox.y) || 0,
            skipNodeIds: new Set([String(__u(root.id))]),
            suppressInteractions: true,
          });
        }
        if (!mountBlocked && owner.el.querySelectorAll(':scope > [data-switch-variant-content]').length
          === Number(owner.el.getAttribute('data-switch-variant-count') || 0)) {
          owner.el.setAttribute('data-switch-variant-mount-status', 'owner-local-mutually-exclusive');
          /* The selected INSTANCE is the visible base layer. Owner index must
             match that layer, not a later tab/indicator remap that would make
             prev/next no-ops or hide the resting Figma state. */
          const mountedIndex = Number(base.getAttribute('data-switch-variant-index') || owner.initialIndex || 0);
          owner.el.setAttribute('data-switch-index', String(mountedIndex));
          owner.el.setAttribute('data-switch-initial-index', String(mountedIndex));
        } else if (!mountBlocked) {
          owner.el.setAttribute('data-switch-variant-mount-status', 'blocked-incomplete-content-layer');
        }
      }
      /* Mount the selected source component tree only into an empty,
         dimension-compatible INSTANCE.  This restores component-owned pixels
         such as ind/ progress marks without inventing descendants, borrowing
         a sibling state, or wiring new interaction behavior. */
      for (const owner of componentInstanceOwners) {
        /* The exact component-context reference above already supplied the
           complete selected ind root.  Do not mount its partial raw child tree
           afterward: it would reintroduce the known missing imageRef placeholder
           and double-paint the source component. */
        if (owner.el && owner.el.hasAttribute('data-source-component-fallback')) {
          owner.el.setAttribute('data-component-instance-mount-status', 'source-component-fallback-complete');
          continue;
        }
        if (owner.el && owner.el.hasAttribute('data-ind-variant-slice')) {
          owner.el.setAttribute('data-component-instance-mount-status', 'ind-variant-slice-complete');
          continue;
        }
        if (!owner.el || owner.el.querySelector('[data-node]')) continue;
        const root = owner.tree && owner.tree.root;
        const rootBox = root && root.box || {};
        const ownerW = Number(owner.ownerBox && owner.ownerBox.w);
        const ownerH = Number(owner.ownerBox && owner.ownerBox.h);
        const rootW = Number(rootBox.w), rootH = Number(rootBox.h);
        if (!root || !Number.isFinite(ownerW) || !Number.isFinite(ownerH)
          || !Number.isFinite(rootW) || !Number.isFinite(rootH)
          || Math.abs(ownerW - rootW) > 0.5 || Math.abs(ownerH - rootH) > 0.5) {
          owner.el.setAttribute('data-component-instance-mount-status', 'blocked-owner-root-mismatch');
          continue;
        }
        paint(owner.tree.nodes, owner.tree.nodes, owner.el, {
          originX: Number(rootBox.x) || 0,
          originY: Number(rootBox.y) || 0,
          skipNodeIds: new Set([String(__u(root.id))]),
          /* Visible selected tree keeps @go / @link on inner btn/hot.
             Alternate switch/btn/dropmenu layers and modal paint stay suppressed. */
          suppressInteractions: false,
        });
        owner.el.setAttribute('data-component-instance-mount-status', 'selected-component-tree');

      }
      for (const owner of independentButtonOwners) {
        if (owner.el.getAttribute('data-btn-variant-mount-status')) continue;
        const variants = owner.variants || [];
        const trees = owner.trees || [];
        const ownerBox = __plain(owner.ownerBox || {});
        const ownerWidth = Number(ownerBox.w);
        const ownerHeight = Number(ownerBox.h);
        let mountBlocked = false;
        const layers = [];
        const ownerId = String(owner.el.getAttribute('data-node') || '');
        const instancePrefix = ownerId ? `I${ownerId};` : '';
        const host = owner.el.parentElement;
        const baseExternals = [];
        if (host && instancePrefix) {
          for (const sibling of [...host.children]) {
            if (sibling === owner.el) continue;
            const siblingId = sibling.getAttribute && sibling.getAttribute('data-node');
            if (!siblingId || !String(siblingId).startsWith(instancePrefix)) continue;
            sibling.setAttribute('data-btn-variant-external', 'instance-sibling');
            baseExternals.push(sibling);
          }
        }
        for (const [index, tree] of trees.entries()) {
          const treeNodes = tree && tree.nodes || [];
          const wantedId = String(__u(tree && tree.componentId) || '');
          const root = treeNodes.find((node) => String(__u(node && node.id)) === wantedId && String(node && node.type || '') === 'COMPONENT') || null;
          const rootBox = __plain(root && root.box || tree && tree.box || {});
          const variantName = String(__u(variants[index] && variants[index].name) || '').toLowerCase();
          const state = /highlight/.test(variantName) ? 'highlight' : (/disable/.test(variantName) ? 'disable' : 'normal');
          if (!root || !Number.isFinite(Number(rootBox.w)) || !Number.isFinite(Number(rootBox.h))
            || !Number.isFinite(ownerWidth) || Math.abs(Number(rootBox.w) - ownerWidth) > 0.5) {
            mountBlocked = true;
            owner.el.setAttribute('data-btn-variant-mount-status', 'blocked-owner-extent-mismatch');
            owner.el.setAttribute('data-btn-variant-mount-detail', JSON.stringify({
              wantedId, rootW: rootBox.w, rootH: rootBox.h, ownerWidth, ownerHeight,
            }));
            break;
          }
          if (index === owner.initialIndex) {
            owner.el.setAttribute('data-btn-variant-index', String(index));
            owner.el.setAttribute('data-btn-variant-state', state);
            for (const sibling of baseExternals) {
              sibling.setAttribute('data-btn-variant-index', String(index));
              hideInPlace(sibling, false);
            }
            layers.push({ index, state, el: owner.el, externals: baseExternals, isBase: true });
            continue;
          }
          const layer = document.createElement('div');
          layer.setAttribute('data-btn-variant-layer', 'true');
          layer.setAttribute('data-btn-variant-index', String(index));
          layer.setAttribute('data-btn-variant-state', state);
          layer.setAttribute('aria-hidden', 'true');
          layer.style.position = 'absolute';
          layer.style.left = '0';
          layer.style.top = '0';
          layer.style.width = '100%';
          layer.style.height = '100%';
          layer.style.overflow = 'hidden';
          layer.hidden = true;
          owner.el.appendChild(layer);
          paint(treeNodes, treeNodes, layer, {
            originX: Number(rootBox.x) || 0,
            originY: Number(rootBox.y) || 0,
            skipNodeIds: new Set([String(__u(root.id))]),
            suppressInteractions: true,
          });
          hideInPlace(layer, true);
          layers.push({ index, state, el: layer, externals: [], isBase: false });
        }
        if (!mountBlocked && layers.length === trees.length) {
          if (!owner.el.style.overflow || owner.el.style.overflow === 'visible') owner.el.style.overflow = 'hidden';
          owner.el.setAttribute('data-btn-variant-mount-status', 'owner-local-mutually-exclusive');
          owner.el.setAttribute('data-btn-variant-count', String(layers.length));
          owner.el.__fxButtonVariantLayers = layers;
          /* Alternate COMPONENT trees keep master TEXT. Directory rows and other
             instances must keep their own label override on every variant layer. */
          const ownTexts = [...owner.el.querySelectorAll('.fx-t, [data-figma-type="TEXT"]')]
            .filter((node) => !node.closest('[data-btn-variant-layer="true"]'));
          for (const layer of layers) {
            if (layer.isBase) continue;
            const layerTexts = [...layer.el.querySelectorAll('.fx-t, [data-figma-type="TEXT"]')];
            for (let i = 0; i < layerTexts.length && i < ownTexts.length; i++) {
              layerTexts[i].textContent = ownTexts[i].textContent;
            }
          }
        }
      }
      for (const owner of dropmenuOwners) {
        if (owner.el.getAttribute('data-dropmenu-mount-status')) continue;
        const variants = owner.variants || [];
        const trees = owner.trees || [];
        const ownerBox = __plain(owner.ownerBox || {});
        const ownerWidth = Number(ownerBox.w);
        const ownerHeight = Number(ownerBox.h);
        let mountBlocked = false;
        const layers = [];
        const ownerId = String(owner.el.getAttribute('data-node') || '');
        const instancePrefix = ownerId ? `I${ownerId};` : '';
        const host = owner.el.parentElement;
        const baseExternals = [];
        if (host && instancePrefix) {
          for (const sibling of [...host.children]) {
            if (sibling === owner.el) continue;
            const siblingId = sibling.getAttribute && sibling.getAttribute('data-node');
            if (!siblingId || !String(siblingId).startsWith(instancePrefix)) continue;
            sibling.setAttribute('data-dropmenu-external', 'instance-sibling');
            baseExternals.push(sibling);
          }
        }
        for (const [index, tree] of trees.entries()) {
          const treeNodes = tree && tree.nodes || [];
          const wantedId = String(__u(tree && tree.componentId) || '');
          const root = treeNodes.find((node) => String(__u(node && node.id)) === wantedId && String(node && node.type || '') === 'COMPONENT') || null;
          const rootBox = __plain(root && root.box || tree && tree.box || {});
          const axis = dropmenuAxisName(variants, (variant) => __u(variant && variant.name));
          const token = dropmenuVariantToken(__u(variants[index] && variants[index].name), axis);
          const state = token === 'on' || token === 'off' ? token : 'invalid';
          if (state === 'invalid' || !root || !Number.isFinite(Number(rootBox.w)) || !Number.isFinite(Number(rootBox.h))
            || !Number.isFinite(ownerWidth) || Math.abs(Number(rootBox.w) - ownerWidth) > 0.5) {
            mountBlocked = true;
            owner.el.setAttribute('data-dropmenu-mount-status', 'blocked-owner-extent-or-axis');
            owner.el.setAttribute('data-dropmenu-state', 'invalid');
            owner.el.setAttribute('data-dropmenu-mount-detail', JSON.stringify({
              wantedId, token, rootW: rootBox.w, rootH: rootBox.h, ownerWidth, ownerHeight,
            }));
            break;
          }
          if (index === owner.initialIndex) {
            owner.el.setAttribute('data-dropmenu-index', String(index));
            owner.el.setAttribute('data-dropmenu-state', state);
            owner.el.__fxDropmenuOwnerH = ownerHeight;
            for (const sibling of baseExternals) {
              sibling.setAttribute('data-dropmenu-index', String(index));
              hideInPlace(sibling, false);
            }
            layers.push({ index, state, el: owner.el, externals: baseExternals, isBase: true, rootH: Number(rootBox.h) });
            continue;
          }
          const layer = document.createElement('div');
          layer.setAttribute('data-dropmenu-layer', 'true');
          layer.setAttribute('data-dropmenu-index', String(index));
          layer.setAttribute('data-dropmenu-state', state);
          layer.setAttribute('aria-hidden', 'true');
          layer.style.position = 'absolute';
          layer.style.left = '0';
          layer.style.top = '0';
          layer.style.width = '100%';
          layer.style.height = Number(rootBox.h) + 'px';
          layer.style.overflow = 'visible';
          layer.hidden = true;
          owner.el.appendChild(layer);
          paint(treeNodes, treeNodes, layer, {
            originX: Number(rootBox.x) || 0,
            originY: Number(rootBox.y) || 0,
            skipNodeIds: new Set([String(__u(root.id))]),
            suppressInteractions: true,
          });
          hideInPlace(layer, true);
          layers.push({ index, state, el: layer, externals: [], isBase: false, rootH: Number(rootBox.h) });
        }
        if (!mountBlocked && layers.length === trees.length) {
          owner.el.style.overflow = 'visible';
          owner.el.setAttribute('data-dropmenu-mount-status', 'owner-local-mutually-exclusive');
          owner.el.setAttribute('data-dropmenu-count', String(layers.length));
          owner.el.__fxDropmenuLayers = layers;
        }
      }
      };   /* paint complete: subsequent page-stage assembly is renderApp scope */
      namedModalPaint = paint;

      /* ═══ 按 Figma 页面 sibling 顺序挂载绘制层 ═══
         pagePaintOrder 来自 extractPageScope 对页面框 children 的 fixture 绑定：
         KV → bg → 页面模块 → 箭头 → 固定导航这样的顺序必须原样保留。
         共享背景仍只画一份，但只会挂回其真实 root child 位置；不再有“所有背景先画、
         所有内容后画”的全局重排。 */
      const rawSec = (__rawRoot.sections && __rawRoot.sections[sid]) || {};
      if (pageStageMode) {
        const rawPageChrome = __rawRoot.pageChrome || {};
        const rawFixed = __rawRoot.fixedOverlays || {};
        const pageFrameId = __u((pageScope.meta || {}).id);
        const pageRootIds = rawPagePaintOrder
          ? rawPagePaintOrder.map((e) => __u(e && e.id))
          : [];
        const rootKey = (raw) => {
          /* The ready handoff consumer may provide an explicit, derived
             paint-root provenance on flattened pageChrome records.  It is
             still source-backed (parent/ancestor chain), and takes priority
             over locator heuristics so one owner cannot be painted into
             every page root. */
          const loc = raw && raw.id && raw.id.provenance ? raw.id.provenance.locator : '';
          /* Provenance locators may be rooted at the source canvas rather than
             the extracted page-frame id (for example
             /nodes/<canvas>/document/children/0/children/0/id while the
             page frame itself is 491:6935).  Match the nearest recorded
             pagePaintOrder root first; falling back to the old page-frame
             projection preserves legacy fixtures. */
          const recordedRoots = rawPagePaintOrder
            ? rawPagePaintOrder.map((entry) => ({
                id: __u(entry && entry.id),
                loc: entry && entry.id && entry.id.provenance ? entry.id.provenance.locator : '',
            })).filter((entry) => entry.id != null)
            : [];
          const recordedRootIds = new Set(recordedRoots.map((entry) => String(entry.id)));
          const recordedRoot = (candidate) => {
            if (candidate == null || candidate === '') return null;
            const id = String(__u(candidate));
            return recordedRootIds.has(id) ? id : null;
          };
          const explicitRoot = recordedRoot(raw && (raw.paintRootId ?? raw.pagePaintRootId ?? raw.sourcePaintRootId));
          if (explicitRoot) return explicitRoot;
          let best = null;
          for (const entry of recordedRoots) {
            const rootLoc = String(entry.loc || '').replace(/\/id$/, '');
            if (loc === entry.loc || loc.startsWith(rootLoc + '/')) {
              if (!best || rootLoc.length > String(best.loc || '').replace(/\/id$/, '').length) best = entry;
            }
          }
          if (best) return String(best.id);
          /* Ready handoff consumers may carry the same source-backed records
             with a plain source id instead of a provenance wrapper.  This is
             still authoritative handoff data: resolve the nearest recorded
             page root from the source id/ancestor chain, never from geometry
             or a guessed name.  Without this fallback KV/bg owners are
             silently dropped from every paint bucket. */
          const plainId = raw && raw.id != null && typeof raw.id !== 'object' ? recordedRoot(raw.id) : null;
          if (plainId) return plainId;
          const ancestorIds = Array.isArray(raw && raw.ancestorIds)
            ? raw.ancestorIds.map((id) => String(__u(id)))
            : [];
          for (let i = ancestorIds.length - 1; i >= 0; i--) {
            const ancestor = recordedRoot(ancestorIds[i]);
            if (ancestor) return ancestor;
          }
          const parentId = recordedRoot(raw && raw.parentId);
          if (parentId) return parentId;
          const pagePrefix = `/nodes/${pageFrameId}/document/children/`;
          if (loc.startsWith(pagePrefix)) {
            const m = /^(\d+)/.exec(loc.slice(pagePrefix.length));
            if (m && pageRootIds[Number(m[1])] != null) return String(pageRootIds[Number(m[1])]);
          }
          const m = /^\/nodes\/([^/]+)\/document(?:\/|$)/.exec(loc);
          return m ? m[1] : null;
        };
        const bucketByRoot = (list, rawList) => {
          const out = new Map();
          for (let i = 0; i < list.length; i++) {
            const key = rootKey(rawList[i]);
            if (key == null) continue;
            const bucket = out.get(key) || { nodes: [], raw: [] };
            bucket.nodes.push(list[i]);
            bucket.raw.push(rawList[i]);
            out.set(key, bucket);
          }
          return out;
        };
        const chromeNodes = asArr(__activeTruth.pageChrome && __activeTruth.pageChrome.nodes);
        const rawChromeNodes = asArr(rawPageChrome.nodes);
        /* The Figma page root has one bg sibling. A consumer may accidentally
           repeat that root under pageChrome as well as pageBackground; reject
           the duplicate from chrome bucketing so the same source tree cannot
           paint twice at two page-paint positions. */
        const directBackgroundRoot = __u(directPageBackground && directPageBackground.nodes && directPageBackground.nodes[0] && directPageBackground.nodes[0].id);
        const notBackgroundRoot = (node) => String(__u(node && node.id)) !== String(directBackgroundRoot || '');
        const chromeByRoot = bucketByRoot(chromeNodes.filter(notBackgroundRoot), rawChromeNodes.filter(notBackgroundRoot));
        const bgByRoot = directBackgroundRoot
          ? new Map([[String(directBackgroundRoot), { nodes: pageBgNodes, raw: pageBgRaw }]])
          : bucketByRoot(pageBgNodes, pageBgRaw);
        const fixedRoots = asArr(__activeTruth.fixedOverlays && __activeTruth.fixedOverlays.nodes);
        const fixedRootIds = new Set(fixedRoots.map((node) => String(__u(node && node.id))));
        const sectionTruthNodes = ids.flatMap((sectionId) => asArr(sections[sectionId] && sections[sectionId].nodes));
        fixedDescendantIds = new Set(sectionTruthNodes
          .filter((node) => Array.isArray(node && node.ancestorIds)
            && node.ancestorIds.some((ancestor) => fixedRootIds.has(String(__u(ancestor)))))
          .map((node) => String(__u(node && node.id))));
        const fixedTruthNodes = [...fixedRoots, ...sectionTruthNodes.filter((node) => fixedDescendantIds.has(String(__u(node && node.id))))];
        const rawSectionNodes = ids.flatMap((sectionId) => asArr(__rawRoot.sections && __rawRoot.sections[sectionId] && __rawRoot.sections[sectionId].nodes));
        const rawById = new Map([...asArr(rawFixed.nodes), ...rawSectionNodes]
          .filter((node) => node && node.id != null)
          .map((node) => [String(__u(node.id)), node]));
        const fixedRawNodes = fixedTruthNodes.map((node) => rawById.get(String(__u(node && node.id))) || node);
        const fixedByRoot = bucketByRoot(fixedTruthNodes, fixedRawNodes);
        /* A page-level bg/ owner is a backdrop, even when Figma places that
           sibling after the KV root in the source tree.  Root layers are CSS
           stacking contexts, so preserving that raw sibling index would put a
           full-height, opaque backdrop above the KV and black out the hero.
           Classify only the source root itself by the ready naming prefix;
           do not infer from a descendant or a node id.  Keep every root's
           original order inside its semantic band. */
        const rootNameById = new Map([
          ...pageBgNodes,
          ...chromeNodes,
          ...fixedTruthNodes,
          ...sectionTruthNodes,
        ].filter((node) => node && node.id != null)
          .map((node) => [String(__u(node.id)), String(node.name || '')]));
        const rootLayerRole = (rootId) => /^bg(?:\/|$)/i.test(rootNameById.get(String(rootId)) || '')
          ? 'background'
          : 'content';
        const appendLayer = (rootId, paintIndex) => {
          const layer = document.createElement('div');
          const role = rootLayerRole(rootId);
          layer.className = 'fx-root-layer';
          layer.setAttribute('data-paint-root', rootId);
          /* A page root is a Figma sibling paint group.  Giving every root its
             recorded paint index creates the corresponding CSS stacking
             context, so a descendant with blend/opacity/transform cannot
             escape its background root and wash out a later content root. */
          layer.setAttribute('data-page-paint-index', String(paintIndex));
          layer.setAttribute('data-paint-root-role', role);
          layer.style.position = 'absolute';
          layer.style.zIndex = String(paintIndex);
          layer.style.left = '0';
          layer.style.top = '0';
          layer.style.width = designWidth + 'px';
          layer.style.height = (pageScrollHeight || meta.height || 0) + 'px';
          layer.style.pointerEvents = 'none';
          /* KV is first-screen art only. Clip that sibling to the viewport in
             page-stage coordinates (designHeight = vh / k), not the raw Figma
             hero box: cover-scale lives on the node, so a 2160 clip would cut
             the enlarged portraits. A long bg/* sheet keeps full page height. */
          const layerName = rootNameById.get(String(rootId)) || '';
          if (heroSlot && Number(heroSlot.designHeight) > 0 && /^kv(?:\/|$)/i.test(layerName)) {
            layer.style.height = Number(heroSlot.designHeight) + 'px';
            layer.style.overflow = 'hidden';
            layer.setAttribute('data-hero-crop-window', 'visual-root');
            layer.setAttribute('data-hero-crop-window-design', String(heroSlot.designHeight));
          } else if (heroSlot && heroCropWindowDesign > 0 && /^bg(?:\/|$)/i.test(layerName)) {
            layer.setAttribute('data-hero-crop-window', 'visual-root');
            layer.setAttribute('data-hero-crop-window-design', String(heroCropWindowDesign));
          }
          stage.appendChild(layer);
          return layer;
        };

        if (pagePaintOrder && rawPagePaintOrder && pagePaintOrder.length === rawPagePaintOrder.length) {
          for (let pi = 0; pi < pagePaintOrder.length; pi++) {
            const entry = pagePaintOrder[pi] || {};
            const rawEntry = rawPagePaintOrder[pi] || {};
            const rootId = __u(entry.id);
            /* pagePaintOrder itself is the authoritative source-root order;
               do not re-infer its key from a flattened/raw wrapper (the
               wrapper may share the first root's locator). */
            const key = rootId != null ? String(rootId) : rootKey(rawEntry);
            if (key == null || rootId == null) continue;
            const bg = bgByRoot.get(key);
            const chrome = chromeByRoot.get(key);
            const fixed = fixedByRoot.get(key);
            /* A fixed overlay may be nested below a normal page paint root
               (e.g. the left directory under 页面内容). Its presence must not
               turn the whole page root into a fixed layer or let an opaque
               background cover later sections. Keep the normal root layer and
               paint the fixed subtree separately into fixedStage below. */
            const layer = appendLayer(rootId, pi);
            if (layer) {
              layer.setAttribute('data-paint-source-key', key);
              layer.setAttribute('data-paint-node-count', String((bg?.nodes.length || 0) + (chrome?.nodes.length || 0)));
              layer.setAttribute('data-paint-node-ids', [...(bg?.nodes || []), ...(chrome?.nodes || [])]
                .map((node) => String(__u(node && node.id))).join(' '));
              const rootName = rootNameById.get(String(rootId)) || '';
              const isKvRoot = /^kv(?:\/|$)/i.test(rootName);
              if (isKvRoot && heroSlot && pageStageScale > 0) {
                const kvRatio = heroVisualScale / pageStageScale;
                const firstMeta = sections[heroSlot.sectionId] && sections[heroSlot.sectionId].meta;
                const kvClipH = Number(firstMeta && firstMeta.height) || Number(heroSlot.heroHeight) || 0;
                layer.style.zoom = String(kvRatio);
                layer.style.left = heroVisualCropLeft + 'px';
                layer.style.top = '0';
                layer.style.width = designWidth + 'px';
                if (kvClipH > 0) layer.style.height = kvClipH + 'px';
                layer.style.overflow = 'hidden';
                layer.style.transformOrigin = '0 0';
                layer.setAttribute('data-kv-cover-plane', 'cover-crop');
                layer.setAttribute('data-hero-visual-scale', String(heroVisualScale));
                layer.setAttribute('data-hero-visual-crop-left', String(heroVisualCropLeft));
              }
            }
            if (bg) {
              if (layer && heroLayoutOffsetDesign > 0) {
                layer.setAttribute('data-hero-bg-follow', 'after-hero-slices');
                layer.setAttribute('data-hero-bg-shift-design', String(heroLayoutOffsetDesign));
              }
              paint(bg.nodes, bg.raw, layer || fixedStage, {
                originX: pageX,
                originY: pageY,
                backgroundHeroShift: true,
                heroVisualPlane: true,
              });
            }
            if (chrome) {
              const chromeIsHeroPlane = layer && layer.getAttribute('data-hero-crop-window') === 'visual-root';
              paint(chrome.nodes, chrome.raw, layer || fixedStage, chromeIsHeroPlane ? { heroVisualPlane: true } : {});
            }
            const orderedSections = asArr(entry.sectionIds);
            for (const sectionId of orderedSections) sectionLayerById.set(__u(sectionId), layer);
            if (fixed && fixedStage) {
              /* 固定导航必须仍是 sticky，但在 DOM 中放在页面 stage 后面，保持页面 root
                 sibling 的原始顺序；视觉层级不靠背景去重分支偷偷加 z-index。 */
              fixedStage.setAttribute('data-paint-root', rootId);
              paint(fixed.nodes, fixed.raw, fixedStage);
            }
          }
        } else {
          /* 老 truth 没有 pagePaintOrder 时保持可渲染，但显式标记降级；新的提取器必须
             产出这份 fixture 绑定顺序，不能把这个分支当作一比一还原结果。 */
          stage.setAttribute('data-paint-order-fallback', 'missing-pagePaintOrder');
          const legacyBg = appendLayer('legacy-background', 0);
          if (hasPageBg) paint(pageBgNodes, pageBgRaw, legacyBg, { originX: pageX, originY: pageY, backgroundHeroShift: true });
          const legacyChrome = appendLayer('legacy-pageChrome', 1);
          if (__activeTruth.pageChrome && __activeTruth.pageChrome.nodes) {
            paint(asArr(__activeTruth.pageChrome.nodes), asArr(rawPageChrome.nodes), legacyChrome);
          }
          for (const sectionId of ids) sectionLayerById.set(sectionId, appendLayer('legacy-sections-' + sectionId, 2));
          if (fixedStage) paint(asArr(__activeTruth.fixedOverlays.nodes), asArr(rawFixed.nodes), fixedStage);
        }
        /* A sticky overlay must be placed before the tall scroll surface. Appending it
           after the page stage means its normal-flow position is at page bottom, so it
           cannot become sticky until the user has already reached the bottom. Its
           paint order remains above content through z-index; DOM placement here is
           only the scroll-anchor contract. */
        if (fixedStage) frame.appendChild(fixedStage);
        frame.appendChild(stage);
        pageStage = stage;
      } else {
        /* 共享背景已在 page scope 层绘过一次（有 pageScope 时），此处跳过，
           不再每 section 各自重复定位 —— 那是板块衔接横缝的来源。
           没有 pageScope 的 demo（section 走文档流、无统一页面坐标系）仍按原行为画本区背景。 */
        if (!pageScope && sec.background && sec.background.nodes) {
          paint(asArr(sec.background.nodes),
            asArr(rawSec.background && rawSec.background.nodes), stage);
        }
        const omitFixedDescendants = (list) => fixedDescendantIds.size
          ? list.filter((node) => !fixedDescendantIds.has(String(__u(node && node.id))))
          : list;
        paint(omitFixedDescendants(nodes), omitFixedDescendants(asArr(rawSec.nodes)), stage);
        (sectionLayerById.get(sid) || pageStage || frame).appendChild(stage);
      }
    }
      /* Named modal trees stay off the page scroll flow. Paint them once after
         every page/section stage exists, using each modal's own Figma box.
         Visibility is interaction-owned; geometry stays source-backed. */
      const mountNamedModals = () => {
        const records = asArr(__activeTruth && __activeTruth.modals);
        try {
        frame.setAttribute('data-named-modal-source-count', String(records.length));
        if (!records.length || typeof frame.appendChild !== 'function') return;
        const pageMeta = (pageScope && pageScope.meta) || {};
        const pageX = Number(pageMeta.x ?? 0);
        const pageY = Number(pageMeta.y ?? 0);
        const host = document.createElement('div');
        host.className = 'fx-stage fx-named-modals';
        host.setAttribute('data-node-id', 'named-modals');
        host.style.position = 'absolute';
        host.style.left = '0';
        host.style.top = '0';
        host.style.width = designWidth + 'px';
        host.style.height = (pageScrollHeight || pageMeta.height || 0) + 'px';
        host.style.pointerEvents = 'none';
        host.style.zIndex = '40';
        host.style.overflow = 'visible';
        host.style.zoom = String(pageStageScale || k);
        const splitName = (name) => {
          const raw = String(name || '');
          const head = raw.split('@')[0];
          const match = /^([A-Za-z]+)\s*[\/／]\s*(.*)$/.exec(head);
          return match ? { role: match[1].toLowerCase(), label: match[2].trim() } : { role: null, label: head.trim() };
        };
        const modalKey = (raw) => {
          const parsed = splitName(raw);
          if (parsed.role === 'modal' && parsed.label) return 'modal/' + parsed.label;
          const text = String(raw || '').trim();
          return text ? text : '';
        };
        const openers = Array.from(frame.querySelectorAll('[data-btn-name]') || []);
        const wired = [];
        const modalPlatform = (modal) => {
          const raw = modal && (modal.platform || modal.sourcePlatform || modal.meta?.platform);
          const value = String(raw || '').toLowerCase();
          return value === 'mobile' || value === 'phone' ? 'mobile' : value === 'pc' || value === 'desktop' ? 'pc' : value === 'pad' || value === 'tablet' ? 'pad' : null;
        };
        const activeModalPlatform = __normalizedPlat === 'mobile' ? 'mobile' : __normalizedPlat === 'pad' ? 'pad' : 'pc';
        const modalRecords = records.filter((modal) => {
          const platform = modalPlatform(modal);
          return platform === activeModalPlatform;
        });
        const modalLabels = new Map();
        for (const modal of modalRecords) {
          if (modal.triggerStatus !== 'determined') continue;
          const parsed = splitName(modal && modal.name);
          if (parsed.role !== 'modal') continue;
          const key = parsed.label;
          const list = modalLabels.get(key) || [];
          list.push(modal);
          modalLabels.set(key, list);
        }
        const duplicateModalLabels = [...modalLabels.entries()].filter(([, list]) => list.length > 1).map(([key]) => key);
        if (duplicateModalLabels.length) {
          frame.setAttribute('data-named-modal-error', 'duplicate-modal-name:' + duplicateModalLabels.join(','));
          frame.setAttribute('data-named-modal-count', '0');
          return;
        }
        for (const modal of modalRecords) {
          if (modal.triggerStatus !== 'determined') continue;
          const parsed = splitName(modal && modal.name);
          if (parsed.role !== 'modal') continue;
          const box = __plain(modal.box || {});
          const nodes = asArr(modal.nodes);
          if (!nodes.length || !Number.isFinite(Number(box.w)) || !Number.isFinite(Number(box.h))) continue;
          const layer = document.createElement('div');
          layer.className = 'fx-named-modal';
          layer.setAttribute('data-modal-id', String(modal.id || ''));
          layer.setAttribute('data-modal-name', parsed.label);
          layer.setAttribute('data-node', String(modal.id || ''));
          layer.style.position = 'absolute';
          layer.style.left = ((Number(box.x) || 0) - pageX) + 'px';
          layer.style.top = ((Number(box.y) || 0) - pageY) + 'px';
          layer.style.width = Number(box.w) + 'px';
          layer.style.height = Number(box.h) + 'px';
          layer.style.pointerEvents = 'auto';
          layer.style.zIndex = '41';
          hideInPlace(layer, true);
          host.appendChild(layer);
          try {
            if (typeof namedModalPaint !== 'function') throw new Error('named modal paint is not defined');
            namedModalPaint(nodes, nodes, layer, {
              originX: Number(box.x) || 0,
              originY: Number(box.y) || 0,
              skipNodeIds: new Set(),
              suppressInteractions: true,
            });
          } catch (err) {
            layer.setAttribute('data-modal-paint-error', String(err && err.message || err));
          }
          const authorizedFrom = new Set(
            asArr(modal.triggerFrom).map((id) => String(id || '')).filter(Boolean)
          );
          const openerEls = [];
          if (authorizedFrom.size) {
            const seen = new Set();
            for (const el of [...openers, ...Array.from(frame.querySelectorAll('[data-go]') || [])]) {
              if (!el || layer.contains(el) || seen.has(el)) continue;
              const nodeId = String(el.getAttribute('data-node') || '');
              if (!nodeId || !authorizedFrom.has(nodeId)) continue;
              seen.add(el);
              openerEls.push(el);
            }
          }
          wired.push({
            id: String(modal.id || ''),
            name: parsed.label,
            layer,
            exclusive: parsed.label !== '视频弹窗',
            openerEls,
            closeEls: Array.from(layer.querySelectorAll('[data-btn-name="关闭按钮"]') || []),
          });
        }
        if (!wired.length) {
          frame.setAttribute('data-named-modal-count', '0');
          return;
        }
        frame.appendChild(host);
        frame.__fxNamedModals = wired;
        frame.setAttribute('data-named-modal-count', String(wired.length));
        } catch (err) {
          frame.setAttribute('data-named-modal-error', String(err && err.message || err));
        }
      };
      mountNamedModals();
      /* zoom 之后 stage 自身就按缩放后的尺寸占位（zoom 改布局，transform 不改），
         不再需要 spacer 补高度 —— 留着它反而会多出一截 meta.height×k 的空白。
         （transform: scale 时代：stage 按未缩放高度占位，视觉缩了布局没缩，
         下面的内容会被顶开，spacer 是那个时代的找平件。） */

      /* 状态机必须在 page stage/fixed overlay 都挂载后安装，才能读取真实 frame.scrollTop。
         renderApp 重建页面时会先清理旧 listener；resize 后传入的新 contract 重新以顶部或
         当前 scrollTop 计算状态，不改变任何图层可见性。 */
      /* The frozen motion adapter may only own a switch after Main Skill has
         emitted a real, source-backed page graph. Otherwise its carousel
         listener would swallow a valid control click while having no page to
         animate. The native bridge can still expose the truth-backed control
         state, but never fabricates missing pages. */
      const __motionCarouselHosts = typeof frame.querySelectorAll === 'function'
        ? Array.from(frame.querySelectorAll('[data-motion-carousel]') || []) : [];
      const __motionCarouselOptIn = Boolean(motionAdapter?.carousel
        || motionAdapter?.interaction?.carousel
        || motionAdapter?.template?.interaction?.carousel)
        && __motionCarouselHosts.some((host) => host.querySelector('[data-motion-carousel-page]'));
      if (!__motionCarouselOptIn && !frame.__fxInteractionBridgeInstalled
        && typeof frame.addEventListener === 'function' && typeof frame.querySelectorAll === 'function') {
        frame.__fxInteractionBridgeInstalled = true;
        let drag = null;
        /* Static Figma component variants prove the alternate pixels, but not
           their timeline. An official adapter may opt into a generic fade only
           for complete, source-backed component-set replacement trees. It is
           deliberately separate from track/carousel motion: the variants keep
           their captured placement and are never reinterpreted as slides. */
        const componentVariantTransitionConfig = (() => {
          const spec = motionAdapter?.componentVariantTransition
            || motionAdapter?.interaction?.componentVariantTransition
            || motionAdapter?.template?.interaction?.componentVariantTransition;
          if (!spec || spec.pattern !== 'fade-replace') return null;
          const durationMs = Math.max(0, Number(spec.durationMs) || 0);
          const roles = Array.isArray(spec.roles) ? spec.roles.map(String).filter(Boolean) : [];
          return durationMs > 0 ? { durationMs, easing: String(spec.easing || 'ease'), roles } : null;
        })();
        const componentVariantTransitionFor = (owner) => {
          if (!componentVariantTransitionConfig) return null;
          const roles = componentVariantTransitionConfig.roles;
          return !roles.length || roles.includes(owner.getAttribute('data-motion-role'))
            ? componentVariantTransitionConfig : null;
        };
        const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const applyComponentVariantLayers = (owner, previousIndex, nextIndex) => {
          const base = owner.querySelector(':scope > [data-switch-variant-base]');
          const layers = [base, ...owner.querySelectorAll(':scope > [data-switch-variant-layer]')].filter(Boolean);
          const byIndex = new Map(layers.map((layer) => [Number(layer.getAttribute('data-switch-variant-index')), layer]));
          const previous = byIndex.get(previousIndex);
          const next = byIndex.get(nextIndex);
          const expected = Number(owner.getAttribute('data-switch-variant-count') || 0);
          if (owner.getAttribute('data-switch-variant-mount-status') !== 'owner-local-mutually-exclusive'
            || layers.length !== expected || !next) {
            owner.setAttribute('data-switch-variant-mount-status', 'blocked-incomplete-content-layer');
            return false;
          }
          const syncExternalSourceTree = (activeIndex) => {
            const externals = owner.__fxVariantExternal || [];
            for (const node of externals) {
              const active = Number(node.getAttribute('data-switch-variant-index')) === Number(activeIndex);
              /* Flattened TEXT/HUG owners set inline display:flex. The HTML
                 hidden attribute is a UA display:none without !important, so
                 the inline flex wins and old-page copy stays painted after
                 the image layer has already been replaced. Keep left/top/
                 parent untouched; only force display none and restore the
                 captured inline display when that variant returns. */
              if (node.__fxOriginalDisplay === undefined) {
                node.__fxOriginalDisplay = node.style.display;
              }
              node.hidden = !active;
              node.style.display = active ? node.__fxOriginalDisplay : 'none';
              node.setAttribute('aria-hidden', active ? 'false' : 'true');
            }
          };
          const componentVariantTransition = componentVariantTransitionFor(owner);
          const immediate = () => {
            for (const layer of layers) {
              const active = layer === next;
              layer.hidden = !active;
              layer.setAttribute('aria-hidden', active ? 'false' : 'true');
              layer.style.transition = '';
              layer.style.opacity = '';
              layer.style.pointerEvents = '';
            }
            syncExternalSourceTree(nextIndex);
            return true;
          };
          if (!previous || !next || previous === next || !componentVariantTransition || prefersReducedMotion()) {
            immediate();
            owner.setAttribute('data-motion-variant-transition', prefersReducedMotion() ? 'reduced-immediate' : 'immediate');
            return true;
          }
          if (owner.__fxVariantTransitionTimer) clearTimeout(owner.__fxVariantTransitionTimer);
          for (const layer of layers) {
            if (layer !== next) {
              layer.hidden = true;
              layer.setAttribute('aria-hidden', 'true');
              layer.style.transition = '';
              layer.style.opacity = '';
              layer.style.pointerEvents = '';
            }
          }
          /* A replacement fade is one active content layer, not a crossfade.
             Crossfading two full component variants briefly paints duplicated
             icons/text and was visible in 04.  Hide the previous source tree
             first, then fade in only the complete next owner-local layer. */
          previous.hidden = true;
          previous.setAttribute('aria-hidden', 'true');
          next.hidden = false;
          next.setAttribute('aria-hidden', 'false');
          syncExternalSourceTree(nextIndex);
          next.style.transition = 'none';
          next.style.opacity = '0';
          next.style.pointerEvents = 'none';
          /* Force the initial opacity to commit before transitioning. */
          void next.offsetWidth;
          const transition = `opacity ${componentVariantTransition.durationMs}ms ${componentVariantTransition.easing}`;
          next.style.transition = transition;
          next.style.opacity = '1';
          owner.setAttribute('data-motion-variant-transition', 'fade-replace');
          owner.setAttribute('data-motion-variant-duration', String(componentVariantTransition.durationMs));
          owner.__fxVariantTransitionTimer = setTimeout(() => {
            next.style.transition = '';
            next.style.opacity = '';
            next.style.pointerEvents = '';
            owner.__fxVariantTransitionTimer = null;
          }, componentVariantTransition.durationMs);
          return true;
        };
        const indicatorRenderCache = new WeakMap();
        const stripIdentity = (root) => {
          if (!root || root.nodeType !== 1) return root;
          root.removeAttribute('data-node');
          for (const child of root.children || []) stripIdentity(child);
          return root;
        };
        const copyIndicatorChildren = (from, to) => {
          if (!from || !to) return;
          to.replaceChildren(...[...from.children].map((child) => stripIdentity(child.cloneNode(true))));
        };
        const hideBtnLayer = hideInPlace;
        const applyIndependentButtonVariant = (owner, nextState) => {
          const layers = owner && owner.__fxButtonVariantLayers;
          if (!Array.isArray(layers) || !layers.length) return false;
          const next = layers.find((layer) => layer.state === nextState) || null;
          if (!next) return false;
          for (const layer of layers) {
            const active = layer === next;
            hideBtnLayer(layer.el, layer.isBase ? false : !active);
            if (layer.isBase) {
              for (const child of [...layer.el.children]) {
                if (child.getAttribute && child.getAttribute('data-btn-variant-layer') === 'true') continue;
                hideBtnLayer(child, !active);
              }
            }
            for (const sibling of layer.externals || []) hideBtnLayer(sibling, !active);
          }
          owner.setAttribute('data-btn-variant-state', next.state);
          owner.setAttribute('data-btn-variant-index', String(next.index));
          if (frame.__fxAssetScheduler && typeof frame.__fxAssetScheduler.prime === 'function') {
            const target = next.isBase ? owner : next.el;
            frame.__fxAssetScheduler.prime(target);
          }
          return true;
        };
        /* dropmenu open/close is exact lowercase on/off only. Do not reuse
           indicatorVariant i-flag: On/OFF/true must fail-visible, not open. */
        const DROPMENU_SELF_LABELS = Object.freeze({
          '简体中文': 'zh-CN',
          '繁體中文': 'zh-TW',
          'English': 'en',
          '日本語': 'ja',
          '한국어': 'ko',
        });
        const normalizeDropmenuSelfLabel = (raw) => String(raw || '').replace(/\s+/g, '').toLowerCase();
        const dropmenuLangFromSelfLabel = (raw) => {
          const key = normalizeDropmenuSelfLabel(raw);
          if (!key) return null;
          for (const [label, lang] of Object.entries(DROPMENU_SELF_LABELS)) {
            if (normalizeDropmenuSelfLabel(label) === key) return lang;
          }
          return null;
        };
        const markDropmenuInvalid = (owner, extra = {}) => {
          owner.setAttribute('data-dropmenu-state', extra.state || owner.getAttribute('data-dropmenu-state') || 'invalid');
          owner.setAttribute('data-dropmenu-invalid', 'true');
          if (extra.selfLabel) owner.setAttribute('data-dropmenu-self-label', extra.selfLabel);
          if (extra.inert) {
            owner.setAttribute('data-btn-press', 'inert');
            owner.setAttribute('aria-disabled', 'true');
          }
        };
        const applyDropmenuLang = (lang) => {
          if (!lang) return false;
          const qa = typeof window !== 'undefined' ? window.__qa : null;
          const setPref = typeof ctx.setPref === 'function'
            ? ctx.setPref
            : (qa && typeof qa.setPref === 'function' ? qa.setPref.bind(qa) : null);
          /* Product view has no window.__qa. Mutating ctx.prefs only edits
             chrome's cp(S.prefs) snapshot and does not persist or re-render. */
          if (typeof setPref !== 'function') return false;
          setPref('lang', lang);
          return true;
        };
        const dropmenuOptionValue = (btn) => {
          const text = String((btn && btn.textContent) || '').replace(/\s+/g, ' ').trim();
          const name = String((btn && btn.getAttribute('data-btn-name')) || '').trim();
          const raw = text || name;
          if (!raw) return '';
          const plus = raw.lastIndexOf('+');
          if (plus < 0) return raw;
          const digits = raw.slice(plus + 1).replace(/\s+/g, '');
          if (!/^\d+$/.test(digits)) return raw;
          const before = raw.slice(0, plus).replace(/\s+/g, '');
          /* 台灣+886 → +886. Keep 1+2 as-is: both sides are digits. */
          if (plus > 0 && /^\d+$/.test(before)) return raw;
          return '+' + digits;
        };
        const isDropmenuDynHost = (el) => {
          if (!el || el.nodeType !== 1) return false;
          if (el.getAttribute('data-prefix') === 'dyn') return true;
          const name = String(el.getAttribute('data-name') || el.getAttribute('data-node-name') || '');
          return /^dyn\s*[\/／]/i.test(name);
        };
        const dropmenuDynHosts = (root) => {
          if (!root) return [];
          const self = isDropmenuDynHost(root) ? [root] : [];
          if (typeof root.querySelectorAll !== 'function') return self;
          return self.concat([...root.querySelectorAll('[data-prefix], [data-name], [data-node-name]')].filter(isDropmenuDynHost));
        };
        const applyDropmenuDynValue = (owner, value) => {
          if (!owner || !value) return false;
          const layers = Array.isArray(owner.__fxDropmenuLayers) ? owner.__fxDropmenuLayers : [];
          /* Owner scan already covers the base layer and mounted on-layer
             children. Only sibling externals sit outside owner. */
          const hosts = dropmenuDynHosts(owner).concat(
            layers.flatMap((layer) => (layer && layer.externals || []).flatMap(dropmenuDynHosts)),
          );
          const unique = [...new Set(hosts)];
          owner.setAttribute('data-dropmenu-option-value', value);
          if (!unique.length) {
            owner.setAttribute('data-dropmenu-dyn-miss', 'true');
            return false;
          }
          owner.removeAttribute('data-dropmenu-dyn-miss');
          for (const host of unique) {
            const textEl = (host.matches && host.matches('[data-owner-role="txt"], [data-figma-type="TEXT"]') && host)
              || (host.querySelector && (host.querySelector('[data-owner-role="txt"]') || host.querySelector('[data-figma-type="TEXT"]')))
              || host;
            textEl.textContent = value;
          }
          return true;
        };
        const closeDropmenuOwners = (root) => {
          const scope = root && typeof root.querySelectorAll === 'function' ? root : frame;
          for (const owner of [...scope.querySelectorAll('[data-dropmenu="true"][data-dropmenu-mount-status="owner-local-mutually-exclusive"]')]) {
            owner.removeAttribute('data-dropmenu-self-label');
            owner.removeAttribute('data-dropmenu-invalid');
            applyDropmenuVariant(owner, 'off');
          }
        };
        const dropmenuGlobeName = (el) => String((el && (el.getAttribute('data-name') || el.getAttribute('data-node-name'))) || '');
        const isDropmenuGlobeImg = (el) => {
          if (!el || el.getAttribute('data-prefix') !== 'img') return false;
          const name = dropmenuGlobeName(el);
          return /(?:^|[\/／])(?:地球|globe|多语言icon)(?:$|[\/／@\s])/i.test(name);
        };
        const dropmenuGlobeImgs = (owner) => [...owner.querySelectorAll('[data-prefix="img"]')].filter(isDropmenuGlobeImg);
        const syncDropmenuGlobeHover = (owner) => {
          if (!owner || owner.nodeType !== 1) return;
          const state = owner.getAttribute('data-dropmenu-state');
          for (const globe of dropmenuGlobeImgs(owner)) {
            if (state === 'off') globe.setAttribute('data-dropmenu-globe-hover', 'programmatic');
            else globe.removeAttribute('data-dropmenu-globe-hover');
            globe.style.filter = '';
          }
        };
        const applyDropmenuVariant = (owner, nextState) => {
          if (!owner || owner.getAttribute('data-dropmenu-mount-status') !== 'owner-local-mutually-exclusive') return false;
          if (nextState !== 'on' && nextState !== 'off') {
            markDropmenuInvalid(owner, { state: 'invalid', inert: true });
            return false;
          }
          const layers = owner.__fxDropmenuLayers;
          if (!Array.isArray(layers) || !layers.length) return false;
          const next = layers.find((layer) => layer.state === nextState) || null;
          if (!next) {
            markDropmenuInvalid(owner, { state: 'invalid' });
            return false;
          }
          for (const layer of layers) {
            const active = layer === next;
            hideBtnLayer(layer.el, layer.isBase ? false : !active);
            if (layer.isBase) {
              for (const child of [...layer.el.children]) {
                if (child.getAttribute && child.getAttribute('data-dropmenu-layer') === 'true') continue;
                hideBtnLayer(child, !active);
              }
            }
            for (const sibling of layer.externals || []) hideBtnLayer(sibling, !active);
          }
          owner.setAttribute('data-dropmenu-state', next.state);
          owner.setAttribute('data-dropmenu-index', String(next.index));
          owner.removeAttribute('data-dropmenu-invalid');
          const nextH = Number(next.rootH);
          if (Number.isFinite(nextH) && nextH > 0) owner.style.height = nextH + 'px';
          syncDropmenuGlobeHover(owner);
          if (frame.__fxAssetScheduler && typeof frame.__fxAssetScheduler.prime === 'function') {
            const target = next.isBase ? owner : next.el;
            frame.__fxAssetScheduler.prime(target);
          }
          return true;
        };
        const toggleDropmenu = (owner) => {
          if (!owner) return false;
          const current = owner.getAttribute('data-dropmenu-state');
          if (current !== 'on' && current !== 'off') return false;
          return applyDropmenuVariant(owner, current === 'on' ? 'off' : 'on');
        };
        for (const owner of [...frame.querySelectorAll('[data-dropmenu="true"]')]) syncDropmenuGlobeHover(owner);
        const applyNavigationVariant = (group, activeIndex) => {
          const items = group && group.items || [];
          /* Directory `btn/导航状态` is an independent COMPONENT_SET: selected
             row shows Property 1=highlight, siblings return to Property 1=normal.
             Do not swap baked images between rows. */
          let mounted = 0;
          for (const [index, item] of items.entries()) {
            const selected = index === activeIndex;
            const nextState = selected ? 'highlight' : 'normal';
            if (item.getAttribute('data-btn-variant') === 'true'
              && item.getAttribute('data-btn-variant-mount-status') === 'owner-local-mutually-exclusive'
              && applyIndependentButtonVariant(item, nextState)) {
              item.setAttribute('data-nav-variant-visual', 'btn-component-set');
              item.setAttribute('data-nav-variant', selected ? 'active' : 'normal');
              mounted += 1;
            }
          }
          if (mounted === items.length && items.length) return;
          const activeSource = items.find((item) => item.getAttribute('data-nav-variant') === 'active');
          const normalSource = items.find((item) => item.getAttribute('data-nav-variant') === 'normal');
          if (!activeSource || !normalSource) return;
          for (const item of items) {
            if (item.getAttribute('data-nav-variant-visual') !== 'btn-component-set') {
              item.setAttribute('data-nav-variant-visual', 'owner-preserved');
            }
          }
        };
        const applyIndicatorVariant = (sid, idx) => {
          const indicators = [...frame.querySelectorAll('[data-switch][data-indicator]')]
            .filter((el) => el.getAttribute('data-switch') === sid);
          if (!indicators.length) return;
          const fallbackIndicators = indicators.filter((el) => el.hasAttribute('data-source-component-fallback')
            || el.querySelector('[data-source-component-fallback]'));
          /* Component-context fallback already mounted the two exact source
             PNGs (highlight / normal, matte stripped). Swap those files in
             place so the marks follow the active page. Do not clone children:
             that path used to copy a still-empty deferred img and blank every
             mark. */
          if (fallbackIndicators.length) {
            const activeFile = 'assets/figma-indicator-active-alpha.webp';
            const normalFile = 'assets/figma-indicator-normal-alpha.webp';
            for (const el of fallbackIndicators) {
              const active = Number(el.getAttribute('data-swpage')) === idx;
              const file = active ? activeFile : normalFile;
              const host = el.hasAttribute('data-source-component-fallback')
                ? el
                : el.querySelector('[data-source-component-fallback]');
              const img = (host && host.querySelector('img.fx-img')) || el.querySelector('img.fx-img');
              if (host) {
                host.setAttribute('data-source-component-state', active ? 'highlight' : 'normal');
                host.setAttribute('data-source-component-id', active ? '397:35947' : '397:35949');
                host.setAttribute('data-source-component-node', active ? '397:35946' : '397:35949');
              }
              if (img) {
                img.setAttribute('data-asset-src', file);
                if (img.getAttribute('src') !== file) img.setAttribute('src', file);
              }
              el.setAttribute('data-indicator-visual', 'source-component-fallback');
              el.setAttribute('data-indicator-variant', active ? 'active' : 'normal');
            }
            return;
          }
          const activeSource = indicators.find((el) => el.getAttribute('data-indicator-variant') === 'active');
          const normalSource = indicators.find((el) => el.getAttribute('data-indicator-variant') === 'normal');
          /* A static Figma snapshot may contain both component variants. In
             that narrow case the selected dot can be redrawn from those exact
             source subtrees. If either variant is absent, leave the pixels
             alone: state attributes remain auditable but no visual is guessed. */
          if (!activeSource || !normalSource) return;
          for (const el of indicators) {
            if (!indicatorRenderCache.has(el)) {
              indicatorRenderCache.set(el, [...el.children].map((child) => child.cloneNode(true)));
            }
            const assetOwner = el.closest('[data-asset-descendants="baked"]');
            const baked = assetOwner && assetOwner.querySelector(':scope > img.fx-img');
            if (baked) baked.style.visibility = 'hidden';
            copyIndicatorChildren(Number(el.getAttribute('data-swpage')) === idx ? activeSource : normalSource, el);
          }
        };
        const applySelectableVariant = (sid, idx) => {
          const controls = [...frame.querySelectorAll('[data-switch][data-switch-variant]')]
            .filter((el) => el.getAttribute('data-switch') === sid
              && (el.hasAttribute('data-tab') || el.hasAttribute('data-indicator')));
          /* The active/normal components in a Figma snapshot may each contain
             a different portrait, icon, or baked asset.  Replacing every
             control's entire subtree with the first active/normal sample made
             a selected thumbnail borrow another item's identity.  State is
             therefore represented by the audited attributes above; retain
             each selectable's own complete source tree unless a future truth
             contract explicitly isolates a state-only ornament layer. */
          for (const control of controls) {
            const active = Number(control.getAttribute('data-swpage')) === idx;
            control.setAttribute('data-switch-identity-preserved', 'true');
            control.setAttribute('aria-selected', active ? 'true' : 'false');
          }
        };
        const applySwitch = (sid, requested, assetsPrepared = false) => {
          const all = [...frame.querySelectorAll('[data-switch]')].filter((el) => el.getAttribute('data-switch') === sid);
          const pages = all.filter((el) => el.hasAttribute('data-switch-page'));
          const controls = all.filter((el) => el.hasAttribute('data-swpage'));
          if (!pages.length && !controls.length) return;
          /* When page truth exists it is the only legal range. Without it,
             controls may expose a source-backed selected state (for example
             a highlighted indicator variant), but this is explicitly not a
             fabricated carousel page graph. */
          const selectable = all.filter((el) => el.hasAttribute('data-tab') || el.hasAttribute('data-indicator'));
          const max = Math.max(0, (pages.length || selectable.length) - 1);
          const current = Number.isFinite(Number(requested)) ? Number(requested) : 0;
          const count = max + 1;
          const loop = all.some((el) => el.getAttribute('data-switch-loop') === 'true');
          const idx = loop && count > 1
            ? ((current % count) + count) % count
            : (max ? Math.max(0, Math.min(max, current)) : Math.max(0, current));
          /* A hidden source-backed variant keeps its Figma geometry but its
             bitmap is intentionally deferred. Start/decode it before changing
             visibility so an interaction never reveals a blank card. The
             recursive call is synchronous once every target asset is ready. */
          if (!assetsPrepared && frame.__fxAssetScheduler) {
            const ready = frame.__fxAssetScheduler.prepareSwitch(sid, idx);
            if (ready && typeof ready.then === 'function') {
              /* Start the next layer's assets, but never leave prev/next inert
                 waiting on a hung decode. Replacement is still immediate. */
              ready.catch(() => undefined);
            }
          }
          const variantOwners = all.filter((x) => x.hasAttribute('data-switch-owner')
            && x.getAttribute('data-switch-page-source') === 'component-set-variant');
          /* Do not update the tab/indicator state until every content layer
             has passed the owner-local mount contract.  A partial tree must
             fail closed as an inert control, never advertise a state whose
             content cannot be safely represented. */
          if (variantOwners.some((owner) => {
            const layers = owner.querySelectorAll(':scope > [data-switch-variant-content]');
            return owner.getAttribute('data-switch-variant-mount-status') !== 'owner-local-mutually-exclusive'
              || layers.length !== Number(owner.getAttribute('data-switch-variant-count') || 0)
              || ![...layers].some((layer) => Number(layer.getAttribute('data-switch-variant-index')) === idx);
          })) return;
          for (const el of pages) {
            const active = Number(el.getAttribute('data-switch-page')) === idx;
            el.toggleAttribute('data-active', active);
            el.hidden = !active;
          }
          for (const el of controls) {
            const active = Number(el.getAttribute('data-swpage')) === idx;
            el.toggleAttribute('data-active', active);
            el.setAttribute('aria-selected', active ? 'true' : 'false');
          }
          applyIndicatorVariant(sid, idx);
          applySelectableVariant(sid, idx);
          for (const el of all.filter((x) => x.hasAttribute('data-switch-owner'))) {
            const previousIndex = Number(el.getAttribute('data-switch-index') || 0);
            if (el.getAttribute('data-switch-page-source') !== 'component-set-variant') continue;
            if (applyComponentVariantLayers(el, previousIndex, idx)) el.setAttribute('data-switch-index', String(idx));
            continue;
          }
          for (const el of all.filter((x) => x.hasAttribute('data-switch-owner')
            && x.getAttribute('data-switch-page-source') !== 'component-set-variant')) {
            el.setAttribute('data-switch-index', String(idx));
          }
        };
        /* Direct-child pages are present in the initial Figma tree, so settle
           the source-selected state immediately through the same applySwitch()
           pathway used by tabs, indicators, and prev/next commands. This is
           deliberately limited to the adapter's explicit source mode: legacy
           swpage and component-variant initialization retain their existing
           renderer contracts. */
        for (const owner of frame.querySelectorAll('[data-switch-owner][data-switch-page-source="switch-direct-child"]')) {
          applySwitch(owner.getAttribute('data-switch'), Number(owner.getAttribute('data-switch-initial-index') || 0));
        }
        const fixedNavigation = (() => {
          const anchors = ids.map((sid) => Array.from(frame.querySelectorAll('.fx-stage[data-node-id]') || [])
            .find((el) => el.getAttribute('data-node-id') === 'section-' + sid)).filter(Boolean);
          if (!anchors.length) return [];
          const groups = new Map();
          for (const item of Array.from(frame.querySelectorAll('[data-nav-item][data-nav-owner]') || [])) {
            const owner = item.getAttribute('data-nav-owner');
            if (!groups.has(owner)) groups.set(owner, []);
            groups.get(owner).push(item);
          }
          const wired = [];
          for (const items of groups.values()) {
            /* Source order can stand in for explicit links only when the
               inventory is complete and exactly 1:1. Anything else stays
               inert rather than guessing a section target. */
            if (items.length !== anchors.length) continue;
            items.forEach((item, index) => {
              item.setAttribute('data-sec-target', anchors[index].getAttribute('data-node'));
              item.setAttribute('data-nav-index', String(index));
              item.setAttribute('aria-current', index === 0 ? 'true' : 'false');
            });
            wired.push({ items, anchors });
          }
          return wired;
        })();
        frame.__fxFixedNavigation = fixedNavigation;
        let navLock = null;
        let navLockIdle = null;
        let navigationFrame = null;
        const markFixedNavigation = (target) => {
          for (const group of frame.__fxFixedNavigation || []) {
            if (group.lastTarget === target) continue;
            const active = group.items.findIndex((item) => item.getAttribute('data-sec-target') === target);
            if (active < 0) continue;
            group.lastTarget = target;
            group.items.forEach((item, index) => {
              const selected = index === active;
              item.toggleAttribute('data-active', selected);
              item.setAttribute('aria-current', selected ? 'true' : 'false');
              /* Selected/unselected pixels come from btn/导航状态 highlight/normal.
                 Do not add a CSS scale on top of the component-set replacement. */
              item.style.scale = '';
              item.style.transition = '';
            });
            applyNavigationVariant(group, active);
          }
        };
        const currentFixedNavigationTarget = (group) => {
          const viewportMidpoint = (typeof window !== 'undefined' ? window.innerHeight : 0) * 0.5;
          let best = null, bestTop = -Infinity, first = null;
          for (const anchor of group.anchors) {
            const rect = anchor.getBoundingClientRect();
            if (!rect.height) continue;
            const target = anchor.getAttribute('data-node');
            if (!first) first = target;
            if (rect.top <= viewportMidpoint && rect.top > bestTop) {
              best = target;
              bestTop = rect.top;
            }
          }
          return best || first;
        };
        const syncFixedNavigation = () => {
          if (navLock) { markFixedNavigation(navLock); return; }
          for (const group of frame.__fxFixedNavigation || []) {
            const target = currentFixedNavigationTarget(group);
            if (target) markFixedNavigation(target);
          }
        };
        const unlockFixedNavigation = () => {
          if (!navLock) return;
          navLock = null;
          clearTimeout(navLockIdle);
          syncFixedNavigation();
        };
        frame.__fxSyncFixedNavigation = syncFixedNavigation;
        frame.addEventListener('click', (ev) => {
          const innerBtn = closestIn(ev.target, '[data-prefix="btn"], [data-btn-name]');
          const dropmenuOwner = closestIn(ev.target, '[data-dropmenu="true"]');
          if (innerBtn && dropmenuOwner && dropmenuOwner.contains(innerBtn)
            && dropmenuOwner.getAttribute('data-dropmenu-state') === 'on') {
            /* Visible copy decides. A row named btn/台湾 whose TEXT is 简体中文
               is a language option; btn/English whose TEXT is 香港+852 is a
               region option. Fall back to the button name only when there is
               no visible copy. */
            const visible = String((innerBtn.textContent || '')).replace(/\s+/g, ' ').trim();
            const named = String(innerBtn.getAttribute('data-btn-name') || '').trim();
            const lang = dropmenuLangFromSelfLabel(visible || named);
            if (lang) {
              if (!applyDropmenuLang(lang)) {
                markDropmenuInvalid(dropmenuOwner, { selfLabel: 'no-pref-handle' });
              } else {
                /* setPref → chrome syncAll → renderApp clears frame.innerHTML.
                   dropmenuOwner is detached. Close menus on the rebuilt tree so a
                   source-on instance still lands off after the language change. */
                closeDropmenuOwners(frame);
              }
            } else {
              applyDropmenuDynValue(dropmenuOwner, dropmenuOptionValue(innerBtn));
              applyDropmenuVariant(dropmenuOwner, 'off');
            }
            ev.preventDefault();
            ev.stopPropagation();
            return;
          }
          if (dropmenuOwner && dropmenuOwner.getAttribute('data-dropmenu-mount-status') === 'owner-local-mutually-exclusive') {
            toggleDropmenu(dropmenuOwner);
            ev.preventDefault();
            ev.stopPropagation();
            return;
          }
          const btnVariantEarly = ev.target && ev.target.closest ? ev.target.closest('[data-btn-variant="true"]') : null;
          if (btnVariantEarly && btnVariantEarly.getAttribute('data-btn-variant-mount-status') === 'owner-local-mutually-exclusive'
            && btnVariantEarly.getAttribute('data-nav-item') !== 'true') {
            const group = btnVariantEarly.getAttribute('data-btn-variant-group');
            const siblings = group
              ? [...frame.querySelectorAll(`[data-btn-variant="true"][data-btn-variant-group="${group}"]`)]
              : [btnVariantEarly];
            for (const sibling of siblings) applyIndependentButtonVariant(sibling, sibling === btnVariantEarly ? 'highlight' : 'normal');
            ev.preventDefault();
            ev.stopPropagation();
            return;
          }
          const hscrollHost = ev.target && ev.target.closest ? ev.target.closest('[data-hscroll]') : null;
          const swipeOwnerHost = ev.target && ev.target.closest
            ? ev.target.closest('[data-switch-owner][data-switch-page-source="component-set-variant"]')
            : null;
          if ((hscrollHost && hscrollHost.__fxHscrollSuppressClick)
            || (swipeOwnerHost && swipeOwnerHost.__fxHscrollSuppressClick)) {
            ev.preventDefault();
            ev.stopPropagation();
            if (hscrollHost) hscrollHost.__fxHscrollSuppressClick = false;
            if (swipeOwnerHost) swipeOwnerHost.__fxHscrollSuppressClick = false;
            return;
          }
          const commandAtPoint = (Number.isFinite(ev.clientX) && Number.isFinite(ev.clientY)
            && typeof document.elementsFromPoint === 'function')
            ? document.elementsFromPoint(ev.clientX, ev.clientY)
              .find((el) => el && el.getAttribute && el.getAttribute('data-switch-action'))
            : null;
          const control = commandAtPoint
            || (ev.target && ev.target.closest
              ? ev.target.closest('[data-switch][data-swpage], [data-switch][data-switch-action]')
              : null);
          const modalOpenerHit = ev.target && ev.target.closest
            ? (ev.target.closest('[data-go]')
              || ev.target.closest('[data-btn-name="播放按钮"]')
              || ev.target.closest('[data-btn-name="导航按钮"]')
              || ev.target.closest('[data-btn-name="多语言按钮"]'))
            : null;
          const calendarReturn = ev.target && ev.target.closest
            ? ev.target.closest('[data-calendar-now="true"][data-calendar-now-state="return-today"]')
            : null;
          if (calendarReturn) {
            const host = calendarScrollHost(calendarReturn);
            const surface = host && hscrollSurfaceOf(host);
            if (surface) setHscrollOffset(surface, 0, host);
            setCalendarNowState(calendarReturn, 'today');
            ev.preventDefault();
            ev.stopPropagation();
            return;
          }
          const hscrollCommandEl = ev.target && ev.target.closest
            ? ev.target.closest('[data-hscroll-action]')
            : null;
          if (hscrollCommandEl) {
            const hostId = hscrollCommandEl.getAttribute('data-hscroll-host');
            const scoped = (hostId && frame.querySelector(`[data-node="${hostId}"][data-hscroll]`))
              || hscrollCommandEl.closest('[data-hscroll]');
            if (scoped) stepHscroll(scoped, hscrollCommandEl.getAttribute('data-hscroll-action'));
            ev.preventDefault();
            ev.stopPropagation();
            return;
          }
          if (control && !modalOpenerHit) {
            const sid = control.getAttribute('data-switch');
            const current = Number(control.getAttribute('data-swpage') || 0);
            const action = control.getAttribute('data-switch-action');
            const owner = [...frame.querySelectorAll('[data-switch-owner]')].find((el) => el.getAttribute('data-switch') === sid);
            const active = owner ? Number(owner.getAttribute('data-switch-index') || 0) : current;
            const next = action === 'prev' ? active - 1 : action === 'next' ? active + 1 : current;
            applySwitch(sid, next);
            ev.preventDefault();
            ev.stopPropagation();
            return;
          }
          const target = ev.target && ev.target.closest ? ev.target.closest('[data-sec-target]') : null;
          if (target) {
            const wanted = target.getAttribute('data-sec-target');
            const candidate = [...frame.querySelectorAll('[data-node]')].find((el) => el.getAttribute('data-node') === wanted);
            if (candidate) {
              const group = (frame.__fxFixedNavigation || []).find((entry) => entry.items.includes(target));
              if (group) {
                navLock = wanted;
                markFixedNavigation(wanted);
              }
              if (frame.__fxAssetScheduler) frame.__fxAssetScheduler.prime(candidate);
              const reduced = typeof window !== 'undefined' && window.matchMedia
                && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
              candidate.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
              return;
            }
          }
          const namedModals = frame.__fxNamedModals || [];
          const closeNamedModal = (entry) => {
            if (!entry || !entry.layer) return;
            hideInPlace(entry.layer, true);
            entry.layer.removeAttribute('data-modal-open');
          };
          const openNamedModal = (entry) => {
            if (!entry || !entry.layer) return;
            for (const other of namedModals) {
              if (other === entry) continue;
              if (entry.exclusive && other.exclusive) closeNamedModal(other);
            }
            hideInPlace(entry.layer, false);
            entry.layer.setAttribute('data-modal-open', 'true');
          };
          const closeBtn = ev.target && ev.target.closest ? ev.target.closest('[data-btn-name="关闭按钮"]') : null;
          if (closeBtn) {
            const hostModal = namedModals.find((entry) => entry.layer.contains(closeBtn));
            if (hostModal) {
              closeNamedModal(hostModal);
              ev.preventDefault();
              ev.stopPropagation();
              return;
            }
          }
          const goHit = ev.target && ev.target.closest ? ev.target.closest('[data-go]') : null;
          if (goHit) {
            const insideModal = namedModals.find((entry) => entry.layer.contains(goHit));
            if (!insideModal) {
              const modal = namedModals.find((entry) => entry.openerEls.includes(goHit));
              if (modal) {
                openNamedModal(modal);
                ev.preventDefault();
                ev.stopPropagation();
                return;
              }
            }
          }
          const openerHit = ev.target && ev.target.closest ? ev.target.closest('[data-btn-name]') : null;
          if (openerHit) {
            const insideModal = namedModals.find((entry) => entry.layer.contains(openerHit));
            if (!insideModal) {
              const modal = namedModals.find((entry) => entry.openerEls.includes(openerHit));
              if (modal) {
                openNamedModal(modal);
                ev.preventDefault();
                ev.stopPropagation();
                return;
              }
            }
          }
          const copyBtn = ev.target && ev.target.closest ? ev.target.closest('[data-copy-code]') : null;
          if (copyBtn) {
            ev.preventDefault();
            const codeId = copyBtn.getAttribute('data-copy-code');
            const codeEl = [...frame.querySelectorAll('[data-node]')].find((el) => el.getAttribute('data-node') === codeId);
            const codeText = (codeEl && (codeEl.textContent || '').trim()) || '';
            const toast = (msg, sticky) => {
              let host = frame.__fxCopyToast;
              if (!host) {
                host = document.createElement('div');
                host.setAttribute('data-copy-toast', 'true');
                host.style.cssText = 'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:9999;background:#1e232c;color:#fff;border:1px solid #39424f;border-radius:8px;padding:10px 16px;font-size:13px;box-shadow:0 12px 32px rgba(0,0,0,.5);max-width:80%;';
                document.body.appendChild(host);
                frame.__fxCopyToast = host;
              }
              host.textContent = msg;
              host.style.display = 'block';
              clearTimeout(frame.__fxCopyToastTimer);
              if (!sticky) frame.__fxCopyToastTimer = setTimeout(() => { host.style.display = 'none'; }, 2200);
            };
            const manualFallback = () => {
              if (codeEl && window.getSelection) {
                try {
                  const range = document.createRange();
                  range.selectNodeContents(codeEl);
                  const sel = window.getSelection();
                  sel.removeAllRanges(); sel.addRange(range);
                } catch { /* selection unsupported */ }
              }
              toast('复制失败，请手动复制：' + (codeText || '（未找到兑换码）'), true);
            };
            (async () => {
              if (!codeText) { manualFallback(); return; }
              try {
                await navigator.clipboard.writeText(codeText);
                toast('已复制兑换码：' + codeText);
              } catch (e) { manualFallback(); }
            })();
            return;
          }
        });
        const closeDropmenuOutside = (ev) => {
          const hit = closestIn(ev && ev.target, '[data-dropmenu="true"]');
          if (hit && frame.contains(hit)) return;
          for (const owner of [...frame.querySelectorAll('[data-dropmenu="true"][data-dropmenu-state="on"]')]) {
            applyDropmenuVariant(owner, 'off');
          }
        };
        const onDropmenuGlobeEnter = (ev) => {
          const globe = closestIn(ev.target, '[data-prefix="img"]');
          if (!globe || !frame.contains(globe) || !isDropmenuGlobeImg(globe)) return;
          const owner = globe.closest('[data-dropmenu="true"]');
          if (!owner || owner.getAttribute('data-dropmenu-state') !== 'off') return;
          if (globe.getAttribute('data-dropmenu-globe-hover') !== 'programmatic') return;
          globe.style.filter = 'brightness(var(--fx-hover-brightness, 1.12))';
        };
        const onDropmenuGlobeLeave = (ev) => {
          const globe = closestIn(ev.target, '[data-prefix="img"]');
          if (!globe || !frame.contains(globe) || !isDropmenuGlobeImg(globe)) return;
          globe.style.filter = '';
        };
        const dropmenuDoc = frame.ownerDocument || (typeof document !== 'undefined' ? document : null);
        if (dropmenuDoc) {
          dropmenuDoc.addEventListener('click', closeDropmenuOutside);
          dropmenuDoc.addEventListener('pointerover', onDropmenuGlobeEnter);
          dropmenuDoc.addEventListener('pointerout', onDropmenuGlobeLeave);
          frame.__fxDropmenuCleanup = () => {
            dropmenuDoc.removeEventListener('click', closeDropmenuOutside);
            dropmenuDoc.removeEventListener('pointerover', onDropmenuGlobeEnter);
            dropmenuDoc.removeEventListener('pointerout', onDropmenuGlobeLeave);
            frame.__fxDropmenuCleanup = null;
          };
        }
        const switchSwipeOwner = (target) => {
          if (!target || !target.closest) return null;
          let owner = target.closest('[data-switch-owner][data-switch-page-source="component-set-variant"]');
          if (!owner) {
            const host = target.closest('[data-switch-swipe-host],[data-switch-variant-external]');
            const sid = host && (host.getAttribute('data-switch-swipe-host') || host.getAttribute('data-switch'));
            if (sid) {
              owner = frame.querySelector(`[data-switch-owner][data-switch="${sid}"][data-switch-page-source="component-set-variant"]`);
            }
          }
          if (!owner) return null;
          if (owner.getAttribute('data-switch-variant-mount-status') !== 'owner-local-mutually-exclusive') return null;
          if (Number(owner.getAttribute('data-switch-variant-count') || 0) < 2) return null;
          return owner;
        };
        const hscrollSurfacesOf = (host) => {
          if (!host || !host.querySelectorAll) return [];
          const direct = [...host.querySelectorAll(':scope > [data-hscroll-surface="true"], :scope > [data-hscroll-overflow-child="true"]')];
          return direct.length ? direct : [...host.querySelectorAll('[data-hscroll-surface="true"], [data-hscroll-overflow-child="true"]')];
        };
        const hscrollSurfaceOf = (host) => hscrollSurfacesOf(host)[0] || null;
        const hscrollOffsetOf = (surface) => {
          const left = Number.parseFloat(surface && surface.style.left || '0');
          if (!Number.isFinite(left)) return 0;
          const restAttr = Number(surface && surface.getAttribute('data-hscroll-rest-left'));
          const rest = Number.isFinite(restAttr) ? restAttr : left;
          return rest - left;
        };
        const applyHscrollOffset = (surface, offset) => {
          if (!surface) return 0;
          const currentLeft = Number.parseFloat(surface.style.left || '0');
          let rest = Number(surface.getAttribute('data-hscroll-rest-left'));
          if (!Number.isFinite(rest)) {
            rest = Number.isFinite(currentLeft) ? currentLeft : 0;
            surface.setAttribute('data-hscroll-rest-left', String(rest));
          }
          let max = Number(surface.getAttribute('data-hscroll-max'));
          if (!Number.isFinite(max) || max <= 0) {
            const host = surface.closest('[data-hscroll]') || surface.parentElement;
            const hostW = Number(host && host.clientWidth);
            const trackW = Number(surface.offsetWidth);
            if (Number.isFinite(hostW) && Number.isFinite(trackW) && trackW > hostW + 0.5) {
              max = trackW - hostW;
              surface.setAttribute('data-hscroll-max', String(max));
            }
          }
          if (!Number.isFinite(rest) || !Number.isFinite(max) || max <= 0) return 0;
          const next = Math.max(0, Math.min(max, Number(offset) || 0));
          surface.style.left = (rest - next) + 'px';
          surface.setAttribute('data-hscroll-offset', String(next));
          /* Keep the host-edge clip pinned to the viewport while the track
             translates, otherwise dates paint over the rest-state left labels. */
          const hostClip = Number(surface.getAttribute('data-hscroll-host-clip'));
          if (Number.isFinite(hostClip)) {
            surface.style.clipPath = next > 0
              ? 'inset(0px 0px 0px ' + (hostClip + next) + 'px)'
              : 'none';
          }
          return next;
        };
        const setHscrollOffset = (surface, offset, host) => {
          const surfaces = host ? hscrollSurfacesOf(host) : (surface ? [surface] : []);
          let next = 0;
          for (const track of surfaces) next = applyHscrollOffset(track, offset);
          if (host) syncCalendarNowFromHost(host);
          return next;
        };
        const pad2 = (value) => String(value).padStart(2, '0');
        const calendarTodayStamp = () => {
          const now = new Date();
          return pad2(now.getMonth() + 1) + '/' + pad2(now.getDate());
        };
        const calendarScrollHost = (el) => {
          if (!el) return null;
          return el.closest('[data-hscroll="x"]')
            || (el.parentElement && el.parentElement.querySelector('[data-hscroll="x"]'))
            || null;
        };
        const calendarNowControlsFor = (el) => {
          if (!el) return [];
          if (el.getAttribute && el.getAttribute('data-calendar-now') === 'true') return [el];
          const scopes = [
            el.closest && el.closest('[data-hscroll]'),
            el.parentElement,
            el.closest && el.closest('.fx-stage'),
            frame,
          ].filter(Boolean);
          for (const scope of scopes) {
            if (!scope.querySelectorAll) continue;
            const found = [...scope.querySelectorAll('[data-calendar-now="true"]')];
            if (found.length) return found;
          }
          return [];
        };
        const setCalendarNowState = (el, state) => {
          const next = state === 'return-today' ? 'return-today' : 'today';
          for (const control of calendarNowControlsFor(el)) {
            control.setAttribute('data-calendar-now-state', next);
            if (next === 'return-today') {
              control.setAttribute('data-btn-press', 'true');
              control.setAttribute('role', 'button');
              control.setAttribute('tabindex', '0');
              control.removeAttribute('aria-disabled');
            } else {
              control.setAttribute('data-btn-press', 'inert');
              control.removeAttribute('role');
              control.removeAttribute('tabindex');
            }
            const textHost = [...control.querySelectorAll('*')].find((node) => {
              const text = (node.textContent || '').trim();
              return node.childElementCount === 0 && (/^\d{1,2}\/\d{1,2}$/.test(text) || text === '返回');
            });
            if (textHost) textHost.textContent = next === 'today' ? calendarTodayStamp() : '返回';
          }
        };
        const hscrollOffsetValue = (host) => {
          const surface = hscrollSurfaceOf(host);
          const offset = Number(surface && surface.getAttribute('data-hscroll-offset'));
          return Number.isFinite(offset) ? offset : 0;
        };
        const syncCalendarNowFromHost = (host) => {
          if (!host) return;
          setCalendarNowState(host, hscrollOffsetValue(host) > 1 ? 'return-today' : 'today');
        };
        const stepHscroll = (host, action) => {
          if (!host) return;
          const surface = hscrollSurfaceOf(host);
          if (!surface) return;
          const amount = Math.max(48, Math.round((host.clientWidth || 0) * 0.72));
          setHscrollOffset(surface, hscrollOffsetValue(host) + (action === 'prev' ? -amount : amount), host);
        };
        const suppressNativeImageDrag = (el) => {
          if (!el || !el.querySelectorAll) return;
          el.style.userSelect = 'none';
          el.style.webkitUserSelect = 'none';
          el.style.webkitTouchCallout = 'none';
          el.style.touchAction = el.getAttribute('data-hscroll') ? 'pan-x' : 'pan-y';
          for (const img of el.querySelectorAll('img')) {
            img.setAttribute('draggable', 'false');
            img.style.userSelect = 'none';
            img.style.webkitUserDrag = 'none';
            img.style.pointerEvents = 'none';
          }
        };
        for (const host of frame.querySelectorAll('[data-hscroll],[data-switch-owner],[data-switch-swipe-host]')) {
          suppressNativeImageDrag(host);
        }
        for (const control of frame.querySelectorAll('[data-calendar-now="true"]')) {
          setCalendarNowState(control, 'today');
        }
        frame.addEventListener('pointerdown', (ev) => {
          const host = ev.target && ev.target.closest ? ev.target.closest('[data-hscroll][data-hscroll-drag="true"]') : null;
          const swipeOwner = !host ? switchSwipeOwner(ev.target) : null;
          if (!host && !swipeOwner) return;
          /* Synthetic Playwright PointerEvents omit isPrimary. Treat an
             explicit false as a non-primary pointer, but accept missing. */
          if (ev.isPrimary === false) return;
          const surface = host ? hscrollSurfaceOf(host) : null;
          if (host && !surface) return;
          if (host) suppressNativeImageDrag(host);
          if (swipeOwner) suppressNativeImageDrag(swipeOwner);
          if (typeof window !== 'undefined' && window.getSelection) {
            try { window.getSelection().removeAllRanges(); } catch { /* ignore */ }
          }
          drag = host
            ? { kind: 'hscroll', host, surface, x: ev.clientX, left: hscrollOffsetOf(surface), moved: false }
            : { kind: 'switch-swipe', owner: swipeOwner, x: ev.clientX, moved: false };
          const captureEl = host || swipeOwner;
          if (captureEl && captureEl.setPointerCapture) {
            try { captureEl.setPointerCapture(ev.pointerId); } catch { /* synthetic/unsupported pointer stream */ }
          }
        });
        frame.addEventListener('pointermove', (ev) => {
          if (!drag) return;
          const delta = ev.clientX - drag.x;
          if (Math.abs(delta) > 5) {
            drag.moved = true;
            if (drag.kind === 'hscroll') drag.host.setAttribute('data-hscroll-dragging', 'true');
            ev.preventDefault();
          }
          if (drag.kind === 'hscroll') setHscrollOffset(drag.surface, drag.left - delta, drag.host);
        });
        const endHscrollDrag = (ev) => {
          if (!drag) return;
          const current = drag;
          if (current.kind === 'switch-swipe' && current.moved && current.owner) {
            const delta = (ev && Number.isFinite(ev.clientX) ? ev.clientX : current.x) - current.x;
            if (Math.abs(delta) >= 48) {
              const sid = current.owner.getAttribute('data-switch');
              const active = Number(current.owner.getAttribute('data-switch-index') || 0);
              applySwitch(sid, delta < 0 ? active + 1 : active - 1);
            }
            current.owner.__fxHscrollSuppressClick = true;
            setTimeout(() => { current.owner.__fxHscrollSuppressClick = false; }, 0);
          }
          if (current.kind === 'hscroll') {
            if (current.moved) {
              const host = current.host;
              host.__fxHscrollSuppressClick = true;
              setTimeout(() => { host.__fxHscrollSuppressClick = false; }, 0);
            }
            current.host.removeAttribute('data-hscroll-dragging');
          }
          drag = null;
        };
        frame.addEventListener('pointerup', endHscrollDrag);
        frame.addEventListener('pointercancel', endHscrollDrag);
        frame.addEventListener('wheel', (ev) => {
          const host = ev.target && ev.target.closest ? ev.target.closest('[data-hscroll="x"]') : null;
          if (!host) return;
          const surface = hscrollSurfaceOf(host);
          if (!surface) return;
          const max = Number(surface.getAttribute('data-hscroll-max'));
          if (!Number.isFinite(max) || max <= 0) return;
          const delta = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
          if (!delta) return;
          setHscrollOffset(surface, hscrollOffsetOf(surface) + delta, host);
          ev.preventDefault();
        }, { passive: false });
        const currentSectionNumber = () => {
          const viewportMidpoint = (typeof window !== 'undefined' ? window.innerHeight : 0) * 0.5;
          let best = null, bestTop = -Infinity;
          ids.forEach((sid, index) => {
            const el = Array.from(frame.querySelectorAll('.fx-stage[data-node-id]') || [])
              .find((node) => node.getAttribute('data-node-id') === 'section-' + sid);
            if (!el) return;
            const rect = el.getBoundingClientRect();
            if (!rect.height) return;
            if (rect.top <= viewportMidpoint && rect.top > bestTop) {
              best = index + 1;
              bestTop = rect.top;
            }
          });
          return best || 1;
        };
        const syncFixFromOverlays = () => {
          const sectionNo = currentSectionNumber();
          const shells = typeof frame.querySelectorAll === 'function'
            ? Array.from(frame.querySelectorAll('[data-fix-from]') || []) : [];
          for (const shell of shells) {
            const from = Number(shell.getAttribute('data-fix-from'));
            if (!Number.isFinite(from) || from < 1) continue;
            const show = sectionNo >= from;
            shell.hidden = !show;
            shell.style.visibility = show ? '' : 'hidden';
            shell.style.pointerEvents = show ? 'none' : 'none';
            if (show) shell.removeAttribute('aria-hidden');
            else shell.setAttribute('aria-hidden', 'true');
            shell.setAttribute('data-fix-from-active', show ? 'true' : 'false');
          }
        };
        const onNavigationScroll = () => {
          if (navLock) {
            clearTimeout(navLockIdle);
            navLockIdle = setTimeout(unlockFixedNavigation, 250);
            syncFixFromOverlays();
            return;
          }
          if (navigationFrame != null) return;
          const sync = () => {
            navigationFrame = null;
            syncFixedNavigation();
            syncFixFromOverlays();
          };
          navigationFrame = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
            ? window.requestAnimationFrame(sync) : setTimeout(sync, 0);
        };
        frame.addEventListener('scroll', onNavigationScroll, { passive: true });
        if (typeof window !== 'undefined') {
          window.addEventListener('scroll', onNavigationScroll, { passive: true });
          for (const event of ['wheel', 'touchstart', 'keydown']) window.addEventListener(event, unlockFixedNavigation, { passive: true });
        }
        syncFixedNavigation();
        syncFixFromOverlays();
      }
      /* renderApp can be called again for a device/scale change while the
         delegated listener deliberately survives. Rebuild the DOM-side nav
         mapping every render so those persistent listeners never point at
         detached controls. */
      /* The render-check's minimal DOM deliberately has no selector engine.
         Rebuild the live-navigation map only where browser DOM evidence can
         actually be queried; the paint-only check remains a valid renderer
         smoke path. */
      if (typeof frame.querySelectorAll === 'function') {
        frame.__fxFixedNavigation = (() => {
          const anchors = ids.map((sid) => Array.from(frame.querySelectorAll('.fx-stage[data-node-id]') || [])
            .find((el) => el.getAttribute('data-node-id') === 'section-' + sid)).filter(Boolean);
          const groups = new Map();
          for (const item of Array.from(frame.querySelectorAll('[data-nav-item][data-nav-owner]') || [])) {
            const owner = item.getAttribute('data-nav-owner');
            if (!groups.has(owner)) groups.set(owner, []);
            groups.get(owner).push(item);
          }
          const wired = [];
          for (const items of groups.values()) {
            if (items.length !== anchors.length || !anchors.length) continue;
            items.forEach((item, index) => {
              item.setAttribute('data-sec-target', anchors[index].getAttribute('data-node'));
              item.setAttribute('data-nav-index', String(index));
              item.setAttribute('aria-current', index === 0 ? 'true' : 'false');
            });
            wired.push({ items, anchors });
          }
          return wired;
        })();
      }
      if (typeof frame.__fxSyncFixedNavigation === 'function') frame.__fxSyncFixedNavigation();
      this._installHeroScrollSlot(frame, heroSlot);
      this._installMotionAdapter(frame, motionAdapter);
      this._installAssetScheduler(frame);

      /* 超框缩字号放在 stage 挂载之后：scrollHeight 要元素进了文档才量得到，
         在 paint 里（元素还 detached）量永远是 0，会假装"没超框"。

         ⚠️ 而且**必须等字体就绪再量**。这是实测踩出来的：
         renderApp 跑完时 webfont 往往还没加载完（读数当时显示"字体 0/3 已加载"），
         于是测量用的是兜底字体的度量。稿里正文用的字体中文字宽 0.85em，
         而兜底的雅黑是 1.00em —— 宽出 18%，本来一行的量成两行、两行的量成三行，
         结果**简中视图下 6 条文字全被判超框、各缩一档**，而简中本该一条都不缩。
         凡是依赖文字尺寸的测量（缩字号、字宽对账、溢出清单），都必须排在
         document.fonts.ready 之后，否则量的是另一套字体。 */
      const growHugOwners = () => {
        for (const g of hugGrowthOwners) {
          const owner = g.ownerEl;
          if (!owner || typeof owner.scrollHeight !== 'number') continue;
          const needed = owner.scrollHeight;
          const srcH = Number.isFinite(g.sourceOwnerH) ? g.sourceOwnerH : 0;
          if (needed > srcH + 0.5) {
            owner.style.height = 'auto';
            owner.style.minHeight = srcH + 'px';
            owner.setAttribute('data-owner-vertical-growth', 'hug-content');
          }
        }
      };
      const runFit = () => {
        /* Source-anchored one-line title safety: the source's widest glyph
           run establishes how much of the real Figma title slot may be used.
           This is deliberately a group prepass, not a page/node/text special
           case; it applies wherever sibling components reuse a title slot. */
        const titleSafeGroups = new Map();
        const semanticBreakGroups = new Set(fitCandidates.filter((c) => c.semanticBreak && c.groupKey).map((c) => c.groupKey));
        for (const c of fitCandidates) {
          if (!c.sourceTitleInlineSafe || !c.groupKey) continue;
          if (!titleSafeGroups.has(c.groupKey)) titleSafeGroups.set(c.groupKey, []);
          titleSafeGroups.get(c.groupKey).push(c);
        }
        for (const members of titleSafeGroups.values()) {
          if (semanticBreakGroups.has(members[0]?.groupKey)) continue;
          if (members.length < 2) continue;
          const slotLimit = Math.min(...members.map((c) => Number(c.box && c.box.w)).filter((w) => Number.isFinite(w) && w > 0));
          const sourceMax = Math.max(...members.map((c) => this._measureInlineText(c.el, c.sourceTitleText, {
            fontFamily: c.tx.fontFamily, fontSize: c.tx.fontSize, lineHeight: c.tx.lineHeight,
            fontWeight: c.tx.fontWeight, letterSpacing: c.tx.letterSpacing,
          })).filter((w) => Number.isFinite(w) && w > 0));
          const safeWidth = Math.min(slotLimit, sourceMax);
          if (!Number.isFinite(safeWidth) || safeWidth <= 0) continue;
          for (const c of members) {
            c.widthFit = safeWidth;
            c.el.setAttribute('data-fit-inline-safe-width', String(safeWidth));
            c.el.setAttribute('data-fit-inline-source-max', String(sourceMax));
          }
        }
        for (const c of fitCandidates) this._fitText(c.el, c.tx, c.box, { widthFit: c.widthFit, heightFit: c.heightFit, sourceTitleInlineSafe: c.sourceTitleInlineSafe, semanticBreak: c.semanticBreak });
        /* 组级最小统一字号（required-scale prepass，官网实证：同一组件组标题/正文
           统一字号，最严格成员定全组等级，其余兄弟跟随，最长项折行也不单独缩）。
           逐成员 step-fit 后读取各自"所需 scale"（未缩=100）；组内取 min，若确有成员
           溢出（min<100）则把该档回灌全组（含本来不缩的短项），并回灌 owner 高度使
           视觉一致；若组内无任何成员溢出（全在源字号下成立），保持源字号不动——
           保住 zh-CN 保真与本就合适的语言，不盲目统一降组。 */
        const groups = new Map();
        for (const c of fitCandidates) {
          if (!c.groupKey) continue;
          const sAttr = c.el.getAttribute('data-fit-scale');
          const required = sAttr == null ? 100 : Number(sAttr);
          if (!groups.has(c.groupKey)) groups.set(c.groupKey, []);
          groups.get(c.groupKey).push({ c, required });
        }
        for (const members of groups.values()) {
          if (members.length < 2) continue;
          const minScale = Math.min(...members.map((m) => m.required));
          if (minScale >= 100) continue; // all fit at source size: keep source
          for (const m of members) {
            if (m.required === minScale) continue; // already at strictest
            const _gFs = Number(m.c.el.getAttribute('data-locale-base-fontsize'));
            const _gLh = Number(m.c.el.getAttribute('data-locale-base-lineheight'));
            m.c.el.style.fontSize = ((Number.isFinite(_gFs) && _gFs > 0 ? _gFs : m.c.tx.fontSize) * minScale / 100) + 'px';
            m.c.el.style.lineHeight = ((Number.isFinite(_gLh) && _gLh > 0 ? _gLh : m.c.tx.lineHeight) * minScale / 100) + 'px';
            m.c.el.setAttribute('data-fit-scale', String(minScale));
            m.c.el.setAttribute('data-fit-group-unified', String(m.required) + '->' + String(minScale));
          }
        }
      };
      if (typeof document !== 'undefined' && document.fonts && document.fonts.ready
          && typeof document.fonts.ready.then === 'function') {
        // 先按当前状态量一次（字体已缓存时这一次就是终态），字体就绪后再量一次收口。
        runFit();
        growHugOwners();
        document.fonts.ready.then(() => {
          // 重量之前把上一轮的痕迹清掉，否则会在已缩过的基础上继续缩（越缩越小）
          for (const c of fitCandidates) {
            /* 重置到 locale 基准（官方缩放后），无缩放时回退 Figma 源字号。 */
            const _lbFs = Number(c.el.getAttribute('data-locale-base-fontsize'));
            const _lbLh = Number(c.el.getAttribute('data-locale-base-lineheight'));
            c.el.style.fontSize = (Number.isFinite(_lbFs) && _lbFs > 0 ? _lbFs : c.tx.fontSize) + 'px';
            c.el.style.lineHeight = (Number.isFinite(_lbLh) && _lbLh > 0 ? _lbLh : c.tx.lineHeight) + 'px';
            c.el.removeAttribute('data-fit-scale');
            c.el.removeAttribute('data-fit-overflow');
          }
          runFit();
          growHugOwners();
          // 通知壳重算读数（缩字号条数/字宽对账都变了）
          if (typeof window !== 'undefined' && typeof window.__fxOnFontsReady === 'function') {
            window.__fxOnFontsReady();
          }
        });
      } else {
        runFit();   // 没有 FontFaceSet 的环境（Node 冒烟桩）按原样量一次
        growHugOwners();
      }
  },
  };
})();
