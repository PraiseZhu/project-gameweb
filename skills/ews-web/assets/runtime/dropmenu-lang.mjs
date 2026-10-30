/**
 * A9 closed self-label table. Unknown labels are ordinary options, not guessed.
 */

export const LANG_SELF_LABELS = ['简体中文', '繁體中文', 'English', '日本語', '한국어'];

const LANG_SELF = new Map([
  ['简体中文', 'zh-CN'],
  ['繁體中文', 'zh-TW'],
  ['english', 'en'],
  ['日本語', 'ja'],
  ['한국어', 'ko'],
  ['한국인', 'ko'],
]);

export function normalizeSelfLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function langFromSelfLabel(value) {
  const key = normalizeSelfLabel(value);
  if (!key) return null;
  if (LANG_SELF.has(key)) return LANG_SELF.get(key);
  for (const [label, locale] of LANG_SELF) {
    if (normalizeSelfLabel(label) === key) return locale;
  }
  return null;
}
