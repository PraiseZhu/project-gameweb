/* Explicit semantic layout is content evidence, distinct from Figma's source
   lineTypes and from CSS's width-driven wrapping.  It is intentionally keyed
   by the existing copy binding (node + language), never by a renderer selector
   or page coordinate. */

const valueOf = (value) => value && typeof value === 'object' && 'value' in value ? value.value : value;

export function validateSemanticLayout({ layout = {}, copyByNode = {} } = {}) {
  if (layout == null || typeof layout !== 'object') throw new Error('semantic layout must be an object');
  const byNode = layout.byNode == null ? {} : layout.byNode;
  if (typeof byNode !== 'object' || Array.isArray(byNode)) throw new Error('semantic layout byNode must be an object');
  const normalized = { schema: String(layout.schema || 'semantic-layout/v1'), byNode: {} };
  for (const [nodeId, languages] of Object.entries(byNode)) {
    if (!languages || typeof languages !== 'object' || Array.isArray(languages)) throw new Error(`semantic layout ${nodeId} languages must be an object`);
    const target = {};
    for (const [language, entry] of Object.entries(languages)) {
      const lines = Array.isArray(entry?.lines) ? entry.lines.map((line) => String(line)) : null;
      if (!lines || lines.length < 2 || lines.some((line) => !line)) throw new Error(`semantic layout ${nodeId}/${language} needs two or more non-empty lines`);
      const adopted = valueOf(copyByNode?.[nodeId]?.translations?.[language]);
      if (adopted == null || adopted === '') throw new Error(`semantic layout ${nodeId}/${language} has no adopted translation`);
      if (lines.join('') !== String(adopted)) throw new Error(`semantic layout ${nodeId}/${language} lines must concatenate to adopted translation`);
      const provenance = entry?.provenance;
      if (!provenance || typeof provenance !== 'object' || !String(provenance.kind || '').trim()) throw new Error(`semantic layout ${nodeId}/${language} needs provenance.kind`);
      target[language] = { lines, provenance: { ...provenance } };
    }
    normalized.byNode[nodeId] = target;
  }
  return normalized;
}

export function semanticBreakFor({ semanticLayout = {}, nodeId, language } = {}) {
  const entry = semanticLayout?.byNode?.[String(nodeId)]?.[String(language)];
  return Array.isArray(entry?.lines) && entry.lines.length > 1 ? entry : null;
}
