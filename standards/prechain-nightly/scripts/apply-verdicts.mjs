#!/usr/bin/env node
/**
 * 按 verdicts.jsonl 把 role 前缀写入 draft，再交给 morph 收口。
 * 角色必须在规范总表；id 找不到或 0 应用则失败。
 */
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const ROLE_PREFIX = /^(bg|btn|dyn|fix|hot|img|ind|kv|mix|modal|ref|scroll|sec|switch|tab|copy)\//;
import { PREFIX_NAMES } from "../../figma-naming/spec/spec.mjs";

const ALLOWED_ROLES = new Set([...PREFIX_NAMES, "copy"]);
const argv = process.argv.slice(2);
const skipDetermined = argv.includes("--skip-determined");
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : null;
};

function rawName(name) {
  return String(name ?? "").replace(ROLE_PREFIX, "").trim();
}

function visit(doc, fn) {
  const seen = new Set();
  const walk = (value) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value.id === "string" && typeof value.type === "string") fn(value);
    Object.values(value).forEach(walk);
  };
  walk(doc);
}

function applyFile(inventoryPath, byId, { skipDetermined = false } = {}) {
  const doc = JSON.parse(readFileSync(inventoryPath, "utf8"));
  const present = new Set();
  visit(doc, (node) => present.add(node.id));
  const missing = [...byId.keys()].filter((id) => !present.has(id));
  let applied = 0;
  const skipped = [];
  visit(doc, (node) => {
    const hit = byId.get(node.id);
    if (!hit) return;
    const role = String(hit.role || "").replace(/\/$/, "");
    if (!ALLOWED_ROLES.has(role) || role === "copy") return;
    if (skipDetermined && node.status === "determined") {
      skipped.push({ id: node.id, existing: node.role, incoming: role });
      return;
    }
    const body = rawName(node.name) || role;
    node.status = "determined";
    node.role = role;
    node.name = `${role}/${body}`;
    node.label = body;
    applied += 1;
  });
  return { doc, applied, missing, skipped };
}

function writePairAtomically(entries) {
  const staged = entries.map(([target, doc], index) => {
    const temp = `${target}.tmp-${process.pid}-${index}`;
    const backup = `${target}.bak-${process.pid}-${index}`;
    writeFileSync(temp, `${JSON.stringify(doc, null, 2)}\n`);
    return { target, temp, backup, hadOriginal: existsSync(target), installed: false };
  });
  try {
    for (const item of staged) {
      if (item.hadOriginal) renameSync(item.target, item.backup);
      renameSync(item.temp, item.target);
      item.installed = true;
    }
  } catch (error) {
    for (const item of staged) {
      if (item.installed && existsSync(item.target)) unlinkSync(item.target);
      if (item.hadOriginal && existsSync(item.backup)) renameSync(item.backup, item.target);
      if (existsSync(item.temp)) unlinkSync(item.temp);
    }
    throw error;
  }
  for (const item of staged) {
    try { if (existsSync(item.backup)) unlinkSync(item.backup); } catch { /* 成功写回后留下备份也不破坏一致性 */ }
  }
}

function main() {
  const pc = opt("--pc");
  const mobile = opt("--mobile");
  const verdictsPath = opt("--verdicts");
  if (!pc || !mobile || !verdictsPath) {
    console.error("用法：--pc <draft> --mobile <draft> --verdicts <verdicts.jsonl>");
    process.exit(2);
  }
  const byId = new Map();
  const badRoles = [];
  for (const line of readFileSync(verdictsPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (typeof row.id !== "string" || !row.id.trim() || typeof row.role !== "string" || !row.role.trim()) continue;
    const role = String(row.role).replace(/\/$/, "");
    if (!ALLOWED_ROLES.has(role) || role === "copy") {
      badRoles.push(`${row.id}:${row.role}`);
      continue;
    }
    if (byId.has(row.id)) {
      console.error(JSON.stringify({ ok: false, error: "verdict id 重复", id: row.id }));
      process.exit(1);
    }
    byId.set(row.id, { ...row, role });
  }
  if (badRoles.length) {
    console.error(JSON.stringify({ ok: false, error: "角色不在总表", badRoles }));
    process.exit(1);
  }
  if (!byId.size) {
    console.error(JSON.stringify({ ok: false, error: "没有可应用的 verdict" }));
    process.exit(1);
  }
  const pcResult = applyFile(pc, byId, { skipDetermined });
  const mobileResult = applyFile(mobile, byId, { skipDetermined });
  const missing = [...byId.keys()].filter((id) => pcResult.missing.includes(id) && mobileResult.missing.includes(id));
  const applied = pcResult.applied + mobileResult.applied;
  const skipped = (pcResult.skipped?.length || 0) + (mobileResult.skipped?.length || 0);
  if (missing.length) {
    console.error(JSON.stringify({ ok: false, error: "图层 id 不存在", missing }));
    process.exit(1);
  }
  if (applied === 0 && !(skipDetermined && skipped > 0)) {
    console.error(JSON.stringify({ ok: false, error: "0 条写回" }));
    process.exit(1);
  }
  if (applied === 0) {
    console.log(JSON.stringify({ ok: true, verdicts: byId.size, pc: 0, mobile: 0, skipped }));
    return;
  }
  try {
    writePairAtomically([[pc, pcResult.doc], [mobile, mobileResult.doc]]);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: `写回失败：${error.message}` }));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, verdicts: byId.size, pc: pcResult.applied, mobile: mobileResult.applied, skipped: (pcResult.skipped?.length || 0) + (mobileResult.skipped?.length || 0) }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
