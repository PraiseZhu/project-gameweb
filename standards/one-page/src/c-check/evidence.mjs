import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import { canonicalJson, sha256Hex } from '../canonical.mjs';
import { checkPage, PAGE_KIND } from '../c-page-check.mjs';
import { byteDigest, isDigest, safeRelative } from '../handoff-check.mjs';
import { criticalModules, hasHiddenPaginationEvidence, pixelScope, targetRegion } from './pixel-scope.mjs';
import { auditStatic } from './static-audit.mjs';
import { hasPagingResult, requiredPaging } from './pagination-audit.mjs';

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
      for (const module of criticalModules(page.manifest, screen, state)) {
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
