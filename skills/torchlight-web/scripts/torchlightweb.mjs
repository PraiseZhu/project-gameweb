#!/usr/bin/env node
/**
 * torchlightweb 总编排命令。固定状态机，禁止 showcase / 跳过人核 / 加减步骤。
 *
 *   npm run torchlightweb -- --handoff <dir> --demo <dir>
 *   npm run torchlightweb -- accept --demo <dir>
 *   npm run torchlightweb -- continue --demo <dir>
 *   npm run torchlightweb -- status --demo <dir>
 */
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTorchlightwebArgs, runTorchlightweb } from './lib/torchlightweb-machine.mjs';
import { mintOrchestratorTicket } from './lib/orchestrator-ticket.mjs';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHILD_DIR = join(resolve(SKILL_ROOT, '../..'), '_tmp', 'torchlightweb-child');

function writeAndExit(result, code) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(code);
}

export function parseChildJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < raw.length; i += 1) {
      const ch = raw[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(raw.slice(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
}

function runChild(scriptRel, args, extra = {}) {
  const ticket = mintOrchestratorTicket({ script: scriptRel, parentPid: process.pid });
  mkdirSync(CHILD_DIR, { recursive: true });
  const work = mkdtempSync(join(CHILD_DIR, 'run-'));
  const stdoutPath = join(work, 'stdout.json');
  const stderrPath = join(work, 'stderr.txt');
  const outFd = openSync(stdoutPath, 'w');
  const errFd = openSync(stderrPath, 'w');
  let res;
  try {
    res = spawnSync(process.execPath, [join(SKILL_ROOT, scriptRel), ...args], {
      cwd: SKILL_ROOT,
      env: { ...process.env, ...ticket.env },
      timeout: extra.timeout ?? 180000,
      stdio: ['ignore', outFd, errFd],
    });
  } finally {
    closeSync(outFd);
    closeSync(errFd);
  }
  const stdout = readFileSync(stdoutPath, 'utf8');
  const stderr = readFileSync(stderrPath, 'utf8');
  rmSync(work, { recursive: true, force: true });
  const parsed = parseChildJson(stdout);
  if (parsed && typeof parsed === 'object') {
    return { ...parsed, ok: parsed.ok === true && res.status === 0, status: res.status, stderr };
  }
  return {
    ok: false,
    status: res.status,
    error: `${scriptRel} failed (${res.status}): ${(stdout || stderr || res.error?.message || 'no output').trim()}`,
    stderr,
  };
}

function buildMain({ handoffDir, demoDir }) {
  return runChild('scripts/figma-html-from-handoff.mjs', ['--handoff', handoffDir, '--demo', demoDir], { timeout: 3600000 });
}

function packDemo({ demoDir }) {
  return runChild('scripts/pack-demo.mjs', ['--demo', demoDir], { timeout: 900000 });
}

function probeLaterAxes({ demoDir }) {
  return runChild('scripts/lib/later-axes-probe.mjs', ['--demo', demoDir], { timeout: 900000 });
}

async function main(argv = process.argv.slice(2)) {
  const parsed = parseTorchlightwebArgs(argv);
  if (parsed.ok !== true) {
    writeAndExit({
      ok: false,
      error: parsed.error,
      nextHumanStep: parsed.nextHumanStep || 'torchlightweb 只接受 start|continue|accept|status 与 --handoff / --demo。禁止 showcase。',
    }, 2);
  }
  const result = await Promise.resolve(runTorchlightweb({
    command: parsed.command,
    demoDir: parsed.demoDir,
    handoffDir: parsed.handoffDir,
    buildMain,
    packDemo,
    probeLaterAxes,
  }));
  writeAndExit(result, result.ok ? 0 : 2);
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isCli) main();
