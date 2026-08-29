import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateVerdict, expandToGroup, toUserLabels, mergeIntoLabels, VERDICT_KEY,
} from "../src/naming/verdicts.mjs";
import { REQUIRED_LABEL_FIELDS, SAMPLE_LABELS_PATH } from "./label-fields.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("verdicts.mjs 不许依赖任何 Node API", () => {
  const source = readFileSync(path.join(projectRoot, "src/naming/verdicts.mjs"), "utf8");
  for (const pattern of [/from\s+["']node:/, /\brequire\s*\(/, /\bprocess\./, /\b__dirname\b/]) {
    assert.ok(!pattern.test(source), `verdicts.mjs 里出现了 Node 依赖：${pattern}`);
  }
});

const base = {
  nodeId: "1:2",
  kind: "correct",
  prefix: "btn",
  body: "下载",
  nodeNameAtVerdict: "图片",
  proposedName: "img/图片",
  tier: "img",
};

test("校验：三种回答之外的一律拒绝", () => {
  assert.equal(validateVerdict({ ...base, kind: "maybe" }).ok, false);
  for (const kind of ["accept", "correct", "skip"]) {
    assert.equal(validateVerdict({ ...base, kind }).ok, true, `${kind} 该被接受`);
  }
});

test("校验：不许发明规范总表以外的前缀", () => {
  const bad = validateVerdict({ ...base, prefix: "card" });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /\d+ 个前缀/);
});

/**
 * 打裁决时那层叫什么，必须记下来。
 *
 * 这个项目栽过：过期标签落回判据，人已经推翻过的错名字自己回来了，
 * 还进了「可直接改」那一档。没有这个字段就没法判断稿子改过之后
 * 这条裁决还适不适用。
 */
test("校验：必须记下打裁决时那层的名字", () => {
  const missing = { ...base };
  delete missing.nodeNameAtVerdict;
  const result = validateVerdict(missing);
  assert.equal(result.ok, false);
  assert.match(result.reason, /nodeNameAtVerdict/);
});

/**
 * 面板上人对着一组点一次，要落到组里每一层。
 * 否则下次跑起来，同组的其它层又会重新问一遍——人会以为答案没被记住。
 */
test("一组一起答：裁决展开到组里每一层", () => {
  const { verdict } = validateVerdict(base);
  const expanded = expandToGroup(verdict, ["1:2", "1:3", "1:4"]);
  assert.equal(expanded.length, 3);
  assert.deepEqual(expanded.map((v) => v.nodeId), ["1:2", "1:3", "1:4"]);
  assert.equal(expanded[1].prefix, "btn", "组里每一层拿到同一个裁决");

  const single = expandToGroup(verdict, []);
  assert.deepEqual(single.map((v) => v.nodeId), ["1:2"], "没给组就只落自己那一层");
});

/**
 * 只有 correct 进标签库。
 *
 * accept 说明判据本来就对，写进去没有信息量，还会让标签库膨胀到
 * 看不出哪些是真正的人工干预；skip 是「还没定」，更不该写。
 */
/**
 * 面板上 7 个按钮，底层 3 种 kind，一共 4 种含义——每一种都要落下来。
 *
 * 用户 2026-08-11 两次指出我漏了东西：先是判完 37 条「这层不用命名」发现
 * 一条都没导出，然后是「裁决有很多个选项，你就只包括这两个？」。
 * 人点过的每一下都是判断，丢掉哪一种，那部分工作就白做了。
 */
test("导出：四种回答全部落下来，各自一个 kind", () => {
  const verdicts = [
    validateVerdict({ ...base, nodeId: "a", kind: "correct" }).verdict,
    // 判据给了名字时点「对」=「对，就叫 img/图片」
    validateVerdict({ ...base, nodeId: "b", kind: "accept" }).verdict,
    validateVerdict({ ...base, nodeId: "c", kind: "skip" }).verdict,
    // 判据没给名字时点的是「这层不用命名」
    validateVerdict({ ...base, nodeId: "d", kind: "accept", proposedName: null }).verdict,
  ];
  const labels = toUserLabels(verdicts, { pageName: "火炬页", sectionId: "273:27182" });
  assert.equal(labels.length, 4, "四种回答一条都不能丢");

  const byId = new Map(labels.map((l) => [l.nodeId, l]));

  const rename = byId.get("a");
  assert.equal(rename.kind, "rename");
  assert.equal(rename.prefix, "btn");
  assert.equal(rename.nodeNameAtLabelTime, "图片", "要带上打裁决时的名字");
  assert.ok(rename.why.includes("img"), "why 要说清判据当时走的哪一档、给了什么");

  // 人确认判据对：名字要存下来。判据以后改坏了，这条能说明
  // 「这层人确认过就叫这个」。
  const ok = byId.get("b");
  assert.equal(ok.kind, "confirmed-ok");
  assert.equal(ok.prefix, "img");
  assert.equal(ok.body, "图片", "确认过的名字要完整存下来，不能只记一个「对」");

  // 「现在定不了」也是看过了。不记的话下次还问同一层，
  // 人会以为自己那一下没点上。
  const undecided = byId.get("c");
  assert.equal(undecided.kind, "undecided");
  assert.equal(undecided.prefix, null);

  const noPrefix = byId.get("d");
  assert.equal(noPrefix.kind, "no-prefix");
  assert.equal(noPrefix.prefix, null);
});

/**
 * 同一层被判过两次，第二次是人改主意了。
 * 留着旧的会让「哪条生效」变成看数组顺序的运气。
 */
test("合并：同一层的新裁决覆盖旧的", () => {
  const existing = [
    { nodeId: "a", prefix: "img", body: "旧" },
    { nodeId: "z", prefix: "sec", body: "别的层" },
  ];
  const incoming = [{ nodeId: "a", prefix: "btn", body: "新" }];
  const { labels, added, replaced } = mergeIntoLabels(existing, incoming);
  assert.equal(labels.length, 2, "覆盖不是追加");
  assert.equal(added, 0);
  assert.equal(replaced, 1);
  assert.equal(labels.find((l) => l.nodeId === "a").body, "新");
  assert.equal(labels.find((l) => l.nodeId === "z").body, "别的层", "别人的记录不能动");
});

/**
 * 导出的标签格式必须能被标签库直接吃下。原来这条比对的是私有真账本
 * data/user-labels.json，公开仓没有那个文件；现在比对随仓的合成示例
 * examples/user-labels.sample.json——它的字段形状与真账本一致，
 * 由 test-private/naming-verdicts-real-labels.test.mjs 逐字段守住不漂移。
 *
 * 这条测试的危险方向是**判定变宽**：示例文件被改瘦（某个 kind 少几个字段）之后，
 * `for (key of Object.keys(sample))` 这个循环会自然而然地少查几格，测试照样全绿，
 * 而 toUserLabels 真的漏了字段也查不出来。所以先用 REQUIRED_LABEL_FIELDS
 * （test/label-fields.mjs 里的显式清单）把「示例必须有哪些字段」钉住，
 * 示例被改瘦时这一格先红。
 */
test("随仓示例标签涵盖全部 kind，且每个 kind 的字段一个不少", () => {
  const doc = JSON.parse(readFileSync(SAMPLE_LABELS_PATH, "utf8"));
  assert.equal(doc.version, 1);
  assert.deepEqual(
    [...new Set(doc.labels.map((l) => l.kind))].sort(),
    Object.keys(REQUIRED_LABEL_FIELDS).sort(),
    "示例必须每种 kind 都有一条——少一种，下面按 kind 取样的断言就会静默少查一格",
  );
  for (const [kind, fields] of Object.entries(REQUIRED_LABEL_FIELDS)) {
    for (const label of doc.labels.filter((l) => l.kind === kind)) {
      assert.deepEqual(
        Object.keys(label).filter((key) => fields.includes(key)).sort(),
        [...fields].sort(),
        `示例里 ${kind} 这条少字段——示例被改瘦会让字段比对静默少查`,
      );
    }
  }
  /* 示例必须一眼看得出是示例：漏掉这个标记，有人会把它当成真账本提交上去。 */
  assert.ok(typeof doc.__sample__ === "string" && doc.__sample__.length > 0,
    "示例文件要带 __sample__ 说明，让人一眼看出不是真裁决");
});

test("导出的标签格式能被现有标签库直接吃下", () => {
  const existing = JSON.parse(readFileSync(SAMPLE_LABELS_PATH, "utf8"));
  const sample = existing.labels.find((l) => l.kind === "rename");
  const { verdict } = validateVerdict(base);
  const [generated] = toUserLabels([verdict], { pageName: "火炬页", sectionId: "273:27182" });

  // 逐字段比对：生成的标签必须和库里现有的 rename 标签字段一致，
  // 少一个字段将来读取时就是 undefined，静默走错分支。
  for (const key of Object.keys(sample)) {
    assert.ok(key in generated, `导出的标签缺字段 ${key}——现有标签库里有这个字段`);
  }
});

/**
 * 另外三档导出（confirmed-ok / no-prefix / undecided）也要逐字段查。
 *
 * 原来只查 rename 一档。那一档恰好是 toUserLabels 里字段拼得最全的一条，
 * 另外三档走的是 common() 那条路——common() 少一个字段，rename 这档因为自己
 * 又铺了一遍全部字段所以照样过，三档却全漏。这正是「fixture 缺判别性用例」
 * 那一族问题：断言写得再狠，没有能显示差别的那一格就抓不到。
 */
test("导出的其余三档标签字段也一个不少", () => {
  const cases = [
    { kind: "confirmed-ok", verdict: { ...base, kind: "accept", proposedName: "img/bg" } },
    { kind: "no-prefix", verdict: { ...base, kind: "accept", proposedName: null } },
    { kind: "undecided", verdict: { ...base, kind: "skip" } },
  ];
  for (const { kind, verdict: input } of cases) {
    const { verdict, error } = validateVerdict(input);
    assert.equal(error, undefined, `${kind} 的输入裁决本身应合法：${error}`);
    const [generated] = toUserLabels([verdict], { pageName: "火炬页", sectionId: "273:27182" });
    assert.equal(generated.kind, kind);
    for (const key of REQUIRED_LABEL_FIELDS[kind]) {
      assert.ok(key in generated, `${kind} 导出缺字段 ${key}`);
    }
  }
});

test("VERDICT_KEY 是稳定的字符串常量", () => {
  // pluginData 的 key 改了，之前存进稿子的裁决就全读不出来了。
  assert.equal(VERDICT_KEY, "naming:verdict");
});

/**
 * 「这层不用命名」这个标签必须真的让下次不再问。
 *
 * 导出只是链路的一半：标签写回去之后判据要认它。不认的话，人判过的层
 * 下次照样冒出来——用户 2026-08-11 判了 37 条，如果只修导出不修这里，
 * 他重跑一次会看到同样的 37 条。
 */
test("带 no-prefix 标签的层不再出条目", async () => {
  const { computeNamingPlan } = await import("../src/naming/walk.mjs");
  const box = (x, y, w, h) => ({ x, y, width: w, height: h });
  const node = (props) => ({ visible: true, children: [], ...props });
  const target = node({
    id: "n1", name: "轮播点", type: "RECTANGLE",
    absoluteBoundingBox: box(10, 100, 44, 44),
    fills: [{ type: "SOLID", visible: true }],
  });
  const section = node({
    id: "sec", name: "首页", type: "FRAME", absoluteBoundingBox: box(0, 0, 1000, 3000),
    children: [
      node({ id: "t", name: "标题", type: "TEXT", characters: "首页", absoluteBoundingBox: box(10, 0, 200, 40) }),
      target,
    ],
  });

  const run = (userConfirmed) => {
    const { report } = computeNamingPlan(section, {
      sectionId: "sec", sectionName: "首页", sectionBase: "首页",
      userConfirmed, userNeedsRegroup: {}, componentRoles: new Map(), totalLabelCount: 0,
    });
    const byId = new Map();
    for (const g of [...report.confirmedGroups, ...report.needsRecheckGroups, ...(report.unknownGroups ?? [])]) {
      for (const e of g.entries) byId.set(e.nodeId, e);
    }
    return byId;
  };

  assert.ok(run({}).has("n1"), "没标签时这层会出条目（前提条件）");

  const label = {
    n1: {
      kind: "no-prefix", nodeNameAtLabelTime: "轮播点",
      confirmedBy: "user", date: "2026-08-11",
    },
  };
  const entry = run(label).get("n1");
  assert.equal(entry, undefined, "人说过「这层不用命名」之后不该再出任何条目");

  // 不能只断言「没有条目」：去掉 walk 里那条守卫时，这层会掉进
  // 「标签自检未通过」那条路（no-prefix 没有 prefix，拼出 undefined/undefined
  // 被 nameValid 挡下），照样没有条目——结果碰巧对，走的却是错误路径，
  // 面板上会显示成「你的标签有问题」而不是「已确认不用命名」。
  // 所以还要断言它进的是 textContainer 桶，而不是 unknown。
  const { report } = computeNamingPlan(section, {
    sectionId: "sec", sectionName: "首页", sectionBase: "首页",
    userConfirmed: label, userNeedsRegroup: {}, componentRoles: new Map(), totalLabelCount: 0,
  });
  assert.equal(
    report.accounting.unknown, 0,
    "「不用命名」不该被当成标签自检失败——那会在面板上显示成标签有问题",
  );
});

/**
 * 导出只是链路的一半，四种标签都要在 walk 里真的起作用。
 *
 * 只修导出不修这里，人判过的层下次照样冒出来，他会以为自己白判了。
 */
test("四种裁决标签在判定时各自生效", async () => {
  const { computeNamingPlan } = await import("../src/naming/walk.mjs");
  const box = (x, y, w, h) => ({ x, y, width: w, height: h });
  const node = (props) => ({ visible: true, children: [], ...props });

  const runWith = (label) => {
    const target = node({
      id: "n1", name: "轮播点", type: "RECTANGLE",
      absoluteBoundingBox: box(10, 100, 44, 44),
      fills: [{ type: "SOLID", visible: true }],
    });
    const section = node({
      id: "sec", name: "首页", type: "FRAME", absoluteBoundingBox: box(0, 0, 1000, 3000),
      children: [
        node({ id: "t", name: "标题", type: "TEXT", characters: "首页", absoluteBoundingBox: box(10, 0, 200, 40) }),
        target,
      ],
    });
    const { report } = computeNamingPlan(section, {
      sectionId: "sec", sectionName: "首页", sectionBase: "首页",
      userConfirmed: label ? { n1: label } : {},
      userNeedsRegroup: {}, componentRoles: new Map(), totalLabelCount: 0,
    });
    for (const g of [...report.confirmedGroups, ...report.needsRecheckGroups]) {
      for (const e of g.entries) if (e.nodeId === "n1") return e;
    }
    return null;
  };

  const stamp = { nodeNameAtLabelTime: "轮播点", confirmedBy: "user", date: "2026-08-11" };

  // rename：用人给的名字，进「可直接改」
  const renamed = runWith({ ...stamp, kind: "rename", prefix: "ind", body: "进度条" });
  assert.equal(renamed?.newName, "ind/进度条");
  assert.equal(renamed?.disposition, "confirmed");

  // confirmed-ok：人确认过判据给的名字，同样直接用，不再问
  const okd = runWith({ ...stamp, kind: "confirmed-ok", prefix: "img", body: "轮播点" });
  assert.equal(okd?.newName, "img/轮播点", "人确认过的名字要能直接用，不该再问一遍");
  assert.equal(okd?.disposition, "confirmed");

  // undecided：还是要问，但得让人看见「你上次也没定」，
  // 否则他会以为自己那一下没点上、或者以为判据没记住。
  const undecided = runWith({ ...stamp, kind: "undecided" });
  assert.equal(undecided?.disposition, "needsRecheck");
  assert.equal(undecided?.tier, "previouslyUndecided");
  assert.match(undecided?.evidence ?? "", /上次|2026-08-11/, "要说明这层上次已经看过");

  // no-prefix：不出条目
  assert.equal(runWith({ ...stamp, kind: "no-prefix" }), null);
});
