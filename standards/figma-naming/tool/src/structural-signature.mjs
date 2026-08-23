/**
 * Name-free structural signatures for component sets.
 *
 * The signature intentionally contains no node id or designer name.  It is
 * stable across a copied shelf when the component topology, state property
 * shape and size class remain the same.
 */

const ROLE_PREFIX = /^(bg|btn|dyn|fix|hot|img|ind|kv|mix|modal|ref|scroll|sec|switch|tab|copy)\//;
const STATE_OPTION_RE = /^(highlight|normal|disable|disabled|selected|unselected|active|inactive|选中|未选|禁用|默认)$/i;

export const SIZE_BUCKETS = Object.freeze([
  [80, "xs"],
  [250, "sm"],
  [400, "md"],
  [900, "lg"],
  [Number.POSITIVE_INFINITY, "xl"],
]);

export function maxEdgeOf(node) {
  const box = node?.box || {};
  return Math.max(Number(box.w) || 0, Number(box.h) || 0);
}

export function sizeBucketOf(node) {
  const edge = maxEdgeOf(node);
  return SIZE_BUCKETS.find(([limit]) => edge < limit)?.[1] || "xl";
}

function variantDefinitions(node) {
  const definitions = node?.componentPropertyDefinitions || {};
  return Object.values(definitions).filter((definition) => definition?.type === "VARIANT");
}

function collectSetNodes(node) {
  const nodes = [];
  if (Array.isArray(node?.nodes)) nodes.push(...node.nodes);
  for (const variant of node?.variants || []) {
    if (Array.isArray(variant?.nodes)) nodes.push(...variant.nodes);
  }
  return nodes;
}

function propShape(node) {
  const defs = variantDefinitions(node);
  if (!defs.length) return "none";
  return defs
    .map((definition) => `${definition.type}:${(definition.variantOptions || []).length}`)
    .sort()
    .join(",");
}

/** Name-free type topology: descendant type counts + parent>child type edges. */
export function topologyOf(node) {
  const nodes = collectSetNodes(node);
  if (!nodes.length) return "";
  const typeCounts = new Map();
  const byId = new Map();
  for (const item of nodes) {
    if (!item || typeof item !== "object") continue;
    if (item.id) byId.set(item.id, item);
    const type = item.type;
    if (!type || type === "COMPONENT_SET") continue;
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
  }
  const edges = new Map();
  for (const item of nodes) {
    if (!item?.parentId || !item?.type) continue;
    const parent = byId.get(item.parentId);
    if (!parent?.type) continue;
    const key = `${parent.type}>${item.type}`;
    edges.set(key, (edges.get(key) || 0) + 1);
  }
  const types = [...typeCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([type, count]) => `${type}:${count}`).join(",");
  const links = [...edges.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([edge, count]) => `${edge}*${count}`).join(",");
  return [types, links].filter(Boolean).join(";");
}

function signatureIsStrong(node) {
  return isStatePair(node) || Boolean(topologyOf(node));
}

/**
 * State-ness is derived from the component property schema, not from the set
 * name or variant node ids.  Unknown option vocabularies remain non-state.
 */
export function isStatePair(node) {
  if (node?.type !== "COMPONENT_SET") return false;
  const count = Array.isArray(node.variants) ? node.variants.length : 0;
  if (count < 2 || count > 3) return false;
  const definitions = variantDefinitions(node);
  if (definitions.length !== 1) return false;
  const options = definitions[0].variantOptions || [];
  return options.length === count && options.length > 0 && options.every((option) => STATE_OPTION_RE.test(String(option)));
}

export function componentSetSignature(node) {
  if (!node || node.type !== "COMPONENT_SET") return null;
  const variantCount = Array.isArray(node.variants) ? node.variants.length : 0;
  return [
    "COMPONENT_SET",
    `variants=${variantCount}`,
    `state=${isStatePair(node) ? 1 : 0}`,
    `size=${sizeBucketOf(node)}`,
    `props=${propShape(node)}`,
    `tree=${topologyOf(node) || "-"}`,
  ].join("|");
}

function allNodes(doc) {
  const byId = new Map();
  const seen = new Set();
  const walk = (value) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value.id === "string" && typeof value.type === "string" && !byId.has(value.id)) {
      byId.set(value.id, value);
    }
    Object.values(value).forEach(walk);
  };
  walk(doc);
  return byId;
}

function relationVariants(doc, setId) {
  const byId = allNodes(doc);
  const rows = [];
  for (const relation of doc?.relations || []) {
    if (relation?.kind !== "component-set-has-variant") continue;
    const fromId = relation.from?.id ?? relation.from;
    if (fromId !== setId) continue;
    const id = relation.to?.id ?? relation.to;
    const node = byId.get(id) || { id, type: "COMPONENT" };
    rows.push(node);
  }
  return rows;
}

function inferredDefinitions(variants) {
  const options = variants
    .map((variant) => String(variant?.name || "").trim())
    .map((name) => name.slice(name.lastIndexOf("=") + 1).trim())
    .filter(Boolean);
  if (!options.length || new Set(options).size !== options.length) return null;
  return {
    "Property 1": { type: "VARIANT", variantOptions: options },
  };
}

/** Rebuild a sparse COMPONENT_SET from relation evidence without using ids/names in the signature. */
export function hydrateComponentSet(doc, node) {
  if (!node || node.type !== "COMPONENT_SET") return node;
  const related = relationVariants(doc, node.id);
  if (!related.length) return node;
  const existing = Array.isArray(node.variants) ? node.variants : [];
  const byId = new Map(existing.filter((item) => item?.id).map((item) => [item.id, item]));
  const variants = related.map((item) => byId.get(item.id) || item);
  const defs = node.componentPropertyDefinitions || inferredDefinitions(variants);
  return {
    ...node,
    variants: variants.length > existing.length ? variants : existing,
    ...(defs ? { componentPropertyDefinitions: defs } : {}),
  };
}

export function componentSetSignatureInDoc(doc, node) {
  return componentSetSignature(hydrateComponentSet(doc, node));
}

export function roleFromName(name) {
  return String(name || "").match(ROLE_PREFIX)?.[1] || null;
}

function componentSetsOf(doc) {
  return (doc?.attachments?.componentSets || [])
    .filter((node) => node?.type === "COMPONENT_SET")
    .map((node) => hydrateComponentSet(doc, node));
}

/**
 * Build a fail-closed signature → role map from one or more gold inventories.
 * A signature is kept only when every observed role agrees.
 */
export function uniqueSignatureRoles(docs) {
  const observed = new Map();
  for (const doc of Array.isArray(docs) ? docs : [docs]) {
    for (const set of componentSetsOf(doc)) {
      const signature = componentSetSignature(set);
      if ((set.variants || []).length === 1) continue;
      if (!signatureIsStrong(set)) continue;
      const role = roleFromName(set.name);
      if (!signature || !role || role === "copy") continue;
      if (!observed.has(signature)) observed.set(signature, new Set());
      observed.get(signature).add(role);
    }
  }
  const unique = new Map();
  for (const [signature, roles] of observed) {
    if (roles.size === 1) unique.set(signature, [...roles][0]);
  }
  return unique;
}

export function determinedSignatureRoles(doc) {
  const observed = new Map();
  for (const set of componentSetsOf(doc)) {
    const signature = componentSetSignature(set);
    if (!signatureIsStrong(set)) continue;
    const role = roleFromName(set.name) || (set.status === "determined" ? set.role : null);
    if (!signature || !role || role === "copy") continue;
    if (!observed.has(signature)) observed.set(signature, new Set());
    observed.get(signature).add(role);
  }
  const unique = new Map();
  for (const [signature, roles] of observed) if (roles.size === 1) unique.set(signature, [...roles][0]);
  return unique;
}

export function signatureRoleMapFromTable(table) {
  if (table instanceof Map) return table;
  const entries = Array.isArray(table) ? table : (table?.entries || table?.signatures || []);
  const map = new Map();
  const dropped = new Set();
  for (const entry of entries) {
    if (!entry?.signature || !entry?.role || entry.role === "copy") continue;
    if (dropped.has(entry.signature)) continue;
    if (map.has(entry.signature) && map.get(entry.signature) !== entry.role) {
      map.delete(entry.signature);
      dropped.add(entry.signature);
      continue;
    }
    map.set(entry.signature, entry.role);
  }
  return map;
}

function legacySignature(signature) {
  return String(signature || "").replace(/\|props=[^|]*\|tree=.*$/, "");
}

export function roleForSignature(roleMap, signature) {
  const map = signatureRoleMapFromTable(roleMap);
  return map.get(signature) || map.get(legacySignature(signature)) || null;
}

/** Return unknown component sets whose signature has a unique gold role. */
export function signatureHits(doc, roleMap, options = {}) {
  const map = signatureRoleMapFromTable(roleMap);
  const evidenceMap = signatureRoleMapFromTable(options.evidence);
  const hits = [];
  for (const node of componentSetsOf(doc)) {
    if (node.status === "skipped") continue;
    if (node.status === "determined" && node.role && node.role !== "copy") continue;
    const signature = componentSetSignature(node);
    if ((node.variants || []).length === 1 && !evidenceMap.has(signature)) continue;
    if (!signatureIsStrong(node) && !evidenceMap.has(signature)) continue;
    const role = signature ? (roleForSignature(evidenceMap, signature) || roleForSignature(map, signature)) : null;
    if (!role) continue;
    hits.push({ node, role, signature, why: `结构签名 ${signature} 唯一对应 ${role}/` });
  }
  return hits;
}

export function signatureRoleObject(roleMap) {
  const map = signatureRoleMapFromTable(roleMap);
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
