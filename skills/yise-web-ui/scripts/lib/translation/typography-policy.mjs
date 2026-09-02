// Reusable translation-skill typography policy.
// Figma text style and box data remain the source of visual truth; language
// only selects diagnostics and fallback candidates, never arbitrary CSS.

export {
  TEXT_SEMANTIC_CLASSES,
  normalizeLanguage,
  scriptsForText,
  isTextHugging,
  isTruncating,
  classifySemanticText,
  classifyFontWeight,
  classifyTypographyRange,
  classifyTextContainerConstraint,
  summarizeTypography,
  groupTypographyFailures,
} from '../figma-typography.mjs';

import { normalizeLanguage, scriptsForText, classifyFontWeight, fitAuthorization as fitAuthorizationCore } from '../figma-typography.mjs';
import { routeFontFamily } from './font-routing.mjs';
import { DESIGN_POLICY } from '../design-policy.generated.mjs';

export { DESIGN_POLICY };
const SHRINK_STEPS = DESIGN_POLICY.shrinkSteps;
const SHRINK_FLOOR = DESIGN_POLICY.shrinkFloorPercent;
const TIER_RULES = DESIGN_POLICY.tierRules;

export function fitAuthorization(args = {}) {
  return fitAuthorizationCore({
    ...args,
    hugNoShrink: args.hugNoShrink ?? DESIGN_POLICY.hugNoShrink,
    openFlowNoShrink: args.openFlowNoShrink ?? DESIGN_POLICY.openFlowNoShrink,
  });
}

const GENERIC_FALLBACKS = Object.freeze({
  latin: ['sans-serif'],
  zh: ['sans-serif'],
  ja: ['sans-serif'],
  ko: ['sans-serif'],
  other: ['sans-serif'],
});

function cleanFamily(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

export function normalizeFontFamilies(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(values.map(cleanFamily).filter(Boolean))];
}

/**
 * Return an auditable candidate order. This does not silently replace the
 * requested Figma family; a missing requested family/weight stays a gap.
 */
export function buildFontFallbackPolicy({ language = 'unknown', requestedFamily = '', fallbackFamilies = [], availableFamilies = [] } = {}) {
  const normalizedLanguage = normalizeLanguage(language);
  const scripts = normalizedLanguage === 'ja' ? ['ja']
    : normalizedLanguage === 'ko' ? ['ko']
      : normalizedLanguage === 'zh-CN' || normalizedLanguage === 'zh-TW' ? ['zh']
        : normalizedLanguage === 'en' ? ['latin']
          : scriptsForText(language === 'unknown' ? '' : language);
  const requested = normalizeFontFamilies(requestedFamily);
  const configured = normalizeFontFamilies(fallbackFamilies);
  const available = new Set(normalizeFontFamilies(availableFamilies).map((x) => x.toLowerCase()));
  const candidates = [...requested, ...configured, ...scripts.flatMap((script) => GENERIC_FALLBACKS[script] || GENERIC_FALLBACKS.other)];
  const ordered = [...new Set(candidates)];
  const requestedAvailable = requested.length === 0 ? null : requested.some((family) => available.has(family.toLowerCase()));
  return {
    language: normalizedLanguage,
    requested,
    candidates: ordered,
    requestedAvailable,
    status: requestedAvailable === false ? 'requested-family-unavailable' : requestedAvailable === true ? 'requested-family-available' : 'unverified',
    requiresReview: requestedAvailable === false,
  };
}

/**
 * Keep requested weight as truth while making language-specific readiness
 * evidence explicit. No fallback weight is substituted here.
 */
export function buildFontWeightPolicy({ language = 'unknown', requestedWeight = 400, availableWeights = [], loaded = true, computedWeight = null } = {}) {
  const normalizedLanguage = normalizeLanguage(language);
  const classification = classifyFontWeight({ requestedWeight, availableWeights, loaded, computedWeight });
  return {
    language: normalizedLanguage,
    requestedWeight: classification.requested,
    availableWeights: classification.available,
    status: classification.status,
    synthetic: classification.synthetic,
    requiresReview: classification.status !== 'requested-weight',
    classification,
  };
}

export function classifyAutoResize({ autoResize, browser = {} } = {}) {
  const mode = String(autoResize || 'FIXED').toUpperCase();
  const horizontalHug = mode === 'WIDTH' || mode === 'WIDTH_AND_HEIGHT';
  const verticalHug = mode === 'HEIGHT' || mode === 'WIDTH_AND_HEIGHT';
  const widthOverflow = Number(browser.scrollWidth) > Number(browser.clientWidth) + 0.5;
  const heightOverflow = Number(browser.scrollHeight) > Number(browser.clientHeight) + 0.5;
  return {
    mode,
    horizontalHug,
    verticalHug,
    widthOverflow,
    heightOverflow,
    status: widthOverflow && !horizontalHug || heightOverflow && !verticalHug ? 'range-overflow' : 'fit-or-wrap',
  };
}


/* 组级排版：同一组件组的同级标题/正文应统一字号/排版等级，而不是逐节点独立
   step-fit（真实产品线五语言实测基线：02 奖励卡标题组、正文组、角色名组、
   06 列表组全部组内同字号，最长项折行也不单独缩小；私有证据，见 artifacts/）。
   组标识 = 最内层容器祖先（ancestorNames 末项）+ 语义角色 + 源字号：同级组
   共享同一个最内层组件容器，文案/节点 id 不参与，组件嵌套深度不一也不影响。 */
export function buildFitGroupKey({ ancestorNames = [], parentName = '', role = '', fontSize = null } = {}) {
  /* 同级同位文本（各卡的标题位、各卡的正文位）共享同一个直接父容器名
     （如 02 奖励卡标题槽、03 特别活动标题槽都复用同一个 Figma 组件 Frame 名）。
     直接父容器名比 ancestorNames 末项稳：末项可能是节点自身或更深层包装，
     而同一组件位的兄弟其直接父容器同名。文案/节点 id 不参与。parentName 缺失
     时退回 ancestorNames 末项（旧行为）。 */
  const direct = String(parentName || '').trim();
  const names = Array.isArray(ancestorNames) ? ancestorNames.map((a) => String(a || '')).filter(Boolean) : [];
  const fallback = names.length ? names[names.length - 1] : '';
  const container = direct || fallback;
  return container + '|' + String(role || '') + '|' + String(fontSize ?? '');
}

/* 组级最小统一字号（required-scale）：官网实证同一组件组标题/正文统一字号，
   最长/最严格成员决定全组等级，其余兄弟跟随。与 unifyGroupFitScales（只合并
   "已经被缩"的成员）不同，这里输入组内每个成员"在源字号下是否溢出/所需 scale"，
   取最严格（最小）值统一应用全组 —— 包括本来不缩的短项。
   members: [{ key, requiredScale }]  requiredScale=100 表示源字号刚好放下，<100 表示需缩。
   规则：组内取 min；若 min>=100（没有任何成员溢出）则全组保持源字号（不动，
   保住 zh-CN 保真与本就合适的语言）；只有确有成员溢出才统一降组。
   返回 Map(member -> { scale, unified, groupSize, trigger })。 */
export function computeGroupRequiredScales(members = []) {
  const groups = new Map();
  for (const m of members) {
    if (!m || !m.key) continue;
    if (!groups.has(m.key)) groups.set(m.key, []);
    groups.get(m.key).push(m);
  }
  const out = new Map();
  for (const [key, list] of groups) {
    if (list.length < 2) { for (const m of list) out.set(m, { scale: null, unified: false, groupSize: 1, trigger: 'single' }); continue; }
    const scales = list.map((m) => Number.isFinite(Number(m.requiredScale)) ? Number(m.requiredScale) : 100);
    const minScale = Math.min(...scales);
    const anyOverflow = scales.some((s) => s < 100);
    if (!anyOverflow) { for (const m of list) out.set(m, { scale: null, unified: false, groupSize: list.length, trigger: 'all-fit-source' }); continue; }
    for (const m of list) out.set(m, { scale: minScale, unified: true, groupSize: list.length, trigger: 'strictest-member' });
  }
  return out;
}

/* A fixed, single-line title slot is already the source-backed safe content
   range.  For localized siblings, preserve at least the breathing room held
   by the widest source sibling: the source glyph width is the ceiling, never
   an invented padding percentage.  The longest translated sibling chooses a
   discrete shared scale for the whole component group. */
export function computeSourceAnchoredInlineFit({ sourceWidths = [], targetWidths = [], slotWidths = [], steps = SHRINK_STEPS } = {}) {
  const finite = (values) => (Array.isArray(values) ? values : [])
    .map(Number).filter((value) => Number.isFinite(value) && value > 0);
  const source = finite(sourceWidths);
  const target = finite(targetWidths);
  const slots = finite(slotWidths);
  if (!source.length || !target.length || !slots.length) {
    return { status: 'unmeasured', scale: null, safeInlineWidth: null, requiredScale: null };
  }
  const sourceMax = Math.max(...source);
  const slotLimit = Math.min(...slots);
  const safeInlineWidth = Math.min(sourceMax, slotLimit);
  const targetMax = Math.max(...target);
  const requiredScale = Math.min(100, safeInlineWidth / targetMax * 100);
  if (requiredScale >= 99.5) {
    return { status: 'fits-source-safe-width', scale: null, safeInlineWidth, sourceMax, slotLimit, targetMax, requiredScale: 100 };
  }
  const orderedSteps = [...new Set(finite(steps))].sort((a, b) => b - a);
  const scale = orderedSteps.find((step) => step <= requiredScale + 0.5) || orderedSteps[orderedSteps.length - 1] || null;
  return {
    status: scale != null && scale > requiredScale + 0.5 ? 'floor-exceeded' : 'step-fit',
    scale,
    safeInlineWidth,
    sourceMax,
    slotLimit,
    targetMax,
    requiredScale,
  };
}

/* 组级统一 scale：组内兄弟各自 step-fit 出不同档时，统一应用最严格（最小）值。
   只统一"被缩过的多元素组"，不碰未缩节点、不动单元素组。返回每个成员最终 scale。 */
export function unifyGroupFitScales(members = []) {
  // members: [{ key, scale }]  scale 为 null 表示未缩
  const groups = new Map();
  for (const m of members) {
    if (!m || !m.key || m.scale == null) continue;
    if (!groups.has(m.key)) groups.set(m.key, []);
    groups.get(m.key).push(m);
  }
  const out = new Map();
  for (const [key, list] of groups) {
    if (list.length < 2) { for (const m of list) out.set(m, { scale: m.scale, unified: false }); continue; }
    const minScale = Math.min(...list.map((m) => Number(m.scale)));
    const distinct = new Set(list.map((m) => Number(m.scale)));
    const uniform = distinct.size <= 1;
    for (const m of list) out.set(m, { scale: minScale, unified: !uniform && Number(m.scale) !== minScale, groupSize: list.length });
  }
  return out;
}

/* ── 双真源 typography（2026-08-10 用户最终决策）──────────────────────────
   zh-CN：严格遵守 Figma 静态视觉指标（字号/行高/几何），是唯一静态视觉真源。
   非 zh-CN 翻译语言：以 Figma owner/位置/组件结构为底，但组级视觉等级遵守从
   真实产品线实测归纳的通用 locale typography 逻辑。理由：未来只提供简中
   Figma，需复用已上线的翻译排版策略。

   证据来源：真实产品线五语言 Chrome 实测基线（1920×1080，2026-08-10；私有证据，
   见 artifacts/），跨 02 奖励卡、03 特别活动卡、角色名、06 列表等多个组件组，
   按语义角色归纳，不对文案/节点 ID 硬编码。

   关键实证：本地是 2× 高清稿（标题源 60px、正文源 30px），经 stage zoom≈0.398
   缩放后的视觉字号已与线上对齐（标题 60×0.398≈24≈线上25、正文 30×0.398≈12=
   线上12）。因此本策略不是盲目缩放源字号，而是**声明各角色/语言的线上目标
   视觉等效字号，并校验渲染是否达成**。 */

/* locale 字号缩放比（相对 zh-CN Figma 源字号）——**默认基线数据**。证据
   artifacts/official-locale-typography-20260810.json（私有）。
   模型：本地是 2× 高清稿，线上运行时布局约为一半，故线上视觉字号 × 2 = 本地
   设计坐标字号；而同一角色的 zh-CN 线上视觉值 × 2 = Figma zh-CN 源字号。两者
   相除得"相对 zh-CN 源字号的语言比"，可作用于任意源字号档（60 标题、40 副标、
   30 正文通用），不对绝对像素/文案硬编码。
   实测结论：标题各语言同级（ratio 1.0，en 因拉丁略 0.93）；正文 ja/en/ko = zh
   的 0.8（12/15），zh-TW 与 zh-CN 同级（1.0）。未收录角色/语言回退 1（不动、不猜）。
   适用范围：本表来自单一产品线的实测归纳，作为通用默认生效；其它产品线可经
   localeFontScale({ overrides }) 注入自有实测表（同构 { tier: { lang: ratio } }），
   未提供的组合回退本表、再回退 1。 */
/* 双真源 locale 缩放：zh-CN 恒 1（保 Figma 静态指标）。非 zh-CN 结构/owner/位置仍按 Figma，
   视觉字号/字重/行高按实测基线的通用语言规则。同一 fontWeight 的标题按【源字号档】
   走不同缩放——卡片标题(源60档) ja/zh-TW 0.833、en/ko 1.0；角色技能标题(源25档)全语言 1.0。
   故必须按 tier × language 二维查表，不能只用 fontWeight 分 title/body。
   证据 artifacts/official-tier-ratio-20260810.json（同组件跨语言视觉比，stage-invariant；私有）。
   值 = 线上该语言视觉字号 / 线上 zh-CN 视觉字号（本地 2× 高清稿，同比例作用于任意 Figma 源档）。
   未收录 tier/语言回退 1（不动、不猜）。en 标题字重被 font routing 压 400 是字体缺口，不在此表。 */
/* 默认基线数据表（来源与适用范围见上;其它产品线可经 localeFontScale({ overrides }) 覆写）。 */
export const LOCALE_FONT_SCALE = DESIGN_POLICY.localeFontScale;

/* 由 Figma 源 fontWeight + 源字号推出官网缩放档（tier）。这是"源字号档"维度的分类器，
   解决同 fontWeight=700 的标题在官网分属不同缩放档的问题。不按文案/node/section 特判。 */
export function classifySourceSizeTier({ fontWeight = 400, sourceFontSize = null } = {}) {
  if (Number(fontWeight) < TIER_RULES.bodyMaxWeightExclusive) return 'body';
  const src = Number(sourceFontSize);
  /* 卡片标题档：源 > YAML cardTitleMinSourcePxExclusive 的粗体大标题。 */
  if (Number.isFinite(src) && src > TIER_RULES.cardTitleMinSourcePxExclusive) return 'card-title';
  /* 技能/小节标题档：源 <= 40 的粗体（角色技能标题源25、列表小标题）。官网全语言同级。 */
  return 'heading';
}

/* The contract exposes the page-text roles that a translation sheet can name.
   They deliberately share the source-weight buckets above: the available
   official capture proves title/body ratios across components, not a separate
   per-string pixel rule. `coverage` prevents that useful generalisation from
   being reported as role-specific browser proof. */
export const LOCALE_LAYOUT_ROLE_MATRIX = Object.freeze({
  title: Object.freeze({ bucket: 'source-weight', wrap: 'owner-driven', coverage: 'official-title-body-pattern' }),
  button: Object.freeze({ bucket: 'source-weight', wrap: 'bounded-or-hug-owner', coverage: 'official-title-body-pattern' }),
  body: Object.freeze({ bucket: 'source-weight', wrap: 'owner-driven', coverage: 'official-title-body-pattern' }),
  nav: Object.freeze({ bucket: 'source-weight', wrap: 'bounded-or-hug-owner', coverage: 'official-title-body-pattern' }),
  status: Object.freeze({ bucket: 'source-weight', wrap: 'bounded-or-hug-owner', coverage: 'official-title-body-pattern' }),
  list: Object.freeze({ bucket: 'source-weight', wrap: 'owner-driven', coverage: 'official-title-body-pattern' }),
  calendar: Object.freeze({ bucket: 'source-weight', wrap: 'owner-driven', coverage: 'official-title-body-pattern' }),
  'card-description': Object.freeze({ bucket: 'source-weight', wrap: 'owner-driven', coverage: 'official-title-body-pattern' }),
});

export function localeLayoutRolePolicy(role = 'body') {
  return LOCALE_LAYOUT_ROLE_MATRIX[role] || Object.freeze({ bucket: 'source-weight', wrap: 'review-required', coverage: 'unverified-role' });
}

/* 由 role + fontWeight 推出官网类别（title/body）。标题/正文可能同 role
   （如 heading-content-card 下标题 700、正文 400），故用字重分流，不按文案/node。 */
export function officialTypeKind({ role = 'unknown', fontWeight = 400 } = {}) {
  return Number(fontWeight) >= TIER_RULES.bodyMaxWeightExclusive ? 'title' : 'body';
}

/* non-zh-CN 翻译语言的官方目标缩放比。zh-CN 恒 1（保 Figma 静态指标）；
   未收录回退 1（不动、不猜）。 */
export function localeFontScale({ role = 'unknown', language = 'zh-CN', fontWeight = 400, sourceFontSize = null, overrides = null, allowOverrides = false } = {}) {
  const lang = normalizeLanguage(language);
  if (lang === 'zh-CN') return 1;
  const tier = classifySourceSizeTier({ fontWeight, sourceFontSize });
  /* Production page-making must not bypass YAML. Tests may pass allowOverrides. */
  if (allowOverrides === true) {
    const custom = overrides?.[tier]?.[lang];
    if (Number.isFinite(custom)) return custom;
  }
  const row = LOCALE_FONT_SCALE[tier];
  const v = row ? row[lang] : null;
  return Number.isFinite(v) ? v : 1;
}

/* non-zh-CN 的官方目标设计字号：Figma zh-CN 源字号 × 语言比。行高同比缩放保 leading。
   zh-CN 返回源字号不动。renderer 设定 non-zh-CN 基准字号的唯一入口。 */
export function officialTargetDesignSize({ sourceFontSize, sourceLineHeight = null, role = 'unknown', language = 'zh-CN', fontWeight = 400 } = {}) {
  const src = Number(sourceFontSize);
  if (!Number.isFinite(src) || src <= 0) return null;
  const lang = normalizeLanguage(language);
  const tier = classifySourceSizeTier({ fontWeight, sourceFontSize: src });
  const ratio = localeFontScale({ role, language: lang, fontWeight, sourceFontSize: src });
  const fontSize = src * ratio;
  /* 行高：默认同比缩放保 leading；但官网对 ja/zh-TW 的卡片标题档把行高收紧到≈字号（1.0×），
     与 zh 的 1.2× 不同。仅 card-title 档 ja/zh-TW 应用收紧，其余按源行高同比。 */
  let lineHeight = Number.isFinite(Number(sourceLineHeight)) && Number(sourceLineHeight) > 0 ? Number(sourceLineHeight) * ratio : null;
  if (tier === 'card-title' && (lang === 'ja' || lang === 'zh-TW')) lineHeight = fontSize;
  return { fontSize, lineHeight, ratio, tier, kind: tier === 'body' ? 'body' : 'title', role, language: lang };
}
export function assessLocaleVisualLevel({ role = 'unknown', language = 'zh-CN', fontWeight = 400, sourceFontSize = null, stageZoom = null, visualFontPx = null, tolerance = 1.5, copyStatus = null, fitScale = null } = {}) {
  /* 完整可审计诊断：source px → 语言比 → 期望视觉（源×比×stageZoom）→ 实测视觉 → on/off。
     仅诊断，不进 pass/fail gate；未知/缺数据一律 unverified/unmeasured，不假绿。 */
  const lang = normalizeLanguage(language);
  /* 非 zh-CN 缺真实译文时该节点仍是 zh-CN 源视觉，不是目标语言排版失败；
     标 unverified-no-locale-copy，不计入 off-target，也不假绿。 */
  if (lang !== 'zh-CN' && copyStatus === 'unresolved') {
    return { status: 'unverified-no-locale-copy', ok: null, reason: 'no-locale-copy', role, language: lang, fontWeight };
  }
  const kind = officialTypeKind({ role, fontWeight });
  const ratio = localeFontScale({ role, language: lang, fontWeight, sourceFontSize: sourceFontSize });
  const src = Number(sourceFontSize);
  const zoom = Number(stageZoom);
  if (!Number.isFinite(src) || src <= 0) return { status: 'unverified', reason: 'no-source-font-size', kind, ratio };
  if (!Number.isFinite(zoom) || zoom <= 0) return { status: 'unmeasured', reason: 'no-stage-zoom', kind, ratio, sourceFontSize: src };
  /* group-fit 二次缩放：renderer 对有界溢出组做最严格统一（data-fit-scale<100），这是合法的容器适配，
     不是排版错。expected 必须把它算进去，否则 ja/ko 长译文触发的组级统一会被误判 off-target。 */
  const __fit = Number(fitScale);
  const fitFactor = (Number.isFinite(__fit) && __fit > 0 && __fit < 100) ? __fit / 100 : 1;
  const expectedVisual = src * ratio * fitFactor * zoom;
  const actual = Number(visualFontPx);
  if (!Number.isFinite(actual)) return { status: 'unmeasured', reason: 'no-visual', kind, ratio, sourceFontSize: src, stageZoom: zoom, expectedVisual: Math.round(expectedVisual * 10) / 10 };
  const ok = Math.abs(actual - expectedVisual) <= tolerance;
  return { status: ok ? 'on-target' : 'off-target', ok, kind, ratio, groupFitScale: fitFactor, sourceFontSize: src, stageZoom: Math.round(zoom * 1000) / 1000, expectedVisual: Math.round(expectedVisual * 10) / 10, actualVisual: Math.round(actual * 10) / 10 };
}

/**
 * Locale translation layout contract for the common "zh-CN Figma + copy table"
 * workflow. It is intentionally node/string agnostic: Figma supplies owner and
 * geometry; the locale policy only supplies font, visual-size and fit decisions.
 *
 * A contract is a plan, not a claim that the target-language rendering passed.
 * Callers must attach real-browser evidence through `targetEvidence` before
 * treating a non-zh-CN target as observed.
 */
export function buildLocaleTranslationLayoutContract({
  source = {},
  owner = {},
  translation = null,
  language = 'zh-CN',
  role = 'unknown',
  semanticClass = null,
  stageZoom = null,
  targetEvidence = null,
} = {}) {
  const lang = normalizeLanguage(language);
  const rolePolicy = localeLayoutRolePolicy(role);
  const text = source.text || source;
  const sourceFontSize = Number(text.fontSize);
  const sourceLineHeight = Number(text.lineHeight);
  const sourceWeight = Number(text.fontWeight) || 400;
  const sourceFamily = text.fontFamily || text.font || null;
  const hasTargetCopy = lang === 'zh-CN' || (translation && typeof translation.text === 'string' && translation.text.trim() !== '');
  const copyStatus = hasTargetCopy ? 'resolved' : 'unresolved';
  const font = routeFontFamily({ language: lang, role, semanticClass, sourceFamily, sourceWeight });
  const target = officialTargetDesignSize({
    sourceFontSize, sourceLineHeight, role, language: lang, fontWeight: sourceWeight,
  });
  const resize = classifyAutoResize({ autoResize: text.autoResize, browser: {} });
  const groupKey = buildFitGroupKey({
    ancestorNames: owner.ancestorNames || source.ancestorNames || [], parentName: owner.parentName || source.parentName || '',
    role, fontSize: sourceFontSize,
  });
  const bounded = owner.bounded === true || owner.clipsContent === true || owner.mode === 'framed-fixed';
  const openFlow = owner.openFlow === true || owner.mode === 'open-flow';
  const wrapPolicy = lang === 'zh-CN'
    ? { mode: 'figma-exact', preserveSourceMetrics: true, preserveSourceBreaks: true, groupFit: 'none' }
    : !hasTargetCopy
      ? { mode: 'blocked-no-copy', preserveSourceMetrics: true, groupFit: 'none' }
      : openFlow
        ? { mode: 'natural-wrap-grow', preserveSourceMetrics: false, groupFit: 'shared-required-scale' }
        : resize.horizontalHug || resize.verticalHug
          ? { mode: 'hug-owner-growth', preserveOwnerStructure: true, groupFit: 'shared-required-scale' }
          : bounded
            ? { mode: 'bounded-group-step-fit', floorPercent: SHRINK_FLOOR, groupFit: 'shared-required-scale' }
            : { mode: 'wrap-review-required', groupFit: 'shared-required-scale' };
  const zoom = Number(stageZoom);
  const visual = target && Number.isFinite(zoom) && zoom > 0
    ? { stageZoom: zoom, targetFontPx: target.fontSize * zoom, targetLineHeightPx: target.lineHeight == null ? null : target.lineHeight * zoom,
      status: 'derived-from-source-and-stage-zoom' }
    : { stageZoom: Number.isFinite(zoom) ? zoom : null, targetFontPx: null, targetLineHeightPx: null, status: 'unmeasured-stage-zoom' };
  const evidenceStatus = lang === 'zh-CN'
    ? 'figma-source-exact'
    : !hasTargetCopy
      ? 'unverified-no-locale-copy'
      : targetEvidence?.status === 'observed-current-target'
        ? 'observed-current-target'
        : 'official-pattern-derived-needs-browser-evidence';
  return {
    schema: 'zh-figma-locale-layout-contract/v1', language: lang, role, semanticClass,
    copy: hasTargetCopy ? { status: copyStatus, text: lang === 'zh-CN' ? (text.characters ?? source.characters ?? null) : translation.text } : { status: copyStatus, text: null },
    source: { fontFamily: sourceFamily, fontWeight: sourceWeight, fontSize: Number.isFinite(sourceFontSize) ? sourceFontSize : null, lineHeight: Number.isFinite(sourceLineHeight) ? sourceLineHeight : null, autoResize: resize.mode, box: source.box || null },
    output: { font, targetDesign: target, targetVisual: visual, owner: { preserveFigmaOwner: true, clipsContent: owner.clipsContent === true, mode: owner.mode || null }, wrap: wrapPolicy, groupKey, rolePolicy },
    evidence: { status: evidenceStatus, coverage: rolePolicy.coverage, targetEvidence: targetEvidence || null, requiresBrowserValidation: lang !== 'zh-CN' && evidenceStatus !== 'observed-current-target' },
  };
}
