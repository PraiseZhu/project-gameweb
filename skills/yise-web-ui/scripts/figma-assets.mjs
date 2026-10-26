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
 *   前缀 img/ bg/ kv/  →  切
 *   清单 sliceExport（含 BOOLEAN btn/、ind/ 变体根）→ 切
 *   BOOLEAN/VECTOR 的 btn/ 左右箭头 → 切（轮廓 CSS 画不出，禁止发明 CSS 箭头）
 *   填充是渐变或 IMAGE →  切
 *   其余              →  不切（scroll/ 是容器；普通 btn/ 无 sliceExport 不切）
 *
 *   扫描树在 scripts/lib/figma-slice-nodes.mjs。page-scope（含顶层
 *   truth.modals）独立扫描，不绑 section 循环。
 *
 * ═══ 用法 ═══
 *   node scripts/figma-assets.mjs --demo <dir>              # 按 truth.json 找出该切的节点并导出
 *   node scripts/figma-assets.mjs --demo <dir> --dry-run    # 只列清单不下载
 *   node scripts/figma-assets.mjs --demo <dir> --scale 2
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { encodeWebpBatch, planWebpDelivery } from './lib/encode-webp.mjs';
import { pickSliceNodes } from './lib/figma-slice-nodes.mjs';
import { figmaLegalExport } from './lib/figma-export-budget.mjs';
import { decideAssetResume, partialOnlyRefusal } from './lib/figma-asset-resume.mjs';

export { pickSliceNodes, planWebpDelivery };

const API = 'https://api.figma.com/v1';
const BATCH = 40;               // Figma images 接口一次给太多 id 会超时，分批

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
    else if (k === '--resume') a.resume = true;
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

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function fetchWithRetry(url, options = {}, { attempts = 6, label = url } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (err) {
      lastErr = err;
      const wait = Math.min(15000, 800 * (2 ** i));
      await sleep(wait);
    }
  }
  throw new Error(`${label}: ${lastErr?.message || lastErr}`);
}

async function figmaGet(url, token) {
  const res = await fetchWithRetry(url, { headers: { 'X-Figma-Token': token } }, { label: 'Figma API' });
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

function roundBox(b) {
  if (!b) return null;
  return {
    x: +Number(b.x ?? 0).toFixed(3),
    y: +Number(b.y ?? 0).toFixed(3),
    w: +Number(b.w ?? 0).toFixed(3),
    h: +Number(b.h ?? 0).toFixed(3),
  };
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
  const manifestPath = join(demoDir, 'assets-manifest.json');
  let onDiskManifest = null;
  if (a.only && a.only.length) {
    if (existsSync(manifestPath)) onDiskManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const only = new Set(a.only);
    picks = picks.filter((p) => only.has(p.nodeId));
    const found = new Set(picks.map((p) => p.nodeId));
    const missing = [...only].filter((id) => !found.has(id));
    if (missing.length) fail(`--only 里有 nodeId 不在切图候选中：${missing.join(',')}`);
    const refusal = partialOnlyRefusal({
      designVersion,
      previousVersion: onDiskManifest ? onDiskManifest.designVersion : null,
      hasManifest: !!onDiskManifest,
    });
    if (refusal) fail(refusal);
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

  if (!onDiskManifest && existsSync(manifestPath)) onDiskManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const assetsDir = join(demoDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });

  /* ═══ 逐节点定导出倍率 ═══
   * 稿是 3840 宽、对应 1920 的视口 —— 稿本身已经是 2 倍图（2026-08-04 起 exportScale=1，
   * 见 spec.json 的 _exportScaleWhy：再乘 2 是 4 倍像素，纯属浪费）。
   *
   * Figma 会在超出其导出像素预算时静默等比缩小超长 PNG。若仍按请求倍率期待
   * 原尺寸，清单会报“截断”；更糟的是渲染器不知道来源已缩放，容易把非等比结果
   * 当作可用图拉伸。请求前用 figma-export-budget.mjs 把倍率收进 32MP 与单边 16384。
   * 导出仍是完整等比的 Figma 合成图，manifest 的 expectedPx 与这次请求同源。
   * 浏览器只把这张完整图等比铺回稿框，不把较低的文件本地放大成 1 倍像素。
   * 3840x17182 超过这两个上限，合法结果约 2674x11966，不是 3840x17182。 */
  const dw = spec.figma?.frames?.pc?.designWidth ?? 3840;
  for (const p of picks) {
    const baseScale = (p.w >= dw * 0.9) ? Math.min(scale, 1) : scale;
    const expectBox = p.exportBounds === 'render' && p.exportBox ? p.exportBox : p;
    p.scale = figmaLegalExport(expectBox.w ?? p.w, expectBox.h ?? p.h, baseScale).scale;
  }
  out.scaleByNode = picks.reduce((m, p) => ((m['x' + p.scale] = (m['x' + p.scale] || 0) + 1), m), {});

  function expectedPx(p) {
    const expectBox = p.exportBounds === 'render' && p.exportBox ? p.exportBox : p;
    return {
      wantW: Math.round((expectBox.w ?? p.w) * p.scale),
      wantH: Math.round((expectBox.h ?? p.h) * p.scale),
    };
  }

  function recordFromPng(p, buf, extra = {}) {
    const file = assetFileName(p.nodeId);
    const { pxW, pxH } = pngSize(buf);
    const { wantW, wantH } = expectedPx(p);
    const clamped = pxW != null && (Math.abs(pxW - wantW) > 1 || Math.abs(pxH - wantH) > 1);
    const pngSha = createHash('sha256').update(buf).digest('hex');
    return {
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
      ...extra,
      _want: { wantW, wantH, clamped },
    };
  }

  // 1) 分批向 Figma 要图片 URL（按倍率分组，一批只能用一个 scale）
  const urlMap = {};
  const noUrl = [];
  const resumeSet = new Set();
  const resumeWebpSet = new Set();
  const previous = a.only && a.only.length && onDiskManifest ? onDiskManifest : null;
  const onlySet = new Set(a.only || []);
  const manifest = previous ? { ...(previous.assets || {}) } : {};
  for (const id of onlySet) delete manifest[id];
  let bytes = previous ? Object.values(manifest).reduce((sum, rec) => sum + Number(rec.bytes || 0), 0) : 0;
  const failed = [];
  const clampedList = [];
  if (a.resume) {
    for (const p of picks) {
      const pngPath = join(assetsDir, assetFileName(p.nodeId));
      const prev = onDiskManifest && onDiskManifest.assets ? onDiskManifest.assets[p.nodeId] : null;
      const webpPath = prev && prev.webpFile ? join(demoDir, prev.webpFile) : null;
      const pngSha256 = existsSync(pngPath) ? createHash('sha256').update(readFileSync(pngPath)).digest('hex') : null;
      const webpSha256 = webpPath && existsSync(webpPath) ? createHash('sha256').update(readFileSync(webpPath)).digest('hex') : null;
      const { wantW, wantH } = expectedPx(p);
      const decision = decideAssetResume({
        designVersion,
        previousVersion: onDiskManifest ? onDiskManifest.designVersion : null,
        record: prev,
        pngSha256,
        webpSha256,
        geometry: {
          designSize: p.w + 'x' + p.h,
          exportScale: p.scale,
          exportBounds: p.exportBounds || null,
          exportBox: p.exportBox || null,
          pixelSize: wantW + 'x' + wantH,
        },
      });
      if (!decision.resumePng) continue;
      manifest[p.nodeId] = { ...prev, resumed: true };
      bytes += Number(prev.bytes || 0);
      resumeSet.add(p.nodeId);
      if (decision.resumeWebp) resumeWebpSet.add(p.nodeId);
    }
  }
  out.resumed = resumeSet.size;
  const needFetch = picks.filter((p) => !resumeSet.has(p.nodeId));
  const groups = [];
  for (const key of [...new Set(needFetch.map((p) => `${p.scale}|${p.exportBounds}`))]) {
    const [scText, bounds] = key.split('|');
    const sc = Number(scText);
    const g = needFetch.filter((p) => p.scale === sc && p.exportBounds === bounds);
    for (let i = 0; i < g.length; i += BATCH) groups.push(g.slice(i, i + BATCH));
  }
  if (needFetch.length) {
    const token = readToken(demoDir);
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
  }

  // 2) 下载 + 记 sha256（清单是资产的可校验替代品：二进制没有 JSON locator）
  for (const p of picks) {
    if (resumeSet.has(p.nodeId)) continue;
    const u = urlMap[p.nodeId];
    if (!u) continue;
    try {
      const res = await fetchWithRetry(u, {}, { label: `download ${p.nodeId}` });
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
      const { wantW, wantH } = expectedPx(p);
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
        (p.renderCropPolicy === 'owner-relative-render-canvas' || p.renderCropPolicy === 'top-left-render-canvas') &&
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
        /* Figma's default images export is the unclipped ink canvas (owner +
           shadow). Adjacent switch cards only keep a peek strip, so that
           canvas is wider than exportBox. Cropping from 0,0 always takes the
           owner's left edge — a right-peek card then shows a mirrored gold
           border. Place the crop at exportBox relative to the owner box. */
        const ownerX = Number(p.box?.x);
        const ownerY = Number(p.box?.y);
        const exportX = Number(p.exportBox?.x);
        const exportY = Number(p.exportBox?.y);
        let cropX = 0;
        let cropY = 0;
        if ([ownerX, ownerY, exportX, exportY].every(Number.isFinite)) {
          cropX = Math.round((exportX - ownerX) * p.scale);
          cropY = Math.round((exportY - ownerY) * p.scale);
        }
        cropX = Math.max(0, Math.min(cropX, pxW - wantW));
        cropY = Math.max(0, Math.min(cropY, pxH - wantH));
        buf = cropPng(buf, cropX, cropY, wantW, wantH);
        renderCrop = { sourcePixelSize, crop: `${cropX},${cropY},${wantW},${wantH}`, policy: 'owner-relative-render-canvas' };
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
      const rec = recordFromPng(p, buf, { renderCrop: renderCrop || undefined });
      delete rec._want;
      rec.pixelSize = pxW != null ? `${pxW}x${pxH}` : null;
      rec.clamped = clamped || undefined;
      rec.renderCrop = renderCrop || undefined;
      manifest[p.nodeId] = rec;
    } catch (e) {
      failed.push({ nodeId: p.nodeId, name: p.name, why: String(e.message || e) });
    }
  }

  let webp = { attempted: 0, converted: 0, duplicates: 0, skipped: false, why: null };
  if (!a.noWebp) {
    const plan = planWebpDelivery(manifest, { assetsDir, demoDir });
    webp.attempted = plan.jobs.length;
    webp.duplicates = plan.aliases.length;
    const pendingJobs = [];
    const alreadyWebp = [];
    for (const job of plan.jobs) {
      if (resumeWebpSet.has(job.nodeId) && existsSync(job.dest)) alreadyWebp.push(job);
      else pendingJobs.push(job);
    }
    const encoded = encodeWebpBatch(pendingJobs.map((j) => ({ src: j.src, dest: j.dest })));
    webp.skipped = !!encoded.skipped;
    webp.why = encoded.why || null;
    const bySrc = new Map((encoded.results || []).map((r) => [r.src.replace(/\\/g, '/'), r]));
    const recById = (id) => manifest[id];
    const alreadyDest = new Set(alreadyWebp.map((j) => j.dest.replace(/\\/g, '/')));
    for (const job of plan.jobs) {
      const rec = recById(job.nodeId);
      if (!rec) continue;
      const hit = bySrc.get(job.src.replace(/\\/g, '/')) || encoded.results?.find((r) => r.dest.replace(/\\/g, '/') === job.dest.replace(/\\/g, '/'));
      const reused = !hit && alreadyDest.has(job.dest.replace(/\\/g, '/'));
      if (!hit && !reused) continue;
      rec.file = job.webpRel;
      rec.webpFile = job.webpRel;
      const destBuf = readFileSync(job.dest);
      rec.sha256 = createHash('sha256').update(destBuf).digest('hex');
      rec.bytes = hit ? hit.bytes : destBuf.length;
      rec.webp = hit
        ? { bytes: hit.bytes, lossless: hit.lossless, alpha: hit.alpha }
        : { bytes: destBuf.length, resumed: true };
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

function isDirectRun() {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(invoked)).href;
  } catch {
    return false;
  }
}

export { cropPng, pngSize };

if (isDirectRun()) {
  main().catch((e) => fail(e?.message || String(e)));
}
