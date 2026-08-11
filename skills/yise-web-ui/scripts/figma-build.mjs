#!/usr/bin/env node
/**
 * figma-build.mjs — 把「稿 → demo」的固定步序固化成一条命令。【本 Skill 新增】
 *
 * ═══ 为什么要这个脚本（2026-08-04 实测被咬）═══
 *
 * 步序里有一步极易漏：`truth.mjs --embed`。
 * 漏掉它的表现是 **门 A 报「内嵌真值与 truth.json 不一致(规范化比对失败)」** ——
 * 这句话看着像"提取器输出变了"，实际只是 index.html 里的内嵌块还是上一版。
 * 我本人在接通多分区时就这么栽了一次：改完提取器跑了 truth.mjs（没加 --embed），
 * 门 A 由绿变红，第一反应是去查多分区改动，白查一轮。
 *
 * 步序还有别的隐含依赖，都不是"想得到"而是"踩到过"：
 *   - figma-lib-sync 必须在 extract 之前：extract 引的是 demo 内的机械副本，
 *     改了 scripts/lib/ 不同步，跑的还是旧逻辑（且门 A 会因副本漂移报红）。
 *   - figma-assets 必须在 extract 之后：切图清单按 truth 里的节点决定切谁。
 *   - figma-inline 必须在最后：它把 templates/ 的渲染器与壳写进产物；
 *     truth.mjs --embed 也改 index.html，两者顺序反了不会出错但会多一次改写。
 *
 * 一条命令 = 一份唯一的步序真源。以后谁都不用记，也不会记错。
 *
 * ⚠️ 本脚本**不做验收**，只负责"把产物造成一致状态"。
 *    验收一律由各门自己跑（verify.mjs / render-coverage / extract-coverage /
 *    冒烟 / device-presets-check / live-diff）。造物与验收混在一个命令里，
 *    就等于让被审方自己宣布通过 —— 那正是这套 Skill 从头到尾在防的事。
 *
 * ═══ 用法 ═══
 *   node scripts/figma-build.mjs --demo <dir>              # 不联网，从现有快照重造
 *   node scripts/figma-build.mjs --demo <dir> --fetch      # 先重拉 Figma 快照
 *   node scripts/figma-build.mjs --demo <dir> --assets     # 顺带重导切图（联网、慢）
 *   node scripts/figma-build.mjs --demo <dir> --dry-run    # 只打印步序，不执行
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const here = import.meta.dirname;
const repoRoot = dirname(here);

function fail(msg, code = 1) {
  console.error(`❌ ${msg}`);
  process.exit(code);
}

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k === '--demo') args.demo = process.argv[++i];
  else if (k === '--fetch') args.fetch = true;
  else if (k === '--assets') args.assets = true;
  else if (k === '--dry-run') args.dryRun = true;
  else fail(`未知参数：${k}`);
}
if (!args.demo) fail('必须给 --demo <dir>');
const demoDir = resolve(args.demo);
if (!existsSync(join(demoDir, 'spec.json'))) fail(`${demoDir} 下没有 spec.json`);

/* 步序。每步写清"为什么在这个位置"——注释是给下一个人看的，不是给我自己看的。 */
const steps = [
  args.fetch && {
    name: '重拉 Figma 快照',
    script: 'figma-fetch.mjs',
    why: '联网只在这一步发生。extract.mjs 一律只读本地 fixture，门 A 才有意义（纯函数才能重跑比对）。',
  },
  {
    name: '同步通用库副本',
    script: 'figma-lib-sync.mjs',
    why: '必须在 extract 之前：extract 引的是 demo 内 lib/ 的机械副本，不同步就跑旧逻辑，且门 A 会因副本漂移报红。',
  },
  {
    name: '提取真值',
    script: null,
    cmd: [join(demoDir, 'extract.mjs')],
    stdoutTo: null,
    why: '真值提取器（老师 P1 的插口）。stdout 是 truth JSON，但落盘由 truth.mjs 负责，这里只求它能跑通。',
  },
  {
    name: '写 truth.json 并内嵌进产物',
    script: 'truth.mjs',
    extra: ['--embed'],
    why: '⚠️ --embed 是最容易漏的一步。漏了门 A 会报「内嵌真值与 truth.json 不一致」，' +
         '看着像提取器变了，实际只是产物里的内嵌块还是上一版。',
  },
  args.assets && {
    name: '重导切图',
    script: 'figma-assets.mjs',
    why: '必须在 extract 之后：切谁由 truth 里的节点决定。联网且慢，所以默认不跑。',
  },
  {
    name: '内联渲染器与验收壳',
    script: 'figma-inline.mjs',
    why: '放最后：把 templates/ 的通用渲染器与壳机械写进产物。放在 --embed 之前不会错，只是会多改一次 index.html。',
  },
].filter(Boolean);

console.log(`造物流水线：${demoDir}`);
console.log(`步骤 ${steps.length} 步${args.dryRun ? '（--dry-run，只打印）' : ''}`);
console.log('');

let i = 0;
for (const s of steps) {
  i++;
  const cmd = s.cmd || [join(here, s.script), '--demo', demoDir, ...(s.extra || [])];
  console.log(`[${i}/${steps.length}] ${s.name}`);
  console.log(`        ${s.why}`);
  console.log(`        node ${cmd.map((c) => (c.includes(' ') ? `"${c}"` : c)).join(' ')}`);
  if (args.dryRun) { console.log(''); continue; }
  /* stdout 一律丢弃，不接管道。
   * 踩过：接 'pipe' 时 extract.mjs 往 stdout 输出 2.5MB 的 truth JSON，
   * 撞上 spawnSync 默认 maxBuffer(1MB) → 子进程被杀，status 是 null，
   * 报出来是"退出码 null"，看不出真因。产物落盘不靠 stdout（truth.mjs 负责写），
   * 所以这里根本不需要它的输出。stderr 直通，报错照样看得见。 */
  const r = spawnSync(process.execPath, cmd, { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.error) {
    console.error('');
    fail(`第 ${i} 步「${s.name}」起不来：${r.error.message}`);
  }
  if (r.status !== 0) {
    console.error('');
    const why = r.signal ? `被信号 ${r.signal} 杀掉` : `退出码 ${r.status}`;
    fail(`第 ${i} 步「${s.name}」失败，${why}。流水线中止 —— 后续步骤会基于半成品产物，不许继续。`, r.status || 1);
  }
  console.log('        ✅');
  console.log('');
}

if (!args.dryRun) {
  console.log('✅ 产物已造成一致状态。');
  console.log('');
  console.log('⚠️ 本脚本不做验收。接下来自己跑门（造物与验收必须分开，否则就是被审方自己宣布通过）：');
  console.log(`   node scripts/verify.mjs             --demo ${args.demo}`);
  console.log(`   node scripts/render-coverage.mjs    --demo ${args.demo}`);
  console.log(`   node scripts/extract-coverage.mjs   --demo ${args.demo}`);
  console.log(`   node scripts/device-presets-check.mjs --demo ${args.demo}`);
  console.log(`   node ${args.demo}/_render-smoke.mjs`);
  console.log(`   node ${args.demo}/_chrome-smoke.mjs`);
}
