import { LANG_CODES, LANG_CODE_SET } from '../../figma-naming/spec/spec.mjs';
import { StoppedError } from './stopped.mjs';

export { LANG_CODES, LANG_CODE_SET };

export const PLATFORMS = Object.freeze(['pc', 'mobile', 'pc+mobile']);

export function parseLanguages(raw) {
  if (raw == null) {
    throw new StoppedError(
      'languages',
      '没有语言集合。请提供精确小写语言代码，例如 cn 或 cn,tw,en（仅 cn/tw/en/jp/kr）。',
    );
  }
  const parts = Array.isArray(raw) ? raw.map((item) => String(item)) : String(raw).split(',');
  if (parts.length === 1 && parts[0] === '') {
    throw new StoppedError(
      'languages',
      '没有语言集合。请提供精确小写语言代码，例如 cn 或 cn,tw,en（仅 cn/tw/en/jp/kr）。',
    );
  }
  const seen = new Set();
  for (const part of parts) {
    if (part !== part.trim() || part === '') {
      throw new StoppedError(
        'languages',
        `语言代码非法：${JSON.stringify(part)}。只接受精确小写 cn/tw/en/jp/kr，逗号分隔且不要空格或重复。`,
      );
    }
    if (!LANG_CODE_SET.has(part)) {
      throw new StoppedError(
        'languages',
        `语言代码非法：${part}。只接受精确小写 cn/tw/en/jp/kr。`,
      );
    }
    if (seen.has(part)) {
      throw new StoppedError(
        'languages',
        `语言代码重复：${part}。每种语言只能出现一次。`,
      );
    }
    seen.add(part);
  }
  return LANG_CODES.filter((code) => seen.has(code));
}

export function parseBaseLanguage(raw, languages) {
  if (!Array.isArray(languages) || languages.length === 0) {
    throw new StoppedError(
      'base-language',
      '没有语言集合，无法确定基础语言。',
    );
  }
  if (languages.length === 1) {
    if (raw == null || String(raw) === '') return languages[0];
    if (String(raw) !== languages[0]) {
      throw new StoppedError(
        'base-language',
        `只有一种语言时基础语言必须是 ${languages[0]}。`,
      );
    }
    return languages[0];
  }
  if (raw == null || String(raw) === '') {
    throw new StoppedError(
      'base-language',
      '多种语言时必须指定基础语言，且必须在语言集合内。',
    );
  }
  const base = String(raw);
  if (base !== base.trim() || !LANG_CODE_SET.has(base)) {
    throw new StoppedError(
      'base-language',
      `基础语言非法：${base}。只接受精确小写 cn/tw/en/jp/kr。`,
    );
  }
  if (!languages.includes(base)) {
    throw new StoppedError(
      'base-language',
      `基础语言 ${base} 不在语言集合（${languages.join(',')}）内。`,
    );
  }
  return base;
}

export function parsePlatform(raw) {
  const text = raw == null ? '' : String(raw);
  if (!PLATFORMS.includes(text)) {
    throw new StoppedError(
      'platform',
      '端别非法。只接受 pc、mobile 或 pc+mobile。',
    );
  }
  return text;
}
