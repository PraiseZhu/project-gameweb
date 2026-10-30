#!/usr/bin/env node
/**
 * EWS stop-1 orchestrator. Does not rebuild the page. Same demo for every gate.
 * All green → awaiting-user-review only. Does not confirm or deploy.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadReadyPack } from './lib/handoff-contract.mjs';
import { runPreviewFirst } from './preview-first.mjs';
import { runReconcilePage } from './lib/page-reconcile.mjs';
import { runPolicyMirror } from './policy-mirror.mjs';
import { runProductViewport } from './product-viewport.mjs';
import { runStop1Pixel } from './stop1-pixel.mjs';
import { runLiveCopy } from './live-copy.mjs';
import { resolveStop1BrowserTools } from './lib/browser-session.mjs';

const SKILL_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPORT_SCHEMA = 'ews-stop1/v1';
const GATES = ['preview:first', 'assets-reconcile', 'policy-mirror', 'product-viewport', 'live-copy', 'stop1-pixel', 'qa-toolbar'];

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !String(argv[i + 1]).startsWith('--') ? argv[i + 1] : null;
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function fileHash(abs) {
  return existsSync(abs) ? sha256(readFileSync(abs)) : null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\'/g, '&#39;');
}

export function writeReportHtml(artifactsDir, report) {
  const rows = (report.gates || []).map((gate) => (
    `<tr><td>${escapeHtml(gate.gate)}</td><td>${gate.ok ? 'green' : 'red'}</td><td>${escapeHtml((gate.problems || []).join('; '))}</td></tr>`
  )).join('');
  const html = `<!doctype html><meta charset="utf-8"><title>EWS stop1</title>
<p>status: ${escapeHtml(report.status)}</p>
<p>fingerprint: ${escapeHtml(report.fingerprint || '')}</p>
<table border="1" cellpadding="6"><thead><tr><th>gate</th><th>ok</th><th>problems</th></tr></thead><tbody>${rows}</tbody></table>
<p>合成绿不是本期停一。全绿仅 awaiting-user-review。</p>`;
  writeFileSync(join(artifactsDir, 'report.html'), html);
}

export async function runStop1(argv = process.argv.slice(2), {
  cwd = process.cwd(),
  skillRoot = SKILL_ROOT,
  serve = false,
} = {}) {
  const demoArg = arg(argv, '--demo');
  const handoffArg = arg(argv, '--handoff');
  const assetsArg = arg(argv, '--assets');
  const configArg = arg(argv, '--config');
  const artifactsArg = arg(argv, '--artifacts');
  const problems = [];
  if (!demoArg) problems.push('缺少 --demo');
  if (!handoffArg) problems.push('缺少 --handoff');
  if (!assetsArg) problems.push('缺少 --assets');
  if (!configArg) problems.push('缺少 --config');
  if (problems.length) {
    return { ok: false, schema: REPORT_SCHEMA, status: 'blocked', problems, gates: [] };
  }

  const demoDir = isAbsolute(demoArg) ? demoArg : resolve(cwd, demoArg);
  const handoffDir = isAbsolute(handoffArg) ? handoffArg : resolve(cwd, handoffArg);
  const assetsPath = isAbsolute(assetsArg) ? assetsArg : resolve(cwd, assetsArg);
  const configPath = isAbsolute(configArg) ? configArg : resolve(cwd, configArg);
  const artifactsDir = artifactsArg
    ? (isAbsolute(artifactsArg) ? artifactsArg : resolve(cwd, artifactsArg))
    : join(demoDir, 'artifacts', 'stop1');
  mkdirSync(artifactsDir, { recursive: true });

  const pack = loadReadyPack(handoffDir);
  const inputHash = {
    fingerprint: pack.fingerprint || null,
    snapshot: {
      pc: pack.sources?.pc?.snapshotHashDeclared || null,
      mobile: pack.sources?.mobile?.snapshotHashDeclared || null,
    },
    model: fileHash(join(demoDir, 'model.json')),
    index: fileHash(join(demoDir, 'index.html')),
    runtime: fileHash(join(demoDir, 'runtime', 'boot.mjs')),
    runtimeCss: fileHash(join(demoDir, 'runtime', 'ews.css')),
    runtimeIdentity: (() => {
      try {
        return JSON.parse(readFileSync(join(demoDir, 'model.json'), 'utf8')).runtimeIdentity || null;
      } catch {
        return null;
      }
    })(),
    design: fileHash(resolve(skillRoot, 'DESIGN.md')),
    config: fileHash(configPath),
    assets: fileHash(assetsPath),
  };
  const previousPath = join(artifactsDir, 'stop1.json');
  let stalePrevious = false;
  if (existsSync(previousPath)) {
    try {
      const prev = JSON.parse(readFileSync(previousPath, 'utf8'));
      stalePrevious = JSON.stringify(prev.inputHash) !== JSON.stringify(inputHash);
    } catch {
      stalePrevious = true;
    }
  }

  const gateArgs = [
    '--demo', demoDir,
    '--handoff', handoffDir,
    '--assets', assetsPath,
    '--config', configPath,
    '--locales', 'zh-CN',
    '--artifacts', artifactsDir,
  ];
  const gates = [];
  const push = (name, result) => {
    const row = {
      gate: name,
      ok: result?.ok === true,
      problems: result?.problems || [],
      status: result?.status || (result?.ok ? 'PASS' : 'FAIL'),
    };
    gates.push(row);
    if (!row.ok) problems.push(...row.problems.map((item) => `${name}: ${item}`));
    return row.ok;
  };

  push('preview:first', await runPreviewFirst(gateArgs, { cwd: demoDir, skillRoot }));
  push('assets-reconcile', runReconcilePage(gateArgs, { cwd: demoDir }));
  push('policy-mirror', await runPolicyMirror({ skillRoot }));
  let product;
  try {
    product = await runProductViewport(gateArgs, { cwd: demoDir, skillRoot });
  } catch (err) {
    product = { ok: false, gate: 'product-viewport', problems: [err.message] };
  }
  push('product-viewport', product);
  const toolbarProblems = (product.problems || []).filter((item) => /工具栏/.test(item));
  push('qa-toolbar', {
    ok: toolbarProblems.length === 0,
    problems: toolbarProblems,
  });
  push('live-copy', await runLiveCopy(gateArgs, { cwd: demoDir, skillRoot }));
  push('stop1-pixel', await runStop1Pixel(gateArgs, { cwd: demoDir, skillRoot }));

  const missing = GATES.filter((name) => !gates.some((row) => row.gate === name));
  if (missing.length) problems.push(`缺门 ${missing.join(', ')}`);
  const okGates = gates.every((row) => row.ok) && missing.length === 0;
  const status = okGates ? 'awaiting-user-review' : 'blocked';
  const report = {
    schema: REPORT_SCHEMA,
    ok: okGates,
    status,
    fingerprint: pack.fingerprint || null,
    inputHash,
    reviewScope: { locales: ['zh-CN'], checks: ['static', 'interaction', 'adaptive'], interactionChecklist: 'docs/stop2.md', interactionReview: 'pending' },
    stalePrevious,
    gates,
    problems: [...new Set(problems)],
    artifactsDir,
    note: '停一仅简中静态、交互和自适应。机器绿后仍须完成 docs/stop2.md 全部交互清单并由用户确认。合成绿不是本期验收；不得沿用 hash 不符的旧报告。',
  };
  writeFileSync(join(artifactsDir, 'stop1.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeReportHtml(artifactsDir, report);

  if (okGates && (serve || argv.includes('--serve'))) {
    const tools = resolveStop1BrowserTools(skillRoot);
    if (!tools.ok) {
      report.ok = false;
      report.status = 'blocked';
      report.problems.push(...tools.problems);
      return report;
    }
    const { createSafeStaticServer } = await import(pathToFileURL(tools.safeServerPath).href);
    const server = createSafeStaticServer(demoDir);
    const base = await server.listen('127.0.0.1');
    report.qaUrl = `${base}/index.html?interaction=1`;
    writeFileSync(join(artifactsDir, 'stop1.json'), `${JSON.stringify(report, null, 2)}\n`);
    report._server = server;
  }
  return report;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const result = await runStop1();
  if (!result.ok) {
    console.error((result.problems || []).join('\n'));
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    status: result.status,
    fingerprint: result.fingerprint,
    qaUrl: result.qaUrl || null,
  }, null, 2)}\n`);
  if (result._server) {
    process.stdout.write(`QA ${result.qaUrl}\nawaiting-user-review；Ctrl+C 结束服务。\n`);
    await new Promise(() => {});
  }
}
