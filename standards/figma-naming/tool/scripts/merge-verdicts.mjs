/**
 * merge-verdicts.mjs — 把插件导出的裁决 JSON 并进 data/user-labels.json。
 *
 * 这是「人在面板裁决 → 沉淀进规范库」这条链路的最后一步。为什么要单独一步、
 * 不让插件直接写：插件沙箱没有文件系统，manifest 也是 networkAccess: none。
 * 而且这个人工闸门是刻意保留的——往规范库里加东西必须人点头。
 *
 * 用法：
 *   node scripts/merge-verdicts.mjs <导出的 json 文件>          # 预览，不写
 *   node scripts/merge-verdicts.mjs <导出的 json 文件> --write  # 真写入
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeIntoLabels } from "../src/naming/verdicts.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = process.argv[2];
const doWrite = process.argv.includes("--write");

if (!inputPath) {
  console.error("用法：node scripts/merge-verdicts.mjs <导出的 json 文件> [--write]");
  process.exit(1);
}

const incoming = JSON.parse(await fs.readFile(path.resolve(inputPath), "utf8"));
if (!Array.isArray(incoming)) {
  console.error("导出的文件应该是一个数组（插件面板「导出裁决」给出的那段 JSON）");
  process.exit(1);
}

/**
 * 第一道闸：稿子没缓存就不许合并。
 *
 * 用户 2026-08-13：「为什么之前判断的东西你都没记住，这个问题从最一开始就
 * 应该要求过，人的裁决你需要记录并且积累经验」。
 *
 * 查下来的事实：113 条标签里 85 条对应的稿从没抓进 .cache/，人判过的那一层
 * 长什么样完全摸不到，只剩「这个 nodeId 是 btn/」这句话。结论留下了、证据扔了。
 * 其中 55 条对应的层后来还被设计师删掉重做了，nodeId 不复存在，彻底作废。
 *
 * 裁决本身只能提出假设，验证必须回到稿子上——2026-08-13 实测：14 条标签里
 * 13 条判 btn/，看着是铁律，拿到有真值的参照页一验精度只有 12-32%
 * （docs/LABEL-MINING.md）。没有稿子，这种假规律会被当成判据写进去。
 *
 * 所以这一步是硬闸门，不是提醒：��不到结构就退出，先抓稿再来。
 * 抓稿：node scripts/fetch-node.mjs "<figma url>"
 */
const cacheDir = path.join(projectRoot, ".cache");
const cachedIds = new Set();
for (const file of (await fs.readdir(cacheDir).catch(() => []))) {
  if (!file.endsWith(".json")) continue;
  let doc;
  try {
    doc = JSON.parse(await fs.readFile(path.join(cacheDir, file), "utf8")).document;
  } catch { continue; }
  if (!doc) continue;
  (function walk(node) {
    cachedIds.add(node.id);
    for (const child of node.children ?? []) walk(child);
  })(doc);
}
const uncached = incoming.filter((label) => !cachedIds.has(label.nodeId));
if (uncached.length) {
  console.error(`✋ ${uncached.length}/${incoming.length} 条的图层在 .cache/ 里找不到，拒绝合并。\n`);
  console.error("没有稿子就只剩「这个 id 是 X/」这句话，看不到那层长什么样，");
  console.error("既没法验证人的判断能不能推广，稿子一改这条标签就永久失效。\n");
  for (const label of uncached.slice(0, 8)) {
    console.error(`   ${String(label.nodeId).padEnd(24)}「${label.nodeNameAtLabelTime ?? "?"}」`
      + ` @ ${label.pageName ?? "(没记页面名)"}`);
  }
  if (uncached.length > 8) console.error(`   …… 另外 ${uncached.length - 8} 条`);
  console.error(`\n先抓稿：node scripts/fetch-node.mjs "<那份稿的 figma url>"`);
  console.error(`确实不需要证据（比如稿子已经改过、只想把结论记下来）时加 --no-cache-check 跳过。`);
  if (!process.argv.includes("--no-cache-check")) process.exit(1);
  console.error(`\n（--no-cache-check 已指定，继续合并）\n`);
}

// body 里带前缀的一律修掉，不能让它进库——合并后会写出 img/img/点。
// 成因：UI 没传 body 时拿「打裁决时那层的名字」兜底，而那层可能上一轮
// 已经被改过名（原名「点」→「img/点」），人在新名字上又判了一次。
// 导出侧已经修了（verdicts.mjs 的 stripPrefix），这里是第二道闸：
// 已经导出来的坏数据还得能救。
const PREFIX_HEAD = /^(sec|fix|ref|img|bg|kv|btn|hot|modal|dyn|mix|scroll|switch|tab|ind)\//;
const fixed = [];
for (const label of incoming) {
  if (typeof label.body === "string" && PREFIX_HEAD.test(label.body)) {
    fixed.push({ nodeId: label.nodeId, from: label.body, to: label.body.replace(PREFIX_HEAD, "") });
    label.body = label.body.replace(PREFIX_HEAD, "");
  }
}
if (fixed.length) {
  console.log(`修掉 ${fixed.length} 条 body 里带前缀的（会写出 img/img/点 那种）：`);
  for (const f of fixed) console.log(`  ${f.nodeId.padEnd(24)} ${f.from} → ${f.to}`);
  console.log("");
}

// 兜底编号不该被固化成人工标签。
// 「cn_pc-图1」是判据取不到名字时生成的占位，人点「对」时确认的是
// 「这是个按钮」，不是「它就该叫图1」。写进标签库等于把占位名变成永久名，
// 而且多个不同的层会共用同一个占位名——4 条 btn/cn_pc-图1 就是这么来的。
const PLACEHOLDER_BODY = /^.+-图\d+$/;
const placeholders = incoming.filter((l) => typeof l.body === "string" && PLACEHOLDER_BODY.test(l.body));
if (placeholders.length) {
  console.log(`⚠️  ${placeholders.length} 条的 body 是判据的兜底编号，不是真名字：`);
  for (const l of placeholders) {
    console.log(`  ${l.nodeId.padEnd(24)} ${String(l.nodeNameAtLabelTime).padEnd(10)} → ${l.prefix}/${l.body}`);
  }
  console.log(`  这些会把占位名固化成永久名，而且多个层可能撞同一个占位名。`);
  console.log(`  建议：先在 Figma 里给这些层起个有意义的名字，再重新判一次。\n`);
}

const labelsPath = path.join(projectRoot, "data/user-labels.json");
const store = JSON.parse(await fs.readFile(labelsPath, "utf8"));
const { labels, added, replaced } = mergeIntoLabels(store.labels, incoming);

console.log(`标签库现有 ${store.labels.length} 条`);
console.log(`导入 ${incoming.length} 条 → 新增 ${added}、覆盖 ${replaced}`);
console.log(`合并后 ${labels.length} 条\n`);

// 按裁决类型说人话——「轮播点 → null/null」看不出发生了什么
const KIND_TEXT = {
  rename: (l) => `改名成 ${l.prefix}/${l.body}`,
  "confirmed-ok": (l) => `确认判据对：${l.prefix}/${l.body}`,
  "no-prefix": () => "这层不用命名",
  undecided: () => "看过了但定不了（下次还会问）",
};
for (const label of incoming) {
  const isNew = !store.labels.some((l) => l.nodeId === label.nodeId);
  const what = (KIND_TEXT[label.kind] ?? (() => label.kind))(label);
  console.log(`  ${isNew ? "新增" : "覆盖"}  ${label.nodeId.padEnd(28)} ${String(label.nodeNameAtLabelTime).padEnd(10)} ${what}`);
}

if (!doWrite) {
  console.log(`\n这是预览。确认无误后加 --write 真正写入 data/user-labels.json`);
  process.exit(0);
}

store.labels = labels;
await fs.writeFile(labelsPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
console.log(`\n已写入 ${labelsPath}`);
console.log(`记得跑 npm run build:plugin 把新标签打进插件包。`);
