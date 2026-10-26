/**
 * EWS locale × device image resolver. No landing-cn-reuses-en fallback.
 * Legal img/ lang sets: lang axis + ≥2 exact lowercase cn/tw/en/jp/kr.
 * Other variant axes must uniquely match the instance; multiple leftovers fail.
 */
const LEGAL_LANG = new Set(['cn', 'tw', 'en', 'jp', 'kr']);
const LEGAL_DEVICE = new Set(['pc', 'mobile']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function axisKey(key) {
  return String(key || '').replace(/#[^#]+$/, '').trim();
}

function rawOf(raw) {
  return raw && typeof raw === 'object' ? (raw.value ?? raw.defaultValue ?? '') : raw;
}

export function imgLangVariantValue(language) {
  const raw = String(language || '').replace('_', '-');
  const lower = raw.toLowerCase();
  if (lower.startsWith('zh-tw') || lower.startsWith('zh-hk')) return 'tw';
  if (lower.startsWith('zh')) return 'cn';
  if (lower.startsWith('ja')) return 'jp';
  if (lower.startsWith('ko')) return 'kr';
  if (lower.startsWith('en')) return 'en';
  return null;
}

export function variantAxisMap(variant) {
  const out = {};
  const props = variant && variant.componentProperties;
  if (props && typeof props === 'object') {
    for (const [key, raw] of Object.entries(props)) {
      out[axisKey(key)] = String(rawOf(raw) ?? '');
    }
  }
  const parts = String((variant && variant.name) || '').split(',');
  for (const part of parts) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const axis = axisKey(part.slice(0, index));
    if (!axis || out[axis]) continue;
    out[axis] = String(part.slice(index + 1)).trim();
  }
  return out;
}

export function langValueOfImgVariant(variant) {
  return variantAxisMap(variant).lang || '';
}

export function imgLangAxisOfSet(set) {
  const defs = set && (set.propertyDefinitions || set.componentPropertyDefinitions);
  if (!defs || typeof defs !== 'object' || Array.isArray(defs)) return null;
  const typeOf = (raw) => String((raw && typeof raw === 'object' ? (raw.type && raw.type.value) ?? raw.type : '') || '').toUpperCase();
  const optionsOf = (raw) => {
    const options = raw && typeof raw === 'object'
      ? (Array.isArray(raw.variantOptions) ? raw.variantOptions : raw.variantOptions && raw.variantOptions.value)
      : null;
    return Array.isArray(options) ? options.map((item) => String(item && typeof item === 'object' && 'value' in item ? item.value : item)) : [];
  };
  for (const [key, raw] of Object.entries(defs)) {
    if (axisKey(key) !== 'lang' || typeOf(raw) !== 'VARIANT') continue;
    return { key, options: optionsOf(raw) };
  }
  return null;
}

export function setNamePrefix(set) {
  const name = String((set && set.name) || '').trim();
  return ((/^([A-Za-z]+)\s*[\/／]/.exec(name) || [])[1] || '').toLowerCase();
}

export function isLegalImgLangSet(set) {
  const axis = imgLangAxisOfSet(set);
  if (!axis) return false;
  const allowed = new Set(axis.options.filter((value) => LEGAL_LANG.has(value)));
  if (allowed.size < 2) return false;
  const variants = asArray(set && set.variants);
  const values = new Set(variants.map((variant) => langValueOfImgVariant(variant)).filter((value) => allowed.has(value)));
  return values.size >= 2;
}

export function isLegalImgLangAssetSet(set) {
  return setNamePrefix(set) === 'img' && isLegalImgLangSet(set);
}

function variantId(variant) {
  return String((variant && (variant.componentId || variant.id)) || '');
}

function findSetForComponent(sets, componentId) {
  const id = String(componentId || '');
  return asArray(sets).find((set) => asArray(set && set.variants).some((variant) => variantId(variant) === id)) || null;
}

function assetRefOf(variant) {
  const slice = variant?.sliceExport;
  if (slice && typeof slice === 'object') return slice.file || slice.path || slice.src || null;
  return variant?.asset || variant?.src || null;
}

function fail(status, detail) {
  return { ok: false, failVisible: true, status, ...detail };
}

function instanceAxes(instanceProperties) {
  const out = {};
  if (!instanceProperties || typeof instanceProperties !== 'object') return out;
  for (const [key, raw] of Object.entries(instanceProperties)) {
    out[axisKey(key)] = String(rawOf(raw) ?? '');
  }
  return out;
}

function uniqueLangMatch(variants, langValue, instanceProperties) {
  const held = instanceAxes(instanceProperties);
  const candidates = [];
  for (const variant of variants) {
    const axes = variantAxisMap(variant);
    if (axes.lang !== langValue) continue;
    let ok = true;
    for (const [axis, value] of Object.entries(held)) {
      if (axis === 'lang') continue;
      if (axes[axis] != null && axes[axis] !== value) {
        ok = false;
        break;
      }
    }
    if (ok) candidates.push(variant);
  }
  return candidates;
}

export function resolveLocaleDeviceImage({
  device,
  language,
  componentId,
  componentSetsByDevice = {},
  assetsByDevice = {},
  instanceProperties = null,
  assertFile = null,
} = {}) {
  const lang = String(language || '');
  const id = String(componentId || '');
  if (!LEGAL_DEVICE.has(device)) {
    return fail('invalid-device', { device: device ?? null, language: lang, componentId: id || null, reason: 'device must be pc or mobile' });
  }
  const value = imgLangVariantValue(lang);
  if (!value || !id) {
    return {
      ok: true, failVisible: false, status: 'not-applicable', device, language: lang,
      value: value || null, componentId: id || null,
      reason: value ? 'no-component-id' : 'unmapped-page-language',
    };
  }
  const sets = componentSetsByDevice[device];
  if (!Array.isArray(sets)) {
    return fail('missing-device-sets', { device, language: lang, value, componentId: id, reason: `missing componentSets for ${device}` });
  }
  const foundSet = findSetForComponent(sets, id);
  if (!foundSet) {
    return { ok: true, failVisible: false, status: 'not-applicable', device, language: lang, value, componentId: id, reason: 'set-not-found' };
  }
  if (!isLegalImgLangAssetSet(foundSet)) {
    return {
      ok: true, failVisible: false, status: 'not-applicable', device, language: lang, value, componentId: id,
      reason: isLegalImgLangSet(foundSet) ? 'not-img-prefix' : 'not-img-lang-set',
      setName: foundSet.name ?? '',
    };
  }
  const variants = asArray(foundSet.variants);
  const matches = uniqueLangMatch(variants, value, instanceProperties);
  if (matches.length > 1) {
    return fail('ambiguous-variant-axes', {
      device, language: lang, value, componentId: id,
      setId: foundSet.componentSetId || foundSet.id || null,
      reason: `multiple ${device}/${value} variants remain after holding other axes`,
      available: matches.map((variant) => variantAxisMap(variant)),
    });
  }
  const match = matches[0] || null;
  if (!match) {
    return fail('missing-language-variant', {
      device, language: lang, value, componentId: id,
      setId: foundSet.componentSetId || foundSet.id || null,
      reason: `missing ${device}/${value} variant`,
      available: variants.map((variant) => langValueOfImgVariant(variant)).filter(Boolean),
    });
  }
  const resolvedId = variantId(match);
  const assetKey = assetRefOf(match) || resolvedId;
  const deviceAssets = assetsByDevice[device] && typeof assetsByDevice[device] === 'object' ? assetsByDevice[device] : {};
  const assetPath = deviceAssets[resolvedId]?.path || deviceAssets[resolvedId] || deviceAssets[assetKey]?.path || deviceAssets[assetKey] || null;
  if (!assetPath) {
    return fail('missing-asset', {
      device, language: lang, value, componentId: resolvedId, sourceNodeId: resolvedId, assetKey,
      reason: `missing ${device}/${value} asset for ${resolvedId}`,
    });
  }
  if (typeof assertFile === 'function' && !assertFile(assetPath)) {
    return fail('missing-asset', {
      device, language: lang, value, componentId: resolvedId, sourceNodeId: resolvedId, assetKey, assetPath,
      reason: `asset file missing for ${device}/${value}/${resolvedId}`,
    });
  }
  return {
    ok: true, failVisible: false, status: 'matched', device, language: lang, value,
    componentId: resolvedId, sourceNodeId: resolvedId, assetKey, assetPath, reason: 'exact-locale-device',
  };
}

export function freezeImageSourceTree(tree) {
  return typeof structuredClone === 'function' ? structuredClone(tree) : JSON.parse(JSON.stringify(tree));
}

export function applyImageLanguage(sourceTree, {
  language, device, componentSetsByDevice, assetsByDevice,
} = {}) {
  const snapshot = freezeImageSourceTree(sourceTree);
  const nextInstances = [];
  const resolutions = [];
  for (let i = 0; i < asArray(snapshot.instances).length; i += 1) {
    const snapshotInstance = snapshot.instances[i];
    const resolved = resolveLocaleDeviceImage({
      device,
      language,
      componentId: snapshotInstance.componentId,
      componentSetsByDevice,
      assetsByDevice,
      instanceProperties: snapshotInstance.componentProperties || snapshotInstance.instanceProperties || null,
    });
    resolutions.push(resolved);
    if (resolved.status === 'not-applicable') {
      nextInstances.push({
        ...snapshotInstance,
        componentId: snapshotInstance.componentId,
        assetRef: snapshotInstance.assetRef,
        sourceNodeId: snapshotInstance.sourceNodeId || snapshotInstance.componentId,
      });
      continue;
    }
    if (!resolved.ok) {
      nextInstances.push({ ...snapshotInstance });
      continue;
    }
    nextInstances.push({
      ...snapshotInstance,
      componentId: resolved.componentId,
      assetRef: resolved.assetPath,
      sourceNodeId: resolved.sourceNodeId,
      lang: resolved.value,
      device,
    });
  }
  return {
    ok: resolutions.every((entry) => entry.ok !== false),
    failVisible: resolutions.filter((entry) => entry.failVisible),
    tree: { ...snapshot, instances: nextInstances },
    source: snapshot,
    resolutions,
  };
}

export function sourceTreeUnchanged(original, snapshot) {
  return JSON.stringify(original) === JSON.stringify(snapshot);
}
