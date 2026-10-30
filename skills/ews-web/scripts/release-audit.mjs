#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);

/**
 * Column-0 ESM specifiers, one statement per line (repo convention).
 * Not seen: indented imports and a second import on the same line.
 */
export function collectModuleSpecifiers(source) {
  const text = String(source ?? '').replace(/^\uFEFF/, '');
  const fromRe = /^(?:import|export)\b[^;'"`=(]*?\bfrom\s*['"]([^'"]+)['"]/gm;
  const sideRe = /^import\s*['"]([^'"]+)['"]/gm;
  return [fromRe, sideRe].flatMap((re) => [...text.matchAll(re)].map((m) => m[1]));
}

function walk(rel) {
  const abs = rel ? join(ROOT, rel) : ROOT;
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [rel.replaceAll('\\', '/')];
  const out = [];
  for (const name of readdirSync(abs)) {
    if (name === '.git' || name === 'node_modules' || name === '.DS_Store') continue;
    const child = rel ? join(rel, name) : name;
    out.push(...walk(child));
  }
  return out;
}

function auditRelease() {
const problems = [];
const manifest = JSON.parse(readFileSync(join(ROOT, 'public-release.json'), 'utf8'));
if (manifest.identity !== 'etheria-ews') problems.push('manifest.identity 必须是 etheria-ews');
if (manifest.displayName !== 'Etheria-ews') problems.push('manifest.displayName 必须是 Etheria-ews');
if (manifest.trigger !== 'ews出页') problems.push('manifest.trigger 必须是 ews出页');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
if (pkg.name !== 'etheria-ews') problems.push(`package.name=${pkg.name}`);
const skill = readFileSync(join(ROOT, 'SKILL.md'), 'utf8');
if (!/^name:\s*etheria-ews\s*$/m.test(skill)) problems.push('SKILL.md frontmatter.name 必须是 etheria-ews');
if (!/^  trigger:\s*ews出页\s*$/m.test(skill)) problems.push('SKILL.md metadata.trigger 必须是 ews出页');
if (!skill.includes('ews出页')) problems.push('SKILL.md 必须出现精确触发词 ews出页');
if (!/yisewebui|torchlightweb/.test(skill) || !/不要用于/.test(skill)) {
  problems.push('SKILL.md 必须把 ews出页 与伊瑟/火炬触发词划开');
}

for (const required of ['SKILL.md', 'package.json', 'public-release.json', 'scripts/', 'docs/', 'assets/']) {
  if (!manifest.publishable?.includes(required)) problems.push(`publishable 缺少 ${required}`);
}
for (const required of ['demos/', 'artifacts/', '.env', 'node_modules/']) {
  if (!manifest.private?.includes(required)) problems.push(`private 边界缺少 ${required}`);
}
for (const entry of manifest.private || []) {
  if (!Object.hasOwn(manifest.privateReasons || {}, entry)) problems.push(`private 条目 ${entry} 缺 privateReasons`);
}

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}
function matchGlob(rel, pattern) {
  return globToRegExp(pattern).test(rel) || (pattern.startsWith('*.') && globToRegExp(pattern).test(rel.split('/').pop()));
}
const privateFiles = new Set((manifest.private || []).flatMap((entry) => {
  if (/[*?]/.test(entry)) return walk('').filter((rel) => matchGlob(rel, entry));
  if (!existsSync(join(ROOT, entry))) return [];
  return entry.endsWith('/') ? walk(entry.slice(0, -1)) : walk(entry);
}));
const publishFiles = [...new Set((manifest.publishable || []).flatMap((entry) => (
  entry.endsWith('/') ? walk(entry.slice(0, -1)) : walk(entry)
)))].filter((file) => !privateFiles.has(file));

const sensitive = [
  { re: /(?:Bearer\s+|figma_pat_|xox[baprs]-)[A-Za-z0-9._-]{12,}/i, label: 'credential-like token' },
  { re: /(?:^|[\s`'"(=])((?:[A-Za-z]:[\\/]|\/(?:Users|home|root)\/)[^\s`'")]*)/, label: 'absolute machine path' },
];
for (const file of publishFiles) {
  if (file.endsWith('release-audit.mjs') || file.endsWith('public-release-audit.mjs')) continue;
  const text = readFileSync(join(ROOT, file), 'utf8');
  for (const rule of sensitive) {
    if (rule.re.test(text)) problems.push(`${file}: 检测到 ${rule.label}`);
  }
}

const policyTools = [
  '../../standards/design-policy/tool/src/parse-design-policy.mjs',
  '../../standards/design-policy/tool/src/mirror-design-policy.mjs',
  '../../standards/design-policy/tool/src/write-skill-policy.mjs',
];
for (const rel of policyTools) {
  if (!existsSync(resolve(ROOT, rel))) {
    problems.push(`停一政策闸需要仓内 ${rel}，缺失不得 skip`);
  }
}
const stop1BrowserTools = [
  '../../standards/stop1-figma-pixel/tool/src/safe-server.mjs',
  '../../standards/stop1-figma-pixel/tool/src/resolve-playwright.mjs',
  '../../standards/stop1-figma-pixel/tool/src/stop1-figma-pixel-probe.mjs',
];
for (const rel of stop1BrowserTools) {
  if (!existsSync(resolve(ROOT, rel))) {
    problems.push(`停一浏览器闸需要仓内 ${rel}，缺失不得 skip`);
  }
}

for (const file of publishFiles) {
  if (!file.endsWith('.mjs')) continue;
  const text = readFileSync(join(ROOT, file), 'utf8');
  const imports = collectModuleSpecifiers(text);
  for (const spec of imports) {
    if (spec.startsWith('.')) {
      const target = relative(ROOT, resolve(ROOT, dirname(file), spec)).replaceAll('\\', '/');
      if (!publishFiles.includes(target)) problems.push(file + ': 发布面缺少相对依赖 ' + spec);
      continue;
    }
    if (spec.startsWith('node:')) continue;
    try {
      require.resolve(spec, { paths: [ROOT] });
    } catch {
      problems.push(`${file}: 发布面 import 无法在独立目录解析 ${spec}`);
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`release:audit ok, publish files=${publishFiles.length}`);
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) auditRelease();
