import { randomUUID } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { readCmapCodes } from './cmap.mjs';
import { canonicalJson } from './canonical.mjs';
import { inspectFontBytes } from './font-identity.mjs';
import { MAX_TOTAL_BYTES } from './font-unpack.mjs';

export const FONT_FORMATS = new Set(['ttf', 'otf', 'woff', 'woff2']);
export const licenseRisk = (text) => /非\s*商\s*用|不可商用|禁止商用|商用\s*(?:需|须|須|必须|必須|另行|要).{0,8}(?:授权|授權)|non[\s-]*commercial|not for commercial|personal use only|commercial use.{0,20}(?:requires?|subject to).{0,12}(?:permission|licen[cs]e)/iu.test(text || '');
const nonempty = (text) => typeof text === 'string' && Boolean(text.trim());
export const confirmedLicenseText = (text) => nonempty(text) && !licenseRisk(text)
  && !/^(?:未知|不详|待确认|待核实|无|unknown|pending|n.a)[\s。.!！]*$/iu.test(text.trim());
const validTime = (value) => nonempty(value) && Number.isFinite(Date.parse(value));

function stat(path) {
  try { return lstatSync(path); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  return null;
}

function directory(path, create = false) {
  if (!stat(path) && create) {
    try { mkdirSync(path, { recursive: true }); } catch (err) { if (err.code !== 'EEXIST') throw err; }
  }
  const info = stat(path);
  if (!info) return null;
  if (!info.isDirectory()) throw new Error('字体目录不是实际目录：' + path);
  return realpathSync(path);
}

export function readRegularFontFile(path, limit = MAX_TOTAL_BYTES) {
  const normalized = resolve(path);
  const info = lstatSync(normalized);
  if (!info.isFile() || realpathSync(normalized) !== normalized || info.size > limit) throw new Error('不是受支持的真实文件：' + path);
  const fd = openSync(normalized, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.size > limit || opened.ino !== info.ino || opened.dev !== info.dev) throw new Error('字体文件已变化：' + path);
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (bytes.length !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error('字体文件读取时已变化：' + path);
    return bytes;
  } finally { closeSync(fd); }
}

export function fileFontIdentity(path, bytes) {
  const identity = inspectFontBytes(bytes);
  if (!identity.ok || identity.packed || identity.fvarCorrupt || !FONT_FORMATS.has(identity.container)
    || extname(path).slice(1).toLowerCase() !== identity.container) throw new Error('字体真实身份、轴或容器无效');
  return identity;
}

export function readFontAsset(path) {
  const bytes = readRegularFontFile(path);
  return { path, bytes, identity: fileFontIdentity(path, bytes), coverage: readCmapCodes(bytes) };
}

function atomicBytes(path, bytes, replace = false) {
  if (!replace && stat(path)) {
    if (!readRegularFontFile(path).equals(bytes)) throw new Error('拒绝覆盖历史字体文件：' + path);
    return false;
  }
  const temp = join(dirname(path), '.font-tmp-' + randomUUID());
  try {
    writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600, flush: true });
    renameSync(temp, path);
    return true;
  } finally { if (stat(temp)) unlinkSync(temp); }
}

export function scanCache(libraryDir, next) {
  const root = directory(libraryDir, next !== undefined);
  if (!root) return {};
  const path = join(root, '.scan-cache.json');
  if (next !== undefined) {
    if (stat(path) && !stat(path).isFile()) throw new Error('扫描缓存不是普通文件');
    atomicBytes(path, Buffer.from(JSON.stringify({ version: 1, index: next }) + '\n'), true);
    return next;
  }
  try {
    const cache = JSON.parse(readRegularFontFile(path, 16 * 1024 * 1024));
    return cache?.version === 1 && cache.index && typeof cache.index === 'object' ? cache.index : {};
  } catch { return {}; }
}

function registry(root) {
  const path = join(root, 'registry.json');
  if (!stat(path)) return [];
  const value = JSON.parse(readRegularFontFile(path, 16 * 1024 * 1024));
  if (value?.version !== 1 || !Array.isArray(value.entries)) throw new Error('字体 registry 格式无效');
  return value.entries;
}

function fileNames(identity) {
  const slug = identity.family.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'font';
  const weight = identity.variable ? 'VF' : identity.weight;
  return { file: 'files/' + slug + '-' + weight + '-' + identity.sha256.slice(0, 8) + '.' + identity.container,
    licenseFile: 'licenses/' + identity.sha256 + '.txt' };
}

function checkedEntry(root, entry) {
  if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256) || !nonempty(entry.source) || !validTime(entry.confirmedAt)
    || entry.licenseStatus !== 'commercial-confirmed' || !nonempty(entry.evidence) || !confirmedLicenseText(entry.license)) throw new Error('字体登记或许可状态无效');
  if (typeof entry.file !== 'string' || !/^files\/[a-z0-9-]+-(?:VF|[0-9]+)-[a-f0-9]{8}\.(?:ttf|otf|woff2?)$/.test(entry.file)
    || entry.licenseFile !== 'licenses/' + entry.sha256 + '.txt') throw new Error('字体登记路径异常');
  const asset = readFontAsset(join(root, entry.file));
  const { identity } = asset;
  const paths = fileNames(identity);
  if (entry.file !== paths.file || entry.sha256 !== identity.sha256 || canonicalJson(entry.identity) !== canonicalJson(identity)) throw new Error('登记与真实字体不一致');
  if (!readRegularFontFile(join(root, entry.licenseFile), 1024 * 1024).equals(Buffer.from(entry.license))) throw new Error('许可证文件与登记不一致');
  return asset;
}

export function readFontLibrary(libraryDir) {
  try {
    const root = directory(libraryDir);
    if (!root) return { entries: [] };
    return { entries: registry(root).map((entry) => {
      try { return { entry, asset: checkedEntry(root, entry) }; }
      catch (error) { return { entry, error: error.message }; }
    }) };
  } catch (error) { return { entries: [], error: error.message }; }
}

export function registerFonts(libraryDir, approvals, at) {
  if (!approvals.length) return;
  const root = directory(libraryDir, true);
  const lock = join(root, '.registry-lock');
  mkdirSync(lock);
  const newFiles = [];
  const confirmed = new Map();
  try {
    const entries = registry(root);
    directory(join(root, 'files'), true);
    directory(join(root, 'licenses'), true);
    for (const { asset, license, evidence, source } of approvals) {
      const { identity, bytes } = asset;
      if (!confirmedLicenseText(license) || Buffer.byteLength(license) > 1024 * 1024
        || !nonempty(evidence) || !nonempty(source) || !validTime(at)) throw new Error('必须明确确认可商用且可随网页交付，并给出许可说明与依据');
      const { file, licenseFile } = fileNames(identity);
      const existing = entries.filter((item) => item?.sha256 === identity.sha256);
      if (existing.length) {
        if (existing.length !== 1) throw new Error('登记 SHA 重复');
        checkedEntry(root, existing[0]);
        if (existing[0].license !== license) throw new Error('同一字体已登记不同许可，须先核对现有登记');
        confirmed.set(identity.sha256, existing[0]);
        continue;
      }
      for (const [name, content] of [[file, bytes], [licenseFile, Buffer.from(license)]]) {
        const path = join(root, name);
        if (atomicBytes(path, content)) newFiles.push(path);
      }
      const entry = { file, licenseFile, sha256: identity.sha256, identity, source, origin: asset.path, license, evidence, confirmedAt: at, licenseStatus: 'commercial-confirmed' };
      checkedEntry(root, entry);
      entries.push(entry);
      confirmed.set(identity.sha256, entry);
    }
    atomicBytes(join(root, 'registry.json'), Buffer.from(JSON.stringify({ version: 1, entries }, null, 2) + '\n'), true);
    return confirmed;
  } catch (error) {
    for (const path of newFiles) unlinkSync(path);
    throw error;
  } finally { rmdirSync(lock); }
}

export function projectFontPath(identity) {
  return '.font-library/' + identity.sha256 + '.' + identity.container;
}

export function copyProjectFont(configDir, asset) {
  const root = directory(configDir, true);
  directory(join(root, '.font-library'), true);
  atomicBytes(join(root, projectFontPath(asset.identity)), asset.bytes);
}
