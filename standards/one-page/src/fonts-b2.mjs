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

export function autoReuseFonts(fonts, inventories, configDir, languages, baseLanguage = 'cn') {
  const next = structuredClone(fonts || {});
  if (!next.faces) next.faces = {};
  if (!next.resources) next.resources = {};
  const collected = collectFaces(inventories);
  const langs = listTargetLangs(languages, baseLanguage);
  for (const face of collected.faces) {
    const key = faceKey(face.family, face.weight);
    if (!next.faces[key] || typeof next.faces[key] !== 'object') next.faces[key] = {};
    const unique = uniqueMatchingResource(next.resources, face, configDir);
    if (!unique) continue;
    for (const lang of langs) {
      if (typeof next.faces[key][lang] === 'string' && next.faces[key][lang].trim()) continue;
      next.faces[key][lang] = unique;
    }
  }
  return next;
}

export function buildFontQuestions(inventories, {
  languages,
  baseLanguage = 'cn',
  fonts = {},
  answeredFaces = new Set(),
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

function sourceLicenseOk(resource) {
  return typeof resource?.source === 'string' && resource.source.trim()
    && typeof resource?.license === 'string' && resource.license.trim();
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
      if (!sourceLicenseOk(resource)) {
        blockers.push({
          code: 'FONT_SOURCE',
          object: key,
          lang,
          missing: `缺来源或许可说明（资源 ${ref}）`,
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
      if (!needed) continue;
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
      langs[lang] = {
        resource: ref,
        family: identity?.family || null,
        weight: identity?.weight ?? null,
        axes: identity?.axes || {},
        digest: identity?.sha256 || null,
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
