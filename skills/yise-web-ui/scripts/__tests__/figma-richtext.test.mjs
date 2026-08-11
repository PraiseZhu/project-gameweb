import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadDemo, renderFrame } from "../lib/figma-render-check.mjs";

/* 富文本/字符级样式覆盖（characterStyleOverrides + styleOverrideTable）回归。
   真值：Figma 把「修罗」标红（styleOverrideTable.100 = 红 fills），抽取器一度
   误判「长度 44<46 不覆盖任何字符」而丢弃。本测试固定：override 非零时 truth
   必须带上两个字段，且渲染层把覆盖字符渲染成独立带色 span。 */

const demoDir = resolve("demos/yise-ss5-preview");
const rawTruth = JSON.parse(readFileSync(join(demoDir, "truth.json"), "utf8"));
const unwrap = (v) => (v && typeof v === "object" && !Array.isArray(v) && "value" in v && v.provenance) ? unwrap(v.value)
  : Array.isArray(v) ? v.map(unwrap)
  : (v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unwrap(x)])) : v);
const truth = unwrap(rawTruth);

function findText(id) {
  let out = null;
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.id === id) out = n;
    for (const c of (n.children || [])) walk(c);
  })({ children: Object.values(truth.sections || {}).flatMap((s) => [...(s.nodes || []), ...((s.background && s.background.nodes) || [])]) });
  return out;
}

test("truth carries characterStyleOverrides + styleOverrideTable for the red-emphasis node", () => {
  const n = findText("I13:49912;13:49822");
  assert.ok(n, "node present in truth");
  assert.ok(Array.isArray(n.text.characterStyleOverrides), "characterStyleOverrides extracted");
  assert.ok(n.text.characterStyleOverrides.some((v) => Number(v) !== 0), "has a non-zero override");
  assert.ok(n.text.styleOverrideTable && typeof n.text.styleOverrideTable === "object", "styleOverrideTable extracted");
  const red = n.text.styleOverrideTable["100"];
  assert.ok(red && Array.isArray(red.fills), "override 100 carries fills");
  assert.ok(red.fills[0].color.r > 0.9 && red.fills[0].color.g < 0.2, "override 100 fill is red");
});

test("renderer splits overridden characters into a colored span (source-text render)", () => {
  const demo = loadDemo(demoDir);
  const frame = renderFrame(demo, truth, rawTruth, { plat: "pc" }, "zh-CN", 3840);
  const rich = [...frame.walk()].filter((e) => e.attrs && e.attrs["data-richtext"] === "1");
  assert.ok(rich.length > 0, "at least one rich-text node rendered");
  for (const el of rich) {
    // rich segments are wrapped in a single inline flow container so a
    // flex-column host treats them as one item and wraps them in one line
    // box; collect colored spans recursively.
    const spans = [];
    const walkKids = (node) => {
      for (const c of node.children || []) {
        if (c.tagName === "SPAN") spans.push(c);
        walkKids(c);
      }
    };
    walkKids(el);
    assert.ok(spans.length > 0, "rich text produces spans");
    // every overridden span carries a color from the override table
    const colored = spans.filter((sp) => sp.style && sp.style.color);
    assert.ok(colored.length > 0, "at least one overridden span has a color");
  }
});

test("rich segments are wrapped in a single inline flow container (flex-column safe)", () => {
  const demo = loadDemo(demoDir);
  const frame = renderFrame(demo, truth, rawTruth, { plat: "pc" }, "zh-CN", 3840);
  const rich = [...frame.walk()].filter((e) => e.attrs && e.attrs["data-richtext"] === "1");
  assert.ok(rich.length > 0, "at least one rich-text node rendered");
  for (const el of rich) {
    // exactly one top-level flow wrapper carries all segments, so the host
    // (often display:flex;flex-direction:column) sees a single flex item and
    // never stacks the base text and override span as separate column items.
    const flows = (el.children || []).filter((c) => c.attrs && c.attrs["data-richtext-flow"] === "1");
    assert.strictEqual(flows.length, 1, "exactly one data-richtext-flow wrapper per rich node");
    assert.strictEqual(flows[0].style.display, "block", "flow wrapper is display:block");
  }
});

test("a different-language adopted copy does NOT mis-apply source char offsets", () => {
  const demo = loadDemo(demoDir);
  const frame = renderFrame(demo, truth, rawTruth, { plat: "pc" }, "en", 3840);
  const rich = [...frame.walk()].filter((e) => e.attrs && e.attrs["data-richtext"] === "1");
  const skipped = [...frame.walk()].filter((e) => e.attrs && e.attrs["data-richtext-skipped"] === "translated-copy-differs");
  assert.ok(skipped.length > 0, "translated rich-text nodes leave an explicit skip trace");
  for (const el of rich) {
    const node = findText(el.attrs["data-node"]);
    assert.equal(el.textContent, node.text.characters, "rich-text offsets only apply when rendered text equals source characters");
  }
});
