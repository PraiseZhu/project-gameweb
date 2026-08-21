/**
 * 未规范新稿闸门：只核前缀。后缀和设计师原名不作对错标准。
 * 已知结构漏了前缀 → 红。不对图层 id，不对规范稿后缀抄名。
 */
import { rebuildInventoryIndexes } from "./inventory.mjs";

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
  if (!labels.length) return false;
  const blob = labels.join(" ").toLowerCase();
  return /highlight|normal|disable|选中|未选/.test(blob);
}

const CLIP_RE = /可划动|划动区域/;
const INNER_REWARD_RE = /^(奖励列表|奖励)$/;
const CARD_ART_RE = /^(素材图|素材|边框背景\d*|背景边框|立绘)$/;
const IMAGE_BODY_RE = /^(素材图|素材|边框背景\d*|背景边框|立绘|角色头像|待解锁头像|视频框.*|兑换码背景|头像框.*|icon|图标装饰|装饰|阵营信息|待解锁|卡牌|Icon_SSR.*|BG|小按钮|logo|按钮背景|一级按钮.*|二级按钮.*|三级按钮.*|播放按钮\s+\d+)$/;
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

function indexNodes(doc) {
  const byId = new Map();
  visitNodes(doc, (node, _trail, kind) => {
    if (kind === "node") byId.set(node.id, node);
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

function setRoleInstances(doc) {
  const byId = indexNodes(doc);
  const copies = indexAllCopies(doc);
  const variantToSet = variantToSetMap(doc);
  const roleBySet = new Map();
  const unnamedSets = new Set();
  for (const node of byId.values()) {
    if (node.type === "COMPONENT_SET") {
      const prefix = ROLE_PREFIX.exec(String(node.name || ""))?.[1] || (hasPrefix(node, node.role) ? node.role : null);
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


function hasImgAncestor(node, byId) {
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
    /* A card visual can be an INSTANCE (not only a RECTANGLE): border-art and
       portraits often arrive as an instance expanded from a component. Keep
       component definitions themselves out, but classify an image-shaped
       INSTANCE when it has no copy descendants. An INSTANCE containing copy is
       a component shell and must remain unknown instead of being sliced. */
    if (["TEXT", "COMPONENT_SET", "COMPONENT"].includes(node.type)) continue;
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

function classKey(node) {
  const body = rawName(node);
  if (!body) return null;
  return `${node.type}::${body}`;
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

export function auditDraftGoldMorphology(doc) {
  const problems = [];
  const outside = new Set();
  for (const relation of doc.relations || []) {
    const evidence = `${relation.reason ?? ""} ${relation.evidence ?? ""} ${relation.note ?? ""}`;
    if (evidence.includes("outside-shelf") || evidence.includes("definition-outside-shelf")) {
      const fromId = relation.from?.id ?? relation.from;
      if (typeof fromId === "string") outside.add(fromId);
    }
  }

  const kids = childrenByParent(doc);
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
      } else if (labels.length >= 2 && !isStatePair(labels) && labels.length <= 3) {
        expectPrefix(node, "switch", problems, "多变体内容组件集");
      } else if (isStatePair(labels) && Math.max(w || 0, h || 0) > 0 && Math.max(w, h) < 250) {
        expectPrefix(node, "ind", problems, "小尺寸状态点组件集");
      } else if (isStatePair(labels)) {
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

  for (const { node, role, why } of setRoleInstances(doc)) {
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

function applyHit(copies, { node, role, why }, applied) {
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
    applied.push({ id: item.id, name: item.name, role, why });
  }
}

/** 静默补：任意组件集实例 + I…;母版Id 子件跟随母版。不要拿这类漏项问人。 */
export function applyDraftGoldMorphology(doc) {
  const applied = [];
  const byId = indexNodes(doc);
  for (let pass = 0; pass < 5; pass += 1) {
    const before = applied.length;
    const copies = indexAllCopies(doc);
    for (const hit of setRoleInstances(doc)) applyHit(copies, hit, applied);
    for (const hit of characterContentToSwitch(doc)) applyHit(copies, hit, applied);
    for (const { node, why } of leafImageNodes(doc)) applyHit(copies, { node, role: "img", why }, applied);
    for (const hit of videoFrameWrappersToUnname(doc)) applyHit(copies, hit, applied);
    for (const hit of innerImagePartsToUnname(doc)) applyHit(copies, hit, applied);
    for (const hit of groupsWithTextNotImg(doc)) applyHit(copies, hit, applied);
    for (const hit of followLayerCopies(doc)) applyHit(copies, hit, applied);
    if (applied.length === before) break;
  }
  rebuildInventoryIndexes(doc);
  return { applied };
}

export function applyCrossEndClassSync(sourceDoc, targetDoc) {
  const applied = [];
  const copies = indexAllCopies(targetDoc);
  for (const hit of syncClassHits(sourceDoc, targetDoc)) {
    applyHit(copies, hit, applied);
  }
  const again = applyDraftGoldMorphology(targetDoc);
  return { applied: [...applied, ...again.applied] };
}

export function recountStatuses(doc) {
  rebuildInventoryIndexes(doc);
  return { ...(doc.counts || {}) };
}

/** PC/mobile 写回收口：跟随母版 + 两端同类同步。 */
export function finalizeDraftWriteback(docs) {
  const list = (Array.isArray(docs) ? docs : [docs]).filter(Boolean);
  const applied = list.map(() => []);
  for (let i = 0; i < list.length; i += 1) {
    applied[i].push(...applyDraftGoldMorphology(list[i]).applied);
    applyClipAndRewardPrefixes(list[i]);
  }
  if (list.length >= 2) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = 0; j < list.length; j += 1) {
        if (i === j) continue;
        applied[j].push(...applyCrossEndClassSync(list[i], list[j]).applied);
      }
    }
    for (const doc of list) applyClipAndRewardPrefixes(doc);
  }
  const counts = list.map((doc) => recountStatuses(doc));
  return { applied, counts };
}
