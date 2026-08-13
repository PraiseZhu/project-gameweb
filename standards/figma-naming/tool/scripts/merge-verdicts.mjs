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
