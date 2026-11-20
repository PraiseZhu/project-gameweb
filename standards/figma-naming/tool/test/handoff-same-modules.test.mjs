import test from "node:test";
import assert from "node:assert/strict";
import { sameModulesOf } from "../src/handoff.mjs";

function page(end, sections = [], roots = []) {
  const pageId = `${end}-page`;
  const nodes = roots.map((node) => ({
    type: "FRAME", status: "determined", role: "grp", parentId: pageId, ...node,
  }));
  sections.forEach(({ number, caption = "内容", modules = [] }, index) => {
    const id = `${end}-section-${index}`;
    nodes.push({
      id, type: "FRAME", status: "determined", role: "sec",
      label: `${number}-${caption}`, parentId: pageId,
    });
    // Two ordinary wrappers distinguish ancestry traversal from checking only the parent.
    nodes.push({ id: `${id}-outer`, type: "FRAME", status: "skipped", parentId: id });
    nodes.push({ id: `${id}-inner`, type: "GROUP", status: "skipped", parentId: `${id}-outer` });
    for (const module of modules) {
      nodes.push({
        type: "FRAME", status: "determined", role: "grp",
        parentId: `${id}-inner`, ...module,
      });
    }
  });
  return { page: { id: pageId }, nodes };
}

const group = (id, label = "奖励说明", extra = {}) => ({ id, label, ...extra });
const pairs = (result) => result.paired.map(({ pcId, mobileId }) => [pcId, mobileId]);

test("sameModules：隔两层普通分组，跨屏同名 grp 按 sec 对应，不按遍历顺序", () => {
  const pc = page("pc", [
    { number: 1, modules: [group("pc-first")] },
    { number: 2, modules: [group("pc-second")] },
  ]);
  const mobile = page("mobile", [
    { number: 2, modules: [group("mobile-second")] },
    { number: 1, modules: [group("mobile-first")] },
  ]);
  const result = sameModulesOf(pc, mobile);
  assert.deepEqual(pairs(result).filter(([id]) => ["pc-first", "pc-second"].includes(id)), [
    ["pc-first", "mobile-first"], ["pc-second", "mobile-second"],
  ]);
  assert.deepEqual(result.ambiguous, []);
  assert.ok(result.paired.some((row) => row.key === "sec/2::grp/奖励说明" && row.role === "grp"));
});

test("sameModules：sec 按编号配对，说明名称可以不同", () => {
  const result = sameModulesOf(
    page("pc", [{ number: 2, caption: "奖励", modules: [group("pc-module")] }]),
    page("mobile", [{ number: 2, caption: "奖励移动版", modules: [group("mobile-module")] }]),
  );
  assert.ok(pairs(result).some(([pcId, mobileId]) => pcId === "pc-section-0" && mobileId === "mobile-section-0"));
  assert.ok(pairs(result).some(([pcId, mobileId]) => pcId === "pc-module" && mobileId === "mobile-module"));
});

test("sameModules：选中的页面根本身是 sec 时，子模块仍必须按屏限定", () => {
  const rootSection = (end, number) => ({
    page: { id: `${end}-root` },
    nodes: [
      { id: `${end}-root`, role: "sec", label: String(number), status: "determined", parentId: null },
      { id: `${end}-module`, role: "grp", label: "奖励说明", status: "determined", parentId: `${end}-root` },
    ],
  });
  assert.equal(sameModulesOf(rootSection("pc", 1), rootSection("mobile", 2)).paired.length, 0);
  assert.ok(pairs(sameModulesOf(rootSection("pc", 2), rootSection("mobile", 2)))
    .some(([pcId, mobileId]) => pcId === "pc-module" && mobileId === "mobile-module"));
});

test("sameModules：同名但属于不同 sec 的模块不能配对", () => {
  const result = sameModulesOf(
    page("pc", [{ number: 1, modules: [group("pc-module")] }]),
    page("mobile", [{ number: 2, modules: [group("mobile-module")] }]),
  );
  assert.equal(result.paired.length, 0);
  assert.ok(result.unmatched.some((row) => row.id === "pc-module" && row.end === "pc-only"));
  assert.ok(result.unmatched.some((row) => row.id === "mobile-module" && row.end === "mobile-only"));
});

test("sameModules：同屏同名的多个候选明确报歧义，不伪装单端", () => {
  const result = sameModulesOf(
    page("pc", [{ number: 2, modules: [group("pc-a"), group("pc-b")] }]),
    page("mobile", [{ number: 2, modules: [group("mobile-one")] }]),
  );
  assert.equal(result.paired.some((row) => row.role === "grp"), false);
  assert.equal(result.unmatched.some((row) => row.id === "pc-a" || row.id === "pc-b" || row.id === "mobile-one"), false);
  const issue = result.ambiguous.find((row) => row.key === "sec/2::grp/奖励说明");
  assert.equal(issue.reason, "duplicate-module");
  assert.deepEqual(issue.pcIds, ["pc-a", "pc-b"]);
  assert.deepEqual(issue.mobileIds, ["mobile-one"]);
});

test("sameModules：屏外固定块仍在页级唯一配对，不能与屏内同名块混配", () => {
  const pc = page("pc", [{ number: 1, modules: [group("pc-in")] }], [
    group("pc-fix", "顶部导航", { role: "fix" }),
    group("pc-out", "屏外说明"),
  ]);
  const mobile = page("mobile", [{ number: 1, modules: [group("mobile-in", "屏外说明")] }], [
    group("mobile-fix", "顶部导航", { role: "fix" }),
    group("mobile-out"),
  ]);
  const result = sameModulesOf(pc, mobile);
  assert.deepEqual(pairs({ paired: result.paired.filter((row) => row.role !== "sec") }), [["pc-fix", "mobile-fix"]]);
});

test("sameModules：同编号 sec 重复时，其下模块也不能擅自配对", () => {
  const result = sameModulesOf(
    page("pc", [
      { number: 2, modules: [group("pc-a", "A")] },
      { number: 2, modules: [group("pc-b", "B")] },
    ]),
    page("mobile", [{ number: 2, modules: [group("mobile-a", "A")] }]),
  );
  assert.equal(result.paired.length, 0);
  assert.ok(result.ambiguous.some((row) => row.pcIds.includes("pc-a") && row.reason === "duplicate-section"));
});

test("sameModules：父链缺失不能降级成屏外配对", () => {
  const pc = page("pc", [], [group("pc-module", "奖励说明", { parentId: "missing" })]);
  const mobile = page("mobile", [], [group("mobile-module")]);
  const result = sameModulesOf(pc, mobile);
  assert.equal(result.paired.length, 0);
  assert.ok(result.ambiguous.some((row) => row.pcIds.includes("pc-module") && row.reason === "missing-parent"));
});

test("sameModules：父链循环明确报告，不死循环或全页匹配", () => {
  const pc = page("pc", [], [group("pc-module", "奖励说明", { parentId: "wrapper" })]);
  pc.nodes.push({ id: "wrapper", type: "FRAME", parentId: "pc-module", status: "skipped" });
  const result = sameModulesOf(pc, page("mobile", [], [group("mobile-module")]));
  assert.equal(result.paired.length, 0);
  assert.ok(result.ambiguous.some((row) => row.reason === "parent-cycle"));
});

test("sameModules：无编号 sec 明确报告，不在全页寻找同名模块", () => {
  const result = sameModulesOf(
    page("pc", [{ number: "未知", modules: [group("pc-module")] }]),
    page("mobile", [{ number: 2, modules: [group("mobile-module")] }]),
  );
  assert.equal(result.paired.length, 0);
  assert.ok(result.ambiguous.some((row) => row.pcIds.includes("pc-module") && row.reason === "invalid-section"));
});

test("sameModules：单端保留实际节点，unknown 不加入配对", () => {
  const pc = page("pc", [{ number: 3, modules: [group("pc-only"), group("unknown", "不确定", { status: "unknown" })] }]);
  const result = sameModulesOf(pc, null);
  assert.equal(result.paired.length, 0);
  assert.ok(result.unmatched.some((row) => row.id === "pc-only"));
  assert.equal(result.unmatched.some((row) => row.id === "unknown"), false);
  assert.deepEqual(result.ambiguous, []);
});

test("sameModules：只交一端不要求消除另一端配对歧义", () => {
  const result = sameModulesOf(null, page("mobile", [{
    number: 2, modules: [group("mobile-a"), group("mobile-b")],
  }]));
  assert.equal(result.paired.length, 0);
  assert.deepEqual(result.ambiguous, []);
  assert.deepEqual(result.unmatched.filter((row) => row.id.startsWith("mobile-") && !row.id.includes("section")).map((row) => row.id), ["mobile-a", "mobile-b"]);
});

test("sameModules：限定 sec 后仍保留入口语言条件，不修改输入节点", () => {
  const pc = page("pc", [{ number: 2, modules: [group("pc-btn", "预约", { role: "btn", langs: ["cn"] })] }]);
  const mobile = page("mobile", [{ number: 2, modules: [group("mobile-btn", "预约", { role: "btn", langs: ["tw"] })] }]);
  const before = JSON.stringify([pc, mobile]);
  const result = sameModulesOf(pc, mobile);
  assert.equal(result.paired.some((row) => row.role === "btn"), false);
  assert.ok(result.unmatched.some((row) => row.id === "pc-btn"));
  assert.ok(result.unmatched.some((row) => row.id === "mobile-btn"));
  assert.equal(JSON.stringify([pc, mobile]), before);
});
