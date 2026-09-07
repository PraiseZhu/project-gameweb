#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'gameweb-skill-shared/v1';
export const DEFAULT_MANIFEST_NAME = 'shared-files.json';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = resolve(HERE, '..');
const DEFAULT_REPO_ROOT = resolve(TOOL_ROOT, '../../..');
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.cache', 'demos', 'artifacts', 'fonts', 'evolution']);

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function normalizeRel(rel) {
  const path = String(rel || '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (!path) throw new Error('清单路径不能为空');
  if (path.startsWith('/') || path.includes('..') || path.includes('\0')) {
    throw new Error(`清单路径不合法: ${rel}`);
  }
  return path;
}

export function loadManifest(abs) {
  if (!existsSync(abs)) throw new Error(`缺少公共文件清单: ${abs}`);
  let doc;
  try {
    doc = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (err) {
    throw new Error(`公共文件清单不是有效 JSON: ${abs}（${err.message}）`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error(`公共文件清单顶层必须是对象: ${abs}`);
  }
  if (doc.schema !== SCHEMA) throw new Error(`公共文件清单 schema 必须是 ${SCHEMA}`);
  if (!Array.isArray(doc.skills) || doc.skills.length < 2) {
    throw new Error('公共文件清单 skills 至少两个包名');
  }
  if (!Array.isArray(doc.files)) throw new Error('公共文件清单 files 必须是数组');
  const skills = doc.skills.map((name) => {
    if (typeof name !== 'string' || !name.trim() || name.includes('/') || name.includes('\\')) {
      throw new Error(`skill 名不合法: ${name}`);
    }
    return name.trim();
  });
  const seen = new Set();
  const files = [];
  for (const item of doc.files) {
    const path = normalizeRel(item);
    if (seen.has(path)) throw new Error(`清单重复: ${path}`);
    seen.add(path);
    files.push(path);
  }
  return { schema: SCHEMA, skills, files };
}

export function skillDir(repoRoot, name) {
  return join(repoRoot, 'skills', name);
}

function collectSkillFiles(abs, acc = [], prefix = '') {
  if (!existsSync(abs)) return acc;
  let entries = [];
  try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return acc; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const child = join(abs, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (rel === 'docs') continue;
      collectSkillFiles(child, acc, rel);
      continue;
    }
    if (entry.isFile()) acc.push(rel.replaceAll('\\', '/'));
  }
  return acc;
}

export function fileStatus(repoRoot, skills, rel) {
  const copies = skills.map((name) => {
    const abs = join(skillDir(repoRoot, name), rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      return { skill: name, present: false, sha256: null };
    }
    return { skill: name, present: true, sha256: sha256(readFileSync(abs)) };
  });
  const present = copies.filter((item) => item.present);
  if (present.length !== copies.length) return { rel, kind: 'missing', copies };
  const hashes = new Set(present.map((item) => item.sha256));
  return { rel, kind: hashes.size === 1 ? 'identical' : 'drift', copies };
}

export function classifySharedFiles({ repoRoot, skills, listed }) {
  const listedSet = new Set(listed);
  const listedStatuses = listed.map((rel) => fileStatus(repoRoot, skills, rel));
  const extra = [];
  const [first, ...rest] = skills;
  const firstFiles = new Set(collectSkillFiles(skillDir(repoRoot, first)));
  for (const name of rest) {
    for (const rel of collectSkillFiles(skillDir(repoRoot, name))) {
      if (listedSet.has(rel)) continue;
      if (!firstFiles.has(rel)) continue;
      extra.push(fileStatus(repoRoot, skills, rel));
    }
  }
  extra.sort((a, b) => a.rel.localeCompare(b.rel));
  return {
    identical: listedStatuses.filter((item) => item.kind === 'identical'),
    drift: listedStatuses.filter((item) => item.kind === 'drift'),
    missing: listedStatuses.filter((item) => item.kind === 'missing'),
    unlistedIdentical: extra.filter((item) => item.kind === 'identical'),
    unlistedDrift: extra.filter((item) => item.kind === 'drift'),
  };
}

export function parseSyncArgs(argv) {
  const args = { command: '', from: '', to: '', copyDrift: false, manifest: '', repoRoot: '' };
  const rest = [...argv];
  if (!rest.length) throw new Error('必须给 preview / check / apply');
  args.command = rest.shift();
  if (!['preview', 'check', 'apply'].includes(args.command)) {
    throw new Error(`未知命令: ${args.command}`);
  }
  while (rest.length) {
    const token = rest.shift();
    if (token === '--from') args.from = rest.shift() || '';
    else if (token === '--to') args.to = rest.shift() || '';
    else if (token === '--copy-drift') args.copyDrift = true;
    else if (token === '--manifest') args.manifest = rest.shift() || '';
    else if (token === '--repo') args.repoRoot = rest.shift() || '';
    else throw new Error(`未知参数: ${token}`);
  }
  if (args.command !== 'apply' && (args.from || args.to || args.copyDrift)) {
    throw new Error('preview / check 不接受 --from / --to / --copy-drift');
  }
  if (args.command === 'apply') {
    if (!args.from || !args.to) throw new Error('apply 必须给 --from <skill> --to <skill>');
    if (args.from === args.to) throw new Error('--from 和 --to 不能相同');
  }
  return args;
}

function copyOf(item, skill) {
  return item.copies.find((copy) => copy.skill === skill);
}

export function planApply({ report, from, to, copyDrift }) {
  const actions = [];
  for (const item of report.missing) {
    if (!copyOf(item, from)?.present) actions.push({ rel: item.rel, kind: 'skip-missing-source' });
    else if (copyOf(item, to)?.present) actions.push({ rel: item.rel, kind: 'skip-partial' });
    else actions.push({ rel: item.rel, kind: 'copy-missing' });
  }
  for (const item of report.drift) {
    if (!copyDrift) actions.push({ rel: item.rel, kind: 'skip-drift' });
    else if (!copyOf(item, from)?.present) actions.push({ rel: item.rel, kind: 'skip-missing-source' });
    else actions.push({ rel: item.rel, kind: 'copy-drift' });
  }
  return actions;
}

export function applyActions({ repoRoot, from, to, actions, writeFile = copyFileSync, mkdir = mkdirSync }) {
  const copied = [];
  const skipped = [];
  for (const action of actions) {
    if (action.kind.startsWith('skip-')) {
      skipped.push(action);
      continue;
    }
    const src = join(skillDir(repoRoot, from), action.rel);
    const dest = join(skillDir(repoRoot, to), action.rel);
    mkdir(dirname(dest), { recursive: true });
    writeFile(src, dest);
    copied.push(action);
  }
  return { copied, skipped };
}

function printPreview(report) {
  const lines = [
    `一致 ${report.identical.length}`,
    `清单内漂移 ${report.drift.length}`,
    `清单内缺失 ${report.missing.length}`,
    `未进清单但一致 ${report.unlistedIdentical.length}`,
    `未进清单且已分化 ${report.unlistedDrift.length}`,
    '',
  ];
  const sections = [
    ['清单内漂移', report.drift],
    ['清单内缺失', report.missing],
    ['未进清单但一致', report.unlistedIdentical],
    ['未进清单且已分化', report.unlistedDrift],
  ];
  for (const [title, list] of sections) {
    lines.push(`## ${title}`);
    if (!list.length) lines.push('- （无）');
    else for (const item of list) lines.push(`- ${item.rel}`);
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

function main(argv = process.argv.slice(2), io = {}) {
  const args = parseSyncArgs(argv);
  const repoRoot = resolve(args.repoRoot || io.repoRoot || DEFAULT_REPO_ROOT);
  const manifestPath = resolve(args.manifest || io.manifest || join(TOOL_ROOT, DEFAULT_MANIFEST_NAME));
  const manifest = loadManifest(manifestPath);
  for (const name of manifest.skills) {
    const abs = skillDir(repoRoot, name);
    if (!existsSync(abs)) throw new Error(`找不到 skill: ${name}（${relative(repoRoot, abs) || abs}）`);
  }
  const report = classifySharedFiles({
    repoRoot,
    skills: manifest.skills,
    listed: manifest.files,
  });
  if (args.command === 'preview' || args.command === 'check') {
    const text = printPreview(report);
    (io.log || console.log)(text);
    if (args.command === 'check' && (report.drift.length || report.missing.length)) {
      const err = new Error(`公共文件清单漂移 ${report.drift.length}、缺失 ${report.missing.length}`);
      err.exitCode = 1;
      throw err;
    }
    return { report };
  }
  if (!manifest.skills.includes(args.from) || !manifest.skills.includes(args.to)) {
    throw new Error('--from / --to 必须是清单里的 skill');
  }
  const actions = planApply({ report, from: args.from, to: args.to, copyDrift: args.copyDrift });
  const result = applyActions({
    repoRoot,
    from: args.from,
    to: args.to,
    actions,
    writeFile: io.writeFile,
    mkdir: io.mkdir,
  });
  const skippedDrift = result.skipped.filter((item) => item.kind === 'skip-drift');
  (io.log || console.log)([
    `从 ${args.from} 拷到 ${args.to}`,
    `拷贝 ${result.copied.length}`,
    `跳过漂移 ${skippedDrift.length}`,
    `其它跳过 ${result.skipped.length - skippedDrift.length}`,
    ...result.copied.map((item) => `copy ${item.rel}`),
    ...skippedDrift.map((item) => `skip-drift ${item.rel}`),
  ].join('\n'));
  return { report, actions, result };
}

export { main, printPreview, TOOL_ROOT, DEFAULT_REPO_ROOT };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(err.exitCode ?? 2);
  }
}
