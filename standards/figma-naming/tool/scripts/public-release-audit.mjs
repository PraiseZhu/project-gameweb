#!/usr/bin/env node
/**
 * 发布边界体检：确定性、fail-closed。
 *
 * 与 skills/yise-web-ui/scripts/public-release-audit.mjs 同构，另加本目录特有的
 * 「Figma fileKey 泄漏」一条 —— 这个工具的私有资产核心就是那份真稿。
 *
 * 三条纪律：
 *   1. 只扫 publishable 清单里的文件（.cache/ 66MB 真稿快照不进扫描面）。
 *   2. 不许静默跳过：声明了却不存在的路径、读不动的文件、未分类的文件，一律报错。
 *   3. 命中要指到「哪个文件、哪一行、命中什么模式、命中了什么片段」。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const IDENTITY = 'figma-naming-lint';
const MAX_READ_BYTES = 4 * 1024 * 1024;

const problems = [];
const notes = [];
const fail = (message) => problems.push(message);
const toPosix = (p) => p.split(sep).join('/');
const readRel = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/* ------------------------------------------------------------------ *
 * manifest
 * ------------------------------------------------------------------ */

if (!existsSync(join(ROOT, 'public-release.json'))) {
  console.log(JSON.stringify({ ok: false, identity: IDENTITY, problems: ['缺少 public-release.json'] }, null, 2));
  process.exit(1);
}

let manifest = null;
try {
  manifest = JSON.parse(readRel('public-release.json'));
} catch (error) {
  fail(`public-release.json 不是有效 JSON: ${error.message}`);
}

const publishable = manifest?.publishable ?? [];
const privatePaths = manifest?.private ?? [];
const privateReasons = manifest?.privateReasons ?? {};

if (manifest) {
  if (manifest.identity !== IDENTITY) fail(`manifest.identity=${manifest.identity ?? '(missing)'}，必须是 ${IDENTITY}`);

  // spec/ 不在此列：规范正文是 ../spec/（tool/ 的同级目录），不属于工具的发布范围。
  // 它归 standards/figma-naming/ 那一层管，本闸门只扫 tool/ 内部。
  for (const required of ['README.md', 'PUBLIC-RELEASE.md', 'public-release.json', 'package.json', 'package-lock.json', 'src/', 'plugin/', 'bin/', 'scripts/', 'docs/']) {
    if (!publishable.includes(required)) fail(`publishable 缺少 ${required}`);
  }
  // 本目录的私有边界事实，逐条钉死；漏一条就是把真稿资产放出去。
  for (const required of ['.cache/', 'data/user-labels.json', 'baseline/findings/', 'report/', 'report-summary/', '.verify/', 'history/', 'dist/', 'node_modules/', '.env']) {
    if (!privatePaths.includes(required)) fail(`private 边界缺少 ${required}`);
  }
  // 检查项 4：每条 private 必须写明为什么不能公开。
  for (const entry of privatePaths) {
    const reason = privateReasons[entry];
    if (typeof reason !== 'string' || reason.trim() === '') fail(`privateReasons 缺少 ${entry} 的理由（private 边界必须显式）`);
  }
  for (const entry of Object.keys(privateReasons)) {
    if (!privatePaths.includes(entry)) fail(`privateReasons 多出 ${entry}，但 private 清单里没有它`);
  }
  for (const entry of publishable) {
    if (privatePaths.includes(entry)) fail(`${entry} 同时出现在 publishable 与 private`);
  }
}

/* ------------------------------------------------------------------ *
 * 检查项 5：身份一致性
 * ------------------------------------------------------------------ */

try {
  const pkg = JSON.parse(readRel('package.json'));
  if (pkg.name !== IDENTITY) fail(`package.name=${pkg.name ?? '(missing)'}，必须是 ${IDENTITY}`);
} catch (error) {
  fail(`package.json 不是有效 JSON: ${error.message}`);
}

if (existsSync(join(ROOT, 'README.md'))) {
  if (!new RegExp(`^#\\s+${IDENTITY}\\b`, 'm').test(readRel('README.md'))) fail(`README.md 缺少 "# ${IDENTITY}" 标题（身份与 package.name 对不上）`);
} else {
  fail('缺少 README.md');
}

/* ------------------------------------------------------------------ *
 * 扫描面：只走 publishable，且不踏进任何 private 前缀
 * ------------------------------------------------------------------ */

const privateFilePrefixes = privatePaths.filter((p) => p.endsWith('/')).map((p) => p.slice(0, -1));
const privateExactFiles = new Set(privatePaths.filter((p) => !p.endsWith('/')));
const isPrivate = (rel) => privateExactFiles.has(rel) || privateFilePrefixes.some((p) => rel === p || rel.startsWith(`${p}/`));

const skippedPrivate = [];

function walk(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return null; // 调用方负责报「声明了但不存在」
  if (isPrivate(rel)) { skippedPrivate.push(rel); return []; }
  const st = statSync(abs);
  if (st.isFile()) return [toPosix(rel)];
  const out = [];
  for (const name of readdirSync(abs).sort()) {
    if (name === '.git') continue;
    const sub = walk(toPosix(join(rel, name)));
    if (sub) out.push(...sub);
  }
  return out;
}

const publishFileSet = new Set();
for (const entry of publishable) {
  const rel = entry.endsWith('/') ? entry.slice(0, -1) : entry;
  const found = walk(rel);
  // 不许静默跳过：声明的路径不存在 = 清单说谎，报错。
  if (found === null) { fail(`publishable 声明了 ${entry}，但该路径不存在（清单与磁盘不一致，不能当作通过）`); continue; }
  if (found.length === 0) fail(`publishable 声明了 ${entry}，但扫不到任何文件`);
  for (const f of found) publishFileSet.add(f);
}
const publishFiles = [...publishFileSet].sort();

/* ------------------------------------------------------------------ *
 * 边界完整性：仓库根下的东西必须要么 publishable 要么 private
 * ------------------------------------------------------------------ */

/*
 * 逐叶子判定，不是逐顶层目录判定。
 * baseline/ 与 data/ 都是「一半发布一半私有」（baseline/exemptions.json 发布、
 * baseline/findings/ 私有），按顶层目录名判会把这两个目录整体报成未分类。
 * 反过来，只要有一个叶子文件两边都没覆盖到，就必须报出来 —— 这正是这项检查存在的理由。
 */
const publishPrefixes = publishable.map((p) => (p.endsWith('/') ? p.slice(0, -1) : p));
const covered = (rel) => publishPrefixes.some((p) => rel === p || rel.startsWith(`${p}/`)) || isPrivate(rel) || privatePaths.includes(`${rel}/`);

function auditCoverage(rel) {
  if (covered(rel)) return;
  const abs = join(ROOT, rel);
  if (statSync(abs).isDirectory()) {
    // 目录本身未被整体声明 —— 往下走，只报真正没人管的叶子。
    for (const name of readdirSync(abs).sort()) auditCoverage(toPosix(join(rel, name)));
    return;
  }
  fail(`${rel} 既不在 publishable 也不在 private —— 发布边界必须显式覆盖每一项`);
}
for (const name of readdirSync(ROOT).sort()) {
  if (name === '.git' || name === '.DS_Store') continue;
  auditCoverage(name);
}

/* ------------------------------------------------------------------ *
 * 占位示例识别（.env.example 这类明确的示例值不算凭证/泄漏）
 * ------------------------------------------------------------------ */

/*
 * 只看命中片段本身，不看整行。
 * 拿整行判会漏报：真 key 拼在模板字符串里（同一行出现 `${`）、或正文一句
 * 「语料只有 … in-sample」，都会把真 key 洗白（实测这样漏掉 3 处真 key）。
 * 占位示例的证据必须长在值上，不能长在旁边的散文里。
 *
 * 本文件不给自己开豁免口子：这里只写模式，不写任何真实的 key / token 样例，
 * 所以它跟别的 publishable 文件一样被完整扫描。
 */
const PLACEHOLDER_HINTS = /(?:x{6,}|X{6,}|0{6,}|\.{3}|YOUR[_-]|your[_-]|<[^>]*>|placeholder|PLACEHOLDER|EXAMPLE|example|dummy|redacted|REDACTED)/;
const looksPlaceholder = (fragment) => PLACEHOLDER_HINTS.test(fragment);

/* ------------------------------------------------------------------ *
 * 检查项 1：Figma fileKey
 *
 * fileKey 的形态：22 位纯字母数字、大小写数字混排、无分隔符、整体独立成词。
 * 光有形态会把 sha512 integrity 片段和 22 字符的 camelCase 标识符全报进来
 * （实测本目录里各有 3 个和 11 个），所以形态之后还要过四道排除：
 *   a. 所在的连续 base64 团块 ≥40 字符且含 + / = —— 那是 integrity/base64 载荷的一截
 *   b. camelCase / PascalCase —— 是标识符不是 key
 *   c. 全十六进制或单一大小写 —— 是 commit hash / sha 片段 / 常量名
 *   d. 明确的占位示例
 * 排除的是「形态相同但来源可判定」的东西，不是靠白名单放过具体的 key。
 * ------------------------------------------------------------------ */

const FILEKEY_SHAPE = /(?<![A-Za-z0-9])[A-Za-z0-9]{22}(?![A-Za-z0-9])/g;
const BASE64_CHAR = /[A-Za-z0-9+/=]/;

function surroundingBlob(text, start, end) {
  let i = start;
  let j = end;
  while (i > 0 && BASE64_CHAR.test(text[i - 1])) i -= 1;
  while (j < text.length && BASE64_CHAR.test(text[j])) j += 1;
  return text.slice(i, j);
}

/*
 * 标识符判定用「按大写字母切段」的段数与段长，不用 camelCase / PascalCase 正则。
 *
 * 光写 /^(?:[A-Z][a-z0-9]+){2,}$/ 会被随机串骗过去：一个 22 位随机串完全可能
 * 整串切成「大写 + 小写/数字」的段，形如 Zx7|Qm|Wn2|Vb|P4|Tr|Lk9|Ds|G3h
 * （反证用的假 key 在这里只写切分后的形态，不拼回完整串 —— 写全了会被本文件自己的
 *  fileKey 检查抓到，而给自己开豁免口子就等于让闸门对真泄漏也失效）。
 * 每段都合法，于是整串被当成 PascalCase 放过 —— 这是漏报。
 *
 * 实测两类的段形完全不重叠（本目录 10 个 22 字符标识符 vs key 形态串 + 3 段 integrity 片段）：
 *   真标识符：3–4 段，平均段长 5.5–7.33，最短段 ≥2，0 个数字
 *   key / 随机串：8–9 段，平均段长 2.44–2.75，最短段常为 1，含 3–7 个数字
 * 所以判据是「段数少 + 每段够长 + 没有数字」。要求 0 个数字在本目录 10 个真标识符上
 * 零代价，而它把「含数字的随机串」全部逼回报警侧 —— 宁可多报一个带数字的长标识符，
 * 不可漏报一个 key。
 */
const SEGMENT_MAX = 5;
const SEGMENT_MIN_LEN = 2;

function looksLikeIdentifier(token) {
  if (/[0-9]/.test(token)) return false;
  const segments = token.split(/(?=[A-Z])/).filter(Boolean);
  if (segments.length < 2 || segments.length > SEGMENT_MAX) return false;
  return segments.every((s) => s.length >= SEGMENT_MIN_LEN);
}

/** 返回排除理由；返回 null 表示「这确实是 fileKey 形态，报」。 */
function fileKeyExclusion(token, blob) {
  if (blob.length >= 40 && /[+/=]/.test(blob)) return 'base64/integrity 载荷片段';
  if (looksLikeIdentifier(token)) return 'camelCase/PascalCase 标识符';
  if (/^[0-9a-f]+$/.test(token) || /^[0-9A-F]+$/.test(token)) return '十六进制摘要/commit hash';
  if (!/[a-z]/.test(token) || !/[A-Z]/.test(token) || !/[0-9]/.test(token)) return '非大小写数字混排';
  if (looksPlaceholder(token)) return '占位示例';
  return null;
}

/* ------------------------------------------------------------------ *
 * 检查项 2/3：凭证形态 与 机器绝对路径
 * ------------------------------------------------------------------ */

const LINE_RULES = [
  { id: 'figma-pat', label: 'Figma Personal Access Token', re: /\bfigd_[A-Za-z0-9_-]{16,}/g },
  { id: 'figma-legacy-pat', label: 'Figma 旧版 token', re: /\bfigma_pat_[A-Za-z0-9_-]{12,}/g },
  { id: 'bearer', label: 'Bearer 凭证', re: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g },
  { id: 'slack', label: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { id: 'github-pat', label: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{16,}/g },
  { id: 'openai', label: 'OpenAI API key', re: /\bsk-[A-Za-z0-9-]{20,}/g },
  { id: 'aws', label: 'AWS Access Key Id', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { id: 'google', label: 'Google API key', re: /\bAIza[A-Za-z0-9_-]{20,}/g },
  { id: 'jwt', label: 'JWT / OAuth token', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g },
  { id: 'private-key', label: 'PEM 私钥', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { id: 'secret-assign', label: '凭证赋值', re: /\b(?:FIGMA_ACCESS_TOKEN|FIGMA_TOKEN|ACCESS_TOKEN|API_KEY|APIKEY|SECRET|PASSWORD|CLIENT_SECRET|AUTH_TOKEN)\s*[:=]\s*['"]?[A-Za-z0-9_\-./+]{12,}/gi },
  { id: 'machine-path-posix', label: '机器绝对路径', re: /\/(?:Users|home)\/(?!(?:runner|user|node|root|ci)\b)[A-Za-z0-9._-]+\/[A-Za-z0-9._\-/]*/g },
  { id: 'machine-path-win', label: 'Windows 机器绝对路径', re: /\b[A-Za-z]:\\Users\\(?!(?:Public|Default|All Users)\b)[A-Za-z0-9._-]+\\/g },
];

/* ------------------------------------------------------------------ *
 * 扫描
 * ------------------------------------------------------------------ */

const unreadable = [];
const findings = [];
const rejectedSamples = new Map();

for (const file of publishFiles) {
  const abs = join(ROOT, file);
  let text;
  try {
    const st = statSync(abs);
    // 不许静默跳过：读不动就报，不当作通过。
    if (st.size > MAX_READ_BYTES) { fail(`${file}: 超过 ${MAX_READ_BYTES} 字节，未被扫描（不能当作通过）`); unreadable.push(file); continue; }
    const buf = readFileSync(abs);
    // 不许静默跳过：二进制文件扫不了文本模式，要显式报出来。
    if (buf.includes(0)) { fail(`${file}: 疑似二进制文件，未被文本扫描（不能当作通过）`); unreadable.push(file); continue; }
    text = buf.toString('utf8');
  } catch (error) {
    fail(`${file}: 读取失败 ${error.message}（不能当作通过）`);
    unreadable.push(file);
    continue;
  }

  const lines = text.split('\n');
  const lineStart = [];
  let acc = 0;
  for (const l of lines) { lineStart.push(acc); acc += l.length + 1; }
  const lineOf = (offset) => {
    let lo = 0;
    let hi = lineStart.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStart[mid] <= offset) lo = mid; else hi = mid - 1; }
    return lo;
  };

  // 本文件自身没有豁免：它只写模式、不写真实样例，所以和别的文件一样被完整扫描。
  const record = (lineIdx, ruleId, label, fragment) => {
    const raw = lines[lineIdx] ?? '';
    findings.push({ file, line: lineIdx + 1, rule: ruleId, label, match: fragment.slice(0, 60), context: raw.trim().slice(0, 120) });
  };

  // fileKey
  FILEKEY_SHAPE.lastIndex = 0;
  let m;
  while ((m = FILEKEY_SHAPE.exec(text)) !== null) {
    const token = m[0];
    const idx = lineOf(m.index);
    const excuse = fileKeyExclusion(token, surroundingBlob(text, m.index, m.index + token.length));
    if (excuse) {
      if (!rejectedSamples.has(excuse)) rejectedSamples.set(excuse, new Set());
      rejectedSamples.get(excuse).add(token);
      continue;
    }
    record(idx, 'figma-filekey', 'Figma fileKey', token);
  }

  // 凭证 / 机器路径
  for (const rule of LINE_RULES) {
    rule.re.lastIndex = 0;
    let hit;
    while ((hit = rule.re.exec(text)) !== null) {
      const idx = lineOf(hit.index);
      if (looksPlaceholder(hit[0])) continue;
      record(idx, rule.id, rule.label, hit[0]);
    }
  }
}

for (const f of findings) {
  fail(`${f.file}:${f.line}: 命中 [${f.rule}] ${f.label} —— "${f.match}"  ｜ 上下文: ${f.context}`);
}

/* ------------------------------------------------------------------ *
 * 输出
 * ------------------------------------------------------------------ */

const byRule = {};
for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;

if (skippedPrivate.length) notes.push(`按 private 边界跳过（未读取内容）: ${[...new Set(skippedPrivate)].sort().join(', ')}`);
for (const [reason, tokens] of rejectedSamples) {
  notes.push(`fileKey 形态排除「${reason}」${tokens.size} 个: ${[...tokens].slice(0, 5).join(', ')}${tokens.size > 5 ? ' …' : ''}`);
}

console.log(JSON.stringify({
  ok: problems.length === 0,
  identity: IDENTITY,
  publishableFiles: publishFiles.length,
  unscannedFiles: unreadable,
  violationsByRule: byRule,
  violations: findings,
  notes,
  problems,
}, null, 2));

process.exit(problems.length ? 1 : 0);
