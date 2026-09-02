import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createSafeStaticServer } from './safe-server.mjs';
import { launchChromium } from './resolve-playwright.mjs';
import {
  classifySemanticText,
  classifyTypographyRange,
  summarizeTypography,
  buildTypographyEvidence,
  buildTranslationChromeEvidence,
  classifyLocaleText,
  classifyTranslationTextRole,
  classifyComponentTextRange,
  assessLocaleConsistency,
  groupUnresolvedCopy,
  assessComponentTextRange,
  assessTextContext,
  groupTypographyFailures,
  classifyTextLayoutIssue,
  buildTextLayoutRepairPlan,
  assessTextLayout,
  fitAuthorization,
  localeFontScale,
  officialTargetDesignSize,
  assessLocaleVisualLevel,
  routeFontFamily,
} from './translation/index.mjs';

const DEFAULT_LANGS = ['zh-CN', 'en', 'ja', 'ko', 'zh-TW'];

function unwrap(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'value' in value && value.provenance) return unwrap(value.value);
  if (Array.isArray(value)) return value.map(unwrap);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unwrap(v)]));
  return value;
}

const isTruthLeaf = (value) => value && typeof value === 'object' && !Array.isArray(value)
  && 'value' in value && value.provenance;
const leafValue = (value) => isTruthLeaf(value) ? value.value : value;
const leafProvenance = (value) => isTruthLeaf(value) ? value.provenance : null;

function parseArgs(argv) {
  const out = { langs: DEFAULT_LANGS.slice(), settleMs: 1300, viewport: { width: 1600, height: 900 } };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--demo') out.demoDir = argv[++i];
    else if (argv[i] === '--langs') out.langs = String(argv[++i] || '').split(',').map((x) => x.trim()).filter(Boolean);
    else if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--wait-ms') out.settleMs = Math.max(0, Number(argv[++i] || 1300));
    else if (argv[i] === '--viewport') {
      const [width, height] = String(argv[++i] || '').split('x').map(Number);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('viewport 必须是 WxH');
      out.viewport = { width, height };
    }
    else throw new Error(`未知参数: ${argv[i]}`);
  }
  if (!out.demoDir) throw new Error('必须给 --demo <dir>');
  return out;
}

export function findTextTruth(truth) {
  const out = new Map();
  const nodes = new Map();
  const textEntries = [];
  const walk = (value, ancestors = []) => {
    if (!value || typeof value !== 'object' || isTruthLeaf(value)) return;
    if (Array.isArray(value)) { for (const item of value) walk(item, ancestors); return; }
    const type = leafValue(value.type);
    const id = leafValue(value.id);
    const name = leafValue(value.name) || '';
    const parentId = leafValue(value.parentId) || null;
    if (id != null && type) nodes.set(String(id), { id: String(id), type, name, parentId });
    if (type === 'TEXT' && id != null) {
      const text = unwrap(value.text || {});
      const explicitAncestors = Array.isArray(value.ancestorNames)
        ? unwrap(value.ancestorNames).filter(Boolean).map(String)
        : [];
      const explicitAncestorTypes = Array.isArray(value.ancestorTypes)
        ? unwrap(value.ancestorTypes).filter(Boolean).map(String)
        : [];
      textEntries.push({
        id: String(id),
        name,
        text,
        characters: leafValue(value.characters) ?? leafValue(value.text?.characters) ?? text.characters ?? '',
        box: unwrap(value.box || null),
        renderBox: unwrap(value.renderBox || null),
        provenance: leafProvenance(value.characters)
          || leafProvenance(value.text?.characters)
          || leafProvenance(value.name)
          || leafProvenance(value.id)
          || null,
        role: leafValue(value.role) || null,
        parentId,
        ancestorTypes: explicitAncestorTypes,
        explicitAncestors,
        pathAncestors: ancestors,
      });
    }
    const next = type && type !== 'TEXT' ? ancestors.concat([{ name, type }]) : ancestors;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'provenance' || key === 'text' || key === 'box' || key === 'renderBox') continue;
      walk(child, next);
    }
  };
  walk(truth);
  for (const entry of textEntries) {
    const names = entry.explicitAncestors.length
      ? entry.explicitAncestors.slice()
      : [...entry.pathAncestors.map((x) => x.name).filter(Boolean)];
    const seen = new Set([entry.id]);
    let parentId = entry.parentId;
    while (parentId && !seen.has(String(parentId))) {
      const parent = nodes.get(String(parentId));
      if (!parent) break;
      seen.add(String(parentId));
      if (parent.name) names.push(parent.name);
      parentId = parent.parentId;
    }
    out.set(entry.id, {
      ...entry,
      /* Preserve duplicate names: two Figma owner siblings may legitimately
         share a name. De-duplicating would change the source owner sequence
         and make the DOM context look wrong even when renderer is faithful. */
      ancestorNames: entry.explicitAncestors.length ? entry.explicitAncestors.slice() : names,
    });
  }
  return out;
}

export async function runTypographyBrowserCheck({ demoDir, langs = DEFAULT_LANGS, timeoutMs = 180000, out = null, settleMs = 1300, viewport = { width: 1600, height: 900 } } = {}) {
  const report = { ok: false, blocked: null, demo: demoDir, languages: langs, viewport, settleMs, records: [], summary: null };
  let server = null;
  let browser = null;
  try {
    server = createSafeStaticServer(demoDir);
    const base = await server.listen();
    ({ browser } = await launchChromium(demoDir, { headless: true }));
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error?.message || error).slice(0, 240)));
    await page.goto(base + '/index.html', { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForFunction(() => typeof window.__qa === 'object' && window.__qa !== null, null, { timeout: timeoutMs });
    await page.evaluate(() => document.fonts?.ready || Promise.resolve());
    if (settleMs > 0) await page.waitForTimeout(settleMs);

    const rawTruth = await page.evaluate(() => {
      const el = document.getElementById('qa-truth');
      return el ? JSON.parse(el.textContent || '{}') : {};
    });
    // Keep raw leaves for provenance and unwrap only individual style/geometry
    // values. Stripping the whole truth first loses source characters and
    // makes browser evidence look detached from Figma.
    const truth = unwrap(rawTruth);
    const textTruth = findTextTruth(rawTruth);
    // Optional fixture-side review metadata. It can classify a known
    // designation/proper noun, but it never provides or changes a translation.
    const designationPath = join(resolve(demoDir), 'copy-designations.json');
    const designationFile = existsSync(designationPath)
      ? JSON.parse(readFileSync(designationPath, 'utf8'))
      : {};
    const designations = {
      ...(designationFile.designations || {}),
      ...(designationFile.deliberatelyUnbound || {}),
    };

    for (const language of langs) {
      const selected = await page.evaluate((lang) => {
        const el = document.querySelector(`[data-qa-pref="lang:${CSS.escape(lang)}"]`);
        if (el) { el.click(); return true; }
        /* The control-bar kit requires languages to use a select so long locale
           lists remain usable. This is the same generic preference seam used by
           replay.mjs, not a demo-specific language selector. */
        const select = document.querySelector('select[data-qa-pref-key="lang"]');
        if (!select || ![...select.options].some((option) => option.value === lang)) return false;
        select.value = lang;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, language);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.evaluate(() => document.fonts?.ready || Promise.resolve());
      if (settleMs > 0) await page.waitForTimeout(settleMs);
      const rows = await page.evaluate(({ __LVL_LANG, __LVL_TABLE }) => {
        const frame = document.querySelector('.frame');
        if (!frame) return { selected: false, rows: [] };
        /* 全局 stage zoom：从带 transform 的统一容器读 matrix scale，对所有文本一致。
           不再从每个 HUG owner 反推（HUG owner 宽随译文长度变，会污染 zoom 致 expectedVisual 算错）。 */
        const __globalZoom = (() => {
  /* stage 真实视觉缩放：frame transform 只是一层（0.7958），文本内部还有 ~0.5 缩放，
     累积才是真实 0.398。直接读 frame matrix 会偏大。改用【固定容器文本】的 owner 反推 zoom
     （rect.width/ownerWidth 对固定 owner 可靠），取中位数作全局参照；HUG owner 随译文长度变，
     单独反推会污染，故 HUG 文本统一用这个全局中位数。 */
  const zs = [];
  for (const el of frame.querySelectorAll('.fx-t[data-node]')) {
    const ar = (el.getAttribute('data-text-autoresize') || '').toUpperCase();
    if (ar === 'WIDTH' || ar === 'WIDTH_AND_HEIGHT') continue; // HUG 跳过
    const ow = el.getAttribute('data-text-owner-width') ? Number(el.getAttribute('data-text-owner-width')) : null;
    const r = el.getBoundingClientRect();
    if (ow && r.width > 0) { const z = r.width / ow; if (Number.isFinite(z) && z > 0.05 && z < 3) zs.push(z); }
  }
  if (!zs.length) return null;
  zs.sort((a, b) => a - b);
  return zs[Math.floor(zs.length / 2)];
})();
        const rows = [];
        for (const el of frame.querySelectorAll('.fx-t[data-node]')) {
          const id = el.getAttribute('data-node');
          const rect = el.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(el);
          const rr = range.getBoundingClientRect();
          // Real browser line evidence, grouped by grapheme rect top.
          const lineMap = new Map();
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          const segmenter = typeof Intl?.Segmenter === 'function'
            ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
          let textNode;
          while ((textNode = walker.nextNode())) {
            const text = textNode.nodeValue || '';
            const segments = segmenter
              ? [...segmenter.segment(text)].map((part) => ({ index: part.index, value: part.segment }))
              : [...Array.from(text)].reduce((out, value, index) => {
                  const previous = out[out.length - 1];
                  out.push({ index: previous ? previous.index + previous.value.length : index, value });
                  return out;
                }, []);
            for (const segment of segments) {
              const one = document.createRange();
              one.setStart(textNode, segment.index);
              one.setEnd(textNode, segment.index + segment.value.length);
              const rect = [...one.getClientRects()].find((item) => item.width > 0 && item.height > 0);
              if (!rect) continue;
              const key = Math.round(rect.top * 10) / 10;
              let line = lineMap.get(key);
              if (!line) { line = { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, count: 0 }; lineMap.set(key, line); }
              line.count += 1;
              line.left = Math.min(line.left, rect.left);
              line.right = Math.max(line.right, rect.right);
              line.bottom = Math.max(line.bottom, rect.bottom);
            }
          }
          const lineRects = [...lineMap.values()].sort((a, b) => a.top - b.top).map((line) => ({ x: line.left, y: line.top, width: line.right - line.left, height: line.bottom - line.top }));
          const lineGraphemeCounts = [...lineMap.entries()].sort((a, b) => a[0] - b[0]).map(([, line]) => line.count);
          const cs = getComputedStyle(el);
          const family = cs.fontFamily || '';
          const weight = cs.fontWeight || '';
          let loaded = null;
          let glyphsMissing = null;
          try {
            loaded = document.fonts?.check(`${weight} 100px ${family}`) ?? null;
            glyphsMissing = document.fonts?.check(`${weight} 100px ${family}`, el.textContent || '') === false ? 1 : 0;
          } catch {}
          const availableWeights = [];
          try {
            for (const face of document.fonts || []) {
              if (String(face.family).replace(/["']/g, '') !== family.replace(/["']/g, '').split(',')[0].trim()) continue;
              /* A variable font face declares a range, e.g. weight "100 900".
                 Reading only the first integer (/\d+/) collapsed it to [100] and
                 falsely reported every requested 400/700 as synthetic-weight. Expand
                 the declared range to the standard CSS weight stops it covers. */
              const nums = (String(face.weight || '').match(/\d+/g) || []).map(Number);
              if (nums.length >= 2) {
                const lo = Math.min(nums[0], nums[1]); const hi = Math.max(nums[0], nums[1]);
                for (let w = 100; w <= 900; w += 100) if (w >= lo && w <= hi) availableWeights.push(w);
              } else if (nums.length === 1) {
                availableWeights.push(nums[0]);
              }
            }
          } catch {}
          rows.push({
            id, name: el.getAttribute('data-node-name') || '', text: el.textContent || '',
            domContext: {
              role: el.getAttribute('data-text-role') || null,
              scene: el.getAttribute('data-text-scene') || null,
              contextKey: el.getAttribute('data-text-context-key') || null,
              ancestorNames: (el.getAttribute('data-text-ancestor-names') || '').split(' > ').filter(Boolean),
              ancestorTypes: (el.getAttribute('data-text-ancestor-types') || '').split(' > ').filter(Boolean),
              parentId: el.getAttribute('data-text-parent-id') || null,
            },
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            range: { x: rr.x, y: rr.y, width: rr.width, height: rr.height },
            lineRects, lineGraphemeCounts, lineCount: lineRects.length,
            wrapped: lineRects.length > 1,
            clientWidth: el.clientWidth, clientHeight: el.clientHeight,
            scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight,
            visible: rect.width > 0 && rect.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity || 1) > 0,
            clipPath: cs.clipPath !== 'none' ? cs.clipPath : null,
            overflow: cs.overflow,
            textOverflow: cs.textOverflow,
            whiteSpace: cs.whiteSpace,
            fitPx: el.getAttribute('data-fit-px') ? Number(el.getAttribute('data-fit-px')) : null,
            localeBaseFontSize: el.getAttribute('data-locale-base-fontsize')
              ? Number(el.getAttribute('data-locale-base-fontsize')) : null,
            fitMaxWidth: el.getAttribute('data-fit-max-width') ? Number(el.getAttribute('data-fit-max-width')) : null,
            fitMaxHeight: el.getAttribute('data-fit-max-height') ? Number(el.getAttribute('data-fit-max-height')) : null,
            fitOverflow: el.getAttribute('data-fit-overflow') === '1',
            fitPolicy: el.getAttribute('data-fit-policy') || null,
            fitGroup: el.getAttribute('data-fit-group') || null,
            fitGroupUnified: el.getAttribute('data-fit-group-unified') || null,
            fitFloor: null,
            fitNeedsReview: el.getAttribute('data-fit-needs-review') || null,
            container: {
              mode: el.getAttribute('data-text-container') || 'framed-fixed',
              sectionWidth: el.getAttribute('data-text-section-width') ? Number(el.getAttribute('data-text-section-width')) : null,
              ownerWidth: el.getAttribute('data-text-owner-width') ? Number(el.getAttribute('data-text-owner-width')) : null,
              ownerEvidence: el.getAttribute('data-text-owner-evidence') || null,
              sourceBoxHeight: el.getAttribute('data-text-source-height') ? Number(el.getAttribute('data-text-source-height')) : null,
              verticalGrowth: el.getAttribute('data-text-vertical-growth') === 'expected',
            },
            copyMissing: el.getAttribute('data-copy-missing'),
            textEmpty: el.getAttribute('data-text-empty') === '1',
            font: { family, computedWeight: Number(weight) || null, loaded, glyphsMissing, availableWeights },
            /* 双真源 locale 校验：把 computed 字号 × stage zoom 得到视觉等效字号，
               与官网实测目标 level 比对（按语义角色×语言）。stage zoom 由 bounding rect
               宽 / owner 设计宽推得；取不到 owner 宽时退回 rect 自身，不强行评估。 */
            localeVisualMeasure: (() => {
              try {
                /* 双真源原始测量：design 字号（computed，含 non-zh 官网目标注入）、字重、
                   stage zoom（owner 宽 / 设计宽推得）、视觉等效字号 = computed × zoom。
                   ratio/target/判定全部由 node 侧 assessLocaleVisualLevel 统一计算，
                   避免 evaluate 内联表与 policy 漂移。取不到 owner 宽时 zoom=null，不强行评估。 */
                const ownerW = el.getAttribute('data-text-owner-width') ? Number(el.getAttribute('data-text-owner-width')) : null;
                const designFs = cs.fontSize ? parseFloat(cs.fontSize) : NaN;
                if (!Number.isFinite(designFs) || designFs <= 0) return { status: 'unmeasured' };
                const ownerZoom = (ownerW && rect.width > 0) ? rect.width / ownerW : null;
                /* 全局 zoom（固定容器中位数）优先；owner 反推仅在没有全局值时兜底。HUG owner 反推不可靠，
                   由 node 侧按 truth autoResize 决定是否信 ownerZoom。这里同时上报两个候选。 */
                const zoom = (Number.isFinite(__globalZoom) && __globalZoom > 0) ? __globalZoom : ownerZoom;
                const visual = (zoom && Number.isFinite(zoom) && zoom > 0) ? designFs * zoom : null;
                const fw = Number(cs.fontWeight) || 400;
                return {
                  status: visual == null ? 'unmeasured' : 'measured',
                  designFontPx: Math.round(designFs * 100) / 100,
                  fontWeight: fw,
                  stageZoom: zoom == null ? null : Math.round(zoom * 1000) / 1000,
                  ownerZoom: ownerZoom == null ? null : Math.round(ownerZoom * 1000) / 1000,
                  globalZoom: Number.isFinite(__globalZoom) ? Math.round(__globalZoom * 1000) / 1000 : null,
                  visualFontPx: visual == null ? null : Math.round(visual * 10) / 10,
                };
              } catch (e) { return { status: 'unmeasured', error: String(e && e.message || e) }; }
            })()
          });
        }
        return { selected: true, rows };
      }, { __LVL_LANG: language, __LVL_RATIO: { title: { en: 0.93, ja: 1, ko: 1, 'zh-TW': 1 }, body: { en: 0.8, ja: 0.8, ko: 0.8, 'zh-TW': 1 } } });
      for (const row of rows.rows) {
        const source = textTruth.get(row.id) || { id: row.id, name: row.name, text: {}, ancestorNames: [] };
        const copyLeaf = rawTruth.copy?.byNode?.[row.id]?.[language] || null;
        const copy = copyLeaf
          ? { status: 'bound', provenance: copyLeaf.provenance || null, value: copyLeaf.value, designation: designations[row.id] || null }
          : { status: 'unresolved', provenance: null, value: null, designation: designations[row.id] || null };
        const semanticClass = classifySemanticText({ name: source.name || row.name, ancestorNames: source.ancestorNames });
        const role = classifyTranslationTextRole({ name: source.name || row.name, ancestorNames: source.ancestorNames });
        const locale = classifyLocaleText({
          language,
          sourceText: source.characters,
          renderedText: row.text,
          copyStatus: copy.status,
          designation: copy.designation,
        });
        /* fitAuthorized mirrors the renderer gate: explicit truncate/clip/FIXED/NONE
           or an explicit fit policy. HEIGHT wrapped text without that permission was
           not shrunk; its vertical growth is natural evidence, not a hard overflow. */
        const arMode = String((source.text && source.text.autoResize) || source.autoResize || 'FIXED').toUpperCase();
        /* fitAuthorized mirrors the renderer's shared policy helper exactly:
           the renderer now stamps the policy *reason* on data-fit-policy, and a
           bounded framed owner is itself an authorized max range. Trust the
           rendered policy attribute first; recompute only as a fallback. */
        /* The renderer stamps data-fit-policy with the shared policy *reason*
           on every framed text node. Trust that rendered decision exactly; the
           only fallback is for explicit truncate/clip, which is unambiguous
           from truth. Do NOT recompute boundedOwner here -- the rendered
           ownerWidth geometry is not reproducible from this evidence, and a
           recomputed value would authorize nodes the renderer never fit. */
        /* Hugging text (WIDTH / WIDTH_AND_HEIGHT) is never fit-shrunk by the
           renderer -- its size follows the content -- so its data-fit-policy
           stamp is descriptive, not an authorization. Treating it as authorized
           would suppress the hugMetricDrift natural-growth verdict and turn a
           few px of browser-vs-Figma line-height rounding into a false overflow. */
        const hugsText = arMode === 'WIDTH' || arMode === 'WIDTH_AND_HEIGHT';
        const renderedPolicyAuthorized = !hugsText
          && typeof row.fitPolicy === 'string'
          && !['preserve-source-metrics', 'open-flow-natural-growth'].includes(row.fitPolicy);
        const fitAuthorized = renderedPolicyAuthorized || fitAuthorization({
          autoResize: arMode,
          truncation: (source.text && source.text.truncation) || source.truncation || null,
          clipsContent: source.clipsContent === true,
          isMask: source.isMask === true,
          openFlow: (row.container && row.container.mode === 'open-flow'),
        }).authorized;
        row.fitAuthorized = fitAuthorized;
        /* 路由后请求字重：非 zh-CN display 文本被 font routing 重路由（en 标题 Alimama 700 -> Bebas 400）。
   把路由后请求字重注入 row.font，让 classifyTypographyRange 据此判 synthetic-weight（400 在 Bebas
   可用字重里 = requested-weight），源 700 仍保留在 source.style 作对照。zh-CN 不重路由，仍用源字重。 */
const __srcFam = leafValue(source.text && source.text.fontFamily) ?? leafValue(source.fontFamily);
const __routed = routeFontFamily({ language, role, semanticClass: role, sourceFamily: __srcFam, sourceWeight: leafValue(source.text && source.text.fontWeight) ?? leafValue(source.fontWeight) });
if (row.font && __routed && Number.isFinite(Number(__routed.weight))) row.font.routedRequestedWeight = Number(__routed.weight);
if (row.font && __routed && __routed.family) row.font.routedFamily = __routed.family;
        const component = classifyComponentTextRange({ role, truth: source, browser: row, language, semanticClass: role });
        // Ancestor names are evidence context, not a component ownership key.
        // Without a truth parentId the overlap remains explicitly unscoped.
        const componentKey = source.parentId || null;
        /* 全链路 locale 视觉字号诊断：source px(Figma) × 语言比 × stageZoom = 期望视觉；
           对比浏览器实测视觉。仅诊断、不进 pass/fail；缺数据明确 unverified/unmeasured。 */
        const __srcFs = leafValue(source.text && source.text.fontSize) ?? leafValue(source.fontSize);
        const __srcFw = leafValue(source.text && source.text.fontWeight) ?? leafValue(source.fontWeight);
        const __m = row.localeVisualMeasure || {};
        const localeVisualLevel = assessLocaleVisualLevel({
          role,
          language,
          fontWeight: Number.isFinite(Number(__srcFw)) ? Number(__srcFw) : (Number.isFinite(Number(__m.fontWeight)) ? Number(__m.fontWeight) : 400),
          sourceFontSize: Number.isFinite(Number(__srcFs)) ? Number(__srcFs) : null,
          stageZoom: __m.stageZoom ?? null,
          visualFontPx: __m.visualFontPx ?? null,
          copyStatus: copy.status,
          fitScale: Number.isFinite(Number(row.fitPx)) ? Number(row.fitPx) : null,
        });
        const layout = classifyTextLayoutIssue({ truth: source, browser: row, semanticClass: role, role });
        const layoutPlan = buildTextLayoutRepairPlan({ truth: source, browser: row, semanticClass: role, role, issue: layout });
        const evidence = buildTypographyEvidence({
          nodeId: row.id,
          name: source.name || row.name,
          truth: source,
          browser: row,
          language,
          semanticClass,
          copy,
          locale,
          component,
          componentKey,
        });
        report.records.push({
          ...evidence,
          ...evidence.classification,
          text: row.text,
          selected,
          sourceText: source.characters,
          context: {
            parentId: source.parentId || null,
            ancestorNames: source.ancestorNames || [],
            ancestorTypes: source.ancestorTypes || [],
            role,
            scene: role === 'nav' ? 'nav' : role === 'activity-calendar' ? 'activity' : 'content',
            dom: row.domContext,
            domMatchesTruth: row.domContext.role === role
              && JSON.stringify(row.domContext.ancestorNames) === JSON.stringify(source.ancestorNames || []),
          },
          role,
          copy: { ...evidence.copy, designation: copy.designation, expectedValue: copy.value, domUsesExpectedValue: copy.value == null ? null : row.text === copy.value },
          renderer: { copyMissing: row.copyMissing, textEmpty: row.textEmpty },
          localeVisualLevel,
          layout,
          layoutPlan,
        });
      }
    }
    report.summary = summarizeTypography(report.records);
    report.summary.failureGroups = groupTypographyFailures(report.records);
    report.locale = assessLocaleConsistency(report.records);
    report.locale.unresolved = report.locale.unresolved || groupUnresolvedCopy(report.records);
    report.component = assessComponentTextRange(report.records);
    report.context = assessTextContext(report.records);
    report.layout = assessTextLayout(report.records);
    report.gates = {
      typography: { ok: report.summary.failed === 0, summary: report.summary },
      locale: report.locale,
      component: report.component,
      context: report.context,
      layout: report.layout,
    };
    report.evidence = buildTranslationChromeEvidence({
      demo: demoDir,
      language: 'multi',
      records: report.records,
      gates: report.gates,
    });
    report.pageErrors = errors;
    report.ok = errors.length === 0 && report.records.length > 0
      && report.gates.typography.ok && report.gates.locale.ok && report.gates.component.ok && report.gates.layout.ok;
  } catch (error) {
    report.blocked = String(error?.message || error);
    report.ok = false;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
  }
  if (out) writeFileSync(resolve(out), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && process.argv[1].endsWith('figma-typography-browser-check.mjs')) {
  try {
    const args = parseArgs(process.argv);
    const report = await runTypographyBrowserCheck(args);
    process.exit(report.ok ? 0 : report.blocked ? 2 : 1);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
    process.exit(2);
  }
}
