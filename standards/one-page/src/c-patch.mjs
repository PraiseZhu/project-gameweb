import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadEnv } from '../../figma-naming/tool/src/figma.mjs';
import { ASSET_MANIFEST, describeFile, measureAssets, requireAssets } from './assets-manifest.mjs';
import { runCCheck } from './c-check/index.mjs';
import { assertSeparated, readRegular } from './c-check/evidence.mjs';
import { affectedDomIds } from './c-check/pixel-scope.mjs';
import { auditStatic } from './c-check/static-audit.mjs';
import { assetFiles, checkPage, itemDigest, PAGE_KIND, PAGE_META, PAGE_STAGE, pageInputs } from './c-page-check.mjs';
import { collectDeltaAssets, readDeltaInputs, readLeafChanges, requireSingleLanguageInputs } from './c-patch-material.mjs';
import { applyLeafLayout, applyLeafMarkup } from './c-patch-leaves.mjs';
import { patchFonts } from './c-patch-fonts.mjs';
import { designRule, planDesign } from './c-patch-design.mjs';
import { planDeltaConflicts } from './c-patch-conflict.mjs';
import { planLinks } from './c-patch-links.mjs';
import { sharedExpansion } from './c-patch-expansion.mjs';
import { sha256Hex } from './canonical.mjs';
import { checkDelta } from './delta-check.mjs';
import { byteDigest, checkHandoff, isDigest, PACK_FILES } from './handoff-check.mjs';
import { buildStageRecord, checkEntry } from './stage-record.mjs';

const json = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const sameNode = (left, right) => left.end === right.end && left.nodeId === right.nodeId;

function copyAsset(from, to, item, path) {
  const bytes = readRegular(from, item.path);
  requireAssets(bytes.length === item.bytes && byteDigest(bytes) === item.sha256, '素材字节与导出清单不符');
  mkdirSync(dirname(join(to, path)), { recursive: true });
  writeFileSync(join(to, path), bytes, { flag: 'wx' });
  return { ...item, path };
}

function applyAssets(build, page, manifest, material, source) {
  const root = join(build, 'page');
  const paths = new Map();
  const keep = (item, visualFingerprint) => {
    const path = 'assets/retained/history/' + sha256Hex([item.path,item.sha256]) + '.' + item.format;
    const { sha256, bytes } = copyAsset(root, root, item, path);
    manifest.retained.push({ path, sha256, bytes, format:item.format, kind:'history', source:'history/' + item.path,
      visualFingerprint, referenced:false });
    rmSync(join(root, item.path));
    for (let dir = dirname(join(root,item.path)); dir !== root && !readdirSync(dir).length; dir = dirname(dir)) rmdirSync(dir);
  };
  manifest.assets = manifest.assets.map((previous) => {
    const next = material.assets.find((asset) => sameNode(asset, previous));
    if (!next) return previous;
    requireAssets(next.module === previous.module && sha256Hex(next.box) === sha256Hex(previous.box), '换图改变几何或模块');
    const name = 'c4-' + sha256Hex([next.end,next.nodeId,next.sha256,next.visualFingerprint]);
    const asset = copyAsset(source, root, next, 'assets/' + name + '.' + next.format);
    if (next.original) asset.original = copyAsset(source, root, next.original, 'assets/retained/original/' + name + '.png');
    keep(previous, previous.visualFingerprint);
    if (previous.original) keep(previous.original, previous.visualFingerprint);
    paths.set(previous.path, asset.path);
    return { ...asset, referenced:true };
  });
  const rewrite = (value) => typeof value === 'string'
    ? [...paths].reduce((current, [before, after]) => current.replaceAll(before, after), value) : value;
  for (const path of [page.baseLanguage + '.html','css/styles.css','css/mobile.css','css/locales.css','js/config.js']) {
    const target = join(root, path);
    const before = readFileSync(target, 'utf8');
    const after = rewrite(before);
    if (after !== before) writeFileSync(target, after);
  }
  for (const node of page.nodes) node.asset = rewrite(node.asset);
  manifest.measurement = measureAssets(assetFiles(manifest));
  delete manifest.version;
  manifest.version = sha256Hex(manifest);
  writeFileSync(join(root, ASSET_MANIFEST), json(manifest));
  return Object.fromEntries(paths);
}

function finishBuild(build, page, manifest, source, round) {
  const paths = [...Object.keys(page.files).filter((path) => !path.startsWith('page/assets/') && !path.startsWith('page/css/font/')), 'page/' + ASSET_MANIFEST,
    ...assetFiles(manifest).map((item) => 'page/' + item.path)];
  page.files = Object.fromEntries(paths.map((path) => [path, itemDigest(describeFile(build, path))]));
  page.c4 = { assets: { version:manifest.version, digest:page.files['page/' + ASSET_MANIFEST].sha256 }, ...source };
  delete page.version;
  page.version = sha256Hex(page);
  const bytes = json(page);
  writeFileSync(join(build, PAGE_META), bytes);
  writeFileSync(join(build, PAGE_STAGE), json(buildStageRecord({ stage:'C', round, result:'pass', inputs:pageInputs(page),
    output:{ kind:PAGE_KIND, version:page.version, path:PAGE_META, digest:byteDigest(bytes) },
    tools:[{ name:'c:patch', version:'onepage-c4-patch/v1', result:'pass' }] })));
}

function updateManualRules(build, previous, current) {
  const path = join(build,'page/css/styles.css');
  let css = readFileSync(path,'utf8');
  for (const anchor of previous) {
    const rule = '\n' + designRule(anchor) + '\n';
    requireAssets(css.split(rule).length === 2, '微调区内容已漂移');
    css = css.replace(rule,'\n');
  }
  for (const anchor of current) css += '\n' + designRule(anchor) + '\n';
  writeFileSync(path,css);
}

export async function runCPatch(options = {}) {
  let scratch;
  let lock;
  try {
    const { baseCheck, pagePack, pageVersion, baseCheckVersion, scopeVersion, deltaPack, deltaVersion, handoffPack,
      consumerContract, references, referencesSha256, runDir, designPath, designSha256, decisionChoice, decisionFingerprint } = options;
    requireAssets(baseCheck && pagePack && runDir && (designPath ? !deltaPack && !deltaVersion && isDigest(designSha256)
      : deltaPack && isDigest(deltaVersion) && !designSha256), '必须提供 C4 基线与唯一的已绑定入口');
    const base = checkEntry(baseCheck, { expectedStage:'C', expectedOutputKind:'c-single-page', expectedOutputVersion:baseCheckVersion,
      pagePack, pageVersion, scopeVersion });
    requireAssets(base.ok, base.reason);
    const page = checkPage({ pack:pagePack, expectVersion:pageVersion, scopeVersion }).manifest;
    requireAssets(page, '缺已核验的成品');
    const previousFiles = page.files;
    let previousPatch;
    if (page.c4) {
      const bytes = readRegular(dirname(baseCheck),'c4-patch-meta.json');
      requireAssets(byteDigest(bytes) === base.manifest.evidence['c4-patch-meta.json'].sha256, '前代改稿证据在核验后漂移');
      previousPatch = JSON.parse(bytes);
    }
    const handoff = checkHandoff({ pack:handoffPack, expectVersion:page.b3.version, scopeVersion, consumerContract }, { includePayloads:true });
    requireAssets(handoff.ok, handoff.message);
    let delta;
    let design;
    let shared;
    let manual;
    let leafCandidates;
    if (designPath) {
      const bytes = readRegular(dirname(designPath), basename(designPath));
      requireAssets(byteDigest(bytes) === designSha256, '设计指令 SHA-256 不符');
      const prior = previousPatch?.manualTweaks ?? [];
      const instruction = JSON.parse(bytes);
      const binding = { pageVersion, checkVersion:baseCheckVersion, checkDigest:base.record.output.digest, scopeVersion };
      const plan = planDesign({ instruction, page, base:binding, prior });
      if (!plan.selected) return { ok:false, result:'needs-human-decision', conflict:plan.conflict, choices:['overwrite','keep-manual'] };
      design = { base:binding, instruction, instructionBytes:bytes.toString('base64'), prior, plan };
    } else {
      delta = checkDelta({ pack:deltaPack, expectVersion:deltaVersion, basePackVersion:page.b3.version, scopeVersion });
      const entry = checkEntry(join(deltaPack,'stage-record.json'), { expectedStage:'B', expectedOutputKind:'b-delta-handoff',
        expectedOutputVersion:deltaVersion, basePackVersion:page.b3.version, scopeVersion });
      requireAssets(delta.ok && entry.ok, delta.message ?? entry.reason);
      requireAssets(!page.c4?.deltaDigest || (previousPatch.delta.source.fileVersion !== delta.manifest.source.fileVersion
        && previousPatch.delta.version !== delta.manifest.version), 'B4 已执行或仍指向上一稿件版本');
      requireAssets(!page.c4?.deltaDigest || (previousPatch.delta.changeKind === 'asset-visual-only' && delta.manifest.changeKind === 'asset-visual-only'),
        '连续 B4 混合来源不能安全重放，请走完整生成链');
      requireAssets(!['upgrade-to-full-pack','unlocated-version-change'].includes(delta.manifest.changeKind), '变化不可定位或超范围，请走完整生成链');
      shared = readDeltaInputs(delta,dirname(deltaPack),options.fontDiscovery);
      requireSingleLanguageInputs(delta,shared,page.baseLanguage);
      requireAssets((delta.manifest.changeKind === 'asset-visual-only' && delta.manifest.affectedAssets.length && !Object.keys(shared).length)
        || (['layout-impacted','non-figma-config-or-copy'].includes(delta.manifest.changeKind) && !Object.keys(shared).length && !page.c4?.deltaDigest)
        || (delta.manifest.changeKind === 'non-figma-config-or-copy' && shared.config && Object.keys(shared).length === 1
          && !delta.manifest.evidence.fileVersionChanged && !delta.manifest.affectedAssets.length)
        || (shared.fonts && Object.keys(shared).length === 1 && !delta.manifest.affectedAssets.length && !page.c4),
      'B4 变化尚无可验证的局部执行路径，请走完整生成链');
      if (!Object.keys(shared).length && delta.manifest.changeKind !== 'asset-visual-only') {
        leafCandidates = readLeafChanges({ handoff,delta,page,runDir:dirname(deltaPack) });
      }
      const prior = previousPatch?.manualTweaks ?? [];
      const decision = decisionChoice || decisionFingerprint ? { choice:decisionChoice, fingerprint:decisionFingerprint } : undefined;
      const assetsBytes = readRegular(join(pagePack,'page'),ASSET_MANIFEST);
      requireAssets(byteDigest(assetsBytes) === page.files['page/' + ASSET_MANIFEST].sha256, '基线素材清单在核验后漂移');
      const assetBase = JSON.parse(assetsBytes).assets.filter((asset) => delta.manifest.affectedAssets.some((row) => sameNode(row,asset)))
        .map(({ end,nodeId,visualFingerprint,sha256 }) => ({ end,nodeId,visualFingerprint,sha256 }));
      const plan = planDeltaConflicts({ prior,page,pageVersion,checkVersion:baseCheckVersion,delta:delta.manifest,decision,leaves:leafCandidates,assetBase });
      if (!plan.manualTweaks) return { ok:false,result:'needs-human-decision',conflict:plan.conflict,choices:['overwrite','keep-manual'] };
      if (prior.length) manual = { prior,plan,assetBase,...(leafCandidates ? { leaves:leafCandidates } : {}) };
    }
    const root = realpathSync(runDir);
    const inputs = [pagePack,dirname(baseCheck),deltaPack,handoffPack].filter(Boolean).map((input) => realpathSync(input));
    for (const input of inputs) requireAssets(root !== input && !root.startsWith(input + sep), '发布目录不得位于已验输入内');
    const candidate = join(root,'.c4-lock');
    mkdirSync(candidate);
    lock = candidate;
    const round = 1 + Math.max(0,...readdirSync(root).map((name) => Number(/^c4\.r([1-9]\d*)$/.exec(name)?.[1] ?? 0)));
    requireAssets(Number.isSafeInteger(round), 'C4 轮号超出安全范围');
    scratch = mkdtempSync(join(root,'.c4-writing-'));
    for (const input of inputs) assertSeparated(scratch, input);
    const build = join(scratch,'build');
    const source = join(scratch,'material');
    mkdirSync(source);
    cpSync(pagePack, build, { recursive:true, errorOnExist:true, force:false });
    requireAssets(checkPage({ pack:build, expectVersion:pageVersion, scopeVersion }).ok, '基线复制期间内容发生变化');
    const manifest = JSON.parse(readRegular(join(build,'page'), ASSET_MANIFEST));
    let patchSource;
    let patchMeta;
    if (design) {
      updateManualRules(build,design.prior,design.plan.manualTweaks);
      const inherited = page.c4?.deltaDigest ? { deltaDigest:page.c4.deltaDigest,
        deltaMaterialDigest:page.c4.deltaMaterialDigest ?? page.c4.materialDigest } : {};
      const carried = inherited.deltaDigest ? { material:previousPatch.material,delta:previousPatch.delta } : {};
      finishBuild(build,page,manifest,{ designDigest:designSha256, materialDigest:sha256Hex(design),
        ...inherited, affectedDomIds:[...new Set([...design.plan.manualTweaks.map((row) => row.target.domId),
          ...(carried.delta ? affectedDomIds(page,carried.delta,carried.material) : [])])].sort() },round);
      patchMeta = { ...carried,design, manualTweaks:design.plan.manualTweaks, expansion:{ path:'css/styles.css', reason:'共用样式文件变更，所有屏和 TAB 状态复验' } };
      patchSource = { design,...(carried.delta ? { material:carried.material,delta:{ ok:true,manifest:carried.delta,manifestSha256:inherited.deltaDigest } } : {}) };
    } else {
      let links;
      let leaves;
      let fonts;
      if (shared.config) {
        const { config } = auditStatic(build,page);
        requireAssets(config, '无法读取当前集中配置');
        links = planLinks({ previous:JSON.parse(handoff.payloads.get(PACK_FILES.config)), current:shared.config, config, delta:delta.manifest });
        for (const { key, after } of links.changes) config.links[key] = after;
        writeFileSync(join(build,'page/js/config.js'),'window.OnePageConfig = JSON.parse(' + JSON.stringify(JSON.stringify(config)) + ');\n');
      }
      if (shared.fonts) fonts = patchFonts({ previous:JSON.parse(handoff.payloads.get(PACK_FILES.config)), ...shared.fonts,
        delta:delta.manifest,manifest,build,baseLanguage:page.baseLanguage });
      if (leafCandidates) {
        leaves = leafCandidates.filter((row) => !manual?.plan.keptLeaves.includes(row.domId));
        const markup = join(build,'page',page.baseLanguage + '.html');
        let html = readFileSync(markup,'utf8');
        for (const edit of leaves) {
          html = applyLeafMarkup(html,edit);
          if (edit.changedBox) {
            const path = join(build,'page/css',edit.end === 'pc' ? 'styles.css' : 'mobile.css');
            writeFileSync(path,applyLeafLayout(readFileSync(path,'utf8'),edit));
          }
          const trace = page.nodes.find((row) => row.domId === edit.domId);
          trace.text = edit.toText;
          trace.designBox = edit.toBox;
        }
        writeFileSync(markup,html);
      }
      const previousDelta = page.c4?.deltaDigest ? { delta:previousPatch.delta,runDir:dirname(deltaPack) } : undefined;
      const material = await collectDeltaAssets({ handoff, delta, page, baseCheckVersion, manifest, root:source, links, manual, leaves, fonts, previousDelta, options });
      const active = material.assets.filter(({ end,nodeId }) => !manual?.plan.kept.includes(JSON.stringify([end,nodeId]))
        && !material.carried?.includes(JSON.stringify([end,nodeId])));
      const replacements = applyAssets(build,page,manifest,{ assets:active },source);
      if (manual?.plan.decision?.choice === 'overwrite') updateManualRules(build,manual.prior,manual.plan.manualTweaks);
      finishBuild(build,page,manifest,{ materialDigest:sha256Hex(material), deltaDigest:delta.manifestSha256,
        affectedDomIds:affectedDomIds(page,delta.manifest,material) },round);
      patchMeta = { material, delta:delta.manifest, affected:delta.manifest.whiteboxScope, replacements, manualTweaks:manual?.plan.manualTweaks ?? [] };
      if (links) patchMeta.expansion = { path:'js/config.js', reason:'共用外链配置变更，所有屏和 TAB 状态复验' };
      if (fonts) patchMeta.expansion = { paths:['css/font/','css/styles.css'], reason:'共用字体变更，所有屏和 TAB 状态复验' };
      if (leaves?.some((row) => row.changedBox)) patchMeta.expansion = { paths:[...new Set(leaves.filter((row) => row.changedBox)
        .map((row) => 'css/' + (row.end === 'pc' ? 'styles.css' : 'mobile.css')))].sort(), reason:'修改了布局样式，所有屏和 TAB 状态复验' };
      patchSource = { delta, material };
    }
    const out = join(scratch,'checks');
    mkdirSync(out);
    patchMeta = { ...patchMeta, schema:'onepage-c4-patch/v1', pageVersion:page.version, sharedAudit:sharedExpansion(page,previousFiles) };
    const audit = await runCCheck({ pack:build, expectVersion:page.version, scopeVersion, out, references, referencesSha256,
      handoffPack, consumerContract, patchSource:{ ...patchSource, patchMeta } });
    requireAssets(audit.status === 'pass', 'C4 复验未通过：' + JSON.stringify(audit.rounds[0]?.problems));
    const evidence = audit.rounds[0];
    renameSync(evidence.root,join(scratch,'check'));
    rmdirSync(out);
    rmSync(source,{ recursive:true });
    const checked = checkEntry(join(scratch,'check',PAGE_STAGE), { expectedStage:'C', expectedOutputKind:'c-single-page',
      expectedOutputVersion:evidence.version, pagePack:build, pageVersion:page.version, scopeVersion });
    requireAssets(checked.ok, checked.reason);
    const name = 'c4.r' + round;
    requireAssets(!readdirSync(root).includes(name), 'C4 禁止覆盖已有版本');
    const pack = join(root,name);
    renameSync(scratch, pack);
    scratch = undefined;
    return { ok:true, result:'pass', pack, stagePath:join(pack,'check',PAGE_STAGE), pagePack:join(pack,'build'),
      version:evidence.version, pageVersion:page.version, scopeVersion };
  } catch (error) {
    return { ok:false, result:'stopped', message:error.message };
  } finally {
    if (scratch) rmSync(scratch,{ recursive:true, force:true });
    if (lock) rmdirSync(lock);
  }
}

export async function main(argv) {
  const flags = { 'base-check':'baseCheck', 'base-check-version':'baseCheckVersion', 'page-pack':'pagePack', 'page-version':'pageVersion',
    'scope-version':'scopeVersion', 'delta-pack':'deltaPack', 'delta-version':'deltaVersion', 'handoff-pack':'handoffPack',
    'consumer-contract':'consumerContract', references:'references', 'references-sha256':'referencesSha256', 'run-dir':'runDir',
    'design':'designPath', 'design-sha256':'designSha256','decision':'decisionChoice','decision-fingerprint':'decisionFingerprint' };
  try {
    const { values } = parseArgs({ args:argv, options:{ ...Object.fromEntries(Object.keys(flags).map((key) => [key,{ type:'string' }])),
      help:{ type:'boolean' } } });
    if (values.help) {
      console.log('c:patch ' + Object.keys(flags).map((key) => '--' + key + ' <值>').join(' '));
      return 0;
    }
    loadEnv(fileURLToPath(new URL('../../figma-naming/tool/',import.meta.url)));
    const result = await runCPatch(Object.fromEntries(Object.entries(flags).map(([key,name]) => [name,values[key]])));
    console.log(JSON.stringify(result));
    return result.ok ? 0 : 1;
  } catch {
    console.log(JSON.stringify({ ok:false,result:'stopped',message:'C4 调用失败；请检查参数。' }));
    return 1;
  }
}
