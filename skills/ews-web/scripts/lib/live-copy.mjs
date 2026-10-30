/**
 * Live TEXT/copy gate. Pixel masks cannot hide these errors.
 * Baked TEXT under img/bg/kv owners is not live.
 */
import { isModalCloseButton } from '../../assets/runtime/modal-close.mjs';
import { formatPagedIndex } from '../../assets/runtime/paged-switch-runtime.mjs';
import {
  expectedFontVariantCaps,
  expectedNowrap,
  expectedTextTransform,
  isFigmaSourceLocale,
} from '../../assets/runtime/text-style.mjs';
import { resolveLocaleFont } from '../../assets/runtime/locale-fonts.mjs';
import { auditPresenceHtml } from './presence.mjs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function underSliceOwner(node, byId) {
  let current = node;
  const seen = new Set();
  while (current?.parentId && !seen.has(String(current.parentId))) {
    seen.add(String(current.parentId));
    current = byId.get(String(current.parentId));
    if (!current) break;
    if (current.role === 'img' || current.role === 'bg' || current.role === 'kv') return true;
  }
  return false;
}

export function isLiveTextNode(node, byId) {
  if (!node) return false;
  if (node.isMask === true || node.visible === false) return false;
  const why = String(node.why || '');
  if (why === 'invisible' || why === 'ref') return false;
  const type = String(node.type || '').toUpperCase();
  const role = String(node.role || '');
  if (type !== 'TEXT' && role !== 'copy') return false;
  if (underSliceOwner(node, byId)) return false;
  return true;
}

function pagedSkipIds(platform) {
  const skip = new Set();
  for (const item of asArray(platform?.pagedSwitches)) {
    for (const id of asArray(item.skipIds)) skip.add(String(id));
  }
  for (const item of asArray(platform?.dropmenus)) {
    for (const id of asArray(item.skipIds)) skip.add(String(id));
  }
  for (const item of asArray(platform?.variantSwitches)) {
    for (const id of asArray(item.skipIds)) skip.add(String(id));
  }
  return skip;
}

function pagedCloneNodes(platform) {
  const out = [];
  for (const item of asArray(platform?.pagedSwitches)) {
    for (const page of asArray(item.pages)) {
      for (const card of asArray(page.items)) {
        out.push(...asArray(card.nodes));
      }
    }
  }
  for (const item of asArray(platform?.dropmenus)) {
    out.push(...asArray(item.offNodes), ...asArray(item.onNodes));
  }
  for (const item of asArray(platform?.variantSwitches)) {
    for (const layer of asArray(item.layers)) {
      out.push(...asArray(layer.nodes));
    }
  }
  return out;
}

export function liveTextNodesOf(platform) {
  const nodes = asArray(platform?.nodes);
  const byId = new Map(nodes.filter((node) => node?.id).map((node) => [String(node.id), node]));
  const skip = pagedSkipIds(platform);
  const live = nodes.filter((node) => isLiveTextNode(node, byId) && !skip.has(String(node.id)));
  const clones = pagedCloneNodes(platform);
  const cloneById = new Map(clones.filter((node) => node?.id).map((node) => [String(node.id), node]));
  for (const node of clones) {
    if (isLiveTextNode(node, cloneById)) live.push(node);
  }
  return live;
}

function pagedIndexExpected(node, platform) {
  const id = String(node?.id || '');
  if (!id) return null;
  for (const item of asArray(platform?.pagedSwitches)) {
    if (!asArray(item.pageIndexIds).includes(id)) continue;
    const sample = String(node.text?.characters || node.characters || '').trim();
    return formatPagedIndex(sample, 1, Number(item.pageCount) || 1);
  }
  return null;
}

function expectedCharacters(node, locale, platform, sourceLocale) {
  const painted = pagedIndexExpected(node, platform);
  if (painted) return painted;
  if (node.copy?.matchKind === 'deliberately-unbound' || isFigmaSourceLocale(locale, sourceLocale)) {
    return String(node.text?.characters || node.characters || '');
  }
  const translations = node.copy?.translations || {};
  if (Object.keys(translations).length) {
    const leaf = translations[locale];
    return leaf?.value != null ? String(leaf.value) : '';
  }
  return String(node.text?.characters || node.characters || '');
}


function isSolidColor(color) {
  return Boolean(color && typeof color === 'object' && Number.isFinite(Number(color.r)) && Number.isFinite(Number(color.g)) && Number.isFinite(Number(color.b)));
}

function expectedColorCss(node) {
  const fills = asArray(node.fills);
  const solid = fills.find((fill) => fill && fill.visible !== false && fill.type === 'SOLID' && isSolidColor(fill.color));
  const color = solid?.color
    || (isSolidColor(node.text?.color) ? node.text.color : null)
    || (node.text?.color?.type === 'SOLID' && isSolidColor(node.text.color.color) ? node.text.color.color : null);
  if (!color) return null;
  const { r, g, b, a = 1 } = color;
  if (![r, g, b, a].every(Number.isFinite)) return { error: 'RGBA 必须是有限数值' };
  const to = (n) => (n > 1 ? Math.round(n) : Math.round(Number(n) * 255));
  return `rgba(${to(r)},${to(g)},${to(b)},${Math.max(0, Math.min(1, Number(a)))})`;
}

function hasGradientFill(node) {
  return asArray(node.fills).some((fill) => fill && fill.visible !== false && String(fill.type || '').startsWith('GRADIENT'))
    || String(node.text?.color?.type || '').startsWith('GRADIENT');
}

function styleOfNodeHtml(html, nodeId) {
  const escaped = String(nodeId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`data-node-id="${escaped}"([^>]*)>`, 'g');
  const match = re.exec(html);
  if (!match) return null;
  const attrs = match[1] || '';
  const style = /style="([^"]*)"/.exec(attrs);
  const hidden = /\bhidden\b/.test(attrs) || /data-baked="1"/.test(attrs) || /visibility:hidden/.test(style?.[1] || '');
  return { attrs, style: style?.[1] || '', hidden };
}

export function auditProductChromeHtml(html) {
  const problems = [];
  if (/class="ews-lang-switch"/.test(html)) problems.push('product HTML 含 QA 语言条');
  if (/data-qa-device-select/.test(html) || /data-qa-pref=/.test(html)) problems.push('product HTML 含 QA 壳');
  if (/class="qc-toolbar"/.test(html)) problems.push('product HTML 含评论壳');
  return { ok: problems.length === 0, problems };
}

export function auditModalTriggerHtml(html, triggers) {
  const problems = [];
  for (const trigger of asArray(triggers)) {
    const from = String(trigger.from || trigger.id || '');
    const to = String(trigger.to || '');
    if (!from || !to) continue;
    const hit = styleOfNodeHtml(html, from);
    if (!hit || !/data-modal-open="/.test(`${hit.attrs}`)) {
      problems.push(`${from}: determined modal-trigger 未接到 ${to}`);
      continue;
    }
    if (!hit.attrs.includes(`data-modal-open="${to}"`)) {
      problems.push(`${from}: modal-open 不是 ${to}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

export function auditModalCloseHtml(html, platform) {
  const problems = [];
  const nodes = [
    ...asArray(platform?.nodes),
    ...asArray(platform?.modals).flatMap((modal) => asArray(modal.nodes)),
  ];
  const seen = new Set();
  for (const node of nodes) {
    if (!isModalCloseButton(node) || seen.has(String(node.id))) continue;
    seen.add(String(node.id));
    const hit = styleOfNodeHtml(html, node.id);
    if (!hit || !/data-modal-close=/.test(hit.attrs)) {
      problems.push(`${node.id}: 稿上 ${node.name || '关闭按钮'} 未接到关闭`);
    }
  }
  return { ok: problems.length === 0, problems };
}

export function auditDropmenuHtml(html) {
  const problems = [];
  const owners = [...String(html || '').matchAll(/data-dropmenu="true"([^>]*)>/g)];
  for (const match of owners) {
    const attrs = match[1] || '';
    if (!/data-dropmenu-state="off"/.test(attrs)) problems.push('dropmenu 初始不是 off');
  }
  const ons = [...String(html || '').matchAll(/data-dropmenu-layer="on"([^>]*)>/g)];
  for (const match of ons) {
    if (!/\bhidden\b/.test(match[1] || '')) problems.push('dropmenu on 层未 hidden');
  }
  return { ok: problems.length === 0, problems };
}

export function auditLiveCopyHtml(html, platform, { locale, sourceLocale, localeFonts } = {}) {
  const problems = [];
  const nodes = liveTextNodesOf(platform);
  const byId = new Map(asArray(platform?.nodes).filter((node) => node?.id).map((node) => [String(node.id), node]));
  for (const node of pagedCloneNodes(platform)) {
    if (node?.id) byId.set(String(node.id), node);
  }
  for (const node of nodes) {
    const hit = styleOfNodeHtml(html, node.id);
    if (!hit) {
      problems.push(`${node.id}: live TEXT 未画出`);
      continue;
    }
    if (hit.hidden && node.dropmenuLayer !== 'on') {
      problems.push(`${node.id}: live TEXT 被藏起`);
      continue;
    }
    if (/\bbackground:/.test(hit.style) && !/background-clip:\s*text/.test(hit.style)) {
      problems.push(`${node.id}: TEXT fill 被当成 background，不是 color`);
    }
    if (hasGradientFill(node) && !/background-clip:\s*text/.test(hit.style)) {
      problems.push(`${node.id}: 渐变字必须 background-clip:text`);
    }
    const color = expectedColorCss(node);
    if (color?.error) problems.push(`${node.id}: ${color.error}`);
    else if (color && !hit.style.includes(`color:${color}`)) {
      problems.push(`${node.id}: 缺 color:${color}`);
    }
    const wantText = expectedCharacters(node, locale, platform, sourceLocale);
    if (wantText && !html.includes(wantText.replace(/&/g, '&amp;').replace(/</g, '&lt;'))) {
      problems.push(`${node.id}: 页面缺文案 ${JSON.stringify(wantText)}`);
    }
    if (Number.isFinite(Number(node.text?.fontSize))) {
      const size = `font-size:${Number(node.text.fontSize)}px`;
      if (!hit.style.includes(size)) problems.push(`${node.id}: 缺 ${size}`);
    }
    const resolved = resolveLocaleFont(node, { locale, sourceLocale, byId, plan: localeFonts });
    if (node.text?.fontFamily) {
      if (!hit.style.includes(`font-family:'${resolved.family}'`)) {
        problems.push(`${node.id}: 缺 font-family:'${resolved.family}'`);
      }
    }
    const designedWeight = Number(node.text?.fontWeight);
    if (Number.isFinite(designedWeight) || (localeFonts && resolved.reason !== 'no-plan' && resolved.slot !== 'source-designed')) {
      const weight = `font-weight:${Number(resolved.weight)}`;
      if (!hit.style.includes(weight)) problems.push(`${node.id}: 缺 ${weight}`);
    }
    if (Number.isFinite(Number(node.text?.letterSpacing)) && Number(node.text.letterSpacing) !== 0) {
      const tracking = `letter-spacing:${Number(node.text.letterSpacing)}px`;
      if (!hit.style.includes(tracking)) problems.push(`${node.id}: 缺 ${tracking}`);
    }
    const transform = expectedTextTransform(node.text?.textCase);
    if (transform !== 'none' && !hit.style.includes(`text-transform:${transform}`)) {
      problems.push(`${node.id}: 缺 text-transform:${transform}`);
    }
    const caps = expectedFontVariantCaps(node.text?.textCase);
    if (caps !== 'normal' && !hit.style.includes('font-variant-caps:small-caps')) {
      problems.push(`${node.id}: 缺 font-variant-caps:small-caps`);
    }
    const nowrap = expectedNowrap(node, byId, { locale, sourceLocale });
    if (nowrap && !/white-space:nowrap/.test(hit.style)) {
      problems.push(`${node.id}: 稿上单行必须 nowrap`);
    }
    if (!nowrap && /white-space:nowrap/.test(hit.style)) {
      problems.push(`${node.id}: 长段落不能 nowrap`);
    }
    if (!nowrap && /overflow-wrap:\s*break-word|word-break:\s*break-word/.test(hit.style)) {
      problems.push(`${node.id}: 译文不得 word-break/overflow-wrap:break-word`);
    }
  }
  const baked = asArray(platform?.nodes).filter((node) => {
    const type = String(node.type || '').toUpperCase();
    const role = String(node.role || '');
    if (type !== 'TEXT' && role !== 'copy') return false;
    const byId = new Map(asArray(platform.nodes).map((item) => [String(item.id), item]));
    return underSliceOwner(node, byId);
  });
  for (const node of baked) {
    const hit = styleOfNodeHtml(html, node.id);
    if (hit && !hit.hidden) problems.push(`${node.id}: 已烘进切图的 TEXT 又活画了一份`);
  }
  return { ok: problems.length === 0, problems, liveCount: nodes.length };
}

export function auditLiveCopyModel(model, html, { htmlByEnd } = {}) {
  const problems = [];
  const locale = model?.defaultLocale;
  for (const end of Object.keys(model?.platforms || {})) {
    const source = htmlByEnd?.[end] || html;
    const platform = model.platforms[end];
    const result = auditLiveCopyHtml(source, platform, { locale, sourceLocale: model?.defaultLocale, localeFonts: model?.config?.localeFonts });
    problems.push(...result.problems.map((item) => `${end} ${item}`));
    problems.push(...auditModalCloseHtml(source, platform).problems.map((item) => `${end} ${item}`));
    problems.push(...auditPresenceHtml(source, platform).problems.map((item) => `${end} ${item}`));
  }
  return { ok: problems.length === 0, problems };
}
