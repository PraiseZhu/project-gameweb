#!/usr/bin/env node
// 夜间仓内健康检查：扫 skills/* 与 standards/*。
// 每个进仓目录必须能跑 npm test；有 release:audit / fonts:check 就一并跑。
// 没有 package.json、没有可核验的 test、放错位置 → 失败，不静默跳过。
// 完整夜间另出分级报告：今晚红 / 已知债 / 缺口；红灯只跟今晚红。
//
//   node .github/scripts/nightly-health.mjs           # 安装并跑完全部
//   node .github/scripts/nightly-health.mjs --list    # 只打印将检查的包

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(import.meta.url);
const ROOT = resolve(process.env.NIGHTLY_HEALTH_ROOT || fileURLToPath(new URL('../..', import.meta.url)));
const LIST_ONLY = process.argv.includes('--list');
const KNOWN_TOP = new Set(['skills', 'standards']);
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.cache']);
const GAP_BROKEN = new Set([
  'scripts/__tests__/figma-from-handoff.test.mjs',
  'scripts/__tests__/figma-inventory-check.test.mjs',
]);
const GRADE_TONIGHT = 'tonight';
const GRADE_DEBT = 'debt';
const GRADE_GAP = 'gap';
const GRADE_GONE = 'gone';

function die(message) {
  console.error(message);
  process.exit(2);
}

function listImmediateDirs(abs) {
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => join(abs, entry.name))
    .sort();
}

function listImmediateEntries(abs) {
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true });
}

function readPackage(packageDir) {
  return JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
}

function findNestedPackages(abs, acc = []) {
  if (!existsSync(abs)) return acc;
  let entries = [];
  try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return acc; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIR_NAMES.has(entry.name) || entry.name === '.git') continue;
    const child = join(abs, entry.name);
    if (existsSync(join(child, 'package.json'))) acc.push(child);
    findNestedPackages(child, acc);
  }
  return acc;
}

function findNestedSkillFiles(abs, acc = []) {
  if (!existsSync(abs)) return acc;
  let entries = [];
  try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return acc; }
  for (const entry of entries) {
    const child = join(abs, entry.name);
    if (entry.isFile() && entry.name === 'SKILL.md') acc.push(child);
    if (!entry.isDirectory()) continue;
    if (SKIP_DIR_NAMES.has(entry.name) || entry.name === '.git') continue;
    findNestedSkillFiles(child, acc);
  }
  return acc;
}

function testLooksRunnable(script) {
  const text = String(script ?? '').trim();
  if (!text) return false;
  if (text === ':' || text === 'true') return false;
  if (/^(echo|true)\b/i.test(text) && !/\|/.test(text)) return false;
  if (/\bexit\s+0\b/i.test(text)) return false;
  if (/\|\|\s*(true|echo\b|exit\s+0)/i.test(text)) return false;
  if (/;\s*(true|echo\b|exit\s+0)/i.test(text)) return false;
  return true;
}

function lastCount(output, label) {
  const matches = [...String(output).matchAll(new RegExp(`^# ${label} (\\d+)\\s*$`, 'gm'))];
  return matches.length ? Number(matches[matches.length - 1][1]) : null;
}

function looksLikeFakeSummary(script) {
  const text = String(script ?? '');
  return /ℹ\s+(tests|pass|fail|skipped)|#\s+(tests|pass|fail|skipped)/i.test(text);
}

function collectTestFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIR_NAMES.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTestFiles(abs, acc);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.test.mjs')) acc.push(abs);
  }
  return acc;
}

function stripLineNoise(line) {
  let out = '';
  let i = 0;
  let mode = 'code';
  while (i < line.length) {
    const c = line[i];
    const n = line[i + 1];
    if (mode === 's' || mode === 'd' || mode === 't') {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if ((mode === 's' && c === "'") || (mode === 'd' && c === '"') || (mode === 't' && c === '`')) mode = 'code';
      i += 1;
      continue;
    }
    if (c === '/' && n === '/') break;
    if (c === '/' && n === '*') {
      const end = line.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 2;
      continue;
    }
    if (c === "'") {
      mode = 's';
      i += 1;
      continue;
    }
    if (c === '"') {
      mode = 'd';
      i += 1;
      continue;
    }
    if (c === '`') {
      mode = 't';
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function hasDeclaredTest(abs) {
  try {
    const text = readFileSync(abs, 'utf8');
    if (!text.trim()) return false;
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/.*$/gm, ' ')
      .trim();
    if (!code) return false;
    if (/^process\.exit\(\s*0\s*\)\s*;?$/.test(code)) return false;
    return true;
  } catch {
    return false;
  }
}

function parseTap(output) {
  return {
    tests: lastCount(output, 'tests'),
    pass: lastCount(output, 'pass') ?? 0,
    fail: lastCount(output, 'fail') ?? 0,
    skipped: lastCount(output, 'skipped') ?? 0,
    todo: lastCount(output, 'todo') ?? 0,
  };
}

function countRealTapCases(output, files = []) {
  const wrappers = new Set();
  for (const abs of files) {
    wrappers.add(abs);
    wrappers.add(relative(process.cwd(), abs));
  }
  return [...String(output).matchAll(/^# Subtest: (.+)$/gm)]
    .map((match) => match[1].trim())
    .filter((name) => !wrappers.has(name))
    .length;
}

function realInside(root, abs) {
  try {
    const base = realpathSync(root);
    const target = realpathSync(abs);
    return target === base || target.startsWith(base + '/');
  } catch {
    return false;
  }
}

function argValue(name) {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return '';
}

function loadOwnedExclusions(packageDir) {
  const file = join(packageDir, 'scripts', 'nightly-exclusions.json');
  if (!existsSync(file)) return { demo: new Set(), broken: new Map() };
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { error: `${relative(ROOT, file)} 不是对象` };
    }
    if (data.demo !== undefined && !Array.isArray(data.demo)) {
      return { error: `${relative(ROOT, file)} demo 不是数组` };
    }
    if (data.broken !== undefined && (!data.broken || typeof data.broken !== 'object' || Array.isArray(data.broken))) {
      return { error: `${relative(ROOT, file)} broken 不是对象` };
    }
    return {
      demo: new Set(data.demo ?? []),
      broken: new Map(Object.entries(data.broken ?? {})),
    };
  } catch {
    return { error: `${relative(ROOT, file)} 无法解析` };
  }
}

function stripRunnerNoise(text) {
  return String(text)
    .replace(/\/(?:private\/)?(?:var\/folders\/[^\s]+|tmp\/[^\s]+|Users\/[^\s]+)/g, '<path>')
    .replace(/[A-Za-z]:\\[^\s]+/g, '<path>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<time>')
    .replace(/\s+/g, ' ')
    .trim();
}

function fingerprintOf(item) {
  return `${item.package}|${item.check}|${stripRunnerNoise(item.summary)}`;
}

function beijingDate(now = process.env.NIGHTLY_HEALTH_NOW || Date.now()) {
  const value = typeof now === 'number' || /^\d+$/.test(String(now)) ? Number(now) : Date.parse(now);
  const date = new Date(Number.isFinite(value) ? value : Date.now());
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addBeijingDays(yyyyMmDd, days) {
  const [year, month, day] = String(yyyyMmDd).split('-').map(Number);
  const utc = Date.UTC(year, month - 1, day + days);
  const date = new Date(utc);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function defaultNightlyBranch(ref) {
  const value = String(ref || '').replace(/^refs\/heads\//, '');
  return value || 'main';
}

function pickYesterdayNightlyRun(runs, { currentRunId, now, defaultBranch = 'main' } = {}) {
  const today = beijingDate(now);
  const yesterday = addBeijingDays(today, -1);
  const branch = defaultNightlyBranch(defaultBranch);
  const matches = (Array.isArray(runs) ? runs : [])
    .filter((run) => {
      if (!run || run.id === currentRunId) return false;
      if (run.status !== 'completed') return false;
      if (run.head_branch !== branch) return false;
      return beijingDate(run.created_at) === yesterday;
    })
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return matches[0] || null;
}

function inferCheck(text) {
  if (/排除项|exclusions|无法解析|不是数组|不是对象/.test(text)) return 'exclusions';
  if (/npm test/.test(text)) return 'npm test';
  if (/TAP|真实用例|没有实际通过/.test(text)) return 'TAP';
  if (/release:audit/.test(text)) return 'release:audit';
  if (/fonts:check/.test(text)) return 'fonts:check';
  if (/npm ci|npm install/.test(text)) return 'install';
  if (/放错|package\.json|SKILL\.md|嵌套/.test(text)) return 'placement';
  if (/可核验的 npm test|公开 \*\.test\.mjs|没有声明/.test(text)) return 'file-proof';
  return 'health';
}

function gradedItem({ grade, package: pkg, check, path, summary }) {
  const item = { grade, package: pkg, check, path, summary };
  item.fingerprint = fingerprintOf(item);
  return item;
}

function failureItem(message) {
  const text = String(message);
  const colon = text.indexOf(': ');
  const pkg = colon === -1 ? 'repo' : text.slice(0, colon);
  return gradedItem({
    grade: GRADE_TONIGHT,
    package: pkg,
    check: inferCheck(text),
    path: pkg,
    summary: text,
  });
}

function isHandoffGap(rel) {
  return GAP_BROKEN.has(rel) || /figma-from-handoff|figma-inventory-check/.test(rel);
}

function exclusionItems(target) {
  const owned = loadOwnedExclusions(target.packageDir);
  if (owned.error) return { error: `${target.name}: ${owned.error}` };
  const items = [...owned.demo].sort().map((rel) => gradedItem({
    grade: GRADE_GAP,
    package: target.name,
    check: 'demo',
    path: rel,
    summary: 'demo: current page',
  }));
  for (const rel of [...owned.broken.keys()].sort()) {
    const gap = isHandoffGap(rel);
    items.push(gradedItem({
      grade: gap ? GRADE_GAP : GRADE_DEBT,
      package: target.name,
      check: gap ? 'handoff-gap' : 'broken',
      path: rel,
      summary: String(owned.broken.get(rel)),
    }));
  }
  return { items };
}

function fingerprintList(data) {
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.fingerprints)) {
    return data.fingerprints.map((fingerprint) => ({ fingerprint }));
  }
  return null;
}

function loadBaseline(path) {
  if (!path || !existsSync(path)) return { present: false, fingerprints: new Set() };
  try {
    const list = fingerprintList(JSON.parse(readFileSync(path, 'utf8')));
    if (!list) return { present: false, corrupt: true, fingerprints: new Set() };
    const fingerprints = new Set(
      list.map((item) => (typeof item === 'string' ? item : item?.fingerprint)).filter(Boolean),
    );
    if (!fingerprints.size && list.length) return { present: false, corrupt: true, fingerprints: new Set() };
    return { present: true, fingerprints };
  } catch {
    return { present: false, corrupt: true, fingerprints: new Set() };
  }
}

function applyBaseline(items, baseline) {
  if (!baseline.present) return items;
  const known = baseline.fingerprints;
  return items.map((item) => {
    if (item.grade === GRADE_TONIGHT && known.has(item.fingerprint)) {
      return { ...item, grade: GRADE_DEBT };
    }
    return item;
  });
}

function goneItems(current, baseline) {
  if (!baseline.present) return [];
  const now = new Set(current.map((item) => item.fingerprint));
  const gone = [];
  for (const fingerprint of [...baseline.fingerprints].sort()) {
    if (now.has(fingerprint)) continue;
    gone.push({
      grade: GRADE_GONE,
      package: 'repo',
      check: 'fingerprint',
      path: fingerprint,
      summary: fingerprint,
      fingerprint,
    });
  }
  return gone;
}

function renderReport({ date, baselineLabel, targets, items }) {
  const tonight = items.filter((item) => item.grade === GRADE_TONIGHT);
  const debt = items.filter((item) => item.grade === GRADE_DEBT);
  const gap = items.filter((item) => item.grade === GRADE_GAP);
  const gone = items.filter((item) => item.grade === GRADE_GONE);
  const inboundRed = tonight.length > 0;
  const lines = [
    `夜巡 ${date}`,
    `进仓检查：${inboundRed ? '红' : '绿'}`,
    `包：${targets}`,
    `今晚红：${tonight.length}`,
    `已知债：${debt.length}`,
    `缺口：${gap.length}`,
    `基线：${baselineLabel}`,
    '',
  ];
  const sections = [
    ['今晚红', tonight],
    ['已知债', debt],
    ['缺口', gap],
    ['已消失', gone],
  ];
  for (const [title, list] of sections) {
    lines.push(`## ${title}`);
    if (!list.length) lines.push('- （无）');
    else {
      for (const item of list) {
        lines.push(`- [${item.package}] ${item.check}`);
        lines.push(`  哪里：${item.path}`);
        lines.push(`  为什么：${item.summary}`);
      }
    }
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

function writeText(filePath, content, { mkdir = true } = {}) {
  if (!filePath) return;
  if (mkdir) mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function writeOutputs(doc, markdown) {
  writeText(argValue('--json') || process.env.NIGHTLY_HEALTH_REPORT_JSON || '', `${JSON.stringify(doc, null, 2)}\n`);
  writeText(argValue('--md') || process.env.NIGHTLY_HEALTH_REPORT_MD || '', markdown);
}

function defaultPublicRoots(packageDir) {
  return ['test', 'scripts/__tests__']
    .map((rel) => join(packageDir, rel))
    .filter((abs) => existsSync(abs));
}

function listPublicTests(packageDir) {
  const publicRoots = defaultPublicRoots(packageDir);
  const discovered = publicRoots.flatMap((root) => collectTestFiles(root));
  const lister = join(packageDir, 'scripts', 'test-public.mjs');
  if (!existsSync(lister)) return discovered;
  const listed = spawnSync(process.execPath, [lister, '--list'], {
    cwd: packageDir,
    encoding: 'utf8',
    env: process.env,
  });
  if (listed.status !== 0) return { error: listed.stderr || listed.stdout || 'test-public --list 失败' };
  const owned = loadOwnedExclusions(packageDir);
  if (owned.error) return { error: owned.error };
  const files = [];
  const excluded = new Set();
  for (const line of (listed.stdout || '').split('\n').map((item) => item.trim()).filter(Boolean)) {
    if (line.startsWith('# exclude ')) {
      const rest = line.slice('# exclude '.length).trim();
      const sep = rest.indexOf(' :: ');
      if (sep === -1) return { error: `test-public --list 排除项缺原因 ${line}` };
      const rel = rest.slice(0, sep).trim();
      const reason = rest.slice(sep + 4).trim();
      const abs = resolve(packageDir, rel);
      if (!reason) return { error: `test-public --list 排除项缺原因 ${line}` };
      if (!abs.endsWith('.test.mjs') || !existsSync(abs) || !statSync(abs).isFile() || !realInside(packageDir, abs)) {
        return { error: `test-public --list 排除项不合法 ${line}` };
      }
      const name = abs.split('/').pop();
      const relPath = relative(packageDir, abs);
      const demoOwned = owned.demo.has(relPath);
      const brokenOwned = owned.broken.get(relPath);
      const allowed = name.startsWith('_')
        || (reason.startsWith('demo:') && demoOwned)
        || (reason.startsWith('broken:') && brokenOwned);
      if (!allowed) return { error: `test-public --list 排除项类别不受控 ${line}` };
      excluded.add(abs);
      continue;
    }
    const abs = resolve(packageDir, line);
    if (!abs.endsWith('.test.mjs')) return { error: `test-public --list 给出非测试文件 ${line}` };
    if (!existsSync(abs) || !statSync(abs).isFile()) return { error: `test-public --list 给出不存在的文件 ${line}` };
    if (!realInside(packageDir, abs)) return { error: `test-public --list 给出包外路径 ${line}` };
    files.push(abs);
  }
  const listedSet = new Set(files);
  const unexplained = discovered.filter((abs) => !listedSet.has(abs) && !excluded.has(abs));
  if (unexplained.length) {
    return { error: `test-public --list 漏了包内公开测试: ${unexplained.map((abs) => relative(packageDir, abs)).join(', ')}` };
  }
  return files;
}

function tapFailureNames(output, limit = 6) {
  const names = [];
  for (const line of String(output || '').split(/\r?\n/)) {
    const m = line.match(/^not ok \d+\s+(.*)$/);
    if (m) {
      const name = m[1].replace(/\s*# SKIP.*$/i, '').trim();
      if (name && !names.includes(name)) names.push(name);
    }
    if (names.length >= limit) break;
  }
  return names;
}

function runTrustedTests(label, packageDir) {
  const listed = listPublicTests(packageDir);
  if (listed && listed.error) return `${label}: ${listed.error}`;
  const files = listed;
  if (!files.length) return `${label}: 包内没有可核验的 *.test.mjs，不能当作有自测`;
  console.log(`\n==> ${label} trusted tap\n    node --test --test-reporter=tap (${files.length} files)`);
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-force-exit', ...files], {
    cwd: packageDir,
    encoding: 'utf8',
    env: childEnv,
    timeout: 300000,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) return `${label}: 拉不起进程 ${result.error.message}`;
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const tap = parseTap(output);
  const cases = countRealTapCases(output, files);
  if (tap.tests == null) return `${label}: TAP 里看不到 # tests，不能当作有自测`;
  if (cases < 1) return `${label}: TAP 没有真实用例名，只算文件包装层，不能当作有自测`;
  if (tap.pass < 1) return `${label}: TAP 没有实际通过的用例，全 skip/todo 不能当作有自测`;
  if (result.status !== 0 || tap.fail > 0) {
    const names = tapFailureNames(output);
    const detail = names.length ? `\n    挂的用例（前 ${names.length}）:\n${names.map((n) => `    - ${n}`).join('\n')}` : '';
    console.error(detail);
    return `${label}: TAP 失败 ${tap.fail} / 退出码 ${result.status}${names.length ? `（如: ${names[0]}…）` : ''}`;
  }
  return null;
}

function placementProblems() {
  const problems = [];

  for (const name of ['package.json', 'SKILL.md']) {
    if (existsSync(join(ROOT, name))) {
      problems.push(`仓库根有 ${name}，必须放进 skills/<name>/ 或 standards/<name>/`);
    }
  }

  for (const group of ['skills', 'standards']) {
    const groupDir = join(ROOT, group);
    if (!existsSync(groupDir)) {
      problems.push(`缺 ${group}/ 目录`);
      continue;
    }
    for (const entry of listImmediateEntries(groupDir)) {
      if (entry.name.startsWith('.')) {
        if (entry.isDirectory() || entry.name === 'package.json' || entry.name === 'SKILL.md') {
          problems.push(`${group}/${entry.name} 是隐藏项，夜间扫不到`);
        }
        continue;
      }
      if (entry.isFile() && (entry.name === 'package.json' || entry.name === 'SKILL.md')) {
        problems.push(`${group}/${entry.name} 直接落在分组根上，必须放进 ${group}/<name>/`);
      }
    }
  }

  for (const entry of listImmediateEntries(ROOT)) {
    if (!entry.isDirectory()) continue;
    if (KNOWN_TOP.has(entry.name) || entry.name === '.git') continue;
    const dir = join(ROOT, entry.name);
    const hits = [];
    if (existsSync(join(dir, 'package.json'))) hits.push(relative(ROOT, join(dir, 'package.json')));
    if (existsSync(join(dir, 'SKILL.md'))) hits.push(relative(ROOT, join(dir, 'SKILL.md')));
    hits.push(...findNestedPackages(dir).map((abs) => relative(ROOT, join(abs, 'package.json'))));
    hits.push(...findNestedSkillFiles(dir).map((abs) => relative(ROOT, abs)));
    if (hits.length) {
      problems.push(`${entry.name} 不在 skills/ 或 standards/，夜间扫不到: ${[...new Set(hits)].join(', ')}`);
    }
  }

  return problems;
}

function discoverTargets() {
  const problems = placementProblems();
  const targets = [];

  for (const [kind, root] of [
    ['skill', join(ROOT, 'skills')],
    ['standard', join(ROOT, 'standards')],
  ]) {
    if (!existsSync(root)) continue;
    const dirs = listImmediateDirs(root);
    if (dirs.length === 0) {
      console.log(`# ${kind}: ${relative(ROOT, root)} 下还没有包`);
      continue;
    }
    for (const dir of dirs) {
      const rel = relative(ROOT, dir);
      const rootPkg = existsSync(join(dir, 'package.json')) ? dir : null;
      const toolPkg = existsSync(join(dir, 'tool', 'package.json')) ? join(dir, 'tool') : null;
      const illegalSkillTool = kind === 'skill' && toolPkg;
      if (kind === 'skill' && toolPkg) {
        problems.push(`${rel}/tool/package.json 只允许规范工具使用；skill 必须把 package.json 放在 ${rel}/`);
      }
      const packageDirs = [];
      if (rootPkg) packageDirs.push(rootPkg);
      if (kind === 'standard' && toolPkg && toolPkg !== rootPkg) packageDirs.push(toolPkg);
      if (!packageDirs.length) {
        problems.push(`${rel} 没有 package.json（skill 在目录根；规范工具可放 tool/package.json）`);
        continue;
      }
      const allowed = new Set(packageDirs);
      // skill 下的 tool/package.json 已作为布局问题记录；不要再重复报嵌套包，
      // 也不要因此丢掉同目录里合法根包的真实自测。
      if (illegalSkillTool) allowed.add(toolPkg);
      const nested = findNestedPackages(dir).filter((abs) => !allowed.has(abs));
      if (nested.length) {
        problems.push(`${rel} 里还有未单独进仓的嵌套包: ${nested.map((abs) => relative(ROOT, abs)).join(', ')}`);
      }
      const extraSkills = findNestedSkillFiles(dir)
        .filter((abs) => relative(dir, abs) !== 'SKILL.md');
      if (extraSkills.length) {
        problems.push(`${rel} 里还有深层 SKILL.md，一个包只允许包根一份: ${extraSkills.map((abs) => relative(ROOT, abs)).join(', ')}`);
      }
      for (const packageDir of packageDirs) {
        let pkg;
        try {
          pkg = readPackage(packageDir);
        } catch (err) {
          problems.push(`读不了 ${relative(ROOT, join(packageDir, 'package.json'))}: ${err.message}`);
          continue;
        }
        const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
        targets.push({
          kind,
          name: relative(ROOT, packageDir === dir ? dir : packageDir),
          packageDir,
          scripts,
        });
      }
    }
  }

  return { targets, problems };
}

function collectTargets() {
  const { targets, problems } = discoverTargets();
  if (problems.length) {
    die(`进仓内容无法夜间检查:\n- ${problems.join('\n- ')}`);
  }
  return targets;
}

function run(label, cwd, command, args, { requireTests = false } = {}) {
  console.log(`\n==> ${label}\n    ${command} ${args.join(' ')}  (${relative(ROOT, cwd)})`);
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    shell: false,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) {
    return `${label}: 拉不起进程 ${result.error.message}`;
  }
  if (result.status !== 0) {
    return `${label}: 退出码 ${result.status}`;
  }
  if (requireTests) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const tests = lastCount(output, 'tests');
    const fail = lastCount(output, 'fail') ?? 0;
    if (tests == null) return `${label}: 跑完了但看不到测试计数，不能当作有自测`;
    if (tests < 1) return `${label}: 跑了 0 个测试，不能当作有自测`;
    if (fail > 0) return `${label}: 失败 ${fail} 项`;
  }
  return null;
}

function provePublicTests(target) {
  if (!testLooksRunnable(target.scripts.test) || looksLikeFakeSummary(target.scripts.test)) {
    return `${target.name}: 进仓必须有可核验的 npm test，echo/true/exit 0/伪造摘要不算`;
  }
  const listed = listPublicTests(target.packageDir);
  if (listed && listed.error) return `${target.name}: ${listed.error}`;
  if (!listed.length) return `${target.name}: 包内没有可核验的公开 *.test.mjs，不能当作有自测`;
  const empty = listed.filter((abs) => !hasDeclaredTest(abs));
  if (empty.length) {
    return `${target.name}: 公开测试没有声明 test/it/describe: ${empty.map((abs) => relative(target.packageDir, abs)).join(', ')}`;
  }
  return null;
}

function finishReport({ targets, failures }) {
  const date = beijingDate();
  const baselinePath = argValue('--baseline') || process.env.NIGHTLY_HEALTH_BASELINE || '';
  const baseline = loadBaseline(baselinePath);
  const seenFail = new Set();
  let items = [];
  for (const message of failures) {
    const item = failureItem(message);
    if (seenFail.has(item.fingerprint)) continue;
    seenFail.add(item.fingerprint);
    items.push(item);
  }
  for (const target of targets) {
    const extra = exclusionItems(target);
    if (extra.error) items.push(failureItem(extra.error));
    else items.push(...extra.items);
  }
  items = applyBaseline(items, baseline);
  items = [...items, ...goneItems(items, baseline)];
  const tonight = items.filter((item) => item.grade === GRADE_TONIGHT);
  const baselineLabel = baseline.present
    ? '有昨日'
    : '无昨日基线，不能当新';
  const markdown = renderReport({ date, baselineLabel, targets: targets.length, items });
  const persisted = items.filter((item) => item.grade !== GRADE_GONE);
  const doc = {
    date,
    baseline: baseline.present ? 'yesterday' : 'none',
    baseline_label: baselineLabel,
    targets: targets.length,
    items: persisted,
  };
  writeOutputs(doc, markdown);
  process.stdout.write(markdown);
  if (tonight.length) {
    die(`夜间健康检查失败 ${tonight.length} 项:\n- ${tonight.map((item) => item.summary).join('\n- ')}`);
  }
  console.log(`夜间健康检查通过：${targets.length} 个包`);
}

function noTargetFailures(discoveryProblems) {
  const details = discoveryProblems.length ? `:\n- ${discoveryProblems.join('\n- ')}` : '';
  return [`skills/ 与 standards/ 下没有可检查的包${details}`, ...discoveryProblems];
}

function main() {
  const { targets, problems: discoveryProblems } = discoverTargets();
  if (targets.length === 0) {
    const failures = noTargetFailures(discoveryProblems);
    if (LIST_ONLY) die(failures[0]);
    finishReport({ targets, failures });
    return;
  }

  console.log(`将检查 ${targets.length} 个包:`);
  const proofFailures = [];
  for (const target of targets) {
    const extras = ['release:audit', 'fonts:check'].filter((name) => target.scripts[name]);
    const proof = provePublicTests(target);
    if (proof) proofFailures.push(proof);
    const test = proof ? '缺可核验的 npm test' : 'npm test + file proof';
    console.log(`- [${target.kind}] ${target.name}  →  ${test}${extras.length ? ` + ${extras.join(' + ')}` : ''}`);
  }
  if (LIST_ONLY) {
    const listFailures = [...discoveryProblems, ...proofFailures];
    if (listFailures.length) die(`进仓内容无法夜间检查:\n- ${listFailures.join('\n- ')}`);
    process.exit(0);
  }

  // 完整夜间不能因为发现布局或某个包的文件证明先红，就把已发现包的真实自测都跳过。
  // 前置问题仍计入最终失败；下面继续收集 npm test、trusted TAP 和附加审计结果。
  const failures = [...discoveryProblems, ...proofFailures];
  for (const target of targets) {
    const install = existsSync(join(target.packageDir, 'package-lock.json'))
      ? run(`${target.name} npm ci`, target.packageDir, 'npm', ['ci'])
      : run(`${target.name} npm install`, target.packageDir, 'npm', ['install']);
    if (install) {
      failures.push(install);
      continue;
    }
    const npmTest = run(`${target.name} npm test`, target.packageDir, 'npm', ['test']);
    if (npmTest) failures.push(npmTest);
    const tapFail = runTrustedTests(target.name, target.packageDir);
    if (tapFail) failures.push(tapFail);
    for (const extra of ['release:audit', 'fonts:check']) {
      if (!target.scripts[extra]) continue;
      const extraFail = run(`${target.name} npm run ${extra}`, target.packageDir, 'npm', ['run', extra]);
      if (extraFail) failures.push(extraFail);
    }
  }

  finishReport({ targets, failures });
}

export {
  collectTargets,
  placementProblems,
  testLooksRunnable,
  looksLikeFakeSummary,
  findNestedPackages,
  findNestedSkillFiles,
  lastCount,
  collectTestFiles,
  parseTap,
  countRealTapCases,
  listPublicTests,
  hasDeclaredTest,
  fingerprintOf,
  beijingDate,
  addBeijingDays,
  pickYesterdayNightlyRun,
  loadBaseline,
  applyBaseline,
  exclusionItems,
  renderReport,
  stripRunnerNoise,
};

if (process.argv[1] && resolve(process.argv[1]) === HERE) main();
