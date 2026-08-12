/**
 * 随仓示例标签 vs 真账本的交叉校验。
 *
 * 公开仓那条测试（test/naming-verdicts.test.mjs）比对的是随仓合成示例，字段清单
 * 写死在 REQUIRED_LABEL_FIELDS 里。写死的清单会过期：真账本以后多一个字段、
 * 而示例和清单都没跟上，公开那条测试照样全绿，导出却已经在漏字段。
 *
 * 所以这条私有测试负责把清单钉在真账本上——它只能在有真账本的机器上跑，
 * 缺 data/user-labels.json 时 npm run test:private 会显式报缺哪个文件。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REQUIRED_LABEL_FIELDS, REAL_LABELS_PATH } from "../test/label-fields.mjs";

test("真账本里每个 kind 的公共字段都在 REQUIRED_LABEL_FIELDS 清单里", () => {
  const doc = JSON.parse(readFileSync(REAL_LABELS_PATH, "utf8"));
  assert.equal(doc.version, 1);
  assert.ok(doc.labels.length > 0, "真账本应该有标签，否则这条测试测不出东西");

  /* 用交集而不是并集：真账本里 rename 有 bodySuffixRationale / derivedFrom /
     derivedBy 这类只在部分条目上出现的字段，它们不是「这一 kind 必有」的字段，
     不该逼示例和导出都补上。交集才是「读的时候可以指望一定在」的那一批。 */
  const intersectionByKind = new Map();
  for (const label of doc.labels) {
    const keys = Object.keys(label);
    const previous = intersectionByKind.get(label.kind);
    intersectionByKind.set(label.kind,
      previous ? previous.filter((key) => keys.includes(key)) : keys);
  }

  for (const [kind, fields] of intersectionByKind) {
    const declared = REQUIRED_LABEL_FIELDS[kind];
    assert.ok(declared, `真账本里有 kind=${kind}，但 REQUIRED_LABEL_FIELDS 没声明它`);
    assert.deepEqual([...fields].sort(), [...declared].sort(),
      `kind=${kind} 的真账本公共字段与 REQUIRED_LABEL_FIELDS 不一致：`
      + "真账本加/删字段后，示例与导出都要跟上，否则读的时候是 undefined 静默走错分支");
  }

  assert.deepEqual(
    [...intersectionByKind.keys()].sort(),
    Object.keys(REQUIRED_LABEL_FIELDS).sort(),
    "真账本的 kind 集合与 REQUIRED_LABEL_FIELDS 的 kind 集合必须一致",
  );
});
