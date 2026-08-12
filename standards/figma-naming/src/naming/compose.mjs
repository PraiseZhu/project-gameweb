/**
 * compose.mjs — 命名生成：判据判完「这层该是 prefix/」之后，这一层决定它具体
 * 叫什么名字（取素材、消毒、去重、编号），不重新判断该不该有这个前缀。
 *
 * 硬约束：本文件不许 import fs/path/url/node:*，不许碰 process。
 * 插件沙箱里没有这些，加进来会让插件在真机上直接崩，而单测在 Node 里照跑不误、
 * 发现不了。test/naming-compose-purity.test.mjs 扫源码文本把这条锁住。
 *
 * 出处：从 scripts/diagnostics/probe-m1a.mjs 原样搬出，判断逻辑一行未改。改动都是把
 * 「读全局」改成「显式入参」——搬进插件后那些全局并不存在：
 *
 *   generateName / shortText / siblingCount / horizontalSiblingInfo
 *     原来内部调用 parentOf(node)，parentOf 读的是模块级 parentMap（一张
 *     id→父节点的全表）→ 父层改成由调用方算好、显式传入
 *
 *   generateName
 *     原读模块级 sectionMaxEdge / SECTION_BASE（当前分区的几何和名字）
 *     → 作为参数传入
 *
 *   generateName / reserveUniqueName / shortNameOf
 *     原读写模块级 state.serial（编号计数器）/ state.usedNames（已用名字表，
 *     用于生成 -2/-3 后缀）/ state.duplicateRenames（去重改名明细）/
 *     state.shortNames（过短名字明细）——这四个是有状态的累积表，同一次运行
 *     里越攒越多。搬进插件后如果不重置，第二次点「开始命名」会从上次的序号
 *     接着编，产出 img/头像-4 而不是 img/头像。
 *     → 收进一个显式的 namingState 对象（见 createNamingState），由调用方
 *     每次命名会话创建一个新的、自己持有、显式传给这几个函数。不留任何
 *     模块级可变变量。test/naming-compose-purity.test.mjs 里有一条回归用例
 *     专门验证「两个独立的 namingState 互不干扰」。
 *
 * stripName 没有搬进来：它是 shape.mjs 第一批就导出的函数，probe-m1a.mjs 里
 * 原来有一份逐字重复的本地拷贝（从未 import 那份，是个未被发现的影子副本）。
 * 这批顺手把探针里的重复定义删了，改成直接 import shape.mjs 的那份——不再造
 * 第二份，原因见 CLAUDE.md 里 namePatternOf 那次教训。
 */

import { parseName } from "../parse.mjs";
import { namePatternOf } from "../lint.mjs";
import { maxEdge, textCount, round1, statePairPattern } from "./shape.mjs";
import { nameValid, sanitizeBody } from "./structure.mjs";

/**
 * 一次命名会话的可变状态：已用名字表（去重编号用）、编号计数器、去重改名明细、
 * 过短名字明细。调用方每次要"从头开始命名"就新建一个，不复用上一次的。
 */
export function createNamingState() {
  return {
    usedNames: new Map(),
    serial: 0,
    duplicateRenames: [],
    shortNames: [],
  };
}

// 取节点内部≤24字的短文本；取不到就退回父层同级的短文本兄弟。
export function shortText(node, parent) {
  let found = null;
  (function walkText(n) {
    if (found) return;
    if (parseName(n.name || "").prefix === "ref") return;
    if (n.type === "TEXT") {
      const text = n.characters || n.name || "";
      if ([...text].length <= 24) {
        found = text;
        return;
      }
    }
    for (const child of n.children || []) walkText(child);
  })(node);
  if (found) return found;
  for (const sibling of parent?.children || []) {
    if (sibling.type === "TEXT") {
      const text = sibling.characters || sibling.name || "";
      if ([...text].length <= 24) return text;
    }
  }
  return null;
}

export function generateName(node, prefix, parent, sectionMaxEdge, sectionBase, namingState) {
  // 已经写成「合法前缀/名字」的层原样返回，不再套第二层前缀。
  // 火炬前瞻页实测：sanitizeBody 会删掉斜杠，「img/背景」被当成光秃秃的名字
  // 「img背景」，再拼出「img/img背景」。10 条产出里错了 4 条。
  // 这里只认前缀合法且 body 非空的完整命名，半成品（如「img/」「xx/背景」）仍走生成。
  const own = parseName(node.name || "");
  if (own.prefix && own.prefixRaw === own.prefix && own.body && !own.unknownPrefix) {
    return node.name;
  }
  // 孤立的箭头就叫「划动示意箭头」——用户 2026-08-11 直接给的名字。
  //
  // 原来它会拿原名「箭头」当 body，于是一页上出现好几个 img/箭头、img/箭头-2；
  // 取不到名字时更糟，退化成 img/cn_pc-图1 这种占位编号（用户第二批裁决里
  // 有 4 条中招，4 个不同的箭头共用同一个占位名）。
  //
  // 成对的翻页箭头不走这里——它们在 walk 的功能词档就按左右分好了。
  if (/^箭头$|^arrow$/i.test(String(node.name ?? "").trim())) {
    const name = `${prefix}/划动示意箭头`;
    if (nameValid(name, prefix)) return reserveUniqueName(node, prefix, "划动示意箭头", namingState);
  }

  const candidates = [];
  // 只挡两类：figma-default（Rectangle 137 / Union / Vector，真碎片）和纯数字
  // （3 / 21，无语义）。numeric-suffix（元件原料自选箱 1 / pc端_01 7 / 底框2 1）
  // 要放行——那是设计师起好的名字后面顺手带了编号，是这层最好的 body 来源。
  //
  // 这条必须和 shape.mjs 的 imgPattern 用同一套口径。实测踩过：imgPattern 放开了
  // numeric-suffix、这里没放开，于是「元件原料自选箱 1」能进 img 档却取不到名字，
  // 退化成「img/cn_pc-图20」——一个好名字被换成了无意义编号。
  const pattern = namePatternOf(node.name);
  const nameUnusable = pattern === "figma-default" || /^\d+$/.test(String(node.name ?? "").trim());
  if (!nameUnusable) candidates.push(node.name);
  const m = maxEdge(node);
  const isSmall = (node.children || []).length === 0 || (m != null && m <= sectionMaxEdge * 0.2);
  if (prefix !== "scroll" && isSmall) {
    const text = shortText(node, parent);
    if (text) candidates.push(text);
  }
  for (const candidate of candidates) {
    const body = sanitizeBody(candidate);
    if (!body) continue;
    const name = `${prefix}/${body}`;
    if (nameValid(name, prefix)) return name;
  }
  const fallbackName = `${prefix}/${sectionBase}-图${++namingState.serial}`;
  if (nameValid(fallbackName, prefix)) return reserveUniqueName(node, prefix, fallbackName.split("/")[1], namingState);
  return fallbackName;
}

// D7：body 全局唯一，序号按 y 升序、y 相同按 x 升序，不依赖 DFS 顺序。
export function reserveUniqueName(node, prefix, body, namingState) {
  const key = `${prefix}/${body}`;
  const box = node.absoluteBoundingBox || {};
  const y = box.y ?? Infinity;
  const x = box.x ?? Infinity;
  const group = namingState.usedNames.get(key);
  if (!group) {
    namingState.usedNames.set(key, [{ nodeId: node.id, y, x }]);
    return key;
  }
  group.push({ nodeId: node.id, y, x });
  const ordered = [...group].sort((a, b) => a.y - b.y || a.x - b.x);
  const idx = ordered.findIndex((item) => item.nodeId === node.id);
  const suffix = idx === 0 ? "" : `-${idx + 1}`;
  const unique = `${prefix}/${body}${suffix}`;
  namingState.duplicateRenames.push({ nodeId: node.id, name: unique, body, y });
  return unique;
}

export function dedupeNames(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const body = entry.newName?.split("/")[1] ?? "";
    const key = `${entry.prefix}/${body}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const renames = [];
  const details = [];
  for (const group of groups.values()) {
    if (group.length === 1) continue;
    const body = group[0].newName.split("/")[1];
    const ordered = [...group].sort((a, b) => {
      const ay = a.absoluteY ?? Infinity;
      const by = b.absoluteY ?? Infinity;
      return ay - by || (a.absoluteX ?? Infinity) - (b.absoluteX ?? Infinity);
    });
    for (let i = 1; i < ordered.length; i++) {
      const entry = ordered[i];
      const suffix = i === 1 ? "-2" : `-${i + 1}`;
      const old = entry.newName;
      entry.newName = `${entry.prefix}/${body}${suffix}`;
      entry.name = entry.newName;
      entry.evidence = `${entry.evidence}; 重名去重 → ${old} -> ${entry.newName}`;
      renames.push({
        nodeId: entry.nodeId,
        oldName: old,
        name: entry.newName,
        body,
        y: entry.absoluteY,
        x: entry.absoluteX,
      });
    }
    for (let i = 0; i < ordered.length; i++) {
      details.push({
        nodeId: ordered[i].nodeId,
        name: ordered[i].newName,
        body,
        y: ordered[i].absoluteY,
        x: ordered[i].absoluteX,
        kept: i === 0,
      });
    }
  }
  return { entries, renames, details };
}

export function shortNameOf(entry, namingState) {
  const body = entry.newName?.split("/")[1] ?? "";
  const stripped = body.replace(/\s+/g, "");
  if (stripped.length <= 1 && !/^\d+$/.test(stripped)) {
    namingState.shortNames.push({ nodeId: entry.nodeId, name: entry.newName, body, length: [...stripped].length });
  }
}

export function siblingCount(node, parent) {
  if (!parent) return 0;
  return (parent.children || []).filter((child) => child.id !== node.id).length;
}

export function hasText(node) {
  return textCount(node) >= 1;
}

export function sizeEqualPct(a, b, tolerance) {
  if (!a?.absoluteBoundingBox || !b?.absoluteBoundingBox) return false;
  const aw = a.absoluteBoundingBox.width;
  const bw = b.absoluteBoundingBox.width;
  const ah = a.absoluteBoundingBox.height;
  const bh = b.absoluteBoundingBox.height;
  return Math.abs(aw - bw) / Math.max(aw, bw) <= tolerance &&
    Math.abs(ah - bh) / Math.max(ah, bh) <= tolerance;
}

export function horizontalSiblingInfo(node, parent) {
  if (!parent) return [];
  const group = (parent.children || [])
    .filter((child) => child.absoluteBoundingBox && statePairPattern(child))
    .sort((a, b) => a.absoluteBoundingBox.x - b.absoluteBoundingBox.x);
  return group.map((child) => String(round1(child.absoluteBoundingBox.x)));
}
