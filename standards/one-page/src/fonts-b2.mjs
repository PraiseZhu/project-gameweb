import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve as pathResolve } from 'node:path';
import { LANG_CODES } from './validate-inputs.mjs';
import { missingGlyphs, fontHasWeight } from './cmap.mjs';
import {
  productNodes,
  nodeById,
  sectionNumberOf,
  insideRole,
  textCharacters,
} from './inventory-walk.mjs';
import { fingerprintOf } from './questions.mjs';

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

export function collectFaces(inventories) {
  const faces = new Map();
  for (const end of ['pc', 'mobile']) {
    const inv = inventories[end];
    if (!inv) continue;
    const byId = nodeById(inv);
    for (const node of productNodes(inv)) {
      if (node.text?.fontFamily == null && node.type !== 'TEXT') continue;
      if (insideRole(node, byId, ['img', 'bg', 'kv'])) continue;
      const family = node.text?.fontFamily;
      const weight = node.text?.fontWeight;
      if (!family || weight == null) continue;
      const key = faceKey(family, weight);
      if (!faces.has(key)) {
        faces.set(key, { family, weight, locations: [] });
      }
      faces.get(key).locations.push({
        end,
        section: sectionNumberOf(node, byId),
        nodeId: node.id,
        name: node.name || textCharacters(node).slice(0, 20),
        characters: textCharacters(node),
      });
    }
  }
  return [...faces.values()];
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

export function buildFontQuestions(inventories, {
  languages,
  baseLanguage = 'cn',
  fonts = {},
  answeredFaces = new Set(),
} = {}) {
  const foreign = (languages || LANG_CODES).filter((lang) => lang !== baseLanguage);
  const faces = collectFaces(inventories);
  const questions = [];
  const blockers = [];
  const mapping = fonts.faces || {};
  for (const face of faces) {
    const key = faceKey(face.family, face.weight);
    const current = mapping[key] && typeof mapping[key] === 'object' ? mapping[key] : {};
    const missingLangs = foreign.filter((lang) => {
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
      prompt: `中文字体 ${face.family} ${face.weight} 对应各外语字体。请按语言填写资源文件、字重、来源和授权。`,
      splitAllowed: false,
      langs: missingLangs,
      family: face.family,
      weight: face.weight,
    };
    questions.push({ ...body, fingerprint: fingerprintOf(body) });
  }
  return { questions, blockers, faces, foreign };
}

export function checkFontFiles({
  inventories,
  languages,
  baseLanguage = 'cn',
  fonts = {},
  configDir = null,
  textsByLang = {},
}) {
  const blockers = [];
  const fontInputs = [];
  const seenFiles = new Set();
  const faces = collectFaces(inventories);
  const mapping = fonts.faces || {};
  const resources = fonts.resources || {};
  const foreign = (languages || LANG_CODES).filter((lang) => lang !== baseLanguage);
  for (const face of faces) {
    const key = faceKey(face.family, face.weight);
    const current = mapping[key] || {};
    for (const lang of foreign) {
      const ref = current[lang];
      if (!ref) {
        blockers.push({
          code: 'FONT_UNSET',
          object: key,
          lang,
          missing: `外语字体未定：${key} → ${lang}`,
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
      if (!fontHasWeight(resource, face.weight)) {
        blockers.push({
          code: 'FONT_WEIGHT',
          object: key,
          lang,
          missing: `缺字重 ${face.weight}（资源 ${ref}）`,
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
      const needed = textsByLang[lang] || face.locations.map((item) => item.characters).join('');
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
        const hits = face.locations.filter((item) => missing.some((ch) => item.characters.includes(ch)));
        blockers.push({
          code: 'FONT_GLYPH',
          object: key,
          lang,
          missing: `缺字：${missing.join(' ')}`,
          glyphs: missing,
          locations: hits.length ? hits : face.locations,
        });
      }
    }
  }
  return { blockers, fontInputs };
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
