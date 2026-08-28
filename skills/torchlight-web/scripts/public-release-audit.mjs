#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPlaceholderAbsolutePath } from './lib/public-release-audit-rules.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MANIFEST_FILE = join(ROOT, 'public-release.json');
const problems = [];
const notes = [];

function fail(message) { problems.push(message); }
function read(rel) { return readFileSync(join(ROOT, rel), 'utf8'); }
function walk(rel) {
  const abs = rel === '' ? ROOT : join(ROOT, rel);
  if (!existsSync(abs)) return [];
  const st = statSync(abs);
  if (st.isFile()) return [rel.replaceAll('\\', '/')];
  const out = [];
  for (const name of readdirSync(abs)) {
    if (name === '.git' || name === 'node_modules' || name === '.DS_Store') continue;
    const child = rel ? join(rel, name) : name;
    out.push(...walk(child));
  }
  return out;
}

if (!existsSync(MANIFEST_FILE)) fail('缺少 public-release.json');
let manifest = null;
try { manifest = JSON.parse(read('public-release.json')); } catch (error) { fail(`public-release.json 不是有效 JSON: ${error.message}`); }

if (manifest) {
  if (manifest.identity !== 'torchlight-web') fail('manifest.identity 必须是 torchlight-web');
  for (const required of ['SKILL.md', 'README.md', 'PUBLIC-RELEASE.md', 'public-release.json', 'LICENSE', 'package.json', 'package-lock.json', 'scripts/', 'templates/', 'docs/']) {
    if (!manifest.publishable?.includes(required)) fail(`publishable 缺少 ${required}`);
    else if (!existsSync(join(ROOT, required.endsWith('/') ? required.slice(0, -1) : required))) fail(`publishable 声明了 ${required}，但磁盘上没有`);
  }
  for (const required of ['demos/', 'artifacts/', 'evolution/', '.env', 'node_modules/']) {
    if (!manifest.private?.includes(required)) fail(`private 边界缺少 ${required}`);
  }
  // 每个 private 条目必须有对应 privateReasons(2026-08-14:页面级证据文档被移入 private 后补的机械约束,
  // 防止"列了边界却说不清为什么",发布复核时每条都能回指理由)。
  for (const entry of manifest.private ?? []) {
    if (!Object.hasOwn(manifest.privateReasons ?? {}, entry)) fail(`private 条目 ${entry} 缺 privateReasons 说明`);
  }
}

try {
  const pkg = JSON.parse(read('package.json'));
  if (pkg.name !== 'torchlight-web') fail(`package.name=${pkg.name ?? '(missing)'}`);
} catch (error) { fail(`package.json 不是有效 JSON: ${error.message}`); }

const skill = read('SKILL.md');
const frontmatter = skill.match(/^---\s*\n([\s\S]*?)\n---/);
if (!frontmatter || !/^name:\s*torchlight-web\s*$/m.test(frontmatter[1])) fail('SKILL.md frontmatter.name 必须是 torchlight-web');
if (!/^# torchlight-web\b/m.test(skill)) fail('SKILL.md 缺少 torchlight-web 标题');
if (!/^# torchlight-web\b/m.test(read('README.md'))) fail('README.md 缺少 torchlight-web 标题');

const publishable = manifest?.publishable ?? [];
// 私有边界必须真实生效:private 列表里的文件即使位于可发布目录(docs/ 等)下,也必须被机械排除,
// 而不是只写个声明继续被扫描(2026-08-14:SS5 证据文档移入 private 后发现 publishFiles 没减)。
function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`);
}
function matchGlob(rel, pattern) {
  return globToRegExp(pattern).test(rel) || (pattern.startsWith('*.') && globToRegExp(pattern).test(rel.split('/').pop()));
}
const privateFiles = new Set((manifest?.private ?? []).flatMap((entry) => {
  if (/[*?]/.test(entry)) {
    return walk('').filter((rel) => matchGlob(rel, entry));
  }
  const abs = join(ROOT, entry);
  if (!existsSync(abs)) return [];
  return entry.endsWith('/') ? walk(entry.slice(0, -1)) : walk(entry);
}));
const publishFilesRaw = [...new Set(publishable.flatMap((entry) => entry.endsWith('/') ? walk(entry.slice(0, -1)) : walk(entry)))];
const excludedFromPublish = publishFilesRaw.filter((f) => privateFiles.has(f));
const publishFiles = publishFilesRaw.filter((f) => !privateFiles.has(f));
if (excludedFromPublish.length) notes.push(`已按 private 列表从发布面机械排除 ${excludedFromPublish.length} 个文件(位于可发布目录内的私有条目)。`);
try {
  const pkg = JSON.parse(read('package.json'));
  for (const [name, script] of Object.entries(pkg.scripts || {})) {
    const match = String(script).match(/\bnode\s+([^\s]+\.mjs)\b/);
    if (!match) continue;
    const target = match[1].replaceAll('\\', '/');
    if (privateFiles.has(target)) fail(`package script ${name} 指向 private 排除文件 ${target}`);
    if (target.startsWith('scripts/') && !publishFiles.includes(target)) fail(`package script ${name} 指向未发布文件 ${target}`);
  }
} catch (error) {
  fail(`package scripts 发布面检查失败: ${error.message}`);
}
const sensitive = [
  { re: /^\s*FIGMA_(?:TOKEN|FILE_KEY)\s*=\s*(?!<|YOUR_|\$\{|\.{3})[^\s#<>{}"']+/im, label: 'Figma credential assignment' },
  { re: /(?:Bearer\s+|figma_pat_|xox[baprs]-)[A-Za-z0-9._-]{12,}/i, label: 'credential-like token' },
  { re: /(?:^|[\s`'"(=])((?:[A-Za-z]:[\\/]|\/(?:Users|home|root)\/)[^\s`'")]*)/, label: 'absolute machine path', allow: isPlaceholderAbsolutePath },
  { re: /https?:\/\/[^\s]*(?:feishu\.cn|larksuite\.com)/i, label: 'private design/source URL' }
];
for (const file of publishFiles) {
  if (file === 'scripts/public-release-audit.mjs') continue; // 本文件里的检测正则本身含路径样例，不自扫
  const text = read(file);
  for (const rule of sensitive) {
    const match = rule.re.exec(text);
    if (match && !rule.allow?.(match[1] ?? match[0])) fail(`${file}: 检测到 ${rule.label}`);
  }
}

const identityFiles = ['SKILL.md', 'README.md', 'package.json', 'scripts/evolution-note.mjs', 'scripts/lib/fs-utils.mjs', 'scripts/lib/pr-render.mjs', 'templates/qa-chrome.js', 'templates/demo-chrome.md'];
for (const file of identityFiles) {
  if (/qa-hifi-demo/.test(read(file))) fail(`${file}: 仍含未标注的旧公开身份 qa-hifi-demo`);
}
if (existsSync(join(ROOT, 'FIGMA-ADAPT.md')) && read('FIGMA-ADAPT.md').includes('qa-hifi-demo')) notes.push('FIGMA-ADAPT.md 保留 qa-hifi-demo 作为历史上游参考，未纳入 publishable。');

function toPosix(rel) { return rel.replaceAll('\\', '/'); }
const privatePrefixes = (manifest?.private ?? []).filter((p) => p.endsWith('/')).map((p) => p.slice(0, -1));
const privateExact = new Set((manifest?.private ?? []).filter((p) => !p.endsWith('/') && !/[*?]/.test(p)));
const privateGlobs = (manifest?.private ?? []).filter((p) => /[*?]/.test(p));
const publishPrefixes = (manifest?.publishable ?? []).map((p) => (p.endsWith('/') ? p.slice(0, -1) : p));
const isPrivate = (rel) => privateExact.has(rel)
  || privatePrefixes.some((p) => rel === p || rel.startsWith(`${p}/`))
  || privateGlobs.some((p) => matchGlob(rel, p) || matchGlob(rel.split('/').pop(), p));
const isPublishable = (rel) => publishPrefixes.some((p) => rel === p || rel.startsWith(`${p}/`));
function auditCoverage(rel) {
  if (rel === '.git' || rel === '.DS_Store' || rel === 'node_modules' || rel.startsWith('node_modules/')) return;
  if (isPrivate(rel) || isPublishable(rel)) {
    const abs = join(ROOT, rel);
    if (existsSync(abs) && statSync(abs).isDirectory() && !isPrivate(rel) && !publishable.includes(`${rel}/`) && !publishable.includes(rel)) {
      for (const name of readdirSync(abs).sort()) auditCoverage(toPosix(join(rel, name)));
    }
    return;
  }
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return;
  if (statSync(abs).isDirectory()) {
    for (const name of readdirSync(abs).sort()) auditCoverage(toPosix(join(rel, name)));
    return;
  }
  fail(`${rel} 既不在 publishable 也不在 private —— 发布边界必须显式覆盖每一项`);
}
for (const name of readdirSync(ROOT).sort()) auditCoverage(name);

// 非阻断提示:可发布文件里出现的私有 demo 路径 / 官方页 URL 引用(发布复核时必须逐条过目,
// 而不是只靠 4 条敏感正则)。SKILL.md/README/PUBLIC-RELEASE 里的 demos/yise-ss5-preview 是
// 刻意保留的「仅本地验证示例」身份声明,列出来供复核,不判红。
for (const file of publishFiles) {
  const text = read(file);
  if (/demos\/yise-ss5-preview/.test(text)) notes.push(`${file}: 引用私有 demo 路径 demos/yise-ss5-preview(发布复核需逐条确认是"示例"还是"证据")`);
  if (/yise\.xd\.cn|etheria\.xd\.com/i.test(text)) notes.push(`${file}: 引用官方页 URL(私有行为证据,发布复核需逐条确认)`);
}

console.log(JSON.stringify({ ok: problems.length === 0, identity: 'torchlight-web', publishableFiles: publishFiles.length, notes, problems }, null, 2));
process.exit(problems.length ? 1 : 0);
