#!/usr/bin/env node
/**
 * figma-assets.mjs — 把稿里需要切图的节点导出成 PNG，落到 demo 的 assets/。【本 Skill 新增】
 *
 * ═══ 为什么落独立文件而不是 base64 内联 ═══
 *
 * 老师 SKILL.md（P6 第 4 条，硬门）：图片一律落 demo 的 assets/ 独立文件、
 * HTML 用相对路径引用，不全内联。
 *
 * 2026-08-24：抽图当场转 WebP（透明图无损，不透明 quality 90），PNG 原图留在
 * assets/ 当几何校对源。页面 #qa-assets 引用 WebP。HTML 体积闸门卡的是
 * index.html 自身 10MB（常见超因是整份 truth 内嵌），不是 assets/ 文件夹。
 *
 * 实测依据：既有同类产物是 14.3MB 自包含单文件，预算上限 15MB，已经贴线。
 * 而且 base64 让字节涨约 33%，还让浏览器无法缓存图片 —— 加载预算只会越来越难守。
 *
 * ═══ 与 figma-fetch.mjs 的分工 ═══
 *
 * figma-fetch  拉「节点数据」→ fixtures/    （truth 的来源，进防伪链）
 * figma-assets 拉「渲染图片」→ assets/      （二进制资产，不进 truth，走资产清单）
 *
 * 图片本身不适合当 provenance 叶子（二进制没有 JSON locator），
 * 但它有可校验的替代品：**清单里记每张图的 sha256 + 来源 nodeId + 稿版本**。
 * 老师的门 D 有 `asset-sha` 这一类绑定，正是为这种情况准备的。
 *
 * ═══ 切图判定（与渲染层同一套规则，不许两份实现）═══
 *   ready-handoff：切清单 sliceExport，以及可见 IMAGE fill（unknown 只画样子
 *   也要有像素）。无前缀父层的 exportSettings / 空 FRAME 不切，避免烤图锁死子层。
 *   非 ready 的 showcase 仍可按前缀 img/bg/kv、BOOLEAN 箭头、IMAGE fill 切。
 *   其余              →  不切（scroll/ 是容器；普通 btn/ 无 sliceExport 不切）
 *
 * ═══ 用法 ═══
 *   node scripts/figma-assets.mjs --demo <dir>              # 按 truth.json 找出该切的节点并导出
 *   node scripts/figma-assets.mjs --demo <dir> --dry-run    # 只列清单不下载
 *   node scripts/figma-assets.mjs --demo <dir> --scale 2
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { encodeWebpBatch } from './lib/encode-webp.mjs';
import { deriveRole } from './lib/figma-name-semantics.mjs';
import { isWholeFrameSliceNode, sliceExportPaintBox } from '../../../standards/figma-naming/spec/inventory.mjs';

const API = 'https://api.figma.com/v1';
const SLICE_PREFIXES = new Set(['img', 'bg', 'kv']);
const BTN_ARROW_NAME = /(?:左|右)(?:划动|滑动)?(?:按钮|箭头)|(?:prev|next)/i;
const BATCH = 40;               // Figma images 接口一次给太多 id 会超时，分批
const FIGMA_GET_TIMEOUT_MS = 120000;

function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(1);
}

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--demo') a.demo = argv[++i];
    else if (k === '--scale') a.scale = Number(argv[++i]);
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--only') a.only = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--no-webp') a.noWebp = true;
    else if (k === '--reuse-existing') a.reuseExisting = true;
    else fail(`未知参数：${k}`);
  }
  if (!a.demo) fail('必须给 --demo <dir>');
  return a;
}

function readToken(startDir) {
  if (process.env.FIGMA_TOKEN) return process.env.FIGMA_TOKEN.trim();
  if (process.env.FIGMA_ACCESS_TOKEN) return process.env.FIGMA_ACCESS_TOKEN.trim();
  let dir = resolve(startDir);
  for (let i = 0; i < 8; i++) {
    const p = join(dir, '.env');
    if (existsSync(p)) {
      const m = readFileSync(p, 'utf8').match(/^\s*FIGMA_TOKEN\s*=\s*(.+?)\s*$/m);
      if (m) return m[1].trim();
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  fail('找不到 FIGMA_TOKEN（环境变量或工作区根 .env）');
}

/** 解包 provenance 叶子（与渲染层 unwrap 同语义） */
function unwrap(n) {
  if (n && typeof n === 'object' && !Array.isArray(n) && 'value' in n && n.provenance) return n.value;
  if (Array.isArray(n)) return n.map(unwrap);
  if (n && typeof n === 'object') return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, unwrap(v)]));
  return n;
}

/** 填充类型：solid / gradient / image / none */
function fillKind(fills) {
  if (!Array.isArray(fills)) return 'none';
  for (const f of fills) {
    if (!f || f.visible === false) continue;
    if (f.type === 'SOLID') return 'solid';
    if (String(f.type).startsWith('GRADIENT')) return 'gradient';
    if (f.type === 'IMAGE') return 'image';
  }
  return 'none';
}

function spillBox(box, renderBox, threshold = 1) {
  if (!box || !renderBox) return false;
  const dx1 = (box.x ?? 0) - (renderBox.x ?? box.x ?? 0);
  const dy1 = (box.y ?? 0) - (renderBox.y ?? box.y ?? 0);
  const dx2 = ((renderBox.x ?? 0) + (renderBox.w ?? 0)) - ((box.x ?? 0) + (box.w ?? 0));
  const dy2 = ((renderBox.y ?? 0) + (renderBox.h ?? 0)) - ((box.y ?? 0) + (box.h ?? 0));
  return Math.max(dx1, dy1, dx2, dy2) > threshold;
}

function roundBox(b) {
  if (!b) return null;
  return {
    x: +Number(b.x ?? 0).toFixed(3),
    y: +Number(b.y ?? 0).toFixed(3),
    w: +Number(b.w ?? 0).toFixed(3),
    h: +Number(b.h ?? 0).toFixed(3),
  };
}

/** Page-relative boxes live near pageBox. Canvas renderBox is often x≈-14000. */
export function sameCoordinateSpace(a, b, limit = 8000) {
  if (!a || !b) return false;
  return Math.abs(Number(a.x ?? 0) - Number(b.x ?? 0)) < limit
    && Math.abs(Number(a.y ?? 0) - Number(b.y ?? 0)) < limit;
}

/**
 * Manifest exportBox must be page coordinates (sliceExport.box / pageBox).
 * Never emit canvas `renderBox` as the placement rect.
 */
export function pageAlignedExportBox(node, { exportBounds = 'box', renderBox = null } = {}) {
  const paint = sliceExportPaintBox(node);
  if (exportBounds === 'box' && paint) return roundBox(paint);
  const page = node?.pageBox || node?.box || null;
  const listed = node?.sliceExport?.box;
  if (listed) return roundBox(listed);
  if (exportBounds !== 'render') return page ? roundBox(page) : null;
  if (renderBox && page && sameCoordinateSpace(renderBox, page)) return roundBox(renderBox);
  if (renderBox && page) {
    return roundBox({
      x: page.x,
      y: page.y,
      w: renderBox.w ?? page.w,
      h: renderBox.h ?? page.h,
    });
  }
  return page ? roundBox(page) : (renderBox ? roundBox(renderBox) : null);
}

export function isReadyHandoffTruth(truth) {
  return truth?.schema === 'yise-ready-platform-truth/v1'
    || truth?.source?.schema === 'inventory/v2'
    || String(truth?.source?.kind || '') === 'ready-handoff';
}

/** 从 truth 里挑出需要切图的节点 */
function nodesOf(value) {
  return Array.isArray(value) ? value : Object.values(value || {});
}

function withChildNodes(item) {
  return item ? [item, ...nodesOf(item.nodes)] : [];
}

/** Adapted componentVariantGraph plus captured variantTrees. Dedup happens in pickSliceNodes. */
function collectVariantSliceNodes(graph) {
  const fromSets = nodesOf(graph?.componentSets).flatMap((set) => [
    ...nodesOf(set?.nodes),
    ...nodesOf(set?.variants).flatMap(withChildNodes),
  ]);
  const fromComponents = nodesOf(graph?.components).flatMap(withChildNodes);
  const fromTrees = Object.values(graph?.variantTrees || {}).flatMap((trees) =>
    nodesOf(trees).flatMap(withChildNodes));
  return [...fromSets, ...fromComponents, ...fromTrees];
}

export function pickSliceNodes(truth, { minDim = 24 } = {}) {
  /* 非矩形类型（轮廓不是矩形的节点）。渲染层对它们只能按外接矩形画填充，
     够大的方块化一眼可见（第 13 项实测：官网点阵与细三角轮廓成了实心方块）。 */
  const NONRECT = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'ELLIPSE', 'LINE']);
  const listedOnly = isReadyHandoffTruth(truth);
  const out = [];
  const seenNodeIds = new Set();
  if (truth.platforms && Object.keys(truth.platforms).length) {
    const merged = { ...truth, sections: { ...(truth.sections || {}) }, platforms: null };
    const platformGraphs = [];
    for (const [platform, root] of Object.entries(truth.platforms || {})) {
      if (root?.componentVariantGraph) platformGraphs.push(root.componentVariantGraph);
      let first = true;
      const modalNodes = nodesOf(root.modals).flatMap(withChildNodes);
      for (const [sid, sec] of Object.entries(root.sections || {})) {
        const nodes = first
          ? [
            ...nodesOf(root.pageBackground && root.pageBackground.nodes),
            ...nodesOf(root.pageChrome && root.pageChrome.nodes),
            ...nodesOf(root.fixedOverlays && root.fixedOverlays.nodes),
            ...modalNodes,
            ...nodesOf(sec.nodes),
          ]
          : nodesOf(sec.nodes);
        merged.sections[`${platform}:${sid}`] = { ...sec, nodes };
        first = false;
      }
      if (first && modalNodes.length) {
        merged.sections[`${platform}:__modals__`] = { nodes: modalNodes };
      }
    }
    if (!merged.componentVariantGraph && platformGraphs.length) {
      merged.componentVariantGraph = {
        componentSets: platformGraphs.flatMap((graph) => nodesOf(graph.componentSets)),
        components: platformGraphs.flatMap((graph) => nodesOf(graph.components)),
        variantTrees: Object.assign({}, ...platformGraphs.map((graph) => graph.variantTrees || {})),
      };
    }
    truth = merged;
  }
  let includedPageScopeAssets = false;
  const variantSliceNodes = collectVariantSliceNodes(truth.componentVariantGraph);
  for (const [sid, sec] of Object.entries(truth.sections || {})) {
    // nodes 是数组（顺序即 DFS 先序）。节点 id 取 n.id ——
    // ⚠️ 不能用遍历下标当 nodeId：踩过一次，结果向 Figma 发了 ids=0,1,2…
    //    换来 "ID 1 is not a valid node_id"。
    // ⚠️ 背景层也要切：它是稿里另一棵树（页面框下的 bg/*），
    //    漏了它页面上就是一排"缺图"占位 —— 实测漏过 5 张。
    let list = nodesOf(sec.nodes).concat(nodesOf(sec.background && sec.background.nodes));
    if (!includedPageScopeAssets) {
      list = list.concat(
        nodesOf(truth.pageBackground && truth.pageBackground.nodes),
        nodesOf(truth.pageChrome && truth.pageChrome.nodes),
        nodesOf(truth.fixedOverlays && truth.fixedOverlays.nodes),
        variantSliceNodes,
      );
      includedPageScopeAssets = true;
    }
    /* Alternate component states on the selected instance tree. */
    list = list.concat(list.flatMap((node) => nodesOf(node?.componentVariantGraph?.variantTrees)
      .flatMap((tree) => nodesOf(tree?.nodes))));
    for (const n of list) {
      const nid = n.id || n.componentId;
      if (!nid) continue;
      if (seenNodeIds.has(nid)) continue;
      seenNodeIds.add(nid);
      const derived = deriveRole(n);
      if (derived.errors?.length) continue;
      const pfx = SLICE_PREFIXES.has(derived.role) ? derived.role : null;
      const listedSlice = Boolean(n.sliceExport) || isWholeFrameSliceNode(n);
      const hasImageFill = Array.isArray((n.style || {}).fills)
        && (n.style || {}).fills.some((f) => f && f.visible !== false && f.type === 'IMAGE');
      const bakedIntoWholeFrame = !listedSlice && list.some((owner) =>
        owner && isWholeFrameSliceNode(owner) && String(n.parentId) === String(owner.id));
      if (listedOnly) {
        /* Ready handoff: listed sliceExport owners, plus unnamed kv/bg/img
           even when an older pack omitted sliceExport. IMAGE children under a
           whole-frame owner stay inside that PNG. */
        if (n.status === 'skipped') continue;
        if (bakedIntoWholeFrame) continue;
        if (!listedSlice && !hasImageFill) continue;
      }
      if (n.type === 'TEXT' && !pfx) continue;               // unprefixed TEXT is editable copy; visual names can override type
      /* Lead decision (2026-08-10): the page-background owner root (bg/*) is no
         longer baked as one giant PNG — its 233-node subtree is restored in truth
         with 4 ALPHA masks + 98 non-default blends that a single raster destroys.
         The owner root itself has no own fill (a pure structural frame), so it must
         not be sliced; genuinely atomic leaves (decor vectors, image fills, mask
         owners) still bake under the owner tree via the normal rules below. Only
         skip the empty owner root, not blend/mask/image descendants. */
      const ownFills = ((n.style || {}).fills || []).filter((fl) => fl && fl.visible !== false);
      const isEmptyBgOwnerRoot = pfx === 'bg' && n.type !== 'TEXT' && ownFills.length === 0 && Array.isArray(n.ownerPath);
      if (isEmptyBgOwnerRoot) continue;
      const fills = ((n.style || {}).fills || []).filter((f) => f && f.visible !== false);
      const kind = fillKind((n.style || {}).fills);

      /* ═══ 「纯渐变不切图」 ═══
       * 单层渐变 CSS 能**精确**画出来（linear-gradient 的角度与色标就是稿里的原值），
       * 切成图只会更差。而且实测差得很严重：
       *   阴影 745x17309 与 Rectangle 3468575 745x15982 都是单层渐变，
       *   为了显示分区内那 1543px 的一段，切出了 706x16384 / 764x16384 两张图，
       *   合计 14MB —— 更要命的是 **Figma 导出在 16384px 处截断**，图比节点矮，
       *   渲染时拉伸填满节点框会把渐变压扁约 5%，是静默的几何错误。
       * 多层填充仍然切图：叠层的合成顺序在 CSS 里不保证与 Figma 一致，切图更稳。 */
      const b = n.box || {};
      const w = Math.round(b.w ?? 0), h = Math.round(b.h ?? 0);
      /* ═══ 非矩形大节点 → 切图（第 13 项，2026-08-04）═══
       * 渲染层对非矩形只能按外接矩形画填充。实测分界：28 个 <24px 的（6×6 色点等）
       * 矩形近似肉眼无差；≥24px 的（细三角/不规则轮廓）方块化一眼可见 ——
       * 欣仪拿官网截图对比确认的可见问题。阈值 minDim 可由 spec.figma.sliceMinDimPx 覆盖。
       * 退化形状（宽或高为 0，如 Vector 88 的 0×644）也会进清单 —— Figma 可能导不出，
       * 那时落在 noUrl 里报出来，不静默。
       * ⚠️ 优先级在「纯渐变不切」之上：那个豁免是为**矩形**渐变准备的（CSS 精确画），
       * 非矩形的轮廓 CSS 画不出 —— 实测漏过 2128×290 的 Union（OVERLAY 渐变），
       * 它就是"轮廓比渐变精确性更要紧"的反例。 */
      const bigNonRect = NONRECT.has(n.type) && Math.max(w, h) >= minDim;
      /* BOOLEAN/VECTOR directional btn/ arrows are composite contours. CSS
         chevrons/diamonds are forbidden; a missing slice must stay missing,
         not become a white rectangle. Slice even when the inventory left
         sliceExport unset — the name+type is the source identity. */
      const booleanBtnArrow = NONRECT.has(n.type) && derived.role === 'btn'
        && BTN_ARROW_NAME.test(String(n.name || ''));
      /* 多层填充且含位图（IMAGE）→ 整节点切图。Figma 叠层按各自 blendMode 混合
         （SOLID/NORMAL + IMAGE/SOFT_LIGHT 这类），CSS background-blend-mode 只能给
         一个元素里的多层背景统一一套模式，没法逐层指定 —— 硬画必错。整节点 PNG 把
         混合结果烤进去，视觉与稿一致。全 SOLID 叠层不切（CSS background 多色层能
         精确画，见 figma-render 的 data-multifill）。 */
      const multiFillImage = fills.length > 1 && fills.some((f) => f.type === 'IMAGE');
      /* ??????????????exportSettings?2026-08-04 ?? truth??
         ??????"?????"???????????? Slider 17:51300?
         ???? img/ ???????????? */
      const hasExportIntent = Array.isArray(n.exportSettings) && n.exportSettings.length > 0;
      /* Figma alpha/gradient mask 的 owner 必须整体导出：它后面的兄弟依赖 mask 的
         alpha 与原始绘制顺序，拆成 CSS 节点会让局部纹理/背景跨出真实可见区。 */
      const hasMaskOwner = Array.isArray(n.maskChildren) && n.maskChildren.length > 0;
      const onlyGradient = fills.length === 1 && String(fills[0].type).startsWith('GRADIENT');
      if (onlyGradient && !SLICE_PREFIXES.has(pfx) && !listedSlice && !bigNonRect && !booleanBtnArrow && !hasMaskOwner) continue;

      const unnamedKvOwner = isWholeFrameSliceNode(n) && !listedSlice;
      if (!(listedSlice || unnamedKvOwner || SLICE_PREFIXES.has(pfx) || kind === 'gradient' || kind === 'image' || hasImageFill || bigNonRect || booleanBtnArrow || multiFillImage || hasExportIntent || hasMaskOwner)) continue;
      const effects = ((n.style || {}).effects || []).filter((e) => e && e.visible !== false);
      const descendantEffects = ((n.style || {}).descendantEffects || []).filter((e) => e && e.effectType);
      const allEffectTypes = [
        ...effects.map((e) => e.type),
        ...descendantEffects.map((e) => e.effectType),
      ].filter(Boolean);
      const rb = n.renderBox || null;
      const hasSoftSpillEffect = allEffectTypes.some((type) =>
        type === 'DROP_SHADOW' || type === 'LAYER_BLUR' || type === 'BACKGROUND_BLUR');
      /* A baked `img/` instance can carry its entire visual frame (including
         its soft underside) in descendants. Once it is selected as one PNG,
         direct `effects` is no longer evidence of whether its rendered
         pixels spill. Its source renderBox is. Export that render canvas so
         the renderer can place it without stretching or silently trimming
         the card frame at a section boundary. Other slice types retain the
         conservative effect-backed rule. */
      const isBakedImageOwner = pfx === 'img' && (n.type === 'INSTANCE' || n.type === 'COMPONENT');
      /* Inventory bounds:"render" = pageBox, never Figma unclipped canvas ink. */
      const listedInkBox = isWholeFrameSliceNode(n);
      const listedBounds = listedInkBox ? 'box' : n.sliceExport?.bounds;
      const exportBounds = listedBounds
        || (((hasSoftSpillEffect || isBakedImageOwner) && spillBox(n.pageBox || b, rb)) ? 'render' : 'box');
      const clippedVisible = !listedInkBox && rb && b && Number(rb.w) > 0 && Number(rb.h) > 0
        && (Number(rb.w) + 0.5 < Number(b.w) || Number(rb.h) + 0.5 < Number(b.h));
      const exportBox = listedInkBox
        ? pageAlignedExportBox(n, { exportBounds, renderBox: rb })
        : (exportBounds === 'render'
          ? roundBox(n.inkBox || rb)
          : roundBox(clippedVisible ? rb : b));
      const outW = Math.round((exportBox?.w ?? w) || 0);
      const outH = Math.round((exportBox?.h ?? h) || 0);
      // ⚠️ truth 里的键是 w/h，不是 width/height。之前写成 b.width，清单里
      //    designSize 一直是 "0x0" —— 一份本该当证据的清单，记了一路空数。
      const imageRefs = [...new Set(fills
        .filter((f) => f && f.type === 'IMAGE' && f.imageRef)
        .map((f) => String(f.imageRef)))];
      out.push({
        sectionId: sid, nodeId: nid, name: n.name ?? '', type: n.type,
        reason: n.sliceExport ? '清单 sliceExport' : isWholeFrameSliceNode(n) ? '整框 pageBox' : hasMaskOwner ? 'Figma mask owner 合成' : hasExportIntent ? '设计师导出预设' : SLICE_PREFIXES.has(pfx) ? `前缀 ${pfx}/` : multiFillImage ? '多层填充含位图' : booleanBtnArrow ? 'BOOLEAN/VECTOR btn 箭头轮廓' : bigNonRect ? `非矩形轮廓 ≥${minDim}px` : `填充 ${kind}`,
        w: outW, h: outH, box: roundBox(b), renderBox: roundBox(rb), exportBounds, exportBox,
        cropToVisibleBox: !listedInkBox && exportBounds === 'box' && clippedVisible,
        imageRefs: imageRefs.length ? imageRefs : undefined,
        renderCropPolicy: exportBounds === 'render' && isBakedImageOwner ? 'top-left-render-canvas' : null,
        effectTypes: [...new Set(allEffectTypes)],
        descendantEffectTypes: [...new Set(descendantEffects.map((e) => e.effectType).filter(Boolean))],
        dropShadowCount: allEffectTypes.filter((type) => type === 'DROP_SHADOW').length,
        blurCount: allEffectTypes.filter((type) => type === 'LAYER_BLUR' || type === 'BACKGROUND_BLUR').length,
      });
    }
  }
  return out;
}

async function figmaGet(url, token, timeoutMs = FIGMA_GET_TIMEOUT_MS) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { headers: { 'X-Figma-Token': token }, signal: ac.signal });
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
    fail(aborted
      ? `Figma API 超时 ${timeoutMs}ms：${url}`
      : `Figma API 请求失败：${err && err.message ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { fail(`Figma 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`); }
  if (!res.ok || Number(json.status) >= 400) fail(`Figma API 失败 HTTP ${res.status}：${json.err || ''}`);
  return json;
}

/** nodeId → 文件名。带上 nodeId 保证唯一，不靠图层名（图层名会重复、会带斜杠） */
export function assetFileName(nodeId, ext = 'png') {
  return nodeId.replace(/[:;]/g, '-') + '.' + ext;
}

/** 按 PNG 源 sha 去重后再转 WebP。页面引用 WebP；PNG 留盘做几何校对。 */
export function planWebpDelivery(manifest, { assetsDir, demoDir }) {
  const seen = new Map();
  const jobs = [];
  const aliases = [];
  for (const [id, rec] of Object.entries(manifest || {})) {
    if (!rec?.file) continue;
    const sha = rec.pngSha256 || rec.sha256;
    if (!sha) continue;
    if (seen.has(sha)) {
      aliases.push({ nodeId: id, duplicateOf: seen.get(sha) });
      continue;
    }
    seen.set(sha, id);
    const pngName = rec.pngFile || rec.file;
    const webpRel = String(pngName).replace(/\.png$/i, '.webp');
    jobs.push({
      nodeId: id,
      src: join(assetsDir || join(demoDir, 'assets'), String(pngName).replace(/^assets\//, '')),
      dest: join(demoDir, webpRel),
      webpRel,
    });
  }
  return { jobs, aliases };
}

function cropPng(buf, sx, sy, sw, sh) {
  const src = PNG.sync.read(buf);
  const out = new PNG({ width: sw, height: sh });
  PNG.bitblt(src, out, sx, sy, sw, sh, 0, 0);
  return PNG.sync.write(out);
}

function pngSize(buf) {
  if (buf.length <= 24 || buf.readUInt32BE(0) !== 0x89504e47) return { pxW: null, pxH: null };
  return { pxW: buf.readUInt32BE(16), pxH: buf.readUInt32BE(20) };
}

async function main() {
  const a = parseArgs(process.argv);
  const demoDir = resolve(a.demo);
  const truthPath = join(demoDir, 'truth.json');
  if (!existsSync(truthPath)) fail(`缺 ${truthPath}（先跑 scripts/truth.mjs）`);

  const spec = JSON.parse(readFileSync(join(demoDir, 'spec.json'), 'utf8'));
  const fileKey = spec.figma?.fileKey;
  if (!fileKey) fail('spec.json 缺 figma.fileKey');
  const scale = a.scale ?? spec.figma?.exportScale ?? 2;

  const rawTruth = JSON.parse(readFileSync(truthPath, 'utf8'));
  const truth = unwrap(rawTruth);
  const designVersion = truth.design?.fileVersion ?? null;

  let picks = pickSliceNodes(truth, { minDim: spec.figma?.sliceMinDimPx ?? 24 });
  if (a.only && a.only.length) {
    const only = new Set(a.only);
    picks = picks.filter((p) => only.has(p.nodeId));
    const found = new Set(picks.map((p) => p.nodeId));
    const missing = [...only].filter((id) => !found.has(id));
    if (missing.length) fail(`--only 里有 nodeId 不在切图候选中：${missing.join(',')}`);
  }
  const out = {
    ok: true, designVersion, scale,
    total: picks.length,
    byReason: picks.reduce((m, p) => ((m[p.reason] = (m[p.reason] || 0) + 1), m), {}),
  };

  if (a.dryRun) {
    out.dryRun = true;
    out.items = picks.map((p) => ({ nodeId: p.nodeId, name: p.name, size: `${p.w}x${p.h}`, reason: p.reason, effectTypes: p.effectTypes, exportBounds: p.exportBounds, exportBox: p.exportBox }));
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  const assetsDir = join(demoDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  const reuseExisting = a.reuseExisting === true;
  const existingPick = (p) => reuseExisting && existsSync(join(assetsDir, assetFileName(p.nodeId)));
  const fetchPicks = picks.filter((p) => !existingPick(p));
  const reusedPicks = picks.filter((p) => existingPick(p));
  out.reused = reusedPicks.length;
  /* --reuse-existing means "do not hit Figma". Missing PNGs fail loud so a
     hung images API cannot stall html-from-handoff after local extract. */
  if (reuseExisting && fetchPicks.length) {
    fail(`--reuse-existing 缺 PNG，拒绝打 Figma：${fetchPicks.map((p) => p.nodeId).join(',')}`);
  }
  const token = fetchPicks.length ? readToken(demoDir) : null;

  /* ═══ 逐节点定导出倍率 ═══
   * 稿是 3840 宽、对应 1920 的视口 —— 稿本身已经是 2 倍图（2026-08-04 起 exportScale=1，
   * 见 spec.json 的 _exportScaleWhy：再乘 2 是 4 倍像素，纯属浪费）。
   *
   * Figma 会在超出其导出像素预算时静默等比缩小超长 PNG。若仍按请求倍率期待
   * 原尺寸，清单会报“截断”；更糟的是渲染器不知道来源已缩放，容易把非等比结果
   * 当作可用图拉伸。这里提前将每个请求限制在 24MP：导出仍是完整、等比的 Figma
   * 合成图，manifest 的 expectedPx 与实际请求同源，浏览器只做等比放大。24MP 对
   * 3840×17253 的整页背景约为 2314×10393，已高于 1920 PC 实际显示宽度。
   * 这适用于任何超长 owner，不依赖 Etheria 的 node id 或具体高度。 */
  const MAX_EXPORT_PIXELS = 24 * 1024 * 1024;
  const dw = spec.figma?.frames?.pc?.designWidth ?? 3840;
  for (const p of picks) {
    const baseScale = (p.w >= dw * 0.9) ? Math.min(scale, 1) : scale;
    const pixelSafeScale = p.w > 0 && p.h > 0
      ? Math.sqrt(MAX_EXPORT_PIXELS / (p.w * p.h))
      : baseScale;
    p.scale = Math.min(baseScale, pixelSafeScale);
  }
  out.scaleByNode = picks.reduce((m, p) => ((m['x' + p.scale] = (m['x' + p.scale] || 0) + 1), m), {});

  // 1) 分批向 Figma 要图片 URL（按倍率分组，一批只能用一个 scale）
  const urlMap = {};
  const noUrl = [];
  const groups = [];
  for (const key of [...new Set(fetchPicks.map((p) => `${p.scale}|${p.exportBounds}`))]) {
    const [scText, bounds] = key.split('|');
    const sc = Number(scText);
    const g = fetchPicks.filter((p) => p.scale === sc && p.exportBounds === bounds);
    for (let i = 0; i < g.length; i += BATCH) groups.push(g.slice(i, i + BATCH));
  }
  for (const chunk of groups) {
    /* ═══ use_absolute_bounds=true：强制按节点框导出，而不是按墨迹裁剪 ═══
     *
     * 默认导出的是"墨迹"（含投影/发光溢出节点框的部分，且不受祖先裁剪影响），
     * 于是导出的像素尺寸与节点框**不成比例**。而渲染层是把图按 width/height:100%
     * 塞进节点框的 → 图被压缩。实测：img/边框背景类型1 节点框 913 宽，
     * 导出 969 宽（多 56px 投影），塞进 913 → 画面被横向压扁 6%，卡片边框就是这么歪的。
     *
     * 为什么不改成"按墨迹定位图"：墨迹尺寸**预测不了**。实测三种情况互相矛盾 ——
     *   img/按钮背景     导出 = absoluteRenderBounds
     *   img/边框背景类型1 导出宽 = 墨迹宽，导出高 = 节点框高（墨迹被祖先裁过）
     *   img/素材图       墨迹 = 节点框，导出却大 8px
     * absoluteRenderBounds 是**裁剪后**的墨迹，导出是**不裁剪**的，两者没有固定关系。
     *
     * 所以选确定性：让导出严格等于节点框，几何 1:1，尺寸检查随之变成真断言。
     * 代价是溢出节点框的柔边会被切掉 —— 这是有界的已知偏差，且能被看见
     * （renderBox 比 box 大就说明有溢出），比"画面被压扁且无人知晓"好得多。 */
    const q = new URLSearchParams({
      ids: chunk.map((p) => p.nodeId).join(','), format: 'png',
      scale: String(chunk[0].scale),
    });
    if (chunk[0].exportBounds !== 'render') q.set('use_absolute_bounds', 'true');
    const r = await figmaGet(`${API}/images/${fileKey}?${q}`, token);
    for (const p of chunk) {
      const u = r.images?.[p.nodeId];
      if (u) urlMap[p.nodeId] = u;
      else noUrl.push({ nodeId: p.nodeId, name: p.name, why: 'Figma 未返回 URL（该图层可能异常，如带图像填充的 TEXT）' });
    }
  }

  // 2) 下载 + 记 sha256（清单是资产的可校验替代品：二进制没有 JSON locator）
  const manifestPath = join(demoDir, 'assets-manifest.json');
  const previous = a.only && existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  const onlySet = new Set(a.only || []);
  const manifest = previous ? { ...(previous.assets || {}) } : {};
  for (const id of onlySet) delete manifest[id];
  let bytes = previous ? Object.values(manifest).reduce((sum, rec) => sum + Number(rec.bytes || 0), 0) : 0;
  const failed = [];
  const clampedList = [];
  for (const p of reusedPicks) {
    const file = assetFileName(p.nodeId);
    const buf = readFileSync(join(assetsDir, file));
    const { pxW, pxH } = pngSize(buf);
    const expectBox = p.exportBounds === 'render' && p.exportBox ? p.exportBox : p;
    const wantW = Math.round((expectBox.w ?? p.w) * p.scale), wantH = Math.round((expectBox.h ?? p.h) * p.scale);
    const clamped = pxW != null && (Math.abs(pxW - wantW) > 1 || Math.abs(pxH - wantH) > 1);
    if (clamped) {
      clampedList.push({
        nodeId: p.nodeId, name: p.name,
        designSize: `${p.w}x${p.h}`, scale: p.scale,
        expectedPx: `${wantW}x${wantH}`, actualPx: `${pxW}x${pxH}`,
        why: '复用已有 PNG 尺寸与「稿内尺寸×倍率」不符',
        risk: '渲染层拉伸填满节点框，图与节点比例不同 → 内容被压扁/拉长，是静默的几何错误',
        fix: '删掉该 PNG 后重导，或这个节点不该切图',
      });
    }
    bytes += buf.length;
    const pngSha = createHash('sha256').update(buf).digest('hex');
    manifest[p.nodeId] = {
      file: `assets/${file}`,
      pngFile: `assets/${file}`,
      pngSha256: pngSha,
      sha256: pngSha,
      bytes: buf.length,
      name: p.name, reason: p.reason, designSize: `${p.w}x${p.h}`, exportScale: p.scale,
      pixelSize: pxW != null ? `${pxW}x${pxH}` : null,
      exportBounds: p.exportBounds,
      exportBox: p.exportBox || undefined,
      imageRefs: Array.isArray(p.imageRefs) && p.imageRefs.length ? p.imageRefs : undefined,
      effectTypes: p.effectTypes,
      descendantEffectTypes: p.descendantEffectTypes && p.descendantEffectTypes.length ? p.descendantEffectTypes : undefined,
      renderCropPolicy: p.renderCropPolicy || undefined,
      dropShadowCount: p.dropShadowCount || undefined,
      blurCount: p.blurCount || undefined,
      clamped: clamped || undefined,
      reused: true,
    };
  }
  for (const p of fetchPicks) {
    const u = urlMap[p.nodeId];
    if (!u) continue;
    try {
      const res = await fetch(u);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let buf = Buffer.from(await res.arrayBuffer());
      const file = assetFileName(p.nodeId);

      /* ═══ 截断检查：导出的像素尺寸必须等于 稿内尺寸 × 倍率 ═══
       * Figma 的 PNG 导出有 16384px 硬上限，超了**静默截断**、不报任何错。
       * 而渲染层是把图拉伸填满节点框的（object-fit: fill），
       * 图比节点矮 5% 就意味着内容被压扁 5% —— 肉眼很难看出，但它是真的几何错误。
       * 实测踩到过两张：745×17309 的渐变导出成 706×16384。
       * 这里现读 PNG 的 IHDR（前 24 字节）比对，不符就标 clamped 并汇总报出来。 */
      let { pxW, pxH } = pngSize(buf);
      const expectBox = p.exportBounds === 'render' && p.exportBox ? p.exportBox : p;
      const wantW = Math.round((expectBox.w ?? p.w) * p.scale), wantH = Math.round((expectBox.h ?? p.h) * p.scale);
      let renderCrop = null;
      const shouldCropLayerBlur =
        p.exportBounds === 'render' &&
        p.exportBox &&
        p.effectTypes.includes('LAYER_BLUR') &&
        pxW != null &&
        pxW >= wantW &&
        pxH >= wantH &&
        (pxW !== wantW || pxH !== wantH);
      const shouldCropBakedRenderCanvas =
        p.renderCropPolicy === 'top-left-render-canvas' &&
        pxW != null && pxW >= wantW && pxH >= wantH &&
        (pxW !== wantW || pxH !== wantH);
      const shouldCropVisibleBox =
        p.cropToVisibleBox &&
        p.box && p.exportBox &&
        pxW != null && pxH != null &&
        (pxW !== wantW || pxH !== wantH);
      if (shouldCropVisibleBox) {
        const scaleX = pxW / Number(p.box.w);
        const scaleY = pxH / Number(p.box.h);
        const cropX = Math.round((Number(p.exportBox.x) - Number(p.box.x)) * scaleX);
        const cropY = Math.round((Number(p.exportBox.y) - Number(p.box.y)) * scaleY);
        const cropW = Math.min(wantW, pxW - Math.max(0, cropX));
        const cropH = Math.min(wantH, pxH - Math.max(0, cropY));
        if (cropX >= 0 && cropY >= 0 && cropW > 0 && cropH > 0) {
          const sourcePixelSize = `${pxW}x${pxH}`;
          buf = cropPng(buf, cropX, cropY, cropW, cropH);
          renderCrop = { sourcePixelSize, crop: `${cropX},${cropY},${cropW},${cropH}`, policy: 'visible-box' };
          ({ pxW, pxH } = pngSize(buf));
        }
      } else if (shouldCropBakedRenderCanvas) {
        const sourcePixelSize = `${pxW}x${pxH}`;
        buf = cropPng(buf, 0, 0, wantW, wantH);
        renderCrop = { sourcePixelSize, crop: `0,0,${wantW},${wantH}`, policy: p.renderCropPolicy };
        ({ pxW, pxH } = pngSize(buf));
      } else if (shouldCropLayerBlur) {
        const fullW = pxW / p.scale;
        const fullH = pxH / p.scale;
        const padX = Math.max(0, (fullW - p.w) / 2);
        const padY = Math.max(0, (fullH - p.h) / 2);
        const fullX = (p.box?.x ?? 0) - padX;
        const fullY = (p.box?.y ?? 0) - padY;
        const cropX = Math.round(((p.exportBox.x ?? fullX) - fullX) * p.scale);
        const cropY = Math.round(((p.exportBox.y ?? fullY) - fullY) * p.scale);
        const cropW = wantW;
        const cropH = wantH;
        if (cropX >= 0 && cropY >= 0 && cropW > 0 && cropH > 0 && cropX + cropW <= pxW && cropY + cropH <= pxH) {
          const sourcePixelSize = `${pxW}x${pxH}`;
          buf = cropPng(buf, cropX, cropY, cropW, cropH);
          renderCrop = {
            sourcePixelSize,
            crop: `${cropX},${cropY},${cropW},${cropH}`,
            inferredFullBox: roundBox({ x: fullX, y: fullY, w: fullW, h: fullH }),
          };
          ({ pxW, pxH } = pngSize(buf));
        }
      }
      const clamped = pxW != null && (Math.abs(pxW - wantW) > 1 || Math.abs(pxH - wantH) > 1);
      if (clamped) {
        clampedList.push({
          nodeId: p.nodeId, name: p.name,
          designSize: `${p.w}x${p.h}`, scale: p.scale,
          expectedPx: `${wantW}x${wantH}`, actualPx: `${pxW}x${pxH}`,
          why: 'Figma 导出尺寸与「稿内尺寸×倍率」不符（常见原因：超过 16384px 被静默截断）',
          risk: '渲染层拉伸填满节点框，图与节点比例不同 → 内容被压扁/拉长，是静默的几何错误',
          fix: '这个节点不该切图：若填充是单层渐变，交给 CSS 画；否则拆成分区大小的片再导出',
        });
      }

      writeFileSync(join(assetsDir, file), buf);
      bytes += buf.length;
      const pngSha = createHash('sha256').update(buf).digest('hex');

      manifest[p.nodeId] = {
        file: `assets/${file}`,
        pngFile: `assets/${file}`,
        pngSha256: pngSha,
        sha256: pngSha,
        bytes: buf.length,
        name: p.name, reason: p.reason, designSize: `${p.w}x${p.h}`, exportScale: p.scale,
        pixelSize: pxW != null ? `${pxW}x${pxH}` : null,
        exportBounds: p.exportBounds,
        exportBox: p.exportBox || undefined,
        imageRefs: Array.isArray(p.imageRefs) && p.imageRefs.length ? p.imageRefs : undefined,
        effectTypes: p.effectTypes,
        descendantEffectTypes: p.descendantEffectTypes && p.descendantEffectTypes.length ? p.descendantEffectTypes : undefined,
        renderCrop: renderCrop || undefined,
        renderCropPolicy: p.renderCropPolicy || undefined,
        dropShadowCount: p.dropShadowCount || undefined,
        blurCount: p.blurCount || undefined,
        clamped: clamped || undefined,
      };
    } catch (e) {
      failed.push({ nodeId: p.nodeId, name: p.name, why: String(e.message || e) });
    }
  }

  let webp = { attempted: 0, converted: 0, duplicates: 0, skipped: false, why: null };
  if (!a.noWebp) {
    const plan = planWebpDelivery(manifest, { assetsDir, demoDir });
    webp.attempted = plan.jobs.length;
    webp.duplicates = plan.aliases.length;
    const encoded = encodeWebpBatch(plan.jobs.map((j) => ({ src: j.src, dest: j.dest })));
    webp.skipped = !!encoded.skipped;
    webp.why = encoded.why || null;
    const bySrc = new Map((encoded.results || []).map((r) => [r.src.replace(/\\/g, '/'), r]));
    const recById = (id) => manifest[id];
    for (const job of plan.jobs) {
      const rec = recById(job.nodeId);
      if (!rec) continue;
      const hit = bySrc.get(job.src.replace(/\\/g, '/')) || encoded.results?.find((r) => r.dest.replace(/\\/g, '/') === job.dest.replace(/\\/g, '/'));
      if (!hit) continue;
      rec.file = job.webpRel;
      rec.webpFile = job.webpRel;
      rec.sha256 = createHash('sha256').update(readFileSync(job.dest)).digest('hex');
      rec.bytes = hit.bytes;
      rec.webp = { bytes: hit.bytes, lossless: hit.lossless, alpha: hit.alpha };
      /* Encoder collapse: a 186-byte webp of a 2443×1380 KV is a solid plate.
         Keep serving the PNG so the page does not go blank. */
      if (Number(hit.bytes) > 0 && Number(hit.bytes) < 2048 && rec.pngFile) {
        rec.file = rec.pngFile;
        rec.webpCollapsed = true;
      }
      webp.converted += 1;
    }
    for (const alias of plan.aliases) {
      const src = recById(alias.duplicateOf);
      const dest = recById(alias.nodeId);
      if (!src || !dest || !src.webpFile) continue;
      dest.file = src.webpFile;
      dest.webpFile = src.webpFile;
      dest.sha256 = src.sha256;
      dest.bytes = src.bytes;
      dest.webp = src.webp;
      dest.duplicateOf = alias.duplicateOf;
    }
    bytes = Object.values(manifest).reduce((sum, rec) => sum + Number(rec.bytes || 0), 0);
  }
  out.webp = webp;

  const mergedNoUrl = previous ? (previous.noUrl || []).filter((x) => !onlySet.has(x.nodeId)).concat(noUrl) : noUrl;
  const mergedFailed = previous ? (previous.failed || []).filter((x) => !onlySet.has(x.nodeId)).concat(failed) : failed;
  const mergedClamped = previous ? (previous.clamped || []).filter((x) => !onlySet.has(x.nodeId)).concat(clampedList) : clampedList;

  writeFileSync(
    manifestPath,
    JSON.stringify({
      _note: '资产清单。图片是二进制，没有 JSON locator，做不成 provenance 叶子；' +
             '可校验的替代品是这里的 sha256 + nodeId + 稿版本（对应老师门 D 的 asset-sha 绑定）。',
      designVersion, exportScale: scale,
      counts: { requested: picks.length, downloaded: Object.keys(manifest).length, noUrl: noUrl.length, failed: failed.length },
      webp,
      totalBytes: bytes,
      assets: manifest,
      noUrl,      // Figma 导不出的：不静默丢，列出来（同类产物里出现过这种）
      failed,
      clamped: clampedList,   // 导出尺寸与稿不符的：静默几何错误，必须报出来
    }, null, 1)
  );

  /* 把「nodeId → 相对路径」注入 index.html 的 qa-assets 块。
   *
   * 为什么不放 truth：图片是二进制，没有 JSON locator，做不成可校验的 provenance 叶子。
   * 硬塞进 truth 会在一份"全部可证"的数据里掺入不可证的项，破坏 truth 的定性。
   * 老师那边同类问题的答案是 spec 的 `asset-sha` 绑定 —— 路径是构建产物，
   * 字节由门 D 按 sha256 校验。所以这里只注入路径，校验交给清单里的 sha256。
   *
   * 仿 qa-truth 的写法（禁止手抄、由脚本写入），`</script>` 已转义防注入。 */
  const idxPath = join(demoDir, 'index.html');
  if (existsSync(idxPath)) {
    const pathMap = Object.fromEntries(Object.entries(manifest).map(([id, m]) => {
      const rec = (m.exportBox || (Array.isArray(m.imageRefs) && m.imageRefs.length) || m.kind)
        ? {
          file: m.file,
          ...(m.exportBounds ? { exportBounds: m.exportBounds } : {}),
          ...(m.exportBox ? { exportBox: m.exportBox } : {}),
          ...(m.pixelSize ? { pixelSize: m.pixelSize } : {}),
          ...(Array.isArray(m.imageRefs) && m.imageRefs.length ? { imageRefs: m.imageRefs } : {}),
          ...(m.kind ? { kind: m.kind } : {}),
        }
        : m.file;
      return [id, rec];
    }));
    const payload = JSON.stringify(pathMap).replace(/<\/script>/gi, '<\\/script>');
    let html = readFileSync(idxPath, 'utf8');
    const re = /<script id="qa-assets" type="application\/json">[\s\S]*?<\/script>/;
    const block = `<script id="qa-assets" type="application/json">${payload}</script>`;
    if (re.test(html)) html = html.replace(re, block);
    else html = html.replace('<script id="qa-truth"', `${block}\n<script id="qa-truth"`);
    writeFileSync(idxPath, html);
    out.embeddedInto = 'index.html#qa-assets';
  }

  out.downloaded = Object.keys(manifest).length;
  out.noUrl = noUrl;
  out.failed = failed;
  out.clamped = clampedList;
  out.totalMB = +(bytes / 1024 / 1024).toFixed(2);
  console.log(JSON.stringify(out, null, 2));
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isCli) main().catch((e) => fail(e?.message || String(e)));
