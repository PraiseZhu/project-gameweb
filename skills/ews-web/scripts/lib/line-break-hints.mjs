/**
 * Agent line breaks for translated TEXT.
 *   designations[platform].lineBreaks[nodeId | sourceNodeId] = { why, locales: { en: "text\nwith breaks" } }
 * The agent only chooses where a line ends. Each "\n" must stand on a space of the table value
 * (or between two non-space characters, e.g. CJK); every other character must equal the table
 * value exactly, so the agent cannot reword. A mismatch fails the build visibly.
 * A hint equal to the table value with no "\n" means keep one line (shrink / tracking, never wrap).
 */

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function breakHintMatches(hint, value) {
  const h = String(hint ?? '');
  const v = String(value ?? '');
  if (!h.includes('\n')) return false;
  let i = 0;
  for (const ch of h) {
    if (ch === '\n') {
      if (v[i] === ' ') i += 1;
      continue;
    }
    if (v[i] !== ch) return false;
    i += 1;
  }
  return i === v.length;
}

export function breakHintKind(hint, value) {
  if (String(hint ?? '') === String(value ?? '') && !String(value ?? '').includes('\n')) return 'nobreak';
  return breakHintMatches(hint, value) ? 'break' : null;
}

function hinted(node, hint, problems) {
  const id = String(node.sourceNodeId || node.id);
  const copy = node.copy;
  const out = { ...copy, translations: { ...(copy?.translations || {}) } };
  for (const [lang, text] of Object.entries(hint?.locales || {})) {
    const leaf = out.translations[lang];
    if (!leaf || leaf.value == null) {
      problems.push(`line-break:${id}:${lang}:no-translation`);
      continue;
    }
    const kind = breakHintKind(text, leaf.value);
    if (!kind) {
      problems.push(`line-break:${id}:${lang}:text-mismatch`);
      continue;
    }
    out.translations[lang] = { ...leaf, breakHint: String(text), breakKind: kind, breakWhy: hint.why || null };
  }
  return { ...node, copy: out };
}

function walk(item, visit) {
  for (const layer of item?.layers || []) layer.nodes = visit(layer.nodes || []);
  for (const page of item?.pages || []) for (const card of page.items || []) card.nodes = visit(card.nodes || []);
  if (Array.isArray(item?.offNodes)) item.offNodes = visit(item.offNodes);
  if (Array.isArray(item?.onNodes)) item.onNodes = visit(item.onNodes);
}

// Returns new node lists; copies are cloned per hinted node, so a shared binding is not changed elsewhere.
export function applyLineBreakHints({ nodes = [], variantSwitches = [], pagedSwitches = [], hints = {} } = {}) {
  const problems = [];
  const keys = Object.keys(hints || {});
  if (!keys.length) return { nodes, variantSwitches, pagedSwitches, problems };
  const used = new Set();
  const visit = (list) => list.map((node) => {
    const key = [String(node.id), String(node.sourceNodeId || '')].find((k) => k && Object.hasOwn(hints, k));
    if (!key || !node.copy) return node;
    used.add(key);
    return hinted(node, hints[key], problems);
  });
  const outNodes = visit(asArray(nodes));
  const outVariants = asArray(variantSwitches).map((item) => ({ ...item, layers: (item.layers || []).map((layer) => ({ ...layer })) }));
  const outPaged = asArray(pagedSwitches).map((item) => ({
    ...item,
    pages: (item.pages || []).map((page) => ({ ...page, items: (page.items || []).map((card) => ({ ...card })) })),
  }));
  for (const item of [...outVariants, ...outPaged]) walk(item, visit);
  for (const key of keys) if (!used.has(key)) problems.push(`line-break:${key}:node-missing`);
  return { nodes: outNodes, variantSwitches: outVariants, pagedSwitches: outPaged, problems };
}
