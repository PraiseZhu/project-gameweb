/**
 * 核对页 JSONL 写回 draft。nodeId 对不上时，用上一份稿的
 * parentId + type + 剥前缀名 + 同组顺序 映射到当前树。
 * 导航项已是 btn/ 时，旧反馈里的 img 不得复写。
 * 写回后自动：任意组件集实例和 I…;母版Id 子件跟随母版。
 */
import { applyCrossEndClassSync, applyDraftGoldMorphology } from "./gold-morphology.mjs";
import { stampJudgment } from "./judgment.mjs";

const ROLE_PREFIX = /^(bg|btn|dyn|fix|hot|img|ind|kv|mix|modal|ref|scroll|sec|switch|tab|copy)\//;

export function rawName(name) {
  return String(name ?? "").replace(ROLE_PREFIX, "").trim();
}

export function bodyOf(node) {
  return rawName(node?.name) || "";
}

function walkNodes(value, visit) {
  if (Array.isArray(value)) return value.forEach((item) => walkNodes(item, visit));
  if (!value || typeof value !== "object") return;
  if (typeof value.id === "string" && typeof value.type === "string") visit(value);
  for (const child of Object.values(value)) walkNodes(child, visit);
}

export function indexById(doc) {
  const byId = new Map();
  walkNodes(doc, (node) => {
    if (!byId.has(node.id)) byId.set(node.id, []);
    byId.get(node.id).push(node);
  });
  return byId;
}

function uniqueNodes(doc) {
  const seen = new Set();
  const out = [];
  walkNodes(doc, (node) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    out.push(node);
  });
  return out;
}

function fingerprint(node) {
  return `${node.parentId ?? ""}::${node.type}::${rawName(node.name)}`;
}

function sortKey(node) {
  const box = node.box || {};
  return [Number(box.y) || 0, Number(box.x) || 0, String(node.id)];
}

export function buildIdMap(fromDoc, toDoc) {
  const map = new Map();
  const groups = new Map();
  for (const node of uniqueNodes(fromDoc)) {
    const key = fingerprint(node);
    if (!groups.has(key)) groups.set(key, { from: [], to: [] });
    groups.get(key).from.push(node);
  }
  for (const node of uniqueNodes(toDoc)) {
    const key = fingerprint(node);
    if (!groups.has(key)) groups.set(key, { from: [], to: [] });
    groups.get(key).to.push(node);
  }
  for (const { from, to } of groups.values()) {
    if (!from.length || from.length !== to.length) continue;
    from.sort((a, b) => String(sortKey(a)).localeCompare(String(sortKey(b)), undefined, { numeric: true }));
    to.sort((a, b) => String(sortKey(a)).localeCompare(String(sortKey(b)), undefined, { numeric: true }));
    for (let i = 0; i < from.length; i += 1) {
      if (from[i].id !== to[i].id) map.set(from[i].id, to[i].id);
    }
  }
  return map;
}

export function setDetermined(node, role) {
  const body = bodyOf(node) || role;
  node.status = "determined";
  node.role = role;
  node.name = `${role}/${body}`;
  if (role === "scroll") {
    node.behavior = "scroll-x";
    node.label = body;
  } else if (role === "img" || role === "kv" || role === "bg") {
    node.behavior = "slice";
    node.label = body;
  } else if (role === "btn") {
    node.behavior = "click";
    node.label = body;
  } else if (role === "mix") {
    node.behavior = "none";
    node.label = body;
  } else {
    node.behavior = node.behavior && node.behavior !== "none" ? node.behavior : "none";
    node.label = body;
  }
}

export function setUnknown(node) {
  node.status = "unknown";
  node.role = null;
  node.label = null;
  node.behavior = "none";
  node.name = bodyOf(node) || node.name;
}

function hasPrefix(node, role) {
  return node.status === "determined" && node.role === role && String(node.name ?? "").startsWith(`${role}/`);
}

function keepNavBtn(node, toRole) {
  return rawName(node.name) === "导航状态" && hasPrefix(node, "btn") && toRole && toRole !== "btn";
}

function hasTextDescendant(node, byId, seen = new Set()) {
  if (!node || seen.has(node.id)) return false;
  seen.add(node.id);
  const children = [];
  for (const value of byId.values()) for (const item of value) if (item.parentId === node.id) children.push(item);
  return children.some((child) => child.type === 'TEXT' || hasTextDescendant(child, byId, seen));
}

function isImageContainerOverride(node, role, byId) {
  return role === 'img' && ['FRAME', 'GROUP', 'INSTANCE', 'COMPONENT'].includes(String(node.type || '').toUpperCase())
    && hasTextDescendant(node, byId);
}

export function applyReviewFeedback(doc, rows, { previousDoc = null, peerDocs = [], judgePack = null } = {}) {
  const byId = indexById(doc);
  const idMap = previousDoc ? buildIdMap(previousDoc, doc) : new Map();
  const last = new Map();
  const skippedUnknown = [];
  for (const row of rows) {
    if (!row?.nodeId) continue;
    const prev = last.get(row.nodeId);
    if (row.toStatus === "unknown" && prev?.toStatus === "determined") {
      skippedUnknown.push({ id: row.nodeId, kept: `${prev.toRole}/`, note: row.note });
      continue;
    }
    last.set(row.nodeId, row);
  }

  const applied = [];
  const missing = [];
  const remapped = [];
  const conflicts = [];

  for (const row of last.values()) {
    let targetId = row.nodeId;
    let nodes = byId.get(targetId);
    if (!nodes?.length && idMap.has(row.nodeId)) {
      targetId = idMap.get(row.nodeId);
      nodes = byId.get(targetId);
      if (nodes?.length) remapped.push({ from: row.nodeId, to: targetId });
    }
    if (!nodes?.length) {
      missing.push(row.nodeId);
      continue;
    }
    const sample = nodes[0];
    if (row.toStatus === "unknown" && sample.status === "determined") {
      skippedUnknown.push({ id: targetId, kept: `${sample.role}/`, note: row.note });
      continue;
    }
    if (row.toStatus === "determined" && keepNavBtn(sample, row.toRole)) {
      conflicts.push({
        from: row.nodeId,
        to: targetId,
        kept: sample.name,
        ignored: `${row.toRole}/`,
        note: "导航状态已是 btn/，旧反馈 img 不复写",
      });
      continue;
    }
    for (const node of nodes) {
      if (row.toStatus === "unknown") setUnknown(node);
      else if (row.toStatus === "determined" && row.toRole) {
        if (isImageContainerOverride(node, row.toRole, byId)) {
          conflicts.push({
            from: row.nodeId,
            to: targetId,
            kept: node.name,
            ignored: 'img/',
            note: '图文混合容器不能整体改成 img/；结构优先，保留 mix/ 或 unknown',
          });
          if (node.status !== 'determined' || node.role !== 'mix' || !String(node.name || '').startsWith('mix/')) {
            setDetermined(node, 'mix');
          }
        } else setDetermined(node, row.toRole);
      }
    }
    applied.push({
      id: targetId,
      from: row.nodeId === targetId ? null : row.nodeId,
      copies: nodes.length,
      name: nodes[0].name,
      role: nodes[0].role,
      status: nodes[0].status,
    });
  }

  const morphology = applyDraftGoldMorphology(doc);
  const peerSync = [];
  for (const peer of peerDocs) {
    if (!peer) continue;
    const toPeer = applyCrossEndClassSync(doc, peer);
    const toSelf = applyCrossEndClassSync(peer, doc);
    peerSync.push({ toPeer: toPeer.applied, toSelf: toSelf.applied });
    // 对端只做同类同步。本调用没交对端判断包，必须清掉旧 visual/judgePack，
    // 不能拿对端上次戳配合本端本次包去打 green-draft。对端要自己当 current 带 --judge-pack。
    stampJudgment(peer, { visual: false, morphology: true, judgePack: null });
  }
  const boundPack = judgePack && judgePack.schema === "judge-pack/v1" ? judgePack : null;
  stampJudgment(doc, {
    visual: Boolean(boundPack),
    morphology: true,
    feedbackApplied: applied.length,
    judgePack: boundPack,
  });
  return { applied, missing, remapped, conflicts, skippedUnknown, idMapSize: idMap.size, morphology: morphology.applied, peerSync };
}
