/**
 * exemptions.mjs — 豁免账本的纯函数层。
 *
 * 不碰文件系统、不读系统时间、不遍历 Figma 树。匹配所需事实全部来自 lint() 已附在
 * finding 上的 type / instance / context；缺事实时显式失败，避免静默放宽豁免。
 */

import { RULES } from "./rules.mjs";
import { NAME_PATTERNS, SPEC_VERSION } from "./spec.mjs";

export const STRUCTURAL_FIELDS = Object.freeze([
  "nodeTypes",
  "nearestPrefix",
  "inInstance",
  "namePattern",
]);

export const CONDITION_FIELDS = Object.freeze([
  ...STRUCTURAL_FIELDS,
  "sizeRange",
  "siblingPrefixRatioLt",
]);

const ENTRY_FIELDS = Object.freeze([
  "id", "rule", "reason", "createdAt", "reviewBy", "specVersion", "condition",
]);
const LEDGER_FIELDS = Object.freeze(["version", "active", "candidate"]);
const SIZE_RANGE_FIELDS = Object.freeze(["maxEdgeLt", "maxEdgeGte"]);
const NAME_PATTERN_VALUES = new Set(NAME_PATTERNS.map(({ value }) => value));

/** 按 §7 与阶段 C 的 schema 校验一条豁免；违反任何底线都显式抛错。 */
export function validateExemption(entry, { rules } = {}) {
  if (!isRecord(entry)) throw new TypeError("豁免条目必须是对象");
  assertNoUnknownFields(entry, ENTRY_FIELDS, `豁免 ${entry.id ?? "?"}`);
  for (const field of ENTRY_FIELDS) {
    if (!Object.hasOwn(entry, field)) throw new Error(`豁免 ${entry.id ?? "?"}: 缺少字段 ${field}`);
  }
  for (const field of ["id", "rule", "reason", "createdAt", "specVersion"]) {
    if (typeof entry[field] !== "string" || !entry[field].trim()) {
      throw new TypeError(`豁免 ${entry.id ?? "?"}: ${field} 必须是非空字符串`);
    }
  }
  if (!isValidDate(entry.reviewBy)) {
    throw new Error(`豁免 ${entry.id}: reviewBy 必须是有效的 YYYY-MM-DD 日期`);
  }
  if (!isRecord(rules)) throw new TypeError("validateExemption 需要传入 rules 规则表");
  const rule = rules[entry.rule];
  if (!rule) throw new Error(`豁免 ${entry.id}: rule ${entry.rule} 不存在`);
  if (rule.disposition === "must_fix") {
    throw new Error(`豁免 ${entry.id}: rule ${entry.rule} 的 disposition 是 must_fix，不允许建立豁免`);
  }
  assertConditionShape(entry.condition, { requireStructural: true, label: `豁免 ${entry.id}.condition` });
  return true;
}

/** finding 是否同时满足 condition 的全部字段。 */
export function matchesCondition(finding, condition) {
  if (!isRecord(finding)) throw new TypeError("matchesCondition 的 finding 必须是对象");
  assertConditionShape(condition, { requireStructural: false, label: "condition" });

  if (Object.hasOwn(condition, "siblingPrefixRatioLt")) {
    throw new Error("condition.siblingPrefixRatioLt 尚未实现，见规范 §7");
  }
  if (Object.hasOwn(condition, "nodeTypes")) {
    if (typeof finding.type !== "string" || !finding.type) {
      throw new Error(`finding ${finding.nodeId ?? "?"} 缺少 type，无法匹配 nodeTypes`);
    }
    if (!condition.nodeTypes.includes(finding.type)) return false;
  }
  if (Object.hasOwn(condition, "nearestPrefix")) {
    const context = requireContextField(finding, "nearestPrefix");
    if (!condition.nearestPrefix.includes(context.nearestPrefix)) return false;
  }
  if (Object.hasOwn(condition, "inInstance")) {
    if (Boolean(finding.instance) !== condition.inInstance) return false;
  }
  if (Object.hasOwn(condition, "namePattern")) {
    const context = requireContextField(finding, "namePattern");
    if (context.namePattern !== condition.namePattern) return false;
  }
  if (Object.hasOwn(condition, "sizeRange")) {
    const context = requireContextField(finding, "maxEdge");
    if (!Number.isFinite(context.maxEdge)) {
      throw new Error(`finding ${finding.nodeId ?? "?"} 的 context.maxEdge 不可用，无法匹配 sizeRange`);
    }
    if (Object.hasOwn(condition.sizeRange, "maxEdgeLt")
      && !(context.maxEdge < condition.sizeRange.maxEdgeLt)) return false;
    if (Object.hasOwn(condition.sizeRange, "maxEdgeGte")
      && !(context.maxEdge >= condition.sizeRange.maxEdgeGte)) return false;
  }
  return true;
}

/**
 * 应用生效区；candidate 只校验、绝不参与计算。now 必须由调用方注入。
 * finding 不删除，只在首个命中的生效豁免上附加 exemptedBy。
 */
export function applyExemptions(findings, ledger, { now, rules = RULES } = {}) {
  if (!Array.isArray(findings)) throw new TypeError("applyExemptions 的 findings 必须是数组");
  validateLedger(ledger, { rules });
  if (!isValidDate(now)) throw new Error("applyExemptions 的 now 必须是有效的 YYYY-MM-DD 日期");

  const output = findings.map((finding) => {
    const { exemptedBy: _previous, ...clean } = finding;
    return clean;
  });
  const versionMismatch = [];
  for (const [zone, entries] of [["active", ledger.active], ["candidate", ledger.candidate]]) {
    for (const entry of entries) {
      if (entry.specVersion === SPEC_VERSION) continue;
      versionMismatch.push({
        id: entry.id,
        rule: entry.rule,
        zone,
        specVersion: entry.specVersion,
        currentSpecVersion: SPEC_VERSION,
      });
    }
  }
  const active = [];
  const expiredEntries = [];
  for (const entry of ledger.active) {
    if (entry.reviewBy < now) expiredEntries.push(entry);
    else active.push(entry);
  }

  const assigned = new Set();
  const activeStats = active.map((entry) => {
    const matched = [];
    let claimed = 0;
    for (let index = 0; index < findings.length; index++) {
      const finding = findings[index];
      if (finding.code !== entry.rule) continue;
      if (!matchesCondition(finding, entry.condition)) continue;
      matched.push(output[index]);
      if (assigned.has(index)) continue;
      output[index] = { ...output[index], exemptedBy: entry.id };
      assigned.add(index);
      claimed += 1;
    }
    return { ...summarize(entry, matched), claimed };
  });

  const expiredMatchedIndexes = new Set();
  const expired = expiredEntries.map((entry) => {
    const matched = [];
    for (let index = 0; index < findings.length; index++) {
      const finding = findings[index];
      if (finding.code !== entry.rule || assigned.has(index)) continue;
      if (!matchesCondition(finding, entry.condition)) continue;
      matched.push(output[index]);
      expiredMatchedIndexes.add(index);
    }
    return { ...summarize(entry, matched), reviewBy: entry.reviewBy };
  });

  const exempted = output.filter((finding) => finding.exemptedBy);
  const expiredFindings = [...expiredMatchedIndexes].map((index) => output[index]);
  return {
    findings: output,
    exempted,
    expired,
    versionMismatch,
    stats: {
      activeEntries: active.length,
      candidateEntries: ledger.candidate.length,
      exemptedFindings: exempted.length,
      exemptedGroups: uniqueGroupCount(exempted),
      expiredEntries: expired.length,
      expiredFindings: expiredFindings.length,
      expiredGroups: uniqueGroupCount(expiredFindings),
      byExemption: activeStats,
    },
  };
}

export function validateLedger(ledger, { rules }) {
  if (!isRecord(ledger)) throw new TypeError("豁免账本必须是对象");
  assertNoUnknownFields(ledger, LEDGER_FIELDS, "豁免账本");
  for (const field of LEDGER_FIELDS) {
    if (!Object.hasOwn(ledger, field)) throw new Error(`豁免账本缺少字段 ${field}`);
  }
  if (ledger.version !== 1) throw new Error(`豁免账本 version 必须是 1，收到 ${ledger.version}`);
  if (!Array.isArray(ledger.active) || !Array.isArray(ledger.candidate)) {
    throw new TypeError("豁免账本 active / candidate 必须是数组");
  }
  const ids = new Set();
  for (const [zone, entries] of [["active", ledger.active], ["candidate", ledger.candidate]]) {
    for (const entry of entries) {
      validateExemption(entry, { rules });
      if (ids.has(entry.id)) throw new Error(`豁免 id 重复: ${entry.id}（${zone}）`);
      ids.add(entry.id);
    }
  }
}

function assertConditionShape(condition, { requireStructural, label }) {
  if (!isRecord(condition)) throw new TypeError(`${label} 必须是对象`);
  assertNoUnknownFields(condition, CONDITION_FIELDS, label);

  if (Object.hasOwn(condition, "nodeTypes")) {
    assertNonEmptyStringArray(condition.nodeTypes, `${label}.nodeTypes`);
  }
  if (Object.hasOwn(condition, "nearestPrefix")) {
    assertNonEmptyStringArray(condition.nearestPrefix, `${label}.nearestPrefix`);
  }
  if (Object.hasOwn(condition, "inInstance") && typeof condition.inInstance !== "boolean") {
    throw new TypeError(`${label}.inInstance 必须是 boolean`);
  }
  if (Object.hasOwn(condition, "namePattern") && !NAME_PATTERN_VALUES.has(condition.namePattern)) {
    throw new TypeError(`${label}.namePattern 只能是 figma-default 或 numeric-suffix`);
  }
  if (Object.hasOwn(condition, "sizeRange")) {
    if (!isRecord(condition.sizeRange)) throw new TypeError(`${label}.sizeRange 必须是对象`);
    assertNoUnknownFields(condition.sizeRange, SIZE_RANGE_FIELDS, `${label}.sizeRange`);
    if (!Object.keys(condition.sizeRange).length) throw new Error(`${label}.sizeRange 不能为空`);
    for (const field of SIZE_RANGE_FIELDS) {
      if (!Object.hasOwn(condition.sizeRange, field)) continue;
      const value = condition.sizeRange[field];
      if (!Number.isFinite(value) || value < 0) {
        throw new TypeError(`${label}.sizeRange.${field} 必须是非负有限数`);
      }
    }
    if (Object.hasOwn(condition.sizeRange, "maxEdgeLt")
      && Object.hasOwn(condition.sizeRange, "maxEdgeGte")
      && condition.sizeRange.maxEdgeGte >= condition.sizeRange.maxEdgeLt) {
      throw new Error(`${label}.sizeRange 必须满足 maxEdgeGte < maxEdgeLt`);
    }
  }
  if (Object.hasOwn(condition, "siblingPrefixRatioLt")) {
    const value = condition.siblingPrefixRatioLt;
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new TypeError(`${label}.siblingPrefixRatioLt 必须是 0–1 的有限数`);
    }
  }
  if (requireStructural && !STRUCTURAL_FIELDS.some((field) => structuralFieldIsNonEmpty(condition, field))) {
    throw new Error(`${label} 必须至少包含一个非空结构性字段（${STRUCTURAL_FIELDS.join(" / ")}）`);
  }
}

function structuralFieldIsNonEmpty(condition, field) {
  if (!Object.hasOwn(condition, field)) return false;
  const value = condition[field];
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null;
}

function requireContextField(finding, field) {
  if (!isRecord(finding.context) || !Object.hasOwn(finding.context, field)
    || finding.context[field] === undefined) {
    throw new Error(`finding ${finding.nodeId ?? "?"} 缺少 context.${field}，无法匹配豁免条件`);
  }
  return finding.context;
}

function summarize(entry, matched) {
  return {
    id: entry.id,
    rule: entry.rule,
    hits: matched.length,
    groups: uniqueGroupCount(matched),
  };
}

function uniqueGroupCount(findings) {
  return new Set(findings.map(componentRuleKey)).size;
}

function componentRuleKey(finding) {
  const owner = finding.instance
    ? `component:${finding.instance.componentId ?? finding.instance.id ?? "?"}`
    : `standalone:${finding.nodeId}`;
  return `${owner}::${finding.code}`;
}

function assertNonEmptyStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0
    || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new TypeError(`${label} 必须是非空字符串数组`);
  }
}

function assertNoUnknownFields(value, allowed, label) {
  const unknown = Object.keys(value).filter((field) => !allowed.includes(field));
  if (unknown.length) throw new Error(`${label} 出现 schema 外字段: ${unknown.join(", ")}`);
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
