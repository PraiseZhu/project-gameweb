import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { canonicalJson, sha256Hex } from './canonical.mjs';

export const DELTA_SCHEMA = 'onepage-b-delta/v1';
export const DELTA_STAGE_KIND = 'b-delta-handoff';
export const CHANGE_KINDS = Object.freeze([
  'asset-visual-only', 'layout-impacted', 'non-figma-config-or-copy',
  'upgrade-to-full-pack', 'unlocated-version-change',
]);
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const safeRelative = (value) => typeof value === 'string' && value.length > 0 && !value.startsWith('/')
  && !/^[A-Za-z]:[\\/]/.test(value) && value.split('/').every((part) => part && part !== '.' && part !== '..');
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const isSymlink = (path) => { try { return lstatSync(path).isSymbolicLink(); } catch { return false; } };
function requireAt(condition, location, reason) { if (!condition) throw Object.assign(new Error(reason), { location }); }
function plainFile(root, relative) { const path = join(root, relative); requireAt(existsSync(path), relative, '包内文件不存在'); const stat = lstatSync(path); requireAt(stat.isFile() && !stat.isSymbolicLink(), relative, '包内文件必须是普通文件且不能是符号链接'); const realRoot = resolve(root); const realFile = resolve(path); requireAt(realFile === realRoot || realFile.startsWith(realRoot + sep), relative, '包内文件真实路径越界'); return path; }
function verifyStage(stage, manifest, manifestBytes) {
  requireAt(object(stage), 'stage-record.json', '环节记录不是对象');
  const { version, ...body } = stage;
  requireAt(version === sha256Hex(body), 'stage-record.json', '环节记录版本号对不上');
  requireAt(stage.stage === 'B' && stage.round === 1 && stage.result === 'pass', 'stage-record.json', '变化包环节记录状态不对');
  requireAt(stage.output?.kind === DELTA_STAGE_KIND && stage.output.path === 'delta-manifest.json', 'stage-record.json', '变化包输出声明不对');
  requireAt(stage.output.version === manifest.newPackVersion && stage.output.digest === sha256Hex(manifestBytes), 'stage-record.json', '变化包输出摘要不对');
  return stage;
}
export function checkDelta({ pack, expectVersion, scopeVersion, basePackVersion, beforePublish = false } = {}) {
  try {
    requireAt(typeof pack === 'string' && pack.length, '调用参数', '必须提供变化包目录');
    const root = resolve(pack);
    requireAt(existsSync(root) && lstatSync(root).isDirectory() && !isSymlink(root), '包目录', '变化包目录无效');
    requireAt(beforePublish || basename(root).startsWith('b4.r'), '包目录', '变化包目录必须是 b4.rN');
    const actual = readdirSync(root).sort();
    requireAt(same(actual, ['delta-manifest.json', 'stage-record.json']), '包目录', '包内存在缺失或未授权文件');
    const manifestPath = plainFile(root, 'delta-manifest.json');
    const stagePath = plainFile(root, 'stage-record.json');
    const manifestBytes = readFileSync(manifestPath);
    const manifest = JSON.parse(manifestBytes.toString());
    const { version, newPackVersion, ...body } = manifest;
    requireAt(manifest.schema === DELTA_SCHEMA, 'delta-manifest.json', '变化包 schema 不支持');
    requireAt(digest(version) && digest(newPackVersion) && version === newPackVersion && version === sha256Hex(body), 'delta-manifest.json', '变化包版本摘要不一致');
    if (expectVersion != null) requireAt(expectVersion === version, 'delta-manifest.json', '变化包版本与外部预期不符');
    requireAt(digest(manifest.basePackVersion) && digest(manifest.basePackDigest), 'delta-manifest.json', '缺少 B3 基线版本或摘要');
    if (basePackVersion != null) requireAt(basePackVersion === manifest.basePackVersion, 'delta-manifest.json', '变化包未绑定调用方指定的 B3 基线');
    requireAt(digest(manifest.scopeVersion) && digest(manifest.baseScopeVersion) && (scopeVersion == null || scopeVersion === manifest.scopeVersion || scopeVersion === manifest.baseScopeVersion), 'delta-manifest.json', '范围版本与外部预期不符');
    requireAt(CHANGE_KINDS.includes(manifest.changeKind), 'delta-manifest.json', '变化分类不支持');
    for (const key of ['affectedModules', 'affectedAssets', 'affectedLanguages', 'affectedSharedDeps', 'whiteboxScope', 'blackboxGuide', 'manualTweakAnchors']) requireAt(manifest[key] !== undefined, 'delta-manifest.json', '变化包缺少 ' + key);
    requireAt(Array.isArray(manifest.affectedModules) && Array.isArray(manifest.affectedAssets) && Array.isArray(manifest.affectedLanguages) && Array.isArray(manifest.affectedSharedDeps) && Array.isArray(manifest.manualTweakAnchors) && object(manifest.whiteboxScope) && object(manifest.blackboxGuide), 'delta-manifest.json', '变化包字段类型不对');
    for (const anchor of manifest.manualTweakAnchors) requireAt(object(anchor) && digest(anchor.basePackVersion) && anchor.basePackVersion === manifest.basePackVersion, 'delta-manifest.json', '人工微调锚点必须显式绑定当前 B3 基线');
    const walk = (value, path = '') => {
      if (Array.isArray(value)) value.forEach((item, index) => walk(item, path + '[' + index + ']'));
      else if (object(value)) for (const [key, item] of Object.entries(value)) {
        if (/path$/i.test(key) && item != null && typeof item === 'string') requireAt(safeRelative(item), path + '.' + key, '变化包含绝对或越界路径');
        walk(item, path + '.' + key);
      }
    };
    walk(manifest);
    const stage = JSON.parse(readFileSync(stagePath, 'utf8'));
    verifyStage(stage, manifest, manifestBytes);
    return { ok: true, location: manifestPath, manifest, stage, manifestSha256: sha256Hex(manifestBytes) };
  } catch (error) { return { ok: false, location: error.location ?? pack, message: error.message }; }
}
