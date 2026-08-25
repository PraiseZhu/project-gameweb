/**
 * Figma layer naming semantics.
 *
 * Implements standards/figma-naming v2.10 / A-v1.8 as a source-only role hint:
 * - unprefixed TEXT is editable copy (copy role);
 * - TEXT named with img/, bg/, or kv/ is a visual asset/slice; name overrides node type;
 * - prefixes are case-insensitive and may contain spaces around ASCII or full-width slash;
 * - txt/ and swpage/ are legacy compatibility warnings until 2026-11-12, not standard roles;
 * - backslash separators are invalid; full-width slash is accepted;
 * - unlabelled nodes are not inferred as img or switch from type/fill;
 * - inventory/v2 may still promote mix/ image-fill leaves to img via=structure.
 *
 * Naming never rewrites Figma owner tree, paint order, clipping, mask,
 * opacity, or blend semantics.
 */

export const ROLE_KIND = Object.freeze({
  sec: 'structural',
  fix: 'structural',
  ref: 'structural',
  scroll: 'structural',
  switch: 'structural',
  tab: 'structural',
  ind: 'structural',
  img: 'asset',
  bg: 'asset',
  kv: 'asset',
  btn: 'widget',
  hot: 'widget',
  modal: 'widget',
  dyn: 'widget',
  mix: 'widget',
});

// copy 是派生角色(无前缀 TEXT 的可编辑文案),不是可解析前缀:v2.8 前缀总表里没有 copy/,
// `copy/xxx` 是总表外词,按「无前缀」处理。deriveRole 只在 TEXT 分支派生它。
const DERIVED_COPY_KIND = 'widget';

export const LEGACY_COMPAT_UNTIL = '2026-11-12';
export const LEGACY_COMPAT_ROLES = Object.freeze({
  txt: 'Use unprefixed TEXT for editable copy; txt/ is a legacy compatibility prefix until 2026-11-12.',
  swpage: 'Use direct children of switch/ as candidate pages under source-backed constraints; swpage/ is legacy compatibility until 2026-11-12.',
});

export const KNOWN_ROLES = Object.freeze(Object.keys(ROLE_KIND).filter((role) => role !== 'copy'));
export const LEGACY_COMPATIBILITY_ROLES = Object.freeze(Object.keys(LEGACY_COMPAT_ROLES));

const VISUAL_TEXT_ROLES = new Set(['img', 'bg', 'kv']);
const asString = (value) => String(value == null ? '' : value);

export function parseLayerName(name) {
  const raw = asString(name);
  const out = { raw, role: null, label: '', params: {}, flags: [], legacyRole: null, warnings: [], errors: [], standard: false, legacy: false };
  if (!raw) return out;

  const atParts = raw.split('@');
  const head = atParts.shift();
  for (const part of atParts) {
    const eq = part.indexOf('=');
    if (eq > 0) out.params[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    else if (part.trim()) out.flags.push(part.trim());
  }

  if (/[\\＼]/.test(head)) {
    out.label = head.trim();
    out.errors.push({ code: 'invalid-separator', message: 'Use ASCII slash "/" or full-width slash "／" as the naming separator; backslash is invalid.' });
    return out;
  }

  const match = /^([A-Za-z]+)\s*[\/／]\s*(.*)$/.exec(head);
  if (!match) {
    out.label = head.trim();
    return out;
  }

  const role = match[1].toLowerCase();
  out.label = match[2].trim();
  if (Object.hasOwn(ROLE_KIND, role)) {
    out.role = role;
    out.standard = true;
    return out;
  }
  if (Object.hasOwn(LEGACY_COMPAT_ROLES, role)) {
    out.legacyRole = role;
    out.legacy = true;
    out.warnings.push({ code: 'legacy-prefix', role, compatibilityUntil: LEGACY_COMPAT_UNTIL, message: LEGACY_COMPAT_ROLES[role] });
    return out;
  }

  out.label = head.trim();
  return out;
}

export function deriveRole(node, opts = {}) {
  const parsed = parseLayerName(node && node.name);
  const type = asString(node && node.type).toUpperCase();
  const base = { params: parsed.params, errors: parsed.errors, warnings: parsed.warnings, warning: parsed.warnings[0] };

  if (parsed.role) {
    if (type === 'TEXT' && !VISUAL_TEXT_ROLES.has(parsed.role)) {
      return { role: 'copy', via: 'type:text', kind: DERIVED_COPY_KIND, nameRole: parsed.role, ...base };
    }
    return {
      role: parsed.role,
      via: type === 'TEXT' && VISUAL_TEXT_ROLES.has(parsed.role) ? 'name-overrides-text' : 'name',
      kind: ROLE_KIND[parsed.role],
      ...base,
    };
  }

  if (parsed.legacyRole === 'swpage' && opts.legacy) {
    return { role: 'swpage', via: 'legacy-name', kind: 'structural', legacy: true, legacyRole: 'swpage', ...base };
  }

  if (type === 'TEXT') {
    return { role: 'copy', via: parsed.legacyRole === 'txt' ? 'legacy-name:text-copy' : 'type:text', kind: DERIVED_COPY_KIND, legacy: parsed.legacy, legacyRole: parsed.legacyRole, ...base };
  }

  return { role: null, via: parsed.legacyRole ? 'legacy-name:' + parsed.legacyRole + ':ignored' : 'none', kind: null, legacy: parsed.legacy, legacyRole: parsed.legacyRole, ...base };
}

export function isVisualTextSlice(node) {
  return asString(node && node.type).toUpperCase() === 'TEXT' && VISUAL_TEXT_ROLES.has(parseLayerName(node && node.name).role);
}

export function assetPolicyHint(node) {
  const derived = deriveRole(node);
  if (derived.role === 'img' || derived.role === 'bg' || derived.role === 'kv') return { wantAsset: true, via: 'role:' + derived.role };
  return { wantAsset: false, via: derived.role ? 'role:' + derived.role : 'none' };
}

export function bgScopeHint(node, ownerChain) {
  const parsed = parseLayerName(node && node.name);
  const chain = Array.isArray(ownerChain) ? ownerChain.map((s) => String(s || '')) : [];
  const joined = chain.join(' / ');
  if (/bg\/pc|bg\/mobile|page|页面|canvas|画板/i.test(joined)) {
    return { scope: 'page-shared', confidence: 'hint', via: 'ownerChain', note: 'Owner chain has a page-level container; owner model must still verify the real tree position.' };
  }
  if (parsed.role === 'bg' && parsed.label && /pc|mobile|page|整页|全页/.test(parsed.label)) {
    return { scope: 'page-shared', confidence: 'hint', via: 'name-label', note: 'Label has page-level wording; owner model must still verify the real tree position.' };
  }
  return { scope: 'section-local', confidence: 'hint', via: 'default', note: 'Default to local decoration; only owner model can promote background scope.' };
}

export function auditNames(nodes) {
  const arr = Array.isArray(nodes) ? nodes : Object.values(nodes || {});
  const stats = { total: arr.length, withRole: 0, byRole: {}, unresolved: [], warnings: [], compatibilityWarnings: [], errors: [] };
  for (const node of arr) {
    const parsed = parseLayerName(node && node.name);
    const derived = deriveRole(node, { legacy: true });
    if (derived.role) {
      stats.withRole++;
      stats.byRole[derived.role] = (stats.byRole[derived.role] || 0) + 1;
    }
    for (const warning of parsed.warnings) {
      const record = { id: node && node.id, name: node && node.name, type: node && node.type, ...warning };
      stats.warnings.push(record);
      stats.compatibilityWarnings.push(record);
    }
    for (const error of parsed.errors) {
      stats.errors.push({ id: node && node.id, name: node && node.name, type: node && node.type, ...error });
    }
    if (!derived.role && asString(node && node.type).toUpperCase() !== 'TEXT') {
      stats.unresolved.push({ id: node && node.id, name: node && node.name, type: node && node.type, reason: parsed.errors.length ? 'invalid-name' : 'no-role-hint' });
    }
  }
  return stats;
}
