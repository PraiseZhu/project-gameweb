#!/usr/bin/env node
/**
 * 停2 预约弹窗三屏像素探针 —— 停1 口径（活字 TEXT 遮罩）。
 *
 * 为什么遮活字：仓库停1 口径（standards/stop1-figma-pixel/SKILL.md）写的是
 *   「活字 TEXT 由清单静态闸对字符/字号/框，像素门遮掉这些区，不拿 Figma 栅格当字」。
 * 本脚本不是第二套判据：
 *   - 遮罩   ← 共享 gate 的 sectionLiveCopyMasks（清单 nodes + section box）；
 *   - 比对   ← phaseTolerantDiff（±2px 相位容差；≥3px 成块 / 贴错图仍 FAIL）；
 *   - 阈值   ← 共享 gate 的 DEFAULT_STOP1_PIXEL_THRESHOLD。
 * 像素门因此只回答「框 / 图 / 线对不对」，不回答「栅格化像不像」。
 *
 * 数据来源：交接包 inventory 的 attachments.modals[<modalId>].nodes（活字清单），
 *          停2 已导出的 Figma 分区基准图 + demo 实拍图。
 * 产物：<demo>/artifacts/stop2-pixel/<key>.{region.demo,region.figma,diff}.png
 *       + pixel-results.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sectionLiveCopyMasks, loadPngApi, DEFAULT_STOP1_PIXEL_THRESHOLD, PIXEL_YIQ_THRESHOLD } from './lib/stop1-figma-pixel-gate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(HERE, '..');

export const STOP2_PIXEL_DIR = 'artifacts/stop2-pixel';
export const STOP2_PIXEL_THRESHOLD = DEFAULT_STOP1_PIXEL_THRESHOLD;

/** 相位容差半径（px）：用户口径「边缘锯齿 + 1–2px 相位差不计入 0.5% 失败」。 */
export const PHASE_TOLERANCE_RADIUS = 2;

/** ≥3px 成块错位必须拦，不论 0.5% 比例是否过线。 */
export const BLOCK_SHIFT_MIN_PX = 3;

/** 与停1 同一遮罩上限：过度遮罩必须 FAIL。 */
export const STOP2_MAX_MASK_RATIO = 0.40;

/** 规则2 比较框必须锁在弹窗面板 band 内（设计 y199..1539 → CSS 99.5..769.5）。 */
export const STOP2_KR_RULES2_PANEL = Object.freeze({ x: 0, y: 99.5, w: 1920, h: 670 });

/**
 * 三屏：key / Figma 基准节点 / 语言 / 入口 / 分区框（demo 1920×1080 CSS px）。
 * 比较框 = 用户报障的弹窗可视区。活字由 sectionLiveCopyMasks 遮掉，像素门只比框 / 图 / 线。
 */
export const STOP2_SCREENS = Object.freeze([
  {
    key: 'tw', nodeId: '949:5420', lang: 'zh-TW', go: 'modal/pc_tw预约弹窗',
    frame: { x: 643, y: 450, w: 635, h: 161 },
  },
  {
    key: 'kr', nodeId: '949:5675', lang: 'ko', go: 'modal/pc_kr预约弹窗',
    frame: { x: 786, y: 486, w: 352, h: 114 },
  },
  {
    key: 'kr-rules2', nodeId: '949:5634', lang: 'ko', go: 'modal/pc_kr预约弹窗', rulesNode: '949:5740',
    /* 比较框 = 该弹窗自己的面板（img/弹窗背景 设计 y199..1539 + 高 1340
       → CSS y99.5..769.5，横跨整宽）。只比弹窗内，不把遮罩下的主页算进来：
       早前把框放到 y440..820 时越过了面板下沿，拿主页的 시즌 프리뷰/火花
       去比弹窗节点图，才出现 0.98% 的假红。正文本身由停1 口径遮掉
       （mask 13.8% < 停1 的 40% 上限）。 */
    frame: { x: 0, y: 100, w: 1920, h: 670 },
  },
]);

/**
 * 停1 口径活字遮罩：共享 gate 的 sectionLiveCopyMasks 产出「section 内设计 px」矩形，
 * 这里换算成该屏分区基准图（1920×1080 截图坐标系）的像素矩形。
 *
 * @param {object} inventory 形如 { nodes: [...] }（该 modal 的清单节点，扁平数组）
 * @param {object} section   { id: modalId, pageBox }；sectionLiveCopyMasks 用它做归属与原点
 * @param {{x,y,w,h}} crop   分区框，1920×1080 截图坐标
 * @param {number} scale     Figma 导出倍率（停2 = 0.5，设计 px → 截图 px）
 */
export function liveTextMasks(inventory, section, crop, scale = 0.5) {
  const raw = sectionLiveCopyMasks(inventory, section) || [];
  const seen = new Set();
  const masks = [];
  for (const m of raw) {
    const x = Math.round(Number(m.x) * scale - Number(crop.x));
    const y = Math.round(Number(m.y) * scale - Number(crop.y));
    const w = Math.round(Number(m.w) * scale);
    const h = Math.round(Number(m.h) * scale);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
    const key = `${x},${y},${w},${h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    masks.push({ x, y, w, h });
  }
  return masks;
}

/**
 * 亚像素线遮罩：作者稿上高度换算到截图后 ≤ 2px 的 LINE / 退化成线的 VECTOR。
 *
 * 依据用户口径：边缘锯齿与亚像素线不计入 0.5% 失败。这类线在稿上是几何高度≈0
 * 的矢量，导出成 1px 半透明位图，贴回时必然落在某个 sub-pixel 相位上；逐像素
 * 对稿等于要求两侧栅格化相位一致。判据只用清单 pageBox.h，不发明几何。
 *
 * @returns {{masks:Array<{x,y,w,h}>, nodes:string[]}}
 */
export function subpixelLineMasks(inventory, crop, scale = 0.5) {
  const nodes = (inventory && inventory.nodes) || [];
  const masks = [];
  const ids = [];
  for (const n of nodes) {
    const type = String(n.type || '');
    const name = String(n.name || '');
    const isLine = type === 'LINE' || (type === 'VECTOR' && /^line(?:\s|$)/i.test(name));
    if (!isLine) continue;
    const pb = n.pageBox || n.box;
    if (!pb) continue;
    const h = Number(pb.h) * scale;
    if (!(h <= 2)) continue;
    const x = Math.round(Number(pb.x) * scale - crop.x) - 1;
    const y = Math.round(Number(pb.y) * scale - crop.y) - 1;
    const w = Math.max(1, Math.round(Number(pb.w) * scale)) + 2;
    masks.push({ x, y, w, h: Math.max(3, Math.round(h) + 3) });
    ids.push(String(n.id));
  }
  return { masks, nodes: ids };
}

function colorDistance(a, ai, b, bi) {
  const dr = (a[ai] - b[bi]) / 255;
  const dg = (a[ai + 1] - b[bi + 1]) / 255;
  const db = (a[ai + 2] - b[bi + 2]) / 255;
  const da = (a[ai + 3] - b[bi + 3]) / 255;
  return Math.sqrt(dr * dr + dg * dg + db * db + da * da) / 2;
}

function neighborhoodHas(src, si, dest, x, y, W, H, r, threshold, masked) {
  for (let dy = -r; dy <= r; dy++) {
    const ny = y + dy;
    if (ny < 0 || ny >= H) continue;
    for (let dx = -r; dx <= r; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      if (nx < 0 || nx >= W) continue;
      const q = ny * W + nx;
      if (masked[q]) continue;
      if (colorDistance(src, si, dest, q * 4) <= threshold) return true;
    }
  }
  return false;
}

function connectedComponents(W, H, keep) {
  const seen = new Uint8Array(W * H);
  const comps = [];
  const stack = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (seen[p] || !keep[p]) continue;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let area = 0;
      stack.push(p);
      seen[p] = 1;
      while (stack.length) {
        const q = stack.pop();
        const qx = q % W;
        const qy = (q - qx) / W;
        area += 1;
        if (qx < minX) minX = qx;
        if (qx > maxX) maxX = qx;
        if (qy < minY) minY = qy;
        if (qy > maxY) maxY = qy;
        const neighbors = [q + 1, q - 1, q + W, q - W];
        for (const n of neighbors) {
          if (n < 0 || n >= W * H) continue;
          const nx = n % W;
          const ny = (n - nx) / W;
          if (Math.abs(nx - qx) + Math.abs(ny - qy) !== 1) continue;
          if (seen[n] || !keep[n]) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      comps.push({
        minX, maxX, minY, maxY,
        w: maxX - minX + 1,
        h: maxY - minY + 1,
        area,
      });
    }
  }
  return comps;
}

export function frameExceedsPanel(frame, panel, tol = 1.5) {
  if (!frame || !panel) return false;
  return Number(frame.y) < Number(panel.y) - tol
    || Number(frame.x) < Number(panel.x) - tol
    || Number(frame.y) + Number(frame.h) > Number(panel.y) + Number(panel.h) + tol
    || Number(frame.x) + Number(frame.w) > Number(panel.x) + Number(panel.w) + tol;
}

export function judgeStop2Pixel(compared, {
  width,
  height,
  threshold = STOP2_PIXEL_THRESHOLD,
  maxMaskRatio = STOP2_MAX_MASK_RATIO,
  blockMin = BLOCK_SHIFT_MIN_PX,
} = {}) {
  const W = Number(width);
  const H = Number(height);
  const totalPixels = W * H;
  const masked = Number(compared && compared.maskedCount) || 0;
  const maskRatio = totalPixels ? masked / totalPixels : 1;
  const ratio = compared && compared.total ? compared.bad / compared.total : 1;
  const blockHit = !!(compared && compared.blockShift && compared.blockShift.hit);
  const newStructure = !!(compared && compared.newStructure && compared.newStructure.hit);
  const overMask = maskRatio > maxMaskRatio || (totalPixels > 0 && compared.total === 0 && masked >= totalPixels * maxMaskRatio);
  const ok = !blockHit && !newStructure && !overMask && ratio <= threshold && compared.total > 0;
  return {
    ok,
    ratio,
    maskRatio,
    blockHit,
    newStructure,
    overMask,
    reasons: [
      blockHit ? `≥${blockMin}px 成块错位` : null,
      newStructure ? '贴错图或新增细结构' : null,
      overMask ? `遮罩 ${(maskRatio * 100).toFixed(2)}% 超上限 ${(maxMaskRatio * 100).toFixed(2)}%` : null,
      !(ratio <= threshold) ? `坏点比例 ${(ratio * 100).toFixed(4)}% > ${(threshold * 100).toFixed(2)}%` : null,
      compared.total === 0 && !overMask ? '没有可比像素' : null,
    ].filter(Boolean),
  };
}

/**
 * 相位容差比对：用户口径「边缘锯齿 + 1–2px 相位差 + 亚像素线不计入 0.5% 失败」。
 *
 * 判据是机械的、不挖芯的：某像素若在 baseline/actual 同点色差超阈值，就在另一张图
 * 的 ±radius 邻域里找同色像素 —— 找到即视为「同一块形，只是落在不同 sub-pixel 相位」
 * （计入 phaseSkipped，不算坏点）；找不到才算真差异（bad）。
 * 因此：
 *   - 贴错图 / 缺图 / 成块错位 > radius：邻域内找不到同色像素 → 照样报 bad；
 *   - 不做「整块遮罩」，不会把小切图整体挖掉（挖芯会掩盖贴错）。
 *
 * @returns {{bad:number,total:number,phaseSkipped:number,diff:object}}
 */
export function phaseTolerantDiff({ PNG, baseline, actual, masks = [], radius = 2, threshold = 0.1 }) {
  const W = baseline.width;
  const H = baseline.height;
  const r = Math.max(0, Math.round(radius));
  const masked = new Uint8Array(W * H);
  let maskedCount = 0;
  for (const m of masks) {
    const [mx, my, mw, mh] = m.map(Number);
    const x0 = Math.max(0, Math.floor(mx));
    const y0 = Math.max(0, Math.floor(my));
    const x1 = Math.min(W, Math.ceil(mx + mw));
    const y1 = Math.min(H, Math.ceil(my + mh));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = y * W + x;
        if (!masked[p]) {
          masked[p] = 1;
          maskedCount += 1;
        }
      }
    }
  }
  const diff = new PNG({ width: W, height: H });
  const bd = baseline.data;
  const ad = actual.data;
  const rawMismatch = new Uint8Array(W * H);
  const badMap = new Uint8Array(W * H);
  let bad = 0;
  let phaseSkipped = 0;
  let total = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const i = p * 4;
      if (masked[p]) {
        diff.data[i] = 180; diff.data[i + 1] = 180; diff.data[i + 2] = 180; diff.data[i + 3] = 80;
        continue;
      }
      total += 1;
      if (colorDistance(bd, i, ad, i) <= threshold) {
        diff.data[i] = ad[i]; diff.data[i + 1] = ad[i + 1]; diff.data[i + 2] = ad[i + 2]; diff.data[i + 3] = 70;
        continue;
      }
      rawMismatch[p] = 1;
      const baseInActual = neighborhoodHas(bd, i, ad, x, y, W, H, r, threshold, masked);
      const actualInBase = neighborhoodHas(ad, i, bd, x, y, W, H, r, threshold, masked);
      if (baseInActual && actualInBase) {
        phaseSkipped += 1;
        diff.data[i] = 255; diff.data[i + 1] = 220; diff.data[i + 2] = 0; diff.data[i + 3] = 200;
      } else {
        bad += 1;
        badMap[p] = 1;
        diff.data[i] = 255; diff.data[i + 1] = 0; diff.data[i + 2] = 0; diff.data[i + 3] = 255;
      }
    }
  }
  const rawComps = connectedComponents(W, H, rawMismatch);
  const blockComps = rawComps.filter((c) => Math.min(c.w, c.h) >= BLOCK_SHIFT_MIN_PX && c.area >= 9);
  const badComps = connectedComponents(W, H, badMap);
  const baselineColors = new Set();
  for (let i = 0; i < bd.length; i += 4) {
    baselineColors.add(`${bd[i] >> 3},${bd[i + 1] >> 3},${bd[i + 2] >> 3}`);
  }
  const newComps = [];
  for (const c of badComps) {
    let novel = false;
    for (let y = c.minY; y <= c.maxY && !novel; y++) {
      for (let x = c.minX; x <= c.maxX; x++) {
        const p = y * W + x;
        if (!badMap[p]) continue;
        const i = p * 4;
        const key = `${ad[i] >> 3},${ad[i + 1] >> 3},${ad[i + 2] >> 3}`;
        if (!baselineColors.has(key)) {
          novel = true;
          break;
        }
      }
    }
    if (novel) newComps.push(c);
  }
  return {
    bad,
    total,
    phaseSkipped,
    maskedCount,
    diff,
    blockShift: { hit: blockComps.length > 0, components: blockComps },
    newStructure: { hit: newComps.length > 0, components: newComps },
  };
}

function cutRegion(PNG, img, crop, outPath) {
  const region = new PNG({ width: crop.w, height: crop.h });
  for (let y = 0; y < crop.h; y++) {
    for (let x = 0; x < crop.w; x++) {
      const si = ((crop.y + y) * img.width + (crop.x + x)) * 4;
      const di = (y * crop.w + x) * 4;
      region.data[di] = img.data[si];
      region.data[di + 1] = img.data[si + 1];
      region.data[di + 2] = img.data[si + 2];
      region.data[di + 3] = img.data[si + 3];
    }
  }
  if (outPath) writeFileSync(outPath, PNG.sync.write(region));
  return region;
}

/**
 * 跑三屏停1 口径像素门。
 *
 * @param {{demoDir:string, inventory?:object, outDir?:string, demoShot?:string}} opts
 *   demoDir     live demo 目录（含 truth.json / artifacts/stop2-pixel 基准图）
 *   inventory   交接包 inventory；缺省读 <demoDir>/inventory.json
 *   demoShot    1920×1080 demo 实拍图；缺省用 <base>/demo-1920.png
 */
export async function runStop2ModalPixelProbe({ demoDir, inventory, outDir, demoShots } = {}) {
  if (!demoDir) throw new Error('runStop2ModalPixelProbe: demoDir required');
  const demo = resolve(demoDir);
  const base = outDir ? resolve(outDir) : join(demo, STOP2_PIXEL_DIR);
  mkdirSync(base, { recursive: true });
  const { PNG } = await loadPngApi(SKILL_ROOT);
  const inv = inventory || JSON.parse(readFileSync(join(demo, 'inventory.json'), 'utf8'));
  const modals = (inv.attachments && inv.attachments.modals) || inv.modals || [];
  const modalById = new Map(modals.map((m) => [String(m.id), m]));
  const results = [];
  for (const screen of STOP2_SCREENS) {
    const figmaPath = join(base, `${screen.nodeId.replace(':', '-')}.figma.png`);
    const shotRel = demoShots && demoShots[screen.key];
    const demoPath = shotRel ? resolve(shotRel) : join(base, `demo.${screen.key}.png`);
    const modal = modalById.get(String(screen.nodeId));
    if (!modal) {
      results.push({ key: screen.key, nodeId: screen.nodeId, ok: false, status: 'MISSING', problems: [`inventory 缺 modal ${screen.nodeId}`] });
      continue;
    }
    if (!existsSync(figmaPath)) {
      results.push({ key: screen.key, nodeId: screen.nodeId, ok: false, status: 'MISSING', problems: [`缺 Figma 基准 ${figmaPath}`] });
      continue;
    }
    if (!existsSync(demoPath)) {
      results.push({ key: screen.key, nodeId: screen.nodeId, ok: false, status: 'MISSING', problems: [`缺 demo 实拍 ${demoPath}`] });
      continue;
    }
    const figmaFull = PNG.sync.read(readFileSync(figmaPath));
    const demoFull = PNG.sync.read(readFileSync(demoPath));
    const frame = screen.frame;
    const figmaRegion = cutRegion(PNG, figmaFull, frame, join(base, `${screen.key}.region.figma.png`));
    const demoRegion = cutRegion(PNG, demoFull, frame, join(base, `${screen.key}.region.demo.png`));
    /* 活字遮罩：清单节点 + 该 modal 的 section box，判据与停1 完全一致。 */
    const section = { id: String(modal.id), pageBox: modal.pageBox || modal.box };
    const textMasks = liveTextMasks({ nodes: modal.nodes || [] }, section, frame, 0.5);
    /* 亚像素线遮罩：清单里 0 高/≈1px 的 LINE / 退化成线的 VECTOR。 */
    const lineMasks = subpixelLineMasks({ nodes: modal.nodes || [] }, frame, 0.5);
    const masks = [...textMasks, ...lineMasks.masks];
    /* 相位容差比对：±2px 邻域内同色视为同一块形的 sub-pixel 相位，不计坏点；
       贴错图/成块错位在邻域内找不到同色像素，照常计 bad。 */
    const compared = phaseTolerantDiff({
      PNG,
      baseline: figmaRegion,
      actual: demoRegion,
      masks: masks.map((m) => [m.x, m.y, m.w, m.h]),
      radius: PHASE_TOLERANCE_RADIUS,
      threshold: PIXEL_YIQ_THRESHOLD,
    });
    const diffPath = join(base, `${screen.key}.diff.png`);
    writeFileSync(diffPath, PNG.sync.write(compared.diff));
    const judged = judgeStop2Pixel(compared, {
      width: frame.w,
      height: frame.h,
      threshold: STOP2_PIXEL_THRESHOLD,
      maxMaskRatio: STOP2_MAX_MASK_RATIO,
    });
    const panel = screen.key === 'kr-rules2' ? STOP2_KR_RULES2_PANEL : null;
    const overflow = panel ? frameExceedsPanel(frame, panel) : false;
    const ok = judged.ok && !overflow;
    const problems = [
      ...judged.reasons,
      overflow ? `规则2 比较框越出弹窗面板：${JSON.stringify(frame)}` : null,
    ].filter(Boolean);
    results.push({
      key: screen.key, nodeId: screen.nodeId, ok, status: ok ? 'PASS' : 'FAIL',
      scale: 0.5, frame,
      maskedTextNodes: textMasks.length, textMasks,
      maskedSubpixelLines: lineMasks.nodes.length, subpixelLineMasks: lineMasks.masks,
      phaseSkippedPixels: compared.phaseSkipped,
      phaseToleranceRadius: PHASE_TOLERANCE_RADIUS,
      bad: compared.bad, total: compared.total, ratio: judged.ratio,
      maskRatio: judged.maskRatio,
      blockShift: compared.blockShift && compared.blockShift.hit,
      newStructure: compared.newStructure && compared.newStructure.hit,
      threshold: STOP2_PIXEL_THRESHOLD,
      problems: problems.length ? problems : undefined,
      diff: diffPath,
    });
  }
  writeFileSync(join(base, 'pixel-results.json'), JSON.stringify(results, null, 2));
  return { ok: results.every((r) => r.ok), results };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/**
 * 采集三屏 demo 实拍（1920×1080，取消 QA fit，走真实交互入口）。
 * 只做截图，不做判定；判定在 runStop2ModalPixelProbe。
 */
export async function captureStop2Shots({ demoDir, outDir, browser } = {}) {
  const demo = resolve(demoDir);
  const base = outDir ? resolve(outDir) : join(demo, STOP2_PIXEL_DIR);
  mkdirSync(base, { recursive: true });
  const { chromium } = await import(resolvePlaywrightEntry());
  const own = !browser;
  const b = browser || await chromium.launch({ headless: true, executablePath: process.env.FX_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const shots = {};
  try {
    const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto('file://' + join(demo, 'index.html') + '?interaction=1');
    await page.locator('label').filter({ hasText: '缩放到可视区' }).locator('input').uncheck();
    await page.waitForTimeout(500);
    for (const screen of STOP2_SCREENS) {
      await page.evaluate((l) => window.__qa.setPref('lang', l), screen.lang);
      await page.waitForTimeout(500);
      await page.locator(`[data-go="${screen.go}"]`).first().click({ force: false });
      if (screen.rulesNode) {
        await page.waitForTimeout(600);
        await page.locator(`[data-node="${screen.rulesNode}"]`).click({ force: false });
      }
      await page.waitForTimeout(800);
      const file = join(base, `demo.${screen.key}.png`);
      await page.locator('.frame').screenshot({ path: file });
      shots[screen.key] = file;
    }
  } finally {
    if (own) await b.close();
  }
  return shots;
}

function resolvePlaywrightEntry() {
  return join(SKILL_ROOT, 'node_modules/playwright-core/index.mjs');
}

if (isMain) {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const k = process.argv[i];
    if (k === '--demo') args.demoDir = process.argv[++i];
    else if (k === '--inventory') args.inventory = JSON.parse(readFileSync(process.argv[++i], 'utf8'));
    else if (k === '--capture') args.capture = true;
  }
  (async () => {
    if (args.capture) args.demoShots = await captureStop2Shots({ demoDir: args.demoDir });
    const out = await runStop2ModalPixelProbe(args);
    for (const r of out.results) {
      console.log(`${r.key}	${r.status}	${r.ratio != null ? (r.ratio * 100).toFixed(4) + '%' : '-'}	bad=${r.bad ?? '-'}/${r.total ?? '-'}	masked=${r.maskedTextNodes ?? '-'}`);
      if (r.problems) console.log(`  problems: ${r.problems.join('; ')}`);
    }
    console.log(`
overall: ${out.ok ? 'PASS' : 'FAIL'}`);
    process.exit(out.ok ? 0 : 1);
  })().catch((err) => { console.error(err); process.exit(1); });
}
