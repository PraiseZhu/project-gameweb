import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attachNodeInfo, buildNodeInfoMap, clearAnnotations, drawAnnotations,
  layoutAnnotations, measureTextLines, metrics, selectAnnotations,
} from "../plugin/annotate.mjs";
import { lint } from "../src/lint.mjs";
import { fakeAnnotationRoot, fakeFigma } from "./fake-figma.mjs";
import { cleanTree, dirtyTree } from "./fixtures.mjs";

const BOX = (y = 0, x = 10) => ({ x, y, width: 100, height: 40 });
const ROOT_BOX = { x: 0, y: 0, width: 1000, height: 1000 };

const finding = (nodeId, code, disposition, overrides = {}) => ({
  nodeId,
  code,
  disposition,
  name: `图层 ${nodeId}`,
  type: "RECTANGLE",
  path: `pc / ${nodeId}`,
  absoluteBoundingBox: BOX(),
  visible: true,
  ancestorHidden: false,
  ...overrides,
});

test("selectAnnotations：boxes.length 等于该档中有 bounds 的不同节点数，skipped 都有原因", () => {
  const findings = [
    finding("a", "N-A", "must_fix"),
    finding("b", "N-B", "must_fix"),
    finding("c", "N-C", "must_fix", { absoluteBoundingBox: null }),
    finding("d", "N-D", "must_fix", { absoluteBoundingBox: { x: 0, y: 0, width: 0, height: 40 } }),
  ];
  const plan = selectAnnotations(findings, { disposition: "must_fix", rootBox: ROOT_BOX });
  assert.equal(plan.boxes.length, 2);
  assert.equal(plan.skipped.length, 2);
  assert.ok(plan.skipped.every((s) => typeof s.reason === "string" && s.reason.length > 0));
  assert.ok(plan.skipped.some((s) => s.nodeId === "c" && /absoluteBoundingBox/.test(s.reason)));
  assert.ok(plan.skipped.some((s) => s.nodeId === "d" && /0 尺寸/.test(s.reason)));
});

test("selectAnnotations：同一节点多条 finding 合并成一个 box，codes 含全部错误码", () => {
  const findings = [
    finding("same", "N-A", "must_fix"),
    finding("same", "N-B", "must_fix"),
    finding("other", "N-C", "must_fix"),
  ];
  const plan = selectAnnotations(findings, { disposition: "must_fix", rootBox: ROOT_BOX });
  assert.equal(plan.boxes.length, 2, "两个不同节点，不是三条 finding");
  const merged = plan.boxes.find((b) => b.nodeId === "same");
  assert.deepEqual([...merged.codes].sort(), ["N-A", "N-B"]);
  assert.equal(merged.label, 1);
  assert.equal(plan.boxes.find((b) => b.nodeId === "other").label, 2);
  assert.equal(plan.cards.length, 3);
});

test("selectAnnotations：cards.length 等于该档涉及的 code 数，不是 finding 数", () => {
  const findings = [
    finding("a", "N-A", "must_answer"),
    finding("b", "N-B", "must_answer"),
    finding("c", "N-A", "must_answer"),
    finding("d", "N-C", "must_answer", { absoluteBoundingBox: null }),
  ];
  const plan = selectAnnotations(findings, { disposition: "must_answer", rootBox: ROOT_BOX });
  assert.equal(plan.cards.length, 3);
  assert.deepEqual(plan.cards.map((c) => c.code).sort(), ["N-A", "N-B", "N-C"]);
  assert.equal(plan.cards.find((c) => c.code === "N-A").count, 2);
});

test("selectAnnotations：隐藏与祖先隐藏都标 dashed", () => {
  const findings = [
    finding("a", "N-A", "must_fix", { visible: false }),
    finding("b", "N-B", "must_fix", { ancestorHidden: true }),
    finding("c", "N-C", "must_fix", { visible: true, ancestorHidden: false }),
  ];
  const plan = selectAnnotations(findings, { disposition: "must_fix", rootBox: ROOT_BOX });
  assert.equal(plan.boxes.filter((b) => b.dashed).length, 2);
  assert.ok(plan.boxes.find((b) => b.nodeId === "a").note.includes("当前隐藏"));
  assert.ok(plan.boxes.find((b) => b.nodeId === "b").note.includes("祖先隐藏"));
});

test("selectAnnotations：编号按画布 y 升序，y 相同按 x 升序", () => {
  const findings = [
    finding("a", "N-A", "must_fix", { absoluteBoundingBox: BOX(200, 100) }),
    finding("b", "N-B", "must_fix", { absoluteBoundingBox: BOX(100, 500) }),
    finding("c", "N-C", "must_fix", { absoluteBoundingBox: BOX(100, 100) }),
  ];
  const plan = selectAnnotations(findings, { disposition: "must_fix", rootBox: ROOT_BOX });
  assert.deepEqual(plan.boxes.map((b) => b.label), [1, 2, 3]);
  assert.deepEqual(plan.boxes.map((b) => b.nodeId), ["c", "b", "a"]);
});

test("selectAnnotations：清单超过 30 条时截断且明确给出余量，不许静默", () => {
  const findings = Array.from({ length: 35 }, (_, i) =>
    finding(`n${i}`, "N-IMG-FILL-NO-NAME", "must_answer", { absoluteBoundingBox: BOX(i * 10) }));
  const plan = selectAnnotations(findings, { disposition: "must_answer", rootBox: ROOT_BOX });
  const card = plan.cards.find((c) => c.code === "N-IMG-FILL-NO-NAME");
  assert.equal(card.truncated, true);
  assert.equal(card.items.length, 30);
  assert.equal(card.truncatedCount, 5);
});

test("selectAnnotations：已结案跳过，fixed 仍在报与未标记同码条目都画", () => {
  const findings = [
    finding("closed", "N-IMG-FILL-NO-NAME", "must_answer", {
      absoluteBoundingBox: BOX(10),
    }),
    finding("fixed", "N-IMG-FILL-NO-NAME", "must_answer", {
      absoluteBoundingBox: BOX(100),
    }),
    finding("pending", "N-IMG-FILL-NO-NAME", "must_answer", {
      absoluteBoundingBox: BOX(200),
    }),
  ];
  const marksByKey = {
    "N-IMG-FILL-NO-NAME::closed": { mark: "not-an-issue" },
    "N-IMG-FILL-NO-NAME::fixed": { mark: "fixed" },
  };
  const plan = selectAnnotations(findings, {
    disposition: "must_answer",
    rootBox: ROOT_BOX,
    marksByKey,
  });

  assert.deepEqual(plan.boxes.map((box) => box.nodeId), ["fixed", "pending"],
    "不用改不画框；fixed 仍在报不能被一刀切成所有已标记都跳过");
  assert.equal(plan.cards.length, 1, "同码仍只画一张说明卡");
  assert.equal(plan.cards[0].count, 2);
  assert.equal(plan.cards[0].items.length, 2, "不用改条目不能进入说明卡清单");
  assert.deepEqual(plan.cards[0].items.map((item) => item.path), ["pc / fixed", "pc / pending"]);

  const layout = layoutAnnotations(plan);
  const { api, created } = fakeFigma();
  const summary = drawAnnotations({
    rootNode: { name: "pc", absoluteBoundingBox: ROOT_BOX },
    plan,
    layout,
    fontName: { family: "Inter", style: "Regular" },
    api,
  });
  assert.equal(summary.boxesDrawn, 2);
  assert.equal(summary.cardsDrawn, 1);
  assert.equal(created.ellipses.length, 2, "后两条各有角标，已结案条目没有角标");
  assert.equal(created.frames.filter((node) => node.name.startsWith("naming-lint:card")).length, 1);
});

test("annotate 两头门禁：dirtyTree 触发可画 finding，cleanTree 保持 0 findings", () => {
  const dirty = dirtyTree();
  const dirtyResult = lint(dirty);
  const target = dirtyResult.findings.find((item) => item.code === "N-IMG-FILL-NO-NAME");
  assert.ok(target, "dirtyTree 必须真的犯一次图像未命名");
  const dirtyPlan = selectAnnotations(
    attachNodeInfo(dirtyResult.findings, buildNodeInfoMap(dirty)),
    { disposition: target.disposition, code: target.code, rootBox: dirty.absoluteBoundingBox },
  );
  assert.ok(dirtyPlan.boxes.length > 0 && dirtyPlan.cards.length === 1,
    "dirtyTree 的真实 lint 结果必须走到画布标注层");

  const clean = cleanTree();
  const cleanResult = lint(clean);
  assert.equal(cleanResult.findings.length, 0, "cleanTree 不能因标注改动产生误报");
  const cleanPlan = selectAnnotations(cleanResult.findings, {
    disposition: target.disposition,
    code: target.code,
    rootBox: clean.absoluteBoundingBox,
  });
  assert.deepEqual({ boxes: cleanPlan.boxes.length, cards: cleanPlan.cards.length }, { boxes: 0, cards: 0 });
});

test("buildNodeInfoMap：祖先隐藏会向下传递", () => {
  const tree = {
    id: "root",
    name: "pc",
    type: "FRAME",
    visible: true,
    absoluteBoundingBox: BOX(0),
    children: [{
      id: "hidden-parent",
      name: "隐藏组",
      type: "GROUP",
      visible: false,
      absoluteBoundingBox: BOX(0),
      children: [{
        id: "child",
        name: "子层",
        type: "RECTANGLE",
        visible: true,
        absoluteBoundingBox: BOX(0),
        children: [],
      }],
    }],
  };
  const info = buildNodeInfoMap(tree);
  assert.equal(info.get("child").ancestorHidden, true);
  assert.equal(info.get("child").visible, true);
  assert.equal(info.get("hidden-parent").visible, false);
  const plan = selectAnnotations(attachNodeInfo([
    finding("child", "N-A", "must_fix"),
  ], info), { disposition: "must_fix", rootBox: ROOT_BOX });
  assert.equal(plan.boxes[0].dashed, true);
});

test("metrics：尺寸随根宽比例变化并 clamp", () => {
  assert.equal(metrics({ x: 0, y: 0, width: 1920, height: 1000 }).scale, 1);
  assert.equal(metrics({ x: 0, y: 0, width: 1920, height: 1000 }).strokeWidth, 4);
  assert.equal(metrics({ x: 0, y: 0, width: 1920, height: 1000 }).cardWidth, 560);
  assert.equal(metrics({ x: 0, y: 0, width: 3840, height: 1000 }).scale, 2);
  assert.equal(metrics({ x: 0, y: 0, width: 3840, height: 1000 }).strokeWidth, 8);
  assert.equal(metrics({ x: 0, y: 0, width: 3840, height: 1000 }).cardFontSize, 30);
  assert.equal(metrics({ x: 0, y: 0, width: 11520, height: 1000 }).scale, 6);
  assert.equal(metrics({ x: 0, y: 0, width: 11520, height: 1000 }).badgeDiameter, 168);
  assert.equal(metrics({ x: 0, y: 0, width: 500, height: 1000 }).scale, 1, "小于基准稿不缩到看不见");
});

test("selectAnnotations：边长过半的节点不画框，只留角标", () => {
  const rootBox = { x: 0, y: 0, width: 1000, height: 1000 };
  // 全宽窄条：面积只占 4%，但宽度撑满 —— 画出来是横贯整稿的红线，必须归 badge-only。
  // 旧的面积比判据（>=3%）会把它判成需要画框，这条断言就是为了锁住换判据这件事。
  const band = finding("band", "N-A", "must_fix", {
    absoluteBoundingBox: { x: 0, y: 0, width: 1000, height: 40 },
  });
  const tall = finding("tall", "N-B", "must_fix", {
    absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 600 },
  });
  const mid = finding("mid", "N-C", "must_fix", {
    absoluteBoundingBox: { x: 100, y: 100, width: 490, height: 490 },
  });
  const small = finding("small", "N-D", "must_fix", {
    absoluteBoundingBox: { x: 500, y: 500, width: 40, height: 40 },
  });
  const plan = selectAnnotations([band, tall, mid, small], { disposition: "must_fix", rootBox });
  const styleOf = (id) => plan.boxes.find((b) => b.nodeId === id).style;
  assert.equal(styleOf("band"), "badge-only", "宽度占满，面积只 4% 也不画框");
  assert.equal(styleOf("tall"), "badge-only", "高度过半即可，不要求两边都过半");
  assert.equal(styleOf("mid"), "box", "49% 仍在阈值内，照常画框");
  assert.equal(styleOf("small"), "box");
});

test("layoutAnnotations：角标在框左上角，且不再产出引线", () => {
  const rootBox = { x: 0, y: 0, width: 1920, height: 1920 };
  const normal = finding("normal", "N-A", "must_fix", {
    absoluteBoundingBox: { x: 300, y: 400, width: 100, height: 40 },
  });
  const band = finding("band", "N-B", "must_fix", {
    absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 40 },
  });
  const plan = selectAnnotations([normal, band], { disposition: "must_fix", rootBox });
  const layout = layoutAnnotations(plan);
  const d = plan.metrics.badgeDiameter;

  const boxed = layout.boxLayouts.find((b) => b.nodeId === "normal");
  assert.equal(boxed.badgeX, 300 - d, "有框的挂在框外左上角，不遮内容");
  assert.equal(boxed.badgeY, 400 - d);

  const bare = layout.boxLayouts.find((b) => b.nodeId === "band");
  assert.equal(bare.badgeX, 0, "无框的放节点左上角内侧，否则会飘到稿子外面");
  assert.equal(bare.badgeY, 0);

  assert.ok(
    layout.boxLayouts.every((b) => b.leader === undefined),
    "引线已删除：卡片列在稿外，框与卡永远不同屏",
  );
});

test("selectAnnotations：极小节点扩展为最小可见尺寸并标注", () => {
  const rootBox = { x: 0, y: 0, width: 1920, height: 1000 };
  const node = finding("tiny", "N-A", "must_fix", {
    absoluteBoundingBox: { x: 100, y: 200, width: 5, height: 5 },
  });
  const plan = selectAnnotations([node], { disposition: "must_fix", rootBox });
  const box = plan.boxes[0];
  assert.equal(box.w, 12, "strokeWidth 4 × 3");
  assert.equal(box.h, 12);
  assert.equal(box.x, 96.5, "以节点中心向外扩展");
  assert.equal(box.y, 196.5);
  assert.match(box.note, /实际 5×5，框已放大以便可见/);
});

test("selectAnnotations：宽高刚好等于最小可见尺寸时不放大也不提示", () => {
  const rootBox = { x: 0, y: 0, width: 1920, height: 1000 };
  const node = finding("boundary", "N-A", "must_fix", {
    absoluteBoundingBox: { x: 100, y: 200, width: 12, height: 12 },
  });
  const plan = selectAnnotations([node], { disposition: "must_fix", rootBox });
  const box = plan.boxes[0];
  assert.equal(box.w, 12);
  assert.equal(box.h, 12);
  assert.equal(box.x, 100);
  assert.equal(box.y, 200);
  assert.equal(box.note, undefined);
});

test("selectAnnotations：真稿 must_fix 形状下没有普通小框被放大", () => {
  const rootBox = { x: 3660, y: 658, width: 3840, height: 17241 };
  const findings = [
    ...Array.from({ length: 11 }, (_, i) => finding(`sec-${i}`, "N-SEC-NESTED", "must_fix", {
      absoluteBoundingBox: { x: 3660, y: 1000 + i * 100, width: 3840, height: 1500 },
    })),
    ...Array.from({ length: 10 }, (_, i) => finding(`part-${i}`, "N-PREFIX-NOT-IN-TABLE", "must_fix", {
      absoluteBoundingBox: { x: 4000 + i * 30, y: 2000 + i * 50, width: 225, height: 79 },
    })),
    ...Array.from({ length: 3 }, (_, i) => finding(`ind-${i}`, "N-IND-NO-CAROUSEL", "must_fix", {
      absoluteBoundingBox: { x: 4200 + i * 10, y: 3000 + i * 10, width: 40, height: 40 },
    })),
  ];
  const plan = selectAnnotations(findings, { disposition: "must_fix", rootBox });
  assert.equal(plan.boxes.length, 24);
  assert.equal(plan.boxes.filter((b) => b.note?.includes("框已放大")).length, 0);
  // 真稿实测的分档：11 个 sec/ 是 3840 宽（撑满），其余 13 个最大边长占比 7.1%。
  assert.equal(plan.boxes.filter((b) => b.style === "badge-only").length, 11);
  assert.equal(plan.boxes.filter((b) => b.style === "box").length, 13);
});

/* ── drawAnnotations（画布落笔层）───────────────────────────────────────────
   这一组是 2026-08-06 补的。此前 drawAnnotations 零覆盖，一个 TDZ 变量遮蔽让
   说明卡整段抛错、真机上一张卡都画不出来，而测试 93 项全绿。
   所以下面每条断言都绑「画布上真的出现了什么」，不绑中间数据结构的形状。 */

const CARD_ROOT = { x: 0, y: 0, width: 1920, height: 1920 };
const FONT = { family: "Inter", style: "Regular" };

/** 真错误码（RULES 里有 title/why/fix），假码会让卡片只剩标题，测不出正文有没有画。 */
function cardPlan() {
  const findings = [
    finding("band", "N-SEC-NESTED", "must_fix", {
      absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 200 },
    }),
    finding("part", "N-PREFIX-NOT-IN-TABLE", "must_fix", {
      absoluteBoundingBox: { x: 300, y: 400, width: 225, height: 79 },
    }),
    finding("slash", "N-PREFIX-SLASH", "must_fix", {
      absoluteBoundingBox: { x: 600, y: 800, width: 120, height: 60 },
    }),
  ];
  const plan = selectAnnotations(findings, { disposition: "must_fix", rootBox: CARD_ROOT });
  return { plan, layout: layoutAnnotations(plan) };
}

function draw(overrides = {}) {
  const { plan, layout } = cardPlan();
  const { api, created } = fakeFigma(overrides.existing ?? []);
  const summary = drawAnnotations({
    rootNode: { name: "pc", absoluteBoundingBox: CARD_ROOT },
    plan,
    layout,
    fontName: overrides.fontName === undefined ? FONT : overrides.fontName,
    api,
  });
  return { plan, layout, api, created, summary };
}

test("drawAnnotations：说明卡真的画出来了（锁住 TDZ 遮蔽那类必炸 bug）", () => {
  const { plan, created, summary } = draw();
  assert.ok(plan.cards.length >= 3, "先确认这个用例真的有卡要画");
  const cardFrames = created.frames.filter((f) => f.name.startsWith("naming-lint:card"));
  assert.equal(cardFrames.length, plan.cards.length, "每个错误码一张卡，一张都不能少");
  assert.equal(summary.cardsDrawn, plan.cards.length);
  for (const frame of cardFrames) {
    const texts = frame.children.filter((c) => c.kind === "TEXT");
    assert.ok(texts.length >= 3, `${frame.name} 至少要有标题 + 不改会怎样 + 怎么改`);
    const joined = texts.map((t) => t.characters).join("\n");
    assert.match(joined, /不改会怎样：/);
    assert.match(joined, /怎么改：/);
  }
});

/* 独立参照：测试自己算行数，**不读节点的 height**。
   上一版断言用的正是那个偏小的 node.height，文字底边和卡片高度由同一个错值算出，
   自己跟自己比当然一致 —— 断言和 bug 同向错误，105 项全绿而真机文字重叠。
   这里刻意用比生产代码更朴素的模型（按最宽字符估容量），只求「不少算行数」。 */
function refLines(text, wrapWidth, fontSize) {
  const perLine = Math.max(1, Math.floor(wrapWidth / fontSize));
  let lines = 0;
  for (const logical of String(text ?? "").split("\n")) {
    let wide = 0;
    for (const ch of logical) wide += ch.codePointAt(0) > 0x2e7f ? 1 : 0.5;
    lines += Math.max(1, Math.ceil(wide / perLine));
  }
  return Math.max(1, lines);
}

for (const reflowsText of [false, true]) {
  const mode = reflowsText ? "会回流" : "不回流（真机实测行为）";

  test(`drawAnnotations：多行正文之间不压叠 · ${mode}`, () => {
    const { plan, layout } = cardPlan();
    const { api, created } = fakeFigma([], { reflowsText });
    drawAnnotations({
      rootNode: { name: "pc", absoluteBoundingBox: CARD_ROOT },
      plan,
      layout,
      fontName: FONT,
      api,
    });
    const m = layout.metrics;
    const wrapWidth = m.cardWidth - m.cardPadding * 2;
    const cardFrames = created.frames.filter((f) => f.name.startsWith("naming-lint:card"));
    let multiLineSeen = 0;

    for (const frame of cardFrames) {
      const texts = frame.children
        .filter((c) => c.kind === "TEXT")
        .sort((a, b) => a.y - b.y);
      for (let i = 0; i < texts.length; i++) {
        const t = texts[i];
        const lines = refLines(t.characters, wrapWidth, t.fontSize);
        if (lines > 1) multiLineSeen++;
        const trueBottom = t.y + lines * t.fontSize * 1.45;
        if (i + 1 < texts.length) {
          assert.ok(
            texts[i + 1].y >= t.y - 0.5 + lines * t.fontSize * 1.45 - t.fontSize * 0.5,
            `「${String(t.characters).slice(0, 18)}…」占 ${lines} 行，`
              + `下一段起点 ${Math.round(texts[i + 1].y)} 压在它身上（真实底边约 ${Math.round(trueBottom)}）`,
          );
        }
        assert.ok(
          trueBottom <= frame.h + t.fontSize,
          `「${String(t.characters).slice(0, 18)}…」真实底边 ${Math.round(trueBottom)} 超出白底 ${Math.round(frame.h)}`,
        );
      }
    }
    assert.ok(multiLineSeen >= 3, `用例必须含多行文本才测得出压叠，实际 ${multiLineSeen} 段`);
  });
}

test("measureTextLines：宁可多算不可少算（对照更朴素的参照模型）", () => {
  const cases = [
    ["纯中文的一段比较长的说明文字用来测试换行行为是否正确计算行数", 300, 15],
    ["N-SEC-NESTED 分区嵌在语义节点内 · 11 条 · 确定", 1024, 30],
    ["pc / bg/pc / bg / 10 / part / ten", 1024, 30],
    ["短", 1024, 30],
    ["a\nb\nc", 1024, 30],
  ];
  for (const [text, wrapWidth, fontSize] of cases) {
    const mine = measureTextLines(text, { wrapWidth, fontSize });
    const ref = refLines(text, wrapWidth, fontSize);
    assert.ok(
      mine >= ref,
      `「${text.slice(0, 20)}…」算 ${mine} 行，少于参照 ${ref} 行 —— 少算就会压字`,
    );
  }
});

test("drawAnnotations：卡片正文包在白底里，不越右边界也不越底边", () => {
  const { created } = draw();
  const cardFrames = created.frames.filter((f) => f.name.startsWith("naming-lint:card"));
  const pad = layoutAnnotations(cardPlan().plan).metrics.cardPadding;
  for (const frame of cardFrames) {
    const texts = frame.children.filter((c) => c.kind === "TEXT");
    assert.ok(texts.length > 0, `${frame.name} 没有正文`);
    for (const t of texts) {
      assert.ok(
        t.x + t.width <= frame.w - pad + 1,
        `${frame.name} 的「${String(t.characters).slice(0, 20)}…」越过右边界：`
          + `${Math.round(t.x + t.width)} > ${Math.round(frame.w - pad)}`,
      );
      assert.ok(
        t.y + t.height <= frame.h + 1,
        `${frame.name} 的「${String(t.characters).slice(0, 20)}…」越过底边：`
          + `${Math.round(t.y + t.height)} > ${Math.round(frame.h)}`,
      );
    }
  }
});

test("drawAnnotations：正文定宽换行，角标数字不定宽", () => {
  const { created } = draw();
  const cardFrames = created.frames.filter((f) => f.name.startsWith("naming-lint:card"));
  for (const frame of cardFrames) {
    for (const t of frame.children.filter((c) => c.kind === "TEXT")) {
      assert.equal(t.textAutoResize, "HEIGHT", "正文必须定宽，否则长句永不换行");
    }
  }
  // 角标数字挂在标注根上而不是卡片里，靠自身宽度算居中偏移，必须保持自适应宽度。
  const badgeNums = created.texts.filter((t) => !t.parent?.name?.startsWith("naming-lint:card"));
  assert.ok(badgeNums.length > 0);
  assert.ok(badgeNums.every((t) => t.textAutoResize === "WIDTH_AND_HEIGHT"));
});

test("drawAnnotations：卡片按实测高度排布，彼此不重叠", () => {
  const { created } = draw();
  const cards = created.frames
    .filter((f) => f.name.startsWith("naming-lint:card"))
    .sort((a, b) => a.y - b.y);
  assert.ok(cards.length >= 2, "至少两张卡才测得出重叠");
  for (let i = 1; i < cards.length; i++) {
    const prev = cards[i - 1];
    assert.ok(
      cards[i].y >= prev.y + prev.h,
      `${cards[i].name} 压在 ${prev.name} 上：${Math.round(cards[i].y)} < ${Math.round(prev.y + prev.h)}`,
    );
  }
});

test("drawAnnotations：不再画引线", () => {
  const { created } = draw();
  assert.equal(created.lines.length, 0, "createLine 一次都不该被调用");
});

test("drawAnnotations：badge-only 不建矩形，box 一个一个建", () => {
  const { plan, created } = draw();
  const boxStyle = plan.boxes.filter((b) => b.style === "box");
  const bare = plan.boxes.filter((b) => b.style === "badge-only");
  assert.ok(bare.length >= 1 && boxStyle.length >= 1, "用例要同时覆盖两种 style");

  const boxRects = created.rects.filter((r) => r.name.startsWith("naming-lint:box:"));
  assert.equal(boxRects.length, boxStyle.length, "矩形数只等于 box 档，大节点不画框");
  const bareLabels = new Set(bare.map((b) => `naming-lint:box:${b.code}:${b.label}`));
  assert.ok(
    boxRects.every((r) => !bareLabels.has(r.name)),
    "badge-only 的条目不许出现矩形",
  );
  assert.equal(created.ellipses.length, plan.boxes.length, "两种 style 都要有编号角标");
});

test("drawAnnotations：角标数字画在角标圆心上", () => {
  const { layout, created } = draw();
  const m = layout.metrics;
  for (const box of layout.boxLayouts) {
    const badge = created.ellipses.find((e) => e.name === `naming-lint:box:badge:${box.label}`);
    assert.ok(badge, `编号 ${box.label} 缺角标`);
    assert.equal(badge.w, m.badgeDiameter);
    const num = created.texts.find((t) => t.characters === String(box.label));
    assert.ok(num, `编号 ${box.label} 缺数字`);
    assert.ok(Math.abs((num.x + num.width / 2) - (badge.x + m.badgeDiameter / 2)) < 1);
  }
});

test("drawAnnotations：字体拿不到时只画框不画字，不抛错", () => {
  const { created, summary } = draw({ fontName: null });
  assert.equal(created.texts.length, 0, "没有字体就一个字都不画");
  assert.ok(created.rects.length >= 1, "框照画，位置信息不该因为字体丢失而丢失");
  assert.equal(created.ellipses.length, 0, "角标是数字的底，没字就不画空圆");
  assert.ok(summary.boxesDrawn >= 1);
});

test("drawAnnotations：重复运行先清掉上一次的标注根", () => {
  const stale = fakeAnnotationRoot();
  const { api } = draw({ existing: [stale] });
  assert.equal(stale.removed, true, "残留标注根必须被清掉，否则会叠层");
  const roots = api.currentPage.children.filter((n) => n.name.startsWith("ref/命名体检-"));
  assert.equal(roots.length, 1, "画布上只留这一次的标注根");
});

test("drawAnnotations：标注根锁定、无填充、不裁剪内容", () => {
  const { api } = draw();
  const root = api.currentPage.children.find((n) => n.name.startsWith("ref/命名体检-"));
  assert.ok(root, "标注根没建出来");
  assert.equal(root.locked, true, "不锁会被设计师误拖");
  assert.deepEqual(root.fills, [], "有底色会盖住稿子");
  assert.equal(root.clipsContent, false, "卡片列在根框外侧，裁剪就看不见了");
  assert.ok(root.getPluginData("naming-lint:annotation-root"), "缺标记会导致下次清不掉");
});

test("clearAnnotations：只清本插件的标注根，不碰设计师自己的图层", () => {
  const mine = fakeAnnotationRoot();
  const theirs = fakeAnnotationRoot("ref/设计师自己的参考层");
  const page = fakeAnnotationRoot("pc");
  const { api } = fakeFigma([mine, theirs, page]);
  const removed = clearAnnotations(api);
  assert.equal(removed, 1);
  assert.equal(mine.removed, true);
  assert.equal(theirs.removed, false, "同样在 ref/ 下但不是体检标注，不许删");
  assert.equal(page.removed, false);
});

test("selectAnnotations：旋转祖先与被父层裁剪都进 note", () => {
  const tree = {
    id: "root",
    name: "pc",
    type: "FRAME",
    visible: true,
    clipsContent: true,
    rotation: 15,
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    children: [{
      id: "child",
      name: "溢出层",
      type: "RECTANGLE",
      visible: true,
      rotation: 0,
      absoluteBoundingBox: { x: 200, y: 0, width: 100, height: 100 },
      children: [],
    }],
  };
  const info = buildNodeInfoMap(tree);
  assert.equal(info.get("child").ancestorRotation, true);
  assert.equal(info.get("child").clippedByParent, true);
  const plan = selectAnnotations(attachNodeInfo([
    finding("child", "N-A", "must_fix"),
  ], info), { disposition: "must_fix", rootBox: ROOT_BOX });
  assert.match(plan.boxes[0].note, /旋转的祖先/);
  assert.match(plan.boxes[0].note, /被父层裁剪/);
});
