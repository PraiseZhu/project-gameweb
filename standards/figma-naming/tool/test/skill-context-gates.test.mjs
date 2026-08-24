import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../SKILL.md");
const PROJECT_CLAUDE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../CLAUDE.md");

const REQUIRED_IN_SKILL = [
  "已规范命名稿",
  "status: \"ready\"",
  "本仓只编已规范 ready",
  "project-unnamed-inventory",
  "不做判断包看图写回",
  "做页只吃 ready",
];

const REQUIRED_IN_PROJECT_CLAUDE = [
  "已规范设计稿",
  "project-unnamed-inventory",
  "只吃 ready",
  "未规范稿出清单不在本仓",
];

test("SKILL.md 必须写清本仓只走已规范 ready，未规范指向独立仓", () => {
  const text = readFileSync(SKILL_PATH, "utf8");
  const missing = REQUIRED_IN_SKILL.filter((needle) => !text.includes(needle));
  assert.deepEqual(missing, [], `SKILL.md 缺本仓口径：${missing.join("；")}`);
  assert.equal(text.includes("发链接后自动跑到判断写回"), false, "本仓 SKILL 不得再把判断写回当默认开工");
});

test("项目 CLAUDE.md 必须把未规范出清单指到独立仓", () => {
  const text = readFileSync(PROJECT_CLAUDE_PATH, "utf8");
  const missing = REQUIRED_IN_PROJECT_CLAUDE.filter((needle) => !text.includes(needle));
  assert.deepEqual(missing, [], `CLAUDE.md 缺本仓口径：${missing.join("；")}`);
  assert.equal(text.includes("判断包上下文硬门"), false, "判断硬门应在 unnamed 仓，不在本仓 CLAUDE");
});
