import { execFileSync, spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { suiteLimitMs } from './browser-test-budget.mjs';

const cwd = fileURLToPath(new URL('../',import.meta.url));
const lightFiles = new Set([
  'a-scope','b-delta','b-extract','b-handoff','b-supplement','b2-input-completion','c-assets','cmap',
  'data-round2','document-links','font-autoreuse','font-diagnosis','font-discovery','font-fixes',
  'font-round2','golden-round2','integration','motion-round2','translation-completeness',
].map((name) => name + '.test.mjs'));
const files = readdirSync(new URL('./',import.meta.url),{ withFileTypes:true })
  .filter((entry) => entry.name.endsWith('.test.mjs')).map((entry) => {
    if (!entry.isFile()) throw new Error('One Page: public test is not a regular file: ' + entry.name);
    return entry.name;
  }).sort();
if (!files.length) throw new Error('One Page: no public test files');
const started = performance.now();
const windows = process.platform === 'win32';
const cleanupGraceMs = 5_000;
let stopActive;
let interrupted;

function signalPid(pid,signal) {
  try { process.kill(pid,signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

function observeTree(child) {
  const owned = new Map();
  let groupOwned = false;
  if (!windows) child.once('spawn',() => { groupOwned = true; });
  return (timeout) => {
    const output = execFileSync('ps',['-ax','-o','pid=,ppid=,pgid=,stat=,lstart='],{ encoding:'utf8',timeout });
    const rows = output.trim().split(String.fromCharCode(10)).map((line) => {
      const [pid,parent,group,state,...start] = line.trim().split(/ +/);
      return { pid:Number(pid),parent:Number(parent),group:Number(group),state,start:start.join(' ') };
    });
    const live = new Set(rows.filter((row) => owned.get(row.pid) === row.start
      || (row.pid === child.pid && row.parent === process.pid)).map((row) => row.pid));
    const group = rows.filter((row) => row.group === child.pid);
    const leader = rows.find((row) => row.pid === child.pid);
    if (!group.length || (leader && (leader.group !== child.pid || !live.has(leader.pid)))) groupOwned = false;
    if (groupOwned) for (const row of group) live.add(row.pid);
    let count;
    do {
      count = live.size;
      for (const row of rows) if (live.has(row.parent)) live.add(row.pid);
    } while (count !== live.size);
    for (const row of rows) if (live.has(row.pid)) owned.set(row.pid,row.start);
    return rows.filter((row) => live.has(row.pid) && !row.state.startsWith('Z'));
  };
}

function run(label,names,concurrency) {
  if (!names.length || interrupted) return Promise.resolve(interrupted ? 1 : 0);
  const start = performance.now();
  const remaining = Math.floor(suiteLimitMs - (start - started));
  if (remaining <= 0) {
    console.error('[one-page test]',label,'suite budget exhausted before launch');
    return Promise.resolve(1);
  }
  return new Promise((resolve) => {
    console.error('[one-page test]',label,'start; files=' + names.length,'remainingMs=' + remaining);
    const child = spawn(process.execPath,['--test',...(concurrency ? ['--test-concurrency=' + concurrency] : []),...process.argv.slice(2),
      ...names.map((name) => 'test/' + name)],{ cwd,stdio:'inherit',detached:!windows });
    let expired = false;
    let cleanupError = false;
    let killTimer;
    const observe = observeTree(child);
    const owned = (periodic = false, timeout = 5_000) => {
      try { return observe(timeout); }
      catch (error) {
        if (periodic && error.code === 'ETIMEDOUT') {
          console.warn('[one-page test] periodic process scan timed out:',error.message);
        } else {
          cleanupError = true;
          console.error('[one-page test] process scan:',error.message);
        }
        return null;
      }
    };
    const scan = windows ? undefined : setInterval(() => owned(true),2_000);
    const signalTree = (signal,targets) => {
      if (!child.pid) return;
      if (!windows) {
        targets ??= owned() ?? [];
        for (const row of targets) if (row.group !== child.pid) signalPid(row.pid,signal);
        if (child.exitCode === null && child.signalCode === null) signalPid(-child.pid,signal);
        else for (const row of targets) if (row.group === child.pid) signalPid(row.pid,signal);
      } else if (child.exitCode === null && child.signalCode === null) {
        try { execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{ timeout:2_000,stdio:'ignore' }); }
        catch (error) { cleanupError = true; child.kill(signal); console.error('[one-page test] taskkill:',error.message); }
      }
    };
    stopActive = (signal) => {
      console.error('[one-page test]',label,'cancelling with',signal);
      signalTree(signal);
      killTimer ??= setTimeout(() => signalTree('SIGKILL'),cleanupGraceMs);
    };
    const deadline = setTimeout(() => {
      expired = true;
      console.error('[one-page test]',label,'suite budget exhausted; terminating test worker');
      stopActive('SIGTERM');
    },remaining);
    child.on('error',(error) => console.error('[one-page test]',label,'spawn:',error.message));
    child.once('close',async (code,signal) => {
      clearTimeout(deadline);
      clearTimeout(killTimer);
      clearInterval(scan);
      stopActive = undefined;
      let targets = windows ? null : owned();
      if (targets?.length) {
        if (!expired && !interrupted && code === 0) cleanupError = true;
        const cleanupDeadline = performance.now() + cleanupGraceMs;
        do {
          signalTree('SIGKILL',targets);
          await delay(50);
          targets = owned(false,Math.max(1,Math.ceil(cleanupDeadline - performance.now())));
        } while (targets?.length && performance.now() < cleanupDeadline);
        if (targets?.length) {
          cleanupError = true;
          console.error('[one-page test]',label,'owned processes still alive after cleanup');
        }
      }
      console.error('[one-page test]',label,JSON.stringify({ elapsedMs:Math.round(performance.now() - start),code,signal,expired,
        interrupted:interrupted ?? null,cleanupError }));
      resolve(!expired && !interrupted && !cleanupError && code === 0 ? 0 : 1);
    });
  });
}

const handlers = ['SIGINT','SIGTERM'].map((signal) => [signal,() => {
  interrupted ??= signal;
  stopActive?.(signal);
}]);
for (const [signal,handler] of handlers) process.on(signal,handler);
const light = await run('light',files.filter((name) => lightFiles.has(name)));
const browserFiles = files.filter((name) => !lightFiles.has(name));
const browser = light || await run('browser',browserFiles,Math.min(2,browserFiles.length));
for (const [signal,handler] of handlers) process.off(signal,handler);
process.exitCode = light || browser;
if (interrupted) process.kill(process.pid,interrupted);
