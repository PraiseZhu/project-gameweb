import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { ASSET_MANIFEST, ASSET_SCHEMA, describeFile, requireAssets } from './assets-manifest.mjs';
import { canonicalJson, sha256Hex } from './canonical.mjs';
import { byteDigest, isDigest, safeRelative } from './handoff-check.mjs';

export const PAGE_KIND = 'c-page-generate';
export const PAGE_SCHEMA = 'onepage-c-page/v1';
export const PAGE_META = 'c2-build-meta.json';
export const PAGE_STAGE = 'stage-record.json';
export const validLanguage = (value) => typeof value === 'string' && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value);
export const pageFiles = (lang) => [lang + '.html', 'css/styles.css', 'css/mobile.css', 'css/locales.css',
  'js/config.js', 'js/main.js', 'README.md', ASSET_MANIFEST];
export const itemDigest = ({ bytes, sha256 }) => ({ bytes, sha256 });
export const assetFiles = (asset) => [...asset.assets.flatMap((item) => item.original ? [item, item.original] : [item]),
  ...asset.fonts.flatMap((font) => [font, font.license]), ...asset.retained];

export function pageInputs(meta) {
  return [meta.b3, meta.c1].map(({ kind, version, digest }) => ({ kind, version, digest, scopeVersion: meta.scopeVersion }));
}

export function listPageFiles(root, prefix = '') {
  requireAssets(lstatSync(join(root, prefix)).isDirectory(), 'C2 只接受普通目录');
  return readdirSync(join(root, prefix)).sort().flatMap((name) => {
    const path = prefix + name;
    requireAssets(safeRelative(path), 'C2 路径非法');
    const stat = lstatSync(join(root, path));
    if (stat.isDirectory()) {
      requireAssets(['page','page/css','page/css/font','page/js','page/assets'].includes(path) || path.startsWith('page/assets/'), 'C2 未知目录');
      const nested = listPageFiles(root, path + '/');
      requireAssets(nested.length > 0, 'C2 不接受清单外空目录');
      return nested;
    }
    requireAssets(stat.isFile(), 'C2 只接受实际普通文件');
    return [path];
  });
}

const same = (left, right) => canonicalJson(left) === canonicalJson(right);

export function checkPage({ pack, expectVersion, scopeVersion, beforePublish = false }) {
  try {
    requireAssets(isDigest(expectVersion) && isDigest(scopeVersion), '必须外传 C2 版本及范围');
    requireAssets(beforePublish || !basename(pack).startsWith('.c2-writing-'), 'C2 暂存目录不能验收');
    const paths = listPageFiles(pack);
    requireAssets([PAGE_STAGE, PAGE_META].every((path) => paths.includes(path)), 'C2 缺阶段记录或制作追溯');
    const bytes = readFileSync(join(pack, PAGE_META));
    const { version, ...body } = JSON.parse(bytes);
    requireAssets(body.schema === PAGE_SCHEMA && version === expectVersion && sha256Hex(body) === version
      && body.scopeVersion === scopeVersion && validLanguage(body.baseLanguage), 'C2 版本、范围或语言不匹配');
    requireAssets(body.b3?.kind === 'b-handoff' && body.c1?.kind === 'c-assets'
      && pageInputs(body).every(({ version: upstream, digest }) => isDigest(upstream) && isDigest(digest)), 'C2 缺上游绑定');
    const manifestPath = 'page/' + ASSET_MANIFEST;
    requireAssets(paths.includes(manifestPath), 'C2 缺素材清单');
    const assetBytes = readFileSync(join(pack, manifestPath));
    const { version: assetVersion, ...assetBody } = JSON.parse(assetBytes);
    requireAssets(assetBody.schema === ASSET_SCHEMA && byteDigest(assetBytes) === body.c1.digest && assetVersion === body.c1.version
      && sha256Hex(assetBody) === assetVersion && assetBody.baseLanguage === body.baseLanguage && same(assetBody.b3,
        { version: body.b3.version, scopeVersion, manifestSha256: body.b3.digest }), 'C2 素材清单与 B3/C1 不匹配');
    const assets = assetFiles(assetBody);
    const expected = [...pageFiles(body.baseLanguage), ...assets.map((item) => item.path)].map((path) => 'page/' + path);
    requireAssets(expected.every(safeRelative) && new Set(expected).size === expected.length
      && same(paths.sort(), [...expected, PAGE_META, PAGE_STAGE].sort()) && same(Object.keys(body.files).sort(), expected.sort()), 'C2 成品结构与清单不一致');
    for (const item of assets) requireAssets(same(body.files['page/' + item.path], itemDigest(item)), 'C2 素材摘要不匹配');
    for (const path of expected) requireAssets(same(describeFile(pack, path), { path, ...body.files[path] }), 'C2 文件大小或 SHA-256 不一致');
    const stage = JSON.parse(readFileSync(join(pack, PAGE_STAGE)));
    const { version: stageVersion, ...stageBody } = stage;
    requireAssets(stageVersion === sha256Hex(stageBody) && stage.stage === 'C' && stage.result === 'pass'
      && Number.isSafeInteger(stage.round) && stage.round > 0 && same(stage.inputs, pageInputs(body))
      && same(stage.output, { kind: PAGE_KIND, version, path: PAGE_META, digest: byteDigest(bytes) }), 'C2 环节记录未绑定成品');
    return { ok: true, record: stage, manifest: { ...body, version } };
  } catch (error) {
    return { ok: false, reason: 'C2 验包失败：' + error.message };
  }
}

export function checkPageEntry(recordPath, options) {
  if (options.expectedStage !== 'C' || basename(recordPath) !== PAGE_STAGE) return { ok: false, reason: 'C2 必须提供 C 环节及包内 stage-record.json' };
  return checkPage({ pack: dirname(recordPath), expectVersion: options.expectedOutputVersion, scopeVersion: options.scopeVersion });
}
