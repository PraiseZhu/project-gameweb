import { lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadEnv } from '../../../figma-naming/tool/src/figma.mjs';
import { launchChromium } from '../../../stop1-figma-pixel/tool/src/resolve-playwright.mjs';
import { exportSelectedAssets } from '../c-assets.mjs';
import { ASSET_MANIFEST } from '../assets-manifest.mjs';
import { readRegular } from '../c-check/evidence.mjs';
import { sha256Hex } from '../canonical.mjs';
import { byteDigest, PACK_FILES } from '../handoff-check.mjs';
import { buildStageRecord } from '../stage-record.mjs';
import { checkEEntry, checkInputs, E_KIND, E_MANIFEST, E_SCHEMA, E_STAGE, equal, fileHashes, languageFilterCases, measureLocale, need } from './e-check.mjs';
import { fitGroup, fitGroups, localeSelector } from './locale-css-fit.mjs';
import { localeConfig, localeHtml, localeRuntime, parseConfig, payloadJson, prepareLocale, regionalActions } from './locale-html.mjs';
import { checkedLocale } from './locale-copy-audit.mjs';

const json = (value) => JSON.stringify(value, null, 2) + '\n';
function write(root, path, bytes, flag = 'wx') {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive:true });
  writeFileSync(target, bytes, { flag });
}

function contains(parent, child) {
  const offset = relative(parent, child);
  return !isAbsolute(offset) && offset !== '..' && !offset.startsWith('..' + sep);
}

export function isolatedOutputRoot(output, inputs) {
  let ancestor = resolve(output);
  const missing = [];
  for (;;) {
    try { lstatSync(ancestor); break; }
    catch (error) {
      if (error.code !== 'ENOENT' || ancestor === dirname(ancestor)) throw error;
      missing.unshift(basename(ancestor));
      ancestor = dirname(ancestor);
    }
  }
  const physical = realpathSync(ancestor);
  need(lstatSync(physical).isDirectory(), 'E 运行目录祖先必须是实际目录');
  const target = join(physical, ...missing);
  for (const input of inputs) {
    const source = realpathSync(input);
    need(!contains(source, target) && !contains(target, source), '成品和证据必须物理分离');
  }
  return target;
}

export function planAdjustments(locale, observations, round) {
  const byId = new Map();
  for (const row of observations.flatMap((state) => state.rows)) {
    need(row.fontLoaded, 'Chromium 未加载目标语字体：' + row.id);
    need(!row.occluded, '外语文案被遮挡：' + row.id);
    const old = byId.get(row.id);
    byId.set(row.id, { ...row, overflow:row.overflow || !!old?.overflow, fontPx:Math.min(row.fontPx, old?.fontPx ?? Infinity) });
  }
  const broken = [...byId.values()].filter((row) => row.overflow);
  if (!broken.length) return [];
  need(round < 2, '两轮排版后仍溢出：' + broken.map((row) => row.id).join(', '));
  for (const group of fitGroups([...byId.values()]).filter((rows) => rows.some((row) => row.overflow))) {
    need(!group.some((row) => row.locked), '排版组包含手调锁定对象：' + group.map((row) => row.id).join(', '));
    if (round === 0) for (const row of group) {
      locale.rules.add(localeSelector(locale.tag, row.id) + '{white-space:pre-wrap;overflow-wrap:normal;word-break:normal;line-break:strict}');
      locale.lists.adjustments.push({ id:row.id, kind:'semantic-wrap' });
    } else for (const change of fitGroup(group)) {
      locale.rules.add(localeSelector(locale.tag, change.id) + '{font-size:calc(var(--font-size) * ' + change.scale + ');line-height:calc(var(--line-height) * ' + change.scale + ')}');
      locale.lists.adjustments.push({ ...change, kind:'font-scale' });
    }
  }
  return broken;
}

export function verifyLocaleImage(base, next, id) {
  need([base?.width,base?.height,base?.box?.w,base?.box?.h].every((value) => Number.isFinite(value) && value > 0)
    && next && base.width === next.width && base.height === next.height && base.box.w === next.box?.w && base.box.h === next.box?.h,
    '外语图尺寸或比例与已批准布局不符：' + id);
  return next.path;
}

export async function runEBuild(options = {}) {
  let scratch;
  let lock;
  const guide = {};
  try {
    const { meta, targets, b3, inputs } = checkInputs(options);
    if (!targets.length) return { ok:true, result:'skipped', reason:'D 已确认的范围没有目标外语' };
    need(typeof options.runDir === 'string' && options.runDir, '必须指定独立 E 运行目录');
    const root = isolatedOutputRoot(options.runDir,
      [options.pagePack, options.handoffPack, options.assetsPack, dirname(options.approval), dirname(options.check)]);
    mkdirSync(root, { recursive:true });
    need(lstatSync(root).isDirectory(), 'E 运行目录必须是实际目录');
    const nextLock = join(root, '.e-lock');
    mkdirSync(nextLock);
    lock = nextLock;
    const round = 1 + readdirSync(root).reduce((last, name) => Math.max(last, Number(/^e\.r([1-9][0-9]*)$/.exec(name)?.[1] ?? 0)), 0);
    need(Number.isSafeInteger(round), 'E 轮号非法');
    scratch = mkdtempSync(join(root, '.e-writing-'));
    for (const [path, hash] of Object.entries(meta.files)) {
      const bytes = readRegular(options.pagePack, path);
      need(equal(hash, { bytes:bytes.length, sha256:byteDigest(bytes) }), '批准成品在复制时漂移：' + path);
      write(scratch, path, bytes);
    }
    const runtimeSource = readRegular(scratch, 'page/js/main.js').toString();
    const originalCss = readRegular(scratch, 'page/css/locales.css').toString();
    const locales = targets.map((lang) => prepareLocale({ b3, meta, lang, runtimeSource, originalCss }));
    for (const locale of locales) guide[locale.lang] = locale.lists;
    const baseAssets = JSON.parse(readRegular(scratch, 'page/' + ASSET_MANIFEST));
    const selected = [...new Map(locales.flatMap(({ images }) => images).filter(({ plan }) => plan)
      .map(({ plan }) => [JSON.stringify([plan.end, plan.nodeId]), plan])).values()];
    const exports = selected.length ? await exportSelectedAssets({ scope:b3.manifest.scope, plans:selected,
      nodes:locales[0].byEnd, root:join(scratch, 'page'), options }) : [];
    for (const { images } of locales) for (const image of images.filter(({ plan }) => plan)) {
      const base = baseAssets.assets.find((asset) => asset.path === image.asset);
      const next = exports.find((asset) => asset.end === image.plan.end && asset.nodeId === image.plan.nodeId);
      image.replacement = verifyLocaleImage(base, next, image.id);
    }
    const originalHtml = readRegular(scratch, 'page/' + meta.baseLanguage + '.html').toString();
    const originalConfig = readRegular(scratch, 'page/js/config.js').toString();
    const { fields } = payloadJson(b3, PACK_FILES.dataContract);
    const { samples } = payloadJson(b3, PACK_FILES.samples);
    const config = parseConfig(originalConfig);
    for (const locale of locales) locale.filterCases = languageFilterCases({ fields,samples,config,meta,lang:locale.lang });
    const saveCss = () => write(scratch, 'page/css/locales.css', locales.flatMap((locale) => [...locale.rules]).join('\n') + '\n' + originalCss, 'w');
    const { browser } = await launchChromium(null, { headless:true });
    const observations = {};
    try {
      const context = await browser.newContext({ serviceWorkers:'block' });
      try {
        await context.route('**/*', (route) => route.abort());
        const page = await context.newPage();
        const written = new Map();
        for (const locale of locales) {
          locale.excluded = regionalActions(originalConfig, locale.tag);
          const localizedRuntime = localeRuntime(runtimeSource, locale.filterCases);
          if (localizedRuntime) {
            write(scratch, 'page/js/main-' + locale.lang + '.js', localizedRuntime);
            locale.localizedRuntime = true;
          }
          write(scratch, 'page/' + locale.lang + '.html', await localeHtml(page, originalHtml, locale, checkedLocale(meta.baseLanguage)));
          write(scratch, 'page/js/config-' + locale.lang + '.js', localeConfig(originalConfig, locale.tag));
          for (const [path, data] of locale.files) {
            const digest = byteDigest(data);
            if (!written.has(path)) {
              if (!meta.files['page/' + path]) write(scratch, 'page/' + path, data);
              else need(meta.files['page/' + path].sha256 === digest, '外语字体与已批准资源名冲突');
              written.set(path, digest);
            } else need(written.get(path) === digest, '外语资源冲突：' + path);
          }
        }
      } finally { await context.close(); }
      saveCss();
      for (const locale of locales) {
        for (let attempt = 0; attempt <= 2; attempt++) {
          const measured = await measureLocale(browser, join(scratch, 'page'), locale, meta);
          observations[locale.lang] = measured;
          if (!planAdjustments(locale, measured, attempt).length) break;
          saveCss();
        }
      }
    } finally { await browser.close(); }
    const current = checkInputs(options);
    need(equal(current.inputs, inputs) && equal(current.meta.files, meta.files), '上游在制作中发生变化');
    write(scratch, 'locale-guide.json', json(guide));
    write(scratch, 'locale-adjustments.json', json(Object.fromEntries(locales.map(({ lang, lists, locked }) => [lang, { locks:locked, adjustments:lists.adjustments }]))));
    write(scratch, 'browser-checks.json', json(observations));
    const files = fileHashes(scratch);
    for (const [path, hash] of Object.entries(meta.files)) if (path !== 'page/css/locales.css') need(equal(files[path], hash), '批准成品被改动：' + path);
    const body = { schema:E_SCHEMA, scopeVersion:options.scopeVersion, baseLanguage:meta.baseLanguage, targets, inputs, exports, files };
    const version = sha256Hex(body);
    const manifest = json({ ...body, version });
    write(scratch, E_MANIFEST, manifest);
    write(scratch, E_STAGE, json(buildStageRecord({ stage:'E', round, inputs, result:'pass',
      output:{ kind:E_KIND, version, path:E_MANIFEST, digest:byteDigest(manifest) }, tools:[{ name:'e:build', version:E_SCHEMA, result:'pass' }] })));
    const verified = checkEEntry(join(scratch, E_STAGE), { expectedStage:'E', expectedOutputVersion:version, scopeVersion:options.scopeVersion, beforePublish:true });
    need(verified.ok, verified.reason);
    const pack = join(root, 'e.r' + round);
    renameSync(scratch, pack);
    scratch = undefined;
    return { ok:true, result:'pass', pack, stagePath:join(pack, E_STAGE), version, targets };
  } catch (error) {
    return { ok:false, result:'stopped', reason:error.message, guide };
  } finally {
    if (scratch) rmSync(scratch, { recursive:true, force:true });
    if (lock) rmdirSync(lock);
  }
}

const flags = { approval:'approval', 'approval-version':'approvalVersion', 'page-pack':'pagePack', 'page-version':'pageVersion', check:'check',
  'check-version':'checkVersion', 'scope-version':'scopeVersion', 'handoff-pack':'handoffPack', 'handoff-version':'handoffVersion',
  'consumer-contract':'consumerContract', 'assets-pack':'assetsPack', 'assets-version':'assetsVersion', 'assets-sha256':'assetsSha256', 'run-dir':'runDir' };

export async function main(argv) {
  try {
    const { values } = parseArgs({ args:argv, options:Object.fromEntries(Object.keys(flags).map((flag) => [flag, { type:'string' }])) });
    loadEnv(fileURLToPath(new URL('../../../figma-naming/tool/', import.meta.url)));
    const result = await runEBuild(Object.fromEntries(Object.entries(values).map(([flag, value]) => [flags[flag], value])));
    console.log(json(result).trimEnd());
    return result.ok ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}
