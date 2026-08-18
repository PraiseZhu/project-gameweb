#!/usr/bin/env node
/**
 * 未规范 draft 的漏项闸门。
 *
 * 规则只检查已经由人工/看图确认的稳定形态：
 * - 卡片语义资产（素材图、边框背景、立绘）不能保持 unknown；
 * - switch 变体树里，短高的「奖励」横条必须作为 scroll/奖励列表；
 * - determined 的消费身份必须同时写入 name，和规范稿同类层使用同一前缀。
 *
 * 用法：node scripts/check-draft-asset-completeness.mjs <inventory.json> [...]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CARD_ART_RE = /^(素材图|素材|边框背景\d*|立绘)$/;

export function auditDraftAssetCompleteness(doc) {
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
    const inVariantTree = typeof node.scope === "string" && node.scope.startsWith("component-set:");
    const h = Number(node.box?.h);
    const w = Number(node.box?.w);
    if (inVariantTree && node.type === "FRAME" && (rawName === "奖励" || rawName === "奖励列表") && w >= 300 && h > 0 && h <= 150) {
      if (node.role !== "scroll" || node.label !== "奖励列表" || node.behavior !== "scroll-x") {
        problems.push(`${node.id}「奖励」是变体内横滑奖励条，却不是 scroll/奖励列表`);
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("用法：node scripts/check-draft-asset-completeness.mjs <inventory.json> [...]");
    process.exit(1);
  }
  const results = [];
  for (const file of files) {
    const doc = JSON.parse(await fs.readFile(file, "utf8"));
    const result = auditDraftAssetCompleteness(doc);
    results.push({ file: path.resolve(file), ...result });
  }
  console.log(JSON.stringify({ ok: results.every((entry) => entry.ok), results }, null, 2));
  if (results.some((entry) => !entry.ok)) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
