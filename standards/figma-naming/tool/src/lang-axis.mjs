/**
 * A8 / A10 共用的 lang 变体轴判定。lint 与 inventory 必须读同一份，
 * 否则无前缀但没有 lang 轴的组件集会被体检误当成语言壳。
 */
import { LANG_CODE_SET } from "../../spec/spec.mjs";
import { parseName, usesPrefixSyntax } from "./parse.mjs";

export function variantPropertyName(key) {
  return String(key || "").replace(/#[^#]+$/, "").trim().toLowerCase();
}

export function variantPropertyPairs(name) {
  return String(name || "").split(",").flatMap((part) => {
    const index = part.indexOf("=");
    if (index < 0) return [];
    const key = variantPropertyName(part.slice(0, index));
    if (!key) return [];
    return [{ key, value: part.slice(index + 1) }];
  });
}

export function variantPropertyRaw(raw) {
  if (raw && typeof raw === "object") return raw.value ?? raw.defaultValue ?? "";
  return raw;
}

export function langValueOfVariant(node) {
  const props = node?.componentProperties;
  if (props && typeof props === "object") {
    for (const [key, raw] of Object.entries(props)) {
      if (variantPropertyName(key) !== "lang") continue;
      return String(variantPropertyRaw(raw) ?? "");
    }
  }
  const fromName = variantPropertyPairs(node?.name).find((pair) => pair.key === "lang");
  return fromName ? fromName.value : "";
}

function hasLangVariantDefinition(node) {
  const defs = node?.componentPropertyDefinitions;
  if (!defs || typeof defs !== "object") return false;
  return Object.entries(defs).some(([key, definition]) => {
    if (variantPropertyName(key) !== "lang") return false;
    return definition?.type === "VARIANT";
  });
}

function legalLangValuesOfSet(node) {
  const values = new Set();
  for (const child of node?.children || node?.variants || []) {
    if (child?.type !== "COMPONENT") continue;
    const value = langValueOfVariant(child);
    if (LANG_CODE_SET.has(value)) values.add(value);
  }
  return values;
}

export function hasLangVariantAxis(node) {
  return hasLangVariantDefinition(node) && legalLangValuesOfSet(node).size >= 2;
}

/** 无前缀且 lang 轴至少两个精确小写五码，才是 A10 语言壳。 */
export function unprefixedLangShellSet(node) {
  if (node?.type !== "COMPONENT_SET") return false;
  if (usesPrefixSyntax(parseName(node.name))) return false;
  return hasLangVariantAxis(node);
}
