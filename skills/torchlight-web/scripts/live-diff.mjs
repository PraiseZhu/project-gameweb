#!/usr/bin/env node
/**
 * live-diff.mjs — 稿↔线上对账门：Figma 定稿与线上页面，逐项量出来对账。【本 Skill 新增】
 *
 * ═══ 为什么有这道门 ═══
 *
 * 「我们的 demo vs 官网差多少」以前靠人肉截图、圈红、目测。这活本来该机器干：
 * 每次跑都出一张差异表（字号/行高/框宽/位置：稿内值 → 换算期望 → 线上实测 → 偏差%），
 * 差异是显性的、可追踪的，而不是"感觉差不多"。
 *
 * ═══ 基准：以 Figma 稿为准（2026-08-04 用户拍板）═══
 *
 * 基准 = Figma 定稿。官网 = 参考现状，不是验收基准（它仍是上赛季内容）。
 * 每行差异读作「官网与稿不一致」，而**不是**「我们与官网不一致」。
 *
 * ⚠️ 后门警告，这条最容易被违反：
 * **差异不是修复指令。** 禁止为了让这张表变好看而去调我们的 CSS / 渲染实现。
 * 看到「官网 36 / 稿 30」就把字号改成 36，等于把旧赛季的错抄进来。
 * 改动只能来自 Figma 稿或本地化表 —— 这就是既有的「禁止单边改产物」纪律。
 *
 * ═══ 判定口径（最重要，先读这个再读代码；2026-08-04 lead 终裁）═══
 *
 * **本门永不判定，永远退出 0。** 有基准不等于门有权判定：稿可能已经改了、
 * 线上可能还没上，谁对要人看。差异 ≠ 我们错了，三种可能：①稿是新的、
 * 线上还没更新 ②稿改错了、线上是对的 ③我们提取或换算错了——门无权判断。
 *
 * 「线上找不到该文案」也【永远不是非零】：线上不是我们的东西，官网改文案
 * 不是我们的 bug。不为一件我们不负责的事建声明机制——少写一套配置，还更诚实。
 *
 * 退出码非零的【唯一例外】是门自己坏了——这三类是**我们的**问题：
 *   - 页面打不开
 *   - 根 font-size 不符合 spec 声明的 rem 契约（量的尺子本身不对）
 *   - 换算算不出来（视口没有对应稿宽 / 锚点 nodeId 不在 truth / 稿内值非数值）
 *
 * 但退出 0 ≠ 静默。门必须把事实印成**头条**（控制台最上方 + 报告 headline 字段）：
 * 哪些锚点线上没有对应文案（逐条点名，不许埋列表里、不许白名单跳过），
 * 哪些字段差异显著。头条之后才逐锚点出差异表，表尾固定免责声明：
 * 「以上逐行读作『官网与稿不一致』：基准 = Figma 稿，官网 = 参考现状」。
 *
 * ═══ TEXT 节点按中心点比对（修 bug，不是优化；谁改回去谁就是在让报告说谎）═══
 *
 * Figma TEXT 节点的 box.w 是【文本框宽】，线上 getBoundingClientRect 量到的是
 * 【字形宽】——两者根本不是同一个量。实测证据（2026-08-04，yise-ss5-preview 的 1:474）：
 *   稿内框 w=686，线上字形 w=210 → 按 width 比会报 −38.8% 的【假差异】；
 *   改比中心点：稿内期望中心 541.75 vs 线上中心 547.5，只差 ~1% —— 位置其实一致。
 * 设计看一眼"−38.8%"就知道是表在胡说，然后这张表就再没人看了。
 * 所以 TEXT 锚点：width 行只量不比并固定加注，x 行改为 centerX（x + w/2）比对。
 * 非 TEXT 节点（矩形/图片/容器）照旧比 x/width——它们的 box 就是几何盒，没这个陷阱。
 *
 * ═══ 锚点纪律 ═══
 *
 * 锚点用【文本内容】定位，不用 CSS 选择器 —— 官网是别人的页面，选择器随时变，文案相对稳定。
 * 锚点全部由 spec.liveDiff.anchors 声明；匹配不到就如实进头条，不许猜、不许退而求其次。
 *
 * ⚠️ 锚点只认【可见叶子元素】（rect>0 且 visibility/display 正常），这条过滤不许删：
 * 实测（2026-08-04）「复制」曾撞上页面里一个 0 尺寸隐藏节点，量出 rect 全 0、
 * fontFamily=Times New Roman 默认值的假数据 —— 那类静默假数据比报错危险得多。
 *
 * ═══ 只读纪律 ═══
 *
 * 对线上页面只 goto + 滚动 + 读（computed style / bounding rect / document.fonts）。
 * 不点击、不提交表单、不写任何东西。线上内容会变：本门每次现量，
 * 任何数值都不许写死进断言（断言只断「门能否工作」，不断「数值是几」）。
 *
 * ═══ 配置（spec.liveDiff，全部配置化，Skill 层不写死任何 demo 具体值）═══
 *   url                线上地址
 *   viewports          [{w,h}] 可多个，逐个量
 *   designWidthFor     {"1920": 3840} 视口宽 → 稿宽；期望线上 px = 稿内值 × 视口宽/稿宽
 *   anchors            [{nodeId, matchText}] nodeId 查 truth 取稿内值，matchText 在线上定位
 *   tolerance          {fontSize,lineHeight,width,x} 相对偏差超阈值 → 标「差异」（不影响退出码）
 *
 * ═══ 用法 ═══
 *   node scripts/live-diff.mjs --demo <dir>
 *   node scripts/live-diff.mjs --demo <dir> --json
 *   Windows 需 CHROME_PATH 指向本机 Chrome（resolve-playwright 也会自动找）。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchChromium } from './lib/resolve-playwright.mjs';

/* TEXT 行固定加注——必须在报告输出里，不只在代码注释里（lead 2026-08-04 裁决 1） */
const TEXT_CENTER_NOTE = 'Figma 框宽 ≠ 线上字形宽，故按中心点比对';
/* 头条固定说明（lead 2026-08-04 追加裁决，逐字，不许改写） */
const BASELINE_NOTE = '本门以 Figma 稿为准。官网仍是上赛季内容，差异属预期，不需回改实现。';
const NO_FIX_NOTE = '⚠️ 差异不是修复指令：禁止为对齐官网单边改产物（CSS/渲染）。改动只能来自 Figma 稿或本地化表。';
const DISCLAIMER = '以上逐行读作「官网与稿不一致」：基准 = Figma 稿，官网 = 参考现状。是否需要行动由设计或前端裁决。';

function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(1);
}

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k === '--demo') args.demo = process.argv[++i];
  else if (k === '--json') args.json = true;
  else fail(`未知参数：${k}`);
}
if (!args.demo) fail('必须给 --demo <dir>');

const demoDir = resolve(args.demo);
const specPath = join(demoDir, 'spec.json');
const truthPath = join(demoDir, 'truth.json');
if (!existsSync(specPath)) fail(`缺 ${specPath}`);
if (!existsSync(truthPath)) fail(`缺 ${truthPath}（先跑 scripts/truth.mjs）`);

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const cfg = spec.liveDiff;
if (!cfg) {
  // 没配置 = 这个 demo 不做线上对账。明说「未校验」，不静默通过，也不阻断。
  console.log('⚠️ spec.json 没有 liveDiff 配置 —— 本门对此 demo 不适用，本次未校验（不是通过）。');
  process.exit(0);
}
for (const k of ['url', 'viewports', 'designWidthFor', 'anchors', 'tolerance']) {
  if (!cfg[k]) fail(`spec.liveDiff 缺 ${k}`);
}

/** 解包 provenance 叶子（与 render-coverage 同款） */
function unwrap(n) {
  if (n && typeof n === 'object' && !Array.isArray(n) && 'value' in n && n.provenance) return n.value;
  if (Array.isArray(n)) return n.map(unwrap);
  if (n && typeof n === 'object') return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, unwrap(v)]));
  return n;
}
const truth = unwrap(JSON.parse(readFileSync(truthPath, 'utf8')));

/* ── 建 nodeId → 稿内文字节点索引 ──
 * 节点 box 是画布绝对坐标；换算线上期望 x 时要先减所在分区的稿内原点。
 * 分区原点取 sections[sid].meta.x/y，拿不到退回 truth.section（单分区 demo 的汇总），
 * 再拿不到记 0 并在报告里标注 originAssumed —— x 差异反正只列表不影响退出码。 */
const textById = new Map();
for (const [sid, sec] of Object.entries(truth.sections || {})) {
  const meta = sec.meta || {};
  const originX = meta.x ?? (truth.section && truth.section.id === sid ? truth.section.x : 0);
  const originAssumed = meta.x == null && !(truth.section && truth.section.id === sid);
  const list = Array.isArray(sec.nodes) ? sec.nodes : Object.values(sec.nodes || {});
  for (const n of list) {
    if (!n.text || n.id == null) continue;
    textById.set(String(n.id), { node: n, sectionId: sid, originX, originAssumed });
  }
}

/* rem 根契约：从 spec.adaptation.rootContract 文本里解析 Nvw（契约是声明，尺子靠它校准） */
function rootContractExpect(viewportW) {
  const rc = spec.adaptation && spec.adaptation.rootContract;
  if (!rc) return null; // 未声明契约 → 跳过核验（报告里写明）
  const m = /(\d+(?:\.\d+)?)\s*vw/.exec(rc);
  if (!m) return null;
  const scale = (spec.adaptation && spec.adaptation.rootScale) ?? 1;
  return viewportW * (parseFloat(m[1]) / 100) * scale;
}

/* 参与比对的字段。TEXT 节点的 width/x 在循环里特判走中心点（见文件头）。 */
const FIELDS = [
  { key: 'fontSize', tolKey: 'fontSize', design: (t) => t.node.text.fontSize },
  { key: 'lineHeight', tolKey: 'lineHeight', design: (t) => t.node.text.lineHeight },
  { key: 'width', tolKey: 'width', design: (t) => t.node.box && t.node.box.w },
  { key: 'x', tolKey: 'x', design: (t) => t.node.box && t.node.box.x - t.originX },
];

const failures = []; // 只有「门自己坏了」才进这里 —— 见文件头判定口径（页面/根契约/换算）
const anchorMisses = []; // 「线上找不到该文案」——永远不进 failures，但必须进头条点名
const viewportReports = [];

const { browser } = await launchChromium(demoDir, { headless: true });
try {
  for (const vp of cfg.viewports) {
    const rep = { viewport: vp, anchors: [], rootCheck: null, fonts: [], timing: {}, failures: [] };
    viewportReports.push(rep);
    const designW = cfg.designWidthFor[String(vp.w)];
    if (typeof designW !== 'number' || !(designW > 0)) {
      rep.failures.push(`视口 ${vp.w} 在 designWidthFor 里没有对应稿宽 —— 换算算不出来`);
      continue;
    }
    const scale = vp.w / designW;

    const t0 = Date.now();
    let page;
    try {
      page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
      await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (e) {
      rep.failures.push(`页面打不开：${cfg.url} —— ${e.message}`);
      if (page) await page.close().catch(() => {});
      continue;
    }
    rep.timing.gotoMs = Date.now() - t0;

    /* 全页扫一遍滚动再回顶：触发懒加载，让待量的元素真实存在于布局里 */
    const tScroll = Date.now();
    await page.evaluate(async () => {
      const h = document.body ? document.body.scrollHeight : 0;
      for (let y = 0; y <= h; y += 800) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    rep.timing.sweepMs = Date.now() - tScroll;

    /* 根契约核验：尺不对，后面所有换算都是废的 → 这是「门自己坏了」 */
    const measuredRoot = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    const expectRoot = rootContractExpect(vp.w);
    if (expectRoot == null) {
      rep.rootCheck = { status: 'skipped', note: 'spec.adaptation 未声明 rootContract，跳过根契约核验' };
    } else {
      const ok = Math.abs(measuredRoot - expectRoot) <= Math.max(0.5, expectRoot * 0.01);
      rep.rootCheck = { status: ok ? 'ok' : 'violation', measured: measuredRoot, expected: expectRoot };
      if (!ok) rep.failures.push(`根 font-size=${measuredRoot}px，不符合契约期望 ${expectRoot}px（${vp.w} 视口按 spec.adaptation.rootContract 推算）——量的尺子不对`);
    }

    rep.fonts = await page.evaluate(() => [...document.fonts].map((f) => ({ family: f.family, status: f.status, weight: f.weight })));

    /* 页内定位函数（可见叶子，见文件头「锚点纪律」的警告）。find 与 measure 共用一份逻辑。 */
    const locateFn = (needle) => {
      const norm = (s) => String(s || '').replace(/\s+/g, '');
      const n = norm(needle);
      const visible = (e) => {
        const r = e.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        const cs = getComputedStyle(e);
        return cs.visibility !== 'hidden' && cs.display !== 'none';
      };
      let best = null;
      for (const e of document.querySelectorAll('body *')) {
        if (e.children.length > 0) continue; // 只要叶子元素，box 才是文字自身的
        if (!norm(e.textContent).includes(n)) continue;
        if (!visible(e)) continue;
        if (!best || e.textContent.length < best.textContent.length) best = e;
      }
      return best;
    };

    /* 逐锚点：文本定位 → 滚到位 → 量 → 与稿内换算值对账 */
    for (const anchor of cfg.anchors) {
      const t = textById.get(String(anchor.nodeId));
      const row = { nodeId: anchor.nodeId, matchText: anchor.matchText, nodeType: t ? t.node.type : null, fields: [] };
      rep.anchors.push(row);
      if (!t) {
        // 锚点指向的 nodeId 不在 truth —— 这是我们自己的配置/提取问题，属「换算算不出来」
        row.error = `nodeId ${anchor.nodeId} 不在 truth.json 的文字节点里 —— 换算算不出来`;
        rep.failures.push(`锚点 ${anchor.nodeId}：${row.error}`);
        continue;
      }
      const found = await page.evaluate((args) => {
        const best = (0, eval)(`(${args.locateSrc})`)(args.needle);
        if (!best) return null;
        best.scrollIntoView({ block: 'center' });
        return { tag: best.tagName };
      }, { needle: anchor.matchText, locateSrc: locateFn.toString() });
      if (!found) {
        row.miss = '线上页面找不到该文案（稿是新的线上没更新？文案改了？渲染成了图片？——门不猜原因，只点名）';
        anchorMisses.push({ nodeId: anchor.nodeId, matchText: anchor.matchText });
        continue;
      }
      await page.waitForTimeout(400); // 等懒加载/过渡动画落定
      const live = await page.evaluate((args) => {
        const best = (0, eval)(`(${args.locateSrc})`)(args.needle);
        if (!best) return null;
        const r = best.getBoundingClientRect();
        const cs = getComputedStyle(best);
        return {
          fontSize: parseFloat(cs.fontSize),
          lineHeight: cs.lineHeight === 'normal' ? null : parseFloat(cs.lineHeight),
          lineHeightNormal: cs.lineHeight === 'normal',
          fontFamily: cs.fontFamily,
          rect: { x: r.x, y: r.y + window.scrollY, w: r.width, h: r.height },
        };
      }, { needle: anchor.matchText, locateSrc: locateFn.toString() });
      if (!live) {
        row.miss = '滚动后元素又找不到了（懒加载回收？）';
        anchorMisses.push({ nodeId: anchor.nodeId, matchText: anchor.matchText });
        continue;
      }
      row.live = live;
      row.designOrigin = { sectionId: t.sectionId, originX: t.originX, ...(t.originAssumed ? { originAssumed: true } : {}) };

      const isText = t.node.type === 'TEXT';
      for (const f of FIELDS) {
        /* TEXT 特判：width 只量不比；x 改 centerX。原因与实测证据见文件头「TEXT 节点按中心点比对」。 */
        if (isText && f.key === 'width') {
          row.fields.push({ field: 'width', design: t.node.box && t.node.box.w, live: Math.round(live.rect.w * 100) / 100, verdict: '只量不比', note: TEXT_CENTER_NOTE });
          continue;
        }
        if (isText && f.key === 'x') {
          const designCenter = t.node.box.x - t.originX + t.node.box.w / 2;
          const liveCenter = live.rect.x + live.rect.w / 2;
          if (typeof designCenter !== 'number' || !Number.isFinite(designCenter)) {
            row.fields.push({ field: 'centerX', verdict: '换算算不出来' });
            rep.failures.push(`锚点 ${anchor.nodeId} 的 centerX：稿内 box 非数值`);
            continue;
          }
          const expected = designCenter * scale;
          const dev = (liveCenter - expected) / expected;
          row.fields.push({
            field: 'centerX', design: Math.round(designCenter * 100) / 100, expected: Math.round(expected * 100) / 100,
            live: Math.round(liveCenter * 100) / 100,
            deltaPx: Math.round((liveCenter - expected) * 100) / 100,
            deviationPct: Math.round(dev * 1000) / 10,
            verdict: Math.abs(dev) <= (cfg.tolerance.x ?? 0) ? '一致' : '差异',
            note: TEXT_CENTER_NOTE,
          });
          continue;
        }
        const designVal = f.design(t);
        const liveVal = f.key === 'width' ? live.rect.w : f.key === 'x' ? live.rect.x : live[f.key];
        if (f.key === 'lineHeight' && live.lineHeightNormal) {
          row.fields.push({ field: f.key, design: designVal, expected: null, live: 'normal', verdict: '量不到', note: '线上 computed line-height 为 normal（浏览器默认≈1.2em），无法数值比对' });
          continue;
        }
        if (typeof designVal !== 'number' || !Number.isFinite(designVal)) {
          row.fields.push({ field: f.key, design: designVal, verdict: '换算算不出来' });
          rep.failures.push(`锚点 ${anchor.nodeId} 的 ${f.key}：稿内值非数值（${JSON.stringify(designVal)}）`);
          continue;
        }
        const expected = designVal * scale;
        const dev = (liveVal - expected) / expected;
        const tol = cfg.tolerance[f.tolKey] ?? 0;
        row.fields.push({
          field: f.key, design: designVal, expected: Math.round(expected * 100) / 100,
          live: Math.round(liveVal * 100) / 100,
          deltaPx: Math.round((liveVal - expected) * 100) / 100,
          deviationPct: Math.round(dev * 1000) / 10,
          verdict: Math.abs(dev) <= tol ? '一致' : '差异',
        });
      }
      // y 与 fontFamily 只量不比：页面上方布局与稿不同，y 跨页比对没有意义；字族是信息项
      row.fields.push({ field: 'y', live: Math.round(live.rect.y * 100) / 100, verdict: '只量不比', note: '线上 y 取决于该模块以上所有布局，与稿内 y 无对应关系' });
      row.fields.push({ field: 'fontFamily', live: live.fontFamily, verdict: '只量不比' });
    }
    await page.close();
  }
} finally {
  await browser.close();
}

for (const rep of viewportReports) failures.push(...rep.failures);

/* ── 头条素材：显著差异（只报不判）+ x 同向偏移观察 ── */
const significant = [];
const xDeltas = [];
for (const rep of viewportReports) {
  for (const a of rep.anchors) {
    if (!a.fields) continue;
    const diffs = a.fields.filter((f) => f.verdict === '差异');
    if (diffs.length) {
      significant.push(`[${a.nodeId}] "${a.matchText}" ` + diffs.map((f) => `${f.field} ${f.deviationPct > 0 ? '+' : ''}${f.deviationPct}%`).join(' · '));
    }
    for (const f of a.fields) {
      if ((f.field === 'x' || f.field === 'centerX') && typeof f.deltaPx === 'number' && f.verdict !== '换算算不出来') {
        xDeltas.push(f.deltaPx);
      }
    }
  }
}
const sameDir = xDeltas.length >= 2 && (xDeltas.every((d) => d > 0) || xDeltas.every((d) => d < 0));
const xShiftNote = sameDir
  ? `x 同向偏移 ${xDeltas.length} 处：${Math.min(...xDeltas)} ~ ${Math.max(...xDeltas)}px（像模块整体平移——只记录不判断，不猜原因）`
  : null;

const report = {
  ok: failures.length === 0,
  exitCodeBasis: '本门永不判定稿与线上谁对，恒退出 0；唯一非零：门自己坏了（页面打不开 / 根契约不成立 / 换算算不出来）',
  baseline: BASELINE_NOTE,
  noFix: NO_FIX_NOTE,
  disclaimer: DISCLAIMER,
  headline: {
    anchorMisses,
    note: anchorMisses.length ? '线上找不到这些文案——可能是稿新线上旧/线上文案已改/渲染成图片，门不猜原因，只点名' : null,
    significant,
    xShiftNote,
  },
  url: cfg.url,
  fetchedAt: new Date().toISOString(),
  viewports: viewportReports,
  failures,
};
writeFileSync(join(demoDir, 'live-diff-report.json'), JSON.stringify(report, null, 2));

/* ── 控制台输出：头条在最上面，差异表居中，免责声明压底 ── */
console.log(`稿↔线上对账门：${cfg.url}`);
console.log(BASELINE_NOTE);
console.log(NO_FIX_NOTE);
console.log('');
if (anchorMisses.length) {
  const total = cfg.anchors.length * viewportReports.length;
  console.log(`⚠️ 头条：官网 ${anchorMisses.length}/${total} 条锚点没有对应文案 —— 逐条点名：`);
  console.log(`   ${anchorMisses.map((m) => m.matchText).join(' · ')}`);
  console.log('   （稿是新的线上没更新？线上文案已改？渲染成图片？——门不猜原因）');
} else {
  console.log('✅ 头条：全部锚点在线上都有对应文案');
}
if (significant.length) {
  console.log('⚠️ 头条：显著差异（超 tolerance，只报不判）：');
  for (const s of significant) console.log(`   ${s}`);
}
if (xShiftNote) console.log(`⚠️ 头条：${xShiftNote}`);
console.log('');
for (const rep of viewportReports) {
  const designW = cfg.designWidthFor[String(rep.viewport.w)];
  console.log(`═══ 视口 ${rep.viewport.w}×${rep.viewport.h}（稿宽 ${designW ?? '?'}，换算 ×${designW ? (rep.viewport.w / designW).toFixed(4) : '?'}）═══`);
  if (rep.rootCheck) {
    console.log(rep.rootCheck.status === 'ok'
      ? `根契约 ✅ html font-size=${rep.rootCheck.measured}px（期望 ${rep.rootCheck.expected}px）`
      : rep.rootCheck.status === 'skipped'
        ? `根契约 ⚠️ ${rep.rootCheck.note}`
        : `根契约 ❌ html font-size=${rep.rootCheck.measured}px，期望 ${rep.rootCheck.expected}px`);
  }
  console.log(`字体 ${rep.fonts.length} 条：${[...new Set(rep.fonts.map((f) => `${f.family}/${f.status}`))].join('，') || '（无）'}`);
  console.log(`耗时：goto ${rep.timing.gotoMs ?? '-'}ms · 滚动触发懒加载 ${rep.timing.sweepMs ?? '-'}ms`);
  for (const a of rep.anchors) {
    if (a.error) {
      console.log(`\n❌ [${a.nodeId}] "${a.matchText}" —— ${a.error}`);
      continue;
    }
    if (a.miss) {
      console.log(`\n⚠️ [${a.nodeId}] "${a.matchText}" —— ${a.miss}`);
      continue;
    }
    console.log(`\n[${a.nodeId}] "${a.matchText}"${a.nodeType === 'TEXT' ? `（TEXT：${TEXT_CENTER_NOTE}）` : ''}`);
    console.log(`   ${'字段'.padEnd(10)} ${'稿内值(基准)'.padStart(12)} ${'官网实测'.padStart(10)} ${'换算期望'.padStart(10)} ${'偏差%'.padStart(8)}  判定`);
    for (const f of a.fields) {
      const fmt = (v) => (typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v ?? '-'));
      console.log(`   ${f.field.padEnd(10)} ${fmt(f.design).padStart(10)} ${fmt(f.live).padStart(10)} ${fmt(f.expected).padStart(10)} ${(f.deviationPct != null ? String(f.deviationPct) : '-').padStart(8)}  ${f.verdict}${f.note ? `（${f.note}）` : ''}`);
    }
  }
  console.log('');
}
console.log(DISCLAIMER);
console.log(failures.length === 0
  ? '✅ 门工作正常，退出 0（差异表如上——以 Figma 稿为准记录，不需回改实现）'
  : `❌ 门自身故障 ${failures.length} 项（非零——这些是**我们的**问题，与稿/线上谁对无关）：\n${failures.map((f) => '   - ' + f).join('\n')}`);
console.log(`报告已写入 ${join(demoDir, 'live-diff-report.json')}`);
process.exit(failures.length === 0 ? 0 : 1);
