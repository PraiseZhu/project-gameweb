import { allNodesOf } from '../../../figma-naming/tool/src/inventory.mjs';
import { endFile, PACK_FILES } from '../handoff-check.mjs';
import { auditCopy, checkedLocale, translationIndex } from './locale-copy-audit.mjs';
import { missingGlyphs } from '../cmap.mjs';
import { localeSelector, readLocaleLocks } from './locale-css-fit.mjs';
import { need } from './e-check.mjs';

export const payloadJson = (b3, name) => JSON.parse(b3.payloads.get(name));
const keyOf = (end, id) => JSON.stringify([end, id]);
const formatName = (format) => ({ otf:'opentype', ttf:'truetype' })[format] ?? format;

export function prepareLocale({ b3, meta, lang, runtimeSource, originalCss }) {
  const tag = checkedLocale(lang);
  const translations = translationIndex(payloadJson(b3, PACK_FILES.translations), lang);
  const fonts = payloadJson(b3, PACK_FILES.fonts);
  const faceByLocation = new Map();
  for (const face of fonts.faces) for (const loc of face.locations) {
    const key = keyOf(loc.end, loc.nodeId);
    need(!faceByLocation.has(key), '字体位置歧义：' + key);
    faceByLocation.set(key, face);
  }
  const byEnd = Object.fromEntries(meta.ends.map((end) => [end, new Map(allNodesOf(payloadJson(b3, endFile(end)).inventory).map((node) => [node.id, node]))]));
  const files = new Map();
  const rules = new Set();
  const addFont = (resource, weight) => {
    const file = 'font/' + resource.sha256 + '.' + resource.format;
    const family = 'locale-' + lang + '-' + resource.sha256;
    files.set('css/' + file, b3.payloads.get(resource.path));
    files.set('css/' + file + '.license.txt', resource.license);
    rules.add('@font-face{font-family:' + family + ';src:url("' + file + '") format("' + formatName(resource.format) + '");font-weight:' + weight + ';font-display:swap}');
    return family;
  };
  const lists = { missingTranslations:[], missingImages:[], translationWarnings:[], adjustments:[] };
  const rows = [];
  for (const trace of meta.nodes.filter((item) => item.text?.trim())) {
    const key = keyOf(trace.end, trace.nodeId);
    const node = byEnd[trace.end].get(trace.nodeId);
    const source = translations.get(key);
    need(node?.text && (!source || source.source === trace.text), '成品文案与 B3 译文来源不同，须先补齐当前版：' + key);
    const face = faceByLocation.get(key);
    const resource = fonts.resources[face?.langs?.[lang]?.resource];
    const font = resource && b3.payloads.get(resource.path);
    const { text, untranslated, warnings } = auditCopy({ source:trace.text, translation:source?.translation, font, target:key });
    const anchor = { end:trace.end, screen:trace.module, nodeId:trace.nodeId, id:trace.domId };
    if (untranslated) lists.missingTranslations.push(anchor);
    if (warnings.length) lists.translationWarnings.push({ ...anchor, warnings });
    const selector = localeSelector(tag, trace.domId);
    if (untranslated) rules.add(selector + '[data-untranslated]{font-family:system-ui,sans-serif}');
    else {
      const weight = Number(face.key.split('/').at(-1));
      need(Number.isInteger(weight) && weight > 0 && weight <= 1000, '字体字重无效：' + key);
      const family = addFont(resource, weight);
      rules.add(selector + '{font-family:' + family + ',sans-serif}');
    }
    rows.push({ ...anchor, source:trace.text, text, untranslated, parent:node.parentId,
      role:trace.role, box:node.parentBox, fontSize:node.text.fontSize });
  }
  const messageList = new RegExp("(?:^|[,{]\\s*)" + (tag === 'en' || tag === 'ja' || tag === 'ko' ? tag : "'" + tag + "'") + ":\\s*\\['([^']*)','([^']*)'\\]").exec(runtimeSource);
  need(messageList && messageList[1] && messageList[2], '无法定位当前运行时的提示文案：' + tag);
  const messages = messageList.slice(1);
  const messageResources = fonts.faces.filter((face) => face.key.endsWith('/400')).map((face) => fonts.resources[face.langs[lang].resource]);
  const messageFont = messageResources.find((font) => !missingGlyphs(b3.payloads.get(font.path), messages.join(' ')).length);
  need(messageFont, '缺覆盖当前语言 messages 的已核验字体：' + tag);
  rules.add(localeSelector(tag, 'site-status') + '{font-family:' + addFont(messageFont, 400) + ',sans-serif}');
  const locked = readLocaleLocks(originalCss, tag, rows);
  rows.forEach((row) => { row.locked = locked.includes(row.id); });
  const images = [];
  const assets = payloadJson(b3, PACK_FILES.assets);
  for (const trace of meta.nodes.filter((item) => item.asset)) {
    const node = byEnd[trace.end].get(trace.nodeId);
    if (!node?.langs?.includes(meta.baseLanguage) || node.langs.includes(lang)) continue;
    const siblings = [...byEnd[trace.end].values()].filter((item) => item.parentId === node.parentId && item.scope === node.scope
      && item.role === node.role && item.status === 'determined' && item.langs?.includes(lang));
    const matching = siblings.filter((item) => node.assetKey && item.assetKey === node.assetKey);
    need(matching.length <= 1 && (!siblings.length || matching.length === 1), '缺唯一外语图绑定：' + keyOf(trace.end, trace.nodeId));
    const plans = matching.length ? assets.filter((item) => item.end === trace.end && item.nodeId === matching[0].id) : [];
    need(!matching.length || plans.length === 1, '缺外语图导出计划：' + keyOf(trace.end, trace.nodeId));
    images.push({ id:trace.domId, asset:trace.asset, plan:plans[0] });
    if (!plans.length) lists.missingImages.push({ end:trace.end, screen:trace.module, nodeId:trace.nodeId, id:trace.domId });
  }
  return { lang, tag, rows, rules, files, lists, images, locked, byEnd };
}

export function parseConfig(source) {
  const contract = /^window\.OnePageConfig = JSON\.parse\((".*")\);\s*$/.exec(source);
  need(contract, '不支持的 C2/C4 基础配置格式');
  return JSON.parse(JSON.parse(contract[1]));
}

export function localeConfig(source, tag) {
  const config = parseConfig(source);
  config.language = tag;
  return 'window.OnePageConfig = JSON.parse(' + JSON.stringify(JSON.stringify(config)) + ');\n';
}

export function regionalActions(source, tag) {
  const config = parseConfig(source);
  return Object.entries(config.actions ?? {}).flatMap(([id, action]) => {
    const regional = action.type === 'open-link' && Object.hasOwn(config.social ?? {}, action.key) && config.social[action.key];
    return regional && typeof regional === 'object' && (regional.platform === 'wechat' && tag !== 'zh-CN'
      || regional.regions?.length && !regional.regions.includes(tag)) ? [id] : [];
  });
}

export function localeRuntime(source, filterCases) {
  if (!filterCases.length) return null;
  const byOwner = Object.create(null);
  for (const { owner, path } of filterCases) {
    const paths = byOwner[owner] ??= [];
    if (!paths.some((known) => JSON.stringify(known) === JSON.stringify(path))) paths.push(path);
  }
  const anchor = '      const rows = dataValue(data, binding.data.path);';
  need(source.split(anchor).length === 2, '已批准运行时缺唯一 H31 列表插入点');
  const replacement = [
    '      let rows = dataValue(data, binding.data.path);',
    '      const localePaths = own(JSON.parse(' + JSON.stringify(JSON.stringify(byOwner)) + '), id);',
    '      if (Array.isArray(rows) && localePaths) rows = rows.filter((row) => localePaths.every((path) => {',
    '        const value = locale(dataValue(data, path, row, node.dataset.nodeKey));',
    '        return value != null && (typeof value !== "string" || value.trim() !== "");',
    '      }));',
  ].join('\n');
  return source.replace(anchor, () => replacement);
}

export async function localeHtml(page, source, { tag, lang, rows, images, excluded = [], localizedRuntime = false }, baseTag) {
  return page.evaluate(({ source, tag, lang, rows, images, excluded, localizedRuntime, baseTag }) => {
    const doc = new DOMParser().parseFromString(source, 'text/html');
    if (doc.documentElement.lang !== baseTag) throw new Error('基础语言标签不匹配');
    doc.documentElement.lang = tag;
    const config = doc.querySelector('script[src="js/config.js"]');
    if (!config) throw new Error('缺基础配置脚本锚点');
    config.setAttribute('src', 'js/config-' + lang + '.js');
    if (localizedRuntime) {
      const scripts = doc.querySelectorAll('script[src="js/main.js"]');
      if (scripts.length !== 1) throw new Error('缺唯一基础运行时锚点');
      scripts[0].setAttribute('src', 'js/main-' + lang + '.js');
    }
    const scopes = [doc];
    for (const scope of scopes) for (const template of scope.querySelectorAll('template')) scopes.push(template.content);
    const anchors = (id) => scopes.flatMap((scope) => [...scope.querySelectorAll('#' + CSS.escape(id))]);
    for (const id of excluded) for (const node of anchors(id)) {
      node.hidden = true;
      node.inert = true;
    }
    const visited = new Set();
    const oldTitle = doc.title;
    for (const row of rows) {
      if (visited.has(row.id)) throw new Error('重复制作锚点：' + row.id);
      visited.add(row.id);
      const nodes = anchors(row.id);
      if (!nodes.length) throw new Error('缺成品文案锚点：' + row.id);
      for (const node of nodes) {
        const target = node.querySelector(':scope > [data-slogan-ink]') ?? node;
        const copy = [...target.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE && child.data.trim());
        if (copy.length !== 1 || copy[0].data !== row.source) throw new Error('成品文字已漂移：' + row.id);
        copy[0].data = row.text;
        if (row.untranslated) node.setAttribute('data-untranslated', '');
        if (node.tagName === 'H1' && oldTitle === row.source && doc.title === oldTitle) doc.title = row.text;
      }
    }
    for (const image of images) {
      const nodes = anchors(image.id);
      if (!nodes.length) throw new Error('缺成品图片锚点：' + image.id);
      for (const node of nodes) {
        if (!image.replacement) node.setAttribute('data-untranslated-image', '');
        for (const art of node.querySelectorAll(':scope > img, :scope > noscript > img')) {
          for (const attribute of ['data-src','src']) if (art.getAttribute(attribute) === image.asset) {
            if (image.replacement) art.setAttribute(attribute, image.replacement);
            else art.removeAttribute(attribute);
          }
        }
      }
      for (const preload of doc.querySelectorAll('link[rel="preload"]')) if (preload.getAttribute('href') === image.asset) {
        if (image.replacement) preload.setAttribute('href', image.replacement);
        else preload.remove();
      }
    }
    return '<!doctype html>\n' + doc.documentElement.outerHTML + '\n';
  }, { source, tag, lang, rows, images, excluded, localizedRuntime, baseTag });
}
