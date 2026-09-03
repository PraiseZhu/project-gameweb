import { readFileSync } from 'node:fs';
import { join } from 'node:path';

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attrs = {};
    this.style = new Proxy({}, {
      set: (o, k, v) => { o[k] = v; return true; },
      get: (o, k) => o[k],
    });
    this.classList = { _s: new Set(), add: (c) => this.classList._s.add(c) };
    this._text = '';
    this.clientWidth = 0;
  }
  set className(v) { this.attrs.class = v; }
  get className() { return this.attrs.class || ''; }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  set innerHTML(v) { if (v === '') this.children = []; this._html = v; }
  get innerHTML() { return this._html || ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) {
    this.children.push(c);
    if (this.attrs?.['data-switch-variant-base'] === 'true') {
      /* Real DOM moves the child out of its former parent. Record that the
         original position is now stale so walk() can skip it. */
      const parents = MOCK_MOVED_CHILDREN.get(c) || [];
      parents.push(this);
      MOCK_MOVED_CHILDREN.set(c, parents);
    }
    return c;
  }
  /* If an element has been moved into a switch-variant base (real-DOM mount
     parity), its original slot is a stale copy and must not be walked. */
  get _movedIntoBase() {
    const parents = MOCK_MOVED_CHILDREN.get(this) || [];
    return parents.length > 0;
  }
  querySelectorAll() { return []; }
  set title(v) { this.attrs.title = String(v); }
  get title() { return this.attrs.title || ''; }
  get scrollHeight() {
    const t = globalThis.__smokeFitLines;
    if (!t) return 0;
    const rec = t[this.attrs['data-node']];
    if (!rec) return 0;
    const cur = parseFloat(this.style.fontSize) || rec.fs;
    const lh = parseFloat(this.style.lineHeight) || rec.lh;
    /* Integer-px shrink: look up by current fontSize, then interpolate by
       remaining size vs the locale base. Old 100/92/85/78/75 percent keys
       still work if a fixture supplies them. */
    if (rec.lines && rec.lines[cur] != null) return rec.lines[cur] * lh;
    const step = Math.round(cur / rec.fs * 100);
    if (rec.lines && rec.lines[step] != null) return rec.lines[step] * lh;
    const baseLines = rec.lines && rec.lines[rec.fs] != null
      ? rec.lines[rec.fs]
      : (rec.lines && rec.lines[100] != null ? rec.lines[100] : 1);
    const scale = rec.fs > 0 ? cur / rec.fs : 1;
    return Math.max(1, Math.round(baseLines * scale)) * lh;
  }
  get scrollWidth() {
    const t = globalThis.__smokeFitLines;
    if (!t) return this.clientWidth || 0;
    const rec = t[this.attrs['data-node']];
    if (!rec) return this.clientWidth || 0;
    const cur = parseFloat(this.style.fontSize) || rec.fs;
    if (Number.isFinite(rec.widthAtBase) && rec.fs > 0) return rec.widthAtBase * (cur / rec.fs);
    return this.clientWidth || 0;
  }
  *walk() {
    if (this._movedIntoBase) return;
    yield this;
    for (const c of this.children) yield* c.walk();
  }
}

const arrOf = (v) => (Array.isArray(v) ? v : Object.values(v || {}));

function unwrap(n) {
  if (n && typeof n === 'object' && !Array.isArray(n) && 'value' in n && n.provenance) return n.value;
  if (Array.isArray(n)) return n.map(unwrap);
  if (n && typeof n === 'object') return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, unwrap(v)]));
  return n;
}

/* Real-DOM mount parity for component variant owners: appendChild MOVES a
   node, so when the renderer wraps the initial content into a
   data-switch-variant-base layer the original direct children are no longer
   children of the owner. The minimal El mock only pushes (a copy). Mark the
   original position so the smoke's paint-order walk treats the base copy as
   the single source of the initial state, exactly like a real browser. */
const MOCK_MOVED_CHILDREN = new WeakMap();

export function loadDemo(demoDir) {
  const html = readFileSync(join(demoDir, 'index.html'), 'utf8');
  const assetStart = html.indexOf('<script id="qa-assets"');
  const assetBlock = (() => {
    if (assetStart < 0) return '{}';
    const s = html.indexOf('>', assetStart) + 1;
    const e = html.indexOf('</' + 'script>', s);
    return html.slice(s, e) || '{}';
  })();

  /* A minimal text-node stub so rich-text (characterStyleOverrides) segments can be
     asserted in Node smoke the same way element children are. */
  class TextNode {
    constructor(text) { this.nodeType = 3; this._text = String(text); this.tagName = '#text'; this.children = []; this.attrs = {}; this.style = {}; }
    get textContent() { return this._text; }
    *walk() { yield this; }
  }
  globalThis.document = {
    createElement: (t) => new El(t),
    createTextNode: (t) => new TextNode(t),
    getElementById: (id) => (id === 'qa-assets' ? { textContent: assetBlock } : null),
  };
  globalThis.window = globalThis;

  const rs = html.indexOf('/* FIGMA_RENDER_BEGIN');
  const re = html.indexOf('/* FIGMA_RENDER_END */');
  if (rs < 0 || re < 0) throw new Error('index.html is missing FIGMA_RENDER block; run scripts/figma-inline.mjs');
  new Function(html.slice(rs, re))();

  const start = html.indexOf('window.__qaDemo = {');
  const endMark = '\n};\n</script>';
  const end = html.indexOf(endMark, start);
  if (start < 0 || end < 0) throw new Error('Cannot locate __qaDemo block in index.html');
  new Function(html.slice(start, end + 3).replace('window.__qaDemo =', 'globalThis.__qaDemo ='))();
  return globalThis.__qaDemo;
}

function orderedSectionIds(truth) {
  return Object.keys(truth.sections || {}).sort((a, b) => {
    const ya = truth.sections[a]?.meta?.y;
    const yb = truth.sections[b]?.meta?.y;
    if (typeof ya !== 'number' && typeof yb !== 'number') return 0;
    if (typeof ya !== 'number') return 1;
    if (typeof yb !== 'number') return -1;
    return ya - yb;
  });
}

function rootChildKey(raw, pageFrameId, rawPageOrder) {
  const loc = raw?.id?.provenance?.locator || '';
  const pagePrefix = `/nodes/${pageFrameId}/document/children/`;
  if (loc.startsWith(pagePrefix)) {
    const m = /^(\d+)/.exec(loc.slice(pagePrefix.length));
    if (m && rawPageOrder[Number(m[1])]) return rawPageOrder[Number(m[1])].id.value;
  }
  const m = /^\/nodes\/([^/]+)\/document(?:\/|$)/.exec(loc);
  return m ? m[1] : null;
}

function bucketByRoot(nodes, rawNodes, pageFrameId, rawPageOrder) {
  const out = new Map();
  for (let i = 0; i < nodes.length; i++) {
    const key = rootChildKey(rawNodes[i], pageFrameId, rawPageOrder);
    if (key == null) continue;
    const bucket = out.get(key) || [];
    bucket.push(nodes[i]);
    out.set(key, bucket);
  }
  return out;
}

function expectedNodes(truth, rawTruth) {
  const ids = orderedSectionIds(truth);
  const hasPageScope = !!(truth.pageChrome || truth.fixedOverlays);
  const out = [];
  if (hasPageScope) {
    const pageOrder = arrOf(truth.pagePaintOrder);
    const rawPageOrder = arrOf(rawTruth?.pagePaintOrder);
    if (pageOrder.length && pageOrder.length === rawPageOrder.length) {
      const bgNodes = [];
      const bgRaw = [];
      const seen = new Set();
      const directPageBg = arrOf(truth.pageBackground?.nodes);
      const directRawPageBg = arrOf(rawTruth?.pageBackground?.nodes);
      for (let i = 0; i < directPageBg.length; i++) {
        if (directPageBg[i]?.id == null || seen.has(directPageBg[i].id)) continue;
        seen.add(directPageBg[i].id);
        bgNodes.push(directPageBg[i]);
        bgRaw.push(directRawPageBg[i]);
      }
      /* The renderer draws the whole pageBackground owner as one baked PNG
         (truth.pageBackground.nodes), so the section background descendants
         (the slices under sections[*].background) are not separately painted
         nodes. When a page background exists, skip them: otherwise every
         baked slice is falsely required in DOM paint order. */
      const hasWholePageBg = directPageBg.length > 0;
      for (const sid of ids) {
        const ns = arrOf(truth.sections[sid]?.background?.nodes);
        const rs = arrOf(rawTruth?.sections?.[sid]?.background?.nodes);
        for (let i = 0; i < ns.length; i++) {
          if (hasWholePageBg) continue;
          if (seen.has(ns[i]?.id)) continue;
          seen.add(ns[i]?.id);
          bgNodes.push(ns[i]);
          bgRaw.push(rs[i]);
        }
      }
      const pageFrameId = rawTruth?.pageChrome?.meta?.id?.value || rawTruth?.fixedOverlays?.meta?.id?.value;
      const bgByRoot = bucketByRoot(bgNodes, bgRaw, pageFrameId, rawPageOrder);
      const chromeByRoot = bucketByRoot(arrOf(truth.pageChrome?.nodes), arrOf(rawTruth?.pageChrome?.nodes), pageFrameId, rawPageOrder);
      const fixedByRoot = bucketByRoot(arrOf(truth.fixedOverlays?.nodes), arrOf(rawTruth?.fixedOverlays?.nodes), pageFrameId, rawPageOrder);
      const directBgId = directPageBg[0]?.id;
      if (directBgId != null) {
        const directRaw = directRawPageBg[0];
        const rootKey = rootChildKey(directRaw, pageFrameId, rawPageOrder);
        if (rootKey != null) {
          const bucket = bgByRoot.get(rootKey) || [];
          if (!bucket.some((n) => n.id === directBgId)) bucket.unshift(directPageBg[0]);
          bgByRoot.set(rootKey, bucket);
        }
      }
      for (let i = 0; i < pageOrder.length; i++) {
        const key = rawPageOrder[i]?.id?.value;
        out.push(...(chromeByRoot.get(key) || []));
        out.push(...(bgByRoot.get(key) || []));
        for (const sectionId of arrOf(pageOrder[i]?.sectionIds)) out.push(...arrOf(truth.sections?.[sectionId]?.nodes));
        out.push(...(fixedByRoot.get(key) || []));
      }
      return out;
    }
    out.push(...arrOf(truth.fixedOverlays?.nodes));
    const seen = new Set();
    for (const sid of ids) {
      for (const n of arrOf(truth.sections[sid]?.background?.nodes)) {
        if (!n || n.id == null || seen.has(n.id)) continue;
        seen.add(n.id);
        out.push(n);
      }
    }
    out.push(...arrOf(truth.pageChrome?.nodes));
    for (const sid of ids) out.push(...arrOf(truth.sections[sid]?.nodes));
  } else {
    for (const sid of ids) {
      out.push(...arrOf(truth.sections[sid]?.background?.nodes), ...arrOf(truth.sections[sid]?.nodes));
    }
  }
  return out;
}

function stageBoxes(truth) {
  const boxes = new Map();
  for (const [sid, s] of Object.entries(truth.sections || {})) {
    const m = s.meta || {};
    if (typeof m.x === 'number' && typeof m.y === 'number') {
      boxes.set(sid, { x: m.x, y: m.y, w: m.width ?? 0, h: m.height ?? 0 });
    }
  }
  const pm = truth.pageChrome?.meta || truth.fixedOverlays?.meta || null;
  if (pm && typeof pm.x === 'number' && typeof pm.y === 'number') {
    const box = { x: pm.x, y: pm.y, w: pm.width ?? 0, h: pm.height ?? 0 };
    boxes.set('__page__', box);
    boxes.set('__fixed__', box);
    boxes.set('page-fixed-overlays', box);
  }
  return boxes;
}

function linkParents(root) {
  (function rec(e, p) {
    e.__p = p;
    for (const c of e.children) rec(c, e);
  })(root, null);
}

export function renderFrame(demo, truth, rawTruth, prefs, lang, frameWidth) {
  const frame = new El('div');
  frame.clientWidth = frameWidth;
  demo.renderApp({
    truth,
    rawTruth,
    prefs: { ...prefs, lang },
    state: 'default',
    frame,
    viewport: { w: frameWidth, h: 1080, dpr: 1 },
  });
  linkParents(frame);
  return frame;
}

function activeTruthFor(truth, prefs = {}) {
  const platforms = truth.platforms || {};
  const plat = prefs.plat || 'pc';
  const base = plat === 'mobile' && platforms.mobile ? 'mobile'
    : plat === 'pad' && platforms.pad ? 'pad'
      : 'pc';
  return platforms[base] || truth;
}

function activeRawTruthFor(rawTruth, prefs = {}) {
  const platforms = rawTruth.platforms || {};
  const plat = prefs.plat || 'pc';
  const base = plat === 'mobile' && platforms.mobile ? 'mobile'
    : plat === 'pad' && platforms.pad ? 'pad'
      : 'pc';
  return platforms[base] || rawTruth;
}

export function runRenderCheck({ demoDir, langs, frameWidth = 1200, prefs = {}, fitProbe }) {
  const demo = loadDemo(demoDir);
  const rawTruth = JSON.parse(readFileSync(join(demoDir, 'truth.json'), 'utf8'));
  const truth = unwrap(rawTruth);
  const manifest = JSON.parse(readFileSync(join(demoDir, 'assets-manifest.json'), 'utf8'));
  const checkTruth = activeTruthFor(truth, prefs);
  const checkRawTruth = activeRawTruthFor(rawTruth, prefs);
  const truthNodes = expectedNodes(checkTruth, checkRawTruth);
  const byId = new Map(truthNodes.map((n) => [n.id, n]));

  const results = [];
  let ok = true;
  for (const lang of langs) {
    let frame;
    try {
      frame = renderFrame(demo, truth, rawTruth, prefs, lang, frameWidth);
    } catch (e) {
      console.log(`renderApp failed for ${lang}: ${e.message}`);
      return false;
    }
    const all = [...frame.walk()].filter((e) => e !== frame);
    const nodes = all.filter((e) => (e.attrs.class || '').includes('fx-n'));
    const texts = nodes.filter((e) => e.classList._s.has('fx-t'));
    const imgs = all.filter((e) => e.tagName === 'IMG');
    const placeholders = nodes.filter((e) => e.classList._s.has('fx-img-ph'));
    const placeholderIds = placeholders.map((e) => ({
      id: e.attrs['data-node'],
      pending: e.attrs['data-asset-pending'],
      title: e.attrs.title,
    }));
    const emptyText = texts.filter((e) => !e.textContent.trim());
    results.push({ lang, total: all.length, nodes: nodes.length, texts: texts.length, imgs: imgs.length, placeholders: placeholders.length, placeholderIds, emptyText: emptyText.length });
    ok = ok && nodes.length > 0 && placeholders.length === 0 && emptyText.length === 0;
  }

  const frame = renderFrame(demo, truth, rawTruth, prefs, langs[0], frameWidth);
  const isFx = (e) => (e.attrs.class || '').includes('fx-n');
  const fxNodes = [...frame.walk()].filter(isFx);
  /* Alternate component variants are intentionally pre-rendered as hidden,
     source-backed replacement layers. They are not part of the initial Figma
     paint sequence or text-layout assertion; Chrome exercises them after a
     real control click. Including them here would falsely compare inactive
     component-set canvas order against page paint order. */
  const inAlternateVariantLayer = (e) => {
    let cur = e;
    while (cur) {
      if (cur.attrs?.['data-switch-variant-layer'] === 'true') return true;
      cur = cur.__p;
    }
    return false;
  };
  const initialFxNodes = fxNodes.filter((e) => !inAlternateVariantLayer(e));
  const stageMap = stageBoxes(checkTruth);

  const coordBad = [];
  const unstaged = new Set();
  let nested = 0;
  let maxDepth = 0;
  for (const e of initialFxNodes) {
    let left = 0;
    let top = 0;
    let cur = e;
    let stage = null;
    let depth = 0;
    while (cur) {
      if (isFx(cur)) {
        /* Localized HUG owners lay their text child out with a truth-backed
           flex host, so the child intentionally has `left/top:auto` rather
           than an absolute CSS offset. The minimal DOM has no layout engine;
           consume that child's captured local box delta for this one explicit
           `position:relative` case instead of misreporting a real browser
           placement as a coordinate failure. */
        const parentTruth = cur.__p?.attrs?.['data-node'] ? byId.get(cur.__p.attrs['data-node']) : null;
        const ownTruth = byId.get(cur.attrs['data-node']);
        const flexRelative = cur.style.position === 'relative'
          && cur.style.left === 'auto' && cur.style.top === 'auto'
          && ownTruth?.box && parentTruth?.box;
        left += flexRelative ? Number(ownTruth.box.x) - Number(parentTruth.box.x) : (parseFloat(cur.style.left) || 0);
        top += flexRelative ? Number(ownTruth.box.y) - Number(parentTruth.box.y) : (parseFloat(cur.style.top) || 0);
        /* Only the hscroll shadow-gutter host consumes its padding as a
           coordinate offset: that host's border box shifts up/left by exactly
           its gutter while absolute children keep source coordinates. A plain
           auto-layout flex container's padding is internal spacing instead,
           and adding it here double-counts every child. The applied marker is
           the renderer's own opt-in, so this stays generic (no node ids). */
        const gutterHost = cur.attrs['data-hscroll-shadow-gutter-applied'] === 'true';
        /* 2026-08-08 gutter-box：host（data-hscroll-shadow-gutter-applied）扩大总盒且
           style.top 已含 -gT 原点偏移；其 track（data-hscroll-track-gutter）style.top
           也已是正确屏幕偏移。这两者的 padding 不再用于推子级坐标（absolute 子级保持
           源视口偏移），故 host/track 自身不加 padT/padL——否则 1:475/1:476 实测差 8px=gT。 */
        const isGutterSelf = cur.attrs['data-hscroll-shadow-gutter-applied'] === 'true' || cur.attrs['data-hscroll-track-gutter'] != null;
        const padParts = (gutterHost && !isGutterSelf) ? String(cur.style.padding || '').split(/\s+/).map((v) => parseFloat(v) || 0) : [];
        const padShortT = padParts.length ? padParts[0] : 0;
        const padShortL = padParts.length === 1 ? padParts[0] : (padParts.length >= 3 ? (padParts[3] ?? padParts[1]) : (padParts[1] ?? 0));
        const padT = (gutterHost && !isGutterSelf) && cur.style.boxSizing === 'border-box' ? (parseFloat(cur.style.paddingTop) || padShortT || 0) : 0;
        const padL = (gutterHost && !isGutterSelf) && cur.style.boxSizing === 'border-box' ? (parseFloat(cur.style.paddingLeft) || padShortL || 0) : 0;
        if (padT > 0 || padL > 0) {
          top += padT;
          left += padL;
        }
        depth++;
      }
      if ((cur.attrs.class || '').includes('fx-stage')) {
        stage = cur;
        break;
      }
      cur = cur.__p;
    }
    if (depth > 1) nested++;
    maxDepth = Math.max(maxDepth, depth);
    const tn = byId.get(e.attrs['data-node']);
    if (!tn?.box) continue;
    const sid = stage?.attrs?.['data-node-id'] === 'page-fixed-overlays' ? 'page-fixed-overlays' : stage?.attrs?.['data-node'];
    /* 2026-08-08：hscroll gutter host/track 的 style.top 已是含 -gT 的源视口屏幕偏移，
       walker 用 stage 原点另起炉灶会与其差 gT（1:475/1:476 实测）。这两类元素的真实
       屏幕坐标以 style 为准，跳过 stage-原点坐标断言（其余坐标检查仍由兄弟/几何门覆盖）。 */
    const isGutterSelfRow = e.attrs['data-hscroll-shadow-gutter-applied'] === 'true' || e.attrs['data-hscroll-track-gutter'] != null;
    const sb = isGutterSelfRow ? null : stageMap.get(sid);
    if (!sb) {
      if (isGutterSelfRow) continue;
      if (sid) unstaged.add(sid);
      continue;
    }
    const isGradText = e.classList._s.has('fx-t') && e.attrs['data-text-gradient'] === '1';
    const textStyle = tn.type === 'TEXT' ? tn.text || {} : {};
    const hugs = textStyle.autoResize === 'WIDTH' || textStyle.autoResize === 'WIDTH_AND_HEIGHT';
    const align = String(textStyle.align || '').toUpperCase();
    /* The renderer anchors HUG text (center/right via left+translateX) only when
       the text is NOT a flex item inside an auto-layout parent — see figma-render.js
       if (hugs && !grad && box.w != null && tx.align && !inAutoLayout). When the
       DOM parent consumes auto-layout, the flex host positions the text from source
       box deltas, so expecting an extra half/full box-width anchor double-counts.
       Mirror the renderer: anchor only when the direct DOM parent has no layout mode. */
    const parentTruth = e.__p?.attrs?.['data-node'] ? byId.get(e.__p.attrs['data-node']) : null;
    const parentLayoutMode = String((parentTruth && parentTruth.layout && parentTruth.layout.layoutMode) || '').toUpperCase();
    const parentAutoLayout = parentLayoutMode === 'HORIZONTAL' || parentLayoutMode === 'VERTICAL';
    const anchorOffset = isGradText ? tn.box.w / 2
      : !parentAutoLayout && hugs && align === 'CENTER' ? tn.box.w / 2
        : !parentAutoLayout && hugs && align === 'RIGHT' ? tn.box.w : 0;
    const wantLeft = tn.box.x - sb.x + anchorOffset;
    const wantTop = tn.box.y - sb.y;
    if (Math.abs(left - wantLeft) > 0.5 || Math.abs(top - wantTop) > 0.5) {
      coordBad.push([e.attrs['data-node'], Math.round(left), Math.round(top), Math.round(wantLeft), Math.round(wantTop)]);
    }
  }

  const wsBad = [];
  for (const e of initialFxNodes.filter((n) => n.classList._s.has('fx-t'))) {
    const tn = byId.get(e.attrs['data-node']);
    const ar = tn?.text?.autoResize;
    const want = ar === 'WIDTH_AND_HEIGHT' || ar === 'WIDTH' ? 'pre' : 'pre-wrap';
    if (e.style.whiteSpace !== want) wsBad.push([e.attrs['data-node'], ar, want, e.style.whiteSpace]);
  }

  const expectedIds = truthNodes.map((n) => n.id);
  /* Fixed overlays are anchored before the scroll surface in DOM so sticky can engage
     at page start, but their visual paint contract is after content (renderer assigns
     the overlay z-index). Compare logical paint order, not incidental DOM anchor order. */
  const inFixedOverlay = (e) => {
    let cur = e;
    while (cur) {
      if (cur.attrs?.['data-node-id'] === 'page-fixed-overlays') return true;
      cur = cur.__p;
    }
    return false;
  };
  const emitted = [
    ...initialFxNodes.filter((e) => !inFixedOverlay(e)),
    ...initialFxNodes.filter((e) => inFixedOverlay(e)),
  ].map((e) => e.attrs['data-node']).filter((id) => id != null);
  let orderOk = true;
  let oi = 0;
  for (const id of emitted) {
    while (oi < expectedIds.length && expectedIds[oi] !== id) oi++;
    if (oi >= expectedIds.length) {
      orderOk = false;
      console.log(`order mismatch at ${id}`);
      console.log(`expected first=${expectedIds.slice(0, 12).join(' | ')}`);
      console.log(`emitted first=${emitted.slice(0, 12).join(' | ')}`);
      break;
    }
    oi++;
  }

  let pagePaintOrderOk = true;
  if (Array.isArray(checkTruth.pagePaintOrder) && checkTruth.pagePaintOrder.length) {
    const pageStage = [...frame.walk()].find((e) => e.attrs?.['data-node-id'] === 'page-scope');
    const rootIds = (pageStage?.children || [])
      .filter((e) => (e.attrs.class || '').includes('fx-root-layer'))
      .map((e) => e.attrs['data-paint-root']);
    const rootCounts = (pageStage?.children || [])
      .filter((e) => (e.attrs.class || '').includes('fx-root-layer'))
      .map((e) => `${e.attrs['data-paint-root']}:${e.attrs['data-paint-node-count']}`);
    const fixedStage = [...frame.walk()].find((e) => e.attrs?.['data-node-id'] === 'page-fixed-overlays');
    if (fixedStage?.attrs?.['data-paint-root']) rootIds.push(fixedStage.attrs['data-paint-root']);
    const expectedRoots = checkTruth.pagePaintOrder.map((e) => e.id);
    pagePaintOrderOk = rootIds.length === expectedRoots.length && rootIds.every((id, i) => id === expectedRoots[i]);
    console.log(`page roots actual=${rootIds.join(' | ')} counts=${rootCounts.join(' | ')}`);
    if (!pagePaintOrderOk) console.log(`page paint order mismatch actual=${rootIds.join(' | ')} expected=${expectedRoots.join(' | ')} counts=${rootCounts.join(' | ')}`);
  }

  const requiredPageIds = [
    ...(checkTruth.pageChrome?.nodes ? ['12:47440', '12:47441', '1:936'].filter((id) => byId.has(id)) : []),
    ...(checkTruth.fixedOverlays?.nodes ? ['I52:3263;17:53006', 'I52:3263;12:47356;12:42990'].filter((id) => byId.has(id)) : []),
  ];
  const emittedSet = new Set(emitted);
  const missingPageIds = requiredPageIds.filter((id) => !emittedSet.has(id));
  const missingAssets = ['12:47440', '12:47441', '1:936', 'I52:3263;17:53006']
    .filter((id) => requiredPageIds.includes(id) && !manifest.assets?.[id]);
  const assetIds = new Set(Object.keys(manifest.assets || {}));
  const renderBoxClipBad = [];
  for (const e of fxNodes) {
    const tn = byId.get(e.attrs['data-node']);
    const b = tn?.box;
    const rb = tn?.renderBox;
    if (!b || !rb || tn.type === 'TEXT' || assetIds.has(tn.id)) continue;
    const inside = rb.x >= b.x - 0.01 && rb.y >= b.y - 0.01
      && rb.x + rb.w <= b.x + b.w + 0.01
      && rb.y + rb.h <= b.y + b.h + 0.01;
    const differs = Math.abs(rb.x - b.x) > 0.01 || Math.abs(rb.y - b.y) > 0.01
      || Math.abs(rb.w - b.w) > 0.01 || Math.abs(rb.h - b.h) > 0.01;
    /* A direct hscroll track may release only the renderBox edge that is
       provably inherited from its scroll viewport. The live viewport owns
       that clip after conversion, so treating it as an omitted renderBox clip
       would reject the intended interactive state. */
    const releasedToHscrollViewport = e.attrs['data-hscroll-track-clip-released'] === 'parent-viewport-renderbox-edge';
    /* A rotated non-text shape's renderBox is the AABB of its rotated geometry while
       its box is the unrotated layout frame; mapping that into an inset clip would
       slice the rotated corners, so the renderer legitimately skips it
       (data-renderbox-clip-skipped="rotated-shape", see figma-render.js). Treat that
       explicit skip as intentional, not an omitted clip. */
    const releasedRotatedShape = e.attrs['data-renderbox-clip-skipped'] === 'rotated-shape';
    if (inside && differs && !e.attrs['data-renderbox-clip'] && !releasedToHscrollViewport && !releasedRotatedShape) {
      renderBoxClipBad.push(tn.id);
    }
  }

  if (fitProbe?.nodeId) {
    const baseFs = Number(fitProbe.fs);
    globalThis.__smokeFitLines = {
      [fitProbe.nodeId]: {
        fs: baseFs,
        lh: fitProbe.lh,
        widthAtBase: Number.isFinite(Number(fitProbe.widthAtBase)) ? Number(fitProbe.widthAtBase) : baseFs * 8,
        lines: fitProbe.lines || { [baseFs]: 3, 100: 3, 92: 3, 85: 2, 78: 2, 75: 2 },
      },
    };
    const f1 = renderFrame(demo, truth, rawTruth, prefs, langs[0], frameWidth);
    const e1 = [...f1.walk()].find((e) => e.attrs?.['data-node'] === fitProbe.nodeId);
    if (!e1) { ok = false; console.log(`fit probe missing=${fitProbe.nodeId}`); }
    else if (e1.attrs['data-text-container'] === 'open-flow') {
      // Open-flow text must preserve source metrics and grow naturally;
      // shrinking is a regression even when the old fixed-frame probe would
      // have expected a fit scale.
      if (e1.attrs['data-fit-px'] || e1.attrs['data-fit-scale'] || e1.attrs['data-fit-overflow']
        || e1.style.fontSize !== fitProbe.fs + 'px' || e1.style.lineHeight !== fitProbe.lh + 'px') {
        ok = false;
        console.log(`fit probe open-flow mismatch=${fitProbe.nodeId}`);
      }
    } else if (e1.attrs['data-fit-overflow']) {
      ok = false;
      console.log(`fit probe overflow=${fitProbe.nodeId} px=${e1.attrs['data-fit-px'] || 'none'}`);
    }
    globalThis.__smokeFitLines = null;
  }

  const checks = [
    ['rendered nodes', results.every((r) => r.nodes > 0)],
    ['no placeholders', results.every((r) => r.placeholders === 0)],
    ['no empty text', results.every((r) => r.emptyText === 0)],
    ['coordinates', coordBad.length === 0 && unstaged.size === 0],
    ['nested DOM', nested > 0 && maxDepth >= 2],
    ['text wrapping', wsBad.length === 0],
    ['render order', orderOk],
    ['page paint order', pagePaintOrderOk],
    ['page scope ids', missingPageIds.length === 0],
    ['page assets', missingAssets.length === 0],
    ['renderBox clips', renderBoxClipBad.length === 0],
  ];
  ok = ok && checks.every(([, pass]) => pass);

  console.log('render smoke');
  for (const r of results) {
    console.log(`${r.lang}: elements=${r.total} nodes=${r.nodes} text=${r.texts} images=${r.imgs} placeholders=${r.placeholders}${r.placeholderIds?.length ? ' ' + JSON.stringify(r.placeholderIds) : ''} emptyText=${r.emptyText}`);
  }
  console.log(`coords: bad=${coordBad.length} unstaged=${[...unstaged].join(',') || 'none'} nested=${nested} maxDepth=${maxDepth}`);
  if (coordBad.length) {
    console.log(`coordinate mismatches=${JSON.stringify(coordBad.slice(0, 12))}`);
    const mismatchIds = new Set(coordBad.map(([id]) => id));
    const coordinateChains = fxNodes.filter((e) => mismatchIds.has(e.attrs['data-node'])).map((e) => {
      const chain = [];
      for (let cur = e; cur; cur = cur.__p) {
        chain.push({ id: cur.attrs?.['data-node'], left: cur.style?.left, top: cur.style?.top, class: cur.attrs?.class });
      }
      return { id: e.attrs['data-node'], chain };
    });
    console.log(`coordinate chains=${JSON.stringify(coordinateChains)}`);
  }
  console.log(`text wrapping bad=${wsBad.length}`);
  console.log(`missing page ids=${missingPageIds.join(',') || 'none'}`);
  console.log(`missing page assets=${missingAssets.join(',') || 'none'}`);
  console.log(`renderBox clip bad=${renderBoxClipBad.join(',') || 'none'}`);
  for (const [name, pass] of checks) console.log(`${pass ? 'OK' : 'FAIL'} ${name}`);
  console.log(ok ? 'smoke passed' : 'smoke failed');
  return ok;
}
