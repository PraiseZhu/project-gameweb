/**
 * Source-only component-set variant inventory.
 *
 * A page snapshot expands only the selected INSTANCE variant. The alternate
 * states live in the COMPONENT_SET documents fetched alongside the page. This
 * module joins them only inside one snapshot; it never probes another fixture
 * or fabricates a missing state from a control count.
 */

function pointerToken(value) {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Build a lookup from a COMPONENT child id to its owning COMPONENT_SET and
 * ordered direct COMPONENT variants. `pointer` values are source locations in
 * the supplied fixture so the extractor can wrap every emitted value in fig().
 */
export function buildComponentVariantIndex(snap = {}) {
  const byComponentId = new Map();
  const componentSets = new Map();

  for (const [nodeId, payload] of Object.entries(snap.nodes || {})) {
    const root = payload?.document;
    if (!root || root.type !== 'COMPONENT_SET') continue;
    const pointer = `/nodes/${pointerToken(nodeId)}/document`;
    const variants = (root.children || [])
      .map((child, order) => ({ child, order }))
      .filter(({ child }) => child?.type === 'COMPONENT' && child.id)
      .map(({ child, order }) => ({
        id: String(child.id),
        order,
        pointer: `${pointer}/children/${order}`,
      }));
    if (variants.length < 2) continue;
    const graph = {
      componentSetId: String(root.id || nodeId),
      pointer,
      variants,
      propertyDefinitions: root.componentPropertyDefinitions || null,
    };
    componentSets.set(graph.componentSetId, graph);
    for (const variant of variants) byComponentId.set(variant.id, graph);
  }

  return { byComponentId, componentSets };
}

export function componentVariantGraphFor(index, componentId) {
  return index?.byComponentId?.get(String(componentId || '')) || null;
}

