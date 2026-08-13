/**
 * score-nameless.mjs — 把名字全部换成 Figma 默认名，只留结构和几何，看判据真实水平。
 *
 * 用户 2026-08-12：「你不要根据我的设计稿图层命名来判断，以未来设计稿根本没有
 * 命名规律作为参考，你根据命名规范和页面功能来负责判断如何命名。」
 *
 * 现有两个口径都不够狠：
 *   score-against-reference  参照页名字带前缀，80% 的分是 alreadyNamed 抄来的
 *   diag-strip-prefix        剥掉前缀，但名字仍是设计师写的（「多语言切换按钮」），
 *                            功能词表照样能读出答案
 *
 * 这里把名字整个换掉，按类型给 Figma 的默认名（Frame 1 / Rectangle 2 / Vector 3…），
 * 只有 TEXT 层保留 characters（那是页面内容，不是图层命名，未来稿子里照样有）。
 * 剩下能判对的，才是真正靠结构、几何、页面功能判出来的。
 *
 * 用法：node scripts/diagnostics/score-nameless.mjs [帧名，默认全部四帧]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeNamingPlan } from "../../src/naming/walk.mjs";
import { requireDraftCache } from "../draft-cache.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PREFIX_RE = /^(sec|fix|ref|img|bg|kv|btn|hot|modal|dyn|mix|scroll|switch|tab|ind)\//;
const FRAMES = process.argv.slice(2).length ? process.argv.slice(2) : ["pc", "cn_pc", "mobile", "cn_mobile"];

const cache = JSON.parse(
  await fs.readFile(requireDraftCache("1-15", { root: projectRoot }), "utf8"),
);

// Figma 给新图层的默认名，按类型
const DEFAULT_NAME = {
  FRAME: "Frame", GROUP: "Group", RECTANGLE: "Rectangle", ELLIPSE: "Ellipse",
  VECTOR: "Vector", LINE: "Line", STAR: "Star", POLYGON: "Polygon",
  BOOLEAN_OPERATION: "Union", INSTANCE: "Component", COMPONENT: "Component",
  COMPONENT_SET: "Component Set", TEXT: "Text", SLICE: "Slice",
};

for (const frameName of FRAMES) {
  let frame = null;
  (function walk(n) {
    if (frame) return;
    if (n.type === "FRAME" && n.name === frameName) { frame = n; return; }
    for (const c of n.children ?? []) walk(c);
  })(cache.document);
  if (!frame) { console.log(`找不到帧「${frameName}」`); continue; }

  const truth = new Map();
  let serial = 0;
  function blank(node, isRoot = false) {
    const raw = String(node.name ?? "");
    const m = raw.match(PREFIX_RE);
    if (m) truth.set(node.id, m[0].replace("/", ""));
    // 分区根保留原名：真机是按分区跑的，分区自己不在判定范围内
    const name = isRoot ? raw : `${DEFAULT_NAME[node.type] ?? "Frame"} ${++serial}`;
    return { ...node, name, children: (node.children ?? []).map((c) => blank(c)) };
  }
  const bare = blank(frame, true);

  const { report } = computeNamingPlan(bare, {
    sectionId: bare.id, sectionName: bare.name, sectionBase: bare.name,
    userConfirmed: {}, userNeedsRegroup: {}, componentRoles: new Map(), totalLabelCount: 0,
  });
  const got = new Map();
  for (const g of report.confirmedGroups) for (const e of g.entries) got.set(e.nodeId, e);
  for (const g of report.needsRecheckGroups) for (const e of g.entries) got.set(e.nodeId, e);

  let hit = 0; let wrong = 0; let miss = 0;
  const wrongBy = {}; const missBy = {};
  for (const [id, t] of truth) {
    const e = got.get(id);
    if (!e || !e.prefix) { miss += 1; missBy[t] = (missBy[t] || 0) + 1; continue; }
    if (e.prefix === t) hit += 1;
    else { wrong += 1; wrongBy[`${t}→${e.prefix}`] = (wrongBy[`${t}→${e.prefix}`] || 0) + 1; }
  }
  // 多判：判据给了前缀但真值没有
  let over = 0;
  for (const [id, e] of got) if (e.prefix && !truth.has(id)) over += 1;

  const recall = truth.size ? (hit / truth.size * 100).toFixed(0) : "0";
  console.log(`\n=== ${frameName}（名字全部换成 Figma 默认名）===`);
  console.log(`  真值 ${truth.size} 层 · 判对 ${hit}（召回 ${recall}%）· 判错 ${wrong} · 漏 ${miss} · 多判 ${over}`);
  const top = (obj, n = 6) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, v]) => `${k} ${v}`).join(" · ");
  if (wrong) console.log(`  判错分布：${top(wrongBy)}`);
  if (miss) console.log(`  漏判分布：${top(missBy)}`);
}
