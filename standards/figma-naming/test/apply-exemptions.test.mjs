import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { btnIconLedger, emptyLedger } from "./exemption-fixtures.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = resolve(ROOT, "scripts/apply-exemptions.mjs");

const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], {
  cwd: ROOT,
  encoding: "utf8",
});

/**
 * 合成稿。真稿数字那几条断言（pc 报警 80 / 动作 42 → 28）搬去了
 * test-private/apply-exemptions-real-draft.test.mjs——它读 .cache/ 里的真稿快照，
 * 那份快照不进公开仓。这里换成一份手搭的最小稿，用来锁住脚本本身的行为：
 * 参数解析、报表格式，以及「豁免不改变报警总数、只改变动作数」这个不变量。
 *
 * fixture 的形状是刻意挑的，判别性都在这里：
 *   · scroll/ 下的两张图隔着两层普通容器，btn/ 下的图也隔着一层。隔层是为了
 *     区分「看直接父层」和「看最近前缀祖先」——只隔 0 层时，把继承缩成单层的
 *     变异会全绿通过。
 *   · **scroll/ 内部再套一个 btn/**，它下面那张图的最近前缀是 btn、祖先链却含
 *     scroll。这一格专门抓「把 nearestPrefix 拓宽成整条祖先链」这个变异：
 *     少了它，scroll 账本无论按最近还是按整条链都命中同样的 2 条，变异全绿。
 *     （实测过：第一版 fixture 没有这一格，该变异确实全绿通过。）
 *   · scroll 下三张图、btn 下两张（含 scroll 内那张），所以 scroll 条件命中 3、
 *     btn 条件命中 2，两个数不同——账本换一份时输出必须跟着变；命中数相同的话，
 *     「输出真的来自这份账本吗」这一格就显示不出差别。
 *   · 五张图都在同一个 sec/ 里，报警总数固定为 5，让「报警不变」这个不变量有一个
 *     具体的数可比，而不是只比前后相等。
 */
function syntheticCache() {
  const image = (id, name) => ({
    id, name, type: "RECTANGLE",
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    fills: [{ type: "IMAGE", visible: true }],
  });
  const frame = (id, name, children = []) => ({
    id, name, type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 800, height: 600 },
    children,
  });
  return {
    __lastModified: "synthetic-a",
    document: frame("canvas", "稿件", [
      frame("root", "pc", [
        frame("sec", "sec/1-奖励", [
          frame("scroll", "scroll/奖励列表", [
            frame("wrap-1", "详细奖励内容", [
              frame("wrap-2", "Group 1", [
                image("reward-a", "奖励道具甲"),
                image("reward-b", "奖励道具乙"),
                image("reward-c", "奖励道具丙"),
              ]),
            ]),
            // 判别性那一格：最近前缀是 btn，祖先链里却有 scroll。
            frame("inner-btn", "btn/列表内领取", [
              frame("inner-wrap", "普通布局", [image("inner-icon", "领取图标")]),
            ]),
          ]),
          frame("btn", "btn/兑换入口", [
            frame("btn-wrap", "普通布局", [image("code", "兑换码")]),
          ]),
        ]),
      ]),
    ]),
  };
}

/** btnIconLedger 的条件要求 inInstance + maxEdge<40，合成稿里没有实例，
 *  所以另写一条只按 nearestPrefix 走的 btn 账本——它要与 scroll 账本给出
 *  不同的命中数，才能证明输出真的跟着账本走。 */
function btnPrefixLedger() {
  const [entry] = btnIconLedger().active;
  return {
    version: 1,
    active: [{
      ...entry,
      id: "ex-btn-prefix-only",
      condition: { nearestPrefix: ["btn"] },
    }],
    candidate: [],
  };
}

function scrollLedger() {
  return {
    version: 1,
    active: [{
      id: "ex-scroll-synthetic",
      rule: "N-IMG-FILL-NO-NAME",
      reason: "合成稿：奖励列表内道具图不走网页切图流程",
      createdAt: "2026-08-07",
      reviewBy: "2026-11-07",
      specVersion: btnIconLedger().active[0].specVersion,
      condition: { nearestPrefix: ["scroll"] },
    }],
    candidate: [],
  };
}

test("apply-exemptions：豁免只改变动作数，报警总数一条不动", () => {
  const temp = mkdtempSync(resolve(tmpdir(), "figma-naming-lint-exemptions-"));
  try {
    const cachePath = resolve(temp, "cache.json");
    writeFileSync(cachePath, JSON.stringify(syntheticCache()));
    const write = (name, ledger) => {
      const path = resolve(temp, name);
      writeFileSync(path, JSON.stringify(ledger));
      return path;
    };

    const empty = run("pc", "--cache", cachePath,
      "--exemptions", write("empty.json", emptyLedger()), "--now", "2026-08-07");
    assert.equal(empty.status, 0, empty.stderr);
    assert.equal(empty.stdout, [
      "pc  报警 5（不变）· 动作 5 → 5",
      "  生效豁免 0 条",
      "  已过期 0 条",
      "",
    ].join("\n"), "空账本必须一条都不豁免，动作数原样");

    const scroll = run("pc", "--cache", cachePath,
      "--exemptions", write("scroll.json", scrollLedger()), "--now", "2026-08-07");
    assert.equal(scroll.status, 0, scroll.stderr);
    assert.equal(scroll.stdout, [
      "pc  报警 5（不变）· 动作 5 → 2",
      "  生效豁免 1 条：命中 3 条 / 去重后 3 组",
      "  已过期 0 条",
      "",
    ].join("\n"),
    "scroll 条件只命中最近前缀是 scroll 的那三张；scroll 内那个 btn/ 下的图最近是 btn，"
    + "不该被算进来——把 nearestPrefix 拓宽成整条祖先链时，这个数会变成 4");

    // 换一份条件不同的账本，命中数必须跟着变。
    const btn = run("pc", "--cache", cachePath,
      "--exemptions", write("btn.json", btnPrefixLedger()), "--now", "2026-08-07");
    assert.equal(btn.status, 0, btn.stderr);
    assert.equal(btn.stdout, [
      "pc  报警 5（不变）· 动作 5 → 3",
      "  生效豁免 1 条：命中 2 条 / 去重后 2 组",
      "  已过期 0 条",
      "",
    ].join("\n"), "btn 条件命中两张 btn/ 下的图，与 scroll 的 3 条区分开");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("apply-exemptions：过了复审日期的豁免重新报出来，不静默续期", () => {
  const temp = mkdtempSync(resolve(tmpdir(), "figma-naming-lint-exemptions-expiry-"));
  try {
    const cachePath = resolve(temp, "cache.json");
    writeFileSync(cachePath, JSON.stringify(syntheticCache()));
    const ledgerPath = resolve(temp, "scroll.json");
    writeFileSync(ledgerPath, JSON.stringify(scrollLedger()));

    // 复审日 2026-11-07。当天仍然生效、之后必须过期——判别性在这两格上：
    // 把边界比较写成 `<=` 还是 `<` 只在这一天显示出差别。
    const onReviewDay = run("pc", "--cache", cachePath, "--exemptions", ledgerPath, "--now", "2026-11-07");
    assert.equal(onReviewDay.status, 0, onReviewDay.stderr);
    assert.match(onReviewDay.stdout, /生效豁免 1 条/, "复审日当天仍然生效");
    assert.match(onReviewDay.stdout, /已过期 0 条/);

    const afterReviewDay = run("pc", "--cache", cachePath, "--exemptions", ledgerPath, "--now", "2026-11-08");
    assert.equal(afterReviewDay.status, 0, afterReviewDay.stderr);
    assert.match(afterReviewDay.stdout, /动作 5 → 5/, "过期后动作数回到未豁免的水平");
    assert.match(afterReviewDay.stdout, /已过期 1 条：命中的 3 条重新报出 \/ 去重后 3 组/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
