import { lstatSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { assertSeparated, readRegular } from './c-check/evidence.mjs';
import { pixelScope, targetRegion } from './c-check/pixel-scope.mjs';
import { planDesign } from './c-patch-design.mjs';
import { sha256Hex } from './canonical.mjs';
import { byteDigest, isDigest } from './handoff-check.mjs';
import { APPROVAL_FILE, APPROVED, approvalInput, inspectAcceptance, requireD, validateConfirmation } from './d-proof.mjs';
import { buildStageRecord, checkEntry } from './stage-record.mjs';
import { startPreview } from './d-preview.mjs';

const json = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function loadBound(path, digest) {
  requireD(path && isDigest(digest), '必须外传文件及 SHA-256');
  const bytes = readRegular(dirname(resolve(path)), basename(path));
  requireD(byteDigest(bytes) === digest, '外传文件摘要不符');
  return { bytes, value: JSON.parse(bytes) };
}

export function designInstruction(accepted, request) {
  const { target, property, value, caseId, basis, fingerprint } = request;
  const { page, binding, report } = accepted;
  requireD(fingerprint === accepted.fingerprint, '局部意见未绑定当前验收版本');
  const base = Object.fromEntries(['pageVersion', 'checkVersion', 'checkDigest', 'scopeVersion'].map((key) => [key, binding[key]]));
  const instruction = { schema: 'onepage-c4-design/v1', base, target, property, value };
  planDesign({ instruction, page, base });
  if (basis !== undefined) {
    const entry = pixelScope(page).find((row) => row.screen.end === target.end && row.screen.nodeId === target.module && row.caseId === caseId);
    const pixels = report.pixels.filter((row) => row.screenId === entry?.screen.domId && row.domId === row.screenId && row.caseId === caseId && row.region === null);
    requireD(pixels.length === 1, '局部确认必须对应同版已查屏与 TAB 状态');
    const [{ viewport }] = pixels;
    const node = page.nodes.find((row) => row.domId === target.domId);
    instruction.confirmation = { caseId, viewport, rect: targetRegion(page, entry.screen, node, viewport).region,
      basis, fingerprint: sha256Hex({ target, property, value }), pageVersion: base.pageVersion };
    planDesign({ instruction, page, base });
  }
  return instruction;
}

export function approve(options) {
  const accepted = inspectAcceptance(options);
  const { bytes, value: confirmation } = loadBound(options.confirmation, options.confirmationSha256);
  validateConfirmation(confirmation, accepted.fingerprint);
  requireD(options.output, '缺外置确认输出目录');
  const destination = resolve(options.output);
  const parent = dirname(destination);
  requireD(lstatSync(parent).isDirectory(), '批准目录的父路径必须是普通目录');
  assertSeparated(parent, options.pagePack);
  assertSeparated(parent, dirname(options.check));
  const body = { schema: 'onepage-d-design-approved/v1', binding: accepted.binding, fingerprint: accepted.fingerprint,
    confirmation, confirmationSha256: options.confirmationSha256 };
  const version = sha256Hex(body);
  const manifest = json({ ...body, version });
  const record = buildStageRecord({ stage: 'D', round: 1, inputs: approvalInput(body.binding), result: 'pass',
    output: { kind: APPROVED, version, path: APPROVAL_FILE, digest: byteDigest(manifest) } });
  try { lstatSync(destination); throw new Error('批准目录已存在'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const scratch = mkdtempSync(join(parent, '.d-writing-'));
  try {
    writeFileSync(join(scratch, APPROVAL_FILE), manifest, { flag: 'wx' });
    writeFileSync(join(scratch, 'confirmation.json'), bytes, { flag: 'wx' });
    writeFileSync(join(scratch, 'stage-record.json'), json(record), { flag: 'wx' });
    const checked = checkEntry(join(scratch, 'stage-record.json'), { ...options, expectedStage: 'D', expectedOutputKind: APPROVED, expectedOutputVersion: version });
    requireD(checked.ok, checked.reason);
    renameSync(scratch, destination);
    return { status: 'pass', version, record: join(destination, 'stage-record.json') };
  } finally { rmSync(scratch, { force: true, recursive: true }); }
}

const baseFlags = ['check', 'page-pack', 'page-version', 'check-version', 'scope-version'];
const flags = { accept: ['design', 'design-sha256'], preview: ['handoff-pack', 'consumer-contract', 'port'],
  approve: ['confirmation', 'confirmation-sha256', 'output'] };

export async function main(mode, argv) {
  try {
    const { values } = parseArgs({ args: argv, options: { help: { type: 'boolean' },
      ...Object.fromEntries([...baseFlags, ...flags[mode]].map((key) => [key, { type: 'string' }])) } });
    if (values.help) {
      console.log('d:' + mode + ' ' + [...baseFlags, ...flags[mode]].map((key) => '--' + key + ' <值>').join(' '));
      return 0;
    }
    const options = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
    if (mode === 'approve') console.log(JSON.stringify(approve(options)));
    else if (mode === 'preview') {
      const preview = await startPreview(options);
      console.log(JSON.stringify({ status: 'pass', url: preview.url }));
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, preview.close);
    } else {
      const accepted = inspectAcceptance(options);
      if (options.design || options.designSha256) console.log(json(designInstruction(accepted, loadBound(options.design, options.designSha256).value)).toString().trimEnd());
      else console.log(JSON.stringify({ status: 'pass', binding: accepted.binding, fingerprint: accepted.fingerprint }));
    }
    return 0;
  } catch (error) {
    console.error(JSON.stringify({ status: 'fail', reason: error.message }));
    return 1;
  }
}
