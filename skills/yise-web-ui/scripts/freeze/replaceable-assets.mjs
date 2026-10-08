function safeToken(value, fallback) {
  const cleaned = String(value || '').trim().replace(/[^0-9A-Za-z._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

export function replaceableAssetFileName({ purpose, platform = 'any', lang = 'any', ext = 'webp' } = {}) {
  const suffix = safeToken(String(ext || 'webp').replace(/^\./, ''), 'webp');
  return [safeToken(purpose, 'asset'), safeToken(platform, 'any'), safeToken(lang, 'any')].join('.') + '.' + suffix;
}

export function planAssetReplacements(entries = []) {
  return entries.map((entry) => ({
    from: String(entry.oldName || ''),
    to: replaceableAssetFileName(entry),
    purpose: entry.purpose || 'asset',
    platform: entry.platform || 'any',
    lang: entry.lang || 'any',
  }));
}
