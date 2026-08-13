/**
 * 人工标签各 kind 的「必有字段」清单，以及随仓示例标签的路径。
 *
 * 单独成文件而不是写在某个 .test.mjs 里：私有那条交叉校验测试
 * （test-private/naming-verdicts-real-labels.test.mjs）要引用同一份清单，
 * 而从一个 test 文件 import 另一个会把它的 test 再跑一遍。
 *
 * 清单本身是从真账本 data/user-labels.json 上抽出来的**交集**（每个 kind 的所有
 * 条目都有的字段），不是并集：真账本里 rename 有 bodySuffixRationale /
 * derivedFrom / derivedBy 这类只在部分条目上出现的字段，它们不是「读的时候可以
 * 指望一定在」的那一批。清单不许漂移，由私有测试对着真账本逐 kind 钉住。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SAMPLE_LABELS_PATH = path.join(PROJECT_ROOT, "examples/user-labels.sample.json");
export const REAL_LABELS_PATH = path.join(PROJECT_ROOT, "data/user-labels.json");

export const REQUIRED_LABEL_FIELDS = {
  rename: ["nodeId", "kind", "nodeNameAtLabelTime", "prefix", "body",
    "confirmedBy", "date", "note", "why", "pageName", "sectionId"],
  "confirmed-ok": ["nodeId", "kind", "nodeNameAtLabelTime", "prefix", "body",
    "confirmedBy", "date", "note", "why", "pageName", "sectionId"],
  "no-prefix": ["nodeId", "kind", "nodeNameAtLabelTime", "prefix", "body",
    "confirmedBy", "date", "note", "why", "pageName", "sectionId"],
  undecided: ["nodeId", "kind", "nodeNameAtLabelTime", "prefix", "body",
    "confirmedBy", "date", "note", "why", "pageName", "sectionId"],
  "needs-regroup": ["nodeId", "kind", "nodeNameAtLabelTime", "confirmedBy", "date",
    "note", "why", "requiredStructure", "pageName", "sectionId"],
  "component-role": ["nodeId", "kind", "nodeNameAtLabelTime", "prefix", "confirmedBy",
    "date", "note", "why", "appliesTo", "pageName", "sectionId"],
};
