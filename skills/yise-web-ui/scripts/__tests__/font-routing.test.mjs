import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  FONT_SOURCE_ROUTING,
  fontRoleFor,
  routeFontWeight,
  routeFontFamily,
} from "../lib/translation/font-routing.mjs";
import { loadDemo, renderFrame } from "../lib/figma-render-check.mjs";

/* The font-routing table is Figma source truth (confirmed 2026-08-07). These
   tests pin the contract: language + generic role -> family, role derived from
   the SOURCE family, and the renderer actually applying the route. No page/node
   id is used by the policy; ids appear only in fixture assertions. */

test("font role is derived from the source family, not name/role regex", () => {
  // display families -> title/button (never body), regardless of structural role
  assert.equal(fontRoleFor({ sourceFamily: "Alimama ShuHeiTi", role: "heading-content-card" }), "title");
  // button hint inside a display family -> button
  assert.equal(fontRoleFor({ sourceFamily: "Alimama ShuHeiTi", role: "character-skill-label" }), "button");
  // Bebas Neue is a locale-invariant latin display face, never a CJK title/button
  assert.equal(fontRoleFor({ sourceFamily: "Bebas Neue", role: "activity-calendar" }), "latin-display");
  assert.equal(fontRoleFor({ sourceFamily: "Bebas Neue", role: "nav" }), "latin-display");
  // body family -> body
  assert.equal(fontRoleFor({ sourceFamily: "FontquanXinYiGuanHeiTi", role: "heading-content-card" }), "body");
  assert.equal(fontRoleFor({ sourceFamily: "Noto Sans HK", role: "unknown" }), "body");
});

test("latin-only display faces (Bebas Neue) stay verbatim in every language", () => {
  for (const lang of ["zh-CN", "en", "ja", "ko", "zh-TW"]) {
    const r = routeFontFamily({ language: lang, sourceFamily: "Bebas Neue" });
    assert.equal(r.family, "Bebas Neue", lang + " must not swap Bebas Neue");
    assert.equal(r.routed, false, lang + " Bebas Neue is not re-routed");
  }
});

test("routeFontFamily returns the Figma-source family per language + role", () => {
  // zh-CN keeps the exact source families (display -> Alimama, body -> Fontquan)
  assert.equal(routeFontFamily({ language: "zh-CN", sourceFamily: "Alimama ShuHeiTi" }).family, "Alimama ShuHeiTi");
  assert.equal(routeFontFamily({ language: "zh-CN", sourceFamily: "FontquanXinYiGuanHeiTi" }).family, "FontquanXinYiGuanHeiTi");
  // en: title/button -> Bebas Neue, body -> Noto Sans
  assert.equal(routeFontFamily({ language: "en", sourceFamily: "Alimama ShuHeiTi" }).family, "Bebas Neue");
  assert.equal(routeFontFamily({ language: "en", sourceFamily: "Alimama ShuHeiTi", role: "character-skill-label" }).family, "Bebas Neue");
  assert.equal(routeFontFamily({ language: "en", sourceFamily: "FontquanXinYiGuanHeiTi" }).family, "Noto Sans");
  // ja / ko / zh-TW use a single Noto family for every role
  assert.equal(routeFontFamily({ language: "ja", sourceFamily: "Alimama ShuHeiTi" }).family, "Noto Sans JP");
  assert.equal(routeFontFamily({ language: "ja", sourceFamily: "FontquanXinYiGuanHeiTi" }).family, "Noto Sans JP");
  assert.equal(routeFontFamily({ language: "ko", sourceFamily: "Alimama ShuHeiTi" }).family, "Noto Sans KR");
  assert.equal(routeFontFamily({ language: "zh-TW", sourceFamily: "Alimama ShuHeiTi" }).family, "Noto Sans HK");
  // language normalization
  assert.equal(routeFontFamily({ language: "zh_tw", sourceFamily: "FontquanXinYiGuanHeiTi" }).family, "Noto Sans HK");
  assert.equal(routeFontFamily({ language: "en-US", sourceFamily: "FontquanXinYiGuanHeiTi" }).family, "Noto Sans");
});

test("routeFontFamily preserves source CJK weights while keeping latin display at 400", () => {
  assert.equal(routeFontFamily({ language: "ja", sourceFamily: "Alimama ShuHeiTi", sourceWeight: 700 }).weight, 700);
  assert.equal(routeFontFamily({ language: "ko", sourceFamily: "Alimama ShuHeiTi", sourceWeight: 700 }).weight, 700);
  assert.equal(routeFontFamily({ language: "zh-TW", sourceFamily: "FontquanXinYiGuanHeiTi", sourceWeight: 400 }).weight, 400);
  assert.equal(routeFontFamily({ language: "en", sourceFamily: "Alimama ShuHeiTi", sourceWeight: 700 }).weight, 400);
  assert.equal(routeFontWeight({ family: "Noto Sans JP", sourceWeight: 500 }), 500);
});

test("source Noto family nodes keep their family in zh-CN and route to target Noto bodies elsewhere", () => {
  assert.deepEqual(
    routeFontFamily({ language: "zh-CN", sourceFamily: "Noto Sans HK", sourceWeight: 700 }),
    { family: "Noto Sans HK", weight: 700, role: "body", language: "zh-CN", routed: false },
  );
  assert.equal(routeFontFamily({ language: "en", sourceFamily: "Noto Sans HK", sourceWeight: 700 }).family, "Noto Sans");
  assert.equal(routeFontFamily({ language: "ja", sourceFamily: "Noto Sans HK", sourceWeight: 700 }).family, "Noto Sans JP");
  assert.equal(routeFontFamily({ language: "ko", sourceFamily: "Noto Sans HK", sourceWeight: 700 }).family, "Noto Sans KR");
});

test("routing table never emits a family outside the source-truth set", () => {
  const allowed = new Set(["Alimama ShuHeiTi", "FontquanXinYiGuanHeiTi", "Bebas Neue", "Noto Sans", "Noto Sans JP", "Noto Sans KR", "Noto Sans HK"]);
  for (const roles of Object.values(FONT_SOURCE_ROUTING)) {
    for (const fam of Object.values(roles)) assert.ok(allowed.has(fam), `unexpected family ${fam}`);
  }
});

const demoDir = resolve("demos/yise-ss5-preview");
const rawTruth = JSON.parse(readFileSync(join(demoDir, "truth.json"), "utf8"));
const unwrap = (n) => (n && typeof n === "object" && !Array.isArray(n) && "value" in n && n.provenance) ? n.value
  : Array.isArray(n) ? n.map(unwrap)
  : (n && typeof n === "object" ? Object.fromEntries(Object.entries(n).map(([k, v]) => [k, unwrap(v)])) : n);
const truth = unwrap(rawTruth);

function routedRecords(frame) {
  const out = [];
  for (const e of frame.walk()) {
    if (e.attrs && e.attrs["data-font-routed"]) {
      out.push({ routed: e.attrs["data-font-routed"], family: e.style.fontFamily, weight: e.style.fontWeight, role: e.attrs["data-text-role"] });
    }
  }
  return out;
}

test("renderer stamps data-font-routed and applies the routed family for a non-source language", () => {
  const demo = loadDemo(demoDir);
  const frame = renderFrame(demo, truth, rawTruth, { plat: "pc" }, "en", 1920);
  const recs = routedRecords(frame);
  assert.ok(recs.length > 0, "expected routed text in en");
  for (const r of recs) {
    assert.match(r.routed, /^en\/(title|button|body):/);
    // every routed family must be one of the en source-truth targets
    assert.ok(/Bebas Neue|Noto Sans/.test(r.family), `en routed to unexpected family ${r.family}`);
  }
  // en display text -> Bebas Neue; en body -> Noto Sans
  assert.ok(recs.some((r) => /title|button/.test(r.routed) && /Bebas Neue/.test(r.family)), "en title/button should route to Bebas Neue");
  assert.ok(recs.some((r) => /body/.test(r.routed) && /Noto Sans/.test(r.family)), "en body should route to Noto Sans");
  assert.ok(recs.some((r) => /Bebas Neue/.test(r.family) && Number(r.weight) === 400), "en Bebas display should stay weight 400");
});

test("zh-CN routes every text to the same source families (no cross-language swap)", () => {
  const demo = loadDemo(demoDir);
  const frame = renderFrame(demo, truth, rawTruth, { plat: "pc" }, "zh-CN", 1920);
  const recs = routedRecords(frame);
  // zh-CN is the source language: normal source-family text should not need a
  // data-font-routed stamp. If a special source family is routed, it must still
  // stay within the source-truth set.
  for (const r of recs) {
    assert.match(r.routed, /^zh-CN\//);
    assert.ok(/Alimama ShuHeiTi|FontquanXinYiGuanHeiTi|Noto Sans HK/.test(r.family), `zh-CN should stay on source families, got ${r.family}`);
  }
});
