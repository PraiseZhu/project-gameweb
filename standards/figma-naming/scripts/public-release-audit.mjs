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
 *
 * 边界根是 standards/figma-naming/，不是 tool/。`spec/` 与 `tool/` 分组独立，
 * 但公开发布时它们一起出门，边界只能有一套清单——两套清单就是两个「唯一事实来源」，
 * 谁都不知道该信哪个。清单路径因此一律以边界根为起点（`spec/…`、`tool/…`）。
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

/* ------------------------------------------------------------------ *
 * 项目稿名词表
 *
 * 别的检测都认形态（22 位串、figd_ 前缀、KEY=值），不需要事先知道具体值。
 * 未发布项目的稿名没有形态可认 —— 一个项目代号跟任何一个普通中文词长得一模一样，
 * 只能按词表逐词比对。代价是词表漏登记就抓不到，所以下面还有一道从裁决账本
 * 反查的提醒。
 *
 * 本文件跟别的 publishable 文件一样被这条规则完整扫描：这里只写机制，不写任何
 * 一个真实稿名，所以不需要给自己开口子。
 *
 * 两条不许放宽的判定：
 *   a. 词表为空或字段缺失 = 这项检查没生效，必须报出来。把「没检查」渲染成
 *      「检查通过」正是这个仓最怕的沉默失败。
 *   b. 空串 / 纯空白会匹配所有文件，等于把闸门焊死在红灯上（或者更糟 —— 让人
 *      为了消红而删掉整条规则）。发现即报错，不静默丢弃该条。
 * ------------------------------------------------------------------ */

const rawProjectWords = manifest?.projectWords;
const projectWords = [];

if (manifest) {
  if (rawProjectWords === undefined) {
    fail('public-release.json 缺少 projectWords 字段 —— 项目稿名检查未配置、未生效（不是「通过」）');
  } else if (!Array.isArray(rawProjectWords)) {
    fail(`public-release.json 的 projectWords 必须是字符串数组，实际是 ${typeof rawProjectWords} —— 项目稿名检查未生效（不是「通过」）`);
  } else if (rawProjectWords.length === 0) {
    fail('public-release.json 的 projectWords 是空数组 —— 项目稿名检查未配置、未生效（不是「通过」）');
  } else {
    rawProjectWords.forEach((word, i) => {
      if (typeof word !== 'string') {
        fail(`projectWords[${i}] 不是字符串（${typeof word}）—— 词表必须逐条可用，不能静默跳过`);
        return;
      }
      if (word.trim() === '') {
        fail(`projectWords[${i}] 是空串或纯空白 —— 它会匹配到所有文件，词表必须逐词非空`);
        return;
      }
      projectWords.push(word);
    });
  }
}

if (manifest) {
  if (manifest.identity !== IDENTITY) fail(`manifest.identity=${manifest.identity ?? '(missing)'}，必须是 ${IDENTITY}`);

  // spec/ 与 tool/ 都在此列：两者分组独立，但公开发布时是同一批出门的东西。
  // 少了 spec/，规范正文就成了没人管的路径；少了 tool/…，工具代码同理。
  for (const required of ['README.md', 'PUBLIC-RELEASE.md', 'public-release.json', 'spec/', 'tool/README.md', 'tool/package.json', 'tool/package-lock.json', 'tool/src/', 'tool/plugin/', 'tool/bin/', 'tool/scripts/', 'tool/docs/']) {
    if (!publishable.includes(required)) fail(`publishable 缺少 ${required}`);
  }
  // 私有边界事实，逐条钉死；漏一条就是把真稿资产放出去。
  for (const required of ['tool/.cache/', 'tool/data/user-labels.json', 'tool/baseline/findings/', 'tool/report/', 'tool/report-summary/', 'tool/.verify/', 'tool/history/', 'tool/dist/', 'tool/node_modules/', 'tool/.env']) {
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

// 身份长在工具那一半：package.json 与 README 标题都在 tool/ 下，
// 边界根自己只是这两半的容器，不带 package 身份。
try {
  const pkg = JSON.parse(readRel('tool/package.json'));
  if (pkg.name !== IDENTITY) fail(`package.name=${pkg.name ?? '(missing)'}，必须是 ${IDENTITY}`);
} catch (error) {
  fail(`tool/package.json 不是有效 JSON: ${error.message}`);
}

if (existsSync(join(ROOT, 'tool/README.md'))) {
  if (!new RegExp(`^#\\s+${IDENTITY}\\b`, 'm').test(readRel('tool/README.md'))) fail(`tool/README.md 缺少 "# ${IDENTITY}" 标题（身份与 package.name 对不上）`);
} else {
  fail('缺少 tool/README.md');
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

  /*
   * 项目稿名。
   *
   * 刻意不套 looksPlaceholder()：那个函数认的是凭证的占位形态（xxxxxx、YOUR_、<…>）。
   * 稿名没有占位形态，套上去只会让「示例某稿名」「<某稿名>」这类写法被静默放过 ——
   * 而把稿名写进示例，泄漏的仍然是那个稿名。
   *
   * 唯一的例外是词表自己的声明：public-release.json 里 projectWords 数组的值就是
   * 这些词，它不是泄漏、是判据本身。只跳过那一段的字节区间，同文件其余部分
   * （description / privateReasons / 路径…）照扫 —— 整文件豁免会让稿名从
   * description 里溜出去。
   */
  const wordListSpan = file === 'public-release.json'
    ? (() => {
        const m = /"projectWords"\s*:\s*\[[^\]]*\]/.exec(text);
        return m ? [m.index, m.index + m[0].length] : null;
      })()
    : null;

  for (const word of projectWords) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(word, from);
      if (at === -1) break;
      from = at + word.length;
      if (wordListSpan && at >= wordListSpan[0] && at < wordListSpan[1]) continue;
      record(lineOf(at), 'project-word', '项目稿名', word);
    }
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

/* 同一行同一词只报一条。
 *
 * project-word 按出现次数逐条记账：一行里「示例某稿名」「<某稿名>」是两个出现位置，
 * 会产生两条 file/line/rule/match 一字不差的 finding。同处命中合并成一条 ——
 * 重复记账不增加任何召回信息，只把报告刷成噪音；读者看到的第一条已经完整指出
 * 文件、行、规则与片段。不同行 / 不同词 / 不同规则互不影响，各自照报。
 * 这不是白名单：合并后该行该词仍然必报，泄漏信息一条不少。
 */
const seenFindings = new Set();
const dedupedFindings = [];
for (const f of findings) {
  const key = `${f.file}:${f.line}:${f.rule}:${f.match}`;
  if (seenFindings.has(key)) continue;
  seenFindings.add(key);
  dedupedFindings.push(f);
}

for (const f of dedupedFindings) {
  fail(`${f.file}:${f.line}: 命中 [${f.rule}] ${f.label} —— "${f.match}"  ｜ 上下文: ${f.context}`);
}

/* ------------------------------------------------------------------ *
 * 词表反查：从裁决账本里的 pageName 找出还没登记的稿名
 *
 * 词表检测的软肋是「没登记就抓不到」。体检一份新稿就会产生一个新 pageName，
 * 那个项目名此刻还没进词表，等它哪天被写进代码就是一次抓不到的泄漏。
 * 所以拿账本反查一遍，把没被词表覆盖的 pageName 提出来。
 *
 * 这是提醒不是判决（进 notes，不进 problems）：账本里有 pageName 不等于代码里
 * 有泄漏，把它当违规会逼着人往词表里塞用不上的词。
 *
 * 账本是 private 的，公开仓 clone 下来根本没有这个文件 —— 读不到就什么都不做，
 * 那是正常情况，不是异常。
 * ------------------------------------------------------------------ */

const LEDGER_REL = 'tool/data/user-labels.json';

if (existsSync(join(ROOT, LEDGER_REL))) {
  try {
    const ledger = JSON.parse(readRel(LEDGER_REL));
    const pageNames = [...new Set((ledger?.labels ?? []).map((l) => l?.pageName).filter((n) => typeof n === 'string' && n.trim() !== ''))].sort();
    // 子串匹配即算覆盖：词表里的「某稿名」应当覆盖「某稿名绑定页」这类派生稿名。
    const uncovered = pageNames.filter((name) => !projectWords.some((w) => name.includes(w)));
    notes.push(`裁决账本 ${LEDGER_REL}: ${pageNames.length} 个稿名，${uncovered.length} 个未被 projectWords 覆盖`);
    for (const name of uncovered) {
      notes.push(`账本里的稿名「${name}」不在 projectWords 中，若它会写进代码请补进词表`);
    }
  } catch (error) {
    // 文件在但读不动 —— 这不是「公开仓没有它」那种正常缺席，要说出来。
    notes.push(`裁决账本 ${LEDGER_REL} 存在但解析失败（${error.message}），本次未做词表反查`);
  }
}

/* ------------------------------------------------------------------ *
 * 输出
 * ------------------------------------------------------------------ */

const byRule = {};
for (const f of dedupedFindings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;

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
  violations: dedupedFindings,
  notes,
  problems,
}, null, 2));

process.exit(problems.length ? 1 : 0);
