import { sha256Hex } from './canonical.mjs';

export function indexVisualFingerprints(root) {
  const fingerprints = new Map();
  function visit(node) {
    const visualFingerprint = sha256Hex({
      id: node.id,
      type: node.type,
      visible: node.visible !== false,
      opacity: node.opacity ?? null,
      blendMode: node.blendMode ?? null,
      bounds: node.absoluteBoundingBox ?? null,
      characters: node.characters ?? null,
      style: node.style ?? null,
      imageRef: node.imageRef ?? null,
      fills: node.fills ?? null,
      strokes: node.strokes ?? null,
      effects: node.effects ?? null,
      vectorPaths: node.vectorPaths ?? null,
      fillGeometry: node.fillGeometry ?? null,
      strokeGeometry: node.strokeGeometry ?? null,
      children: (node.children ?? []).map(visit),
    });
    fingerprints.set(node.id, visualFingerprint);
    return visualFingerprint;
  }
  visit(root);
  return fingerprints;
}
