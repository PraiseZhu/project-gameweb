import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runFromHandoff } from "../../../../skills/yise-web-ui/scripts/figma-from-handoff.mjs";
import { writeHandoffPack } from "../src/handoff.mjs";
import { rebuildInventoryIndexes } from "../src/inventory.mjs";
import { GOLD_MOBILE_PREFIX_CLASSES } from "../scripts/check-draft-asset-completeness.mjs";
import { behaviorOf, stampReadyFields } from "../../spec/inventory.mjs";
import { fixtureJudgment } from "../src/judgment.mjs";

const SKILL_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../SKILL.md");
const PROJECT_CLAUDE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../CLAUDE.md");
const TOOL_CLAUDE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../CLAUDE.md");

const REQUIRED_IN_SKILL = [
  "已规范命名稿",
  "status: \"ready\"",
  "本仓只编已规范 ready",
  "project-unnamed-inventory",
  "不做判断包看图写回",
  "做页只吃 ready",
  "figma:from-handoff",
  "不写 HTML",
  "核对页可选",
  "出清单",
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

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const TOOL_DIR = resolve(REPO_ROOT, "standards/figma-naming/tool");
const YISE_DIR = resolve(REPO_ROOT, "skills/yise-web-ui");
const TMP_DIR = resolve(REPO_ROOT, "_tmp");

function bashBlocksOf(text) {
  return [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]);
}

function cdTargetOf(block) {
  const match = /^\s*cd\s+(\S+)/m.exec(block);
  return match ? match[1] : null;
}

function resolveFromRepo(relativePath) {
  assert.equal(isAbsolute(relativePath), false, `命令路径必须相对仓库根：${relativePath}`);
  return resolve(REPO_ROOT, relativePath);
}

function sampleReady(id) {
  const nodes = GOLD_MOBILE_PREFIX_CLASSES.map((role, index) => stampReadyFields({
    id: `${id}-${role}`,
    type: role === "btn" ? "INSTANCE" : "FRAME",
    name: role === "sec" ? "sec/1-首屏" : `${role}/${role}`,
    status: "determined",
    role,
    label: role === "sec" ? "1-首屏" : role,
    behavior: behaviorOf(role),
    via: "prefix",
    parentId: role === "ind" ? `${id}-switch` : null,
    box: { x: 0, y: index * 40, w: role === "hot" ? 400 : 80, h: role === "hot" ? 220 : 32 },
  }));
  nodes.push({
    id: `${id}-scroll-track`,
    type: "FRAME",
    name: "轨道",
    status: "skipped",
    why: "art-fragment",
    parentId: `${id}-scroll`,
    box: { x: 0, y: 0, w: 80, h: 32 },
  });
  const doc = rebuildInventoryIndexes({
    ok: true,
    schema: "inventory/v2",
    status: "ready",
    fileKey: "FILEKEY",
    requestedNodeId: id,
    snapshot: { hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", lastModified: "2026-08-22T00:00:00Z" },
    page: { id, box: { x: 0, y: 0, w: 750, h: 1200 } },
    nodes,
    attachments: { componentSets: [], modals: [] },
    relations: [],
  });
  fixtureJudgment(doc);
  return doc;
}

function assertHandoffBashBlocksSelfCd(text, label) {
  const blocks = bashBlocksOf(text);
  const handoff = blocks.filter((block) => /npm run (inventory|inventory:review|handoff:pack|figma:from-handoff)\b/.test(block));
  assert.ok(handoff.length >= 1, `${label} 缺交接 bash 块`);
  for (const [index, block] of handoff.entries()) {
    const cd = cdTargetOf(block);
    assert.ok(cd, `${label} 交接块 ${index + 1} 缺 cd`);
    const cwd = resolveFromRepo(cd);
    if (block.includes("handoff:pack") || /npm run inventory\b/.test(block)) {
      assert.equal(cwd, TOOL_DIR, `${label} 交接块 ${index + 1} 应 cd tool，收到 ${cwd}`);
    }
    if (block.includes("figma:from-handoff")) {
      assert.equal(cwd, YISE_DIR, `${label} 吃包块应 cd yise-web-ui，收到 ${cwd}`);
    }
    const tmpArgs = [...block.matchAll(/(?:\s)((?:\.\.\/)+_tmp\/\S+)/g)].map((match) => match[1]);
    for (const arg of tmpArgs) {
      const resolved = resolve(cwd, arg);
      assert.equal(resolved.startsWith(`${TMP_DIR}/`) || resolved === TMP_DIR, true, `${label} ${arg} 从 ${cd} 必须落到仓库根 _tmp，收到 ${resolved}`);
    }
  }
}

test("SKILL.md 每个 bash 块从仓库根自己 cd，_tmp 解析到仓库根", () => {
  const text = readFileSync(SKILL_PATH, "utf8");
  const blocks = bashBlocksOf(text);
  assert.ok(blocks.length >= 4, `至少要有 inventory / review / pack / from-handoff 四块，收到 ${blocks.length}`);
  for (const [index, block] of blocks.entries()) {
    const cd = cdTargetOf(block);
    assert.ok(cd, `bash 块 ${index + 1} 缺 cd`);
    const cwd = resolveFromRepo(cd);
    if (block.includes("handoff:pack") || block.includes("npm run inventory --")) {
      assert.equal(cwd, TOOL_DIR, `块 ${index + 1} 应 cd tool，收到 ${cwd}`);
    }
    if (block.includes("figma:from-handoff")) {
      assert.equal(cwd, YISE_DIR, `吃包块应 cd yise-web-ui，收到 ${cwd}`);
    }
    const tmpArgs = [...block.matchAll(/(?:\s)((?:\.\.\/)+_tmp\/\S+)/g)].map((match) => match[1]);
    for (const arg of tmpArgs) {
      const resolved = resolve(cwd, arg);
      assert.equal(resolved.startsWith(`${TMP_DIR}/`) || resolved === TMP_DIR, true, `${arg} 从 ${cd} 必须落到仓库根 _tmp，收到 ${resolved}`);
    }
  }
  const eat = blocks.find((block) => block.includes("figma:from-handoff"));
  assert.ok(eat, "缺吃包命令块");
  assert.match(eat, /figma:from-handoff -- \.\.\/\.\.\/_tmp\/out\/handoff-<page>/);
  assert.equal(eat.includes("../../../_tmp"), false, "吃包不得用三级 ../_tmp");
  assert.equal(text.includes("unknownNotWired: true"), false, "不得把 unknownNotWired 写成顶层完成条件");
  assert.equal(text.includes("assets.ok"), false, "不得使用不存在的 assets.ok");
  assert.match(text, /consume\.pc\.unknownNotWired/);
  assert.match(text, /consume\.mobile\.unknownNotWired/);
  assert.match(text, /manifest\.assets\.pc\/mobile\.packed/);
});

test("tool/CLAUDE.md 交接命令块也必须从仓库根自己 cd", () => {
  const text = readFileSync(TOOL_CLAUDE_PATH, "utf8");
  assertHandoffBashBlocksSelfCd(text, "tool/CLAUDE.md");
  assert.match(text, /cd standards\/figma-naming\/tool\n\s*npm run inventory --/);
  assert.match(text, /cd standards\/figma-naming\/tool\n\s*npm run inventory:review/);
});

test("吃包完成条件字段必须和脚本返回值同名", () => {
  const missing = runFromHandoff(join(tmpdir(), "skill-context-gates-missing-pack"));
  assert.equal(Object.hasOwn(missing, "unknownNotWired"), false, "runFromHandoff 顶层不得有 unknownNotWired");
  assert.equal(Object.hasOwn(missing, "consume"), false);

  const dir = mkdtempSync(join(tmpdir(), "skill-field-lock-"));
  const pcDoc = sampleReady("1:1");
  const mobileDoc = sampleReady("2:2");
  const pcPath = join(dir, "pc.json");
  const mobilePath = join(dir, "mo.json");
  writeFileSync(pcPath, JSON.stringify(pcDoc));
  writeFileSync(mobilePath, JSON.stringify(mobileDoc));
  const outDir = join(dir, "out");
  const pack = writeHandoffPack({
    pcPath,
    mobilePath,
    pcDoc,
    mobileDoc,
    kind: "ready",
    outDir,
  });
  assert.equal(Object.hasOwn(pack.manifest.assets, "ok"), false);
  assert.equal(pack.manifest.assets.pc.packed, false);
  assert.equal(pack.manifest.assets.mobile.packed, false);

  const eaten = runFromHandoff(outDir);
  assert.equal(eaten.ok, true, (eaten.problems || []).join("\n"));
  assert.equal(Object.hasOwn(eaten, "unknownNotWired"), false);
  assert.equal(eaten.consume.pc.unknownNotWired, true);
  assert.equal(eaten.consume.mobile.unknownNotWired, true);
});
