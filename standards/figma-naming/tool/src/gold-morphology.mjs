/**
 * 未规范新稿闸门：只核前缀。后缀不作对错标准。
 * 金样唯一 type+剥前缀名可写回前缀；不对图层 id，不对 sec/N 抄名。
 * 已知结构漏了前缀 → 红。
 */
import { rebuildInventoryIndexes } from "./inventory.mjs";
import {
  componentSetSignature,
  determinedSignatureRoles,
  isStatePair as isStructuralStatePair,
  signatureRoleMapFromTable,
  signatureHits,
} from "./structural-signature.mjs";

const ROLE_PREFIX = /^(bg|btn|dyn|fix|hot|img|ind|kv|mix|modal|ref|scroll|sec|switch|tab|copy)\//;

function rawName(node) {
  return String(node?.name ?? "").replace(ROLE_PREFIX, "").trim();
}

function hasPrefix(node, role) {
  return node.status === "determined" && node.role === role && String(node.name ?? "").startsWith(`${role}/`);
}

function variantLabels(node) {
  return (node.variants || []).map((variant) => String(variant.name || "")).filter(Boolean);
}

function isStatePair(labels) {
  if (labels.length < 2) return false;
  const tokens = labels.map(variantOptionToken).filter(Boolean);
  if (tokens.length < 2) return false;
  return tokens.every((token) => ACTIVE_TOKENS.has(token) || INACTIVE_TOKENS.has(token));
}

function isStatePairNode(node) {
  return isStructuralStatePair(node) || isStatePair(variantLabels(node));
}

const CLIP_RE = /可划动|划动区域/;
const INNER_REWARD_RE = /^(奖励列表|奖励)$/;
const IMAGE_BODY_RE = /^(素材图|素材|边框背景\d*|背景边框|立绘|角色头像|待解锁头像|视频框\s*\d+|兑换码背景|头像框.*|icon|图标装饰|装饰|阵营信息|待解锁|卡牌|Icon_SSR.*|BG|小按钮|logo|按钮背景|一级按钮.*|二级按钮.*|三级按钮.*|播放按钮\s+\d+)$/;
const BORDER_PART_RE = /^一级边框/;
const TEXT_CONTAINER_TYPES = new Set(["FRAME", "GROUP", "INSTANCE", "COMPONENT"]);


function visitNodes(doc, visit) {
  const seen = new Set();
  const walk = (value, trail) => {
    if (!value || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      visit(value, trail, "siblings");
      value.forEach((item) => walk(item, trail));
      return;
    }
    const isNode = typeof value.id === "string" && typeof value.type === "string";
    if (isNode) visit(value, trail, "node");
    const next = isNode ? [...trail, rawName(value)] : trail;
    for (const child of Object.values(value)) walk(child, next);
  };
  walk(doc, []);
}

function expectPrefix(node, role, problems, why) {
  if (hasPrefix(node, role)) return;
  problems.push(`${node.id}「${node.name}」${why}，前缀必须是 ${role}/（后缀不限）`);
}

function variantOptionToken(name) {
  const text = String(name || "").trim();
  const eq = text.lastIndexOf("=");
  return (eq >= 0 ? text.slice(eq + 1) : text).trim().toLowerCase();
}

const ACTIVE_TOKENS = new Set(["highlight", "选中", "selected", "active"]);
const INACTIVE_TOKENS = new Set(["normal", "disable", "disabled", "未选", "unselected", "inactive", "default", "默认"]);

function isActiveVariantName(name) {
  const token = variantOptionToken(name);
  if (INACTIVE_TOKENS.has(token)) return false;
  return ACTIVE_TOKENS.has(token);
}

/** 同 id 多份时保留带 variants / variantTrees 的记录，禁止空副本覆盖（issue #25）。 */
function nodeEvidenceScore(node) {
  if (!node || typeof node !== "object") return 0;
  let score = 0;
  if (Array.isArray(node.variants) && node.variants.length) score += 100 + node.variants.length;
  if (Array.isArray(node.variantTrees) && node.variantTrees.length) score += 50 + node.variantTrees.length;
  const defs = node.componentPropertyDefinitions;
  if (defs && typeof defs === "object" && Object.keys(defs).length) score += 10;
  if (Array.isArray(node.nodes) && node.nodes.length) score += 1;
  if (node.parentId) score += 2;
  return score;
}

function indexNodes(doc) {
  const byId = new Map();
  visitNodes(doc, (node, _trail, kind) => {
    if (kind !== "node") return;
    const existing = byId.get(node.id);
    if (!existing || nodeEvidenceScore(node) > nodeEvidenceScore(existing)) byId.set(node.id, node);
  });
  return byId;
}

function indexAllCopies(doc) {
  const byId = new Map();
  visitNodes(doc, (node, _trail, kind) => {
    if (kind !== "node") return;
    if (!byId.has(node.id)) byId.set(node.id, []);
    byId.get(node.id).push(node);
  });
  return byId;
}

function variantToSetMap(doc) {
  const map = new Map();
  for (const relation of doc.relations || []) {
    if (relation.kind !== "component-set-has-variant") continue;
    const setId = relation.from?.id ?? relation.from;
    const variantId = relation.to?.id ?? relation.to;
    if (typeof setId === "string" && typeof variantId === "string") map.set(variantId, setId);
  }
  return map;
}

function setIdOfRelation(relation, variantToSet) {
  return relation.to?.componentSetId || variantToSet.get(relation.to?.id) || null;
}

function setRoleInstances(doc, options = {}) {
  const byId = indexNodes(doc);
  const copies = indexAllCopies(doc);
  const variantToSet = variantToSetMap(doc);
  const signatureRoles = signatureRoleMapFromTable(options.signatureRoles);
  const roleBySet = new Map();
  const unnamedSets = new Set();
  for (const node of byId.values()) {
    if (node.type === "COMPONENT_SET") {
      const prefix = ROLE_PREFIX.exec(String(node.name || ""))?.[1]
        || (hasPrefix(node, node.role) ? node.role : null)
        || signatureRoles.get(componentSetSignature(node))
        || null;
      if (prefix && prefix !== "copy") roleBySet.set(node.id, prefix);
      else unnamedSets.add(node.id);
    }
  }
  const pageIds = new Set((doc.nodes || []).map((node) => node?.id).filter(Boolean));
  const parentOf = new Map();
  for (const node of doc.nodes || []) {
    if (node?.id) parentOf.set(node.id, node.parentId ?? null);
  }
  const fixIds = new Set();
  for (const node of doc.nodes || []) {
    if (node && (node.role === "fix" || String(node.name || "").startsWith("fix/"))) fixIds.add(node.id);
  }
  const underFix = (id) => {
    const seen = new Set();
    let current = id;
    while (current && !seen.has(current)) {
      seen.add(current);
      if (fixIds.has(current)) return true;
      current = parentOf.get(current);
    }
    return false;
  };
  const hits = new Map();
  const add = (node, role, why) => {
    if (!node || node.type !== "INSTANCE" || node.status === "skipped") return;
    if (role === "img" && hasImgAncestor(node, byId)) return;
    const group = copies.get(node.id) || [node];
    const representative = role
      ? group.find((item) => item.status !== "skipped" && !hasPrefix(item, role)) || node
      : group.find((item) => item.status === "determined" && item.role && item.role !== "copy") || node;
    if (!hits.has(node.id)) hits.set(node.id, { node: representative, role, why });
  };
  const instanceOf = (fromId) => (copies.get(fromId) || []).find((node) => node.type === "INSTANCE") || byId.get(fromId);
  for (const relation of doc.relations || []) {
    if (relation.kind !== "instance-uses-variant") continue;
    const setId = setIdOfRelation(relation, variantToSet);
    const role = roleBySet.get(setId);
    if (!role) continue;
    const fromId = relation.from?.id ?? relation.from;
    const node = instanceOf(fromId);
    if (!node || node.type !== "INSTANCE") continue;
    const evidence = `${relation.evidence ?? ""} ${relation.reason ?? ""}`;
    const offPageDef = evidence.includes("outside-shelf") && !pageIds.has(fromId) && relation.from?.scope !== "page";
    if (offPageDef) continue;
    add(node, role, `实例必须跟组件集 ${role}/，不能只给组件集前缀`);
  }
  for (const relation of doc.relations || []) {
    if (relation.kind !== "instance-uses-variant") continue;
    const setId = setIdOfRelation(relation, variantToSet);
    if (!setId || !unnamedSets.has(setId)) continue;
    const fromId = relation.from?.id ?? relation.from;
    const node = instanceOf(fromId);
    if (!node || node.type !== "INSTANCE" || node.status === "skipped") continue;
    if (node.status === "determined" && node.role && node.role !== "copy") {
      add(node, null, "母版组件集未命名，子件不能擅自加前缀");
    }
  }
  for (const node of doc.nodes || []) {
    if (node?.type === "INSTANCE" && rawName(node) === "导航状态" && underFix(node.parentId)) {
      add(node, "btn", "fix/ 下导航项是可点实例");
    }
  }
  return [...hits.values()];
}

function applyPrefix(node, role) {
  if (!role) {
    node.status = "unknown";
    node.role = null;
    node.label = null;
    node.behavior = "none";
    node.name = rawName(node) || node.name;
    return;
  }
  const body = rawName(node) || role;
  node.status = "determined";
  node.role = role;
  node.name = `${role}/${body}`;
  node.label = body;
  if (role === "btn" || role === "hot") node.behavior = "click";
  else if (role === "img" || role === "kv" || role === "bg") node.behavior = "slice";
  else if (role === "scroll") node.behavior = node.behavior && node.behavior.startsWith("scroll") ? node.behavior : "scroll-x";
  else if (role === "switch") node.behavior = "switch";
  else if (role === "ind") node.behavior = "indicator";
  else if (!node.behavior || node.behavior === "none") node.behavior = "none";
}

/** 划动层同父的奖励：纯图才 img/；有字的奖励条外层不标 img/，图走子层。按 parentId 分组，禁止把整页当兄弟。 */
export function applyClipAndRewardPrefixes(doc) {
  const kids = childrenByParent(doc);
  const byParent = new Map();
  visitNodes(doc, (node, _trail, kind) => {
    if (kind !== "node") return;
    const pid = node.parentId ?? "__root__";
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(node);
  });
  let clipFixed = 0;
  let innerFixed = 0;
  let stripped = 0;
  for (const siblings of byParent.values()) {
    const frames = siblings.filter((node) => node && (node.type === "FRAME" || node.type === "GROUP"));
    const clips = frames.filter((node) => CLIP_RE.test(rawName(node)));
    const inners = frames.filter((node) => INNER_REWARD_RE.test(rawName(node)));
    for (const clip of clips) {
      if (!hasPrefix(clip, "scroll")) {
        applyPrefix(clip, "scroll");
        clipFixed += 1;
      }
    }
    if (!clips.length) continue;
    for (const inner of inners) {
      if (isTextRewardContainer(inner, kids)) {
        if (hasPrefix(inner, "img")) {
          applyPrefix(inner, null);
          stripped += 1;
        }
        continue;
      }
      if (!hasPrefix(inner, "img")) {
        applyPrefix(inner, "img");
        innerFixed += 1;
      }
    }
  }
  return { clipFixed, innerFixed, stripped };
}


export function hasImgAncestor(node, byId) {
  const seen = new Set();
  let current = node.parentId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const parent = byId.get(current);
    if (!parent) break;
    if (hasPrefix(parent, "img") || String(parent.name || "").startsWith("img/")) return true;
    current = parent.parentId;
  }
  return false;
}

function childrenByParent(doc) {
  const kids = new Map();
  visitNodes(doc, (node, _trail, kind) => {
    if (kind !== "node" || !node.parentId) return;
    if (!kids.has(node.parentId)) kids.set(node.parentId, []);
    kids.get(node.parentId).push(node);
  });
  return kids;
}

function isTextGroupImgExempt(node) {
  const body = rawName(node);
  const name = String(node.name || "");
  if (/^logo$/i.test(body) || name.startsWith("img/logo")) return true;
  if (node.role === "bg" || node.role === "kv") return true;
  return name.startsWith("bg/") || name.startsWith("kv/");
}

function isVideoFrameWrapper(node) {
  return TEXT_CONTAINER_TYPES.has(node.type) && rawName(node) === "视频框";
}

function isTextRewardContainer(node, kids) {
  if (!INNER_REWARD_RE.test(rawName(node))) return false;
  if (!TEXT_CONTAINER_TYPES.has(node.type)) return false;
  if (isTextGroupImgExempt(node)) return false;
  return hasTextDescendant(node.id, kids);
}

function hasTextDescendant(id, kids) {
  const stack = [...(kids.get(id) || [])];
  const seen = new Set();
  while (stack.length) {
    const child = stack.pop();
    if (seen.has(child.id)) continue;
    seen.add(child.id);
    if (child.type === "TEXT") return true;
    stack.push(...(kids.get(child.id) || []));
  }
  return false;
}

function isAvatarSwitchedCharacter(node) {
  const box = node.box || {};
  const maxEdge = Math.max(Number(box.w) || 0, Number(box.h) || 0);
  const body = rawName(node);
  return (body === "角色立绘模块" || body === "角色") && maxEdge > 400;
}

function characterContentToSwitch(doc) {
  const hits = [];
  visitNodes(doc, (node, _trail, kind) => {
    if (kind !== "node") return;
    if (node.status === "skipped") return;
    if (node.type !== "COMPONENT_SET" && node.type !== "INSTANCE") return;
    if (!isAvatarSwitchedCharacter(node)) return;
    if (hasPrefix(node, "switch")) return;
    hits.push({ node, role: "switch", why: "头像切换所展示的角色内容，不看变体个数" });
  });
  return hits;
}

function innerImagePartsToUnname(doc) {
  const byId = indexNodes(doc);
  const hits = [];
  for (const node of byId.values()) {
    if (node.status === "skipped") continue;
    if (!hasPrefix(node, "img")) continue;
    if (!hasImgAncestor(node, byId)) continue;
    hits.push({ node, role: null, why: "父级已是 img/，内部零件不再标 img/" });
  }
  return hits;
}

function leafImageNodes(doc) {
  const byId = indexNodes(doc);
  const kids = childrenByParent(doc);
  const hits = [];
  for (const node of byId.values()) {
    if (node.status === "skipped") continue;
    if (["TEXT", "COMPONENT_SET", "COMPONENT", "INSTANCE"].includes(node.type)) continue;
    const body = rawName(node);
    if (BORDER_PART_RE.test(body)) continue;
    if (isVideoFrameWrapper(node)) continue;
    if (!IMAGE_BODY_RE.test(body)) continue;
    if (TEXT_CONTAINER_TYPES.has(node.type) && hasTextDescendant(node.id, kids) && !isTextGroupImgExempt(node)) continue;
    if (hasImgAncestor(node, byId)) continue;
    if (hasPrefix(node, "img")) continue;
    hits.push({ node, why: "自身是切图且祖先没有 img/ 前缀" });
  }
  return hits;
}

function videoFrameWrappersToUnname(doc) {
  const hits = [];
  visitNodes(doc, (node, _trail, kind) => {
    if (kind !== "node") return;
    if (!isVideoFrameWrapper(node) || node.status === "skipped") return;
    if (!(node.status === "determined" && node.role && node.role !== "copy")) return;
    hits.push({ node, role: null, why: "视频框外层分组跳过命名，往下挖热区/外框图/按钮/说明" });
  });
  return hits;
}

function groupsWithTextNotImg(doc) {
  const kids = childrenByParent(doc);
  const hits = [];
  visitNodes(doc, (node, _trail, kind) => {
    if (kind !== "node") return;
    if (!TEXT_CONTAINER_TYPES.has(node.type) || node.status === "skipped") return;
    if (!(node.status === "determined" && node.role === "img")) return;
    if (isTextGroupImgExempt(node)) return;
    if (!hasTextDescendant(node.id, kids)) return;
    hits.push({ node, role: null, why: "下面有文字的分组不能直接 img/" });
  });
  return hits;
}

function paintsOf(node) {
  return [
    ...(Array.isArray(node?.fills) ? node.fills : []),
    ...(Array.isArray(node?.style?.fills) ? node.style.fills : []),
  ];
}

function hasImagePaint(node) {
  return paintsOf(node).some((paint) => paint?.type === "IMAGE" || paint?.imageRef || paint?.image?.ref);
}

function nestedEvidence(node) {
  const out = { image: false, text: false, leaves: 0 };
  const seen = new Set();
  const walk = (value) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value.type === "TEXT") out.text = true;
    if (hasImagePaint(value)) out.image = true;
    const kids = [
      ...(Array.isArray(value.nodes) ? value.nodes : []),
      ...(Array.isArray(value.children) ? value.children : []),
    ];
    if (value.id && !kids.length && value.type) out.leaves += 1;
    kids.forEach(walk);
  };
  walk(node);
  return out;
}

function childOverflows(parent, child) {
  const a = parent?.box || {};
  const b = child?.box || {};
  return Number(b.x) < Number(a.x) || Number(b.y) < Number(a.y)
    || Number(b.x) + Number(b.w) > Number(a.x) + Number(a.w)
    || Number(b.y) + Number(b.h) > Number(a.y) + Number(a.h);
}

function repeatedTrack(children) {
  const groups = new Map();
  for (const child of children) {
    if (!child?.box || child.type === "TEXT") continue;
    const box = child.box;
    const key = `${child.type}|${Math.round(Number(box.w) || 0)}|${Math.round(Number(box.h) || 0)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(child);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const xs = group.map((item) => Number(item.box?.x) || 0);
    const ys = group.map((item) => Number(item.box?.y) || 0);
    if (Math.max(...xs) - Math.min(...xs) > 1 || Math.max(...ys) - Math.min(...ys) > 1) {
      return true;
    }
  }
  return false;
}

function geometryScrollHits(doc) {
  const byId = indexNodes(doc);
  const kids = childrenByParent(doc);
  const pageWidth = Number(doc.page?.box?.w) || 0;
  const hits = [];
  for (const node of byId.values()) {
    if (node.status === "skipped" || node.status === "determined") continue;
    if (!["FRAME", "GROUP", "INSTANCE", "COMPONENT"].includes(node.type)) continue;
    if (node.clipsContent !== true) continue;
    const children = kids.get(node.id) || [];
    const nonText = children.filter((child) => child.type !== "TEXT");
    if (nonText.length < 2 || !repeatedTrack(nonText)) continue;
    if (pageWidth > 0 && Number(node.box?.w) >= pageWidth * 0.9) continue;
    const parent = byId.get(node.parentId);
    if (parent?.clipsContent === true) continue;
    if (!nonText.some((child) => childOverflows(node, child))) continue;
    hits.push({ node, role: "scroll", why: "裁切窗 + 重复轨道/子层溢出（结构几何证据）" });
  }
  return hits;
}

function geometryComponentSetHits(doc) {
  const page = doc.page?.box || {};
  const pageWidth = Number(page.w) || 0;
  const pageHeight = Number(page.h) || 0;
  const hits = [];
  for (const node of indexNodes(doc).values()) {
    if (node.type !== "COMPONENT_SET" || node.status === "skipped" || node.status === "determined") continue;
    if ((node.variants || []).length !== 1) continue;
    const evidence = nestedEvidence(node);
    // A title/label component is intentionally left unknown even when it
    // contains decorative image fills.  This is the fail-closed guard that
    // prevents the old one-variant-size heuristic from producing img/.
    if (!evidence.image || evidence.text) continue;
    const width = Number(node.box?.w) || 0;
    const height = Number(node.box?.h) || 0;
    if (pageWidth > 0 && pageHeight > 0 && width >= pageWidth * 0.8 && height >= pageHeight * 0.8) {
      hits.push({ node, role: "bg", why: "单变体组件集：整页级 image paint + 无文字（几何填充证据）" });
    } else {
      hits.push({ node, role: "img", why: "单变体组件集：image paint + 无文字（几何填充证据）" });
    }
  }
  return hits;
}

function geometrySectionHits(doc) {
  const page = doc.page?.box || {};
  const pageWidth = Number(page.w) || 0;
  if (!pageWidth) return [];
  const byId = indexNodes(doc);
  const kids = childrenByParent(doc);
  const groups = [];
  for (const parent of byId.values()) {
    if (parent.status === "skipped" || parent.scope !== "page") continue;
    if ((Number(parent.box?.w) || 0) < pageWidth * 0.9) continue;
    const siblings = (kids.get(parent.id) || []).filter((node) => (
      node.status !== "skipped" && node.scope === "page" && node.type === "FRAME"
      && (Number(node.box?.w) || 0) >= pageWidth * 0.9
    ));
    if (siblings.length < 5) continue;
    const byY = new Map();
    for (const node of siblings) {
      const y = Math.round(Number(node.box?.y) || 0);
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push(node);
    }
    const bands = [...byY.entries()].sort((a, b) => a[0] - b[0]).map(([, nodes]) => nodes[0]);
    if (bands.length < 5) continue;
    let separated = true;
    for (let i = 1; i < bands.length; i += 1) {
      const prev = bands[i - 1].box || {};
      const curr = bands[i].box || {};
      if ((Number(prev.y) || 0) + (Number(prev.h) || 0) > (Number(curr.y) || 0) + 2) separated = false;
    }
    if (!separated) continue;
    groups.push({ parent, bands, byY });
  }
  const hits = [];
  for (const group of groups) {
    const ordered = group.bands.sort((a, b) => (Number(a.box?.y) || 0) - (Number(b.box?.y) || 0));
    ordered.forEach((representative, index) => {
      for (const node of group.byY.get(Math.round(Number(representative.box?.y) || 0)) || []) {
        if (node.status === "unknown") {
          hits.push({ node, role: "sec", number: index + 1, why: "页根同级全宽、纵向不重叠 band（按本稿顺序编号）" });
        }
      }
    });
  }
  return hits;
}

export function geometryEvidenceHits(doc, options = {}) {
  // All geometry/paint roles are collision-prone without a visual binding:
  // title sets can contain image fills, reward rows can look like scroll
  // tracks, and full-width shells can be either sec/ or bg/.  Require an
  // explicit G3 evidence binding before any such writeback; otherwise fail
  // closed and leave the node unknown.
  if (!options.geometryEvidence) return [];
  const hits = [...geometryComponentSetHits(doc)];
  return [...geometryScrollHits(doc), ...hits, ...geometrySectionHits(doc)];
}


function masterIdOf(id) {
  const text = String(id || "");
  const at = text.lastIndexOf(";");
  return at >= 0 ? text.slice(at + 1) : null;
}

function followLayerCopies(doc) {
  const byId = indexNodes(doc);
  const copies = indexAllCopies(doc);
  const hits = [];
  const seen = new Set();
  for (const group of copies.values()) {
    for (const node of group) {
      if (node.status === "skipped") continue;
      const masterId = masterIdOf(node.id);
      if (!masterId) continue;
      const master = byId.get(masterId);
      if (!master || master.status === "skipped") continue;
      const masterNamed = master.status === "determined" && master.role && master.role !== "copy";
      if (masterNamed) {
        if (master.role === "img" && hasImgAncestor(node, byId)) continue;
        if (hasPrefix(node, master.role)) continue;
        const key = `${node.id}::${master.role}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ node, role: master.role, why: `子件必须跟随母版 ${master.role}/` });
        continue;
      }
      if (node.status === "determined" && node.role && node.role !== "copy") {
        const key = `${node.id}::unnamed`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ node, role: null, why: "母版未命名，子件不能擅自加前缀" });
      }
    }
  }
  return hits;
}

/** 作用域根：最近的 sec/ 祖先（name/role 为 sec，无则页根）。ind/ 联动作用域同此定义（naming-spec.md A4）。 */
function scopeRootOf(node, byId) {
  const seen = new Set();
  let current = node.parentId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const parent = byId.get(current);
    if (!parent) break;
    if (String(parent.name || "").startsWith("sec/") || parent.role === "sec") return parent;
    current = parent.parentId;
  }
  return null;
}

/** 页上实例所属的作用域根 id（无 sec 祖先为 "__page"）。 */
function instanceScopeOf(node, byId) {
  const root = scopeRootOf(node, byId);
  return root ? root.id : "__page";
}

/** 按组件集 id 找页上实例（relations instance-uses-variant），返回实例节点数组。 */
function pageInstancesOfSet(doc, byId, setId, variantToSet, pageIds) {
  const instances = [];
  const seen = new Set();
  for (const relation of doc.relations || []) {
    if (relation.kind !== "instance-uses-variant") continue;
    if (setIdOfRelation(relation, variantToSet) !== setId) continue;
    const fromId = relation.from?.id ?? relation.from;
    if (typeof fromId !== "string" || (pageIds && !pageIds.has(fromId))) continue;
    if (seen.has(fromId)) continue;
    seen.add(fromId);
    const inst = byId.get(fromId);
    if (inst && inst.type === "INSTANCE") instances.push(inst);
  }
  return instances;
}

function variantNameById(set) {
  const map = new Map();
  for (const variant of set.variants || []) {
    if (variant && typeof variant.id === "string") map.set(variant.id, String(variant.name || ""));
  }
  return map;
}

function instanceVariantId(instanceId, relations) {
  for (const relation of relations || []) {
    if (relation.kind !== "instance-uses-variant") continue;
    if ((relation.from?.id ?? relation.from) !== instanceId) continue;
    const id = relation.to?.id;
    if (typeof id === "string") return id;
  }
  return null;
}

function uniqueHighlightFamily(set, instances, relations) {
  if (instances.length < 2) return false;
  const names = variantNameById(set);
  let active = 0;
  for (const inst of instances) {
    const variantId = instanceVariantId(inst.id, relations);
    const name = (variantId && names.get(variantId)) || "";
    if (!name) return false;
    if (isActiveVariantName(name)) active += 1;
  }
  return active === 1;
}

function setNameRole(set) {
  return ROLE_PREFIX.exec(String(set?.name || ""))?.[1] || (hasPrefix(set, set?.role) ? set.role : null);
}

/** 未命名状态对实例族：不靠外观、标题、赛季名或固定 node id。 */
function unlabeledControlFamiliesByScope(doc, byId, variantToSet, pageIds) {
  const byScope = new Map();
  for (const set of byId.values()) {
    if (set.type !== "COMPONENT_SET" || set.status === "skipped") continue;
    if (!isStatePairNode(set)) continue;
    const role = setNameRole(set);
    if (role && role !== "ind") continue;
    const instances = pageInstancesOfSet(doc, byId, set.id, variantToSet, pageIds);
    if (instances.length < 2) continue;
    const scoped = new Map();
    for (const inst of instances) {
      if (hasPrefix(inst, "btn") || hasPrefix(inst, "tab") || hasPrefix(inst, "switch")) continue;
      const scopeId = instanceScopeOf(inst, byId);
      if (!scoped.has(scopeId)) scoped.set(scopeId, []);
      scoped.get(scopeId).push(inst);
    }
    for (const [scopeId, group] of scoped) {
      if (group.length < 2) continue;
      if (!uniqueHighlightFamily(set, group, doc.relations)) continue;
      if (!byScope.has(scopeId)) byScope.set(scopeId, []);
      byScope.get(scopeId).push({ set, instances: group });
    }
  }
  return byScope;
}

/**
 * 内容组件集结构判定（issue #22 / #25）。同一作用域（最近 sec/ 祖先，无则页根）内：
 * - 恰好一个待判内容集（variant>=2 且 !isStatePair；已 switch/ 的也占名额）
 * - 恰好一组控制族（已确定的 ind/ 或 tab/，或未命名且唯一高亮的状态对实例族）
 * - 控制点数 = variant 数 → switch/，并把未命名控制族升 ind/
 * - 数量冲突 → 保持 unknown 并记录 conflicts
 * 返回 { switchSets, indicatorSets, conflicts }
 */
export function controlledContentSwitch(doc) {
  const byId = indexNodes(doc);
  const sets = [];
  for (const set of byId.values()) {
    if (set.type !== "COMPONENT_SET") continue;
    const labels = variantLabels(set);
    if (labels.length < 2 || isStatePairNode(set)) continue;
    if (set.status === "skipped") continue;
    sets.push({ set, labels });
  }
  const control = [];
  for (const node of doc.nodes || []) {
    if (hasPrefix(node, "ind") || hasPrefix(node, "tab")) control.push(node);
  }
  const byScope = new Map();
  for (const node of control) {
    const scopeId = instanceScopeOf(node, byId);
    if (!byScope.has(scopeId)) byScope.set(scopeId, { ind: [], tab: [] });
    byScope.get(scopeId)[hasPrefix(node, "tab") ? "tab" : "ind"].push(node);
  }
  const variantToSet = variantToSetMap(doc);
  const pageIds = new Set((doc.nodes || []).map((node) => node?.id).filter(Boolean));
  const setByScope = new Map();
  for (const item of sets) {
    const instances = pageInstancesOfSet(doc, byId, item.set.id, variantToSet, pageIds);
    if (!instances.length) continue;
    const scopes = new Set(instances.map((inst) => instanceScopeOf(inst, byId)));
    if (scopes.size !== 1) continue;
    const scopeId = [...scopes][0];
    if (!setByScope.has(scopeId)) setByScope.set(scopeId, []);
    setByScope.get(scopeId).push(item);
  }
  const familiesByScope = unlabeledControlFamiliesByScope(doc, byId, variantToSet, pageIds);
  const switchSets = new Map();
  const indicatorSets = new Map();
  const conflicts = [];
  for (const [scopeId, items] of setByScope) {
    if (items.length !== 1) continue;
    const variants = items[0].labels.length;
    const ctrl = byScope.get(scopeId);
    const hasInd = Boolean(ctrl?.ind.length);
    const hasTab = Boolean(ctrl?.tab.length);
    if (hasInd && hasTab) continue;
    if (hasInd || hasTab) {
      const namedNodes = hasInd ? ctrl.ind : ctrl.tab;
      const namedIds = new Set(namedNodes.map((node) => node.id));
      const extraFamilies = (familiesByScope.get(scopeId) || []).filter((family) => (
        family.instances.some((inst) => !namedIds.has(inst.id))
      ));
      if (extraFamilies.length) continue;
      const count = namedNodes.length;
      if (count !== variants) {
        conflicts.push({ setId: items[0].set.id, pageCount: variants, controlCount: count });
        continue;
      }
      switchSets.set(items[0].set.id, items[0].set);
      continue;
    }
    const families = familiesByScope.get(scopeId) || [];
    if (families.length !== 1) continue;
    const count = families[0].instances.length;
    if (count !== variants) {
      conflicts.push({ setId: items[0].set.id, pageCount: variants, controlCount: count });
      continue;
    }
    switchSets.set(items[0].set.id, items[0].set);
    if (!setNameRole(families[0].set) || setNameRole(families[0].set) === "ind") {
      indicatorSets.set(families[0].set.id, families[0].set);
    }
  }
  return { switchSets, indicatorSets, conflicts };
}

function classKey(node) {
  const body = rawName(node);
  if (!body) return null;
  return `${node.type}::${body}`;
}

export function classRoleMapFromTable(table) {
  const map = new Map();
  const dropped = new Set();
  for (const entry of table?.entries || []) {
    if (!entry?.type || !entry?.body || !entry?.role || entry.role === "copy") continue;
    const key = `${entry.type}::${entry.body}`;
    if (dropped.has(key)) continue;
    if (map.has(key) && map.get(key) !== entry.role) {
      map.delete(key);
      dropped.add(key);
      continue;
    }
    map.set(key, entry.role);
  }
  return map;
}

function asClassRoleMap(classRoles) {
  if (!classRoles) return new Map();
  if (classRoles instanceof Map) return classRoles;
  return classRoleMapFromTable(classRoles);
}

export function goldClassRoleHits(doc, classRoles, options = {}) {
  const map = asClassRoleMap(classRoles);
  const signatureRoles = signatureRoleMapFromTable(options.signatureRoles);
  if (!map.size) return [];
  const byId = indexNodes(doc);
  const kids = childrenByParent(doc);
  const hits = [];
  for (const node of byId.values()) {
    if (node.status === "skipped") continue;
    if (node.status === "determined" && node.role && node.role !== "copy") continue;
    if (node.type === "COMPONENT_SET") {
      const signature = componentSetSignature(node);
      // New multi-variant shapes may not borrow a role from a name-only class
      // table.  Single-variant sets remain eligible when their exact class is
      // unique; known structural signatures are handled before this fallback.
      if (!signatureRoles.has(signature) && (node.variants || []).length !== 1) continue;
    }
    const key = classKey(node);
    const role = key ? map.get(key) : null;
    if (!role) continue;
    if (role === "img" && node.type === "COMPONENT_SET" && (node.variants || []).length === 1) {
      const evidence = nestedEvidence(node);
      if (!evidence.image || evidence.text) continue;
    }
    if (role === "img" && (isTextRewardContainer(node, kids) || isVideoFrameWrapper(node) || hasImgAncestor(node, byId))) continue;
    hits.push({ node, role, why: `金样同类 ${node.type}+${rawName(node)} 唯一前缀 ${role}/` });
  }
  return hits;
}

export function auditGoldClassRoles(doc, classRoles, options = {}) {
  const problems = [];
  for (const { node, role, why } of goldClassRoleHits(doc, classRoles, options)) {
    expectPrefix(node, role, problems, why);
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

export function determinedClassRoles(doc) {
  const byId = indexNodes(doc);
  const kids = childrenByParent(doc);
  const roles = new Map();
  for (const node of byId.values()) {
    if (node.status !== "determined" || !node.role || node.role === "copy") continue;
    if (node.role === "img" && (isTextRewardContainer(node, kids) || isVideoFrameWrapper(node) || hasImgAncestor(node, byId))) continue;
    const key = classKey(node);
    if (!key) continue;
    if (!roles.has(key)) roles.set(key, new Set());
    roles.get(key).add(node.role);
  }
  const unique = new Map();
  for (const [key, set] of roles) {
    if (set.size === 1) unique.set(key, [...set][0]);
  }
  return unique;
}

export function syncClassHits(sourceDoc, targetDoc) {
  const src = determinedClassRoles(sourceDoc);
  const byId = indexNodes(targetDoc);
  const kids = childrenByParent(targetDoc);
  const hits = [];
  // Cross-end sync is structural first: copied shelves often have different
  // designer names (or fully generic names), but the component-set topology
  // and relation graph remain equivalent.
  for (const hit of setRoleInstances(targetDoc, { signatureRoles: determinedSignatureRoles(sourceDoc) })) {
    if (!hits.some((row) => row.node.id === hit.node.id && row.role === hit.role)) hits.push(hit);
  }
  for (const node of byId.values()) {
    if (node.status !== "unknown") continue;
    const key = classKey(node);
    const role = key ? src.get(key) : null;
    if (!role) continue;
    if (role === "img" && (isTextRewardContainer(node, kids) || isVideoFrameWrapper(node) || hasImgAncestor(node, byId))) continue;
    hits.push({ node, role, why: `与另一端同类 ${role}/ 同步` });
  }
  return hits;
}

export function auditCrossEndClassSync(docs) {
  const list = (Array.isArray(docs) ? docs : [docs]).filter(Boolean);
  const problems = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = 0; j < list.length; j += 1) {
      if (i === j) continue;
      for (const { node, role, why } of syncClassHits(list[i], list[j])) {
        expectPrefix(node, role, problems, why);
      }
    }
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

export function auditDraftGoldMorphology(doc, options = {}) {
  const problems = [];
  const signatureRoles = signatureRoleMapFromTable(options.signatureRoles);
  const outside = new Set();
  for (const relation of doc.relations || []) {
    const evidence = `${relation.reason ?? ""} ${relation.evidence ?? ""} ${relation.note ?? ""}`;
    if (evidence.includes("outside-shelf") || evidence.includes("definition-outside-shelf")) {
      const fromId = relation.from?.id ?? relation.from;
      if (typeof fromId === "string") outside.add(fromId);
    }
  }

  const kids = childrenByParent(doc);
  const contentSwitch = controlledContentSwitch(doc);
  for (const { node, role, why } of signatureHits(doc, signatureRoles)) {
    expectPrefix(node, role, problems, why);
  }
  for (const { node, role, why } of geometryEvidenceHits(doc, options)) {
    expectPrefix(node, role, problems, why);
  }
  const flagInnerReward = (inner) => {
    if (isTextRewardContainer(inner, kids)) return;
    if (inner.status === "determined" && inner.role === "scroll") {
      problems.push(`${inner.id}「${inner.name}」是裁切层里的奖励图，前缀必须是 img/，scroll/ 只写在划动层`);
    }
  };
  const childFrames = (parent) => {
    const frames = [];
    for (const key of ["nodes", "kids"]) {
      for (const item of parent[key] || []) {
        if (item && item.type === "FRAME") frames.push(item);
      }
    }
    return frames;
  };

  visitNodes(doc, (node, trail, kind) => {
    if (kind === "siblings") {
      const frames = node.filter((item) => item && item.type === "FRAME");
      const clips = frames.filter((item) => CLIP_RE.test(rawName(item)));
      const inners = frames.filter((item) => INNER_REWARD_RE.test(rawName(item)));
      for (const clip of clips) {
        expectPrefix(clip, "scroll", problems, "划动裁切层");
      }
      if (clips.length) inners.forEach(flagInnerReward);
      return;
    }
    if (CLIP_RE.test(rawName(node))) {
      expectPrefix(node, "scroll", problems, "划动裁切层");
      childFrames(node).filter((item) => INNER_REWARD_RE.test(rawName(item))).forEach(flagInnerReward);
    }
    if (INNER_REWARD_RE.test(rawName(node)) && trail.some((name) => CLIP_RE.test(name))) {
      flagInnerReward(node);
    }
    const type = node.type;
    const box = node.box || {};
    const w = Number(box.w);
    const h = Number(box.h);
    const labels = variantLabels(node);
    const pageBox = doc.page?.box;
    const onPage = pageBox && box.w >= 0 && box.h >= 0 &&
      box.x + box.w >= pageBox.x && box.x <= pageBox.x + pageBox.w &&
      box.y + box.h >= pageBox.y && box.y <= pageBox.y + pageBox.h;
    if (outside.has(node.id) && node.status === "determined" && node.role === "btn" && !onPage) {
      problems.push(`${node.id}「${node.name}」跨货架导航定义必须保持 unknown`);
    }

    if (type === "COMPONENT_SET") {
      const setPrefix = ROLE_PREFIX.exec(String(node.name || ""))?.[1];
      const variantPrefixes = labels.map((label) => ROLE_PREFIX.exec(label)?.[1]).filter(Boolean);
      if (setPrefix && setPrefix !== "copy") {
        expectPrefix(node, setPrefix, problems, "组件集");
      } else if (variantPrefixes.length === labels.length && labels.length > 0 && new Set(variantPrefixes).size === 1) {
        expectPrefix(node, variantPrefixes[0], problems, "组件集变体已有统一前缀");
      } else if (isAvatarSwitchedCharacter(node)) {
        expectPrefix(node, "switch", problems, "头像切换所展示的角色内容，不看变体个数");
      } else if (labels.length >= 2 && !isStatePairNode(node)) {
        if (contentSwitch.switchSets.has(node.id)) {
          expectPrefix(node, "switch", problems, "多变体内容组件集（作用域内一组控制点且数量对齐）");
        } else {
          const conflict = contentSwitch.conflicts.find((item) => item.setId === node.id);
          if (conflict) {
            problems.push(`${node.id}「${node.name}」${conflict.pageCount} 页 / ${conflict.controlCount} 个控制点数量冲突，保持 unknown`);
          }
        }
      } else if (contentSwitch.indicatorSets.has(node.id)) {
        expectPrefix(node, "ind", problems, "作用域内与内容集数量对齐且唯一高亮的控制点");
      } else if (isStatePairNode(node) && Math.max(w || 0, h || 0) > 0 && Math.max(w, h) < 250) {
        expectPrefix(node, "ind", problems, "小尺寸状态点组件集");
      } else if (isStatePairNode(node)) {
        expectPrefix(node, "btn", problems, "选中/未选中状态组件集");
      }
    }

    if (node.role === "modal" || (type === "FRAME" && String(node.name || "").includes("弹窗"))) {
      expectPrefix(node, "modal", problems, "弹窗附件");
    }

    if (node.role === "hot" && w > 0 && h > 0 && w < 120 && h < 120) {
      problems.push(`${node.id}「${node.name}」小尺寸播放控制应是 btn/ 前缀，不是 hot/`);
    }
  });

  for (const { node, role, why } of setRoleInstances(doc, { signatureRoles })) {
    if (!role) {
      if (node.status === "determined" && node.role && node.role !== "copy") {
        problems.push(`${node.id}「${node.name}」${why}`);
      }
      continue;
    }
    expectPrefix(node, role, problems, why);
  }
  for (const { node, why } of leafImageNodes(doc)) {
    expectPrefix(node, "img", problems, why);
  }
  for (const { node, why } of innerImagePartsToUnname(doc)) {
    problems.push(`${node.id}「${node.name}」${why}`);
  }
  for (const { node, why } of videoFrameWrappersToUnname(doc)) {
    problems.push(`${node.id}「${node.name}」${why}`);
  }
  for (const { node, why } of groupsWithTextNotImg(doc)) {
    problems.push(`${node.id}「${node.name}」${why}`);
  }
  for (const { node, role, why } of followLayerCopies(doc)) {
    if (!role) {
      if (node.status === "determined" && node.role && node.role !== "copy") {
        problems.push(`${node.id}「${node.name}」${why}`);
      }
      continue;
    }
    expectPrefix(node, role, problems, why);
  }

  const unique = [...new Set(problems)];
  return { ok: unique.length === 0, problems: unique };
}

function applyHit(copies, { node, role, why, number }, applied) {
  const group = copies.get(node.id) || [node];
  for (const item of group) {
    if (!role) {
      if (!(item.status === "determined" && item.role && item.role !== "copy")) continue;
      applyPrefix(item, null);
      applied.push({ id: item.id, name: item.name, role: null, why });
      continue;
    }
    if (hasPrefix(item, role)) continue;
    applyPrefix(item, role);
    if (role === "sec" && Number.isInteger(number)) {
      item.name = `sec/${number}`;
      item.label = String(number);
    }
    applied.push({ id: item.id, name: item.name, role, why });
  }
}

/** 静默补：任意组件集实例 + I…;母版Id 子件跟随母版。不要拿这类漏项问人。 */
export function applyDraftGoldMorphology(doc, options = {}) {
  const classRoles = asClassRoleMap(options.classRoles);
  const signatureRoles = signatureRoleMapFromTable(options.signatureRoles);
  const applied = [];
  for (let pass = 0; pass < 5; pass += 1) {
    const before = applied.length;
    const copies = indexAllCopies(doc);
    for (const hit of signatureHits(doc, signatureRoles)) applyHit(copies, hit, applied);
    for (const hit of geometryEvidenceHits(doc, options)) applyHit(copies, hit, applied);
    const detected = controlledContentSwitch(doc);
    for (const set of detected.indicatorSets.values()) {
      applyHit(copies, { node: set, role: "ind", why: "作用域内与内容集数量对齐且唯一高亮的控制点" }, applied);
    }
    for (const hit of setRoleInstances(doc, { signatureRoles })) applyHit(copies, hit, applied);
    for (const hit of characterContentToSwitch(doc)) applyHit(copies, hit, applied);
    for (const set of detected.switchSets.values()) {
      applyHit(copies, { node: set, role: "switch", why: "多变体内容组件集（作用域内一组控制点且数量对齐）" }, applied);
    }
    for (const { node, why } of leafImageNodes(doc)) applyHit(copies, { node, role: "img", why }, applied);
    for (const hit of videoFrameWrappersToUnname(doc)) applyHit(copies, hit, applied);
    for (const hit of innerImagePartsToUnname(doc)) applyHit(copies, hit, applied);
    for (const hit of goldClassRoleHits(doc, classRoles, { signatureRoles })) applyHit(copies, hit, applied);
    for (const hit of groupsWithTextNotImg(doc)) applyHit(copies, hit, applied);
    for (const hit of followLayerCopies(doc)) applyHit(copies, hit, applied);
    if (applied.length === before) break;
  }
  rebuildInventoryIndexes(doc);
  return { applied };
}

export function applyCrossEndClassSync(sourceDoc, targetDoc, options = {}) {
  const applied = [];
  const copies = indexAllCopies(targetDoc);
  for (const hit of syncClassHits(sourceDoc, targetDoc)) {
    applyHit(copies, hit, applied);
  }
  const again = applyDraftGoldMorphology(targetDoc, options);
  return { applied: [...applied, ...again.applied] };
}

export function recountStatuses(doc) {
  rebuildInventoryIndexes(doc);
  return { ...(doc.counts || {}) };
}

/** PC/mobile 写回收口：金样同类层 + 跟随母版 + 两端同类同步。 */
export function finalizeDraftWriteback(docs, options = {}) {
  const list = (Array.isArray(docs) ? docs : [docs]).filter(Boolean);
  const morphOpts = {
    classRoles: asClassRoleMap(options.classRoles),
    signatureRoles: signatureRoleMapFromTable(options.signatureRoles),
  };
  const applied = list.map(() => []);
  for (let i = 0; i < list.length; i += 1) {
    applied[i].push(...applyDraftGoldMorphology(list[i], morphOpts).applied);
    applyClipAndRewardPrefixes(list[i]);
  }
  if (list.length >= 2) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = 0; j < list.length; j += 1) {
        if (i === j) continue;
        applied[j].push(...applyCrossEndClassSync(list[i], list[j], morphOpts).applied);
      }
    }
    for (const doc of list) applyClipAndRewardPrefixes(doc);
  }
  const counts = list.map((doc) => recountStatuses(doc));
  return { applied, counts };
}
