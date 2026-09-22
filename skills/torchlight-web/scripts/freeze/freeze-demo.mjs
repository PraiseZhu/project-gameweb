#!/usr/bin/env node
/**
 * Freeze the live renderer demo into static DOM pages.
 * Direct CLI is locked; only torchlightweb may spawn this with a one-shot ticket.
 *
 *   node scripts/freeze/freeze-demo.mjs --demo <dir> [--interaction] [--skip-check]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { requireOrchestratorTicket } from '../lib/orchestrator-ticket.mjs';
import { checkStaticHtml } from './check-static-html.mjs';
import { writeOpsShell, writeReplaceableIndex } from './freeze-ops.mjs';
import { LOCALE_PAGES, SHARED_ASSETS_DIR } from './static-locale.mjs';
import { assertNotProductSource, withinProject } from './capture-static-html.mjs';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CAPTURE = join(SKILL_ROOT, 'scripts/freeze/capture-static-html.mjs');
const RUNTIME = 'scripts/freeze/static-runtime.js';

function parseArgs(argv) {
  const opts = { demo: '', skipCheck: false, interaction: false, chrome: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--skip-check') {
      opts.skipCheck = true;
      continue;
    }
    if (flag === '--interaction') {
      opts.interaction = true;
      continue;
    }
    const value = argv[i + 1];
    if (!value) throw new Error('MISSING_ARGUMENT:' + flag);
    if (flag === '--demo') opts.demo = value;
    else if (flag === '--chrome') opts.chrome = value;
    else throw new Error('UNKNOWN_ARGUMENT:' + flag);
    i += 1;
  }
  return opts;
}

function runNode(script, args) {
  return new Promise((resolveRun, reject) => {
    const chunks = [];
    const child = spawn(process.execPath, [script, ...args], {
      cwd: SKILL_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (buf) => chunks.push(buf));
    child.stderr.on('data', (buf) => chunks.push(buf));
    child.on('exit', (code) => {
      const output = Buffer.concat(chunks).toString('utf8');
      if (code === 0) resolveRun(output);
      else reject(new Error('COMMAND_FAILED:' + pathBase(script) + ':' + code + ':' + output.slice(-800)));
    });
  });
}

function pathBase(file) {
  return String(file).split(/[\\/]/).pop();
}

function captureQuery(page, { interaction = false } = {}) {
  const params = new URLSearchParams({
    product: '1',
    'qa-assets': 'full',
    lang: page.lang,
    region: page.region,
  });
  if (interaction) params.set('interaction', '1');
  return params.toString();
}

export async function freezeDemo({
  demoDir,
  interaction = false,
  skipCheck = false,
  chrome = '',
} = {}) {
  const root = resolve(demoDir);
  const indexPath = join(root, 'index.html');
  if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
    return { ok: false, error: 'missing-demo-index' };
  }
  const frozenDir = withinProject(root, 'frozen', 'frozen');
  mkdirSync(frozenDir, { recursive: true });
  const assetsAbs = withinProject(frozenDir, SHARED_ASSETS_DIR, 'assets');
  const server = createSafeStaticServer(root);
  const origin = await server.listen();
  const frozen = [];
  try {
    for (const page of LOCALE_PAGES) {
      const outAbs = withinProject(frozenDir, page.out, 'out');
      assertNotProductSource(outAbs, indexPath);
      const url = `${origin}/index.html?${captureQuery(page, { interaction })}`;
      const captureArgs = [
        '--url', url,
        '--out', outAbs,
        '--root', frozenDir,
        '--runtime', RUNTIME,
        '--title', page.title,
        '--assets', assetsAbs,
        '--source-dir', root,
        '--locale', page.locale,
        '--merge-assets',
      ];
      if (chrome) captureArgs.push('--chrome', chrome);
      await runNode(CAPTURE, captureArgs);
      let check = null;
      if (!skipCheck) {
        check = checkStaticHtml(SKILL_ROOT, {
          staticRel: outAbs,
          origRel: indexPath,
          runtimeRel: join(SKILL_ROOT, RUNTIME),
          captureRel: CAPTURE,
          compareRel: join(SKILL_ROOT, 'scripts/freeze/compare-static-vs-orig.mjs'),
          locale: page.locale,
        });
      }
      frozen.push({
        locale: page.locale,
        lang: page.lang,
        region: page.region,
        out: page.out,
        check: check ? check.status : 'skipped',
        bytes: existsSync(outAbs) ? statSync(outAbs).size : 0,
      });
    }
  } finally {
    await server.close();
  }
  const opsIndex = writeOpsShell(frozenDir, { interaction });
  const replaceable = writeReplaceableIndex(frozenDir);
  const manifest = {
    schema: 'torchlight-freeze/v1',
    demoDir: root,
    frozenDir,
    interaction,
    assets: SHARED_ASSETS_DIR,
    frozen,
    replaceableCount: replaceable.count,
    opsIndex,
  };
  writeFileSync(join(frozenDir, 'freeze-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { ok: true, ...manifest };
}

async function main(argv = process.argv.slice(2)) {
  const ticket = requireOrchestratorTicket('scripts/freeze/freeze-demo.mjs', { argv: process.argv, env: process.env });
  if (ticket.ok !== true) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      error: `freeze-demo CLI is locked; ${ticket.hint || 'run npm run torchlightweb'} (${ticket.error})`,
    }, null, 2)}\n`);
    process.exit(2);
  }
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error.message }, null, 2)}\n`);
    process.exit(2);
  }
  if (!opts.demo) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: 'usage: node scripts/freeze/freeze-demo.mjs --demo <dir>' }, null, 2)}\n`);
    process.exit(2);
  }
  try {
    const result = await freezeDemo({
      demoDir: resolve(opts.demo),
      interaction: opts.interaction,
      skipCheck: opts.skipCheck,
      chrome: opts.chrome,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.ok ? 0 : 2);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error.message }, null, 2)}\n`);
    process.exit(2);
  }
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isCli) main();
