#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MANIFEST_FILE = join(ROOT, 'public-release.json');
const problems = [];
const notes = [];

function fail(message) { problems.push(message); }
function read(rel) { return readFileSync(join(ROOT, rel), 'utf8'); }
function walk(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return [];
  const st = statSync(abs);
  if (st.isFile()) return [rel.replaceAll('\\', '/')];
  const out = [];
  for (const name of readdirSync(abs)) {
    if (name === '.git' || name === 'node_modules') continue;
    out.push(...walk(join(rel, name)));
  }
  return out;
}

if (!existsSync(MANIFEST_FILE)) fail('缺少 public-release.json');
let manifest = null;
try { manifest = JSON.parse(read('public-release.json')); } catch (error) { fail(`public-release.json 不是有效 JSON: ${error.message}`); }

if (manifest) {
  if (manifest.identity !== 'yise-web-ui') fail('manifest.identity 必须是 yise-web-ui');
  for (const required of ['SKILL.md', 'README.md', 'PUBLIC-RELEASE.md', 'public-release.json', 'LICENSE', 'package.json', 'package-lock.json', 'scripts/', 'templates/', 'docs/']) {
    if (!manifest.publishable?.includes(required)) fail(`publishable 缺少 ${required}`);
  }
  for (const required of ['demos/', 'artifacts/', 'evolution/', '.env', 'node_modules/']) {
    if (!manifest.private?.includes(required)) fail(`private 边界缺少 ${required}`);
  }
}

try {
  const pkg = JSON.parse(read('package.json'));
  if (pkg.name !== 'yise-web-ui') fail(`package.name=${pkg.name ?? '(missing)'}`);
} catch (error) { fail(`package.json 不是有效 JSON: ${error.message}`); }

const skill = read('SKILL.md');
const frontmatter = skill.match(/^---\s*\n([\s\S]*?)\n---/);
if (!frontmatter || !/^name:\s*yise-web-ui\s*$/m.test(frontmatter[1])) fail('SKILL.md frontmatter.name 必须是 yise-web-ui');
if (!/^# yise-web-ui\b/m.test(skill)) fail('SKILL.md 缺少 yise-web-ui 标题');
if (!/^# yise-web-ui\b/m.test(read('README.md'))) fail('README.md 缺少 yise-web-ui 标题');

const publishable = manifest?.publishable ?? [];
const publishFiles = [...new Set(publishable.flatMap((entry) => entry.endsWith('/') ? walk(entry.slice(0, -1)) : walk(entry)))];
const sensitive = [
  { re: /^\s*FIGMA_(?:TOKEN|FILE_KEY)\s*=\s*(?!<|YOUR_|\$\{|\.{3})[^\s#<>{}"']+/im, label: 'Figma credential assignment' },
  { re: /(?:Bearer\s+|figma_pat_|xox[baprs]-)[A-Za-z0-9._-]{12,}/i, label: 'credential-like token' },
  { re: /['"]([A-Za-z]:[\\/](?:Users[\\/](?!(?:Test|Public|Default|All Users)[\\/])[^\\/]+[\\/]|OneDrive|Desktop|Documents|Downloads|AppData[\\/]Roaming)[^'"\r\n]+)/, label: 'absolute machine path' },
  { re: /https?:\/\/[^\s]*(?:feishu\.cn|larksuite\.com)/i, label: 'private design/source URL' }
];
for (const file of publishFiles) {
  if (file === 'scripts/public-release-audit.mjs') continue;
  const text = read(file);
  for (const rule of sensitive) if (rule.re.test(text)) fail(`${file}: ??? ${rule.label}`);
}

const identityFiles = ['SKILL.md', 'README.md', 'package.json', 'scripts/evolution-note.mjs', 'scripts/lib/fs-utils.mjs', 'scripts/lib/pr-render.mjs', 'templates/qa-chrome.js', 'templates/demo-chrome.md'];
for (const file of identityFiles) {
  if (/qa-hifi-demo/.test(read(file))) fail(`${file}: 仍含未标注的旧公开身份 qa-hifi-demo`);
}
const figmaAdaptFile = join(ROOT, 'FIGMA-ADAPT.md');
if (existsSync(figmaAdaptFile) && readFileSync(figmaAdaptFile, 'utf8').includes('qa-hifi-demo')) notes.push('FIGMA-ADAPT.md 保留 qa-hifi-demo 作为历史上游参考，未纳入 publishable。');

console.log(JSON.stringify({ ok: problems.length === 0, identity: 'yise-web-ui', publishableFiles: publishFiles.length, notes, problems }, null, 2));
process.exit(problems.length ? 1 : 0);
