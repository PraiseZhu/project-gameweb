// Infer a numbered label only from two or more independently bound source rows.
// Dates, multiple numbers, missing translations and conflicting affixes fail closed.
function split(value) {
  const text = String(value || '').trim();
  const parts = text.match(/^(\D*)(\d+)(\D*)$/);
  return parts && (parts[1] || parts[3]) ? { prefix: parts[1], number: parts[2], suffix: parts[3], key: parts[1] + '{n}' + parts[3] } : null;
}

export function completeNumberedCopies(byNode, { locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko'], sourceLocale = 'zh-CN' } = {}) {
  const groups = new Map();
  for (const bound of Object.values(byNode || {})) {
    if (!bound?.row || !['exact', 'normalized', 'designated'].includes(bound.matchKind)) continue;
    const source = split(bound.characters);
    if (!source) continue;
    const group = groups.get(source.key) || new Map();
    group.set(bound.row, { bound, source }); groups.set(source.key, group);
  }
  const changed = [];
  for (const [id, bound] of Object.entries(byNode || {})) {
    if (bound.matchKind !== 'deliberately-unbound') continue;
    const target = split(bound.characters);
    const samples = target && [...(groups.get(target.key)?.values() || [])];
    if (!samples || new Set(samples.map(s => s.source.number)).size < 2) continue;
    const translations = {};
    for (const locale of locales) {
      const patterns = samples.map(s => ({ leaf: s.bound.translations?.[locale], source: s.source, row: s.bound.row }));
      const parsed = patterns.map(s => split(s.leaf?.value));
      if (parsed.some((p, i) => !p || p.number !== patterns[i].source.number)) continue;
      if (new Set(parsed.map(p => p.key)).size !== 1) continue;
      translations[locale] = {
        ...patterns[0].leaf,
        value: locale === sourceLocale ? bound.characters : parsed[0].prefix + target.number + parsed[0].suffix,
        derived: { kind: 'numbered-label', number: target.number, rows: patterns.map(s => s.row), locators: patterns.map(s => s.leaf.locator) },
      };
    }
    if (locales.some(locale => !translations[locale])) continue;
    byNode[id] = { ...bound, matchKind: 'numbered-label', translations, missingLangs: [], templateRows: samples.map(s => s.bound.row) };
    changed.push(id);
  }
  return changed;
}
