import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../SKILL.md");
const PROJECT_CLAUDE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../CLAUDE.md");

const REQUIRED_IN_SKILL = [
  "硬门（Lead / Worker 同一套，不许降级）",
  "G0 步骤是闸门",
  "G1 禁读",
  "G2 切片闸门",
  "G3 上下文预算",
  "G4 派工",
  "send_to_lead",
  "page.png",
  "pack.json",
  "每轮最多 Read **2** 张小图",
  "禁止再 Read 任何图片",
  "禁止「先做到完美再汇报」",
  "截图和结构数据必须同时用",
  "set-*.jpg",
  "人确认前禁止写 skill / 台账",
  "确认判断已完成",
  "发链接后自动跑到判断写回",
  "未规范稿次日开跑",
];

const REQUIRED_IN_PROJECT_CLAUDE = [
  "判断包上下文硬门",
  "G0 步骤是闸门",
  "G1 禁读",
  "G2 切片闸门",
  "G3 上下文预算",
  "G4 派工",
];

test("SKILL.md 必须保留判断包硬门全文，删掉即红", () => {
  const text = readFileSync(SKILL_PATH, "utf8");
  const missing = REQUIRED_IN_SKILL.filter((needle) => !text.includes(needle));
  assert.deepEqual(missing, [], `SKILL.md 缺硬门条文：${missing.join("；")}`);
});

test("项目 CLAUDE.md 必须点名同一套硬门，只写在 skill 里不够", () => {
  const text = readFileSync(PROJECT_CLAUDE_PATH, "utf8");
  const missing = REQUIRED_IN_PROJECT_CLAUDE.filter((needle) => !text.includes(needle));
  assert.deepEqual(missing, [], `CLAUDE.md 缺硬门条文：${missing.join("；")}`);
});
