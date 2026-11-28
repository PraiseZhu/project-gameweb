import { missingGlyphs } from '../cmap.mjs';

const token = /\{\{\s*[\w.]+\s*\}\}|\{[\w.]+\}|%\d+\$[sdif]|%[sdif]/gu;
const tokens = (text) => [...text.matchAll(token)].map(([match]) => match.replace(/\s/g, '')).sort();
export const localeTags = Object.freeze({ cn:'zh-CN', tw:'zh-TW', en:'en', jp:'ja', kr:'ko' });

export function checkedLocale(lang) {
  if (!Object.hasOwn(localeTags, lang)) throw new Error('不支持的语言（E 不接受 RTL）：' + lang);
  return localeTags[lang];
}

export function auditCopy({ source, translation, font, target }) {
  if (translation == null || typeof translation === 'string' && !translation.trim()) {
    return { text:'—', untranslated:true, warnings:[] };
  }
  if (typeof translation !== 'string' || JSON.stringify(tokens(source)) !== JSON.stringify(tokens(translation))) {
    throw new Error('动态占位符不一致：' + target);
  }
  const warnings = [];
  if (translation !== translation.trim() || /[\p{Cc}\p{Cf}\uFFFD]/u.test(translation.replace(/[\n\t]/g, ''))) warnings.push('译文包含边界空白、控制字符或替换字符');
  if (!font) throw new Error('缺目标语言核验字体：' + target);
  const missing = missingGlyphs(font, translation);
  if (missing.length) throw new Error('目标语言字体缺字：' + target + ' / ' + missing.join(' '));
  return { text:translation, untranslated:false, warnings };
}

export function translationIndex({ matched, pending }, lang) {
  const values = new Map();
  for (const row of [...matched, ...pending]) {
    const key = JSON.stringify([row.end, row.nodeId]);
    const value = { source:row.characters, translation:row.byLang?.[lang] };
    const previous = values.get(key);
    if (previous && (previous.source !== value.source || previous.translation !== value.translation)) throw new Error('译文定位冲突：' + key);
    values.set(key, value);
  }
  return values;
}
