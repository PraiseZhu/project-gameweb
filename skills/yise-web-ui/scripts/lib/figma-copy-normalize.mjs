// copy-normalize.mjs — 文案比对前的归一化（FIGMA-ADAPT.md §6，前 6 步、顺序固定）。
//
// 为什么归一化存在：输入端一个字都不动（§0），稿里的简中原文就是查飞书表的唯一 key。
// 但两边都带脏数据（实测）：表里 "首頁  "（尾随空格）、"\n伊瑟、重启日…\n "（首尾换行）；
// 稿内 "…段位任务，\n即可获得…" vs 表内同句无 \n。归一化把这些"录入噪声"磨平，
// 又不伤到文案本身——
//
// ⚠️ 不要动标点、不要转简繁、不要小写化（§6 原话）。那会造成假匹配：
//   "ss5新赛季奖励" 若小写化就会撞上表里 "SS5 新赛季奖励"，把 SS4 残留误判成有效文案。
//
// 比对双方（稿内 characters、表内 zh-CN 列）必须走同一个 normalizeCopy，
// 各归一化一次再比——单边归一化等于没归一化。
//
// ── 第 7 步的来历（§6 规格缺陷，lead 2026-08-03 裁决保留并精确定义）──
// 严格按字面 6 步，§6 自己点名的真实案例走不通：
//   稿 "…段位任务，\n即可获得…" 经第 3 步（\n→单空格）得 "…任务， 即可…"，
//   表 "…任务，即可…" 无空格——不等，会掉成 fuzzy，与 §6 判定的 normalized 冲突。
// lead 裁决定义：**空白两侧都是 CJK 字符时，删除该空白**（CJK = 中日韩统一表意文字
// + CJK 标点 + 全角形式，按码点范围判，不是只判标点）：
//   "任务， 即可"   → 「，」「即」皆 CJK → 删 ✓（§6 案例成立）
//   "汉字 汉字"     → 皆 CJK → 删 ✓（换行/手动排版产物）
//   "SS5 新赛季奖励" → 「5」拉丁数字非 CJK → 保留 ✓（"ss5新赛季奖励" 仍 none，不假匹配）
// 安全性：归一化只用于**比对**，渲染文字仍取自表/稿原文，这里激进是安全的——
// 只要不把两个真不同的字符串合并（该定义不会：删的是两侧同文种间的排版空格）。

/**
 * CJK 判定（码点范围）：中日韩统一表意文字（基本/扩 A/扩 B/兼容）+ 日文假名
 * + CJK 标点（U+3001–303F）+ 全角形式（U+FF01–FF60）+ 常用中文排版符号（…—–·引号）。
 * 拉丁字母、阿拉伯数字、半角标点一律非 CJK——这是 "SS5 新…" 空格保留的关键。
 */
function isCJK(cp) {
  return (
    (cp >= 0x3400 && cp <= 0x4dbf) || // 表意文字扩 A
    (cp >= 0x4e00 && cp <= 0x9fff) || // 表意文字基本块
    (cp >= 0xf900 && cp <= 0xfaff) || // 兼容表意
    (cp >= 0x20000 && cp <= 0x2a6df) || // 表意文字扩 B
    (cp >= 0x3040 && cp <= 0x30ff) || // 平/片假名
    (cp >= 0x3001 && cp <= 0x303f) || // CJK 标点（、。〃〈〉《》「」【】…）
    (cp >= 0xff01 && cp <= 0xff60) || // 全角形式（，．：；？！（）等）
    cp === 0x00b7 || // · 间隔号
    (cp >= 0x2013 && cp <= 0x2015) || // – — ―
    (cp >= 0x2018 && cp <= 0x201d) || // ‘’“”
    cp === 0x2026 // … 省略号
  );
}

/**
 * §6 归一化，前 6 步顺序固定，不许换序：
 *   1. String(x)，null/undefined → ''
 *   2. 去零宽字符（ZWSP/ZWNJ/ZWJ/BOM/WORD JOINER——复制粘贴常客，肉眼不可见）
 *   3. 换行/制表 → 单空格
 *   4. 连续空白 → 单空格
 *   5. 全角空格 → 半角
 *   6. trim()
 *   7. 【lead 裁决，见文件头注释】空白两侧都是 CJK 字符时删除该空白
 */
export function normalizeCopy(x) {
  let s = x === null || x === undefined ? '' : String(x); // 1
  s = s.replace(/[\u200B\u200C\u200D\uFEFF\u2060]/g, ''); // 2 零宽字符 ZWSP/ZWNJ/ZWJ/BOM/WJ
  s = s.replace(/[\r\n\t]/g, ' '); // 3 换行/制表 → 单空格
  s = s.replace(/\s+/g, ' '); // 4 连续空白 → 单空格
  s = s.replace(/\u3000/g, ' '); // 5 全角空格 U+3000 → 半角
  s = s.trim(); // 6
  // 7 两侧皆 CJK 的空格删除（此时空白已被第 4 步收敛为单个半角空格）
  const chars = Array.from(s);
  s = chars
    .filter((c, i) => {
      if (c !== ' ') return true;
      const prev = chars[i - 1];
      const next = chars[i + 1];
      if (prev === undefined || next === undefined) return true;
      return !(isCJK(prev.codePointAt(0)) && isCJK(next.codePointAt(0)));
    })
    .join('');
  return s;
}

/**
 * 编辑距离（Levenshtein），按 Unicode 码点计（Array.from 拆代理对，emoji/生僻字不炸）。
 * 只用于 fuzzy 分级：归一化后距离 ≤ fuzzyThreshold 才列为候选。
 * fuzzy 永远不自动采用——这只决定"候选名单里有没有它"。
 */
export function editDistance(a, b) {
  const u = Array.from(a);
  const v = Array.from(b);
  const m = u.length;
  const n = v.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // 滚动两行 DP；文本最长几百码点，O(mn) 足够
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1, // 删
        curr[j - 1] + 1, // 插
        prev[j - 1] + (u[i - 1] === v[j - 1] ? 0 : 1), // 换
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * fuzzy 阈值（lead 2026-08-03 裁决，替换 §6 原文的 max(2, 长度×3%)——短串下失效：
 * 阈值 2 对所有二字词距离都是 2，"复制" 曾列出 11 个噪声候选）。
 *   len ≤ 6 → 0（短串任何差异都更可能是真不同词，不进 fuzzy、不列候选）
 *   否则   → max(1, floor(len × 3%))（抓"长句差一个标点/一个字"）
 * len 取两侧归一化文本较长者的码点数。
 * 核对：复制(2)→0 none；签到长文(~50，距 7)→1 none；ss5新赛季奖励(9，距 3)→1 none。
 */
export function fuzzyThreshold(normA, normB) {
  const len = Math.max(Array.from(normA).length, Array.from(normB).length);
  if (len <= 6) return 0;
  return Math.max(1, Math.floor(len * 0.03));
}
