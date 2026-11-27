import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { ASSET_MANIFEST, describeFile, measureAssets } from '../assets-manifest.mjs';
import { assetFiles } from '../c-page-check.mjs';

export const finding = (check, target, status, detail) => ({ id: check + ':' + target, check, target, status, detail });
export const observed = (check, target, ok, detail) => finding(check, target, ok ? 'pass' : 'fail', detail);
export const usesData = (config) => Object.values(config?.bindings ?? {}).some((row) => row.data || Object.keys(row.fields ?? {}).length);

function auditLocalReferences(html, styles, lang, files) {
  const origin = 'https://onepage.invalid';
  const references = [...html.matchAll(/\s(?:href|src|data-src|poster)="([^"]+)"/gi)]
    .map(([, url]) => [lang + '.html',url]);
  for (const [index, css] of styles.entries()) {
    for (const match of css.matchAll(/\burl\(\s*(?:"([^"]+)"|'([^']+)'|([^\s'"()]+))\s*\)/gi)) {
      references.push([['css/styles.css','css/mobile.css','css/locales.css'][index],match[1] ?? match[2] ?? match[3]]);
    }
  }
  const invalid = references.filter(([from, reference]) => {
    try {
      const url = new URL(reference,origin + '/' + from);
      return url.origin !== origin || !Object.hasOwn(files,'page' + decodeURIComponent(url.pathname));
    } catch { return true; }
  });
  return observed('D03','local-references',invalid.length === 0,{ total:references.length,invalid });
}

export function auditStatic(pack, meta) {
  const read = (path) => readFileSync(join(pack, 'page', path), 'utf8');
  const html = read(meta.baseLanguage + '.html');
  const styles = ['styles', 'mobile', 'locales'].map((name) => read('css/' + name + '.css'));
  const results = [];
  const scripts = ['js/config.js', 'js/main.js'];
  for (const path of scripts) {
    try {
      new Script(read(path), { filename: path });
      results.push(observed('D01', path, true, '原生脚本语法通过'));
    } catch (error) {
      results.push(observed('D01', path, false, error.message));
    }
  }
  const tags = [...html.matchAll(/<script\b([^>]*)>([^<]*)<\/script>/gi)];
  results.push(observed('D03', 'product-source',
    !/<(?:iframe|object|embed|base)\b|\s(?:style|on\w+|data-figma[\w-]*)\s*=/i.test(html) && !styles.some((css) => /@import\b/i.test(css))
      && tags.map(([, attrs, body]) => !body.trim() && /\bsrc="([^"]+)"/.exec(attrs)?.[1]).join(',') === scripts.join(','),
    '原生 config/main；无逐节点静态 style、Figma 调试标记或外置样式导入'));
  const manifest = JSON.parse(read(ASSET_MANIFEST));
  if (meta.c4) results.push(auditLocalReferences(html,styles,meta.baseLanguage,meta.files));
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const actual = measureAssets(assetFiles(manifest).map(({ path }) => describeFile(join(pack, 'page'), path)));
  results.push(observed('D06', 'bytes', actual.totalBytes === manifest.measurement.totalBytes, actual));
  results.push(observed('D06', 'warnings', same(actual.warnings, manifest.measurement.warnings), actual.warnings));
  for (const item of manifest.retained) results.push(observed('D06', item.path,
    item.path.startsWith('assets/retained/' + item.kind + '/') && ['original','backup','history'].includes(item.kind) && item.bytes > 0
      && typeof item.source === 'string' && item.source.startsWith(item.kind + '/'),
    { kind: item.kind, bytes: item.bytes, source: item.source }));
  for (const item of manifest.assets) {
    const raw = item.original;
    const valid = item.format === 'svg' ? !raw : item.format === 'webp' && raw?.format === 'png' && raw.lossless === true
      && raw.path.startsWith('assets/retained/original/') && raw.width === item.width && raw.height === item.height
      && (item.hasAlpha ? item.lossless === true : item.lossless === false);
    results.push(observed('D06', item.path + ':original', Boolean(valid), { original: raw?.path ?? null, format: item.format }));
  }
  for (const font of manifest.fonts) {
    results.push(observed('D05', font.path, font.language === meta.baseLanguage && Boolean(font.source) && font.license.bytes > 0,
      { source: font.source, faces: font.faces, license: font.license.path }));
  }
  const configSource = /^window\.OnePageConfig = JSON\.parse\((".*")\);\s*$/.exec(read(scripts[0]));
  let config;
  try { if (configSource) config = JSON.parse(JSON.parse(configSource[1])); } catch {}
  results.push(observed('D03', 'concentrated-config', Boolean(config?.actions && config?.bindings && config?.components), '集中配置可静态解析，不执行成品代码'));
  return { results, config, manifest };
}
