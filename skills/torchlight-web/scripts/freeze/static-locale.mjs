export const LOCALE_PAGES = [
  {
    locale: 'cn',
    lang: 'zh-CN',
    region: 'cn',
    source: 'index.html',
    out: 'cn.static.html',
    title: '火炬之光：无限',
  },
  {
    locale: 'tw',
    lang: 'zh-TW',
    region: 'global',
    source: 'index.html',
    out: 'tw.static.html',
    title: '火炬之光：無限',
  },
  {
    locale: 'en',
    lang: 'en',
    region: 'global',
    source: 'index.html',
    out: 'en.static.html',
    title: 'Torchlight: Infinite',
  },
  {
    locale: 'ko',
    lang: 'ko',
    region: 'global',
    source: 'index.html',
    out: 'ko.static.html',
    title: '토치라이트: 인피니트',
  },
];

export const SHARED_ASSETS_DIR = 'static-assets';

const ALL_RESERVE_MODALS = [
  'pc_cn预约弹窗',
  'pc_tw预约弹窗',
  'pc_en预约弹窗',
  'pc_kr预约弹窗',
  'mobile_cn预约弹窗',
  'mobile_tw预约弹窗',
  'mobile_en预约弹窗',
  'mobile_kr预约弹窗',
];

const ALIAS = {
  kr: 'ko',
  hant: 'tw',
  'zh-tw': 'tw',
  'zh-hant': 'tw',
  'zh-cn': 'cn',
  hans: 'cn',
};

export function normalizeLocale(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (ALIAS[raw]) return ALIAS[raw];
  if (raw === 'cn' || raw === 'tw' || raw === 'en' || raw === 'ko') return raw;
  return '';
}

export function localeFromPath(filePath) {
  const base = String(filePath || '').split(/[\\/]/).pop() || '';
  const stem = base.replace(/\.static\.html$/i, '').replace(/\.html$/i, '');
  return normalizeLocale(stem);
}

export function localeFromHtmlLang(lang) {
  const raw = String(lang || '').trim().toLowerCase();
  if (raw.startsWith('zh-hant') || raw === 'zh-tw') return 'tw';
  if (raw.startsWith('zh')) return 'cn';
  if (raw.startsWith('ko')) return 'ko';
  if (raw.startsWith('en')) return 'en';
  return '';
}

export function resolveFreezeLocale(options = {}) {
  const explicit = normalizeLocale(options.locale);
  if (explicit) return explicit;
  const fromOut = localeFromPath(options.outPath || options.out || '');
  if (fromOut) return fromOut;
  const fromSource = localeFromPath(options.sourcePath || options.source || options.url || '');
  if (fromSource) return fromSource;
  const fromLang = localeFromHtmlLang(options.htmlLang);
  if (fromLang) return fromLang;
  return 'cn';
}

function reservationToken(locale) {
  const keep = normalizeLocale(locale) || 'cn';
  return keep === 'ko' ? 'kr' : keep;
}

export function reservationModalsToKeep(locale) {
  const token = reservationToken(locale);
  return ALL_RESERVE_MODALS.filter((name) => name.includes(`_${token}预约`));
}

export function reservationModalsToStrip(locale) {
  const keep = new Set(reservationModalsToKeep(locale));
  return ALL_RESERVE_MODALS.filter((name) => !keep.has(name));
}

export function reservationModalPattern(locale, flags = '') {
  const names = reservationModalsToStrip(locale);
  if (!names.length) return new RegExp('$^');
  const body = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp('data-modal-name="(?:' + body + ')"', flags);
}

export function shouldStripLanguageSwitcher(locale) {
  return (normalizeLocale(locale) || 'cn') === 'cn';
}

export const LANGUAGE_SWITCHER_RE = /data-name="dropmenu\/多语言"|data-dropmenu-name="多语言"/;

function findDivEnd(html, openTagEnd) {
  let i = openTagEnd;
  let depth = 1;
  while (i < html.length && depth > 0) {
    const nxtOpen = html.indexOf('<div', i);
    const nxtClose = html.indexOf('</div>', i);
    if (nxtClose < 0) throw new Error('unclosed div while stripping named node');
    if (nxtOpen >= 0 && nxtOpen < nxtClose) {
      const endtag = html.indexOf('>', nxtOpen);
      const tag = html.slice(nxtOpen, endtag + 1);
      if (!tag.endsWith('/>')) depth += 1;
      i = endtag + 1;
    } else {
      depth -= 1;
      i = nxtClose + 6;
    }
  }
  return i;
}

function stripNamedDivs(html, matches) {
  const cuts = [];
  for (const match of matches) {
    cuts.push([match.index, findDivEnd(html, match.index + match[0].length)]);
  }
  cuts.sort((a, b) => b[0] - a[0]);
  let out = html;
  for (const [start, end] of cuts) out = out.slice(0, start) + out.slice(end);
  return out;
}

export function stripReservationModals(html, locale) {
  const names = new Set(reservationModalsToStrip(locale));
  const re = /<div\b[^>]*class="[^"]*\bfx-named-modal\b[^"]*"[^>]*>/g;
  const cuts = [];
  let match;
  while ((match = re.exec(html))) {
    const nameMatch = match[0].match(/data-modal-name="([^"]+)"/);
    const name = nameMatch && nameMatch[1];
    if (!names.has(name)) continue;
    cuts.push(match);
  }
  return stripNamedDivs(html, cuts);
}

export function stripReservationModalCss(css, locale) {
  const names = reservationModalsToStrip(locale);
  if (!names.length) return css;
  const body = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp('[^{}]*data-modal-name="(?:' + body + ')"[^{]*\\{[^{}]*\\}', 'g');
  return css.replace(re, '');
}

export function stripLanguageSwitchers(html) {
  const re = /<div\b[^>]*(?:data-name="dropmenu\/多语言"|data-dropmenu-name="多语言")[^>]*>/g;
  const cuts = [];
  let match;
  while ((match = re.exec(html))) cuts.push(match);
  let out = stripNamedDivs(html, cuts);
  out = out.replace(/\s*id="fx-lang-switch"/g, '');
  return out;
}
