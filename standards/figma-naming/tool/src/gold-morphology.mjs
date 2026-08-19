/**
 * 未规范新稿闸门：只核前缀。后缀和设计师原名不作对错标准。
 * 已知结构漏了前缀 → 红。不对图层 id，不对规范稿后缀抄名。
 */
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

function visitNodes(doc, visit) {
  const walk = (value, trail) => {
    if (Array.isArray(value)) {
      visit(value, trail, "siblings");
      value.forEach((item) => walk(item, trail));
      return;
    }
    if (!value || typeof value !== "object") return;
    const isNode = typeof value.id === "string" && typeof value.type === "string";
    if (isNode) visit(value, trail, "node");
    const next = isNode ? [...trail, rawName(value)] : trail;
    for (const key of ["nodes", "kids", "variants", "modals", "componentSets", "components"]) {
      if (value[key]) walk(value[key], next);
    }
    if (value.attachments) walk(value.attachments, next);
  };
  walk(doc, []);
}

function expectPrefix(node, role, problems, why) {
  if (hasPrefix(node, role)) return;
  problems.push(`${node.id}「${node.name}」${why}，前缀必须是 ${role}/（后缀不限）`);
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

  const flagInnerReward = (inner) => {
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
      if (setPrefix && ["switch", "btn", "ind", "img", "bg"].includes(setPrefix)) {
        expectPrefix(node, setPrefix, problems, "组件集");
      } else if (variantPrefixes.length === labels.length && labels.length > 0 && new Set(variantPrefixes).size === 1) {
        expectPrefix(node, variantPrefixes[0], problems, "组件集变体已有统一前缀");
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

  const unique = [...new Set(problems)];
  return { ok: unique.length === 0, problems: unique };
}
