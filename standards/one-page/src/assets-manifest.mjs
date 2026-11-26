import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { canonicalJson, sha256Hex } from './canonical.mjs';
import { byteDigest, isDigest, safeRelative } from './handoff-check.mjs';

export const ASSET_SCHEMA = 'onepage-c-assets/v1';
export const ASSET_MANIFEST = 'assets/manifest.json';
export const ASSET_STAGE = 'stage-record.json';
export const RETENTION = ['original', 'backup', 'history'];
const VIDEO = /\.(mp4|webm|mov|m4v|ogv|avi|mkv)$/i;
const same = (left, right) => canonicalJson(left) === canonicalJson(right);

export class AssetError extends Error {}

export function requireAssets(condition, message) {
  if (!condition) throw new AssetError(message);
}

function walkFiles(root, namesOf, validPath, prefix = '') {
  requireAssets(lstatSync(root).isDirectory(), '素材根目录必须是普通目录');
  const paths = [];
  for (const name of namesOf(join(root, prefix)).sort()) {
    const path = prefix ? prefix + '/' + name : name;
    requireAssets(validPath(path), '素材目录含不合法路径');
    const stat = lstatSync(join(root, path));
    if (stat.isDirectory()) paths.push(...walkFiles(root, namesOf, validPath, path));
    else {
      requireAssets(stat.isFile(), '素材目录只允许普通文件');
      paths.push(path);
    }
  }
  return paths;
}

export function filesUnder(root) {
  return walkFiles(root, readdirSync, safeRelative);
}

export function retainedFilesUnder(root) {
  const namesOf = (dir) => readdirSync(dir, { encoding: 'buffer' }).map((bytes) => {
    const name = bytes.toString('utf8');
    requireAssets(Buffer.from(name).equals(bytes), 'H23 路径必须是有效 UTF-8');
    return name;
  });
  const validPath = (path) => path.split('/').every((part) => part && part !== '.' && part !== '..'
    && ![...part].some((char) => char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127));
  return walkFiles(root, namesOf, validPath);
}

export function describeFile(root, path) {
  const bytes = readFileSync(join(root, path));
  return { path, bytes: bytes.length, sha256: byteDigest(bytes) };
}

export function measureAssets(entries) {
  const totalBytes = entries.reduce((sum, item) => sum + item.bytes, 0);
  const warnings = entries.filter((item) => VIDEO.test(item.path) && item.bytes > 15_000_000)
    .map(({ path, bytes }) => ({ code: 'VIDEO_SIZE', path, bytes, limit: 15_000_000 }));
  if (totalBytes > 120_000_000) warnings.push({ code: 'DIRECTORY_SIZE', bytes: totalBytes, limit: 120_000_000 });
  return { totalBytes, warnings };
}

export const assetInputs = ({ b3 }) => [{ kind: 'b-handoff', version: b3.version, digest: b3.manifestSha256, scopeVersion: b3.scopeVersion }];

export function checkAssets({ pack, expectVersion, scopeVersion, beforePublish = false }) {
  try {
    requireAssets(isDigest(expectVersion) && isDigest(scopeVersion), '必须外传 C1 版本和范围版本');
    requireAssets(beforePublish || !basename(pack).startsWith('.c1-writing-'), '暂存目录不是已发布包');
    const paths = filesUnder(pack).sort();
    requireAssets(paths.includes(ASSET_MANIFEST) && paths.includes(ASSET_STAGE), '缺少素材清单或环节记录');
    const manifestBytes = readFileSync(join(pack, ASSET_MANIFEST));
    const { version, ...body } = JSON.parse(manifestBytes);
    requireAssets(body.schema === ASSET_SCHEMA && version === expectVersion && version === sha256Hex(body)
      && body.b3?.scopeVersion === scopeVersion && isDigest(body.b3.version) && isDigest(body.b3.manifestSha256), 'C1 版本、范围或上游绑定不一致');
    const stage = JSON.parse(readFileSync(join(pack, ASSET_STAGE)));
    const { version: stageVersion, ...stageBody } = stage;
    requireAssets(stageVersion === sha256Hex(stageBody) && stage.stage === 'C' && stage.result === 'pass'
      && Number.isInteger(stage.round) && stage.round > 0 && same(stage.inputs, assetInputs(body))
      && same(stage.output, { kind: 'c-assets', path: ASSET_MANIFEST, version, digest: byteDigest(manifestBytes) }), 'C1 环节记录损坏或未绑定清单');
    const files = [...body.assets.flatMap((item) => [item, ...(item.original ? [item.original] : [])]),
      ...body.fonts.flatMap((font) => [font, font.license]), ...body.retained];
    const listed = new Set([ASSET_MANIFEST, ASSET_STAGE]);
    for (const file of files) {
      requireAssets(safeRelative(file.path) && !listed.has(file.path) && paths.includes(file.path), '素材文件路径缺失、重复或非法');
      listed.add(file.path);
      requireAssets(same(describeFile(pack, file.path), { path: file.path, bytes: file.bytes, sha256: file.sha256 }), '素材大小或 SHA-256 不符');
    }
    requireAssets(listed.size === paths.length && same(body.measurement, measureAssets(files)), '存在未登记的文件或体积计量不一致');
    return { ok: true, manifest: { version, ...body }, stage };
  } catch (error) {
    return { ok: false, message: 'C1 验包失败：' + error.message };
  }
}
