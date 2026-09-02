/**
 * figma-region-verify.mjs —— 区域级视觉验收 + end-to-end provenance 诊断。【本 Skill 新增】
 *
 * ═══ 解决什么 ═══
 * 现有 verify/冒烟的回答是「整页绿不绿」；pixel-compare 的回答是「像素差多少」。
 * 但用户/设计报的常是「**那一块**漏层了 / 错框了 / 被裁了 / 层级压错了」——
 * 整页绿灯逮不到局部回归，像素 diff 只给一张红图、不说「为什么」。
 *
 * 本框架把验收粒度从「整页」收到「一个 Figma 区域/节点」，并把诊断从「像素不同」
 * 升到「结构原因」：
 *   Figma 参考区域/节点 ──truth──▶ DOM 该有谁、在哪、多大
 *                        ──asset──▶ 该用哪张切图、exportBounds 是否越界
 *                        ──DOM────▶ 可见性 / clip / z-index / computed background·border·shadow
 *                        ──Chrome─▶ 该区域局部截图（结构证据的图证，不作像素真假源）
 *
 * ═══ 一条纪律 ═══
 *   真值只来自 truth.json（= Figma 静态稿）。本库**不手填参考、不伪造基线**。
 *   局部截图只是「让诊断可被肉眼复核」的图证，不做像素级 pass/fail——
 *   像素对账仍归 pixel-compare.mjs（它才有 baseline 纪律）。这里若引入像素判定，
 *   就得自带 baseline 来源，那等于再开一套真源，必然漂移。
 *
 * ═══ 与现有工具的关系 ═══
 *   figma-render-check.mjs   整页结构断言（节点数/坐标/嵌套）——粗粒度，不管单区
 *   figma-chrome-check.mjs   壳冒烟（控件/合约）——不看产品层区域
 *   pixel-compare.mjs        整页像素 diff——给红图不给原因
 *   本库                      区域级：结构诊断 + 局部图证，补上面三者的盲区
 *
 * 用法：
 *   import { runRegionVerify } from '<skill>/scripts/lib/figma-region-verify.mjs';
 *   const report = await runRegionVerify({
 *     demoDir, regions: [{ name, sectionId, nodeId?|box? }], viewport, prefs, screenshotDir,
 *   });
 *   // 或经 verify 的 customGates 挂一个薄壳（见 docs/region-verify.md）
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { launchChromium } from './resolve-playwright.mjs';

/* ── truth 叶子解包：{value, provenance} → 裸值（与 render-check 同款语义）── */
function unwrap(n) {
  if (n && typeof n === 'object' && !Array.isArray(n) && 'value' in n && n.provenance) return n.value;
  if (Array.isArray(n)) return n.map(unwrap);
  if (n && typeof n === 'object') return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, unwrap(v)]));
  return n;
}
const arrOf = (v) => (Array.isArray(v) ? v : Object.values(v || {}));

/* ── 在 truth 某分区内收集目标子树（含自身）的所有节点 id ──────────────── */
function collectSubtreeIds(nodes, targetId) {
  /* 父子关系靠 id 叶子的 locator：形如 /nodes/<sec>/document/children/1/children/0/id。
     剥掉末尾 /id 得到「结构路径」，target 是祖先 ⟺ 目标结构路径是 target 结构路径的前缀。
     （与 render-check._orderKey 同源：locator 是被门 A 校验过的 Figma 树位置，不是派生数据。） */
  const nid = (n) => (n && n.id && n.id.value !== undefined ? n.id.value : (n && n.id !== undefined ? n.id : undefined));
  const structPath = (n) => {
    const loc = (n.id && n.id.provenance && n.id.provenance.locator) || n.locator || '';
    return String(loc).replace(/\/id\s*$/, '').replace(/\/+$/, '');
  };
  const target = nodes.find((n) => String(nid(n)) === String(targetId));
  if (!target) return null;
  const tPath = structPath(target);
  const out = [];
  for (const n of nodes) {
    const p = structPath(n);
    if (p === tPath || p.startsWith(tPath + '/')) out.push(nid(n));
  }
  return out;
}

/* ── 结构诊断（在浏览器里对一个区域现测）───────────────────────────── */
const DIAG_FN = function (payload) {
  const { nodeIds, regionBox, secOrigin } = payload;
  const out = { nodes: [], summary: { hidden: 0, clipped: 0, zeroSize: 0, offscreen: 0, missing: 0, zIndexed: 0 } };
  const seen = new Set();
  for (const rawId of nodeIds) {
    const id = String(rawId);
    if (seen.has(id)) continue; seen.add(id);
    const el = document.querySelector('.frame [data-node="' + CSS.escape(id) + '"]');
    if (!el) { out.summary.missing++; out.nodes.push({ id, issue: 'missing-in-dom' }); continue; }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const issues = [];
    // 可见性
    const vis = cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) !== 0;
    if (!vis) { issues.push('not-visible'); out.summary.hidden++; }
    // 零尺寸（漏层/被压没的典型）
    // clip：只报「被某 overflow:hidden 祖先裁到完全不可见」——那才是漏层。
    // 越出卡片/列表框但仍部分可见是 Figma 允许的设计（clipsContent 只裁超界部分），不算漏层。
    let clippedBy = null; let cur = el.parentElement;
    while (cur && cur !== document.body) {
      const c = getComputedStyle(cur);
      const isClipHost = cur.classList && (cur.classList.contains('fx-stage') || cur.hasAttribute('data-node')) && cur !== document.querySelector('.frame');
      if (isClipHost && (c.overflow === 'hidden' || c.overflowX === 'hidden' || c.overflowY === 'hidden')) {
        const cr = cur.getBoundingClientRect();
        const fullyOutside = r.right <= cr.left + 0.5 || r.left >= cr.right - 0.5 || r.bottom <= cr.top + 0.5 || r.top >= cr.bottom - 0.5;
        if (fullyOutside) { clippedBy = cur.getAttribute('data-node') || 'fx-stage'; break; }
      }
      cur = cur.parentElement;
    }
    if (clippedBy) { issues.push('clipped-by:' + clippedBy); out.summary.clipped++; }
    // z-index / 层级
    const zi = cs.zIndex;
    if (zi !== 'auto' && zi !== '0') out.summary.zIndexed++;
    // 区域归属：节点是否落在参考区域内（regionBox 为 truth 设计 px，相对 section 原点）
    let inRegion = null;
    if (regionBox) {
      const k = window.__qa && window.__qa.scale ? window.__qa.scale() : 1;
      const stage = el.closest('.fx-stage');
      const sr = stage ? stage.getBoundingClientRect() : { left: 0, top: 0 };
      const relL = (r.left - sr.left) / (k || 1), relT = (r.top - sr.top) / (k || 1);
      inRegion = !(relL > regionBox.x + regionBox.w || relL + r.width / (k || 1) < regionBox.x || relT > regionBox.y + regionBox.h || relT + r.height / (k || 1) < regionBox.y);
    }
    const rec = {
      id, visible: vis, w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      zIndex: zi, position: cs.position, overflow: cs.overflow,
      background: cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none' ? 'set' : 'none',
      border: cs.borderWidth !== '0px' ? cs.borderWidth : '0',
      shadow: cs.boxShadow !== 'none' ? 'set' : 'none',
      clipPath: cs.clipPath !== 'none' ? 'set' : 'none',
      inRegion, issues,
    };
    out.nodes.push(rec);
  }
  return out;
};

/**
 * 区域级验收主入口。
 * regions: [{ name, sectionId, nodeId? , box?{x,y,w,h} }]  —— nodeId 优先；box 为 truth 设计 px（相对 section）
 * 返回结构化报告；不写任何实现文件，只写可选的局部截图到 screenshotDir。
 */
export async function runRegionVerify({ demoDir, regions, viewport = { w: 1920, h: 1080 }, prefs = {}, screenshotDir = null, chromeHeadless = true }) {
  const absDemo = resolve(demoDir);
  const truthRaw = JSON.parse(readFileSync(join(absDemo, 'truth.json'), 'utf8'));
  const truth = unwrap(truthRaw);
  const indexHtml = join(absDemo, 'index.html');
  const { browser } = await launchChromium(absDemo, { headless: chromeHeadless });
  const report = { demoDir: absDemo, viewport, generatedAt: new Date().toISOString(), regions: [], ok: true };
  try {
    const page = await browser.newPage({ viewport: { width: viewport.w, height: viewport.h } });
    const consoleErrs = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => consoleErrs.push('pageerror:' + String(e).slice(0, 300)));
    await page.goto('file://' + indexHtml.replace(/\\/g, '/'));
    await page.waitForFunction(() => window.__qa && window.__qa.resize, null, { timeout: 20000 });
    await page.evaluate(({ w, h, prefs }) => {
      window.__qa.resize(w, h);
      if (prefs && window.__qa.prefs) { /* prefs 由壳按 viewport 断点推；此处仅记录 */ }
    }, { w: viewport.w, h: viewport.h, prefs });
    await page.waitForTimeout(700);

    for (const region of regions) {
      const sec = (truth.sections || {})[region.sectionId];
      const rec = { name: region.name || region.sectionId, sectionId: region.sectionId, found: false, diagnosis: null, screenshot: null, errors: [] };
      if (!sec) { rec.errors.push('truth 无此分区 ' + region.sectionId); report.regions.push(rec); report.ok = false; continue; }
      const nodes = arrOf(sec.nodes);
      /* 子树/box 反查必须用 truthRaw 的原始节点——它们的 id 叶子带 provenance.locator，
         unwrap 之后 locator 被剥掉，collectSubtreeIds 会退化成"整分区"。 */
      const secRaw = ((truthRaw.sections || {})[region.sectionId]) || {};
      const rawNodes = arrOf(secRaw.nodes);
      const nidOf = (n) => (n && n.id && n.id.value !== undefined ? n.id.value : (n && n.id !== undefined ? n.id : undefined));
      let nodeIds = null; let regionBox = region.box || null;
      if (region.nodeId) {
        nodeIds = collectSubtreeIds(rawNodes, region.nodeId);
        if (!nodeIds) { rec.errors.push('truth 分区 ' + region.sectionId + ' 内无节点 ' + region.nodeId); report.regions.push(rec); report.ok = false; continue; }
        // 用目标节点的 box 当区域框（truth 设计 px，相对页面，转相对 section）
        const tgt = rawNodes.find((n) => String(nidOf(n)) === String(region.nodeId));
        const tgtBox = tgt && tgt.box ? unwrap(tgt.box) : null;
        if (tgtBox) {
          const sx = sec.meta && sec.meta.x || 0, sy = sec.meta && sec.meta.y || 0;
          regionBox = { x: (tgtBox.x || 0) - sx, y: (tgtBox.y || 0) - sy, w: tgtBox.w || 0, h: tgtBox.h || 0 };
        }
      } else {
        // 无 nodeId：按 box 反查落在该区域内的 truth 节点
        if (!regionBox) { rec.errors.push('region 需给 nodeId 或 box'); report.regions.push(rec); report.ok = false; continue; }
        const sx = sec.meta && sec.meta.x || 0, sy = sec.meta && sec.meta.y || 0;
        nodeIds = rawNodes.filter((n) => {
          const b = n && n.box ? unwrap(n.box) : null;
          if (!b) return false;
          const lx = (b.x || 0) - sx, ly = (b.y || 0) - sy;
          return !(lx > regionBox.x + regionBox.w || lx + (b.w || 0) < regionBox.x || ly > regionBox.y + regionBox.h || ly + (b.h || 0) < regionBox.y);
        }).map(nidOf);
      }
      rec.found = true;
      rec.regionBox = regionBox;
      rec.expectedNodes = nodeIds.length;
      // 结构诊断
      const diag = await page.evaluate(DIAG_FN, { nodeIds, regionBox, secOrigin: null });
      rec.diagnosis = diag.summary;
      rec.nodes = diag.nodes.filter((n) => n.issues && n.issues.length); // 只留有问题的，报告可读
      rec.issueCount = diag.nodes.reduce((a, n) => a + (n.issues ? n.issues.length : 0), 0);
      if (diag.summary.missing > 0 || diag.summary.hidden > 0 || diag.summary.zeroSize > 0) report.ok = false;
      // 局部截图（图证）
      if (screenshotDir && regionBox) {
        try {
          mkdirSync(screenshotDir, { recursive: true });
          /* 截图前把该区域滚进 .frame 视口（.frame 内部滚动），再把 clip 钳到可视区——
             sec 在首屏之下时 stage.boundingBox() 的 y 在视口外，直接 clip 会报 outside image。 */
          await page.evaluate((sid) => { const st = document.querySelector('.frame [data-node="' + sid + '"]'); if (st) st.scrollIntoView({ block: 'start' }); }, region.sectionId);
          await page.waitForTimeout(150);
          const stage = await page.$('.frame [data-node="' + region.sectionId + '"]');
          if (stage) {
            const k = await page.evaluate(() => (window.__qa && window.__qa.scale ? window.__qa.scale() : 1));
            const sb = await stage.boundingBox();
            if (sb) {
              const vw = await page.evaluate(() => window.innerWidth);
              const vh = await page.evaluate(() => window.innerHeight);
              const clip = {
                x: Math.max(0, sb.x + regionBox.x * k), y: Math.max(0, sb.y + regionBox.y * k),
                width: Math.max(1, regionBox.w * k), height: Math.max(1, regionBox.h * k),
              };
              // 钳到可视区，越界即放弃图证（结构诊断仍有效）
              clip.width = Math.min(clip.width, vw - clip.x); clip.height = Math.min(clip.height, vh - clip.y);
              if (clip.width > 2 && clip.height > 2 && clip.x < vw && clip.y < vh) {
                const file = join(screenshotDir, ((region.name || region.sectionId) + '-' + (region.nodeId || 'box')).replace(/[^\w-]+/g, '_') + '.png');
                await page.screenshot({ path: file, clip });
                rec.screenshot = file;
              } else { rec.errors.push('区域不在可视区，跳过图证'); }
            }
          }
        } catch (e) { rec.errors.push('局部截图失败: ' + e.message); }
      }
      report.regions.push(rec);
    }
    if (consoleErrs.length) report.consoleErrors = consoleErrs;
    await page.close();
  } finally {
    await browser.close();
  }
  return report;
}

/* ── 把报告格式化成可操作诊断文本（给 verify/人看）────────────────── */
export function formatRegionReport(report) {
  const L = [];
  L.push('区域级视觉验收 · ' + report.regions.length + ' 区 · viewport ' + report.viewport.w + 'x' + report.viewport.h);
  for (const r of report.regions) {
    if (!r.found) { L.push('  ✗ ' + r.name + '  ' + (r.errors.join('; ') || '未找到')); continue; }
    const d = r.diagnosis || {};
    const bad = (d.missing || 0) + (d.hidden || 0) + (d.zeroSize || 0) + (d.clipped || 0);
    L.push('  ' + (bad ? '✗' : '✓') + ' ' + r.name + '  期望节点 ' + r.expectedNodes + ' · 缺 ' + (d.missing || 0) + ' 隐藏 ' + (d.hidden || 0) + ' 零尺寸 ' + (d.zeroSize || 0) + ' 被裁 ' + (d.clipped || 0) + (r.screenshot ? ' · 图证 ' + r.screenshot : ''));
    for (const n of (r.nodes || [])) L.push('      - ' + n.id + '  ' + (n.issues || []).join(','));
  }
  if (report.consoleErrors && report.consoleErrors.length) L.push('  控制台错误 ' + report.consoleErrors.length + ' 条');
  return L.join('\n');
}
