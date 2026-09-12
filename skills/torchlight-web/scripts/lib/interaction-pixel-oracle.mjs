/**
 * Stop-2 pixel oracle. Completion is the authored fill / sheet pose, not
 * data-btn-variant-state. Language fills come from this page inventory:
 * btn/切换语言 highlight/normal, img/选中背景 and img/未选中背景.
 * PC modal pose is centered; panel box comes from img/弹窗背景 on this page.
 */
export function rgbTriples(css) {
  const out = [];
  const re = /rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/g;
  let match;
  while ((match = re.exec(String(css || '')))) out.push(`${match[1]},${match[2]},${match[3]}`);
  return out;
}

export function backgroundMatchesFill(backgroundImage, state, fills) {
  if (typeof backgroundImage !== 'string' || !backgroundImage) return false;
  if (state === 'highlight' && /img\/选中背景/.test(backgroundImage) && !/img\/未选中背景/.test(backgroundImage)) {
    return true;
  }
  if (state === 'normal' && /img\/未选中背景/.test(backgroundImage) && !/img\/选中背景/.test(backgroundImage)) {
    return true;
  }
  const fill = fills && fills[state];
  const other = fills && fills[state === 'highlight' ? 'normal' : 'highlight'];
  if (!fill || !fill.cssRgb) return false;
  const triples = rgbTriples(backgroundImage);
  const has = (rgb) => {
    const token = rgbTriples(rgb)[0];
    return Boolean(token && triples.includes(token));
  };
  return has(fill.cssRgb) && !(other && other.cssRgb && has(other.cssRgb));
}

export function languageOptionVerdict(options, currentLang) {
  const rows = Array.isArray(options) ? options : [];
  const problems = [];
  if (rows.length < 2) problems.push('language-option-count');
  const highs = rows.filter((row) => row.state === 'highlight');
  if (highs.length !== 1) problems.push('highlight-count:' + highs.length);
  const current = (currentLang && rows.find((row) => row.lang === currentLang)) || highs[0] || null;
  if (currentLang && current && current.lang && current.lang !== currentLang) {
    problems.push('highlight-lang:' + current.lang + '!=' + currentLang);
  }
  if (currentLang && !current) problems.push('missing-current:' + currentLang);
  for (const row of rows) {
    const isCurrent = Boolean(current && row === current);
    const expected = isCurrent ? 'highlight' : 'normal';
    if (!row.visibleCount) problems.push('missing-label:' + (row.text || '?'));
    if (row.state !== expected) problems.push('state:' + (row.text || '?') + ':' + row.state + '!=' + expected);
    if (row.fillSource !== expected) problems.push('fill-source:' + (row.text || '?') + ':' + row.fillSource + '!=' + expected);
    if (!backgroundMatchesFill(row.ownerBg, expected, row.fills)) {
      problems.push('fill-pixel:' + (row.text || '?') + ':' + expected);
    }
  }
  return { ok: problems.length === 0, problems, currentLang, label: current && current.text };
}

export function pcModalSheetVerdict({
  sheetCx,
  sheetCy,
  viewCx,
  viewCy,
  panelTopRatio,
  panelBox,
  expected = null,
} = {}) {
  const problems = [];
  if (!Number.isFinite(sheetCx) || !Number.isFinite(viewCx) || Math.abs(sheetCx - viewCx) > 2) {
    problems.push('sheet-x-not-centered');
  }
  if (!Number.isFinite(sheetCy) || !Number.isFinite(viewCy) || Math.abs(sheetCy - viewCy) > 2) {
    problems.push('sheet-y-not-centered');
  }
  if (!Number.isFinite(panelTopRatio)) problems.push('panel-y-missing');
  if (expected && expected.panelBox && panelBox && panelBox !== expected.panelBox) {
    problems.push('panel-box:' + panelBox);
  }
  if (expected && Number.isFinite(Number(expected.panelTopRatio)) && Number.isFinite(panelTopRatio)
    && Math.abs(panelTopRatio - Number(expected.panelTopRatio)) > 0.01) {
    problems.push('panel-y-ratio:' + panelTopRatio + '!=' + expected.panelTopRatio);
  }
  return { ok: problems.length === 0, problems, specPanelY: expected && expected.panelTopRatio };
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
  if (!String(entry.go || '').replace(/^modal\//, '').trim()) return false;
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

export function dropmenuOverlapEvidenceOk(hit) {
  const evidence = hit && hit.sourceOverlapEvidence;
  return Boolean(evidence && evidence.dropmenuNode && evidence.consentNode);
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
  const dropOk = (hit) => hit.invalid !== true && hit.toggled === true
    && (hit.sourceOverlap === true ? dropmenuOverlapEvidenceOk(hit) : hit.coversConsent !== true)
    && hit.closedConsentClickable !== false
    && hit.optionFill !== false;
  if (openers.some((row) => (row.dropmenus || []).some((hit) => !dropOk(hit)))) return false;
  if (openers.some((row) => row.calendarLang && row.calendarLang.matched !== true)) return false;
  if (openers.some((row) => (row.calendarCopy || []).some((hit) => hit.missing === true && hit.lang && hit.lang !== 'zh-CN'))) return false;
  if (!measuredOk(catalog.inert)) return false;
  if (catalog.inert.openedModal === true) return false;
  return true;
}

export function laterAxesPixelEvidenceComplete(parsed) {
  const pixel = parsed && parsed.pixel;
  if (!pixel || pixel.ok !== true) return false;
  const langs = Array.isArray(pixel.languages) ? pixel.languages : [];
  if (langs.length < 1) return false;
  if (langs.some((row) => !measuredOk(row))) return false;
  const measured = [pixel.stalePrefs, pixel.modal, pixel.mobile, pixel.modal?.close, pixel.mobile?.close];
  if (measured.some((row) => !measuredOk(row))) return false;
  if (!modalLangGoOk(pixel.modal, { plat: 'pc' })) return false;
  if (!modalLangGoOk(pixel.mobile, { plat: 'mobile' })) return false;
  if (!catalogEvidenceOk(pixel.pcCatalog, { plat: 'pc' })) return false;
  if (!catalogEvidenceOk(pixel.mobileCatalog, { plat: 'mobile' })) return false;
  return true;
}
