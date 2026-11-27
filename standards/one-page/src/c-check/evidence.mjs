import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import { canonicalJson, sha256Hex } from '../canonical.mjs';
import { checkPage, PAGE_KIND } from '../c-page-check.mjs';
import { byteDigest, isDigest, safeRelative } from '../handoff-check.mjs';
import { affectedDomIds, criticalModules, hasHiddenPaginationEvidence, pixelScope, targetRegion } from './pixel-scope.mjs';
import { auditStatic } from './static-audit.mjs';
import { hasPagingResult, requiredPaging } from './pagination-audit.mjs';
import { approvedDesignRegions, designRule, verifyDesign } from '../c-patch-design.mjs';
import { verifyLinkProof } from '../c-patch-links.mjs';
import { verifyDeltaConflicts } from '../c-patch-conflict.mjs';
import { verifyLeaves } from '../c-patch-leaves.mjs';
import { verifyFontProof } from '../c-patch-fonts.mjs';
import { verifySharedExpansion } from '../c-patch-expansion.mjs';

export const SINGLE_PAGE = 'c-single-page';
export const REPORT = 'check-report.json';
export const CHECKS = Array.from({ length: 13 }, (_, index) => 'D' + String(index + 1).padStart(2, '0'));
export function summarizeChecks(findings) {
  return Object.fromEntries(CHECKS.map((check) => {
    const rows = findings.filter((row) => row.check === check);
    const status = rows.some((row) => row.status === 'fail') ? 'fail'
      : !rows.length || rows.some((row) => !['pass','n_a'].includes(row.status)) ? 'not_run'
        : rows.every((row) => row.status === 'n_a') ? 'n_a' : 'pass';
    return [check, { status, evidence: rows.map((row) => row.id).sort() }];
  }));
}
export const inputBinding = (meta) => [{ kind: PAGE_KIND, version: meta.version, scopeVersion: meta.scopeVersion }];
const same = (left, right) => canonicalJson(left) === canonicalJson(right);

export function readRegular(root, path) {
  if (!safeRelative(path) || !lstatSync(root).isDirectory()) throw new Error('证据路径不合法');
  const parts = path.split('/');
  let target = root;
  for (const [index, part] of parts.entries()) {
    target = join(target, part);
    const stat = lstatSync(target);
    if (!(index === parts.length - 1 ? stat.isFile() : stat.isDirectory())) throw new Error('证据只接受普通文件和目录');
  }
  const bytes = readFileSync(target);
  if (!bytes.length) throw new Error('证据为空');
  return bytes;
}

export function assertSeparated(left, right) {
  const one = realpathSync(left);
  const two = realpathSync(right);
  if (one === two || one.startsWith(two + sep) || two.startsWith(one + sep)) throw new Error('成品和证据必须物理分离');
}

export function checkSinglePageEntry(path, options) {
  try {
    const { expectedStage, expectedOutputVersion, scopeVersion, pagePack, pageVersion } = options;
    if (expectedStage !== 'C' || basename(path) !== 'stage-record.json' || !pagePack || !isDigest(expectedOutputVersion)) throw new Error('缺外传阶段、版本、范围或成品');
    const root = dirname(path);
    assertSeparated(root, pagePack);
    const page = checkPage({ pack: pagePack, expectVersion: pageVersion, scopeVersion });
    if (!page.ok) throw new Error(page.reason);
    const record = JSON.parse(readRegular(root, 'stage-record.json'));
    const { version, ...stage } = record;
    const reportBytes = readRegular(root, REPORT);
    const { version: reportVersion, ...report } = JSON.parse(reportBytes);
    if (version !== sha256Hex(stage) || stage.stage !== 'C' || stage.result !== 'pass' || !same(stage.inputs, inputBinding(page.manifest))
      || !same(stage.output, { kind: SINGLE_PAGE, version: expectedOutputVersion, path: REPORT, digest: byteDigest(reportBytes) })
      || reportVersion !== expectedOutputVersion || reportVersion !== sha256Hex(report) || report.status !== 'pass'
      || report.pageVersion !== pageVersion || report.scopeVersion !== scopeVersion || !same(report.files, page.manifest.files)
      || !same(report.coverage, summarizeChecks(report.findings)) || report.coverage.D13.status !== 'pass'
      || !report.findings.some((row) => row.id === 'D02:handoff-binding' && row.status === 'pass')
      || !CHECKS.every((check) => report.findings.some((row) => row.check === check))
      || !report.findings.every((row) => row.status === 'pass' || (row.status === 'n_a' && typeof row.detail === 'string' && row.detail.trim()))) throw new Error('报告缺证、未通过或绑定不符');
    const files = ['browser-log.json'];
    let tweaks = [];
    if (page.manifest.c4) {
      files.push('c4-patch-meta.json');
      const patch = JSON.parse(readRegular(root, 'c4-patch-meta.json'));
      verifySharedExpansion(page.manifest,report,patch.sharedAudit);
      if (patch.schema !== 'onepage-c4-patch/v1' || patch.pageVersion !== pageVersion) throw new Error('C4 元数据未绑定成品');
      if (page.manifest.c4.designDigest) {
        tweaks = verifyDesign(page.manifest, patch.design);
        const css = readRegular(pagePack, 'page/css/styles.css').toString();
        if (!same(tweaks,patch.manualTweaks) || !tweaks.every((anchor) => css.split('\n' + designRule(anchor) + '\n').length === 2)) {
          throw new Error('C4 微调锚点与成品不符');
        }
      }
      if (page.manifest.c4.deltaDigest) {
      const { material, delta } = patch;
      const { version: materialVersion, ...materialBody } = material;
      const { version: deltaVersion, newPackVersion, ...deltaBody } = delta;
      const { config, manifest } = auditStatic(pagePack, page.manifest);
      const { manualTweaks, revised } = verifyDeltaConflicts(page.manifest,delta,material,manifest);
      const css = readRegular(pagePack,'page/css/styles.css').toString();
      if (!page.manifest.c4.designDigest && (!same(patch.manualTweaks,manualTweaks) || !manualTweaks.every((anchor) => css.split('\n' + designRule(anchor) + '\n').length === 2)
        || material.manual?.prior.some((anchor) => !manualTweaks.some((kept) => kept.fingerprint === anchor.fingerprint)
          && css.includes('\n' + designRule(anchor) + '\n')))) throw new Error('B4 裁决与实际手调样式不符');
      const validAsset = (item) => manifest.assets.some((actual) => actual.end === item.end && actual.nodeId === item.nodeId
        && actual.visualFingerprint === item.visualFingerprint && actual.sha256 === item.sha256 && actual.bytes === item.bytes
        && actual.source.fileKey === material.source.fileKey && actual.source.fileVersion === item.source.fileVersion
        && (material.carried?.includes(JSON.stringify([item.end,item.nodeId])) ? isDigest(material.parentDelta) && actual.path === item.path
          : actual.source.fileVersion === material.source.fileVersion)
        && (actual.original?.sha256 ?? null) === (item.original?.sha256 ?? null));
      const materialDigest = page.manifest.c4.deltaMaterialDigest ?? page.manifest.c4.materialDigest;
      const affected = [...new Set([...affectedDomIds(page.manifest,delta,material),...tweaks.map((row) => row.target.domId)])].sort();
      if (sha256Hex(materialBody) !== materialVersion || sha256Hex(material) !== materialDigest
        || deltaVersion !== newPackVersion || deltaVersion !== sha256Hex(deltaBody) || deltaVersion !== material.delta.version
        || material.delta.digest !== page.manifest.c4.deltaDigest
        || sha256Hex(Buffer.from(JSON.stringify(delta, null, 2) + '\n')) !== material.delta.digest
        || delta.basePackVersion !== page.manifest.b3.version || delta.basePackDigest !== page.manifest.b3.digest
        || delta.baseScopeVersion !== scopeVersion || material.source.fileVersion !== delta.source.fileVersion
        || !same(affected, page.manifest.c4.affectedDomIds)
        || material.assets.length !== delta.affectedAssets.length
        || !delta.affectedAssets.every((item) => material.assets.filter((asset) => asset.end === item.end && asset.nodeId === item.nodeId
          && asset.visualFingerprint === item.visualFingerprint).length === 1) || !revised.every(validAsset)
        || !report.findings.some((row) => row.id === 'D06:patch-source' && row.status === 'pass'
          && same(row.detail, { delta:material.delta.digest, material:materialDigest }))) throw new Error('C4 素材来源证据未绑定');
      if (material.links) {
        verifyLinkProof(config,delta,material.links);
        if (!page.manifest.c4.designDigest && patch.expansion?.path !== 'js/config.js') throw new Error('C4 缺共用配置扩验记录');
      }
      if (material.leaves) verifyLeaves(page.manifest,delta,material.leaves);
      if (material.fonts) {
        verifyFontProof(manifest,delta,material.fonts);
        if (!page.manifest.c4.designDigest && !same(patch.expansion?.paths,['css/font/','css/styles.css'])) throw new Error('C4 缺共用字体扩验记录');
      }
      }
    }
    for (const pixel of report.pixels) {
      if (pixel.status !== 'pass' || !isDigest(pixel.fingerprint)) throw new Error('D04 未通过');
      files.push(...['reference', 'actual', 'diff'].map((role) => pixel.artifacts[role]));
    }
    if (!report.pixels.length || new Set(files).size !== files.length || files.length !== Object.keys(report.evidence).length) throw new Error('缺有效三图或存在重复证据');
    for (const file of files) {
      const bytes = readRegular(root, file);
      if (!same(report.evidence[file], { bytes: bytes.length, sha256: byteDigest(bytes) })) throw new Error('证据大小或 SHA-256 不符');
    }
    const log = JSON.parse(readRegular(root, 'browser-log.json'));
    if (!log.environment?.chromium || !Array.isArray(log.findings) || !log.findings.length
      || !log.findings.every((row) => report.findings.some((finding) => same(finding, row)))) throw new Error('缺同版浏览器实跑日志');
    const { config } = auditStatic(pagePack, page.manifest);
    if (!Array.isArray(report.pagingSamples) || !requiredPaging(page.manifest, config, report.pagingSamples)
      .every((scope) => hasPagingResult(log.findings, scope))) throw new Error('D08 缺精确分页动作证据');
    for (const state of pixelScope(page.manifest)) {
      const { screen, caseId } = state;
      const pixels = report.pixels.filter((pixel) => pixel.screenId === screen.domId && pixel.caseId === caseId);
      const full = pixels.filter((pixel) => pixel.domId === screen.domId && pixel.region === null);
      if (full.length !== 1) throw new Error('D04 缺同版必验屏状态证据：' + caseId);
      const approvals = approvedDesignRegions(tweaks, screen, caseId, full[0].viewport);
      const masks = approvals.map(({ domId, rect, digest }) => ({ rect, evidence:{ binding:full[0].binding, kind:'designer-confirmed', domId, digest } }));
      if (!same(full[0].designMasks ?? [],masks) || pixels.some((pixel) => pixel !== full[0] && pixel.designMasks?.length)
        || !approvals.every((approval) => log.findings.some((row) => row.id === 'D04:' + screen.domId + ':' + caseId + ':' + approval.domId + ':designer-confirmed'
          && row.status === 'pass' && same(row.detail, { ...approval, edges:targetRegion(page.manifest,screen,
            page.manifest.nodes.find((node) => node.domId === approval.domId),full[0].viewport).edges })))) throw new Error('D04 设计确认缺精确同版证据');
      for (const module of criticalModules(page.manifest, screen, state)) {
        if (approvals.some((approval) => approval.domId === module.domId)) continue;
        if (hasHiddenPaginationEvidence(log.findings, { end:screen.end, screen:screen.domId, caseId }, module.domId, config?.actions?.[module.domId])) continue;
        if (!pixels.some((pixel) => pixel.domId === module.domId && same(pixel.viewport, full[0].viewport)
          && same(pixel.region, targetRegion(page.manifest, screen, module, pixel.viewport).region))) throw new Error('D04 缺完整局部证据：' + module.domId);
      }
    }
    return { ok: true, record, manifest: { ...report, version: reportVersion } };
  } catch (error) {
    return { ok: false, reason: 'C3 验包失败：' + error.message };
  }
}
