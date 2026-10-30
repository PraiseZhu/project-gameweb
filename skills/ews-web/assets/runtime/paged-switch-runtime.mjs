// Pages move as a transform track (official Swiper: cssMode=false, 300ms ease), not native
// scrollLeft. Native scroll inside the scaled world snaps to device pixels differently per page.
export const PAGED_DRAG_THRESHOLD_PX = 10;
export const PAGED_SWIPE_RATIO = 0.5;
export const PAGED_FLICK_MS = 300;
// A slower drag still turns when the finger is moving fast at release (screen px/ms over
// the last ~100ms). Without it, natural swipes that take >300ms and stop short of half a
// page snap back, which reads as "can't swipe" on phones.
export const PAGED_FLICK_VELOCITY = 0.2;
export const FLICK_SAMPLE_MS = 100;

export function releaseVelocity(samples, now = Date.now()) {
  const recent = (samples || []).filter((s) => now - s.t <= FLICK_SAMPLE_MS);
  if (recent.length < 2) return 0;
  const a = recent[0];
  const b = recent[recent.length - 1];
  const dt = b.t - a.t;
  return dt > 0 ? (b.x - a.x) / dt : 0;
}
export const PAGED_TRANSITION_MS = 300;

export function pagedPageOf(viewport) {
  const page = Number(viewport?.getAttribute?.('data-paged-current'));
  return Number.isFinite(page) && page >= 0 ? page : 0;
}

function currentPage(viewport) {
  return pagedPageOf(viewport);
}

// Official Swiper: only the active slide is opaque (inactive opacity 0, 300ms ease-in-out).
// While dragging the neighbour stays invisible; on commit active flips, so the old page
// fades out while the track snaps — the "ghost" — and the new page fades in.
function pagesOf(viewport) {
  return [...(viewport.querySelectorAll?.(':scope > .ews-paged-page') || [])];
}

function setTrack(viewport, page, dragPx = 0, trackPos = page) {
  viewport.setAttribute('data-paged-current', String(page));
  viewport.style?.setProperty?.('--ews-paged-offset', `${-trackPos * 100}%`);
  viewport.style?.setProperty?.('--ews-paged-drag', `${dragPx}px`);
  pagesOf(viewport).forEach((el, i) => el.setAttribute('data-paged-active', i === page ? '1' : '0'));
}

function withoutTransition(viewport, fn) {
  viewport.setAttribute('data-paged-dragging', '1');
  fn();
  void viewport.offsetWidth;
  viewport.removeAttribute('data-paged-dragging');
}

// Loop wrap like Swiper loop clones: the target page is shifted one slot past the edge,
// the track slides one page in the travel direction, then (300ms later) everything jumps
// back to the real slot with no transition. Never slides backwards across all pages.
function settleLoop(viewport) {
  clearTimeout(viewport.__ewsLoopTimer);
  viewport.__ewsLoopTimer = null;
  const pages = pagesOf(viewport);
  if (!pages.some((el) => el.style.getPropertyValue('--ews-paged-shift'))) return;
  withoutTransition(viewport, () => {
    for (const el of pages) el.style.removeProperty('--ews-paged-shift');
    setTrack(viewport, pagedPageOf(viewport), 0);
  });
}

function wrapAcross(viewport, raw, next, pageCount) {
  const pages = pagesOf(viewport);
  const target = pages[next];
  if (!target) return false;
  // Park the target in the slot past the edge instantly (it is transparent), then animate
  // the track one page; otherwise the target would visibly travel in from the wrong side.
  target.style.transition = 'none';
  target.style.setProperty('--ews-paged-shift', `${(raw < 0 ? -pageCount : pageCount) * 100}%`);
  void target.offsetWidth;
  target.style.removeProperty('transition');
  setTrack(viewport, next, 0, raw);
  viewport.__ewsLoopTimer = setTimeout(() => settleLoop(viewport), PAGED_TRANSITION_MS + 20);
  return true;
}

function isLooped(viewport) {
  return viewport?.getAttribute('data-paged-loop') === '1';
}

export function pagerDisabledState({ page, pageCount, loop }) {
  if (loop || Number(pageCount) <= 1) return { prev: false, next: false };
  return { prev: Number(page) <= 0, next: Number(page) >= Number(pageCount) - 1 };
}

function wrapPage(page, pageCount) {
  const n = Math.max(1, Number(pageCount) || 1);
  return ((Number(page) % n) + n) % n;
}

function goToPage(viewport, page, pageCount, { animate = true } = {}) {
  const loop = isLooped(viewport);
  const next = loop
    ? wrapPage(page, pageCount)
    : Math.max(0, Math.min(pageCount - 1, page));
  settleLoop(viewport);
  const wraps = loop && animate && pageCount > 1 && (page < 0 || page >= pageCount);
  if (wraps && wrapAcross(viewport, page < 0 ? -1 : pageCount, next, pageCount)) return next;
  if (animate) setTrack(viewport, next, 0);
  else withoutTransition(viewport, () => setTrack(viewport, next, 0));
  return next;
}

function paintPagerButtons(root, switchId, page) {
  const viewport = root.querySelector?.(
    `.ews-paged-viewport[data-paged-switch="${cssEscape(String(switchId))}"]`,
  );
  const pageCount = Number(viewport?.getAttribute('data-paged-count')) || 1;
  const disabled = pagerDisabledState({
    page,
    pageCount,
    loop: isLooped(viewport),
  });
  const apply = (dir, on) => {
    for (const el of root.querySelectorAll?.(`[data-paged-${dir}][data-paged-for="${cssEscape(String(switchId))}"]`) || []) {
      if (on) {
        el.setAttribute('disabled', '');
        el.setAttribute('aria-disabled', 'true');
      } else {
        el.removeAttribute('disabled');
        el.setAttribute('aria-disabled', 'false');
      }
    }
  };
  apply('prev', disabled.prev);
  apply('next', disabled.next);
}

function cssEscape(value) {
  const raw = String(value);
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(raw);
  return raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function cssUrl(src) {
  const escaped = String(src || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `url('${escaped}')`;
}

export function paintPagedDots(root, switchId, page) {
  if (!root?.querySelectorAll) return;
  const host = root.querySelector(`[data-paged-dots-for="${cssEscape(String(switchId))}"]`);
  const activeW = host?.getAttribute('data-paged-active-w');
  const inactiveW = host?.getAttribute('data-paged-inactive-w');
  const activeH = host?.getAttribute('data-paged-active-h');
  const inactiveH = host?.getAttribute('data-paged-inactive-h');
  const activeSrc = host?.getAttribute('data-paged-active-src') || '';
  const inactiveSrc = host?.getAttribute('data-paged-inactive-src') || '';
  const activeFill = host?.getAttribute('data-paged-active-fill') || '';
  const inactiveFill = host?.getAttribute('data-paged-inactive-fill') || '';
  for (const dot of root.querySelectorAll(`[data-paged-dot][data-paged-for="${cssEscape(String(switchId))}"]`)) {
    const on = Number(dot.getAttribute('data-paged-dot')) === Number(page);
    dot.setAttribute('aria-current', on ? 'true' : 'false');
    const width = on ? activeW : inactiveW;
    const height = on ? activeH : inactiveH;
    const src = on ? activeSrc : inactiveSrc;
    const fill = on ? activeFill : inactiveFill;
    if (width) dot.style.width = `${width}px`;
    if (height) dot.style.height = `${height}px`;
    if (src) {
      dot.style.backgroundImage = cssUrl(src);
      dot.style.backgroundSize = '100% 100%';
      dot.style.backgroundRepeat = 'no-repeat';
      dot.style.backgroundColor = 'transparent';
    } else {
      dot.style.backgroundImage = 'none';
      if (fill) dot.style.backgroundColor = fill;
    }
  }
}

export function formatPagedIndex(sample, current, total) {
  const match = String(sample || '').match(/^(\d+)\s*\/\s*(\d+)$/);
  const width = match ? match[1].length : 2;
  return `${String(current).padStart(width, '0')}/${String(total).padStart(width, '0')}`;
}

function paintPageIndex(root, switchId, page) {
  const viewport = root.querySelector?.(`.ews-paged-viewport[data-paged-switch="${cssEscape(String(switchId))}"]`);
  const pageCount = Number(viewport?.getAttribute('data-paged-count')) || 1;
  const current = Math.max(1, Math.min(pageCount, Number(page) + 1));
  for (const el of root.querySelectorAll?.(`[data-paged-index-for="${cssEscape(String(switchId))}"]`) || []) {
    if (!el.hasAttribute('data-paged-index-sample')) {
      el.setAttribute('data-paged-index-sample', String(el.textContent || '').trim());
    }
    el.textContent = formatPagedIndex(el.getAttribute('data-paged-index-sample'), current, pageCount);
  }
}

function syncDots(root, switchId, page) {
  paintPagedDots(root, switchId, page);
  paintPageIndex(root, switchId, page);
  paintPagerButtons(root, switchId, page);
}

export function alignPagedForPixel(root) {
  const reports = [];
  if (!root?.querySelectorAll) return reports;
  for (const viewport of root.querySelectorAll('.ews-paged-viewport[data-paged-switch]')) {
    const switchId = viewport.getAttribute('data-paged-switch');
    const capacity = Number(viewport.getAttribute('data-paged-capacity')) || 0;
    const indCount = Number(viewport.getAttribute('data-paged-ind-count')) || 0;
    const pages = [...viewport.querySelectorAll(':scope > .ews-paged-page')];
    const liveCardCount = pages.reduce((sum, page) => sum + page.querySelectorAll('[data-paged-card]').length, 0);
    goToPage(viewport, 0, pages.length || 1, { animate: false });
    syncDots(root, switchId, 0);
    reports.push({
      switchId,
      indCount,
      pageCapacity: capacity,
      cardCount: liveCardCount,
      pageCount: pages.length,
      page: 0,
      source: 'product-live',
    });
  }
  return reports;
}

export function applyPagedSwitch(root, switchId, page, { animate = false } = {}) {
  if (!root?.querySelector) return -1;
  const viewport = root.querySelector(`.ews-paged-viewport[data-paged-switch="${cssEscape(String(switchId))}"]`);
  if (!viewport) return -1;
  const pageCount = Number(viewport.getAttribute('data-paged-count')) || 1;
  const next = goToPage(viewport, Number(page), pageCount, { animate });
  syncDots(root, String(switchId), next);
  return next;
}

function paintPagedChrome(root, page = 0) {
  if (!root?.querySelectorAll) return;
  for (const viewport of root.querySelectorAll('.ews-paged-viewport[data-paged-switch]')) {
    syncDots(root, viewport.getAttribute('data-paged-switch'), page);
  }
}

// Finger/mouse drag: the track follows the pointer in design units, then snaps.
// Past half a page, or a quick flick beyond the threshold, turns the page.
export function pagedReleaseTarget({ page, pageCount, loop, dx, width, ms, velocity = 0 }) {
  const moved = Math.abs(dx);
  if (!(width > 0) || moved < PAGED_DRAG_THRESHOLD_PX) return page;
  const flung = Math.abs(velocity) >= PAGED_FLICK_VELOCITY && Math.sign(velocity) === Math.sign(dx);
  const turn = moved >= width * PAGED_SWIPE_RATIO || ms < PAGED_FLICK_MS || flung;
  if (!turn) return page;
  const next = page + (dx < 0 ? 1 : -1);
  if (loop) return wrapPage(next, pageCount);
  return Math.max(0, Math.min(pageCount - 1, next));
}

function mountPagedDrag(viewport, commit, pageCount) {
  if (typeof viewport.addEventListener !== 'function' || pageCount <= 1) return () => {};
  let start = null;
  let suppressClick = false;
  const scaleOf = () => {
    const visual = viewport.getBoundingClientRect?.().width || 0;
    const layout = viewport.offsetWidth || 0;
    return visual > 0 && layout > 0 ? visual / layout : 1;
  };
  const onDown = (event) => {
    if (event.button != null && event.button !== 0) return;
    settleLoop(viewport);
    start = { x: event.clientX, y: event.clientY, t: Date.now(), id: event.pointerId, page: currentPage(viewport), dragging: false, scale: scaleOf(), samples: [{ t: Date.now(), x: event.clientX }] };
  };
  const onMove = (event) => {
    if (!start || event.pointerId !== start.id) return;
    start.samples.push({ t: Date.now(), x: event.clientX });
    if (start.samples.length > 12) start.samples.shift();
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.dragging) {
      if (Math.abs(dx) < PAGED_DRAG_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy)) {
        if (Math.abs(dy) > PAGED_DRAG_THRESHOLD_PX) start = null;
        return;
      }
      start.dragging = true;
      viewport.setAttribute('data-paged-dragging', '1');
      viewport.setPointerCapture?.(event.pointerId);
    }
    const width = viewport.offsetWidth || 0;
    let offset = dx / start.scale;
    if (!isLooped(viewport)) {
      if (start.page <= 0) offset = Math.min(0, offset);
      if (start.page >= pageCount - 1) offset = Math.max(0, offset);
    }
    offset = Math.max(-width, Math.min(width, offset));
    viewport.style.setProperty('--ews-paged-drag', `${offset}px`);
    event.preventDefault?.();
  };
  const onUp = (event) => {
    if (!start || event.pointerId !== start.id) return;
    const was = start;
    start = null;
    if (!was.dragging) return;
    suppressClick = true;
    viewport.removeAttribute('data-paged-dragging');
    const dx = (event.clientX - was.x) / was.scale;
    const target = pagedReleaseTarget({
      page: was.page, pageCount, loop: isLooped(viewport), dx, width: viewport.offsetWidth || 0, ms: Date.now() - was.t,
      velocity: releaseVelocity([...was.samples, { t: Date.now(), x: event.clientX }]),
    });
    // Loop wrap keeps the travel direction (last → first moves forward, not back across all).
    commit(target === was.page ? target : was.page + (dx < 0 ? 1 : -1));
  };
  const onCancel = () => {
    if (!start) return;
    const was = start;
    start = null;
    viewport.removeAttribute('data-paged-dragging');
    if (was.dragging) commit(was.page);
  };
  const onClickCapture = (event) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault?.();
    event.stopPropagation?.();
  };
  viewport.addEventListener('pointerdown', onDown);
  viewport.addEventListener('pointermove', onMove);
  viewport.addEventListener('pointerup', onUp);
  viewport.addEventListener('pointercancel', onCancel);
  viewport.addEventListener('click', onClickCapture, true);
  return () => {
    viewport.removeEventListener('pointerdown', onDown);
    viewport.removeEventListener('pointermove', onMove);
    viewport.removeEventListener('pointerup', onUp);
    viewport.removeEventListener('pointercancel', onCancel);
    viewport.removeEventListener('click', onClickCapture, true);
  };
}

export function mountPagedSwitches(root, { enabled = false } = {}) {
  if (!root?.querySelectorAll) return { dispose() {}, apply() { return -1; } };
  paintPagedChrome(root, 0);
  if (!enabled) {
    return {
      dispose() {},
      apply(switchId, page) {
        return applyPagedSwitch(root, switchId, page);
      },
    };
  }
  const viewports = [...root.querySelectorAll('.ews-paged-viewport[data-paged-switch]')];
  const disposers = [];
  for (const viewport of viewports) {
    const switchId = viewport.getAttribute('data-paged-switch');
    const pageCount = Number(viewport.getAttribute('data-paged-count')) || 1;
    const onClick = (event) => {
      const dot = event.target.closest?.(`[data-paged-dot][data-paged-for="${cssEscape(switchId)}"]`);
      if (dot) {
        syncDots(root, switchId, goToPage(viewport, Number(dot.getAttribute('data-paged-dot')), pageCount));
        return;
      }
      if (event.target.closest?.(`[data-paged-prev][data-paged-for="${cssEscape(switchId)}"]`)) {
        const btn = event.target.closest?.(`[data-paged-prev][data-paged-for="${cssEscape(switchId)}"]`);
        if (btn?.hasAttribute('disabled') || btn?.getAttribute('aria-disabled') === 'true') return;
        syncDots(root, switchId, goToPage(viewport, currentPage(viewport) - 1, pageCount));
        return;
      }
      if (event.target.closest?.(`[data-paged-next][data-paged-for="${cssEscape(switchId)}"]`)) {
        const btn = event.target.closest?.(`[data-paged-next][data-paged-for="${cssEscape(switchId)}"]`);
        if (btn?.hasAttribute('disabled') || btn?.getAttribute('aria-disabled') === 'true') return;
        syncDots(root, switchId, goToPage(viewport, currentPage(viewport) + 1, pageCount));
      }
    };
    const drag = mountPagedDrag(viewport, (page) => syncDots(root, switchId, goToPage(viewport, page, pageCount)), pageCount);
    root.addEventListener('click', onClick);
    syncDots(root, switchId, goToPage(viewport, currentPage(viewport), pageCount, { animate: false }));
    disposers.push(() => {
      settleLoop(viewport);
      root.removeEventListener('click', onClick);
      drag();
    });
  }
  return {
    dispose() {
      for (const fn of disposers) fn();
    },
    apply(switchId, page) {
      return applyPagedSwitch(root, switchId, page);
    },
  };
}
