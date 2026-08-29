/* A verified visual may stand in for a localized status label without changing
   the operations-owned copy.  This is deliberately data-driven: the match is
   semantic source text + role, and the renderer only consumes registered local
   assets. */

const valueOf = (v) => v && typeof v === 'object' && 'value' in v ? v.value : v;

export function validateStatusVisualVariants({ registry = {} } = {}) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) throw new Error('status visual variants must be an object');
  if (String(registry.schema || '') !== 'status-visual-variants/v1') throw new Error('status visual variants schema must be status-visual-variants/v1');
  const bindings = Array.isArray(registry.bindings) ? registry.bindings : [];
  const variants = registry.variants && typeof registry.variants === 'object' ? registry.variants : {};
  for (const binding of bindings) {
    if (!String(binding?.status || '').trim()) throw new Error('status visual binding needs status');
    if (!String(binding?.match?.sourceText || '').trim()) throw new Error(`status visual binding ${binding?.status || '?'} needs match.sourceText`);
    if (!String(binding?.match?.semanticRole || '').trim()) throw new Error(`status visual binding ${binding?.status || '?'} needs match.semanticRole`);
  }
  for (const [status, perLocale] of Object.entries(variants)) for (const [locale, asset] of Object.entries(perLocale || {})) {
    if (!String(asset?.assetKey || '').trim() || !String(asset?.file || '').trim()) throw new Error(`status visual ${status}/${locale} needs assetKey and file`);
    if (!/\.png$/i.test(asset.file)) throw new Error(`status visual ${status}/${locale} must use a pinned PNG`);
    if (!/^[a-f0-9]{64}$/i.test(String(asset.sha256 || ''))) throw new Error(`status visual ${status}/${locale} needs sha256`);
    if (!(Number(asset?.intrinsic?.width) > 0 && Number(asset?.intrinsic?.height) > 0)) throw new Error(`status visual ${status}/${locale} needs intrinsic dimensions`);
    if (typeof asset.backgroundIncluded !== 'boolean') throw new Error(`status visual ${status}/${locale} needs backgroundIncluded`);
    if (!String(asset?.provenance?.evidenceStatus || '').trim()) throw new Error(`status visual ${status}/${locale} needs provenance`);
  }
  return { schema: registry.schema, bindings, variants, _meta: registry._meta || {} };
}

export function statusVisualBindingFor({ registry, sourceText, semanticRole } = {}) {
  const normalized = validateStatusVisualVariants({ registry });
  return normalized.bindings.find((binding) => String(binding.match.sourceText) === String(valueOf(sourceText) ?? '')
    && String(binding.match.semanticRole) === String(semanticRole)) || null;
}

export function statusVisualVariantFor({ registry, status, language } = {}) {
  const normalized = validateStatusVisualVariants({ registry });
  return normalized.variants?.[String(status)]?.[String(language)] || null;
}
