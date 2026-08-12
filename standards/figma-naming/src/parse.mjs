/**
 * parse.mjs — 图层名 → 结构（`前缀/名称[@参数]`）。
 *
 * 设计约束：解析层不判对错，只把名字拆开并标出「可疑之处」，严重度全部由 lint.mjs 决定。
 *
 * 关键取舍（决定误报率）：名字里带斜杠不等于想用前缀。
 * 稿里合法存在 `04/10`（日期文本）、`Group/2`（Figma 自动名）这类名字。
 * 认定「这是在用前缀」的条件：
 *   ① 斜杠前的词忽略大小写后等于某个总表前缀 → 认定为该前缀
 *   ② 词不在总表内、也不是 Figma 自动生成的类型名 → 认定为自造/拼错前缀（规范 §4 一律报）
 *      与某个总表前缀编辑距离够近时附带修正建议
 * 纯数字开头、带空格断开的名字（`04/10`、`Frame 12/copy`）连正则都不匹配，天然放过。
 */
import { PREFIX_NAMES, NON_PREFIX_WORDS, PREFIX_SYNTAX } from "./spec.mjs";

/**
 * 判定参数全部来自 spec.mjs（其事实来源是规范 §4.1），本文件不写死数值。
 *
 * 拼错阈值按词长分档：短词允许的距离必须更严，否则 3 字母之间互相都"接近"。
 * 真稿实测 `tab` 与 `txt` 的 Damerau 距离是 2，统一用 2 会把短词互判成拼错。
 */
const typoThreshold = (len) =>
  (len <= PREFIX_SYNTAX.shortWordMaxLen ? PREFIX_SYNTAX.typoThresholdShort : PREFIX_SYNTAX.typoThresholdLong);

/** 由 §4.1 参数拼出「是否在用前缀」的形态正则 */
const SEP_CLASS = PREFIX_SYNTAX.separators.map((s) => s.replace(/[\\\]^-]/g, "\\$&")).join("");
const PREFIX_RE = new RegExp(`^([A-Za-z]{${PREFIX_SYNTAX.minWordLen},})([ \\t]*)([${SEP_CLASS}])([ \\t]*)(.*)$`);

/**
 * @returns {{
 *   raw: string, prefix: string|null, prefixRaw: string|null,
 *   slash: string|null, spaced: boolean, body: string|null,
 *   params: Array<{key:string, value:string|null, hasEq:boolean, raw:string}>,
 *   unknownPrefix: string|null, suggestion: string|null,
 * }}
 */
export function parseName(raw) {
  const name = String(raw ?? "");
  const out = {
    raw: name, prefix: null, prefixRaw: null, slash: null, spaced: false,
    body: null, params: [], unknownPrefix: null, suggestion: null,
  };

  // 半角 / 、全角 ／ 、反斜杠 \ 都当作「试图用前缀」；斜杠两侧允许误打的空格
  const m = PREFIX_RE.exec(name);
  if (!m) return out;
  const [, cand, sp1, slash, sp2, rest] = m;
  const lower = cand.toLowerCase();

  if (PREFIX_NAMES.includes(lower)) {
    out.prefix = lower;
  } else if (NON_PREFIX_WORDS.has(lower)) {
    return out; // Figma 自动生成的类型名（Group/2 之类），不是在用前缀
  } else {
    out.unknownPrefix = lower;
    out.suggestion = nearestPrefix(lower); // 够接近才给建议，否则为 null（自造前缀）
  }

  out.prefixRaw = cand;
  out.slash = slash;
  out.spaced = sp1.length > 0 || sp2.length > 0;

  const parts = rest.split("@");
  out.body = parts.shift().trim();
  for (const p of parts) {
    const i = p.indexOf("=");
    out.params.push(
      i < 0
        ? { key: p.trim().toLowerCase(), value: null, hasEq: false, raw: `@${p}` }
        : { key: p.slice(0, i).trim().toLowerCase(), value: p.slice(i + 1).trim(), hasEq: true, raw: `@${p}` },
    );
  }
  return out;
}

/** 用了前缀语法（含拼错） */
export const usesPrefixSyntax = (n) => Boolean(n.prefix || n.unknownPrefix);

/** 找最接近的已知前缀；都不接近返回 null */
export const nearestPrefix = (word) => nearest(word, PREFIX_NAMES);

/** 找最接近的已知参数名；都不接近返回 null */
export const nearestParam = (word, paramNames) => nearest(word, paramNames);

function nearest(word, candidates) {
  let best = null, bestD = Infinity;
  for (const c of candidates) {
    const d = damerau(word, c);
    if (d < bestD) { bestD = d; best = c; }
  }
  return bestD > 0 && bestD <= typoThreshold(word.length) ? best : null;
}

/** Damerau-Levenshtein（相邻字符换位算 1 步，覆盖 sce/sec 这类最常见手误） */
export function damerau(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}
