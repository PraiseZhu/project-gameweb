const FULL_SUITE_FILES = new Set([
  'public-release.json',
  'package.json',
  'package-lock.json',
  'naming-contract.json',
  'scripts/test-suites.mjs',
  'scripts/nightly-exclusions.json',
]);

const FULL_SUITE_PREFIXES = [
  'templates/',
  'fonts/',
];

const IGNORE_PREFIXES = [
  'docs/',
  'demos/',
  'artifacts/',
  'evolution/',
  'node_modules/',
];

const IGNORE_EXACT = new Set([
  'README.md',
  'SKILL.md',
  'DESIGN.md',
  'LICENSE',
  'EVOLUTION.md',
  'PUBLIC-RELEASE.md',
]);

export function parsePublicTestArgs(argv) {
  const filters = [];
  let listOnly = false;
  let changed = false;
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--list') {
      listOnly = true;
      continue;
    }
    if (arg === '--changed') {
      changed = true;
      continue;
    }
    if (String(arg).startsWith('-')) {
      throw new Error(`test-public: 未知参数 ${arg}`);
    }
    filters.push(arg);
  }
  if (changed && filters.length) {
    throw new Error('test-public: --changed 不能和文件过滤一起用');
  }
  return { listOnly, changed, filters };
}

export function publicTestBasename(filter) {
  const base = String(filter).replaceAll('\\', '/').split('/').pop();
  if (!base) return '';
  return base.endsWith('.test.mjs') ? base : `${base}.test.mjs`;
}

function notPublicReason(name, demo, brokenMap) {
  if (name.startsWith('_')) return 'demo: underscore private';
  if (demo.has(name)) return 'demo: current page';
  if (brokenMap[name] != null) return `broken: ${brokenMap[name]}`;
  return null;
}

function publicSets({ present, demoSuite, broken = {} }) {
  return {
    presentSet: present instanceof Set ? present : new Set(present),
    demo: demoSuite instanceof Set ? demoSuite : new Set(demoSuite ?? []),
    brokenMap: broken instanceof Map ? Object.fromEntries(broken) : { ...broken },
  };
}

export function selectPublicTests({ present, demoSuite, broken = {}, filters = [] }) {
  const { presentSet, demo, brokenMap } = publicSets({ present, demoSuite, broken });

  if (!filters.length) {
    const tests = [...presentSet]
      .filter((name) => name.endsWith('.test.mjs') && !notPublicReason(name, demo, brokenMap))
      .sort()
      .map((name) => `scripts/__tests__/${name}`);
    return { tests, unknown: [], notPublic: [] };
  }

  const tests = [];
  const unknown = [];
  const notPublic = [];
  const seen = new Set();

  for (const filter of filters) {
    const name = publicTestBasename(filter);
    if (!name) {
      unknown.push(filter);
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    if (!presentSet.has(name)) {
      unknown.push(filter);
      continue;
    }
    const reason = notPublicReason(name, demo, brokenMap);
    if (reason) {
      notPublic.push({ name, reason });
      continue;
    }
    tests.push(`scripts/__tests__/${name}`);
  }

  return { tests, unknown, notPublic };
}

export function normalizeSkillRel(rel) {
  return String(rel || '').replaceAll('\\', '/').replace(/^\.\//, '');
}

export function isIgnoredChangedFile(rel) {
  const path = normalizeSkillRel(rel);
  if (!path) return true;
  if (IGNORE_EXACT.has(path)) return true;
  if (IGNORE_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  if (path.endsWith('.md') && !path.startsWith('scripts/')) return true;
  if (/\.(png|webp|jpg|jpeg|gif)$/i.test(path)) return true;
  return false;
}

export function candidateTestBasenames(rel, presentNames = []) {
  const path = normalizeSkillRel(rel);
  const names = new Set();
  if (path.startsWith('scripts/__tests__/') && path.endsWith('.test.mjs')) {
    names.add(path.slice('scripts/__tests__/'.length));
    return [...names];
  }
  if (path === 'scripts/test-public.mjs') return ['select-public-tests.test.mjs'];
  if (!path.endsWith('.mjs')) return [...names];
  const stem = path.split('/').pop().replace(/\.mjs$/, '');
  names.add(`${stem}.test.mjs`);
  if (stem.startsWith('figma-')) names.add(`${stem.slice('figma-'.length)}.test.mjs`);
  const parts = path.replace(/^scripts\//, '').replace(/\.mjs$/, '').split('/');
  if (parts[0] === 'lib' && parts.length >= 2) {
    names.add(`${parts.slice(1).join('-')}.test.mjs`);
    names.add(`${parts.at(-1)}.test.mjs`);
  }
  for (const name of presentNames) {
    if (name.startsWith(`${stem}-`) && name.endsWith('.test.mjs')) names.add(name);
  }
  return [...names];
}

export function mapChangedFilesToPublicTests({
  changedFiles,
  present,
  demoSuite,
  broken = {},
}) {
  const { presentSet, demo, brokenMap } = publicSets({ present, demoSuite, broken });
  const tests = new Set();
  const ignored = [];
  const unmapped = [];

  for (const file of changedFiles) {
    const rel = normalizeSkillRel(file);
    if (FULL_SUITE_FILES.has(rel) || FULL_SUITE_PREFIXES.some((prefix) => rel.startsWith(prefix))) {
      return { full: true, tests: [], ignored, unmapped: [rel] };
    }
    if (isIgnoredChangedFile(rel)) {
      ignored.push(rel);
      continue;
    }
    const candidates = candidateTestBasenames(rel, presentSet)
      .filter((name) => presentSet.has(name))
      .filter((name) => !notPublicReason(name, demo, brokenMap));
    if (candidates.length) {
      for (const name of candidates) tests.add(`scripts/__tests__/${name}`);
      continue;
    }
    if (rel.startsWith('scripts/')) {
      return { full: true, tests: [], ignored, unmapped: [rel] };
    }
    unmapped.push(rel);
  }

  return { full: false, tests: [...tests].sort(), ignored, unmapped };
}

export function collectGitChangedFiles(cwd, run) {
  if (typeof run !== 'function') {
    throw new Error('test-public: collectGitChangedFiles 需要 git runner');
  }
  const files = new Set();
  const commands = [
    ['diff', '--name-only', '--relative', 'HEAD', '--', '.'],
    ['ls-files', '-o', '--exclude-standard', '--', '.'],
  ];
  for (const args of commands) {
    const res = run(cwd, args);
    if (!res || res.status !== 0) {
      throw new Error(`test-public: git ${args[0]} 失败`);
    }
    for (const line of String(res.stdout || '').split('\n')) {
      const rel = normalizeSkillRel(line.trim());
      if (rel) files.add(rel);
    }
  }
  return [...files].sort();
}
