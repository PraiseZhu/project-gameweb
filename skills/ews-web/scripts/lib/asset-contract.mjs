/**
 * Enumerate required locale × device image assets. Missing files fail closed.
 * Paths resolve against the asset-map directory. sha256, PNG chunks, fonts and media are checked.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, relative } from 'node:path';
import { isLegalImgLangAssetSet, resolveLocaleDeviceImage } from './image-language.mjs';
import { paintSliceIdsOf } from './paint-slices.mjs';
import { resolveInside, sanitizeFileToken } from './safe-fs.mjs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function recordOf(mapEnd, nodeId) {
  return mapEnd?.[nodeId] || null;
}

export function pngSize(buf) {
  if (!buf || buf.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i += 1) {
    if (buf[i] !== sig[i]) return null;
  }
  let offset = 8;
  let size = null;
  let iend = false;
  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    if (length < 0 || offset + 12 + length > buf.length) return null;
    if (type === 'IHDR') {
      if (length !== 13) return null;
      size = { width: buf.readUInt32BE(offset + 8), height: buf.readUInt32BE(offset + 12) };
    }
    if (type === 'IEND') {
      iend = true;
      break;
    }
    offset += 12 + length;
  }
  return iend ? size : null;
}

export function fontFormatOf(file, declared) {
  if (declared) return String(declared);
  const ext = extname(String(file || '')).toLowerCase();
  if (ext === '.woff2') return 'woff2';
  if (ext === '.woff') return 'woff';
  if (ext === '.ttf') return 'truetype';
  if (ext === '.otf') return 'opentype';
  return null;
}

function sliceTarget(doc, nodeId) {
  const nodes = [...(doc?.nodes || []), ...(doc?.attachments?.componentSets || []).flatMap((set) => set.variants || [])];
  const node = nodes.find((item) => String(item.id) === String(nodeId));
  const slice = node?.sliceExport;
  if (!slice?.box) return null;
  const scale = Number(slice.scale) || 1;
  return {
    width: Math.round(Number(slice.box.w) * scale),
    height: Math.round(Number(slice.box.h) * scale),
    scale,
  };
}

export function validateAssets({
  pack,
  assetMap,
  locales = ['zh-CN'],
  fonts = [],
  assetRoot = null,
} = {}) {
  const problems = [];
  if (!assetMap || assetMap.schema !== 'ews-assets/v1') {
    problems.push('asset-map schema 必须是 ews-assets/v1');
  }
  if (pack?.fingerprint && assetMap?.fingerprint && assetMap.fingerprint !== pack.fingerprint) {
    problems.push(`asset-map.fingerprint 与包不一致：${assetMap.fingerprint} vs ${pack.fingerprint}`);
  }
  const root = assetRoot;
  if (!root) problems.push('assetRoot 必须提供');
  const assets = { pc: {}, mobile: {}, fonts: [], media: {} };
  const localesList = asArray(locales);

  for (const end of pack?.ends || []) {
    const doc = pack.inventories?.[end];
    const graph = doc?.attachments?.componentSets || [];
    const byDevice = { [end]: graph };
    const mapEnd = assetMap?.[end] || assetMap?.assets?.[end] || {};
    const requiredIds = new Set(paintSliceIdsOf(doc || {}));

    for (const set of graph) {
      if (!isLegalImgLangAssetSet(set)) continue;
      for (const variant of asArray(set.variants)) {
        const componentId = variant.componentId || variant.id;
        for (const language of localesList) {
          const resolved = resolveLocaleDeviceImage({
            device: end,
            language,
            componentId,
            componentSetsByDevice: byDevice,
            assetsByDevice: { [end]: mapEnd },
            instanceProperties: variant.componentProperties,
          });
          if (resolved.status === 'not-applicable') continue;
          if (!resolved.ok) {
            problems.push(`${end}/${language}/${componentId}: ${resolved.reason}`);
            continue;
          }
          requiredIds.add(resolved.componentId);
        }
      }
    }

    for (const nodeId of requiredIds) {
      const rec = recordOf(mapEnd, nodeId);
      const path = rec?.path || rec;
      if (!path) {
        problems.push(`${end}/${nodeId}: 缺普通图或切图资源`);
        continue;
      }
      const inside = resolveInside(root, path);
      if (!inside.ok) {
        problems.push(`${end}/${nodeId}: ${inside.problem}`);
        continue;
      }
      if (!existsSync(inside.abs) || !statSync(inside.abs).isFile()) {
        problems.push(`${end}/${nodeId}: 缺 PNG ${path}`);
        continue;
      }
      const buf = readFileSync(inside.abs);
      const digest = sha256(buf);
      if (rec?.sha256 && rec.sha256 !== digest) {
        problems.push(`${end}/${nodeId}: sha256 与文件不符`);
      }
      const size = pngSize(buf);
      if (!size) problems.push(`${end}/${nodeId}: 不是完整可解码 PNG`);
      else {
        if (Number.isFinite(rec?.width) && rec.width !== size.width) problems.push(`${end}/${nodeId}: 宽度不符`);
        if (Number.isFinite(rec?.height) && rec.height !== size.height) problems.push(`${end}/${nodeId}: 高度不符`);
        const target = sliceTarget(doc, nodeId);
        if (target && (target.width !== size.width || target.height !== size.height)) {
          problems.push(`${end}/${nodeId}: PNG ${size.width}x${size.height} 与 sliceExport 1x 目标 ${target.width}x${target.height} 不符`);
        }
      }
      assets[end][nodeId] = {
        path: inside.abs,
        relative: relative(root, inside.abs).split('\\').join('/'),
        sha256: digest,
        width: size?.width ?? rec?.width ?? null,
        height: size?.height ?? rec?.height ?? null,
        nodeId,
      };
    }
  }

  const fontList = asArray(fonts).length ? fonts : asArray(assetMap?.fonts);
  const families = new Set();
  const fontIdentities = new Set();
  for (const font of fontList) {
    const file = font.file || font.path;
    const inside = file ? resolveInside(root, file) : { ok: false, problem: '缺字体路径' };
    if (!inside.ok || !existsSync(inside.abs)) {
      problems.push(`字体未登记或文件缺失：${font.family || file || '(空)'}${inside.ok ? '' : ` (${inside.problem})`}`);
      continue;
    }
    const format = fontFormatOf(file, font.format);
    if (!format) problems.push(`字体格式无法识别：${font.family || file}`);
    const fontBytes = readFileSync(inside.abs);
    const signature = fontBytes.subarray(0, 4).toString('latin1');
    const actualFormat = { wOF2: 'woff2', wOFF: 'woff', OTTO: 'opentype', '\u0000\u0001\u0000\u0000': 'truetype' }[signature];
    if (!actualFormat || actualFormat !== format) problems.push('字体签名与格式不符：' + font.family);
    const digest = sha256(fontBytes);
    if (font.sha256 && font.sha256 !== digest) problems.push(`字体 sha256 不符：${font.family}`);
    const weight = Number(font.weight) || 400;
    const identity = JSON.stringify([font.family, weight]);
    if (fontIdentities.has(identity)) problems.push('字体 family/weight 重复：' + identity);
    if (!Number.isInteger(weight) || weight < 1 || weight > 1000) problems.push('字体 weight 非法：' + weight);
    fontIdentities.add(identity);
    families.add(font.family);
    assets.fonts.push({
      family: font.family,
      weight,
      format,
      path: inside.abs,
      relative: relative(root, inside.abs).split('\\').join('/'),
      sha256: digest,
      ext: extname(String(file)).replace('.', '') || format,
    });
  }
  for (const end of pack?.ends || []) {
    for (const node of pack.inventories?.[end]?.nodes || []) {
      const family = node.text?.fontFamily;
      if (family && !families.has(family)) {
        problems.push(`${end}/${node.id}: 字体 ${family} 未登记`);
      }
    }
  }
  if (!fontList.length) {
    const usesText = (pack?.ends || []).some((end) => (
      (pack.inventories?.[end]?.nodes || []).some((node) => node.text?.fontFamily)
    ));
    if (usesText) problems.push('TEXT 使用了字体但 fonts 未登记');
  }

  for (const [key, rec] of Object.entries(assetMap?.media || {})) {
    const token = sanitizeFileToken(key, 'media key');
    if (!token.ok) {
      problems.push(token.problem);
      continue;
    }
    const path = rec?.path || rec;
    const inside = resolveInside(root, path);
    if (!inside.ok) {
      problems.push(`媒体路径非法：${key} ${inside.problem}`);
      continue;
    }
    if (!existsSync(inside.abs)) {
      problems.push(`媒体缺失：${key}`);
      continue;
    }
    const digest = sha256(readFileSync(inside.abs));
    if (rec?.sha256 && rec.sha256 !== digest) problems.push(`媒体 sha256 不符：${key}`);
    assets.media[key] = {
      path: inside.abs,
      relative: relative(root, inside.abs).split('\\').join('/'),
      sha256: digest,
      key,
    };
  }

  return { ok: problems.length === 0, assets, problems };
}

export function posixJoin(...parts) {
  return parts.join('/').replace(/\\/g, '/');
}
