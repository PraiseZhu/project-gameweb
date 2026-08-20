#!/usr/bin/env node
/**
 * 未规范 draft 的漏项闸门。
 *
 * 规则检查已经由人工/看图确认的稳定形态，不对图层 id：
 * - 卡片语义资产（素材图、边框背景、立绘）不能保持 unknown；
 * - 划动/可划动那一层必须是 scroll/；同层「奖励列表」是 img/，不是 scroll/；
 * - determined 的消费身份必须同时写入 name 前缀；
 * - 另见 src/gold-morphology.mjs：任意组件集实例跟随、I…;母版Id 子件跟随、无 img 祖先切图、有文字分组不得 img/、两端同类同步、划动裁切层、弹窗、跨货架导航。
 *
 * 用法：node scripts/check-draft-asset-completeness.mjs <inventory.json> [...]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditCrossEndClassSync, auditDraftGoldMorphology } from "../src/gold-morphology.mjs";

const CARD_ART_RE = /^(素材图|素材|边框背景\d*|背景边框|立绘)$/;

function auditCardAndReward(doc) {
  const nodes = [];
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    if (typeof value.id === "string" && typeof value.type === "string") nodes.push(value);
    Object.values(value).forEach(walk);
  };
  walk(doc);

  const problems = [];
  for (const node of nodes) {
    const rawName = String(node.name ?? "").replace(/^img\//, "");
    if (node.status === "unknown" && CARD_ART_RE.test(rawName)) {
      problems.push(`${node.id}「${node.name}」是卡片视觉资产却仍为 unknown`);
    }
    if (node.status === "determined" && node.role && node.role !== "copy" && !String(node.name ?? "").startsWith(`${node.role}/`)) {
      problems.push(`${node.id} 已确定为 ${node.role}，但 name 未写入 ${node.role}/ 前缀`);
    }

  }
  return { ok: problems.length === 0, problems };
}

export function auditDraftAssetCompleteness(doc, peerDocs = []) {
  const cards = auditCardAndReward(doc);
  const morph = auditDraftGoldMorphology(doc);
  const peers = peerDocs.length ? auditCrossEndClassSync([doc, ...peerDocs]) : { ok: true, problems: [] };
  return { ok: cards.ok && morph.ok && peers.ok, problems: [...cards.problems, ...morph.problems, ...peers.problems] };
}

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("用法：node scripts/check-draft-asset-completeness.mjs <inventory.json> [...]");
    process.exit(1);
  }
  const loaded = [];
  for (const file of files) {
    loaded.push({ file: path.resolve(file), doc: JSON.parse(await fs.readFile(file, "utf8")) });
  }
  const results = loaded.map((item, index) => {
    const peers = loaded.filter((_, other) => other !== index).map((row) => row.doc);
    return { file: item.file, ...auditDraftAssetCompleteness(item.doc, peers) };
  });
  console.log(JSON.stringify({ ok: results.every((entry) => entry.ok), results }, null, 2));
  if (results.some((entry) => !entry.ok)) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
