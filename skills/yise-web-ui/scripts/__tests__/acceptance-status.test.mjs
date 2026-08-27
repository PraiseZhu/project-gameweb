import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInputHashes, TOOL_VERSION } from '../lib/fs-utils.mjs';
import { summarizeGate, validateReportIntegrity } from '../lib/report.mjs';
import { workflowDeclaration } from '../lib/workflows.mjs';
import { playwrightBrowserSkipMessage, probePlaywrightCapability } from '../lib/runtime-capabilities.mjs';
import { templateExtractor } from './_extractor-template.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const VERIFY = join(ROOT, 'scripts/verify.mjs');
const PLAYWRIGHT_PROBE = probePlaywrightCapability(ROOT);
const HAS_BROWSER_DEPS = PLAYWRIGHT_PROBE.available;
const BROWSER_SKIP = playwrightBrowserSkipMessage(PLAYWRIGHT_PROBE);

function hashFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function safeJsonForScript(value) {
  return JSON.stringify(value).replaceAll('</script', '<\\/script');
}

function run(script, args, opts = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    timeout: opts.timeout ?? 180000,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function writeMinimalDemo(workflowId) {
  const dir = mkdtempSync(join(tmpdir(), 'yise-acceptance-status-' + workflowId + '-'));
  mkdirSync(dir, { recursive: true });
  const source = join(dir, 'source.txt');
  writeFileSync(source, 'source-v1');
  const leaf = (value, locator) => ({ value, provenance: { source: 'source.txt', locator, hash: hashFile(source) } });
  const truth = {
    geometry: { width: leaf(16, 'width') },
    colors: { text: leaf('#ff0000', 'text-color') },
  };
  const workflow = workflowDeclaration(workflowId);
  const spec = {
    meta: { name: 'acceptance-status-' + workflowId, summary: { what: 'status fixture', how: 'minimal workflow', accept: 'structured status' } },
    workflow,
    matrix: { platforms: ['desktop'], regions: ['cn'], systems: ['ios'], themes: ['light'], langs: ['zh-CN'] },
    states: [{ id: 'id', via: [{ expect: 'id' }] }],
    verify: {
      cases: [{ id: 'desktop-cn-light', prefs: { plat: 'desktop', region: 'cn', os: 'ios', mode: 'light', lang: 'zh-CN' }, via: [{ expect: 'id' }] }],
      noClip: ['.box'],
    },
    bindings: [],
  };
  writeFileSync(join(dir, 'truth.json'), JSON.stringify(truth, null, 2));
  writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec, null, 2));
  writeFileSync(join(dir, 'extract.mjs'), templateExtractor(truth));
  copyFileSync(join(ROOT, 'scripts/lib/extract-helpers.mjs'), join(dir, 'extract-helpers.mjs'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><head><style>\n'
    + '    .box{width:16px;min-height:16px;color:#ff0000;white-space:nowrap}\n'
    + '    #frame{width:16px;height:16px;background:#f00}\n'
    + '  </style></head><body>\n'
    + '    <script id="qa-truth" type="application/json">' + safeJsonForScript(truth) + '</script>\n'
    + '    <button data-qa-pref="plat:desktop">desktop</button>\n'
    + '    <button data-qa-pref="region:cn">cn</button>\n'
    + '    <button data-qa-pref="os:ios">ios</button>\n'
    + '    <button data-qa-pref="mode:light">light</button>\n'
    + '    <button data-qa-pref="lang:zh-CN">zh</button>\n'
    + '    <div class="box">x</div><div id="frame"></div>\n'
    + '    <script>\n'
    + "      const S={step:'id',prefs:{plat:'desktop',region:'cn',os:'ios',mode:'light',lang:'zh-CN'}};\n"
    + '      window.__qa={\n'
    + "        current:()=>S.step,\n"
    + "        goto:(id)=>{ if(id!=='id') throw new Error('unknown state'); S.step=id; },\n"
    + "        prefs:()=>({...S.prefs}),\n"
    + "        scale:()=>1,\n"
    + "        resize:(w,h)=>{ document.querySelector('#frame').style.width=w+'px'; document.querySelector('#frame').style.height=h+'px'; },\n"
    + "        metrics:()=>{ const r=document.querySelector('#frame').getBoundingClientRect(); return {frame:{w:r.width,h:r.height},probes:{}}; }\n"
    + '      };\n'
    + '    </script>\n'
    + '  </body></html>');
  return { dir, spec };
}

function parseReport(stdout) {
  return JSON.parse(stdout);
}

function syntheticReport(dir, spec, workflowId) {
  const gateA = { name: 'truth', status: 'passed', pass: true, failures: [] };
  const gateB = { name: 'state', status: 'limited', pass: false, total: 1, passed: 1, failures: [], detail: 'minimal state coverage' };
  const gateC = { name: 'interaction', status: 'limited', pass: false, checks: [{ id: 'no-clip', pass: true, failures: [] }], failures: [], detail: 'no-clip only' };
  const gateD = { name: 'binding', status: 'not-claimed', pass: false, total: 0, passed: 0, failures: [], detail: 'no bindings' };
  const gateF = { name: 'adaptive', status: 'not-claimed', pass: false, total: 0, passed: 0, failures: [], detail: 'no adaptive' };
  const gateX = { name: 'custom', status: 'not-claimed', pass: false, total: 0, passed: 0, failures: [], detail: 'no custom gates' };
  return {
    ok: workflowId === 'figma-showcase',
    workflow: workflowId,
    partial: false,
    toolVersion: TOOL_VERSION,
    demo: spec.meta.name,
    inputHashes: buildInputHashes(dir, spec),
    coverage: { cases: spec.verify.cases.map((c) => ({ id: c.id, prefs: c.prefs })) },
    gateA,
    gateB,
    gateC,
    gateD,
    gateF,
    gateX,
    outcome: {
      workflow: workflowId,
      status: 'limited',
      passed: ['gateA'],
      limited: ['gateB', 'gateC'],
      notClaimed: ['gateD', 'gateF', 'gateX'],
      blocked: [],
      skipped: [],
      workflowAcceptable: workflowId === 'figma-showcase',
      productPrComplete: false,
    },
    evidenceLevel: 'candidate',
  };
}

test('gate summarizer treats limited and not-claimed as non-passing evidence states', () => {
  assert.equal(summarizeGate({ status: 'passed', pass: true, total: 1, passed: 1, failures: [] }).ok, true);
  assert.equal(summarizeGate({ status: 'limited', pass: false, total: 1, passed: 1, failures: [], detail: 'minimal' }).ok, false);
  assert.equal(summarizeGate({ status: 'not-claimed', pass: false, total: 0, passed: 0, failures: [], detail: 'absent' }).ok, false);
  const inconsistent = summarizeGate({ status: 'not-claimed', pass: true, total: 0, passed: 0, failures: [] });
  assert.equal(inconsistent.ok, false);
  assert.match(inconsistent.reason, /must not set pass:true/);
});

test('report integrity blocks product-qa when required gates are limited or not claimed', () => {
  const { dir, spec } = writeMinimalDemo('product-qa');
  const problems = validateReportIntegrity(dir, spec, syntheticReport(dir, spec, 'product-qa'));
  assert.ok(problems.some((p) => /gateB.*limited/.test(p)), problems.join('\n'));
  assert.ok(problems.some((p) => /gateD.*not-claimed/.test(p)), problems.join('\n'));
  assert.ok(problems.some((p) => /productPrComplete/.test(p)), problems.join('\n'));
});

test('report integrity rejects figma-showcase as product PR completion even when workflow-acceptable', () => {
  const { dir, spec } = writeMinimalDemo('figma-showcase');
  const problems = validateReportIntegrity(dir, spec, syntheticReport(dir, spec, 'figma-showcase'));
  assert.ok(problems.some((p) => /figma-showcase.*不得作为产品 PR/.test(p)), problems.join('\n'));
  assert.ok(problems.some((p) => /gateD.*not-claimed/.test(p)), problems.join('\n'));
});

test('targeted verify --gate A ignores unrelated skipped gates for command success', { timeout: 120000 }, () => {
  const { dir } = writeMinimalDemo('product-qa');
  const res = run(VERIFY, ['--demo', dir, '--gate', 'A']);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const report = parseReport(res.stdout);
  assert.equal(report.partial, true);
  assert.equal(report.workflow, 'product-qa');
  assert.equal(report.ok, true);
  assert.equal(report.outcome.scope, 'targeted');
  assert.equal(report.outcome.status, 'passed');
  assert.equal(report.outcome.productPrComplete, false);
  assert.deepEqual(report.outcome.passed, ['gateA']);
  assert.deepEqual(report.outcome.skipped.sort(), ['gateB', 'gateC', 'gateD', 'gateF', 'gateX']);
});

test('verify reports limited and not-claimed gates instead of thin green pass', { timeout: 240000 }, (t) => {
  if (!HAS_BROWSER_DEPS) {
    t.skip(BROWSER_SKIP);
    return;
  }
  const { dir } = writeMinimalDemo('product-qa');
  const res = run(VERIFY, ['--demo', dir]);
  assert.equal(res.status, 2, res.stderr || res.stdout);
  const report = parseReport(res.stdout);
  assert.equal(report.workflow, 'product-qa');
  assert.equal(report.ok, false);
  assert.equal(report.outcome.status, 'limited');
  assert.deepEqual(report.outcome.limited.sort(), ['gateB', 'gateC']);
  assert.deepEqual(report.outcome.notClaimed.sort(), ['gateD', 'gateF', 'gateX']);
  assert.equal(report.outcome.productPrComplete, false);
  assert.equal(report.gateB.status, 'limited');
  assert.equal(report.gateC.status, 'limited');
  assert.equal(report.gateD.status, 'not-claimed');
  assert.equal(report.gateF.status, 'not-claimed');
  assert.equal(report.gateX.status, 'not-claimed');
  assert.equal(report.gateD.pass, false);
  assert.equal(report.gateF.pass, false);
  assert.equal(report.gateX.pass, false);
});

test('figma-showcase may be workflow-acceptable but is rejected as product PR evidence', { timeout: 240000 }, (t) => {
  if (!HAS_BROWSER_DEPS) {
    t.skip(BROWSER_SKIP);
    return;
  }
  const { dir, spec } = writeMinimalDemo('figma-showcase');
  const res = run(VERIFY, ['--demo', dir]);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const report = parseReport(res.stdout);
  assert.equal(report.workflow, 'figma-showcase');
  assert.equal(report.ok, true);
  assert.equal(report.outcome.workflowAcceptable, true);
  assert.equal(report.outcome.productPrComplete, false);
  assert.equal(report.outcome.status, 'limited');
  const problems = validateReportIntegrity(dir, spec, report);
  assert.ok(problems.some((p) => /figma-showcase.*不得作为产品 PR/.test(p)), problems.join('\n'));
  assert.ok(problems.some((p) => /gateD.*not-claimed/.test(p)), problems.join('\n'));
});
