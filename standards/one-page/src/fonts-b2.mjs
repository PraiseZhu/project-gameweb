import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve as pathResolve } from 'node:path';
import { LANG_CODES } from './validate-inputs.mjs';
import { missingGlyphs } from './cmap.mjs';
import {
  inspectFontBytes,
  namesMatchFace,
  fileCoversWeight,
} from './font-identity.mjs';
import {
  productNodes,
  nodeById,
  sectionNumberOf,
  insideRole,
  textCharacters,
} from './inventory-walk.mjs';
import { fingerprintOf } from './questions.mjs';
import { sha256Hex } from './canonical.mjs';
import { isDeepStrictEqual } from 'node:util';
import { copyProjectFont, licenseRisk, projectFontPath, readFontAsset, readFontLibrary, readRegularFontFile } from './font-library.mjs';
import { scanFonts, scanLicense } from './font-scanner.mjs';

export const FONT_CONTEXT = Symbol('font-discovery-context');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const libraryId = (sha) => 'library-' + sha;
const managedFont = (ref) => typeof ref === 'string' && /^library-[a-f0-9]{64}$/.test(ref);

export function faceKey(family, weight) {
  return `${family}/${weight}`;
}

export function parseFaceKey(key) {
  const idx = String(key).lastIndexOf('/');
  if (idx <= 0) return null;
  const family = key.slice(0, idx);
  const weight = Number(key.slice(idx + 1));
  if (!family || !Number.isSafeInteger(weight)) return null;
  return { family, weight };
}

function usableTextNodes(inv) {
  const byId = nodeById(inv);
  const out = [];
  for (const node of inv?.nodes || []) {
    const isText = node.type === 'TEXT' || node.text?.characters != null || node.text?.fontFamily != null;
    if (!isText) continue;
    if (insideRole(node, byId, ['bg', 'kv'])) continue;
    const determined = node.status === 'determined' && node.role && node.role !== 'ref';
    const hidden = node.status === 'skipped' && node.why === 'invisible';
    if (!determined && !hidden) continue;
    out.push(node);
  }
  return out;
}

export function textSegments(node) {
  const characters = textCharacters(node);
  const baseFamily = node.text?.fontFamily;
  const baseWeight = node.text?.fontWeight;
  const overrides = node.text?.characterStyleOverrides;
  const table = node.text?.styleOverrideTable || {};
  if (!Array.isArray(overrides) || !overrides.length || !characters) {
    if (baseFamily == null || baseWeight == null) {
      return characters || node.type === 'TEXT'
        ? [{ family: baseFamily, weight: baseWeight, characters, start: 0, end: characters.length, missingStyle: !baseFamily || baseWeight == null }]
        : [];
    }
    return [{ family: baseFamily, weight: baseWeight, characters, start: 0, end: characters.length, missingStyle: false }];
  }
  const chars = [...characters];
  const segs = [];
  let current = null;
  for (let i = 0; i < chars.length; i += 1) {
    const styleId = overrides[i] || 0;
    const style = styleId ? (table[styleId] || table[String(styleId)] || {}) : {};
    const family = style.fontFamily ?? baseFamily;
    const weight = style.fontWeight ?? baseWeight;
    const missingStyle = family == null || weight == null;
    if (current && current.family === family && current.weight === weight && current.missingStyle === missingStyle) {
      current.characters += chars[i];
      current.end = i + 1;
    } else {
      current = {
        family,
        weight,
        characters: chars[i],
        start: i,
        end: i + 1,
        missingStyle,
      };
      segs.push(current);
    }
  }
  return segs;
}

export function collectFaces(inventories) {
  const faces = new Map();
  const styleGaps = [];
  for (const end of ['pc', 'mobile']) {
    const inv = inventories[end];
    if (!inv) continue;
    const byId = nodeById(inv);
    for (const node of usableTextNodes(inv)) {
      const section = sectionNumberOf(node, byId);
      const name = node.name || textCharacters(node).slice(0, 20);
      for (const seg of textSegments(node)) {
        const loc = {
          end,
          section,
          nodeId: node.id,
          name,
          characters: seg.characters,
          start: seg.start,
          endIndex: seg.end,
          hidden: node.status === 'skipped',
        };
        if (seg.missingStyle) {
          styleGaps.push({ ...loc, missing: '文字片段缺字体或字重，B2 不猜' });
          continue;
        }
        const key = faceKey(seg.family, seg.weight);
        if (!faces.has(key)) faces.set(key, { family: seg.family, weight: seg.weight, locations: [] });
        faces.get(key).locations.push(loc);
      }
    }
  }
  return { faces: [...faces.values()], styleGaps };
}

export function projectConfigDir(runRoot, fileKey, nodeId) {
  const key8 = String(fileKey).slice(0, 8);
  const node = String(nodeId).replace(/:/g, '-');
  return join(runRoot, 'projects', `${key8}-${node}`);
}

export function resolveFontFile(resource, configDir) {
  if (!resource?.file) return { ok: false, missing: '缺少字体文件路径' };
  if (isAbsolute(resource.file)) {
    return { ok: false, missing: '字体路径必须相对项目配置目录' };
  }
  if (!configDir) return { ok: false, missing: '没有项目配置目录' };
  let realDir;
  try {
    realDir = realpathSync(configDir);
  } catch (err) {
    return { ok: false, missing: `无法解析项目配置目录：${err.message}` };
  }
  const intended = pathResolve(realDir, resource.file);
  const rel = relative(realDir, intended);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    return { ok: false, missing: '字体文件不在项目配置目录内' };
  }
  if (!existsSync(intended)) {
    return { ok: false, missing: `找不到字体文件 ${resource.file}` };
  }
  let realFile;
  try {
    realFile = realpathSync(intended);
  } catch (err) {
    return { ok: false, missing: `无法解析字体路径：${err.message}` };
  }
  const inside = relative(realDir, realFile);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) {
    return { ok: false, missing: '字体文件不在项目配置目录内' };
  }
  return { ok: true, path: realFile };
}

export function resourceFilePath(resource, configDir) {
  const resolved = resolveFontFile(resource, configDir);
  return resolved.ok ? resolved.path : null;
}

export function sha256File(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function normalizeDigest(value) {
  const text = String(value || '').trim().toLowerCase();
  return text.startsWith('sha256:') ? text.slice(7) : text;
}

export function listTargetLangs(languages, baseLanguage = 'cn') {
  const langs = [...(languages || LANG_CODES)];
  const base = baseLanguage || 'cn';
  if (!langs.includes(base)) langs.unshift(base);
  return langs;
}

export function uniqueMatchingResource(resources, face, configDir) {
  const hits = [];
  for (const [id, resource] of Object.entries(resources || {})) {
    if (managedFont(id)) continue;
    const resolved = resolveFontFile(resource, configDir);
    if (!resolved.ok) continue;
    let buffer;
    try {
      buffer = readFileSync(resolved.path);
    } catch {
      continue;
    }
    const identity = inspectFontBytes(buffer);
    if (!identity.ok || identity.packed) continue;
    if (namesMatchFace(identity, face.family) && fileCoversWeight(identity, face.weight)) {
      hits.push(id);
    }
  }
  return hits.length === 1 ? hits[0] : null;
}

// 配置写入三态：缺失(absent)可自动补 / 已有合法值保留 /
// 显式坏 shape(字符串、数组、非对象 faces/resources)原样保留交 compiler 出 FONT_CONFIG。
// 只有资源恰好唯一有效命中才写；未命中/歧义不造空 face、不改配置形状。
export function autoReuseFonts(fonts, inventories, configDir, languages, baseLanguage = 'cn') {
  if (!fonts || typeof fonts !== 'object' || Array.isArray(fonts)) return fonts;
  const next = structuredClone(fonts);
  if (next.faces == null) return next; // 无 faces 容器不造（absent 保持 absent）
  if (typeof next.faces !== 'object' || Array.isArray(next.faces)) return next; // 坏容器不覆盖
  if (next.resources == null || typeof next.resources !== 'object' || Array.isArray(next.resources)) return next;
  const collected = collectFaces(inventories);
  const langs = listTargetLangs(languages, baseLanguage);
  for (const face of collected.faces) {
    const key = faceKey(face.family, face.weight);
    const hasFace = Object.hasOwn(next.faces, key);
    const existing = hasFace ? next.faces[key] : null;
    // 显式坏 shape（字符串/数组/null）不覆盖，交 compiler FONT_CONFIG
    if (hasFace && (!existing || typeof existing !== 'object' || Array.isArray(existing))) continue;
    const writes = langs.filter((lang) => !hasFace || !Object.hasOwn(existing, lang));
    if (!writes.length) continue;
    const unique = uniqueMatchingResource(next.resources, face, configDir);
    if (!unique) continue; // 未命中/歧义命中：不造空 face、不改配置
    if (!hasFace) next.faces[key] = {};
    for (const lang of writes) next.faces[key][lang] = unique;
  }
  return next;
}

export function buildFontQuestions(inventories, {
  languages,
  baseLanguage = 'cn',
  fonts = {},
  answeredFaces = new Set(),
  discovery,
} = {}) {
  const langs = listTargetLangs(languages, baseLanguage);
  const foreign = langs.filter((lang) => lang !== (baseLanguage || 'cn'));
  const collected = collectFaces(inventories);
  const faces = collected.faces;
  const questions = [];
  const blockers = [];
  const mapping = fonts.faces || {};
  for (const face of faces) {
    const key = faceKey(face.family, face.weight);
    const current = mapping[key] && typeof mapping[key] === 'object' ? mapping[key] : {};
    const missingLangs = langs.filter((lang) => {
      const answeredKey = `${key}::${lang}`;
      if (answeredFaces.has(answeredKey)) return false;
      if (discovery?.questions.some((card) => card.options.some((option) => option.matches.some((need) => need.key === key && need.lang === lang)))) return false;
      return !(typeof current[lang] === 'string' && current[lang].trim());
    });
    if (!missingLangs.length) continue;
    const body = {
      type: 'font-map',
      object: key,
      componentKey: key,
      locations: face.locations,
      options: missingLangs.map((lang) => ({ id: lang, label: lang })),
      suggested: null,
      prompt: missingLangs.includes(baseLanguage || 'cn')
        ? `中文字体 ${face.family} ${face.weight} 对应网页字体文件。请按语言填写资源文件、字重、来源和授权。`
        : `中文字体 ${face.family} ${face.weight} 对应各外语字体。请按语言填写资源文件、字重、来源和授权。`,
      splitAllowed: false,
      langs: missingLangs,
      family: face.family,
      weight: face.weight,
    };
    const fontNeeds = discovery?.missing.filter((need) => need.key === key && missingLangs.includes(need.lang));
    if (fontNeeds?.length) {
      body.fontNeeds = fontNeeds;
      body.prompt = fontNeeds.map(formatFontGap).join('\n');
      body[FONT_CONTEXT] = discovery.context;
    }
    questions.push({ ...body, fingerprint: fingerprintOf(body) });
  }
  return { questions, blockers, faces, foreign, styleGaps: collected.styleGaps };
}

function localizedPartsForFace(face, lang, translations, baseLanguage) {
  const matched = translations?.matched || [];
  const byNode = new Map(matched.map((row) => [row.nodeId, row]));
  const isBase = lang === (baseLanguage || 'cn');
  return face.locations.map((loc) => {
    if (isBase) return { loc, text: loc.characters || '' };
    return { loc, text: byNode.get(loc.nodeId)?.byLang?.[lang] || '' };
  });
}

function identityMatches(identity, need) {
  return (identity?.family?.trim?.() === need.family || identity?.fullName === need.family || identity?.postscript === need.family)
    && fileCoversWeight(identity, need.weight);
}

function coverageGaps(asset, need) {
  return need.glyphs.filter((glyph) => !asset.coverage.has(glyph.codePointAt(0)));
}

function makeNeed(face, lang, translations, baseLanguage) {
  const parts = localizedPartsForFace(face, lang, translations, baseLanguage);
  const glyphs = [...new Set(parts.flatMap(({ text }) => [...text]).filter((glyph) => ![' ', '\r', '\n'].includes(glyph)))];
  return { key: faceKey(face.family, face.weight), family: face.family, weight: Number(face.weight), lang, glyphs,
    locations: parts.map(({ loc, text }) => ({ ...loc, characters: text })) };
}

export function formatFontGap(need) {
  const where = need.locations.map((loc) => loc.end + '/' + (loc.section ?? '-') + '/' + loc.name + '(' + loc.nodeId + ')');
  return 'Level 3 · ' + need.family + ' / ' + need.weight + '（wght=' + need.weight + '）· ' + need.lang + ' · ' + where.join('、')
    + ' · 缺失字符：' + (need.glyphs.map((glyph) => JSON.stringify(glyph)).join(' ') || '无待核字符，仍缺真实原件') + '。请提供原文件及许可，或改稿替换。';
}

function matchesFromLibrary(entries, need) {
  return entries.filter(({ entry, asset }) => identityMatches(entry?.identity, need) || identityMatches(asset?.identity, need));
}

export function assignLibraryFont(fonts, need, asset, { source, license, evidence }) {
  const { identity } = asset;
  const ref = libraryId(identity.sha256);
  fonts.faces[need.key] ??= {};
  fonts.faces[need.key][need.lang] = ref;
  const axes = Object.fromEntries(Object.entries(identity.axes).map(([axis, { min, max }]) => [axis, { min, max }]));
  const weights = [...new Set([identity.weight, Math.round(identity.axes.wght?.default), ...identity.instances.map((instance) => instance.weight)]
    .filter((weight) => Number.isSafeInteger(weight) && weight > 0))];
  fonts.resources[ref] = { file: projectFontPath(identity), source, license, format: identity.container, weights, digest: 'sha256:' + identity.sha256,
    ...(Object.keys(axes).length ? { axes } : {}), licenseReview: { status: 'confirmed', evidence } };
  return ref;
}

export function rejectionKey(option, need) {
  return sha256Hex({ id: option.id, origins: option.origins, need });
}

function matchedScans(remaining, fontDiscovery) {
  const { index } = scanFonts(fontDiscovery);
  const byDigest = new Map();
  const partial = new Map();
  for (const indexed of index) {
    if (!remaining.some((need) => identityMatches(indexed.identity, need))) continue;
    let asset;
    try { asset = readFontAsset(indexed.path); } catch { continue; }
    const { identity } = asset;
    const matches = [];
    for (const need of remaining) {
      if (!identityMatches(identity, need)) continue;
      const glyphs = coverageGaps(asset, need);
      if (!glyphs.length) matches.push(need);
      else {
        const gaps = partial.get(need) || {};
        gaps[identity.sha256] = glyphs;
        partial.set(need, gaps);
      }
    }
    if (!matches.length) continue;
    const { warnings, licenseTexts } = scanLicense(asset, indexed.system);
    const origin = { path: indexed.path, system: indexed.system, warnings, licenseTexts };
    const existing = byDigest.get(identity.sha256);
    if (existing) existing.origins.push(origin);
    else byDigest.set(identity.sha256, { id: identity.sha256, identity, matches, origins: [origin] });
  }
  const rank = { ttf: 0, otf: 1, woff2: 2, woff: 3 };
  const candidates = [...byDigest.values()].map((option) => {
    const warnings = [...new Set(option.origins.flatMap((item) => item.warnings))];
    return { ...option, warnings, severity: warnings.length ? 'danger' : 'info',
      label: option.identity.family + ' · ' + (option.identity.variable ? 'VF' : option.identity.weight) + ' · ' + option.identity.container };
  }).sort((left, right) => {
    const variable = (option) => option.identity.variable && new Set(option.matches.map((match) => match.weight)).size > 1 ? 1 : 0;
    return variable(right) - variable(left) || rank[left.identity.container] - rank[right.identity.container] || left.id.localeCompare(right.id);
  });
  return { candidates, partial };
}

export function verifyCandidate(option) {
  let selected;
  for (const origin of option.origins) {
    const asset = readFontAsset(origin.path);
    const license = scanLicense(asset, origin.system);
    if (asset.identity.sha256 !== option.id || option.matches.some((need) => !identityMatches(asset.identity, need) || coverageGaps(asset, need).length)
      || !isDeepStrictEqual(license, { warnings: origin.warnings, licenseTexts: origin.licenseTexts })) throw new Error('候选字体或许可已变化，请重新生成确认卡');
    selected ??= asset;
  }
  if (!selected) throw new Error('候选没有可核查的来源');
  return selected;
}

export function verifyManualFont(resource, configDir, needs) {
  const resolved = resolveFontFile(resource, configDir);
  if (!resolved.ok) throw new Error(resolved.missing);
  const intended = pathResolve(realpathSync(configDir), resource.file);
  if (intended !== resolved.path) throw new Error('不得用软链提供字体');
  const asset = readFontAsset(resolved.path);
  if (asset.identity.sha256 !== normalizeDigest(resource.digest) || asset.identity.container !== resource.format
    || needs.some((need) => !identityMatches(asset.identity, need) || coverageGaps(asset, need).length)) throw new Error('手工字体的摘要、真实身份、字重、容器或字形覆盖不符');
  return asset;
}

export function discoverFonts({ inventories, languages, baseLanguage = 'cn', translations, configDir,
  fonts, fontDiscovery, rejected = {} }) {
  const result = { fonts, questions: [], blockers: [], missing: [] };
  if (!configDir || fontDiscovery === false || (fonts !== undefined && (!object(fonts) || !object(fonts.faces) || !object(fonts.resources)))) return result;
  const options = { libraryDir: pathResolve(configDir, '../../fonts-library'), ...fontDiscovery };
  const next = structuredClone(fonts ?? { faces: {}, resources: {} });
  const needs = collectFaces(inventories).faces.flatMap((face) => listTargetLangs(languages, baseLanguage)
    .map((lang) => makeNeed(face, lang, translations, baseLanguage)));
  const relevant = needs.filter(({ key, lang }) => !Object.hasOwn(next.faces, key)
    || (object(next.faces[key]) && (!Object.hasOwn(next.faces[key], lang) || managedFont(next.faces[key][lang]))));
  if (!relevant.length) return result;
  const { entries, error } = readFontLibrary(options.libraryDir);
  const remaining = [];
  for (const need of relevant) {
    const hits = matchesFromLibrary(entries, need);
    const ref = next.faces[need.key]?.[need.lang];
    const valid = hits.length === 1 && hits[0].asset && !coverageGaps(hits[0].asset, need).length ? hits[0] : null;
    if (managedFont(ref)) {
      let reason = error || hits.find((row) => row.error)?.error || '公共库字体身份不唯一、不可用或缺字';
      try {
        if (!valid || libraryId(valid.entry.sha256) !== ref) throw new Error(reason);
        const expected = { faces: {}, resources: {} };
        assignLibraryFont(expected, need, valid.asset, valid.entry);
        if (!isDeepStrictEqual(next.resources[ref], expected.resources[ref])) throw new Error('项目登记与公共字体库不一致');
        const local = join(realpathSync(configDir), expected.resources[ref].file);
        if (sha256File(readRegularFontFile(local)) !== valid.entry.sha256) throw new Error('项目字体原件摘要变化');
        continue;
      } catch (err) { reason = err.message; }
      result.blockers.push({ ...need, object: need.key, code: 'FONT_FILE', missing: reason });
      continue;
    }
    if (valid) {
      try {
        copyProjectFont(configDir, valid.asset);
        assignLibraryFont(next, need, valid.asset, valid.entry);
        result.fonts = next;
        continue;
      } catch (err) {
        result.blockers.push({ ...need, object: need.key, code: 'FONT_FILE', missing: err.message });
      }
    }
    remaining.push(need);
  }
  if (!remaining.length) return result;
  const { candidates, partial } = matchedScans(remaining, options);
  const proposed = candidates.map((option) => ({ ...option, matches: option.matches.filter((need) => !rejected[rejectionKey(option, need)]) }))
    .filter((option) => option.matches.length);
  const context = { configDir, libraryDir: options.libraryDir, needs: remaining };
  if (proposed.length) {
    const suggested = [];
    const covered = new Set();
    for (const option of proposed) {
      const mappings = option.matches.filter((need) => !covered.has(need));
      if (mappings.length) {
        suggested.push({ id: option.id, mappings: mappings.map(({ key, lang }) => ({ key, lang })) });
        for (const need of mappings) covered.add(need);
      }
    }
    const body = { type: 'font-candidates', object: '页面字体候选', componentKey: 'font-candidates', options: proposed, suggested,
      locations: [...new Set(proposed.flatMap((option) => option.matches).flatMap((need) => need.locations))], splitAllowed: false,
      prompt: '请核实候选原件允许商用且允许随网页再分发，再明确确认或拒绝。红标表示风险或未知，不代表可用。' };
    result.questions.push({ ...body, fingerprint: fingerprintOf(body), [FONT_CONTEXT]: context });
  }
  for (const need of remaining) {
    if (proposed.some((option) => option.matches.includes(need))) continue;
    const candidateMissing = { ...Object.fromEntries(matchesFromLibrary(entries, need).filter((row) => row.asset)
      .map(({ asset }) => [asset.identity.sha256, coverageGaps(asset, need)])), ...partial.get(need) };
    const glyphs = Object.values(candidateMissing).some((value) => value.length)
      ? [...new Set(Object.values(candidateMissing).flat())] : need.glyphs;
    result.missing.push({ ...need, glyphs, candidateMissing, axes: { wght: need.weight }, level: 3 });
  }
  result.context = context;
  return result;
}

// licenseReview 最小合同（不作法律判断、不扫描）：
// - 对象形：{ status: 'pending'|'confirmed', evidence: 非空字符串（来源/确认依据引用）, note?: string }
// - 字符串形兼容视为 pending（未决文本）
// - confirmed 必须 evidence 非空才算确认；裸 licenseConfirmed=true 不得放行；
//   licenseConfirmed 仅在 licenseReview.status==='confirmed' 且 evidence 非空时是多余但无害的。
// - 无 licenseReview 且 source/license 非空 → 维持旧行为放行（不扩大人签）。
export function licenseReviewSummary(resource) {
  const review = resource?.licenseReview;
  if (review == null || review === '') return null;
  if (typeof review === 'string') return { status: 'pending', evidence: null, text: review };
  if (typeof review === 'object') {
    return {
      status: review.status === 'confirmed' ? 'confirmed' : 'pending',
      evidence: typeof review.evidence === 'string' && review.evidence.trim() ? review.evidence : null,
      note: typeof review.note === 'string' ? review.note : null,
    };
  }
  return { status: 'pending', evidence: null, text: String(review) };
}

function licenseReviewNote(resource, ref) {
  const summary = licenseReviewSummary(resource);
  if (!summary) return null;
  if (summary.status === 'confirmed' && summary.evidence) return null;
  if (summary.status === 'confirmed') {
    return `许可确认缺少确认依据（资源 ${ref}）：status=confirmed 但 evidence 为空，不得放行`;
  }
  let text = summary.text || summary.note || '';
  if (text.length > 80) text = `${text.slice(0, 80)}…`;
  return `许可再分发待确认（资源 ${ref}），需明确确认证据（licenseReview: status=pending${text ? ` ${text}` : ''}）`;
}

function sourceLicenseOk(resource, ref) {
  const base = typeof resource?.source === 'string' && resource.source.trim()
    && typeof resource?.license === 'string' && resource.license.trim();
  if (!base) return { ok: false, note: `缺来源或许可说明（资源 ${ref}）` };
  if (licenseRisk(resource.license)) return { ok: false, note: '许可明确含非商用或需授权等限制（资源 ' + ref + '）' };
  const pending = licenseReviewNote(resource, ref);
  if (pending) return { ok: false, note: pending };
  // 裸 licenseConfirmed=true 而没有 licenseReview 的 confirmed+evidence：不得放行
  if (resource?.licenseConfirmed === true && !licenseReviewSummary(resource)) {
    return { ok: false, note: `许可确认缺少确认依据（资源 ${ref}）：裸 licenseConfirmed=true 不是证据，需 licenseReview.status=confirmed 且 evidence 非空` };
  }
  return { ok: true };
}

export function checkFontFiles({
  inventories,
  languages,
  baseLanguage = 'cn',
  fonts = {},
  configDir = null,
  translations = null,
}) {
  const blockers = [];
  const fontInputs = [];
  const seenFiles = new Set();
  const identities = new Map();
  const collected = collectFaces(inventories);
  const faces = collected.faces;
  const mapping = fonts.faces || {};
  const resources = fonts.resources || {};
  const langs = listTargetLangs(languages, baseLanguage);
  for (const gap of collected.styleGaps) {
    blockers.push({
      code: 'FONT_STYLE_MISSING',
      object: gap.name || gap.nodeId,
      missing: gap.missing,
      locations: [gap],
      returnTo: '设计稿',
    });
  }
  for (const face of faces) {
    const key = faceKey(face.family, face.weight);
    const current = mapping[key] || {};
    for (const lang of langs) {
      const ref = current[lang];
      if (!ref) {
        blockers.push({
          code: 'FONT_UNSET',
          object: key,
          lang,
          missing: lang === (baseLanguage || 'cn')
            ? `网页字体未定：${key} → ${lang}`
            : `外语字体未定：${key} → ${lang}`,
          locations: face.locations,
        });
        continue;
      }
      const resource = resources[ref];
      if (!resource) {
        blockers.push({
          code: 'FONT_UNSET',
          object: key,
          lang,
          missing: `字体资源未登记：${ref}`,
          locations: face.locations,
        });
        continue;
      }
      const licenseCheck = sourceLicenseOk(resource, ref);
      if (!licenseCheck.ok) {
        blockers.push({
          code: 'FONT_SOURCE',
          object: key,
          lang,
          missing: licenseCheck.note,
          locations: face.locations,
        });
      }
      const resolved = resolveFontFile(resource, configDir);
      if (!resolved.ok) {
        blockers.push({
          code: 'FONT_FILE',
          object: key,
          lang,
          missing: resolved.missing,
          locations: face.locations,
        });
        continue;
      }
      const filePath = resolved.path;
      let buffer;
      try {
        buffer = readFileSync(filePath);
      } catch (err) {
        blockers.push({
          code: 'FONT_FILE',
          object: key,
          lang,
          missing: `无法读取字体文件：${err.message}`,
          locations: face.locations,
        });
        continue;
      }
      const actual = sha256File(buffer);
      if (!seenFiles.has(filePath)) {
        seenFiles.add(filePath);
        fontInputs.push({
          kind: 'font-file',
          path: filePath,
          digest: actual,
          version: actual,
        });
      }
      const declared = normalizeDigest(resource.digest);
      if (!declared || declared !== actual) {
        blockers.push({
          code: 'FONT_DIGEST',
          object: key,
          lang,
          missing: `字体 digest 不符（资源 ${ref}）`,
          locations: face.locations,
        });
      }
      const identity = inspectFontBytes(buffer);
      identities.set(ref, identity);
      // 声明 format 与真实容器魔数核对：容器格式不一致一律阻断。
      if (typeof resource.format === 'string' && resource.format.trim() && identity.container) {
        if (resource.format.trim().toLowerCase() !== identity.container) {
          blockers.push({
            code: 'FONT_FORMAT',
            object: key,
            lang,
            missing: `声明 format=${resource.format} 与文件真实容器格式 ${identity.container} 不符（资源 ${ref}）`,
            locations: face.locations,
          });
        }
      }
      if (identity.packed) {
        blockers.push({
          code: 'FONT_FILE',
          object: key,
          lang,
          missing: identity.note || 'woff/woff2 未解包，不能当核验完成',
          locations: face.locations,
        });
        continue;
      }
      if (!identity.ok) {
        blockers.push({
          code: 'FONT_IDENTITY',
          object: key,
          lang,
          missing: `无法读取字体身份（资源 ${ref}）`,
          locations: face.locations,
        });
      } else if (!namesMatchFace(identity, face.family)) {
        blockers.push({
          code: 'FONT_IDENTITY',
          object: key,
          lang,
          missing: `字体身份不符：文件是 ${identity.family || '未知'}，稿上是 ${face.family}`,
          locations: face.locations,
        });
      }
      if (identity.fvarCorrupt) {
        blockers.push({
          code: 'FONT_IDENTITY',
          object: key,
          lang,
          missing: `fvar 表损坏，轴信息不可信（资源 ${ref}）`,
          locations: face.locations,
        });
      }
      if (!fileCoversWeight(identity, face.weight)) {
        blockers.push({
          code: 'FONT_WEIGHT',
          object: key,
          lang,
          missing: `文件缺字重 ${face.weight}（资源 ${ref}）`,
          locations: face.locations,
        });
      }
      const parts = localizedPartsForFace(face, lang, translations, baseLanguage);
      const needed = parts.map((row) => row.text).join('');
      // 空文字只跳字形覆盖，不跳 cmap/容器/maxp 的必需结构核验：
      // missingGlyphs 即便空文本也先完整解析 cmap，结构坏一律 FONT_FILE。
      let missing;
      try {
        missing = missingGlyphs(buffer, needed);
      } catch (err) {
        blockers.push({
          code: 'FONT_FILE',
          object: key,
          lang,
          missing: `无法读取字体字符表：${err.message}`,
          locations: face.locations,
        });
        continue;
      }
      if (!needed) continue;
      if (missing.length) {
        const hits = parts.filter((row) => missing.some((ch) => row.text.includes(ch))).map((row) => row.loc);
        blockers.push({
          code: 'FONT_GLYPH',
          object: key,
          lang,
          missing: `缺字：${missing.join(' ')}`,
          glyphs: missing,
          locations: hits.length ? hits : parts.filter((row) => row.text).map((row) => row.loc),
        });
      }
    }
  }
  return { blockers, fontInputs, identities, faces, styleGaps: collected.styleGaps };
}

export function buildFontAudit({
  scope,
  b1Version,
  fonts,
  fontCheck,
  languages,
  baseLanguage = 'cn',
}) {
  const faces = (fontCheck.faces || []).map((face) => {
    const key = faceKey(face.family, face.weight);
    const mapping = fonts?.faces?.[key] || {};
    const langs = {};
    for (const lang of listTargetLangs(languages, baseLanguage)) {
      const ref = mapping[lang] || null;
      const identity = ref ? fontCheck.identities?.get(ref) : null;
      const license = ref ? licenseReviewSummary(fonts?.resources?.[ref]) : null;
      langs[lang] = {
        resource: ref,
        family: identity?.family || null,
        weight: identity?.weight ?? null,
        axes: identity?.axes || {},
        digest: identity?.sha256 || null,
        // 许可状态摘要，使 checkEntry 能复算（status/evidence 有无，不带全文）
        licenseReview: license ? {
          status: license.status,
          hasEvidence: Boolean(license.evidence),
        } : null,
      };
    }
    return {
      key,
      family: face.family,
      weight: face.weight,
      locations: face.locations,
      langs,
    };
  });
  const problems = (fontCheck.blockers || []).map((item) => ({
    code: item.code,
    object: item.object,
    lang: item.lang || null,
    missing: item.missing,
    locations: item.locations || [],
  }));
  const body = {
    kind: 'font-audit',
    contract: 'b2-input-completion/v1',
    b1Version: b1Version || null,
    languages: [...(languages || [])],
    baseLanguage,
    faces,
    problems,
  };
  return { ...body, digest: sha256Hex(body) };
}

export function missingLangVariants(inventories, languages) {
  const wanted = new Set(languages || LANG_CODES);
  const problems = [];
  for (const end of ['pc', 'mobile']) {
    const inv = inventories[end];
    if (!inv) continue;
    const byId = nodeById(inv);
    const sets = new Map();
    for (const node of inv.nodes || []) {
      if (node.type !== 'COMPONENT_SET' && node.role !== 'img') continue;
      if (node.type === 'COMPONENT_SET' || (node.role === 'img' && node.componentId)) {
        const id = node.type === 'COMPONENT_SET' ? node.id : node.componentId;
        if (!sets.has(id)) sets.set(id, { node, langs: new Set(), locations: [] });
      }
    }
    for (const node of productNodes(inv)) {
      if (node.role !== 'img') continue;
      const langs = node.langs || [];
      if (!langs.length) continue;
      const setId = node.componentId || node.id;
      if (!sets.has(setId)) sets.set(setId, { node, langs: new Set(), locations: [] });
      const row = sets.get(setId);
      for (const lang of langs) row.langs.add(lang);
      row.locations.push({
        end,
        section: sectionNumberOf(node, byId),
        nodeId: node.id,
        name: node.name,
      });
    }
    for (const row of sets.values()) {
      if (!row.langs.size) continue;
      const missing = [...wanted].filter((lang) => !row.langs.has(lang));
      if (missing.length) {
        problems.push({
          code: 'LANG_VARIANT_MISSING',
          object: row.node.name || row.node.id,
          missing: `真缺语言变体：${missing.join(',')}`,
          locations: row.locations,
          returnTo: '设计稿',
        });
      }
    }
  }
  return problems;
}
