/**
 * cmap of the face the page actually paints vs authored TEXT characters.
 *
 * Figma REST only names the layer family (e.g. NotoSans-SemiCondensed). It does
 * not record the OS fallback Figma used for missing glyphs. The renderer paints
 * that fallback explicitly: Hangul → local() Apple SD Gothic Neo; CJK on a
 * latin subset → registered YouHei / Noto CJK; SemiCondensed latin stays on
 * the registered static face.
 *
 * This gate fail-closes on uncovered code points of the painted face. It must
 * not treat the layer family name as the painted face, and must not copy a
 * system TTC into git or assets/.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const CMAP_CACHE = new Map();

const SKIP_CP = (cp) => (
  cp <= 0x20
  || cp === 0x7f
  || (cp >= 0x200b && cp <= 0x200d)
  || cp === 0x2028
  || cp === 0x2029
  || cp === 0xfeff
);

export function codepointsToCover(text) {
  const out = new Set();
  for (const ch of String(text || '')) {
    const cp = ch.codePointAt(0);
    if (!Number.isFinite(cp) || SKIP_CP(cp)) continue;
    out.add(cp);
  }
  return [...out];
}

export function uncoveredCodepoints(cmap, text) {
  const set = cmap instanceof Set ? cmap : new Set(cmap || []);
  return codepointsToCover(text).filter((cp) => !set.has(cp));
}

export function isSourceSemiCondensed(text = {}) {
  const style = String(text.fontStyle || '').toLowerCase();
  const ps = String(text.fontPostScriptName || '').toLowerCase();
  return style.includes('semicondensed') || ps.includes('semicondensed');
}

export const PAINTED_HANGUL_FACE = 'FX Apple SD Gothic Neo';
export const PAINTED_CJK_FAMILY_CANDIDATES = Object.freeze([
  'FZVariable-YouHeiS WT W H',
  'Noto Sans SC',
  'Noto Sans TC',
  'Noto Sans HK',
]);

export function isHangulCodepoint(cp) {
  return Number(cp) >= 0xac00 && Number(cp) <= 0xd7af;
}

export function isCjkCodepoint(cp) {
  const n = Number(cp);
  return (n >= 0x3000 && n <= 0x303f)
    || (n >= 0x3400 && n <= 0x9fff)
    || (n >= 0xf900 && n <= 0xfaff)
    || (n >= 0xff00 && n <= 0xffef)
    || (n >= 0x20000 && n <= 0x2ceaf);
}

/**
 * Split one TEXT node's characters onto the faces the renderer actually
 * paints. Hangul never stays on a registered latin/CJK subset; CJK never
 * stays on a latin-only Noto Sans; SemiCondensed latin stays on the
 * registered static face.
 */
export function paintedCoveragePlan(text = {}, registeredFamilies = new Set()) {
  const sourceFamily = String(text.fontFamily || '');
  const characters = String(text.characters || '');
  const cps = codepointsToCover(characters);
  const buckets = new Map();
  const add = (family, cp) => {
    if (!family) return;
    if (!buckets.has(family)) buckets.set(family, []);
    buckets.get(family).push(cp);
  };
  const firstRegistered = (...names) => names.find((name) => registeredFamilies.has(name)) || null;
  const cjkFamily = firstRegistered(...PAINTED_CJK_FAMILY_CANDIDATES);
  const semi = isSourceSemiCondensed(text) && registeredFamilies.has('Noto Sans SemiCondensed');
  const cjkOnLatinSubset = semi || sourceFamily === 'Noto Sans' || sourceFamily === 'Noto Serif SC';
  for (const cp of cps) {
    if (isHangulCodepoint(cp)) add(PAINTED_HANGUL_FACE, cp);
    else if (isCjkCodepoint(cp) && cjkOnLatinSubset) add(cjkFamily || sourceFamily, cp);
    else if (semi) add('Noto Sans SemiCondensed', cp);
    else add(sourceFamily, cp);
  }
  return [...buckets.entries()].map(([family, codepoints]) => ({ family, codepoints }));
}

export function formatUncovered(codepoints, { limit = 16 } = {}) {
  const cps = [...codepoints];
  const shown = cps.slice(0, limit).map((cp) => {
    const hex = cp.toString(16).toUpperCase().padStart(4, '0');
    return `U+${hex} ${String.fromCodePoint(cp)}`;
  });
  return { shown, extra: Math.max(0, cps.length - shown.length), count: cps.length };
}

function pythonBin() {
  for (const bin of ['python3', 'python']) {
    const probe = spawnSync(bin, ['-c', 'import fontTools.ttLib'], {
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
    });
    if (probe.status === 0) return bin;
  }
  return null;
}

const READ_CMAP_PY = [
  'import json, sys',
  'from fontTools.ttLib import TTFont, TTCollection',
  'path = sys.argv[1]',
  'font = TTCollection(path).fonts[0] if path.lower().endswith(".ttc") else TTFont(path, lazy=True)',
  'cmap = font.getBestCmap() or {}',
  'print(json.dumps([int(cp) for cp in cmap]))',
].join('; ');

export function readCmapSet(fontPath) {
  const path = resolve(fontPath);
  if (CMAP_CACHE.has(path)) {
    const cached = CMAP_CACHE.get(path);
    if (cached instanceof Error) throw cached;
    return cached;
  }
  if (!existsSync(path)) {
    const err = new Error(`字体文件不在：${path}`);
    CMAP_CACHE.set(path, err);
    throw err;
  }
  const bin = pythonBin();
  if (!bin) {
    const err = new Error('无法读取 cmap：本机没有 Python fontTools（pack 子集化同一依赖）');
    CMAP_CACHE.set(path, err);
    throw err;
  }
  const result = spawnSync(bin, ['-c', READ_CMAP_PY, path], {
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const err = new Error(`无法读取 cmap：${(result.stderr || result.stdout || 'fontTools 失败').trim()}`);
    CMAP_CACHE.set(path, err);
    throw err;
  }
  let cps;
  try {
    cps = JSON.parse(String(result.stdout || '[]'));
  } catch (error) {
    const err = new Error(`无法读取 cmap：fontTools 输出不是 JSON（${error.message}）`);
    CMAP_CACHE.set(path, err);
    throw err;
  }
  const set = new Set((cps || []).map((cp) => Number(cp)).filter((cp) => Number.isFinite(cp)));
  CMAP_CACHE.set(path, set);
  return set;
}

export function missingGlyphsInFont(fontPath, textOrCodepoints) {
  const want = Array.isArray(textOrCodepoints)
    ? textOrCodepoints.filter((cp) => Number.isFinite(Number(cp)) && !SKIP_CP(Number(cp))).map(Number)
    : codepointsToCover(textOrCodepoints);
  if (!want.length) return [];
  const cmap = readCmapSet(fontPath);
  return want.filter((cp) => !cmap.has(cp));
}

export function resetCmapCacheForTests() {
  CMAP_CACHE.clear();
}

const NAME_CACHE = new Map();
const READ_NAME_PY = `
import json, sys
from fontTools.ttLib import TTFont
font = TTFont(sys.argv[1], lazy=True)
name = font['name']
ids = {}
for rec in name.names:
    if rec.nameID not in (1, 2, 4, 6):
        continue
    try:
        val = rec.toUnicode()
    except Exception:
        continue
    ids.setdefault(str(rec.nameID), val)
print(json.dumps(ids))
`.trim();

export function readFontNameIdentity(fontPath) {
  const path = resolve(fontPath);
  if (NAME_CACHE.has(path)) {
    const cached = NAME_CACHE.get(path);
    if (cached instanceof Error) throw cached;
    return cached;
  }
  if (!existsSync(path)) {
    const err = new Error(`字体文件不在：${path}`);
    NAME_CACHE.set(path, err);
    throw err;
  }
  const bin = pythonBin();
  if (!bin) {
    const err = new Error('无法读取 name 表：本机没有 Python fontTools');
    NAME_CACHE.set(path, err);
    throw err;
  }
  const result = spawnSync(bin, ['-c', READ_NAME_PY, path], {
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const err = new Error(`无法读取 name 表：${(result.stderr || result.stdout || 'fontTools 失败').trim()}`);
    NAME_CACHE.set(path, err);
    throw err;
  }
  let ids;
  try {
    ids = JSON.parse(String(result.stdout || '{}'));
  } catch (error) {
    const err = new Error(`无法读取 name 表：${error.message}`);
    NAME_CACHE.set(path, err);
    throw err;
  }
  const identity = {
    family: ids['1'] || '',
    subfamily: ids['2'] || '',
    fullName: ids['4'] || '',
    postScriptName: ids['6'] || '',
  };
  NAME_CACHE.set(path, identity);
  return identity;
}

export function resetNameCacheForTests() {
  NAME_CACHE.clear();
}

export function semiCondensedIdentityOk(identity = {}) {
  const blob = `${identity.family || ''} ${identity.subfamily || ''} ${identity.fullName || ''} ${identity.postScriptName || ''}`.toLowerCase();
  if (/notosanskr|noto sans kr/.test(blob) && !/semicondensed/.test(blob)) return false;
  return /semicondensed|semi condensed|semi-condensed/.test(blob);
}

export const APPLE_SD_GOTHIC_LOCAL_PATHS = Object.freeze([
  '/System/Library/Fonts/AppleSDGothicNeo.ttc',
  '/Library/Fonts/AppleSDGothicNeo.ttc',
]);

export function appleSdGothicLocalAvailable(paths = APPLE_SD_GOTHIC_LOCAL_PATHS) {
  return (paths || []).some((p) => existsSync(p));
}

export function hangulLocalFallbackStatus({
  localAvailable,
  nodes = [],
} = {}) {
  const hit = (nodes || []).filter((n) => {
    const chars = String(n.characters || n.chars || '');
    return /한|한글|Hangul/i.test(chars) || [...chars].some((ch) => {
      const cp = ch.codePointAt(0);
      return cp >= 0xac00 && cp <= 0xd7af;
    });
  });
  if (localAvailable) {
    return { unverified: false, localAvailable: true, nodes: hit };
  }
  return {
    unverified: true,
    localAvailable: false,
    nodes: hit,
    why: 'local() Apple SD Gothic Neo 不可用，韩文未验证，不能当已验收',
  };
}
