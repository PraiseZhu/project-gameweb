/**
 * Stop-2 pixel oracle. Completion is the authored fill / sheet pose, not
 * data-btn-variant-state. Numbers come from btn/切换语言 758:1710/758:1713
 * and modal/pc* img/弹窗背景 3840×1340 @ y=199.
 */
export const LANG_BTN_FILL = Object.freeze({
  highlight: Object.freeze({
    componentId: '758:1713',
    cssRgb: 'rgb(169, 177, 220)',
    cssRgbEnd: 'rgb(81, 93, 127)',
  }),
  normal: Object.freeze({
    componentId: '758:1710',
    cssRgb: 'rgb(127, 133, 162)',
    cssRgbEnd: 'rgb(59, 68, 94)',
  }),
});

export const LANG_OPTION_PAGES = Object.freeze([
  { lang: 'en', label: 'English' },
  { lang: 'zh-TW', label: '繁體中文' },
  { lang: 'zh-CN', label: '简体中文' },
  { lang: 'ko', label: '한국어' },
]);

export const PC_MODAL_SHEET = Object.freeze({
  w: 3840,
  h: 2160,
  panel: Object.freeze({ x: 0, y: 199, w: 3840, h: 1340 }),
});

export function backgroundMatchesFill(backgroundImage, state) {
  const fill = LANG_BTN_FILL[state];
  if (!fill || typeof backgroundImage !== 'string') return false;
  const other = LANG_BTN_FILL[state === 'highlight' ? 'normal' : 'highlight'];
  return backgroundImage.includes(fill.cssRgb) && !backgroundImage.includes(other.cssRgb);
}

export function languageOptionVerdict(options, currentLang) {
  const wanted = LANG_OPTION_PAGES.find((row) => row.lang === currentLang);
  if (!wanted) return { ok: false, error: `unknown-lang:${currentLang}` };
  const rows = Array.isArray(options) ? options : [];
  const problems = [];
  if (rows.length < 2) problems.push('language-option-count');
  for (const row of rows) {
    const isCurrent = row.text === wanted.label;
    const expected = isCurrent ? 'highlight' : 'normal';
    if (!row.visibleCount) problems.push(`missing-label:${row.text || '?'}`);
    if (row.state !== expected) problems.push(`state:${row.text}:${row.state}!=${expected}`);
    if (row.fillSource !== expected) problems.push(`fill-source:${row.text}:${row.fillSource}!=${expected}`);
    if (!backgroundMatchesFill(row.ownerBg, expected)) {
      problems.push(`fill-pixel:${row.text}:${expected}`);
    }
  }
  const current = rows.find((row) => row.text === wanted.label);
  if (!current) problems.push(`missing-current:${wanted.label}`);
  return { ok: problems.length === 0, problems, currentLang, label: wanted.label };
}

export function pcModalSheetVerdict({
  sheetCx,
  sheetCy,
  viewCx,
  viewCy,
  panelTopRatio,
  panelBox,
} = {}) {
  const problems = [];
  const specRatio = PC_MODAL_SHEET.panel.y / PC_MODAL_SHEET.h;
  const expectedBox = `${PC_MODAL_SHEET.panel.x},${PC_MODAL_SHEET.panel.y},${PC_MODAL_SHEET.panel.w},${PC_MODAL_SHEET.panel.h}`;
  if (panelBox && panelBox !== expectedBox) problems.push(`panel-box:${panelBox}`);
  if (!Number.isFinite(sheetCx) || !Number.isFinite(viewCx) || Math.abs(sheetCx - viewCx) > 2) {
    problems.push('sheet-x-not-centered');
  }
  if (!Number.isFinite(sheetCy) || !Number.isFinite(viewCy) || Math.abs(sheetCy - viewCy) > 2) {
    problems.push('sheet-y-not-centered');
  }
  if (!Number.isFinite(panelTopRatio) || Math.abs(panelTopRatio - specRatio) > 0.01) {
    problems.push(`panel-y-ratio:${panelTopRatio}!=${specRatio}`);
  }
  return { ok: problems.length === 0, problems, specPanelY: specRatio };
}

export function measuredOk(entry) {
  return !!entry
    && entry.ok === true
    && entry.skipped === false
    && entry.measured === true;
}

export function mobileModalSheetVerdict({
  hostW,
  hostH,
  hostLeft,
  hostTop,
  modalW,
  modalH,
  modalLeft,
  modalTop,
  closedAfterClose,
  scrollbarHidden,
  hasClose,
  hasNamedScroll,
} = {}) {
  const problems = [];
  if (!Number.isFinite(hostW) || !Number.isFinite(hostH) || hostW <= 0 || hostH <= 0) {
    problems.push('mobile-host-missing');
  }
  if (!Number.isFinite(modalW) || !Number.isFinite(modalH)) problems.push('mobile-modal-box-missing');
  if ([hostLeft, hostTop, modalLeft, modalTop].some((value) => !Number.isFinite(Number(value)))) {
    problems.push('mobile-modal-origin-missing');
  }
  if (Number.isFinite(modalW) && Number.isFinite(hostW) && modalW > hostW + 1) problems.push('mobile-modal-wider-than-sheet');
  if (Number.isFinite(modalH) && Number.isFinite(hostH) && modalH > hostH + 1) problems.push('mobile-modal-taller-than-sheet');
  const hostL = Number(hostLeft);
  const hostT = Number(hostTop);
  const modalL = Number(modalLeft);
  const modalT = Number(modalTop);
  if ([hostL, hostT, modalL, modalT, hostW, hostH, modalW, modalH].every(Number.isFinite)) {
    if (modalL + 1 < hostL || modalT + 1 < hostT
      || modalL + modalW > hostL + hostW + 1
      || modalT + modalH > hostT + hostH + 1) {
      problems.push('mobile-modal-outside-sheet');
    }
  }
  if (hasClose !== true) problems.push('mobile-close-missing');
  if (closedAfterClose !== true) problems.push('mobile-close-did-not-close');
  if (hasNamedScroll === true && scrollbarHidden !== true) problems.push('mobile-scrollbar-visible');
  return { ok: problems.length === 0, problems };
}

export function pcModalCloseVerdict({ hasClose, closedAfterClose, scrollbarHidden, hasNamedScroll } = {}) {
  const problems = [];
  if (hasClose !== true) problems.push('pc-close-missing');
  if (closedAfterClose !== true) problems.push('pc-close-did-not-close');
  if (hasNamedScroll === true && scrollbarHidden !== true) problems.push('pc-scrollbar-visible');
  return { ok: problems.length === 0, problems };
}

function modalLangGoOk(entry, { plat }) {
  if (!entry || entry.lang !== 'zh-CN') return false;
  if (!/适龄/.test(String(entry.go || ''))) return false;
  return catalogGoMatchesPlat(entry.go, plat);
}

export function catalogGoMatchesPlat(go, plat, { mountedNames = null } = {}) {
  const text = String(go || '').replace(/^modal\//, '').trim();
  if (!text) return false;
  if (plat !== 'pc' && plat !== 'mobile') return false;
  /* Cross-platform labels stay out. Unprefixed same-platform names
     (视频弹窗 / 顶部导航-1624尺寸 / 多语言按钮弹窗) are legal. */
  if (plat === 'pc' && /mobile/i.test(text)) return false;
  if (plat === 'mobile' && /(?:^|\/)pc(?![a-z])/i.test(text) && !/mobile/i.test(text)) return false;
  if (Array.isArray(mountedNames) && mountedNames.length) {
    const names = new Set(mountedNames.map((name) => String(name || '').replace(/^modal\//, '').trim()).filter(Boolean));
    return names.has(text);
  }
  return true;
}

export function catalogOpenedGoMatches(go, openedGo) {
  const wanted = String(go || '').replace(/^modal\//, '').trim();
  const opened = String(openedGo || '').replace(/^modal\//, '').trim();
  return Boolean(wanted) && wanted === opened;
}

export function catalogEvidenceOk(catalog, { plat } = {}) {
  if (!measuredOk(catalog)) return false;
  const wanted = plat || catalog.plat;
  if (wanted !== 'pc' && wanted !== 'mobile') return false;
  const openers = Array.isArray(catalog.openers) ? catalog.openers : [];
  if (!openers.length) return false;
  if (openers.some((row) => !measuredOk(row) || row.opened !== true || row.closed !== true)) return false;
  const mountedNames = Array.isArray(catalog.mountedNames) ? catalog.mountedNames : null;
  if (openers.some((row) => !catalogGoMatchesPlat(row.go, wanted, { mountedNames }))) return false;
  if (openers.some((row) => !catalogOpenedGoMatches(row.go, row.openedGo))) return false;
  if (!measuredOk(catalog.inert)) return false;
  if (catalog.inert.openedModal === true) return false;
  return true;
}

export function laterAxesPixelEvidenceComplete(parsed) {
  const pixel = parsed && parsed.pixel;
  if (!pixel || pixel.ok !== true) return false;
  const langs = Array.isArray(pixel.languages) ? pixel.languages : [];
  if (langs.length !== LANG_OPTION_PAGES.length) return false;
  if (langs.some((row) => !measuredOk(row))) return false;
  const measured = [pixel.stalePrefs, pixel.modal, pixel.mobile, pixel.modal?.close, pixel.mobile?.close];
  if (measured.some((row) => !measuredOk(row))) return false;
  if (!modalLangGoOk(pixel.modal, { plat: 'pc' })) return false;
  if (!modalLangGoOk(pixel.mobile, { plat: 'mobile' })) return false;
  if (!catalogEvidenceOk(pixel.pcCatalog, { plat: 'pc' })) return false;
  if (!catalogEvidenceOk(pixel.mobileCatalog, { plat: 'mobile' })) return false;
  return true;
}
