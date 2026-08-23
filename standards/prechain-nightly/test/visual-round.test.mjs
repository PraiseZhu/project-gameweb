import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TARGET, isValidDateToken } from "../src/prechain-eval.mjs";
import { buildVisualRoundTask, VISUAL_ROUNDS, nextWave, PRIMARY_RULE } from "../src/visual-round.mjs";
import { mergeFirstWriteVerdicts } from "../src/visual-evidence.mjs";
import { applyMechanicalGaps } from "../src/visual-mechanical.mjs";
import { howToFix, collectGapRows, renderVisualLedger } from "../src/visual-ledger.mjs";
import { verifyRound } from "../scripts/verify-round.mjs";
import { scorePreparedRound } from "../scripts/score-round.mjs";
import { rebuildInventoryIndexes } from "../../figma-naming/tool/src/inventory.mjs";
import { GOLD_MOBILE_PREFIX_CLASSES } from "../../figma-naming/tool/scripts/check-draft-asset-completeness.mjs";

function writeImageReviewEvidence(round, reviews) {
  writeFileSync(join(round, "review-manifest.json"), JSON.stringify({
    schema: "visual-review-manifest/v1",
    images: reviews.map(({ image }) => ({ image })),
  }));
  writeFileSync(join(round, "image-decisions.jsonl"), `${reviews.map((row) => JSON.stringify({
    image: row.image,
    judgement: row.judgement || "已按截图和局部树判断",
    verdicts: row.verdicts || [],
    ...(row.verdicts?.length ? {} : { nonVerdictReason: "这张图没有可安全写回的前缀" }),
  })).join("\n")}\n`);
}

test("看图轮任务书必须点名硬门、看图、50 轮、不对 id 抄规范稿", () => {
  const task = buildVisualRoundTask({
    round: 3,
    rounds: VISUAL_ROUNDS,
    date: "2026-08-20",
    roundDir: "/tmp/round",
    judgePc: "/tmp/judge-pc",
    judgeMobile: "/tmp/judge-mobile",
    pcDraft: "/tmp/pc.json",
    mobileDraft: "/tmp/mobile.json",
    goldPc: "/tmp/gold-pc.json",
    goldMobile: "/tmp/gold-mobile.json",
    scoreScript: "/tmp/score-round.mjs",
    applyScript: "/tmp/apply-verdicts.mjs",
  });
  assert.match(task, /G0/);
  assert.match(task, /G1/);
  assert.match(task, /G2/);
  assert.match(task, /G3/);
  assert.match(task, /G4/);
  assert.match(task, /每次最多 Read 2 张/);
  assert.match(task, /看完一对必须立刻写回/);
  assert.match(task, /已 determined 的层不得复写/);
  assert.match(task, /send_to_lead/);
  assert.match(task, /看图/);
  assert.match(task, new RegExp(TARGET.unnamedShelf.replace(":", "\\:")));
  assert.match(task, /禁止按图层 id/);
  assert.match(task, /3\/50/);
  assert.match(task, /禁止 Read inventory/);
  assert.match(task, /PC 与 mobile 张数可以不同/);
  assert.match(task, /g2\.json/);
  assert.match(task, /seen-images\.jsonl/);
  assert.match(task, /verify-round/);
  assert.match(task, /pc\/page-a\.jpg/);
  assert.match(task, /check-draft-asset-completeness/);
});
test("共用组件集按第一次写回跟随，不因后续不同角色失败", () => {
  const { verdicts, followed } = mergeFirstWriteVerdicts([
    { image: "pc/set-06.jpg", verdicts: [{ id: "491:8353", role: "img", why: "PC 组件图是静态卡片资产" }] },
    { image: "mobile/set-06.jpg", verdicts: [{ id: "491:8353", role: "bg", why: "mobile 组件图看起来像底板" }] },
  ]);
  assert.equal(verdicts.length, 1);
  assert.equal(verdicts[0].role, "img");
  assert.deepEqual(verdicts[0].sources, ["pc/set-06.jpg"]);
  assert.equal(followed.length, 1);
  assert.equal(followed[0].incoming, "bg");
});


test("评分产物带稳定输入和评分指纹", () => {
  const doc = {
    page: { id: "p", box: { x: 0, y: 0, w: 750, h: 1000 } },
    nodes: [],
    attachments: { modals: [], componentSets: [], components: [] },
  };
  const first = scorePreparedRound({ round: 1, pcDoc: doc, mobileDoc: doc, goldPcDoc: doc, goldMobileDoc: doc, catalog: { entries: [] } });
  const second = scorePreparedRound({ round: 1, pcDoc: doc, mobileDoc: doc, goldPcDoc: doc, goldMobileDoc: doc, catalog: { entries: [] } });
  assert.match(first.inputFingerprint, /^[a-f0-9]{64}$/);
  assert.match(first.scoreFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(first.inputFingerprint, second.inputFingerprint);
  assert.equal(first.scoreFingerprint, second.scoreFingerprint);
});

test("视觉轮逐页按 newDraftGate 判定，completeness 绿但 20 个 extra 仍失败", () => {
  const inventory = (extraCount = 0) => rebuildInventoryIndexes({
    schema: "inventory/v2",
    status: "draft",
    page: { id: "p", box: { x: 0, y: 0, w: 750, h: 1000 } },
    nodes: [
      ...GOLD_MOBILE_PREFIX_CLASSES.map((role, index) => ({
        id: `base-${index}`,
        type: "FRAME",
        name: `${role}/${role}块`,
        status: "determined",
        role,
        box: { x: 0, y: index * 40, w: 80, h: 32 },
      })),
      ...Array.from({ length: extraCount }, (_, index) => ({
        id: `extra-${index}`,
        type: "FRAME",
        name: `img/额外资产-${index}`,
        status: "determined",
        role: "img",
        box: { x: 120, y: index * 40, w: 80, h: 32 },
      })),
    ],
    attachments: { modals: [], componentSets: [], components: [] },
  });
  const gold = inventory();
  const recovered = inventory(20);
  const report = scorePreparedRound({
    round: 1,
    pcDoc: recovered,
    mobileDoc: recovered,
    goldPcDoc: gold,
    goldMobileDoc: gold,
    catalog: { entries: [] },
  });
  assert.equal(report.gateOk, true);
  assert.equal(report.falsePass, false);
  assert.equal(report.pages.every((page) => page.completenessOk), true);
  assert.equal(report.pages.every((page) => page.newDraftGate.precision < 0.9), true);
  assert.equal(report.newDraftGateOk, false);
  assert.equal(report.ok, false);
});

test("视觉夜证据目录可配置且不依赖仓库 _tmp 判断包", () => {
  const src = readFileSync(new URL("../scripts/prepare-visual-night.mjs", import.meta.url), "utf8");
  assert.match(src, /evidence-dir/);
  assert.match(src, /judge-pc/);
  assert.match(src, /judge-mobile/);
  assert.doesNotMatch(src, /_tmp.*judge-491/);
});

test("apply-verdicts 按 id 写入前缀", () => {
  const dir = mkdtempSync(join(tmpdir(), "verdicts-"));
  const pc = join(dir, "pc.json");
  const mobile = join(dir, "mo.json");
  const verdicts = join(dir, "v.jsonl");
  const doc = {
    nodes: [{ id: "a", type: "FRAME", name: "播放按钮", status: "unknown" }],
  };
  writeFileSync(pc, JSON.stringify(doc));
  writeFileSync(mobile, JSON.stringify({ nodes: [{ id: "b", type: "FRAME", name: "icon", status: "unknown" }] }));
  writeFileSync(verdicts, `${JSON.stringify({ id: "a", role: "btn" })}\n${JSON.stringify({ id: "b", role: "img" })}\n`);
  const cli = fileURLToPath(new URL("../scripts/apply-verdicts.mjs", import.meta.url));
  const ran = spawnSync(process.execPath, [cli, "--pc", pc, "--mobile", mobile, "--verdicts", verdicts], { encoding: "utf8" });
  try {
    assert.equal(ran.status, 0, ran.stderr + ran.stdout);
    const out = JSON.parse(readFileSync(pc, "utf8"));
    const mobileOut = JSON.parse(readFileSync(mobile, "utf8"));
    assert.equal(out.nodes[0].name, "btn/播放按钮");
    assert.equal(out.nodes[0].role, "btn");
    assert.equal(mobileOut.nodes[0].name, "img/icon");
    assert.equal(mobileOut.nodes[0].role, "img");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("apply-verdicts 未知 id 失败且不部分写回", () => {
  const dir = mkdtempSync(join(tmpdir(), "verdicts-atomic-"));
  const pc = join(dir, "pc.json");
  const mobile = join(dir, "mo.json");
  const verdicts = join(dir, "v.jsonl");
  writeFileSync(pc, JSON.stringify({ nodes: [{ id: "a", type: "FRAME", name: "播放按钮", status: "unknown" }] }));
  writeFileSync(mobile, JSON.stringify({ nodes: [{ id: "b", type: "FRAME", name: "icon", status: "unknown" }] }));
  writeFileSync(verdicts, `${JSON.stringify({ id: "missing", role: "btn" })}
`);
  const cli = fileURLToPath(new URL("../scripts/apply-verdicts.mjs", import.meta.url));
  const ran = spawnSync(process.execPath, [cli, "--pc", pc, "--mobile", mobile, "--verdicts", verdicts], { encoding: "utf8" });
  try {
    assert.notEqual(ran.status, 0);
    assert.equal(JSON.parse(readFileSync(pc, "utf8")).nodes[0].name, "播放按钮");
    assert.equal(JSON.parse(readFileSync(mobile, "utf8")).nodes[0].name, "icon");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("apply-verdicts --skip-determined 不覆盖已 determined 层", () => {
  const dir = mkdtempSync(join(tmpdir(), "skip-determined-"));
  const pc = join(dir, "pc.json");
  const mobile = join(dir, "mo.json");
  const verdicts = join(dir, "v.jsonl");
  writeFileSync(pc, JSON.stringify({ nodes: [{ id: "a", type: "FRAME", name: "img/卡片", status: "determined", role: "img" }] }));
  writeFileSync(mobile, JSON.stringify({ nodes: [{ id: "b", type: "FRAME", name: "icon", status: "unknown" }] }));
  writeFileSync(verdicts, `${JSON.stringify({ id: "a", role: "bg" })}
${JSON.stringify({ id: "b", role: "img" })}
`);
  const cli = fileURLToPath(new URL("../scripts/apply-verdicts.mjs", import.meta.url));
  const ran = spawnSync(process.execPath, [cli, "--pc", pc, "--mobile", mobile, "--verdicts", verdicts, "--skip-determined"], { encoding: "utf8" });
  try {
    assert.equal(ran.status, 0, ran.stderr + ran.stdout);
    assert.equal(JSON.parse(readFileSync(pc, "utf8")).nodes[0].role, "img");
    assert.equal(JSON.parse(readFileSync(mobile, "utf8")).nodes[0].role, "img");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("apply-visual-pair 看完一对立刻写回，后续不同角色只跟随", () => {
  const dir = mkdtempSync(join(tmpdir(), "pair-follow-"));
  const pc = join(dir, "pc.json");
  const mobile = join(dir, "mobile.json");
  const first = join(dir, "first.json");
  const second = join(dir, "second.json");
  const doc = { page: { id: "p", box: { x: 0, y: 0, w: 10, h: 10 } }, nodes: [{ id: "491:8353", type: "FRAME", name: "卡片", status: "unknown" }], attachments: { modals: [], componentSets: [], components: [] } };
  writeFileSync(pc, JSON.stringify(doc));
  writeFileSync(mobile, JSON.stringify(doc));
  writeFileSync(join(dir, "review-manifest.json"), JSON.stringify({
    schema: "visual-review-manifest/v1",
    images: [{ image: "pc/set-06.jpg" }, { image: "mobile/set-06.jpg" }],
  }));
  writeFileSync(first, JSON.stringify({
    schema: "visual-review/v1",
    reviews: [{ image: "pc/set-06.jpg", judgement: "PC 组件图是静态卡片", verdicts: [{ id: "491:8353", role: "img", why: "截图显示静态卡片资产" }] }],
  }));
  writeFileSync(second, JSON.stringify({
    schema: "visual-review/v1",
    reviews: [{ image: "mobile/set-06.jpg", judgement: "mobile 组件图像底板", verdicts: [{ id: "491:8353", role: "bg", why: "截图显示底板" }] }],
  }));
  const cli = fileURLToPath(new URL("../scripts/apply-visual-pair.mjs", import.meta.url));
  try {
    const ran1 = spawnSync(process.execPath, [cli, "--round-dir", dir, "--review", first], { encoding: "utf8" });
    assert.equal(ran1.status, 0, ran1.stderr + ran1.stdout);
    assert.equal(JSON.parse(readFileSync(pc, "utf8")).nodes[0].role, "img");
    const ran2 = spawnSync(process.execPath, [cli, "--round-dir", dir, "--review", second], { encoding: "utf8" });
    assert.equal(ran2.status, 0, ran2.stderr + ran2.stdout);
    assert.equal(JSON.parse(readFileSync(pc, "utf8")).nodes[0].role, "img");
    const followed = readFileSync(join(dir, "followed.jsonl"), "utf8");
    assert.match(followed, /"incoming":"bg"/);
    const seen = readFileSync(join(dir, "seen-images.jsonl"), "utf8").trim().split("\n");
    assert.equal(seen.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("aggregate 拒绝 expected=0", () => {
  const dir = mkdtempSync(join(tmpdir(), "aggregate-expected-"));
  const cli = fileURLToPath(new URL("../scripts/aggregate-visual-rounds.mjs", import.meta.url));
  const ran = spawnSync(process.execPath, [cli, "--dir", dir, "--expected", "0"], { encoding: "utf8" });
  try {
    assert.equal(ran.status, 2);
    assert.match(ran.stderr, /expected.*正整数/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("worker 上限用分波，不做 50 个同时在线", () => {
  const workers = Array.from({ length: 50 }, (_, i) => ({ round: i + 1, roundDir: `r${i + 1}` }));
  const done = new Set([1, 2]);
  const wave = nextWave(workers, {
    batch: 10,
    hasResult: (row) => done.has(row.round),
  });
  assert.equal(wave.length, 10);
  assert.equal(wave[0].round, 3);
  assert.equal(wave[9].round, 12);
});

test("即使 batch 传 50，下一波仍不超过 10 个 worker", () => {
  const workers = Array.from({ length: 50 }, (_, i) => ({ round: i + 1 }));
  const wave = nextWave(workers, { batch: 50, hasResult: () => false });
  assert.equal(wave.length, 10);
});

test("已有失败 result 的轮次是终态，next 不会原地重派", () => {
  const root = mkdtempSync(join(tmpdir(), "next-terminal-"));
  const r1 = join(root, "rounds", "r01");
  const r2 = join(root, "rounds", "r02");
  mkdirSync(r1, { recursive: true });
  mkdirSync(r2, { recursive: true });
  writeFileSync(join(r1, "result.json"), JSON.stringify({ ok: false, round: 1, gateOk: false, falsePass: false, pages: [] }));
  writeFileSync(join(root, "plan.json"), JSON.stringify({
    date: "2026-08-21",
    batch: 10,
    judgePc: join(root, "missing-pc"),
    judgeMobile: join(root, "missing-mobile"),
    goldPc: join(root, "missing-gold-pc.json"),
    goldMobile: join(root, "missing-gold-mobile.json"),
    workers: [
      { label: "visual-r01", round: 1, roundDir: r1, taskFile: join(r1, "TASK.md") },
      { label: "visual-r02", round: 2, roundDir: r2, taskFile: join(r2, "TASK.md") },
    ],
  }));
  const cli = fileURLToPath(new URL("../scripts/next-visual-wave.mjs", import.meta.url));
  const ran = spawnSync(process.execPath, [cli, "--date", "2026-08-21", "--dir", root], { encoding: "utf8" });
  try {
    assert.equal(ran.status, 0, ran.stderr + ran.stdout);
    const out = JSON.parse(ran.stdout);
    assert.equal(out.pending, 1);
    assert.equal(out.unproven, 1);
    assert.deepEqual(out.workers.map((row) => row.round), [2]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("aggregate 统计未证明轮里的 false pass", () => {
  const root = mkdtempSync(join(tmpdir(), "aggregate-false-pass-"));
  const r1 = join(root, "rounds", "r01");
  mkdirSync(r1, { recursive: true });
  writeFileSync(join(r1, "result.json"), JSON.stringify({
    ok: false,
    round: 1,
    gateOk: true,
    falsePass: true,
    pages: [{ pageId: "pc", completenessOk: true, missingClasses: [], summary: { goldDetermined: 1, hit: 0, miss: 1, wrong: 0, extra: 0, scored: 1 } }],
  }));
  writeFileSync(join(root, "plan.json"), JSON.stringify({
    date: "2026-08-21",
    judgePc: join(root, "missing-pc"),
    judgeMobile: join(root, "missing-mobile"),
    goldPc: join(root, "missing-gold-pc.json"),
    goldMobile: join(root, "missing-gold-mobile.json"),
    workers: [{ label: "visual-r01", round: 1, roundDir: r1, taskFile: join(r1, "TASK.md") }],
  }));
  const cli = fileURLToPath(new URL("../scripts/aggregate-visual-rounds.mjs", import.meta.url));
  const ran = spawnSync(process.execPath, [cli, "--date", "2026-08-21", "--dir", root, "--expected", "1"], { encoding: "utf8" });
  try {
    assert.equal(ran.status, 1, ran.stderr + ran.stdout);
    const out = JSON.parse(ran.stdout);
    assert.equal(out.unproven, 1);
    assert.equal(out.falsePass, 1);
    const aggregate = JSON.parse(readFileSync(join(root, "aggregate.json"), "utf8"));
    assert.equal(aggregate.attempted, 1);
    assert.equal(aggregate.falsePass, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("只有 result.json 不能算看过图", () => {
  const dir = mkdtempSync(join(tmpdir(), "unproven-"));
  writeFileSync(join(dir, "result.json"), "{}");
  try {
    const result = verifyRound(dir, { judgePc: dir, judgeMobile: dir });
    assert.equal(result.ok, false);
    assert.match(result.problems.join("\n"), /seen-images|g2\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("g2 + 看图记录 + verdicts + catalog + result 才算证明看图", () => {
  const root = mkdtempSync(join(tmpdir(), "proven-"));
  const pc = join(root, "pc");
  const mobile = join(root, "mo");
  const round = join(root, "round");
  mkdirSync(pc);
  mkdirSync(mobile);
  mkdirSync(round);
  writeFileSync(join(pc, "page-a.jpg"), "xx");
  writeFileSync(join(pc, "set-01.jpg"), "xx");
  writeFileSync(join(pc, "summary.txt"), "set-01  1:1  x\n");
  writeFileSync(join(mobile, "page-a.jpg"), "xx");
  writeFileSync(join(mobile, "set-01.jpg"), "xx");
  writeFileSync(join(mobile, "summary.txt"), "set-01  1:1  x\n");
  const shot = [{ name: "page-a.jpg", bytes: 2, width: 1, height: 1 }];
  const set = [{ name: "set-01.jpg", bytes: 2, width: 1, height: 1 }];
  writeFileSync(join(round, "g2.json"), JSON.stringify({ pc: { pages: shot, sets: set }, mobile: { pages: shot, sets: set } }));
  writeImageReviewEvidence(round, [
    { image: "pc/page-a.jpg", verdicts: [{ id: "a", role: "btn", why: "截图显示可点操作" }] },
    { image: "pc/set-01.jpg", verdicts: [] },
    { image: "mobile/page-a.jpg", verdicts: [] },
    { image: "mobile/set-01.jpg", verdicts: [] },
  ]);
  writeFileSync(join(round, "seen-images.jsonl"), `${JSON.stringify({ turn: 1, files: ["pc/page-a.jpg", "pc/set-01.jpg"] })}\n${JSON.stringify({ turn: 2, files: ["mobile/page-a.jpg", "mobile/set-01.jpg"] })}\n`);
  writeFileSync(join(round, "verdicts.jsonl"), `${JSON.stringify({ id: "a", role: "btn", sources: ["pc/page-a.jpg"] })}\n`);
  writeFileSync(join(round, "catalog-pc.json"), JSON.stringify({ ok: true, hits: [] }));
  writeFileSync(join(round, "catalog-mobile.json"), JSON.stringify({ ok: true, hits: [] }));
  writeFileSync(join(round, "result.json"), JSON.stringify({
    ok: true,
    gateOk: true,
    newDraftGateOk: true,
    falsePass: false,
    inputFingerprint: "a".repeat(64),
    scoreFingerprint: "b".repeat(64),
    round: 1,
    pages: [
      { pageId: "pc", completenessOk: true, newDraftGate: { pass: true, recall: 1, precision: 1, completeness: "green" }, summary: { goldDetermined: 0, hit: 0, miss: 0, wrong: 0, extra: 0, scored: 0 } },
      { pageId: "mobile", completenessOk: true, newDraftGate: { pass: true, recall: 1, precision: 1, completeness: "green" }, summary: { goldDetermined: 0, hit: 0, miss: 0, wrong: 0, extra: 0, scored: 0 } },
    ],
  }));
  try {
    const result = verifyRound(round, { judgePc: pc, judgeMobile: mobile });
    assert.equal(result.ok, true, result.problems.join("\n"));
    const manifest = JSON.parse(readFileSync(join(round, "review-manifest.json"), "utf8"));
    manifest.images.pop();
    writeFileSync(join(round, "review-manifest.json"), JSON.stringify(manifest));
    const incomplete = verifyRound(round, { judgePc: pc, judgeMobile: mobile });
    assert.equal(incomplete.ok, false);
    assert.match(incomplete.problems.join("\n"), /必须覆盖且只覆盖全部判断包截图/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("g2 宽高为 0 或一轮看 3 张图不能过 verify", () => {
  const root = mkdtempSync(join(tmpdir(), "badg2-"));
  const pc = join(root, "pc");
  const round = join(root, "round");
  mkdirSync(pc);
  mkdirSync(round);
  writeFileSync(join(pc, "page-a.jpg"), "xx");
  writeFileSync(join(pc, "set-01.jpg"), "xx");
  writeFileSync(join(pc, "summary.txt"), "set-01  1:1  x\n");
  const shot = [
    { name: "page-a.jpg", bytes: 2, width: 0, height: 0 },
    { name: "page-a.jpg", bytes: 2, width: 1, height: 1 },
  ];
  const set = [{ name: "set-01.jpg", bytes: 2, width: 1, height: 1 }];
  writeFileSync(join(round, "g2.json"), JSON.stringify({ pc: { pages: shot, sets: set }, mobile: { pages: shot, sets: set } }));
  writeImageReviewEvidence(round, [
    { image: "pc/page-a.jpg", verdicts: [{ id: "a", role: "btn", why: "截图显示可点操作" }] },
    { image: "pc/set-01.jpg", verdicts: [] },
    { image: "mobile/page-a.jpg", verdicts: [] },
    { image: "mobile/set-01.jpg", verdicts: [] },
  ]);
  writeFileSync(join(round, "seen-images.jsonl"), `${JSON.stringify({ turn: 1, files: ["pc/page-a.jpg", "pc/set-01.jpg", "pc/set-01.jpg"] })}\n${JSON.stringify({ turn: 2, files: ["mobile/page-a.jpg", "mobile/set-01.jpg"] })}\n`);
  writeFileSync(join(round, "verdicts.jsonl"), `${JSON.stringify({ id: "a", role: "btn", sources: ["pc/page-a.jpg"] })}\n`);
  writeFileSync(join(round, "catalog-pc.json"), JSON.stringify({ ok: true, hits: [] }));
  writeFileSync(join(round, "catalog-mobile.json"), JSON.stringify({ ok: true, hits: [] }));
  writeFileSync(join(round, "result.json"), JSON.stringify({ ok: true, gateOk: true, falsePass: false, pages: [] }));
  try {
    const result = verifyRound(round, { judgePc: pc, judgeMobile: pc });
    assert.equal(result.ok, false);
    assert.match(result.problems.join("\n"), /宽高|1–2 张|重复|集合/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("坏 JSON 的看图证据 fail-closed 而不是抛异常", () => {
  const root = mkdtempSync(join(tmpdir(), "bad-json-"));
  for (const name of ["g2.json", "review-manifest.json", "image-decisions.jsonl", "seen-images.jsonl", "verdicts.jsonl", "catalog-pc.json", "catalog-mobile.json", "result.json"]) {
    writeFileSync(join(root, name), "{bad");
  }
  try {
    const result = verifyRound(root, { judgePc: root, judgeMobile: root });
    assert.equal(result.ok, false);
    assert.match(result.problems.join("\n"), /JSON/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("日期 token 严格限制为有效 YYYY-MM-DD", () => {
  assert.equal(isValidDateToken("2026-08-20"), true);
  assert.equal(isValidDateToken("2026-02-30"), false);
  assert.equal(isValidDateToken("../reports"), false);
});

test("机判收口：unknown 立绘/弹窗/字面 bg 要写前缀，已 determined 不覆盖", () => {
  const doc = {
    page: { id: "p", name: "mobile", box: { x: 0, y: 0, w: 750, h: 1000 } },
    nodes: [
      { id: "art", type: "FRAME", name: "立绘", status: "unknown", parentId: "role" },
      { id: "role", type: "GROUP", name: "img/角色", status: "determined", role: "img" },
      { id: "modal", type: "FRAME", name: "导航弹窗", status: "unknown" },
      { id: "bg", type: "INSTANCE", name: "bg", status: "unknown" },
      { id: "keep", type: "FRAME", name: "img/卡片", status: "determined", role: "img" },
    ],
    attachments: { modals: [], componentSets: [], components: [] },
    relations: [],
  };
  const applied = applyMechanicalGaps(doc);
  assert.equal(doc.nodes.find((n) => n.id === "art").name, "img/立绘");
  assert.equal(doc.nodes.find((n) => n.id === "modal").name, "modal/导航弹窗");
  assert.equal(doc.nodes.find((n) => n.id === "bg").role, "bg");
  assert.equal(doc.nodes.find((n) => n.id === "keep").name, "img/卡片");
  assert.ok((doc.backgrounds || []).length > 0);
});

test("任务书首要条件是原样跑手动 Skill 步骤", () => {
  const text = buildVisualRoundTask({
    round: 1,
    date: "2026-08-21",
    roundDir: "/tmp/r01",
    judgePc: "/tmp/pc",
    judgeMobile: "/tmp/mo",
    pcDraft: "/tmp/pc.json",
    mobileDraft: "/tmp/mo.json",
  });
  assert.match(PRIMARY_RULE, /严格按照手动前置流程/);
  assert.match(text, /未规范稿次日开跑/);
  assert.match(text, /catalog-pc.json/);
  assert.match(text, /completeness 必须绿|必须绿/);
  assert.match(text, /ledger.md/);
  assert.match(text, /禁止另写步骤/);
});

test("人读台账把反复缺口写成改法", () => {
  const gaps = collectGapRows([
    { pages: [{ completenessProblems: ["491:8090「立绘」是卡片视觉资产却仍为 unknown"], missingClasses: ["tab"] }] },
    { pages: [{ completenessProblems: ["I491:1;2「立绘」是卡片视觉资产却仍为 unknown"], missingClasses: ["tab"] }] },
  ]);
  const art = gaps.find((row) => /立绘/.test(row.problem));
  const tab = gaps.find((row) => /tab/.test(row.problem));
  assert.equal(art.count, 2);
  assert.equal(tab.count, 2);
  assert.match(howToFix(art.problem), /img/);
  const md = renderVisualLedger({ date: "2026-08-21", expected: 50, attempted: 2, done: 0, unproven: 2, gaps });
  assert.match(md, /人读台账/);
  assert.match(md, /头像切换外围/);
});

test("台账把嵌套立绘和标题装饰记成可改法", () => {
  const gaps = collectGapRows([
    {
      cliProblems: ["491:8562「img/立绘」父级已是 img/，内部零件不再标 img/"],
      pages: [{
        mismatches: [
          { body: "标题装饰 1", goldRole: "img", recoveredStatus: "unknown", absentFromDraft: false },
          { body: "中景", goldRole: "kv", absentFromDraft: true },
        ],
      }],
    },
  ]);
  const nested = gaps.find((row) => /父级已是 img/.test(row.problem));
  const deco = gaps.find((row) => /标题装饰/.test(row.problem));
  const absent = gaps.find((row) => /中景/.test(row.problem));
  assert.ok(nested);
  assert.match(nested.fix, /不抬二层/);
  assert.ok(deco);
  assert.match(deco.fix, /标题装饰/);
  assert.equal(absent, undefined);
});
