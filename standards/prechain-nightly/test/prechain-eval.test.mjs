import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildInventory, rebuildInventoryIndexes } from "../../figma-naming/tool/src/inventory.mjs";
import { GOLD_MOBILE_PREFIX_CLASSES } from "../../figma-naming/tool/scripts/check-draft-asset-completeness.mjs";
import {
  DEFAULT_UNNAMED_PAIRS,
  TARGET,
  buildEvalReport,
  classifyMismatch,
  cloneJson,
  compareByClass,
  compareById,
  evalPreparedPair,
  fingerprintRound,
  newDraftGateOf,
  renderEvalMarkdown,
  resetInventoryToZero,
  runMachinePrechain,
  runRounds,
  stripFigmaTree,
} from "../src/prechain-eval.mjs";

test("newDraftGate：只按本稿存在层逐页双 90，completeness 红必失败", () => {
  const edge = newDraftGateOf({ presentHit: 9, presentMiss: 1, presentWrong: 0, extra: 1 }, true);
  assert.equal(edge.recall, 0.9);
  assert.equal(edge.precision, 0.9);
  assert.equal(edge.pass, true);
  assert.equal(newDraftGateOf({ presentHit: 8, presentMiss: 2, presentWrong: 0, extra: 0 }, true).pass, false);
  assert.equal(newDraftGateOf({ presentHit: 10, presentMiss: 0, presentWrong: 0, extra: 0 }, false).pass, false);
});

const CLI = fileURLToPath(new URL("../scripts/nightly-prechain-eval.mjs", import.meta.url));

function box(width = 400, height = 200) {
  return { x: 0, y: 0, width, height };
}

function node(id, name, type, children = [], extra = {}) {
  return {
    id,
    name,
    type,
    visible: true,
    absoluteBoundingBox: box(),
    children,
    ...extra,
  };
}

function goldPageTree() {
  return node("p", "pc", "FRAME", [
    node("s1", "sec/1", "FRAME", [
      node("btn", "btn/播放按钮", "FRAME"),
      node("copy", "标题", "TEXT", [], { characters: "标题" }),
    ]),
  ]);
}

function goldAndDraft(tree = goldPageTree()) {
  const gold = buildInventory(tree, { fileKey: "TESTFILEKEY0000000001", requestedNodeId: tree.id, status: "ready" });
  assert.equal(gold.ok, true, gold.error);
  const stripped = stripFigmaTree(cloneJson(tree)).tree;
  const draft = buildInventory(stripped, { fileKey: "TESTFILEKEY0000000001", requestedNodeId: tree.id, status: "draft" });
  assert.equal(draft.ok, true, draft.error);
  return { gold, draft };
}

test("夜间稿对钉死 399 未规范 vs 392 规范，不对 id 抄名", () => {
  assert.equal(TARGET.unnamedShelf, "399:47576");
  assert.equal(TARGET.goldShelf, "392:18375");
  assert.deepEqual(TARGET.unnamedPages, ["491:6935", "491:7593"]);
  assert.deepEqual(TARGET.goldPages, ["392:24190", "392:25877"]);
  assert.equal(DEFAULT_UNNAMED_PAIRS[0].id, "unnamed-vs-gold");
  assert.equal(DEFAULT_UNNAMED_PAIRS[0].goldPairId, "gold");
});

test("stripFigmaTree 只剥总表前缀并留下真值", () => {
  const { tree, truth } = stripFigmaTree(goldPageTree());
  assert.equal(truth.get("s1"), "sec");
  assert.equal(truth.get("btn"), "btn");
  assert.equal(tree.children[0].name, "1");
  assert.equal(tree.children[0].children[0].name, "播放按钮");
});

test("新闸门：从 0 缺冻住前缀类则红，不再静默假绿", () => {
  const { gold, draft } = goldAndDraft();
  const page = evalPreparedPair({
    id: "gold-a",
    kind: "gold-id",
    pages: ["p"],
    goldDocs: [gold],
    draftDocs: [draft],
  }, { entries: [] }).pages[0];
  assert.equal(page.completeness.ok, false);
  assert.match(page.completeness.problems.join("\n"), /相对规范稿缺前缀类/);
  assert.equal(page.falsePass, false);
});

function classDoc(roles, extraNodes = []) {
  return rebuildInventoryIndexes({
    schema: "inventory/v2",
    status: "draft",
    page: { id: "p", box: { x: 0, y: 0, w: 750, h: 1000 } },
    nodes: [
      ...roles.map((role, index) => ({
        id: `c${index}`,
        type: "FRAME",
        name: `${role}/x`,
        status: "determined",
        role,
        box: { x: 0, y: index * 40, w: 80, h: 32 },
      })),
      ...extraNodes,
    ],
    attachments: { modals: [], componentSets: [], components: [] },
  });
}

test("未规范对照：本稿没有的金样类不把验收打成假绿", () => {
  const extra = {
    id: "mid",
    type: "RECTANGLE",
    name: "kv/中景",
    status: "determined",
    role: "kv",
    box: { x: 0, y: 400, w: 80, h: 32 },
  };
  const uniqueDoc = (extras = []) => rebuildInventoryIndexes({
    schema: "inventory/v2",
    status: "draft",
    page: { id: "p", box: { x: 0, y: 0, w: 750, h: 1000 } },
    nodes: [
      ...GOLD_MOBILE_PREFIX_CLASSES.map((role, index) => ({
        id: `c${index}`,
        type: "FRAME",
        name: `${role}/${role}块`,
        status: "determined",
        role,
        box: { x: 0, y: index * 40, w: 80, h: 32 },
      })),
      ...extras,
    ],
    attachments: { modals: [], componentSets: [], components: [] },
  });
  const gold = uniqueDoc([extra]);
  const draft = uniqueDoc();
  const page = evalPreparedPair({
    id: "unnamed-a",
    kind: "unnamed-class",
    pages: ["p"],
    goldDocs: [gold],
    draftDocs: [draft],
  }, { entries: [] }).pages[0];
  assert.equal(page.completeness.ok, true, page.completeness.problems.join("\n"));
  assert.equal(page.falsePass, false);
  assert.equal(page.diff.summary.presentHitRate, 1);
  assert.ok(page.diff.summary.absentGoldClasses >= 1);
});

test("前缀类齐但仍漏某一层 = 假绿（闸门不按图层对规范稿）", () => {
  const extra = {
    id: "play",
    type: "FRAME",
    name: "btn/播放按钮",
    status: "determined",
    role: "btn",
    box: { x: 0, y: 400, w: 80, h: 32 },
  };
  const gold = classDoc(GOLD_MOBILE_PREFIX_CLASSES, [extra]);
  const draft = classDoc(GOLD_MOBILE_PREFIX_CLASSES);
  const page = evalPreparedPair({
    id: "gold-a",
    kind: "gold-id",
    pages: ["p"],
    goldDocs: [gold],
    draftDocs: [draft],
  }, { entries: [] }).pages[0];
  assert.equal(page.completeness.ok, true, page.completeness.problems.join("\n"));
  assert.equal(page.falsePass, true);
  assert.equal(page.diff.mismatches.some((row) => row.id === "play" && row.classify.kind === "gate-blind-spot"), true);
});

test("闸门绿而层不对 = 假绿；闸门红不算假绿", () => {
  const miss = {
    id: "art",
    goldRole: "img",
    recoveredRole: null,
  };
  assert.equal(classifyMismatch(miss, true).kind, "gate-blind-spot");
  assert.equal(classifyMismatch(miss, false).kind, "gate-red");
  assert.equal(classifyMismatch({ ...miss, recoveredRole: "btn" }, true).kind, "wrong-prefix-not-scored");
  assert.equal(classifyMismatch({ ...miss, absentFromDraft: true }, true).kind, "gold-class-absent");
});

test("未规范对照：本稿没有的金样类不算漏判", () => {
  const gold = rebuildInventoryIndexes({
    schema: "inventory/v2",
    status: "ready",
    page: { id: "g", box: { x: 0, y: 0, w: 1920, h: 1000 } },
    nodes: [
      { id: "mid", type: "RECTANGLE", name: "kv/中景", status: "determined", role: "kv" },
      { id: "bg", type: "RECTANGLE", name: "img/按钮背景", status: "determined", role: "img" },
    ],
    attachments: { modals: [], componentSets: [], components: [] },
  });
  const draft = rebuildInventoryIndexes({
    schema: "inventory/v2",
    status: "draft",
    page: { id: "d", box: { x: 0, y: 0, w: 1920, h: 1000 } },
    nodes: [
      { id: "mid2", type: "RECTANGLE", name: "kv/中景", status: "determined", role: "kv" },
    ],
    attachments: { modals: [], componentSets: [], components: [] },
  });
  const diff = compareByClass(draft, gold);
  assert.equal(diff.summary.presentHit, 1);
  assert.equal(diff.summary.presentMiss, 0);
  assert.equal(diff.summary.absentGoldClasses, 1);
  assert.equal(diff.summary.presentHitRate, 1);
  assert.equal(diff.mismatches.some((row) => row.body === "按钮背景" && row.absentFromDraft), true);
});

test("resetInventoryToZero 清掉已写回前缀，copy 保留", () => {
  const { gold } = goldAndDraft();
  const zero = resetInventoryToZero(gold);
  const btn = zero.nodes.find((item) => item.id === "btn");
  const copy = zero.nodes.find((item) => item.id === "copy");
  assert.equal(btn.status, "unknown");
  assert.equal(btn.name, "播放按钮");
  assert.equal(copy.role, "copy");
  assert.equal(zero.status, "draft");
});

test("评测核必须走现行 draft-prechain，禁止自备闸门词表", () => {
  const src = readFileSync(new URL("../src/prechain-eval.mjs", import.meta.url), "utf8");
  assert.match(src, /runDraftMachinePipeline/);
  assert.doesNotMatch(src, /CARD_ART_RE|CLIP_RE|IMAGE_BODY_RE/);
  assert.doesNotMatch(src, /auditDraftAssetCompleteness\(/);
  assert.doesNotMatch(src, /goldPrefixClassesFor\(/);
});

test("50 轮默认接口在夹具上指纹稳定", () => {
  const extra = {
    id: "play",
    type: "FRAME",
    name: "btn/播放按钮",
    status: "determined",
    role: "btn",
    box: { x: 0, y: 400, w: 80, h: 32 },
  };
  const pairs = [{
    id: "gold-a",
    kind: "gold-id",
    pages: ["p"],
    goldDocs: [classDoc(GOLD_MOBILE_PREFIX_CLASSES, [extra])],
    draftDocs: [classDoc(GOLD_MOBILE_PREFIX_CLASSES)],
  }];
  const result = runRounds(pairs, { entries: [] }, { rounds: 3 });
  assert.equal(result.stable, true);
  assert.equal(new Set(result.hashes).size, 1);
  const report = buildEvalReport({ date: "2026-08-21", rounds: 3, catalogEntries: 0, result });
  const md = renderEvalMarkdown(report);
  assert.match(md, /假绿/);
  assert.match(md, /gate-blind-spot/);
  assert.equal(fingerprintRound(result.first), result.hash);
});

test("runMachinePrechain 不改传入的 draft", () => {
  const { draft } = goldAndDraft();
  const before = JSON.stringify(draft);
  runMachinePrechain([draft], { entries: [] });
  assert.equal(JSON.stringify(draft), before);
});

test("compareById 错前缀记 wrong 而不是 miss", () => {
  const gold = {
    nodes: [{ id: "x", type: "FRAME", name: "btn/go", status: "determined", role: "btn" }],
  };
  const recovered = {
    nodes: [{ id: "x", type: "FRAME", name: "img/go", status: "determined", role: "img" }],
  };
  const diff = compareById(recovered, gold);
  assert.equal(diff.summary.wrong, 1);
  assert.equal(diff.summary.miss, 0);
  assert.equal(diff.mismatches[0].classify.kind, "wrong-prefix-not-scored");
});

test("CLI --fixture 写出 md/json 且稳定退出 0", () => {
  const extra = {
    id: "play",
    type: "FRAME",
    name: "btn/播放按钮",
    status: "determined",
    role: "btn",
    box: { x: 0, y: 400, w: 80, h: 32 },
  };
  const dir = mkdtempSync(join(tmpdir(), "prechain-eval-"));
  const fixturePath = join(dir, "fixture.json");
  writeFileSync(fixturePath, JSON.stringify({
    catalog: { entries: [] },
    pairs: [{
      id: "gold-a",
      kind: "gold-id",
      pages: ["p"],
      goldDocs: [classDoc(GOLD_MOBILE_PREFIX_CLASSES, [extra])],
      draftDocs: [classDoc(GOLD_MOBILE_PREFIX_CLASSES)],
    }],
  }));
  const outDir = join(dir, "out");
  const ran = spawnSync(process.execPath, [CLI, "--rounds", "2", "--date", "2026-08-21", "--fixture", fixturePath, "--out-dir", outDir], {
    encoding: "utf8",
  });
  try {
    assert.equal(ran.status, 0, ran.stderr + ran.stdout);
    const md = readFileSync(join(outDir, "2026-08-21-prechain-eval.md"), "utf8");
    const json = JSON.parse(readFileSync(join(outDir, "2026-08-21-prechain-eval.json"), "utf8"));
    assert.match(md, /未规范前置链路夜间评测 2026-08-21/);
    assert.equal(json.stable, true);
    assert.equal(json.rounds, 2);
    assert.equal(json.pairSummaries[0].falsePass, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
