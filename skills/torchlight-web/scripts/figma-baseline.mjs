#!/usr/bin/env node
/**
 * figma-baseline.mjs — 门 E 基线图导出：从 Figma 导页面框、按分区裁剪成基线 PNG。【任务 16】
 *
 * ═══ 为什么基线是「页面框导出 + 本地裁剪」，不是「直接导分区」 ═══
 *
 * 分区自身没有背景（sec/3 的 fills 为空），整页背景是它的兄弟节点 bg/pc ——
 * 直接导分区得到的是透明底 + 内容，与我们渲染的「背景+内容合成」对不上。
 * 页面框导出才有完整合成。而整页导出会撞 Figma 的**面积上限**（实测 ~32MiPx：
 * 1:180 @1 返回 2734×12272，等比压扁 0.712 —— 压扁后裁剪坐标全是小数，不可用），
 * 所以导出 scale=0.5（1920×8620，低于上限），再按分区矩形裁剪。
 * 裁剪是纯像素操作，参数全部进清单 —— 基线可复现。
 *
 * ═══ 纪律 ═══
 * - token 只从环境变量 / 工作区根 .env 读，绝不写进任何产物 / 清单 / 元数据。
 * - 导出参数（scale / use_absolute_bounds / 节点 id / Figma 版本号 / 裁剪矩形）全部进
 *   baselines-manifest.json，否则基线不可复现。
 * - **面积压扁检测**：返回 PNG 的尺寸与「帧尺寸 × scale」不符即 fail —— 静默压扁
 *   是这个 API 的真坑（assets 侧踩过 16384 截断），裁一张压扁图等于基线造假。
 * - 基线图与切图一样归 demos/（已 gitignore，含未公开美术资源）。
 *
 * 用法：
 *   node scripts/figma-baseline.mjs --demo <dir> --section 1:467 --key sec3-pc
 *     [--frame 1:180] [--scale 0.5] [--crop-height 772]
 *   不带 --section 时读 spec.figma.baselines（若已配置）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadPngApi, readPng } from './lib/png-compare.mjs';

function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(1);
}

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k === '--demo') args.demo = process.argv[++i];
  else if (k === '--section') args.section = process.argv[++i];
  else if (k === '--key') args.key = process.argv[++i];
  else if (k === '--frame') args.frame = process.argv[++i];
  else if (k === '--scale') args.scale = Number(process.argv[++i]);
  else if (k === '--crop-height') args.cropHeight = Number(process.argv[++i]);
  else fail(`未知参数：${k}`);
}
if (!args.demo) fail('必须给 --demo <dir>');
const demoDir = resolve(args.demo);

/* token：环境变量或向上找 .env（与 figma-assets.mjs 同一口径；该文件是脚本不导出，
   这 12 行是第三份拷贝 —— 若哪天改鉴权方式，三处都要改，已互相点名） */
function readToken(startDir) {
  if (process.env.FIGMA_TOKEN) return process.env.FIGMA_TOKEN.trim();
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

const spec = JSON.parse(readFileSync(join(demoDir, 'spec.json'), 'utf8'));
const fileKey = spec.figma?.fileKey;
if (!fileKey) fail('spec.figma.fileKey 缺失');

const specCfg = spec.figma?.baselines || {};
const FRAME = args.frame || specCfg.frame;
const SCALE = args.scale ?? specCfg.scale ?? 0.5;
if (!FRAME) fail('缺页面框节点 id（--frame 或 spec.figma.baselines.frame）');

/* 导出条目：CLI 给单个（--section + --key），或 spec.figma.baselines.items */
let items;
if (args.section && args.key) items = [{ sectionNode: args.section, key: args.key }];
else if (Array.isArray(specCfg.items) && specCfg.items.length) items = specCfg.items;
else fail('缺导出条目（--section <id> --key <name>，或 spec.figma.baselines.items）');

/* 分区的画布绝对矩形：从本地快照读（不联网——它是稿内事实，快照即真源） */
function sectionBox(sectionId) {
  const snapFile = join(demoDir, 'fixtures', spec.figma.snapshotFile || 'figma-sec3.json');
  const snap = JSON.parse(readFileSync(snapFile, 'utf8'));
  const doc = snap.nodes?.[sectionId]?.document;
  const bb = doc?.absoluteBoundingBox;
  if (!bb) fail(`快照里取不到分区 ${sectionId} 的 absoluteBoundingBox（先跑 figma-fetch）`);
  return bb;
}

/* ═══ 前置检查：截图侧必须是 1:1，否则基线白导 ═══
 *
 * 门 E 的逻辑是「我们渲染的截图 ⟷ 稿导出的基线」逐像素比。截图由老师的
 * pixel-compare.mjs 在真浏览器里取。**如果那时验收壳正在做适配缩放（把画框整体
 * 缩小以塞进窗口），截出来的就是一张非整数倍重新光栅化的图** —— 拿它去比 1:1 的基线，
 * 差异全是缩放噪声，阈值再怎么调都是在给噪声定标准，等于基线造假。
 *
 * 2026-08-04 实测的坑：窗口 1920 + 模拟视口 1920 时，舞台左右各 22px 留白把可用宽
 * 压到 1880，壳静默套了 scale(0.97917)。壳这边已经修成「留白给 1:1 让位」，
 * 但这条前置检查仍要留着 —— 它保护的是"以后有人把留白改回去/加了别的边框"这种回归。
 *
 * 判据是壳自己现测的 __qa.inspect().viewIsOneToOne，不是我们另算一遍。
 * 拿不到浏览器（没装 Chromium / 无 CHROME_PATH）→ 明说「未校验」，不静默放过，也不阻断导出。
 */
async function preflightOneToOne() {
  const vp = spec.baselineViewport || {};
  if (!(vp.w > 0 && vp.h > 0)) {
    console.error('⚠️ spec.baselineViewport 没配 w/h —— 1:1 前置检查未校验（不是通过）。');
    return;
  }
  const idx = join(demoDir, 'index.html');
  if (!existsSync(idx)) {
    console.error('⚠️ 还没有 index.html —— 1:1 前置检查未校验（不是通过）。');
    return;
  }
  let launchChromium, pathToFileURL;
  try {
    ({ launchChromium } = await import('./lib/resolve-playwright.mjs'));
    ({ pathToFileURL } = await import('node:url'));
  } catch (e) {
    console.error(`⚠️ 起不了浏览器（${e.message}）—— 1:1 前置检查未校验（不是通过）。`);
    return;
  }
  let browser;
  try {
    ({ browser } = await launchChromium(demoDir, { headless: true }));
  } catch (e) {
    console.error(`⚠️ 找不到可用 Chromium（${e.message}）—— 1:1 前置检查未校验（不是通过）。设 CHROME_PATH 可启用。`);
    return;
  }
  try {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
    await page.goto(pathToFileURL(idx).href, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const info = await page.evaluate(() => {
      if (!window.__qa || typeof window.__qa.inspect !== 'function') return null;
      const i = window.__qa.inspect();
      return { one: i.viewIsOneToOne, k: i.viewFitScale };
    });
    if (!info) {
      console.error('⚠️ 产物里没有 __qa.inspect() —— 1:1 前置检查未校验（不是通过）。');
    } else if (!info.one) {
      fail(`截图侧不是 1:1：验收壳正在做适配缩放 ${(info.k * 100).toFixed(2)}%（视口 ${vp.w}×${vp.h}）。\n` +
           '  拿被缩过的截图去比 1:1 基线，差异全是缩放噪声 —— 基线不许在这种状态下导。\n' +
           '  修法：把 spec.baselineViewport 调宽到画框能 1:1 放下，或检查舞台留白/边框是不是又挡住了 1:1。');
    } else {
      console.log(`✅ 前置检查：截图侧 1:1（视口 ${vp.w}×${vp.h}，适配缩放 100%）`);
    }
  } finally {
    await browser.close().catch(() => {});
  }
}
await preflightOneToOne();

const API = 'https://api.figma.com/v1';
const token = readToken(demoDir);
async function figmaGet(url) {
  const res = await fetch(url, { headers: { 'X-Figma-Token': token } });
  if (!res.ok) fail(`Figma API ${res.status}：${url.replace(/key=[^&]+/, 'key=***')}`);
  return res;
}

/* 1) 页面框的画布绝对矩形 + 稿版本（基线可复现的前提） */
const nodesRes = await (await figmaGet(`${API}/files/${fileKey}/nodes?ids=${encodeURIComponent(FRAME)}&depth=0`)).json();
const frameDoc = nodesRes.nodes?.[FRAME]?.document;
const frameBox = frameDoc?.absoluteBoundingBox;
if (!frameBox) fail(`取不到页面框 ${FRAME} 的 absoluteBoundingBox`);
const figmaVersion = nodesRes.version || null;
const figmaLastModified = nodesRes.lastModified || null;

/* 2) 导出页面框 PNG */
const q = new URLSearchParams({ ids: FRAME, format: 'png', scale: String(SCALE), use_absolute_bounds: 'true' });
const imgRes = await (await figmaGet(`${API}/images/${fileKey}?${q}`)).json();
const imgUrl = imgRes.images?.[FRAME];
if (!imgUrl) fail(`images 接口没返回 ${FRAME} 的 URL：${JSON.stringify(imgRes).slice(0, 200)}`);
const buf = Buffer.from(await (await fetch(imgUrl)).arrayBuffer());

const { PNG } = await loadPngApi(demoDir);
const png = readPng(PNG, buf);

/* 3) 面积压扁检测：返回尺寸必须 ≡ 帧尺寸×scale（±1px 取整容差），不符即拒 —— 不裁压扁图 */
const expW = Math.round(frameBox.width * SCALE);
const expH = Math.round(frameBox.height * SCALE);
if (Math.abs(png.width - expW) > 1 || Math.abs(png.height - expH) > 1) {
  fail(`导出尺寸 ${png.width}×${png.height} ≠ 期望 ${expW}×${expH}（帧 ${frameBox.width}×${frameBox.height} × scale ${SCALE}）——` +
    '疑似撞上 Figma 导出面积上限被静默压扁（实测上限 ~32MiPx）。拒绝从压扁图裁剪基线。');
}

/* 4) 逐分区裁剪 */
mkdirSync(join(demoDir, 'baselines'), { recursive: true });
const manPath = join(demoDir, 'baselines-manifest.json');
const manifest = {
  _note: '门 E 基线清单。基线 PNG 是二进制，做不成 provenance 叶子；可校验替代品是 sha256 + 完整导出参数（同 assets-manifest 的口径）。' +
    '来源：Figma 页面框导出 + 本地纯像素裁剪；token 不在此文件里。',
  generatedAt: new Date().toISOString(),
  figma: { version: figmaVersion, lastModified: figmaLastModified },
  export: { frameNode: FRAME, scale: SCALE, format: 'png', use_absolute_bounds: true, exportWidth: png.width, exportHeight: png.height },
  baselines: {},
};
if (existsSync(manPath)) {
  try {
    const old = JSON.parse(readFileSync(manPath, 'utf8'));
    Object.assign(manifest.baselines, old.baselines || {});   // 增量：别的 key 的条目保留
  } catch { /* 坏了就整份重算 */ }
}

for (const it of items) {
  const sb = sectionBox(it.sectionNode);
  /* 裁剪矩形（导出图像素坐标）：分区相对帧原点的偏移 × scale。
     奇偶要求：(sec.y−frame.y)×scale 必须落在整数行上，否则上下有半像素相位差 ——
     实测 sec/3：3998×0.5=1999 ✅ 整数。非整数时拒裁（报出来，不悄悄四舍五入）。 */
  const cx = (sb.x - frameBox.x) * SCALE;
  const cy = (sb.y - frameBox.y) * SCALE;
  const cw = sb.width * SCALE;
  const ch = args.cropHeight ?? sb.height * SCALE;
  if (Math.abs(cx - Math.round(cx)) > 1e-6 || Math.abs(cy - Math.round(cy)) > 1e-6) {
    fail(`裁剪原点非整数（x=${cx}, y=${cy}）——scale=${SCALE} 下分区偏移不是整像素，裁了会有半像素相位差。` +
      '换个 scale 或调整比对几何，不要硬裁。');
  }
  const X = Math.round(cx), Y = Math.round(cy);
  const W = Math.round(cw), H = Math.round(ch);
  if (X < 0 || Y < 0 || X + W > png.width || Y + H > png.height) {
    fail(`裁剪矩形 [${X},${Y} ${W}×${H}] 超出导出图 ${png.width}×${png.height}`);
  }
  const out = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    const srcStart = ((Y + y) * png.width + X) * 4;
    png.data.copy(out.data, y * W * 4, srcStart, srcStart + W * 4);
  }
  const outBuf = PNG.sync.write(out);
  const file = join(demoDir, 'baselines', `${it.key}.png`);
  writeFileSync(file, outBuf);
  manifest.baselines[it.key] = {
    file: `baselines/${it.key}.png`,
    sectionNode: it.sectionNode,
    crop: { x: X, y: Y, w: W, h: H, note: '导出图像素坐标；原点=(分区画布偏移)×scale' },
    sectionDesignBox: { x: sb.x, y: sb.y, w: sb.width, h: sb.height },
    sha256: createHash('sha256').update(outBuf).digest('hex'),
    bytes: outBuf.length,
  };
  console.log(JSON.stringify({ wrote: `baselines/${it.key}.png`, size: `${W}×${H}`, bytes: outBuf.length }));
}
writeFileSync(manPath, JSON.stringify(manifest, null, 1) + '\n');
console.log(JSON.stringify({ ok: true, manifest: 'baselines-manifest.json', keys: items.map((i) => i.key) }));
