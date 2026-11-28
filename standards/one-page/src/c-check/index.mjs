import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { compareOnePage } from '../../../stop1-figma-pixel/tool/src/one-page-pixel.mjs';
import { byteDigest, checkHandoff, PACK_FILES } from '../handoff-check.mjs';
import { sha256Hex } from '../canonical.mjs';
import { checkPage } from '../c-page-check.mjs';
import { buildStageRecord } from '../stage-record.mjs';
import { auditStatic, finding, usesData } from './static-audit.mjs';
import { auditSource } from './source-audit.mjs';
import { auditBrowser } from './browser-audit.mjs';
import { assertSeparated, CHECKS, inputBinding, readRegular, REPORT, SINGLE_PAGE, summarizeChecks } from './evidence.mjs';
import { runRepairLoop } from './repair-loop.mjs';
import { criticalModules, pixelScope, targetRegion } from './pixel-scope.mjs';
import { hasPagingResult, pagingKey, requiredPaging } from './pagination-audit.mjs';
import { approvedDesignRegions, verifyDesign } from '../c-patch-design.mjs';
import { verifyLinkProof } from '../c-patch-links.mjs';
import { verifyDeltaConflicts } from '../c-patch-conflict.mjs';
import { verifyLeaves } from '../c-patch-leaves.mjs';
import { verifyFontProof } from '../c-patch-fonts.mjs';

const json = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');

function checkedReferences(path, digest, meta, pack, findings, tweaks) {
  if (!path) {
    for (const { screen, caseId } of pixelScope(meta)) findings.push(finding('D04', screen.domId + ':' + caseId, 'not_run', '缺同版必验视觉状态参考图'));
    return [];
  }
  const directory = dirname(resolve(path));
  assertSeparated(directory, pack);
  const bytes = readRegular(directory, basename(path));
  if (byteDigest(bytes) !== digest) throw new Error('参考索引必须匹配外传 SHA-256');
  const index = JSON.parse(bytes);
  if (index.schema !== 'onepage-pixel-reference/v1' || index.baseLanguage !== meta.baseLanguage || index.scopeVersion !== meta.scopeVersion
    || index.b3Digest !== meta.b3.digest || (meta.c4?.deltaDigest && index.b4Digest !== meta.c4.deltaDigest)
    || (meta.c4?.designDigest && index.c4DesignDigest !== meta.c4.designDigest)
    || !Array.isArray(index.screens) || !index.screens.length) throw new Error('参考索引缺同语言、范围或来源版本绑定');
  const required = pixelScope(meta);
  const cases = [];
  for (const item of index.screens) {
    const state = item.state ?? null;
    const entry = required.find(({ screen, tab }) => screen.end === item.end && screen.nodeId === item.nodeId
      && (state ? state.kind === 'tab' && tab?.nodeId === state.tabId : !tab));
    const { screen, tab: trigger, panel, caseId } = entry ?? {};
    if (!screen || cases.some((row) => row.domId === screen.domId && row.caseId === caseId) || !/^[\w-]+$/.test(screen.domId)
      || ![item.viewport?.width, item.viewport?.height].every((value) => Number.isSafeInteger(value) && value > 0)
      || (meta.ends.length === 2 && (item.viewport.width >= 1025) !== (item.end === 'pc'))) throw new Error('参考屏重复、越出范围或缺外传视口');
    const reference = readRegular(directory, item.path);
    if (byteDigest(reference) !== item.sha256) throw new Error('参考图 SHA-256 不符');
    const local = item.local ?? [];
    const textMasks = item.textMasks ?? [];
    const keyModules = criticalModules(meta, screen, entry);
    if (!Array.isArray(local) || new Set(local.map((row) => row.domId)).size !== local.length
      || local.some((row) => !Array.isArray(row.region) || !meta.nodes.some((node) => node.end === item.end && node.module === item.nodeId && node.domId === row.domId))) throw new Error('关键模块复比范围不匹配');
    if (!Array.isArray(textMasks) || new Set(textMasks.map((row) => row.domId)).size !== textMasks.length) throw new Error('遮罩范围非法或重复');
    for (const target of local) {
      const node = meta.nodes.find((row) => row.domId === target.domId);
      const { region, edges } = targetRegion(meta, screen, node, item.viewport);
      if (JSON.stringify(target.region) !== JSON.stringify(region)) throw new Error('局部框须覆盖完整权威设计框：' + target.domId);
      target.edges = edges;
    }
    const approved = approvedDesignRegions(tweaks, screen, caseId, item.viewport).map((approval) => {
      const node = meta.nodes.find((row) => row.domId === approval.domId);
      if (!local.some((target) => target.domId === approval.domId)) throw new Error('精确确认仍须提供完整局部几何锚点');
      return { ...approval, edges:targetRegion(meta,screen,node,item.viewport).edges };
    });
    cases.push({ ...item, reference, domId: screen.domId, local, textMasks, caseId, approved,
      selectedTabs: entry.selectedTabs, requiredLocal: keyModules.map((node) => node.domId),
      activation: trigger ? { trigger: trigger.domId, panel: panel.domId } : null });
  }
  for (const { screen, caseId } of required) if (!cases.some((item) => item.domId === screen.domId && item.caseId === caseId)) {
    findings.push(finding('D04', screen.domId + ':' + caseId, 'not_run', '缺同版必验视觉状态参考图'));
  }
  return cases;
}

async function auditRound(options, round) {
  const { pack, scopeVersion, expectVersion, out } = options;
  const product = checkPage({ pack, scopeVersion, expectVersion });
  if (!product.ok) throw new Error(product.reason);
  const meta = product.manifest;
  const root = mkdtempSync(join(out, 'c3-check-'));
  const evidence = {};
  const write = (path, bytes) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes, { flag: 'wx' });
    evidence[path] = { bytes: bytes.length, sha256: byteDigest(bytes) };
    return path;
  };
  const { results: findings, config, manifest } = auditStatic(pack, meta);
  const tweaks = meta.c4?.designDigest ? verifyDesign(meta, options.patchSource?.design) : [];
  let samples;
  if (options.handoffPack) {
    const checked = checkHandoff({ pack: options.handoffPack, expectVersion: meta.b3.version, scopeVersion, consumerContract: options.consumerContract }, { includePayloads: true });
    if (checked.ok && checked.manifestSha256 === meta.b3.digest) {
      samples = JSON.parse(checked.payloads.get(PACK_FILES.samples)).samples;
      findings.push(finding('D02', 'handoff-binding', 'pass', { version: checked.version, digest: checked.manifestSha256 }));
      let revised = [];
      let retained = [];
      if (meta.c4?.deltaDigest) {
        const { delta, material } = options.patchSource ?? {};
        const { version, ...body } = material ?? {};
        const changes = delta?.manifest?.affectedAssets;
        const materialDigest = meta.c4.deltaMaterialDigest ?? meta.c4.materialDigest;
        if (!delta?.ok || meta.c4.deltaDigest !== delta.manifestSha256 || materialDigest !== sha256Hex(material)
          || version !== sha256Hex(body) || material.delta.version !== delta.manifest.version
          || material.delta.digest !== delta.manifestSha256 || material.source.fileVersion !== delta.manifest.source.fileVersion
          || material.source.fileKey !== checked.manifest.scope.fileKey || changes.length !== material.assets.length
          || !material.assets.every((asset) => changes.some((item) => item.end === asset.end && item.nodeId === asset.nodeId
            && item.visualFingerprint === asset.visualFingerprint))) {
          throw new Error('C4 局部素材缺同版来源证明');
        }
        ({ revised,retained } = verifyDeltaConflicts(meta,delta.manifest,material,manifest));
        if (!revised.every((asset) => manifest.assets.some((item) => item.end === asset.end && item.nodeId === asset.nodeId
          && item.visualFingerprint === asset.visualFingerprint && item.sha256 === asset.sha256))) throw new Error('C4 换图与材料不符');
        findings.push(finding('D06', 'patch-source', 'pass', { delta:meta.c4.deltaDigest, material:materialDigest }));
        if (material.links) verifyLinkProof(config,delta.manifest,material.links);
        if (material.leaves) verifyLeaves(meta,delta.manifest,material.leaves);
        if (material.fonts) verifyFontProof(manifest,delta.manifest,material.fonts);
      }
      findings.push(...auditSource(checked, meta, manifest, [...revised,...retained], meta.c4?.deltaDigest ? options.patchSource.material.leaves : []));
    } else findings.push(finding('D02', 'handoff', 'not_run', checked.message ?? 'B3 不属于这份 C2'));
  } else findings.push(finding('D02', 'handoff', 'not_run', '需要同版 B3 清单独立对账，不能仅凭 C2 追溯自证'));
  let references = [];
  try { references = checkedReferences(options.references, options.referencesSha256, meta, pack, findings, tweaks); }
  catch (error) { findings.push(finding('D04', 'references', 'not_run', error.message)); }
  let browser = { results: [], screenshots: [], environment: null };
  try {
    browser = await auditBrowser({ root: join(pack, 'page'), meta, config, manifest, samples, referenceCases: references,
      capture: (item, screenshot, ready) => Promise.all([{ domId: item.domId, region: null }, ...item.local.filter((target) =>
        !item.approved.some((approval) => approval.domId === target.domId))].map(async (target) => {
        const binding = sha256Hex({ page: meta.version, index: options.referencesSha256, scopeVersion, screen: item.domId, state: item.caseId, target: target.domId, ready });
        const textMasks = target.region ? [] : ready.liveText.map((proof) => ({ rect: proof.rect,
          evidence: { binding, kind: 'live-text', result: 'pass', domId: proof.domId, digest: sha256Hex(proof) } }));
        const designMasks = target.region ? [] : item.approved.map(({ domId, rect, digest }) => ({ rect,
          evidence:{ binding, kind:'designer-confirmed', domId, digest } }));
        return { ...await compareOnePage({ reference: item.reference, screenshot, region: target.region,
          referenceSha256: item.sha256, viewport: item.viewport, textMasks, designMasks, binding,
          write: (name, bytes) => write('pixels/' + item.domId + '/' + item.caseId + '/' + target.domId + '/' + name, bytes) }),
        domId: target.domId, caseId: item.caseId, screenId: item.domId, viewport: item.viewport, region: target.region, ready };
      })) });
    findings.push(...browser.results, ...browser.screenshots.map((item) => finding('D04', item.screenId + ':' + item.caseId + ':' + item.domId, item.status, item.artifacts)));
  } catch (error) {
    findings.push(finding('D01', 'chromium', 'not_run', error.message));
  }
  if (browser.environment && config && !usesData(config)) findings.push(finding('D09', 'bindings', 'n_a', '集中配置无数据绑定'));
  if (browser.environment && !meta.nodes.some((row) => row.text?.trim()) && !manifest.fonts.length) {
    findings.push(finding('D05', 'live-text', 'n_a', '设计未声明原生文案或字体'));
  }
  if (browser.environment && config && !Object.keys(config.actions).length && !meta.tabBindings.length
      && !meta.nodes.some((row) => row.role === 'carousel') && meta.nodes.filter((row) => row.role === 'sec').length === meta.ends.length
      && !findings.some((row) => row.check === 'D08')) findings.push(finding('D08', 'controls', 'n_a', '本页每端仅一屏，无动作、TAB 或轮播'));
  const pagingSamples = (samples ?? []).filter((sample) => sample.testData === true).map((sample) => ({ id:sample.id,
    ...(sample.coverage?.ends ? { ends:Object.keys(sample.coverage.ends) } : {}) }));
  const expectedPaging = requiredPaging(meta, config, pagingSamples);
  for (const scope of expectedPaging) if (!hasPagingResult(browser.results, scope)) {
    findings.push(finding('D08', pagingKey(scope) + ':pagination-coverage', 'not_run', scope));
  }
  for (const [id, action] of Object.entries(config?.actions ?? {})) {
    const supported = ['go-section', 'next-section', 'open-modal', 'open-menu', 'toggle-menu', 'close-modal', 'close-menu',
      'next-page', 'previous-page', 'open-link', 'show-target', 'hide-target', 'set-state', 'copy-text'];
    const covered = ['next-page','previous-page'].includes(action.type) ? expectedPaging.some((row) => row.actionId === id)
      : findings.some((row) => row.detail?.actionId === id);
    if (!supported.includes(action.type) || !covered) {
      findings.push(finding('D08', id + ':action', 'not_run', '未能进入并实测已声明动作：' + action.type));
    }
  }
  for (const [id, binding] of Object.entries(config?.bindings ?? {})) {
    if (binding.pagination && findings.some((row) => row.target.endsWith(':' + id + ':drag'))
      && !findings.some((row) => row.check === 'D08' && row.target.startsWith(id + ':touch:'))) {
      findings.push(finding('D08', id + ':continuous', 'not_run', '有适用翻页，但缺真实触摸连续轨道证据'));
    }
    if (['list','slots'].includes(binding.data?.kind) && !findings.some((row) => row.check === 'D09' && row.target.startsWith(id + ':presentation:'))) {
      findings.push(finding('D09', id + ':presentation', 'not_run', '缺可运行的同版数据样例或产品节点'));
    }
    if (binding.fields?.field?.target === 'image' && !findings.some((row) => row.check === 'D11' && row.target.startsWith(id + ':fallback:'))) {
      findings.push(finding('D11', id + ':fallback', 'not_run', '缺可实跑的当前图绑定与离网失败样例'));
    }
  }
  if (config?.components?.backgroundVideo?.src) findings.push(finding('D11', 'video', 'not_run', '尚缺已配置视频的异常和再入场场景'));
  for (const check of CHECKS.slice(0, -1)) if (!findings.some((row) => row.check === check)) findings.push(finding(check, 'coverage', 'not_run', '缺适用场景或实跑证据'));
  const problems = findings.filter((row) => !['pass', 'n_a'].includes(row.status));
  findings.push(finding('D13', 'coverage', problems.length ? 'fail' : 'pass', { unresolved: problems.map((row) => row.id) }));
  write('browser-log.json', json({ environment: browser.environment, findings: browser.results }));
  if (meta.c4 && options.patchSource?.patchMeta) write('c4-patch-meta.json', json(options.patchSource.patchMeta));
  const current = checkPage({ pack, scopeVersion, expectVersion });
  if (!current.ok) throw new Error('检查期间成品改变：' + current.reason);
  const body = { schema: 'onepage-c-single-page/v1', status: problems.length ? 'fail' : 'pass', round,
    pageVersion: meta.version, scopeVersion, files: meta.files, findings, pagingSamples, coverage: summarizeChecks(findings), evidence: { ...evidence }, pixels: browser.screenshots };
  const version = sha256Hex(body);
  write(REPORT, json({ ...body, version }));
  write('stage-record.json', json(buildStageRecord({ stage: 'C', round: round + 1, inputs: inputBinding(meta),
    result: body.status, output: { kind: SINGLE_PAGE, version, path: REPORT, digest: evidence[REPORT].sha256 }, problems })));
  return { root, version, pageVersion: meta.version, status: body.status, findings, problems };
}

export async function runCCheck(options, { repair } = {}) {
  if (!options.pack || !options.out) throw new Error('缺 C2 成品或已存在的独立证据目录');
  const initial = { ...options, pack: realpathSync(options.pack), out: realpathSync(options.out) };
  return runRepairLoop({ initial, audit: (input, round) => {
    assertSeparated(input.pack, initial.out);
    return auditRound({ ...initial, pack: input.pack, expectVersion: input.expectVersion }, round);
  }, repair: repair && (async (context) => {
    const revised = await repair(context);
    if (!revised?.pack || !revised?.expectVersion) throw new Error('返修必须返回成品和版本，不得改验收范围');
    return { ...initial, pack: realpathSync(revised.pack), expectVersion: revised.expectVersion };
  }) });
}
