import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveProposals, extractTier, renderReport, THRESHOLDS, main, PROJECT_ROOT }
  from "../scripts/derive-proposals.mjs";

/**
 * 全部用合成 fixture，**不读真账本** —— data/user-labels.json 是私有的，
 * 公开仓里没有它，接进 npm test 会让 clone 下来的仓库直接挂掉。
 *
 * fixture 的判别性都写在各自的注释里。一句总纲：危险方向永远是**判定变宽**
 * （`>=2` 松成 `>=1`、两条阈值的 `&&` 松成 `||`、无法归类的静默丢弃）。
 * 每个用例都得能显示出「实现朝那个方向错」和「实现对」的差别。
 */

const label = (over = {}) => ({
  nodeId: "9000:1",
  kind: "no-prefix",
  nodeNameAtLabelTime: "某层",
  prefix: "",
  body: "",
  confirmedBy: "user",
  date: "2026-01-01",
  note: "合成",
  why: "判据走的是 functionWord 档、拿不准，人看过之后说这层不该有前缀。",
  pageName: "稿A",
  sectionId: "9000:0",
  ...over,
});

const why = (tier) => `判据走的是 ${tier} 档，给出「x/y」，与人的判断不一致。`;
const tierOf = (result, tier) =>
  [...result.proposals, ...result.watching].find((p) => p.tier === tier) ?? null;

/* ------------------------------------------------------------------ *
 * 1. 达标：2 份稿 + 3 个不同图层名
 * ------------------------------------------------------------------ */

test("达标模式：2 份稿 + 3 个不同图层名 → 产出提案", () => {
  const labels = [
    label({ nodeId: "1:1", why: why("btn"), pageName: "稿A", nodeNameAtLabelTime: "箭头左" }),
    label({ nodeId: "1:2", why: why("btn"), pageName: "稿A", nodeNameAtLabelTime: "箭头右" }),
    label({ nodeId: "1:3", why: why("btn"), pageName: "稿B", nodeNameAtLabelTime: "关闭叉" }),
  ];
  const result = deriveProposals(labels);

  assert.equal(result.proposals.length, 1);
  const p = result.proposals[0];
  assert.equal(p.tier, "btn");
  assert.equal(p.wrongCount, 3);
  assert.equal(p.pageCount, 2);
  assert.equal(p.layerNameCount, 3);
  assert.equal(p.qualifies, true);
  assert.deepEqual(p.shortfall, []);
  assert.equal(result.watching.length, 0);

  const report = renderReport(result);
  assert.match(report, /### `btn` 档/);
  assert.doesNotMatch(report, /\*\*0 条。\*\*/);
  // 提案必须带上「够格原因」，否则人没法复核这条为什么被推上来。
  assert.match(report, /够格原因：稿数 2 ≥ 2 且图层名数 3 ≥ 3/);
});

/* ------------------------------------------------------------------ *
 * 2. 差一点：2 份稿但只有 2 个图层名
 *
 * 判别性：这一格专抓「两条阈值的 && 被松成 ||」。稿数已达标，只有图层名数不足；
 * 若实现改成 ||，这条会错误地产出提案。
 * ------------------------------------------------------------------ */

test("2 份稿但只有 2 个图层名 → 不产出，观察中并说明差 1 个图层名", () => {
  const labels = [
    label({ nodeId: "2:1", why: why("img"), pageName: "稿A", nodeNameAtLabelTime: "图1" }),
    label({ nodeId: "2:2", why: why("img"), pageName: "稿B", nodeNameAtLabelTime: "图2" }),
    label({ nodeId: "2:3", why: why("img"), pageName: "稿B", nodeNameAtLabelTime: "图2" }),
  ];
  const result = deriveProposals(labels);

  assert.equal(result.proposals.length, 0);
  assert.equal(result.watching.length, 1);
  const p = result.watching[0];
  assert.equal(p.pageCount, 2);
  assert.equal(p.layerNameCount, 2);
  assert.equal(p.qualifies, false);
  assert.equal(p.shortfall.length, 1);
  assert.match(p.shortfall[0], /差 1 个不同图层名（现 2，需 3）/);
  // 稿数已达标就不该再报缺稿。
  assert.ok(!p.shortfall.some((s) => s.includes("份稿")));

  assert.match(renderReport(result), /差 1 个不同图层名/);
});

/* ------------------------------------------------------------------ *
 * 3. 差一点：3 个图层名但只有 1 份稿
 *
 * 判别性：与用例 2 互为镜像，专抓 minPages 被松成 1（或 && → ||）。
 * ------------------------------------------------------------------ */

test("3 个图层名但只有 1 份稿 → 不产出，观察中并说明差 1 份稿", () => {
  const labels = [
    label({ nodeId: "3:1", why: why("staleLabel"), pageName: "稿A", nodeNameAtLabelTime: "点1" }),
    label({ nodeId: "3:2", why: why("staleLabel"), pageName: "稿A", nodeNameAtLabelTime: "点2" }),
    label({ nodeId: "3:3", why: why("staleLabel"), pageName: "稿A", nodeNameAtLabelTime: "点3" }),
    label({ nodeId: "3:4", why: why("staleLabel"), pageName: "稿A", nodeNameAtLabelTime: "点4" }),
  ];
  const result = deriveProposals(labels);

  assert.equal(result.proposals.length, 0);
  assert.equal(result.watching.length, 1);
  const p = result.watching[0];
  assert.equal(p.pageCount, 1);
  assert.equal(p.layerNameCount, 4);
  assert.equal(p.shortfall.length, 1);
  assert.match(p.shortfall[0], /差 1 份稿（现 1，需 2）/);
  assert.ok(!p.shortfall.some((s) => s.includes("图层名")));
});

/* ------------------------------------------------------------------ *
 * 4. 同名实例灌水（必须有的判别性用例）
 *
 * 真账本里 37 条 functionWord 就是这个形状：1 份稿 + 图层名几乎全是「轮播点」。
 * 按条数算，它会是最先被推上去的那条——而它只是同一处问题的 20 个副本。
 * 这一格同时抓两种变宽：任何「条数 ≥ N 就够格」的实现，和 minPages 松到 1。
 * ------------------------------------------------------------------ */

test("同名实例灌水：1 份稿 + 20 条同名 → 不产出提案", () => {
  const labels = Array.from({ length: 20 }, (_, i) =>
    label({ nodeId: `4:${i}`, why: why("functionWord"), pageName: "稿A", nodeNameAtLabelTime: "轮播点" }));
  const result = deriveProposals(labels);

  assert.equal(result.proposals.length, 0);
  const p = tierOf(result, "functionWord");
  // 条数很大，但两个去重维度都只有 1 —— 「条数多」不构成够格。
  assert.equal(p.wrongCount, 20);
  assert.equal(p.pageCount, 1);
  assert.equal(p.layerNameCount, 1);
  assert.equal(p.qualifies, false);
  assert.equal(p.shortfall.length, 2);

  const report = renderReport(result);
  assert.match(report, /\*\*0 条。\*\*/);
});

test("同名灌水加一份稿仍不够：稿达标但图层名只有 1 个", () => {
  // 20 条同名分散到两份稿：稿数够了，图层名维度仍然只有 1。
  // 少了这一格，「去掉图层名维度、只看稿数」的变宽会全绿通过。
  const labels = Array.from({ length: 20 }, (_, i) =>
    label({
      nodeId: `5:${i}`, why: why("functionWord"),
      pageName: i % 2 ? "稿A" : "稿B", nodeNameAtLabelTime: "轮播点",
    }));
  const result = deriveProposals(labels);

  assert.equal(result.proposals.length, 0);
  const p = tierOf(result, "functionWord");
  assert.equal(p.pageCount, 2);
  assert.equal(p.layerNameCount, 1);
  assert.equal(p.shortfall.length, 1);
  assert.match(p.shortfall[0], /差 2 个不同图层名/);
});

/* ------------------------------------------------------------------ *
 * 5. 无档位信息 → 计入「无法归类」而非静默丢弃
 * ------------------------------------------------------------------ */

test("why 里没有档位短语 → 计入无法归类并按 kind 列出，不静默丢弃", () => {
  const labels = [
    label({ nodeId: "6:1", kind: "rename", why: "人当面确认可点击；此前被判成装饰图。" }),
    label({ nodeId: "6:2", kind: "rename", why: "同上，人直接给的名字。" }),
    label({ nodeId: "6:3", kind: "no-prefix", why: "这层就是背景，人说不该有前缀。" }),
  ];
  const result = deriveProposals(labels);

  assert.equal(result.unclassified.total, 3);
  assert.equal(result.unclassified.noTierPhrase.total, 3);
  assert.deepEqual(result.unclassified.noTierPhrase.byKind, { rename: 2, "no-prefix": 1 });
  assert.equal(result.unclassified.unknownTier.total, 0);
  // 归不到档位 → 不进任何模式，但账面上必须找得到它们。
  assert.equal(result.proposals.length, 0);
  assert.equal(result.watching.length, 0);
  assert.equal(Object.keys(result.correctness).length, 0);

  const report = renderReport(result);
  assert.match(report, /共 3 条/);
  assert.match(report, /缺档位信息：3 条/);
  assert.match(report, /- rename：2 条/);
});

/* ------------------------------------------------------------------ *
 * 6. (未知档) 的原文 → 「档位未知」，不造假档位名
 *
 * 判别性：原文是「判据走的是 (未知档) 档，」。惰性匹配到第一个「档」会切出
 * `(未知` 并当成档位名。这里同时钉住：不出现 `(未知` 这个档位，且它进的是
 * unknownTier 而不是 noTierPhrase（后者含义不同——那是「压根没走判据」）。
 * ------------------------------------------------------------------ */

test("(未知档) 原文 → 归为档位未知，不造出叫 `(未知` 的假档位", () => {
  const labels = [
    label({ nodeId: "7:1", kind: "no-prefix", why: "判据走的是 (未知档) 档、拿不准，人看过之后说这层不该有前缀。" }),
    label({ nodeId: "7:2", kind: "rename", why: "人在插件面板上直接裁决。判据走的是 (未知档) 档，给出「(无名)」，与人的判断不一致。" }),
  ];
  const result = deriveProposals(labels);

  assert.equal(result.unclassified.unknownTier.total, 2);
  assert.deepEqual(result.unclassified.unknownTier.byKind, { "no-prefix": 1, rename: 1 });
  assert.deepEqual(result.unclassified.unknownTier.rawPhrases, { "(未知档)": 2 });
  assert.equal(result.unclassified.noTierPhrase.total, 0);

  const fakeTiers = [...result.proposals, ...result.watching].map((p) => p.tier)
    .concat(Object.keys(result.correctness));
  assert.deepEqual(fakeTiers, []);
  assert.ok(!Object.keys(result.correctness).some((t) => t.includes("未知")));

  // extractTier 单测：两层防线各自钉一格。
  assert.deepEqual(extractTier("判据走的是 (未知档) 档，给出「x」。"), { status: "unknown-tier", raw: "(未知档)" });
  assert.deepEqual(extractTier("判据走的是 functionWord 档、拿不准。"), { status: "ok", tier: "functionWord" });
  assert.deepEqual(extractTier("人直接判的。"), { status: "no-phrase" });
  // 非标识符的其它花样也不许变成档位名（第 2 层防线；换个措辞就能绕过第 1 层）。
  assert.equal(extractTier("判据走的是 不知道哪一 档，给出「x」。").status, "unknown-tier");
});

/* ------------------------------------------------------------------ *
 * 7. confirmed-ok 计入判对，不计入判错
 *
 * 判别性：同一档位同时给判对和判错，且**两个数不同**（判对 4 / 判错 2）。
 * 数相同的话，「把 confirmed-ok 也算成判错」的变宽显示不出差别。
 * 判对不参与阈值：这里判对有 3 份稿 3 个名字、判错只有 1 份稿 1 个名字，
 * 若阈值误用了合并集合就会错误产出提案。
 * ------------------------------------------------------------------ */

test("confirmed-ok 计入判对统计，不计入判错，也不参与阈值", () => {
  const labels = [
    label({ nodeId: "8:1", kind: "confirmed-ok", why: why("img"), pageName: "稿A", nodeNameAtLabelTime: "图a" }),
    label({ nodeId: "8:2", kind: "confirmed-ok", why: why("img"), pageName: "稿B", nodeNameAtLabelTime: "图b" }),
    label({ nodeId: "8:3", kind: "confirmed-ok", why: why("img"), pageName: "稿C", nodeNameAtLabelTime: "图c" }),
    label({ nodeId: "8:4", kind: "confirmed-ok", why: why("img"), pageName: "稿C", nodeNameAtLabelTime: "图d" }),
    label({ nodeId: "8:5", kind: "rename", why: why("img"), pageName: "稿A", nodeNameAtLabelTime: "日历icon" }),
    label({ nodeId: "8:6", kind: "rename", why: why("img"), pageName: "稿A", nodeNameAtLabelTime: "日历icon" }),
  ];
  const result = deriveProposals(labels);

  assert.deepEqual(result.correctness, { img: { wrong: 2, right: 4, total: 6 } });
  assert.equal(result.proposals.length, 0);
  const p = tierOf(result, "img");
  assert.equal(p.wrongCount, 2);
  assert.equal(p.rightCount, 4);
  // 阈值只看判错那批：判错是 1 份稿 1 个名字。
  assert.equal(p.pageCount, 1);
  assert.equal(p.layerNameCount, 1);
  assert.deepEqual(p.byKind, { rename: 2 });
});

test("只有 confirmed-ok 的档位不产出模式，但仍进正确性统计", () => {
  const labels = [
    label({ nodeId: "9:1", kind: "confirmed-ok", why: why("bg"), pageName: "稿A", nodeNameAtLabelTime: "bg1" }),
    label({ nodeId: "9:2", kind: "confirmed-ok", why: why("bg"), pageName: "稿B", nodeNameAtLabelTime: "bg2" }),
    label({ nodeId: "9:3", kind: "confirmed-ok", why: why("bg"), pageName: "稿C", nodeNameAtLabelTime: "bg3" }),
  ];
  const result = deriveProposals(labels);
  assert.equal(result.proposals.length, 0);
  assert.equal(result.watching.length, 0);
  assert.deepEqual(result.correctness, { bg: { wrong: 0, right: 3, total: 3 } });
});

/* ------------------------------------------------------------------ *
 * 8. 不进归纳的三类 kind
 * ------------------------------------------------------------------ */

test("needs-regroup / component-role / undecided 不进归纳，但条数要列出来", () => {
  const labels = [
    label({ nodeId: "a:1", kind: "needs-regroup", why: why("btn"), pageName: "稿A", nodeNameAtLabelTime: "组1" }),
    label({ nodeId: "a:2", kind: "component-role", why: why("btn"), pageName: "稿B", nodeNameAtLabelTime: "组2" }),
    label({ nodeId: "a:3", kind: "undecided", why: why("btn"), pageName: "稿C", nodeNameAtLabelTime: "组3" }),
  ];
  const result = deriveProposals(labels);

  // 三条都带合法档位、跨 3 份稿 3 个名字：若误把它们当判错证据就会产出提案。
  assert.equal(result.proposals.length, 0);
  assert.equal(result.watching.length, 0);
  assert.deepEqual(result.correctness, {});
  assert.equal(result.excludedKinds["needs-regroup"].count, 1);
  assert.equal(result.excludedKinds["component-role"].count, 1);
  assert.equal(result.excludedKinds.undecided.count, 1);
  for (const info of Object.values(result.excludedKinds)) {
    assert.ok(info.reason && info.reason.length > 0, "每个被排除的 kind 都要写明为什么");
  }

  const report = renderReport(result);
  assert.match(report, /\| needs-regroup \| 1 \|/);
  assert.match(report, /\| undecided \| 1 \|/);
});

test("未知 kind 显式报出，不当成 excluded 静默吞掉", () => {
  const result = deriveProposals([label({ nodeId: "b:1", kind: "made-up-kind" })]);
  assert.deepEqual(result.unknownKinds, [{ nodeId: "b:1", kind: "made-up-kind" }]);
  assert.match(renderReport(result), /⚠ 未知 kind/);
});

/* ------------------------------------------------------------------ *
 * 9. 阈值常量与 CLI
 * ------------------------------------------------------------------ */

test("阈值就是 2 份稿 / 3 个图层名", () => {
  assert.deepEqual({ ...THRESHOLDS }, { minPages: 2, minLayerNames: 3 });
});

test("CLI：--json / --out / 拒绝写入 data/", () => {
  const dir = mkdtempSync(join(tmpdir(), "derive-proposals-"));
  try {
    const ledgerPath = join(dir, "labels.json");
    writeFileSync(ledgerPath, JSON.stringify({
      version: 1,
      labels: [
        label({ nodeId: "c:1", why: why("btn"), pageName: "稿A", nodeNameAtLabelTime: "n1" }),
        label({ nodeId: "c:2", why: why("btn"), pageName: "稿B", nodeNameAtLabelTime: "n2" }),
        label({ nodeId: "c:3", why: why("btn"), pageName: "稿B", nodeNameAtLabelTime: "n3" }),
      ],
    }), "utf8");

    const asJson = main(["--json", "--labels", ledgerPath], { cwd: dir });
    const parsed = JSON.parse(asJson.stdout);
    assert.equal(parsed.proposals.length, 1);
    assert.equal(parsed.source.labelCount, 3);
    assert.equal(parsed.thresholds.minPages, 2);

    const outPath = join(dir, "out", "proposals.md");
    const written = main(["--labels", ledgerPath, "--out", outPath], { cwd: dir });
    assert.equal(written.code, 0);
    assert.match(readFileSync(outPath, "utf8"), /### `btn` 档/);

    // data/ 是账本目录（事实来源，只读），提案产物不许落在那里。
    // cwd 显式钉成 PROJECT_ROOT：不依赖跑测试时人在哪个目录。
    // 除了「抛错」还断言「文件没被建出来」——只断言抛错的话，一个「先写再校验」
    // 的实现照样能全绿，而它已经污染了账本目录。
    const guarded = [
      join(PROJECT_ROOT, "data/proposals.md"),
      join(PROJECT_ROOT, "data/sub/x.md"),
    ];
    try {
      assert.throws(
        () => main(["--labels", ledgerPath, "--out", "data/proposals.md"], { cwd: PROJECT_ROOT }),
        /拒绝写入 data\//,
      );
      assert.throws(
        () => main(["--labels", ledgerPath, "--out", guarded[1]], { cwd: dir }),
        /拒绝写入 data\//,
      );
      for (const path of guarded) assert.ok(!existsSync(path), `不许在账本目录建出 ${path}`);
    } finally {
      // 变异测试把守卫改坏时会真的落盘，这里兜底清掉，别把碎片留在账本目录。
      rmSync(join(PROJECT_ROOT, "data/proposals.md"), { force: true });
      rmSync(join(PROJECT_ROOT, "data/sub"), { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("脚本不写 spec/：提案只是证据，规范修订由人拍板", () => {
  const source = readFileSync(new URL("../scripts/derive-proposals.mjs", import.meta.url), "utf8");
  assert.ok(!/writeFileSync\([^)]*spec/.test(source));
  assert.ok(!/["'`][^"'`]*spec\/naming-spec\.md/.test(source.replace(/^\s*\*.*$/gm, "")));
});
