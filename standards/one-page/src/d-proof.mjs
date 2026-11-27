import { basename, dirname } from 'node:path';
import { parameters } from '../../stop1-figma-pixel/tool/src/one-page-pixel.mjs';
import { canonicalJson, sha256Hex } from './canonical.mjs';
import { byteDigest, isDigest } from './handoff-check.mjs';
import { assertSeparated, checkSinglePageEntry, readRegular } from './c-check/evidence.mjs';
import { checkPage } from './c-page-check.mjs';

export const APPROVED = 'd-design-approved';
export const APPROVAL_FILE = 'design-approved.json';
export const same = (left, right) => canonicalJson(left) === canonicalJson(right);
export function requireD(condition, message) {
  if (!condition) throw new Error(message);
}

export function verifyPixels(report, root) {
  for (const pixel of report.pixels) {
    const { engine, binding, viewport, region, referenceSha256, screenshotSha256, textMasks, designMasks } = pixel;
    const masks = designMasks?.length ? { designMasks } : {};
    requireD(engine?.name === 'pixelmatch' && typeof engine.version === 'string' && engine.version
      && same(pixel.parameters, parameters) && isDigest(binding) && isDigest(referenceSha256) && isDigest(screenshotSha256)
      && Number.isSafeInteger(pixel.effectivePixels) && pixel.effectivePixels > 0
      && Number.isSafeInteger(pixel.differingPixels) && pixel.differingPixels >= 0
      && pixel.differingPixels / pixel.effectivePixels <= parameters.maxDifference
      && pixel.fingerprint === byteDigest(Buffer.from(JSON.stringify({ engine, parameters, binding, viewport, region,
        referenceSha256, screenshotSha256, textMasks, ...masks }))), '像素证据的规则或指纹不是当前版');
    const size = region ? region.slice(2) : [viewport.width, viewport.height];
    for (const role of ['reference', 'actual', 'diff']) {
      const bytes = readRegular(root, pixel.artifacts[role]);
      requireD(bytes.length >= 33 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
        && bytes.toString('ascii', 12, 16) === 'IHDR' && same([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], size)
        && byteDigest(bytes) === report.evidence[pixel.artifacts[role]].sha256, '缺当前版非空三图或截图尺寸不符');
      if (!region && role !== 'diff') requireD(byteDigest(bytes) === (role === 'reference' ? referenceSha256 : screenshotSha256), '整屏图与像素输入不符');
    }
  }
}

export function inspectAcceptance({ check, pagePack, pageVersion, checkVersion, scopeVersion }) {
  const checked = checkSinglePageEntry(check, { expectedStage: 'C', expectedOutputVersion: checkVersion, pagePack, pageVersion, scopeVersion });
  requireD(checked.ok, checked.reason);
  const built = checkPage({ pack: pagePack, expectVersion: pageVersion, scopeVersion });
  requireD(built.ok, built.reason);
  verifyPixels(checked.manifest, dirname(check));
  const { baseLanguage: language, files, c4 } = built.manifest;
  const binding = { pageVersion, checkVersion, scopeVersion, checkDigest: checked.record.output.digest,
    stageVersion: checked.record.version, stage: c4 ? 'C4' : 'C3', language, files };
  return { binding, fingerprint: sha256Hex(binding), page: built.manifest, report: checked.manifest };
}

export function validateConfirmation(confirmation, fingerprint) {
  requireD(confirmation && same(Object.keys(confirmation).sort(), ['basis', 'designer', 'fingerprint', 'schema'])
    && confirmation.schema === 'onepage-d-dialogue-confirmation/v1' && confirmation.fingerprint === fingerprint
    && ['designer', 'basis'].every((key) => typeof confirmation[key] === 'string' && confirmation[key].trim() && confirmation[key].length <= 300),
  '缺设计师对话确认，或确认未绑定当前验收指纹');
}

export const approvalInput = ({ checkVersion, checkDigest, scopeVersion }) =>
  [{ kind: 'c-single-page', version: checkVersion, digest: checkDigest, scopeVersion }];

export function checkDesignApproved(recordPath, options) {
  try {
    requireD(options.expectedStage === 'D' && basename(recordPath) === 'stage-record.json' && isDigest(options.expectedOutputVersion), '缺 D 阶段、记录或外传批准版本');
    const root = dirname(recordPath);
    assertSeparated(root, options.pagePack);
    assertSeparated(root, dirname(options.check));
    const bytes = readRegular(root, APPROVAL_FILE);
    const confirmationBytes = readRegular(root, 'confirmation.json');
    const manifest = JSON.parse(bytes);
    const { version, ...body } = manifest;
    const record = JSON.parse(readRegular(root, 'stage-record.json'));
    const { version: recordVersion, ...stage } = record;
    const current = inspectAcceptance(options);
    requireD(body.schema === 'onepage-d-design-approved/v1' && version === options.expectedOutputVersion && version === sha256Hex(body)
      && same(body.binding, current.binding) && body.fingerprint === current.fingerprint
      && byteDigest(confirmationBytes) === body.confirmationSha256 && same(body.confirmation, JSON.parse(confirmationBytes))
      && recordVersion === sha256Hex(stage) && stage.stage === 'D' && stage.result === 'pass'
      && same(stage.inputs, approvalInput(current.binding))
      && same(stage.output, { kind: APPROVED, version, path: APPROVAL_FILE, digest: byteDigest(bytes) }), '设计确认凭证或上游版本已漂移');
    validateConfirmation(body.confirmation, current.fingerprint);
    return { ok: true, record, manifest };
  } catch (error) {
    return { ok: false, reason: 'D 验包失败：' + error.message };
  }
}
