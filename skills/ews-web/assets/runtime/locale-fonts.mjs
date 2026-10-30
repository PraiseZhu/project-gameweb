/**
 * Locale font mapping. Source locale keeps Figma family/weight.
 * Non-source locales remap only TEXT that actually paints a table translation.
 * Unbound / no-row / original-keep nodes keep the designed family and weight.
 * English display vs body uses node role / designed family, never characters.
 */
import { isFigmaSourceLocale } from './text-style.mjs';

export const LOCALE_FONTS_SCHEMA = 'ews-locale-fonts/v1';
export const DEFAULT_DISPLAY_FAMILIES = Object.freeze(['Alimama ShuHeiTi', 'Bebas Neue']);
const USABLE_COPY = new Set(['designated', 'exact', 'normalized', 'joined-heading']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function hasBtnAncestor(node, byId) {
  let current = node;
  const seen = new Set();
  while (current?.parentId && !seen.has(String(current.parentId))) {
    seen.add(String(current.parentId));
    current = byId?.get?.(String(current.parentId));
    if (!current) break;
    if (current.role === 'btn') return true;
    if (/^btn[/／]/.test(String(current.name || ''))) return true;
  }
  return false;
}

export function nearestRegisteredWeight(want, weights) {
  const list = asArray(weights).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 1000);
  const n = Number(want);
  const target = Number.isFinite(n) ? n : 400;
  if (!list.length) return target;
  if (list.includes(target)) return target;
  return list.reduce((best, item) => (Math.abs(item - target) < Math.abs(best - target) ? item : best));
}

export function paintsTranslatedCopy(node, locale, sourceLocale) {
  if (isFigmaSourceLocale(locale, sourceLocale)) return false;
  const copy = node?.copy;
  if (!copy) return false;
  const kind = copy.matchKind ?? copy.kind ?? null;
  if (!USABLE_COPY.has(kind)) return false;
  const leaf = copy.translations?.[locale];
  if (leaf == null) return false;
  const value = typeof leaf === 'object' ? leaf.value : leaf;
  return value != null && String(value) !== '';
}

export function classifyFontSlot(node, byId, plan) {
  if (hasBtnAncestor(node, byId)) {
    return { slot: 'display', reason: 'ancestor-role-btn' };
  }
  const family = String(node?.text?.fontFamily || '');
  const display = new Set(asArray(plan?.displaySourceFamilies).length
    ? plan.displaySourceFamilies
    : DEFAULT_DISPLAY_FAMILIES);
  if (display.has(family)) {
    return { slot: 'display', reason: 'designed-family' };
  }
  return { slot: 'body', reason: 'default-body' };
}

export function resolveLocaleFont(node, {
  locale,
  sourceLocale,
  byId,
  plan,
} = {}) {
  const designedFamily = String(node?.text?.fontFamily || 'sans-serif');
  const designedWeight = Number.isFinite(Number(node?.text?.fontWeight)) ? Number(node.text.fontWeight) : 400;
  const designed = {
    family: designedFamily,
    weight: designedWeight,
    slot: 'source-designed',
    reason: 'source-designed',
  };
  if (!plan || plan.schema !== LOCALE_FONTS_SCHEMA) {
    return { ...designed, reason: 'no-plan' };
  }
  if (isFigmaSourceLocale(locale, sourceLocale)) {
    return designed;
  }
  if (!paintsTranslatedCopy(node, locale, sourceLocale)) {
    return { ...designed, reason: 'original-keep' };
  }
  const rule = plan.byLocale?.[locale];
  if (!rule || rule.mode === 'source') {
    return { ...designed, reason: rule ? 'locale-source' : 'locale-unmapped' };
  }
  if (rule.mode === 'all' && rule.family) {
    return {
      family: rule.family,
      weight: nearestRegisteredWeight(designedWeight, rule.weights),
      slot: 'locale-all',
      reason: 'locale-all',
    };
  }
  if (rule.mode === 'slots') {
    const classified = classifyFontSlot(node, byId, plan);
    const target = rule[classified.slot] || rule.body;
    if (!target?.family) {
      return { ...designed, slot: classified.slot, reason: 'slot-missing' };
    }
    return {
      family: target.family,
      weight: nearestRegisteredWeight(designedWeight, target.weights),
      slot: classified.slot,
      reason: classified.reason,
    };
  }
  return { ...designed, reason: 'mode-unknown' };
}

export function validateLocaleFontPlan(plan, fonts = []) {
  const problems = [];
  if (plan == null) return problems;
  if (plan.schema !== LOCALE_FONTS_SCHEMA) {
    problems.push('localeFonts.schema 必须是 ews-locale-fonts/v1');
    return problems;
  }
  const registered = new Set(asArray(fonts).map((font) => `${font.family}::${Number(font.weight) || 400}`));
  const families = new Set(asArray(fonts).map((font) => font.family));
  const checkTarget = (label, target) => {
    if (!target?.family) {
      problems.push(`${label} 缺 family`);
      return;
    }
    if (!families.has(target.family)) problems.push(`${label} 字体 ${target.family} 未登记`);
    for (const weight of asArray(target.weights)) {
      if (!registered.has(`${target.family}::${weight}`)) {
        problems.push(`${label} ${target.family} weight ${weight} 未登记`);
      }
    }
  };
  for (const [locale, rule] of Object.entries(plan.byLocale || {})) {
    if (!rule || rule.mode === 'source') continue;
    if (rule.mode === 'all') checkTarget(`localeFonts.${locale}`, rule);
    else if (rule.mode === 'slots') {
      checkTarget(`localeFonts.${locale}.display`, rule.display);
      checkTarget(`localeFonts.${locale}.body`, rule.body);
    } else {
      problems.push(`localeFonts.${locale}.mode 非法`);
    }
  }
  return problems;
}

function uniqueSpecs(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const family = String(item?.family || '').trim();
    if (!family) continue;
    const weight = Number.isInteger(Number(item.weight)) ? Number(item.weight) : 400;
    const key = `${family}::${weight}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ family, weight });
  }
  return out;
}

function pushFamily(acc, family, weights) {
  if (!family) return;
  const list = asArray(weights).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 1000);
  if (!list.length) acc.push({ family, weight: 400 });
  else for (const weight of list) acc.push({ family, weight });
}

/**
 * Faces this locale must have loaded. English body is often painted at 500,
 * but FontFaceSet.check('16px "Noto Sans"') asks for 400 — load every planned
 * weight including 400 so the check and first paint share the same files.
 */
export function localeFontLoadSpecs(plan, locale, { sourceLocale, fonts } = {}) {
  const acc = [];
  const rule = plan?.schema === LOCALE_FONTS_SCHEMA ? plan.byLocale?.[locale] : null;
  if (rule && !isFigmaSourceLocale(locale, sourceLocale) && rule.mode !== 'source') {
    if (rule.mode === 'all') pushFamily(acc, rule.family, rule.weights);
    if (rule.mode === 'slots') {
      pushFamily(acc, rule.display?.family, rule.display?.weights);
      pushFamily(acc, rule.body?.family, rule.body?.weights);
    }
  }
  const registered = uniqueSpecs(asArray(fonts).map((font) => ({
    family: font.family,
    weight: Number(font.weight) || 400,
  })));
  if (!acc.length) {
    if (registered.length) return uniqueSpecs([
      ...registered,
      ...registered.map((item) => ({ family: item.family, weight: 400 })),
    ]);
    return [];
  }
  const families = new Set(acc.map((item) => item.family));
  const hits = registered.length
    ? registered.filter((item) => families.has(item.family))
    : acc;
  for (const family of families) hits.push({ family, weight: 400 });
  return uniqueSpecs(hits);
}

export function fontCheckCss(family, { sizePx = 16, weight = 400 } = {}) {
  const size = Number.isFinite(Number(sizePx)) && Number(sizePx) > 0 ? Number(sizePx) : 16;
  const w = Number.isInteger(Number(weight)) ? Number(weight) : 400;
  const quoted = JSON.stringify(String(family || ''));
  return w === 400 ? `${size}px ${quoted}` : `${w} ${size}px ${quoted}`;
}

function primeFontNode(family, weight) {
  if (typeof document === 'undefined' || !document.body) return null;
  const el = document.createElement('span');
  el.setAttribute('data-ews-font-prime', '');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `position:absolute;left:-9999px;top:0;font-family:${JSON.stringify(family)};font-weight:${weight};font-size:16px;line-height:16px;visibility:hidden;pointer-events:none;white-space:nowrap;`;
  el.textContent = 'Ag';
  document.body.appendChild(el);
  return el;
}

export function loadLocaleFonts(plan, locale, { sourceLocale, fonts, fontSet, timeoutMs = 4000 } = {}) {
  const specs = localeFontLoadSpecs(plan, locale, { sourceLocale, fonts });
  const set = fontSet || (typeof document !== 'undefined' ? document.fonts : null);
  if (!set?.load) return Promise.resolve(specs);
  const budget = Number.isFinite(Number(timeoutMs)) ? Math.max(0, Number(timeoutMs)) : 4000;
  const primes = specs.map((spec) => primeFontNode(spec.family, spec.weight)).filter(Boolean);
  return Promise.all(specs.map((spec) => {
    const css = fontCheckCss(spec.family, { weight: spec.weight });
    const load = Promise.resolve(set.load(css)).catch(() => []);
    if (!budget) return load;
    return Promise.race([
      load,
      new Promise((resolve) => { setTimeout(resolve, budget); }),
    ]);
  })).finally(() => {
    for (const el of primes) el.remove();
  }).then(() => specs);
}
