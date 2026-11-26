import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, extname, join, resolve, win32 } from 'node:path';
import { fileFontIdentity, FONT_FORMATS, licenseRisk, readRegularFontFile, scanCache } from './font-library.mjs';
import { inspectFontStructure } from './font-inspect.mjs';

export function defaultFontDirectories({ platform = process.platform, home = homedir(), env = process.env } = {}) {
  if (platform === 'darwin') return [{ path: join(home, 'Library', 'Fonts'), system: false }, { path: '/Library/Fonts', system: true }];
  if (platform === 'win32') return [{ path: win32.join(env.WINDIR || env.SystemRoot || 'C:/Windows', 'Fonts'), system: true }];
  return [];
}

function statKey(path) {
  const info = lstatSync(path);
  if (!info.isFile()) return null;
  return [info.size, info.mtimeMs, info.ctimeMs, info.ino, info.dev].join(':');
}

function* fontFiles(root) {
  let children;
  try { children = readdirSync(root, { withFileTypes: true }); } catch { return; }
  children.sort((left, right) => left.name.localeCompare(right.name));
  for (const child of children) {
    const path = join(root, child.name);
    if (child.isDirectory()) yield* fontFiles(path);
    else if (child.isFile() && FONT_FORMATS.has(extname(path).slice(1).toLowerCase())) yield path;
  }
}

export function scanFonts({ libraryDir, directories = process.env.ONEPAGE_FONT_DIRS?.split(delimiter).filter(Boolean) ?? defaultFontDirectories() }) {
  let previous = {};
  try { previous = scanCache(libraryDir); } catch {}
  const index = new Map();
  const next = Object.create(null);
  let cacheHits = 0;
  for (const directory of directories) {
    const spec = typeof directory === 'string' ? { path: directory } : directory;
    let root;
    try {
      if (!lstatSync(spec.path).isDirectory()) continue;
      root = realpathSync(spec.path);
    } catch { continue; }
    const normalized = root.split(win32.sep).join('/').toLowerCase();
    const system = Boolean(spec.system) || /(?:^|\/)(?:windows\/fonts|system\/library\/fonts|library\/fonts\/system)(?:\/|$)/.test(normalized)
      || normalized === '/library/fonts';
    for (const path of fontFiles(root)) {
      const visited = index.get(path);
      if (visited) { visited.system ||= system; continue; }
      try {
        const signature = statKey(path);
        if (!signature) continue;
        const old = previous[path];
        let identity;
        if (old?.signature === signature && typeof old.identity?.family === 'string' && /^[a-f0-9]{64}$/.test(old.identity.sha256)) {
          identity = old.identity;
          cacheHits += 1;
        } else identity = fileFontIdentity(path, readRegularFontFile(path));
        next[path] = { signature, identity };
        index.set(path, { path, identity, system });
      } catch {}
    }
  }
  if (index.size || Object.keys(previous).length) {
    try { scanCache(libraryDir, next); } catch {}
  }
  return { index: [...index.values()], cacheHits };
}

function nameLicenses(bytes) {
  const structure = inspectFontStructure(bytes);
  const name = structure.tables?.name;
  if (!name || name.length < 6) return [];
  const table = structure.sfnt.subarray(name.offset, name.offset + name.length);
  const count = table.readUInt16BE(2);
  const stringOffset = table.readUInt16BE(4);
  if (stringOffset < 6 + count * 12 || stringOffset > table.length) return [];
  const values = new Set();
  for (let index = 0; index < count; index += 1) {
    const record = 6 + index * 12;
    if (table.readUInt16BE(record + 6) !== 13) continue;
    const platform = table.readUInt16BE(record);
    const length = table.readUInt16BE(record + 8);
    const start = stringOffset + table.readUInt16BE(record + 10);
    if (!length || start + length > table.length) continue;
    const value = table.subarray(start, start + length);
    if ((platform === 0 || platform === 3) && length % 2 === 0) values.add(Buffer.from(value).swap16().toString('utf16le').trim());
    else if (platform === 1) values.add(value.toString('latin1').trim());
  }
  return [...values].filter(Boolean);
}

export function scanLicense({ path, bytes }, system = false) {
  const texts = nameLicenses(bytes);
  try {
    const sidecar = readRegularFontFile(resolve(path + '.license.txt'), 1024 * 1024).toString('utf8').trim();
    if (sidecar) texts.push(sidecar);
  } catch {}
  const warnings = [];
  if (system) warnings.push('系统字体：确认允许商用和网页再分发前不得使用');
  if (texts.some(licenseRisk)) warnings.push('许可出现非商用或商用需授权等限制');
  if (!texts.some((text) => /open font license|\bOFL\b|apache license|public domain|可商用/iu.test(text) && !licenseRisk(text))) warnings.push('商用及网页再分发许可未知');
  return { warnings, licenseTexts: [...new Set(texts)].map((text) => text.slice(0, 2000)) };
}
