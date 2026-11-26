const SHAPES = new Set(['BOOLEAN_OPERATION', 'ELLIPSE', 'LINE', 'POLYGON', 'RECTANGLE', 'STAR', 'VECTOR']);
const CONTAINERS = new Set(['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE']);
const PAINTS = new Set(['SOLID', 'GRADIENT_LINEAR', 'GRADIENT_RADIAL']);

export function svgFallbackReason(root) {
  let hasVector = false;
  function visit(node) {
    if (node.visible === false) return null;
    const paints = [...(node.fills ?? []), ...(node.strokes ?? [])].filter((paint) => paint.visible !== false);
    if (node.imageRef || paints.some((paint) => paint.imageRef || paint.type === 'IMAGE' || paint.type === 'VIDEO')) return 'bitmap-fill';
    if ((node.effects ?? []).some((effect) => effect.visible !== false)) return 'effect-or-filter';
    if ((node.blendMode && !['NORMAL', 'PASS_THROUGH'].includes(node.blendMode))
      || paints.some((paint) => paint.blendMode && paint.blendMode !== 'NORMAL')) return 'blend-mode';
    if (node.isMask || paints.some((paint) => !PAINTS.has(paint.type))) return 'unsupported-paint-or-mask';
    if (!SHAPES.has(node.type) && !CONTAINERS.has(node.type)) return 'non-vector-node';
    hasVector ||= SHAPES.has(node.type) || paints.length > 0;
    for (const child of node.children ?? []) {
      const reason = visit(child);
      if (reason) return reason;
    }
    return null;
  }
  return visit(root) ?? (hasVector ? null : 'no-vector-content');
}
