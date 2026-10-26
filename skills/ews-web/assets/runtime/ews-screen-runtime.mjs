export const MOBILE_MAX_WIDTH = 750;
export const ROOT_FONT_VW = 10;
export const WIDE_ASPECT = 1920 / 1000;
export const WIDE_ROOT_FONT_VH = 19.2;
export const WHEEL_THROTTLE_MS = 420;
export const SWIPE_THRESHOLD = 40;

export function deviceOf(innerWidth) {
  return Number(innerWidth) <= MOBILE_MAX_WIDTH ? 'mobile' : 'pc';
}

export function rootFontPx({ innerWidth, innerHeight }) {
  const width = Number(innerWidth) || 0;
  const height = Number(innerHeight) || 1;
  const vw = width * (ROOT_FONT_VW / 100);
  if (height > 0 && width / height >= WIDE_ASPECT) return height * (WIDE_ROOT_FONT_VH / 100);
  return vw;
}

export function shouldAdvanceFromScroll({ deltaY, scrollTop, scrollHeight, clientHeight, locked, axis }) {
  if (locked) return false;
  if (axis === 'x') return false;
  const max = Math.max(0, (scrollHeight || 0) - (clientHeight || 0));
  if (max > 1) {
    if (deltaY > 0 && scrollTop < max - 1) return false;
    if (deltaY < 0 && scrollTop > 1) return false;
  }
  return deltaY !== 0;
}

function isEditable(target) {
  if (!target) return false;
  const el = target.closest?.('input, textarea, select, [contenteditable="true"]');
  return Boolean(el);
}

export function createScreenController({
  root,
  screens = [],
  footer = true,
  onEnter,
  onLeave,
  onDevicePixel,
  windowRef = typeof window !== 'undefined' ? window : null,
} = {}) {
  const keys = [...screens, ...(footer ? ['footer'] : [])];
  const state = {
    index: 0,
    locked: 0,
    device: deviceOf(windowRef?.innerWidth || 1440),
    height: windowRef?.innerHeight || 800,
    lastFlip: 0,
  };
  let pointer = null;

  function screenEls() {
    if (!root?.querySelectorAll) return [];
    return [...root.querySelectorAll('.ews-screen, .ews-footer')];
  }

  function applyMetrics() {
    if (!root || !root.style) return;
    const innerWidth = windowRef?.innerWidth || 1440;
    const innerHeight = windowRef?.innerHeight || 800;
    state.device = deviceOf(innerWidth);
    state.height = innerHeight;
    const design = Number.parseFloat(root.style.getPropertyValue('--ews-design-w')) || (state.device === 'mobile' ? 750 : 1920);
    const scale = design > 0 ? innerWidth / design : 1;
    root.style.setProperty('--ews-screen-h', `${innerHeight}px`);
    root.style.setProperty('--ews-root-font', `${rootFontPx({ innerWidth, innerHeight })}px`);
    root.style.setProperty('--ews-scale', String(scale));
    root.setAttribute('data-device', state.device);
    if (typeof onDevicePixel === 'function') onDevicePixel(state.device);
  }

  function currentKey() {
    return keys[state.index] || keys[0];
  }

  function goTo(key) {
    if (state.locked > 0) return { ok: false, reason: 'locked', key: currentKey() };
    const next = keys.indexOf(key);
    if (next < 0) return { ok: false, reason: `unknown screen ${key}` };
    const prev = currentKey();
    if (prev !== key && typeof onLeave === 'function') onLeave(prev);
    state.index = next;
    state.lastFlip = Date.now();
    const els = screenEls();
    const el = els[next] || root?.querySelector?.(`[data-screen="${key}"]`);
    if (el?.scrollIntoView) el.scrollIntoView({ block: 'start' });
    if (typeof onEnter === 'function') onEnter(key);
    return { ok: true, key };
  }

  function move(delta) {
    const now = Date.now();
    if (now - state.lastFlip < WHEEL_THROTTLE_MS) return { ok: false, reason: 'throttled', key: currentKey() };
    const next = Math.max(0, Math.min(keys.length - 1, state.index + delta));
    if (next === state.index) return { ok: true, key: currentKey() };
    return goTo(keys[next]);
  }

  function onWheel(event) {
    if (state.locked > 0) {
      event.preventDefault?.();
      return;
    }
    const deltaY = event.deltaY || 0;
    const deltaX = event.deltaX || 0;
    if (Math.abs(deltaX) >= Math.abs(deltaY) && event.target?.closest?.('.ews-carousel')) return;
    if (deltaY === 0) return;
    const scroller = event.target?.closest?.('.ews-screen-scroll');
    if (scroller && !shouldAdvanceFromScroll({
      deltaY,
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      locked: false,
      axis: 'y',
    })) return;
    event.preventDefault?.();
    move(deltaY > 0 ? 1 : -1);
  }

  function onKey(event) {
    if (isEditable(event.target)) return;
    if (state.locked > 0) {
      event.preventDefault?.();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'PageDown') {
      event.preventDefault?.();
      move(1);
    }
    if (event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault?.();
      move(-1);
    }
    if (event.key === 'Escape') {
      event.preventDefault?.();
    }
  }

  function onPointerDown(event) {
    if (event.pointerType === 'touch' || isEditable(event.target)) return;
    const point = event.touches?.[0] || event;
    if (!Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) return;
    const carousel = event.target?.closest?.('.ews-carousel');
    pointer = { x: point.clientX, y: point.clientY, id: event.pointerId, target: event.target, carousel, scrollLeft: carousel?.scrollLeft || 0 };
  }
  function onPointerUp(event) {
    if (event.pointerType === 'touch') return;
    if (!pointer) return;
    const start = pointer;
    const point = event.changedTouches?.[0] || event;
    pointer = null;
    if (!Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) return;
    const dx = point.clientX - start.x;
    const dy = point.clientY - start.y;
    if (state.locked > 0) return;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) >= SWIPE_THRESHOLD) {
      if (start.carousel) {
        const width = start.carousel.clientWidth;
        const index = Math.round(start.scrollLeft / width) + (dx < 0 ? 1 : -1);
        start.carousel.scrollLeft = Math.max(0, Math.min(start.carousel.scrollWidth - width, index * width));
      }
      return;
    }
    if (Math.abs(dy) < SWIPE_THRESHOLD) return;
    const scroller = event.target?.closest?.('.ews-screen-scroll');
    if (scroller && !shouldAdvanceFromScroll({
      deltaY: -dy,
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      locked: false,
      axis: 'y',
    })) return;
    move(dy < 0 ? 1 : -1);
  }

  function onTouchMove(event) {
    if (!pointer) return;
    const point = event.touches?.[0];
    if (!point) return;
    const dx = point.clientX - pointer.x;
    const dy = point.clientY - pointer.y;
    if (state.locked > 0 || (pointer.carousel && Math.abs(dx) > Math.abs(dy))) event.preventDefault?.();
    if (Math.abs(dy) > Math.abs(dx)) {
      const scroller = pointer.target?.closest?.('.ews-screen-scroll');
      if (!scroller || shouldAdvanceFromScroll({ deltaY: -dy, scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, locked: false, axis: 'y' })) event.preventDefault?.();
    }
  }

  function cancelPointer(event) {
    if (event?.pointerType === 'touch') return;
    pointer = null;
  }

  function resize() {
    const key = currentKey();
    applyMetrics();
    const target = screenEls()[keys.indexOf(key)];
    target?.scrollIntoView?.({ block: 'start' });
  }

  applyMetrics();
  const opts = { passive: false };
  if (windowRef?.addEventListener) {
    windowRef.addEventListener('wheel', onWheel, opts);
    windowRef.addEventListener('keydown', onKey);
    windowRef.addEventListener('resize', resize);
    windowRef.addEventListener('orientationchange', resize);
    windowRef.addEventListener('pointerdown', onPointerDown);
    windowRef.addEventListener('pointerup', onPointerUp);
    windowRef.addEventListener('touchstart', onPointerDown, opts);
    windowRef.addEventListener('touchend', onPointerUp, opts);
    windowRef.addEventListener('touchmove', onTouchMove, opts);
    windowRef.addEventListener('touchcancel', cancelPointer);
    windowRef.addEventListener('pointercancel', cancelPointer);
  }

  return {
    goTo,
    setLocked(lock) {
      state.locked += lock ? 1 : -1;
      if (state.locked < 0) state.locked = 0;
    },
    resize,
    destroy() {
      if (windowRef?.removeEventListener) {
        windowRef.removeEventListener('wheel', onWheel);
        windowRef.removeEventListener('keydown', onKey);
        windowRef.removeEventListener('resize', resize);
        windowRef.removeEventListener('orientationchange', resize);
        windowRef.removeEventListener('pointerdown', onPointerDown);
        windowRef.removeEventListener('pointerup', onPointerUp);
        windowRef.removeEventListener('touchstart', onPointerDown);
        windowRef.removeEventListener('touchend', onPointerUp);
        windowRef.removeEventListener('touchmove', onTouchMove);
        windowRef.removeEventListener('touchcancel', cancelPointer);
        windowRef.removeEventListener('pointercancel', cancelPointer);
      }
      pointer = null;
    },
    getState() {
      return { screen: currentKey(), index: state.index, locked: state.locked, device: state.device, height: state.height };
    },
  };
}
