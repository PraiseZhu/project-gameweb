/**
 * 未规范新稿闸门：只核前缀。后缀不作对错标准。
 * 金样唯一 type+剥前缀名可写回前缀；不对图层 id，不对 sec/N 抄名。
 * 已知结构漏了前缀 → 红。
 */
import { rebuildInventoryIndexes } from "./inventory.mjs";
import { stampJudgment } from "./judgment.mjs";
import {
  loadClassRoles,
  loadSettledRules,
  loadSignatureEvidence,
  loadSignatureRoles,
} from "./module-catalog.mjs";
import {
  componentSetSignature,
  componentSetSignatureInDoc,
  determinedSignatureRoles,
  isStatePair as isStructuralStatePair,
  signatureRoleMapFromTable,
  signatureHits,
} from "./structural-signature.mjs";

const ROLE_PREFIX = /^(bg|btn|dyn|fix|hot|img|ind|kv|mix|modal|ref|scroll|sec|switch|tab|copy)\//;
const CARD_ART_RE = /^(素材图|素材|边框背景\d*|背景边框|立绘)$/;
/** 组件身份前缀：实例有证据时可回写母版。sec/bg/scroll/fix/kv 是位置类，母版不跟。 */
const IDENTITY_ROLES = new Set(["btn", "img", "ind", "switch", "tab", "modal", "mix", "dyn", "hot"]);

function rawName(node) {
  return String(node?.name ?? "").replace(ROLE_PREFIX, "").trim();
}

/** Figma 默认名只作无名占位符；默认名禁止消费 class-roles。 */
export function isGenericLayerName(nameOrNode) {
  const body = rawName(typeof nameOrNode === "string" ? { name: nameOrNode } : nameOrNode);
  return /^(?:Frame|Group|Rectangle|Ellipse|Vector|Line|Star|Polygon|Union|Slice|Mask|Instance|Component|组|矩形|框架|实例|组件)(?:\s*\d+)?$/i.test(body);
}

function structuralNameAllowed(node) {
  const body = rawName(node);
  return isGenericLayerName(node) || /^\d+$/.test(body);
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
// A small legacy pure-image vocabulary remains valid for named leaves when
// no stronger attachment/paint evidence is available. Keep this closed and
// exclude component sets/instances below so one-variant title sets and
// interactive wrappers do not become img/ by name alone.
const PURE_IMAGE_NAME_RE = /^(?:卡牌|头像图|Icon_SSR(?:\s+\d+)?|BG)$/;
// A named visual may differ between the gold and baseline shelves (for
// example "视频框 3" vs "视频框"), but it is still eligible for an exact
// G3 local signature.  This is deliberately a closed vocabulary: arbitrary
// named layers must not consume the broad img evidence buckets.
const NAMED_VISUAL_LOCAL_RE = /^(?:背景|折扣标背景|日历可滑动内容|视频框\s*\d*|边框背景\s*\d*|弹窗背景|兑换码背景|BG)$/i;
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
  const signatureRoles = mergeSignatureRoleMaps(options.signatureRoles, options.signatureEvidence);
  const classRoles = asClassRoleMap(options.classRoles);
  const roleBySet = new Map();
  const unnamedSets = new Set();
  const conflictedSets = new Set();
  for (const node of byId.values()) {
    if (node.type === "COMPONENT_SET") {
      const signatureRole = isGenericLayerName(node)
        ? (signatureRoles.get(componentSetSignatureInDoc(doc, node))
          || signatureRoles.get(componentSetSignatureInDoc(doc, node)?.replace(/\|props=[^|]*\|tree=.*$/, ""))
          || null)
        : null;
      const namedRole = !isGenericLayerName(node) ? classRoles.get(classKey(node)) || null : null;
      const prefix = ROLE_PREFIX.exec(String(node.name || ""))?.[1]
        || (hasPrefix(node, node.role) ? node.role : null)
        || namedRole
        || signatureRole
        || null;
      if (namedRole && signatureRole && namedRole !== signatureRole) {
        conflictedSets.add(node.id);
        unnamedSets.add(node.id);
        continue;
      }
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
    if (!node || node.status === "skipped") return;
    if (node.type !== "INSTANCE" && node.type !== "COMPONENT_SET") return;
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
    if (conflictedSets.has(setId)) {
      const fromId = relation.from?.id ?? relation.from;
      const node = instanceOf(fromId);
      if (node && node.type === "INSTANCE") add(node, null, "名字通道与结构签名冲突，保持 unknown");
      continue;
    }
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
  const unnamedRoles = new Map();
  for (const relation of doc.relations || []) {
    if (relation.kind !== "instance-uses-variant") continue;
    const setId = setIdOfRelation(relation, variantToSet);
    if (!setId || !unnamedSets.has(setId)) continue;
    const fromId = relation.from?.id ?? relation.from;
    const node = instanceOf(fromId);
    if (!node || node.type !== "INSTANCE" || node.status === "skipped") continue;
    if (!(node.status === "determined" && node.role && node.role !== "copy")) continue;
    if (!unnamedRoles.has(setId)) unnamedRoles.set(setId, { set: byId.get(setId), roles: new Set(), instances: [] });
    const row = unnamedRoles.get(setId);
    row.roles.add(node.role);
    row.instances.push(node);
  }
  for (const { set, roles, instances } of unnamedRoles.values()) {
    // A child prefix is not enough evidence to name an unknown component set.
    // In particular, title/decorative sets must remain unknown even when an
    // instance arrived pre-labelled img/.  Only an independently named or
    // unique structural signature may establish the set role.
    for (const node of instances) {
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

function hasImgAncestorAcrossCopies(node, copies) {
  const seen = new Set();
  let current = node?.parentId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const parents = copies.get(current) || [];
    if (parents.some((parent) => hasPrefix(parent, "img") || String(parent.name || "").startsWith("img/"))) return true;
    current = parents[0]?.parentId || null;
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

export function isTextGroupImgExempt(node) {
  const body = rawName(node);
  const name = String(node.name || "");
  if (/^logo$/i.test(body) || name.startsWith("img/logo")) return true;
  if (body === "兑换码背景") return true;
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
  const copies = indexAllCopies(doc);
  const hits = [];
  for (const node of byId.values()) {
    if (node.status === "skipped") continue;
    if (!hasPrefix(node, "img")) continue;
    // Sparse attachment copies can report an unrelated img/ ancestor for
    // icon internals whose page parent is still unknown.  Keep those leaves
    // fail-closed instead of raising a false completeness error.
    let parentId = node.parentId;
    let underIcon = false;
    let underCrossEndSync = false;
    const seen = new Set();
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (rawName(parent) === "icon") { underIcon = true; break; }
      if (parent?.via === "cross-end-sync") { underCrossEndSync = true; break; }
      parentId = parent?.parentId || null;
    }
    if (underIcon || underCrossEndSync) continue;
    if (!hasImgAncestorAcrossCopies(node, copies)) continue;
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
    if (node.status === "determined" && node.role && node.role !== "copy" && isGenericLayerName(node)) continue;
    if (["TEXT", "COMPONENT_SET", "COMPONENT", "INSTANCE"].includes(node.type)) continue;
    const body = rawName(node);
    if (BORDER_PART_RE.test(body)) continue;
    if (isVideoFrameWrapper(node)) continue;
    // Name text is not sufficient evidence for a scattered image layer:
    // legacy body vocabulary used to turn skipped decorative containers
    // (icon/头像/小按钮/素材) into extra img/ predictions.  Only a generic
    // node with an actual IMAGE paint is name-free evidence.  Preserve the
    // narrow, already-settled exception for a named image leaf directly inside
    // a determined btn/ (button chrome / playback art); other true names must
    // arrive through the unique class-role channel or explicit G3 evidence.
    const imageEvidence = isGenericLayerName(node) && hasImagePaint(node)
      && Math.max(Number(node.box?.w) || 0, Number(node.box?.h) || 0) >= 100;
    const namedCardEvidence = !isGenericLayerName(node)
      && CARD_ART_RE.test(body)
      && (hasImagePaint(node) || hasImageDescendant(node, kids));
    const namedPureImageEvidence = !isGenericLayerName(node)
      && PURE_IMAGE_NAME_RE.test(body)
      && ["RECTANGLE", "FRAME", "GROUP", "BOOLEAN_OPERATION"].includes(node.type)
      // Keep the vocabulary fallback limited to sparse morphology fixtures;
      // real shelves carry bounds and must provide IMAGE paint/G3 evidence.
      && !node.box
      && !hasTextDescendant(node.id, kids);
    const parent = byId.get(node.parentId);
    const buttonChromeEvidence = !isGenericLayerName(node)
      && IMAGE_BODY_RE.test(body)
      && parent?.status === "determined"
      && parent.role === "btn"
      // Real shelves carry bounds; retain the no-box fixture exception used
      // by the morphology tests, but do not promote named, bounded chrome
      // leaves that repeatedly show up as extras in cross-shelf eval.
      && !node.box;
    if (!imageEvidence && !namedCardEvidence && !namedPureImageEvidence && !buttonChromeEvidence) continue;
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

function groupsWithTextNotImg(doc, evidence = null) {
  const kids = childrenByParent(doc);
  const allowTextSignatures = new Set((evidence?.entries || [])
    .filter((entry) => entry?.allowText === true && entry.signature)
    .map((entry) => entry.signature));
  const hits = [];
  visitNodes(doc, (node, _trail, kind) => {
    if (kind !== "node") return;
    if (!TEXT_CONTAINER_TYPES.has(node.type) || node.status === "skipped") return;
    if (!(node.status === "determined" && node.role === "img")) return;
    if (isTextGroupImgExempt(node)) return;
    if (node.via === "cross-end-sync") return;
    if (!hasTextDescendant(node.id, kids)) return;
    if (allowTextSignatures.has(localStructureSignature(doc, node))
      && (isGenericLayerName(node) || rawName(node) === "背景"
        || rawName(node) === "BG" || rawName(node) === "兑换码背景")) return;
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

function hasImageDescendant(node, kids, seen = new Set()) {
  if (!node?.id || seen.has(node.id)) return false;
  seen.add(node.id);
  for (const child of kids.get(node.id) || []) {
    if (hasImagePaint(child) || hasImageDescendant(child, kids, seen)) return true;
  }
  return false;
}

/**
 * Avatar/button internals: once the outer INSTANCE is structurally proven to
 * be btn/, an anonymous image-only GROUP/FRAME immediately below it may be
 * the clickable artwork (avatar, locked avatar, icon artwork).  This is
 * deliberately narrower than leafImageNodes: generic names alone are not
 * enough; the parent relationship, image paint and no-text guard must all
 * agree.  Named layers stay on the name channel.
 */
function buttonImageGroupHits(doc, evidence = null) {
  const byId = indexNodes(doc);
  const kids = childrenByParent(doc);
  const evidenceMap = signatureRoleMapFromTable(evidence);
  const hits = [];
  const descendants = (root) => {
    const out = [];
    const stack = [...(kids.get(root.id) || [])];
    const seen = new Set();
    while (stack.length) {
      const child = stack.pop();
      if (!child || seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      stack.push(...(kids.get(child.id) || []));
    }
    return out;
  };
  for (const node of byId.values()) {
    if (node.status === "skipped" || node.status === "determined") continue;
    if (!structuralNameAllowed(node) || !["GROUP", "FRAME"].includes(node.type)) continue;
    const signature = localStructureSignature(doc, node);
    if (!signature || evidenceMap.get(signature) !== "img") continue;
    const parent = byId.get(node.parentId);
    if (!parent || parent.type !== "INSTANCE" || parent.status !== "determined" || parent.role !== "btn") continue;
    const nested = descendants(node);
    const all = [node, ...nested];
    if (all.some((item) => item.type === "TEXT")) continue;
    const imageLeaves = all.filter((item) => hasImagePaint(item));
    if (!imageLeaves.length) continue;
    const parentBox = parent.box || {};
    const box = node.box || {};
    const parentArea = Math.max(1, (Number(parentBox.w) || 0) * (Number(parentBox.h) || 0));
    const area = (Number(box.w) || 0) * (Number(box.h) || 0);
    if (area < parentArea * 0.35) continue;
    hits.push({ node, role: "img", why: "btn 实例内无文字、含 IMAGE 叶子的局部图像组（头像/按钮图像结构证据）" });
  }
  return hits;
}

/**
 * Local page-slice signature for scattered controls/assets.  It deliberately
 * excludes names and ids; G3 evidence must opt a bucket in before writeback.
 */
export function localStructureSignature(doc, node) {
  if (!node?.type || !node.box) return null;
  let cache = localSignatureCache.get(doc);
  if (!cache) {
    cache = new Map();
    localSignatureCache.set(doc, cache);
  }
  if (cache.has(node.id)) return cache.get(node.id);
  let context = localContextCache.get(doc);
  if (!context) {
    context = { byId: indexNodes(doc), kids: childrenByParent(doc) };
    localContextCache.set(doc, context);
  }
  const { byId, kids } = context;
  const parent = byId.get(node.parentId);
  const direct = kids.get(node.id) || [];
  const stack = [...direct];
  const descendants = [];
  while (stack.length) {
    const child = stack.pop();
    if (!child) continue;
    descendants.push(child);
    stack.push(...(kids.get(child.id) || []));
  }
  const page = doc.page?.box || {};
  const pageW = Number(page.w) || 1;
  const pageH = Number(page.h) || 1;
  const box = node.box || {};
  const px = (Number(box.x) - Number(page.x)) / pageW;
  const py = (Number(box.y) - Number(page.y)) / pageH;
  const pageX = px < 0.25 ? "left" : px < 0.62 ? "center" : px < 0.76 ? "center-right" : "right";
  const pageY = py < 0.15 ? "upper" : py < 0.45 ? "middle" : "lower";
  const parentBox = parent?.box || {};
  const rw = parentBox.w ? Number(box.w) / Number(parentBox.w) : 0;
  const rh = parentBox.h ? Number(box.h) / Number(parentBox.h) : 0;
  const width = rw >= 0.8 ? "full" : rw >= 0.2 ? "wide" : rw >= 0.08 ? "small" : "tiny";
  const height = rh >= 0.8 ? "full" : rh >= 0.3 ? "tall" : rh >= 0.12 ? "medium" : rh >= 0.05 ? "short" : "tiny";
  const childTypes = [...new Set(direct.map((child) => child.type))]
    .sort()
    .map((type) => `${type}:${direct.filter((child) => child.type === type).length}`)
    .join(",") || "-";
  const text = descendants.some((child) => child.type === "TEXT") ? 1 : 0;
  const image = hasImagePaint(node) || descendants.some((child) => hasImagePaint(child));
  const signature = [
    "LOCAL",
    `type=${node.type}`,
    `parent=${parent?.type || "ROOT"}`,
    `pageX=${pageX}`,
    `pageY=${pageY}`,
    `w=${width}`,
    `h=${height}`,
    `text=${text}`,
    `image=${image ? 1 : 0}`,
    `children=${childTypes}`,
  ].join("|");
  cache.set(node.id, signature);
  return signature;
}

const localSignatureCache = new WeakMap();
const localContextCache = new WeakMap();

function localEvidenceHits(doc, evidence) {
  const map = signatureRoleMapFromTable(evidence);
  if (!map.size) return [];
  // Some reviewed buckets are intentionally name-free only.  Keep their
  // evidence from widening the named regression ruler (for example the
  // calendar scroll bucket whose shelf name is not a stable gold class).
  const genericOnlySignatures = new Set((evidence?.entries || [])
    .filter((entry) => entry?.genericOnly === true && entry.signature)
    .map((entry) => entry.signature));
  const namedFallbackRoles = new Set(["btn", "tab", "modal", "scroll", "fix", "dyn"]);
  const kids = childrenByParent(doc);
  const hits = new Map();
  // A node id can occur in both a rich attachment record and a sparse page
  // copy. The rich record may retain the designer name while the page copy is
  // the generic-name clone used for structure judging. Scan all copies so one
  // eligible generic representation binds the id; applyHit propagates the
  // decision to every copy.
  visitNodes(doc, (node, _trail, kind) => {
    if (kind !== "node") return;
    if (node.status === "determined" && node.role && node.role !== "copy") return;
    const generic = isGenericLayerName(node);
    const signature = localStructureSignature(doc, node);
    const role = signature ? map.get(signature) : null;
    if (!role || !signature.startsWith("LOCAL|")) return;
    if (genericOnlySignatures.has(signature) && !generic) return;
    const namedVisual = !generic && role === "img"
      && NAMED_VISUAL_LOCAL_RE.test(rawName(node))
      && (hasImagePaint(node) || hasImageDescendant(node, kids));
    // Images/backgrounds remain generic-only because their broad visual
    // shapes are the main source of named false positives.  Interaction
    // scopes have tighter local signatures and may fall back for a true name
    // that differs across shelves (btn/tab/modal/scroll/fix/dyn).
    if (!generic && !namedFallbackRoles.has(role) && !namedVisual) return;
    if (!hits.has(node.id)) hits.set(node.id, {
      node,
      role,
      allowSkipped: true,
      genericOnly: generic,
      why: `G3 局部切片绑定结构签名 ${signature}`,
    });
  });
  return [...hits.values()];
}

function localSkipHits(doc, evidence) {
  const signatures = new Set((evidence?.entries || [])
    .filter((entry) => entry?.skipIfParentClips === true && entry.signature)
    .map((entry) => entry.signature));
  if (!signatures.size) return [];
  const byId = indexNodes(doc);
  const hits = [];
  for (const node of byId.values()) {
    if (node.status === "skipped" || isGenericLayerName(node)) continue;
    const signature = localStructureSignature(doc, node);
    if (!signatures.has(signature)) continue;
    const parent = byId.get(node.parentId);
    if (parent?.clipsContent !== true) continue;
    hits.push({ node, skip: true, allowSkipped: true,
      why: `反馈确认：裁切祖先已有 mix/或 scroll/，重复整理分组保持 skipped (${signature})` });
  }
  return hits;
}

/**
 * Variant-internal organization groups beneath a determined avatar/button
 * component set are not page controls themselves.  The clickable surface is
 * the page INSTANCE (and its component-set master); these image-only groups
 * must stay skipped so they cannot be mistaken for nested btn/img roles.
 * This is deliberately fail-closed: only GROUP nodes directly under a
 * COMPONENT whose parent COMPONENT_SET is already determined btn/ and whose
 * descendants contain IMAGE paint without TEXT qualify.
 */
function parentDeterminedBtnSkipHits(doc) {
  const byId = indexNodes(doc);
  const kids = childrenByParent(doc);
  const relations = Array.isArray(doc.relations) ? doc.relations : [];
  const variantToSet = variantToSetMap(doc);
  const directInstanceTargets = new Set(relations
    .filter((relation) => relation?.kind === "instance-uses-variant")
    .map((relation) => relation?.from?.id ?? relation?.from)
    .filter(Boolean));
  const hits = [];
  for (const node of byId.values()) {
    if (node.status === "skipped" || node.status === "determined") continue;
    if (node.type !== "GROUP") continue;
    if (directInstanceTargets.has(node.id)) continue;
    const parent = byId.get(node.parentId);
    let set = null;
    if (parent?.type === "COMPONENT") {
      set = byId.get(parent.parentId);
    } else {
      // Page INSTANCE copies expose the same internal group as I…;masterId
      // under a determined btn/ instance. Recover the owning set only from
      // the instance-uses-variant relation/component id.
      if (!parent || parent.type !== "INSTANCE" || parent.status !== "determined" || parent.role !== "btn") continue;
      if (!String(node.id).includes(";")) continue;
      const relation = relations.find((row) => (
        row?.kind === "instance-uses-variant"
        && (row?.from?.id ?? row?.from) === parent.id
      ));
      const variantId = relation?.to?.id || parent.componentId;
      const setId = relation?.to?.componentSetId || variantToSet.get(variantId);
      set = setId ? byId.get(setId) : null;
    }
    if (!set || set.type !== "COMPONENT_SET" || set.status !== "determined" || set.role !== "btn") continue;
    const descendants = [];
    const stack = [...(kids.get(node.id) || [])];
    const seen = new Set();
    while (stack.length) {
      const child = stack.pop();
      if (!child || seen.has(child.id)) continue;
      seen.add(child.id);
      descendants.push(child);
      stack.push(...(kids.get(child.id) || []));
    }
    if (!descendants.some((child) => hasImagePaint(child))) continue;
    if (descendants.some((child) => child.type === "TEXT")) continue;
    hits.push({
      node,
      skip: true,
      allowSkipped: true,
      why: "btn/组件集变体内部纯图整理分组；页上可点击实例已由母版跟随，内部组保持 skipped",
    });
  }
  return hits;
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

function repeatedTrackLike(children, viewport = null) {
  const candidates = children.filter((child) => child?.box && child.type !== "TEXT");
  if (candidates.length < 3) return false;
  const byType = new Map();
  for (const child of candidates) {
    if (!byType.has(child.type)) byType.set(child.type, []);
    byType.get(child.type).push(child);
  }
  for (const group of byType.values()) {
    if (group.length < 3) continue;
    const widths = group.map((item) => Number(item.box?.w) || 0).filter((n) => n > 0);
    const heights = group.map((item) => Number(item.box?.h) || 0).filter((n) => n > 0);
    if (!widths.length || !heights.length) continue;
    const widthSpread = Math.max(...widths) / Math.max(1, Math.min(...widths));
    const heightSpread = Math.max(...heights) / Math.max(1, Math.min(...heights));
    const xs = group.map((item) => Number(item.box?.x) || 0);
    const ys = group.map((item) => Number(item.box?.y) || 0);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const viewportSpan = Math.max(Number(viewport?.w) || 0, Number(viewport?.h) || 0);
    if (widthSpread <= 1.15 && heightSpread <= 1.15 && span > Math.max(1, viewportSpan * 0.8)) return true;
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
    const directTrack = repeatedTrack(nonText) || repeatedTrackLike(nonText, node.box);
    const overflowChild = nonText.find((child) => childOverflows(node, child));
    const nestedTrack = overflowChild && repeatedTrackLike(kids.get(overflowChild.id) || [], node.box);
    if ((nonText.length < 2 || !directTrack) && !nestedTrack) continue;
    if (pageWidth > 0 && Number(node.box?.w) >= pageWidth * 0.9) continue;
    const parent = byId.get(node.parentId);
    if (parent?.clipsContent === true) continue;
    if (!overflowChild) continue;
    hits.push({ node, role: "scroll", why: "裁切窗 + 重复轨道/子层溢出（结构几何证据）" });
  }
  return hits;
}

function geometryBackgroundHits(doc) {
  const page = doc.page?.box || {};
  const pageWidth = Number(page.w) || 0;
  const pageHeight = Number(page.h) || 0;
  if (!pageWidth || !pageHeight) return [];
  const hits = [];
  for (const node of indexNodes(doc).values()) {
    if (node.status === "skipped" || node.status === "determined" || node.id === doc.page?.id) continue;
    if (!['INSTANCE', 'COMPONENT_SET', 'FRAME'].includes(node.type) || node.clipsContent !== true) continue;
    const box = node.box || {};
    if ((Number(box.w) || 0) < pageWidth * 0.95 || (Number(box.h) || 0) < pageHeight * 0.95) continue;
    const pageRoot = node.parentId === doc.page?.id;
    const detachedSet = node.type === "COMPONENT_SET" && !node.parentId;
    if (!pageRoot && !detachedSet) continue;
    hits.push({ node, role: "bg", why: "接近整页尺寸的裁切底层（页根/组件集结构证据）" });
  }
  return hits;
}

function geometryKvHits(doc) {
  const page = doc.page?.box || {};
  const pageWidth = Number(page.w) || 0;
  const pageHeight = Number(page.h) || 0;
  if (!pageWidth || !pageHeight) return [];
  const byId = indexNodes(doc);
  const kids = childrenByParent(doc);
  const hits = [];
  for (const parent of byId.values()) {
    if (parent.status === "skipped" || parent.parentId !== doc.page?.id) continue;
    if (!['FRAME', 'GROUP'].includes(parent.type)) continue;
    const box = parent.box || {};
    if ((Number(box.w) || 0) < pageWidth * 0.9 || (Number(box.h) || 0) > pageHeight * 0.35) continue;
    const imageLeaves = (kids.get(parent.id) || []).filter((node) => (
      node.status !== "skipped" && node.type !== "TEXT" && hasImagePaint(node)
    ));
    if (imageLeaves.length < 2) continue;
    for (const node of imageLeaves) {
      if (node.status === "determined" || hasPrefix(node, "kv")) continue;
      hits.push({ node, role: "kv", why: "页根首屏 band 内多叶 image paint（KV 分层几何证据）" });
    }
  }
  return hits;
}

function geometryComponentSetHits(doc, signatureEvidence) {
  const hits = [];
  for (const node of indexNodes(doc).values()) {
    if (node.type !== "COMPONENT_SET" || node.status === "skipped" || node.status === "determined") continue;
    if ((node.variants || []).length !== 1) continue;
    const evidence = nestedEvidence(node);
    // A title/label component is intentionally left unknown even when it
    // contains decorative image fills.  This is the fail-closed guard that
    // prevents the old one-variant-size heuristic from producing img/.
    if (!evidence.image || evidence.text) continue;
    // One-variant sets are especially collision-prone (title art, button
    // chrome and containers can have the same size/paint shape). IMAGE paint
    // is necessary but not sufficient: require an exact, persisted G3 role.
    const signature = componentSetSignatureInDoc(doc, node);
    const evidenceRole = signatureRoleMapFromTable(signatureEvidence).get(signature);
    if (evidenceRole !== "img" && evidenceRole !== "bg") continue;
    hits.push({
      node,
      role: evidenceRole,
      why: `单变体组件集：image paint + 无文字 + G3 结构证据（${evidenceRole}/）`,
    });
  }
  return hits;
}

function hasAncestorWith(node, byId, predicate) {
  const seen = new Set();
  let current = node?.parentId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const parent = byId.get(current);
    if (!parent) break;
    if (predicate(parent)) return true;
    current = parent.parentId;
  }
  return false;
}

function descendantTextMatches(node, kids, re) {
  const stack = [...(kids.get(node.id) || [])];
  const seen = new Set();
  while (stack.length) {
    const child = stack.pop();
    if (!child || seen.has(child.id)) continue;
    seen.add(child.id);
    if (child.type === "TEXT" && re.test(String(child.text?.characters || child.characters || child.name || ""))) return true;
    stack.push(...(kids.get(child.id) || []));
  }
  return false;
}

function fixGeometrySignature(doc, node) {
  const page = doc.page?.box || {};
  const pageWidth = Number(page.w) || 0;
  const pageHeight = Number(page.h) || 0;
  if (!pageWidth || !pageHeight) return null;
  const box = node.box || {};
  const left = Number(box.x) - Number(page.x);
  const right = Number(page.x) + pageWidth - (Number(box.x) + Number(box.w));
  const edge = left >= -20 && left <= 140 ? "left" : right >= -20 && right <= 140 ? "right" : null;
  if (!edge) return null;
  const widthRatio = (Number(box.w) || 0) / pageWidth;
  const heightRatio = (Number(box.h) || 0) / pageHeight;
  const width = widthRatio < 0.25 ? "narrow" : widthRatio < 0.6 ? "medium" : "wide";
  const height = heightRatio < 0.15 ? "short" : heightRatio < 0.8 ? "medium" : "tall";
  const byId = indexNodes(doc);
  const clippedAncestor = hasAncestorWith(node, byId, (parent) => parent.clipsContent === true);
  const smallClip = hasAncestorWith(node, byId, (parent) => (
    parent.clipsContent === true && (Number(parent.box?.w) || 0) < pageWidth * 0.9
  ));
  return {
    signature: `NODE|kind=edge-fixed|edge=${edge}|w=${width}|h=${height}|scope=${node.scope || ""}|clip=${clippedAncestor ? "band" : "none"}`,
    smallClip,
  };
}

/** Name-free fixed chrome: edge-attached, evidence-bound, outside small scroll clips. */
function geometryFixHits(doc, evidenceMap = new Map()) {
  const page = doc.page?.box || {};
  const pageWidth = Number(page.w) || 0;
  const pageHeight = Number(page.h) || 0;
  if (!pageWidth || !pageHeight) return [];
  const byId = indexNodes(doc);
  const hits = [];
  for (const node of byId.values()) {
    if (node.status === "skipped" || node.status === "determined" || node.scope !== "page") continue;
    if (!["FRAME", "GROUP", "INSTANCE", "COMPONENT"].includes(node.type)) continue;
    const evidence = fixGeometrySignature(doc, node);
    if (!evidence || evidence.smallClip || evidenceMap.get(evidence.signature) !== "fix") continue;
    hits.push({ node, role: "fix", why: `G3 页图绑定固定层结构签名 ${evidence.signature}` });
  }
  return hits;
}

/** Name-free dynamic date cell: clipped narrow frame containing a date-like TEXT leaf. */
function geometryDynHits(doc) {
  const kids = childrenByParent(doc);
  const hits = [];
  for (const node of indexNodes(doc).values()) {
    if (node.status === "skipped" || node.status === "determined" || node.type !== "FRAME" || node.clipsContent !== true) continue;
    const box = node.box || {};
    if ((Number(box.w) || 0) > 300 || (Number(box.h) || 0) < 400) continue;
    if (!descendantTextMatches(node, kids, /\b\d{1,2}\s*[./-]\s*\d{1,2}\b/)) continue;
    hits.push({ node, role: "dyn", why: "裁切窄格内日期文本（结构内容证据）" });
  }
  return hits;
}

/** Modal attachments carry an independent modal scope even when their names are generic. */
function geometryModalHits(doc) {
  const hits = [];
  for (const node of indexNodes(doc).values()) {
    if (node.status === "skipped" || node.status === "determined" || node.type !== "FRAME") continue;
    if (typeof node.scope === "string" && node.scope.startsWith("modal:") && !node.parentId) {
      hits.push({ node, role: "modal", why: "独立 modal scope 的离页 FRAME（结构关系证据）" });
    }
  }
  return hits;
}

/** Video hot areas are repeated wide groups inside modal/component-set scopes. */
function geometryHotHits(doc) {
  const hits = [];
  for (const node of indexNodes(doc).values()) {
    if (node.status === "skipped" || node.status === "determined" || node.type !== "GROUP") continue;
    if (!String(node.scope || "").startsWith("modal:") && !String(node.scope || "").startsWith("component-set:")) continue;
    const w = Number(node.box?.w) || 0;
    const h = Number(node.box?.h) || 0;
    const ratio = h > 0 ? w / h : 0;
    if (w < 500 || h < 300 || ratio < 1.45 || ratio > 2.15) continue;
    hits.push({ node, role: "hot", why: "视频热区宽幅 GROUP（作用域+几何证据）" });
  }
  return hits;
}

/** Calendar grid container: wide page frame with clipped content and date cell. */
function geometryMixHits(doc) {
  const pageWidth = Number(doc.page?.box?.w) || 0;
  const kids = childrenByParent(doc);
  const hits = [];
  if (!pageWidth) return hits;
  for (const node of indexNodes(doc).values()) {
    if (node.status === "skipped" || node.status === "determined" || node.type !== "FRAME" || node.scope !== "page") continue;
    if (node.role === "sec" || String(node.name || "").startsWith("sec/")) continue;
    if ((Number(node.box?.w) || 0) < pageWidth * 0.7) continue;
    if ((Number(node.box?.h) || 0) > (Number(doc.page?.box?.h) || 0) * 0.25) continue;
    const children = kids.get(node.id) || [];
    const clipped = children.some((child) => child.clipsContent === true);
    const hasDate = children.some((child) => descendantTextMatches(child, kids, /\b\d{1,2}\s*[./-]\s*\d{1,2}\b/));
    if (!clipped || !hasDate) continue;
    hits.push({ node, role: "mix", why: "页内日历网格：裁切内容+日期单元结构证据" });
  }
  return hits;
}

/** Tab strip: repeated instances of one stateful component family in one frame. */
function geometryTabHits(doc) {
  const byId = indexNodes(doc);
  const kids = childrenByParent(doc);
  const variantToSet = variantToSetMap(doc);
  const hits = [];
  for (const node of byId.values()) {
    if (node.status === "skipped" || node.status === "determined" || node.type !== "FRAME") continue;
    const children = (kids.get(node.id) || []).filter((child) => child.type === "INSTANCE");
    // Attachment/page copies repeat the same instance ids.  Count unique
    // instances, otherwise a two-option switch can masquerade as a tab strip
    // and create a false positive on every copied shelf.
    const uniqueChildren = [...new Map(children.map((child) => [child.id, child])).values()];
    if (uniqueChildren.length < 3) continue;
    const setIds = new Set(uniqueChildren.map((child) => instanceSetId(child, variantToSet, doc.relations)).filter(Boolean));
    if (setIds.size !== 1) continue;
    const set = byId.get([...setIds][0]);
    if (!set || !isStatePairNode(set)) continue;
    hits.push({ node, role: "tab", why: "同一状态组件族的重复实例条带（结构关系证据）" });
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
    if (parent.scope !== "page") continue;
    if (parent.id && parent.id === doc.page?.id) continue;
    if (parent.type !== "FRAME" && parent.type !== "GROUP") continue;
    if ((Number(parent.box?.w) || 0) < pageWidth * 0.9) continue;
    const siblings = (kids.get(parent.id) || []).filter((node) => (
      node.status !== "skipped" && node.scope === "page" && node.type === "FRAME"
      && (Number(node.box?.w) || 0) >= pageWidth * 0.9
    ));
    if (siblings.length < 3) continue;
    const byY = new Map();
    for (const node of siblings) {
      const y = Math.round(Number(node.box?.y) || 0);
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push(node);
    }
    const bands = [...byY.entries()].sort((a, b) => a[0] - b[0]).map(([, nodes]) => nodes[0]);
    if (bands.length < 3) continue;
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
          hits.push({ node, role: "sec", number: index + 1, why: "内容包裹层内全宽、纵向不重叠分区（按本稿顺序编号）" });
        }
      }
    });
  }
  return hits;
}

function kvLayerHits(doc) {
  const hits = [];
  for (const node of indexNodes(doc).values()) {
    if (node.status === "skipped" || hasPrefix(node, "kv")) continue;
    const body = rawName(node);
    if (/^kv$/i.test(body) && ["FRAME", "GROUP"].includes(node.type)) {
      hits.push({ node, role: "kv", why: "KV 分层容器" });
    } else if (/^kv(背景|角色|中景|前景|阴影)/i.test(body)) {
      hits.push({ node, role: "kv", why: "KV 视差层" });
    }
  }
  return hits;
}

function pageBackgroundHits(doc) {
  const pageWidth = Number(doc.page?.box?.w) || 0;
  const pageHeight = Number(doc.page?.box?.h) || 0;
  if (!pageWidth) return [];
  const hits = [];
  for (const node of indexNodes(doc).values()) {
    if (node.status === "skipped" || hasPrefix(node, "bg")) continue;
    if (!/^bg$/i.test(rawName(node))) continue;
    const width = Number(node.box?.w) || 0;
    const height = Number(node.box?.h) || 0;
    if (width >= pageWidth * 0.9 && (pageHeight <= 0 || height >= pageHeight * 0.5)) {
      hits.push({ node, role: "bg", why: "整页底图" });
    }
  }
  return hits;
}

function modalFrameHits(doc) {
  const hits = [];
  visitNodes(doc, (node, _trail, kind) => {
    if (kind !== "node" || node.status === "skipped" || hasPrefix(node, "modal")) return;
    if (node.type === "FRAME" && String(node.name || "").includes("弹窗")) {
      hits.push({ node, role: "modal", why: "弹窗附件" });
    }
  });
  return hits;
}

function mixCalendarHits(doc) {
  const hits = [];
  for (const node of indexNodes(doc).values()) {
    if (node.status === "skipped" || hasPrefix(node, "mix")) continue;
    if (!["FRAME", "GROUP"].includes(node.type)) continue;
    if (rawName(node) !== "日历") continue;
    hits.push({ node, role: "mix", why: "日历网格是 mix/ 容器" });
  }
  return hits;
}

export function geometryEvidenceHits(doc, options = {}) {
  // Section partitions are structural: an inner full-width wrapper whose
  // children are stacked, non-overlapping page-width bands.  Page-root chrome
  // (kv/bg/content mixed as siblings) stays unnamed without G3.
  const sectionHits = geometrySectionHits(doc);
  const backgroundHits = geometryBackgroundHits(doc);
  const kvHits = geometryKvHits(doc);
  const evidenceMap = signatureRoleMapFromTable(options.signatureEvidence);
  const mixHits = geometryMixHits(doc);
  const fixHits = geometryFixHits(doc, evidenceMap);
  const tabHits = geometryTabHits(doc);
  const shapeHits = [
    ...fixHits,
    ...geometryDynHits(doc),
    ...geometryModalHits(doc),
    ...geometryHotHits(doc),
    ...mixHits,
  ];
  // Geometry is a structural fallback only for default/anonymous names;
  // meaningful names stay on the name channel to avoid widening named runs.
  const structuralHits = [...backgroundHits, ...kvHits, ...sectionHits, ...shapeHits]
    .filter((hit) => structuralNameAllowed(hit.node));
  const namedGeometryHits = Number(doc.page?.box?.w) >= 1200
    ? [...kvHits, ...mixHits, ...fixHits].filter((hit) => !structuralNameAllowed(hit.node))
    : [];
  if (!options.geometryEvidence) return structuralHits;
  const hits = [...geometryComponentSetHits(doc, options.signatureEvidence)];
  return [
    ...geometryScrollHits(doc).filter((hit) => structuralNameAllowed(hit.node)),
    ...structuralHits,
    ...namedGeometryHits,
    // Repeated instances of one stateful family are a sufficiently narrow
    // relation signal to recover a tab strip even when its frame has a real
    // shelf-specific name.  Other geometry rules remain generic-only.
    ...tabHits,
    ...hits.filter((hit) => structuralNameAllowed(hit.node)),
  ];
}

/**
 * Execute only decided/adopted morphology rules.  The table is deliberately
 * a dispatcher over fail-closed structural helpers; prose/observation ledger
 * entries never reach this path.
 */
export function settledRuleHits(doc, options = {}) {
  const table = options.settledRules ?? loadSettledRules();
  const entries = (table?.entries || []).filter((entry) => (
    entry?.status === "adopted" || entry?.status === "landed"
  ));
  const evidenceMap = signatureRoleMapFromTable(options.signatureEvidence);
  const hits = [];
  for (const entry of entries) {
    let rows = [];
    switch (entry.executor) {
      case "localEvidence": rows = localEvidenceHits(doc, options.signatureEvidence); break;
      case "localSkip": rows = localSkipHits(doc, options.signatureEvidence); break;
      case "skipParentDeterminedBtn": rows = parentDeterminedBtnSkipHits(doc); break;
      case "geometryScroll": rows = geometryScrollHits(doc); break;
      case "geometrySection": rows = geometrySectionHits(doc); break;
      case "geometryBackground": rows = geometryBackgroundHits(doc); break;
      case "geometryKv": rows = geometryKvHits(doc); break;
      case "geometryDyn": rows = geometryDynHits(doc); break;
      case "leafImage": rows = leafImageNodes(doc); break;
      case "textGuard": rows = groupsWithTextNotImg(doc, options.signatureEvidence); break;
      case "characterSwitch": rows = characterContentToSwitch(doc); break;
      case "geometryMix": rows = geometryMixHits(doc); break;
      case "geometryFix": rows = geometryFixHits(doc, evidenceMap); break;
      case "geometryModal": rows = geometryModalHits(doc); break;
      case "geometryHot": rows = geometryHotHits(doc); break;
      case "followCopies": rows = followLayerCopies(doc); break;
      default: rows = [];
    }
    for (const row of rows) {
      // Settled morphology is a fallback for anonymous/default layers.  True
      // names stay on the name channel; only copy-follow and the text safety
      // guard may touch an already determined named node.
      if (entry.executor !== "followCopies" && entry.executor !== "textGuard"
        && entry.executor !== "skipParentDeterminedBtn"
        && row.node && !structuralNameAllowed(row.node)) continue;
      if (entry.role && row.role && entry.role !== row.role) continue;
      hits.push({ ...row, settled: entry.fingerprint });
    }
  }
  return hits;
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

function instanceSetId(inst, variantToSet, relations) {
  if (!inst) return null;
  if (inst.componentId && variantToSet.has(inst.componentId)) return variantToSet.get(inst.componentId);
  for (const relation of relations || []) {
    if (relation.kind !== "instance-uses-variant") continue;
    if ((relation.from?.id ?? relation.from) !== inst.id) continue;
    const setId = setIdOfRelation(relation, variantToSet);
    if (setId) return setId;
  }
  return null;
}

/** 内容集实例若落在另一内容集实例子树内，不算本作用域的主内容集。 */
function isNestedInContentSet(inst, contentSetIds, byId, variantToSet, relations) {
  const ownSet = instanceSetId(inst, variantToSet, relations);
  const seen = new Set();
  let current = inst.parentId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const parent = byId.get(current);
    if (!parent) break;
    if (parent.type === "INSTANCE") {
      const parentSet = instanceSetId(parent, variantToSet, relations);
      if (parentSet && contentSetIds.has(parentSet) && parentSet !== ownSet) return true;
    }
    current = parent.parentId;
  }
  return false;
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
    const maxEdge = Math.max(Number(set.box?.w) || 0, Number(set.box?.h) || 0);
    if (maxEdge >= 250) continue;
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
 * - 恰好一个待判外层内容集（variant>=2 且 !isStatePair；嵌在另一内容集里的不算）
 * - 恰好一组控制族（已确定的 ind/ 或 tab/，或未命名且唯一高亮的状态对实例族）
 * - 控制点数 = variant 数 → switch/，并把未命名控制族升 ind/
 * - 数量冲突 → 保持 unknown 并记录 conflicts
 * 返回 { switchSets, indicatorSets, conflicts, controlSetIds }
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
  const contentSetIds = new Set(sets.map((item) => item.set.id));
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
    const outer = instances.filter((inst) => !isNestedInContentSet(inst, contentSetIds, byId, variantToSet, doc.relations));
    if (!outer.length) continue;
    const scopes = new Set(outer.map((inst) => instanceScopeOf(inst, byId)));
    if (scopes.size !== 1) continue;
    const scopeId = [...scopes][0];
    if (!setByScope.has(scopeId)) setByScope.set(scopeId, []);
    setByScope.get(scopeId).push(item);
  }
  const familiesByScope = unlabeledControlFamiliesByScope(doc, byId, variantToSet, pageIds);
  const switchSets = new Map();
  const indicatorSets = new Map();
  const conflicts = [];
  const controlSetIds = new Set();
  for (const [scopeId, items] of setByScope) {
    for (const family of (familiesByScope.get(scopeId) || [])) controlSetIds.add(family.set.id);
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
    controlSetIds.add(families[0].set.id);
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
  return { switchSets, indicatorSets, conflicts, controlSetIds };
}

function leftoverStatePairHits(doc) {
  const detected = controlledContentSwitch(doc);
  const skip = detected.controlSetIds || new Set();
  const hits = [];
  for (const node of indexNodes(doc).values()) {
    if (node.type !== "COMPONENT_SET" || node.status === "skipped") continue;
    if (!isStatePairNode(node) || skip.has(node.id)) continue;
    const role = setNameRole(node);
    if (role) continue;
    const tokens = variantLabels(node).map(variantOptionToken);
    const hasDisable = tokens.some((token) => token === "disable" || token === "disabled" || token === "禁用");
    const maxEdge = Math.max(Number(node.box?.w) || 0, Number(node.box?.h) || 0);
    const want = hasDisable ? "tab" : (maxEdge > 0 && maxEdge < 250 ? "ind" : "btn");
    hits.push({
      node,
      role: want,
      why: want === "ind" ? "小尺寸状态点组件集" : want === "tab" ? "含禁用态的切换页签" : "选中/未选中状态组件集",
    });
  }
  return hits;
}

function videoHotHits(doc) {
  const hits = [];
  for (const node of indexNodes(doc).values()) {
    if (node.status === "skipped" || hasPrefix(node, "hot")) continue;
    if (!["FRAME", "GROUP"].includes(node.type)) continue;
    if (!/视频播放/.test(rawName(node))) continue;
    hits.push({ node, role: "hot", why: "视频播放热区" });
  }
  return hits;
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

function mergeSignatureRoleMaps(...tables) {
  const map = new Map();
  const dropped = new Set();
  for (const table of tables) {
    for (const [signature, role] of signatureRoleMapFromTable(table)) {
      if (dropped.has(signature)) continue;
      if (map.has(signature) && map.get(signature) !== role) {
        map.delete(signature);
        dropped.add(signature);
        continue;
      }
      map.set(signature, role);
    }
  }
  return map;
}

export function goldClassRoleHits(doc, classRoles, options = {}) {
  const map = asClassRoleMap(classRoles);
  const signatureRoles = mergeSignatureRoleMaps(options.signatureRoles, options.signatureEvidence);
  const signatureEvidence = signatureRoleMapFromTable(options.signatureEvidence);
  if (!map.size) return [];
  const byId = indexNodes(doc);
  const copies = indexAllCopies(doc);
  const kids = childrenByParent(doc);
  const hits = [];
  for (const node of byId.values()) {
    if (node.status === "skipped") continue;
    if (node.status === "determined" && node.role && node.role !== "copy") continue;
    if (node.type === "COMPONENT_SET") {
      const signature = componentSetSignatureInDoc(doc, node);
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
      const signature = componentSetSignatureInDoc(doc, node);
      if (!evidence.image || evidence.text || signatureEvidence.get(signature) !== "img") continue;
    }
    if (role === "img" && (isTextRewardContainer(node, kids) || isVideoFrameWrapper(node)
      || hasImgAncestorAcrossCopies(node, copies))) continue;
    // A named visual container that owns text is not itself an image.  The
    // image role belongs to its decorative/image-only children; applying img/
    // to the parent first would make the later ancestor guard strip those
    // children and leave both the title and its artwork unresolved.
    if (role === "img" && TEXT_CONTAINER_TYPES.has(node.type)
      && hasTextDescendant(node.id, kids)
      && !isTextGroupImgExempt(node)
      // A named card/background group may contain a text overlay while the
      // visual surface remains the image-bearing role.  Keep this exception
      // narrow: only the settled `背景` class with an IMAGE descendant.
      && !(rawName(node) === "背景" && nestedEvidence(node).image)) continue;
    hits.push({ node, role, why: `金样同类 ${node.type}+${rawName(node)} 唯一前缀 ${role}/` });
  }
  return hits;
}

/** 真名优先、结构回退；两路角色冲突时 fail-closed。 */
function hybridRoleHits(doc, classRoles, options = {}) {
  const named = goldClassRoleHits(doc, classRoles, options);
  const structural = signatureHits(doc, options.signatureRoles, { evidence: options.signatureEvidence });
  // G3 page-slice evidence is a third, name-free channel for scattered
  // FRAME/GROUP/BOOLEAN/leaf controls that are not component sets.  It is
  // deliberately restricted to generic/default names inside localEvidenceHits.
  const local = localEvidenceHits(doc, options.signatureEvidence);
  const byId = indexNodes(doc);
  const namedById = new Map(named.map((hit) => [hit.node.id, hit]));
  const structuralById = new Map(structural.map((hit) => [hit.node.id, hit]));
  const localById = new Map(local.map((hit) => [hit.node.id, hit]));
  const ids = new Set([...namedById.keys(), ...structuralById.keys(), ...localById.keys()]);
  const hits = [];
  for (const id of ids) {
    const n = namedById.get(id);
    const s = structuralById.get(id);
    const l = localById.get(id);
    const node = byId.get(id) || n?.node || s?.node;
    if (!node) continue;
    const channels = [n, s, l].filter(Boolean);
    const roles = new Set(channels.map((hit) => hit.role).filter(Boolean));
    if (roles.size > 1) {
      hits.push({ node, role: null, allowSkipped: false, why: "名字/组件结构/局部切片证据冲突，保持 unknown" });
    } else if (n) {
      hits.push({ ...n, why: `${n.why}（真名优先）` });
    } else if (s) {
      hits.push({ ...s, why: `${s.why}（结构回退）` });
    } else if (l) {
      hits.push({ ...l, why: `${l.why}（G3 局部结构回退）` });
    }
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

function crossEndAliasRole(node, sourceRoles, classRoles, byId) {
  if (!node || node.status !== "unknown") return null;
  const body = rawName(node);
  const exact = sourceRoles.get(classKey(node));
  if (exact) return exact;
  // A tiny, settled cross-shelf normalization: the mobile playback leaf is
  // named "播放按钮 1" while the gold class entry/source group is
  // "播放按钮".  Require the known class role and a video/playback parent;
  // do not generalize numeric suffixes to the rest of the vocabulary.
  if (node.type === "RECTANGLE" && /^播放按钮\s+\d+$/.test(body)) {
    const parent = byId.get(node.parentId);
    const parentBody = rawName(parent);
    const role = sourceRoles.get("GROUP::播放按钮")
      || classRoles.get("RECTANGLE::播放按钮");
    if (role === "btn" && (parentBody === "播放按钮" || parentBody === "视频框")) return role;
  }
  return null;
}

export function syncClassHits(sourceDoc, targetDoc, options = {}) {
  const src = determinedClassRoles(sourceDoc);
  const byId = indexNodes(targetDoc);
  const kids = childrenByParent(targetDoc);
  const classRoles = asClassRoleMap(options.classRoles ?? loadClassRoles());
  const hits = [];
  // Cross-end sync is structural first: copied shelves often have different
  // designer names (or fully generic names), but the component-set topology
  // and relation graph remain equivalent.
  for (const hit of setRoleInstances(targetDoc, {
    signatureRoles: determinedSignatureRoles(sourceDoc),
    classRoles: determinedClassRoles(sourceDoc),
  })) {
    if (!hits.some((row) => row.node.id === hit.node.id && row.role === hit.role)) hits.push(hit);
  }
  for (const node of byId.values()) {
    if (node.status !== "unknown") continue;
    const role = crossEndAliasRole(node, src, classRoles, byId);
    if (!role) continue;
    const explicitTitleSync = role === "img" && node.type === "FRAME" && rawName(node) === "标题";
    if (role === "img" && !explicitTitleSync && node.type === "FRAME") continue;
    if (role === "img" && !explicitTitleSync
      && (isTextRewardContainer(node, kids) || isVideoFrameWrapper(node) || hasImgAncestor(node, byId))) continue;
    hits.push({ node, role, why: `与另一端同类 ${role}/ 同步` });
  }
  return hits;
}

export function auditCrossEndClassSync(docs, options = {}) {
  const list = (Array.isArray(docs) ? docs : [docs]).filter(Boolean);
  const problems = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = 0; j < list.length; j += 1) {
      if (i === j) continue;
      for (const { node, role, why } of syncClassHits(list[i], list[j], options)) {
        expectPrefix(node, role, problems, why);
      }
    }
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

export function auditDraftGoldMorphology(doc, options = {}) {
  const problems = [];
  const classRoles = options.classRoles ?? loadClassRoles();
  const signatureRoleTable = options.signatureRoles ?? loadSignatureRoles();
  const signatureEvidence = options.signatureEvidence ?? loadSignatureEvidence();
  const settledRules = options.settledRules ?? loadSettledRules();
  const signatureRoles = signatureRoleMapFromTable(signatureRoleTable);
  const resolvedOptions = {
    ...options,
    classRoles,
    signatureRoles: signatureRoleTable,
    signatureEvidence,
    settledRules,
  };
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
  for (const { node, role, why } of hybridRoleHits(doc, classRoles, {
    signatureRoles,
    signatureEvidence,
  })) {
    if (!role) {
      if (node.status === "determined" && node.role && node.role !== "copy") {
        problems.push(`${node.id}「${node.name}」${why}，保持 unknown`);
      }
      continue;
    }
    expectPrefix(node, role, problems, why);
  }
  for (const { node, role, why } of geometryEvidenceHits(doc, resolvedOptions)) {
    expectPrefix(node, role, problems, why);
  }
  // The settled table dispatches the same fail-closed helpers used above;
  // audit does not replay them a second time (which would duplicate reports).
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
        if (!hasPrefix(node, "btn") && !hasPrefix(node, "tab")) {
          expectPrefix(node, "btn", problems, "选中/未选中状态组件集");
        }
      }
    }

    if (node.role === "modal" || (type === "FRAME" && String(node.name || "").includes("弹窗"))) {
      expectPrefix(node, "modal", problems, "弹窗附件");
    }

    if (node.role === "hot" && w > 0 && h > 0 && w < 120 && h < 120) {
      problems.push(`${node.id}「${node.name}」小尺寸播放控制应是 btn/ 前缀，不是 hot/`);
    }
  });

  for (const { node, role, why } of setRoleInstances(doc, { signatureRoles, classRoles })) {
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
  for (const { node, why } of groupsWithTextNotImg(doc, signatureEvidence)) {
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

function applyHit(copies, { node, role, why, number, allowSkipped = false, genericOnly = false, skip = false }, applied) {
  const all = copies.get(node.id) || [node];
  const group = genericOnly ? all.filter((item) => isGenericLayerName(item)) : all;
  for (const item of group) {
    if (item.status === "skipped" && !allowSkipped) continue;
    if (skip) {
      item.status = "skipped";
      item.role = null;
      item.behavior = "none";
      item.name = rawName(item);
      delete item.via;
      applied.push({ id: item.id, name: item.name, role: null, why });
      continue;
    }
    if (!role) {
      if (!(item.status === "determined" && item.role && item.role !== "copy")) continue;
      applyPrefix(item, null);
      applied.push({ id: item.id, name: item.name, role: null, why });
      continue;
    }
    // A later structural/geometry rule must never overwrite an already
    // determined role from the higher-priority name/signature channel.
    // Conflicts stay fail-closed instead of turning sec/img into mix/hot.
    if (item.status === "determined" && item.role && item.role !== role) {
      const chromeLeafToImg = role === "img" && item.role === "btn"
        && !TEXT_CONTAINER_TYPES.has(item.type)
        && (IMAGE_BODY_RE.test(rawName(item)) || hasImagePaint(item));
      if (!chromeLeafToImg) continue;
    }
    if (hasPrefix(item, role)) continue;
    applyPrefix(item, role);
    if (/另一端同类/.test(String(why || ""))) item.via = "cross-end-sync";
    if (role === "sec" && Number.isInteger(number)) {
      item.name = `sec/${number}`;
      item.label = String(number);
    }
    applied.push({ id: item.id, name: item.name, role, why });
  }
}

/** 静默补：任意组件集实例 + I…;母版Id 子件跟随母版。不要拿这类漏项问人。 */
export function applyDraftGoldMorphology(doc, options = {}) {
  const classRoleTable = options.classRoles ?? loadClassRoles();
  const signatureRoleTable = options.signatureRoles ?? loadSignatureRoles();
  const signatureEvidence = options.signatureEvidence ?? loadSignatureEvidence();
  const classRoles = asClassRoleMap(classRoleTable);
  const signatureRoles = mergeSignatureRoleMaps(signatureRoleTable, signatureEvidence);
  const settledRules = options.settledRules ?? loadSettledRules();
  const resolvedOptions = {
    ...options,
    classRoles: classRoleTable,
    signatureRoles: signatureRoleTable,
    signatureEvidence,
    settledRules,
  };
  const applied = [];
  for (let pass = 0; pass < 5; pass += 1) {
    const before = applied.length;
    const copies = indexAllCopies(doc);
    for (const hit of localSkipHits(doc, signatureEvidence)) applyHit(copies, hit, applied);
    for (const hit of hybridRoleHits(doc, classRoles, {
      signatureRoles,
      signatureEvidence,
    })) applyHit(copies, hit, applied);
    for (const hit of geometryEvidenceHits(doc, resolvedOptions)) applyHit(copies, hit, applied);
    for (const hit of kvLayerHits(doc).filter((row) => structuralNameAllowed(row.node))) applyHit(copies, hit, applied);
    for (const hit of pageBackgroundHits(doc).filter((row) => structuralNameAllowed(row.node))) applyHit(copies, hit, applied);
    for (const hit of modalFrameHits(doc).filter((row) => structuralNameAllowed(row.node))) applyHit(copies, hit, applied);
    for (const hit of mixCalendarHits(doc).filter((row) => structuralNameAllowed(row.node))) applyHit(copies, hit, applied);
    const detected = controlledContentSwitch(doc);
    for (const set of detected.indicatorSets.values()) {
      applyHit(copies, { node: set, role: "ind", why: "作用域内与内容集数量对齐且唯一高亮的控制点" }, applied);
    }
    for (const { node, why } of leafImageNodes(doc)) applyHit(copies, { node, role: "img", why }, applied);
    for (const hit of setRoleInstances(doc, { signatureRoles, classRoles })) applyHit(copies, hit, applied);
    for (const hit of characterContentToSwitch(doc)) applyHit(copies, hit, applied);
    for (const set of detected.switchSets.values()) {
      applyHit(copies, { node: set, role: "switch", why: "多变体内容组件集（作用域内一组控制点且数量对齐）" }, applied);
    }
    for (const hit of leftoverStatePairHits(doc)) applyHit(copies, hit, applied);
    for (const hit of videoHotHits(doc)) applyHit(copies, hit, applied);
    for (const hit of videoFrameWrappersToUnname(doc)) applyHit(copies, hit, applied);
    for (const hit of innerImagePartsToUnname(doc)) applyHit(copies, hit, applied);
    for (const hit of buttonImageGroupHits(doc, signatureEvidence)) applyHit(copies, hit, applied);
    for (const hit of groupsWithTextNotImg(doc, signatureEvidence)) applyHit(copies, hit, applied);
    for (const hit of followLayerCopies(doc)) applyHit(copies, hit, applied);
    if (applied.length === before) break;
  }
  // Execute the machine-readable settled table after the regular morphology
  // pass so it cannot change precedence between name, structure, and follow.
  const settledCopies = indexAllCopies(doc);
  for (const hit of settledRuleHits(doc, {
    ...resolvedOptions,
    settledRules,
    signatureRoles,
  })) applyHit(settledCopies, hit, applied);
  rebuildInventoryIndexes(doc);
  return { applied };
}

export function applyCrossEndClassSync(sourceDoc, targetDoc, options = {}) {
  const applied = [];
  const copies = indexAllCopies(targetDoc);
  for (const hit of syncClassHits(sourceDoc, targetDoc, options)) {
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
  const classRoles = options.classRoles ?? loadClassRoles();
  const signatureRoles = options.signatureRoles ?? loadSignatureRoles();
  const signatureEvidence = options.signatureEvidence ?? loadSignatureEvidence();
  const morphOpts = {
    classRoles,
    signatureRoles,
    signatureEvidence,
    settledRules: options.settledRules ?? loadSettledRules(),
    geometryEvidence: options.geometryEvidence ?? true,
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
  for (const doc of list) stampJudgment(doc, { morphology: true });
  return { applied, counts };
}
