#!/usr/bin/env node
/**
 * 把已沉淀形态里「机器能定」的前缀写回 draft：
 * 任意组件集实例跟随母版；I…;母版Id 子件跟随；无 img 祖先的切图补 img/。
 * 传入 PC+mobile 两份时，两端同类（type+剥前缀名）互相同步。
 * 不问人。写完再跑 check-draft-asset-completeness。
 *
 * 用法：node scripts/apply-gold-morphology.mjs <inventory.json> [...]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { finalizeDraftWriteback } from "../src/gold-morphology.mjs";

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("用法：node scripts/apply-gold-morphology.mjs <inventory.json> [...]");
    process.exit(1);
  }
  const loaded = files.map((file) => {
    const abs = path.resolve(file);
    return { abs, doc: JSON.parse(fs.readFileSync(abs, "utf8")) };
  });
  const { applied, counts } = finalizeDraftWriteback(loaded.map((item) => item.doc));
  const results = loaded.map((item, index) => {
    fs.writeFileSync(item.abs, `${JSON.stringify(item.doc, null, 2)}\n`);
    return {
      file: item.abs,
      applied: applied[index].length,
      ids: applied[index].map((row) => row.id),
      counts: counts[index],
    };
  });
  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
