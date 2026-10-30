/**
 * Explicit interaction opt-in, independent of product chrome.
 * Missing query is inert. Stop-1 / default QA keep component controls static
 * while sec paging and QA tools stay live. Torchlight uses the same ?interaction=1.
 */
export function isPageInteractionEnabled(search = globalThis.location?.search || '') {
  const raw = String(search || '').replace(/^\?/, '');
  const q = new URLSearchParams(raw).get('interaction');
  const value = String(q || '').toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

export function pageInteractionMode(search = globalThis.location?.search || '') {
  return isPageInteractionEnabled(search) ? 'live' : 'inert';
}
