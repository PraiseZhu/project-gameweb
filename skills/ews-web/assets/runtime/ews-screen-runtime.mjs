import { DESIGN_POLICY } from './design-policy.generated.mjs';
import { applyTranslationLayout } from './text-style.mjs';

if (DESIGN_POLICY?.schema !== 'ews-design-policy/v1') {
  throw new Error('EWS runtime requires ews-design-policy/v1');
}
if (DESIGN_POLICY.screenHeight !== 'innerHeight') {
  throw new Error('EWS screenHeight must be innerHeight');
}

export const MOBILE_MAX_WIDTH = DESIGN_POLICY.mobileMaxWidth;
export const ROOT_FONT_VW = DESIGN_POLICY.rootFontVw;
export const WIDE_ASPECT = DESIGN_POLICY.wideAspectMin;
export const WIDE_ROOT_FONT_VH = DESIGN_POLICY.wideRootFontVh;
export const SCREEN_HEIGHT = DESIGN_POLICY.screenHeight;
export const WHEEL_THROTTLE_MS = 420;
export const WHEEL_INTENT_PX = 120;
export const WHEEL_INTENT_RESET_MS = 180;
export const SWIPE_THRESHOLD = 40;
export const SCREEN_TRANSITION_MS = 300;
export const SCREEN_SWIPE_THRESHOLD = 30;
export const SCREEN_TRANSITION_EASING = 'ease';
export const NAV_FADE_MS = 300;
export const NAV_FADE_EASING = 'ease-in-out';
const CAROUSEL_SEL = '.ews-carousel, .ews-paged-viewport';

export function isTopNavFix(node) {
  const name = String(node?.name || '').trim();
  return /^fix\/顶部导航(栏|通栏)?$/.test(name);
}

export function isBottomPinFix(node) {
  const name = String(node?.name || node || '').trim();
  return /^fix\/底部/.test(name);
}

export function syncTopNav(root, key) {
  if (!root?.querySelectorAll) return;
  const layers = [...root.querySelectorAll('.ews-nav-layer')];
  if (!layers.length) return;
  const want = String(key || '');
  const hasExact = layers.some((el) => el.getAttribute?.('data-nav-for') === want);
  for (const layer of layers) {
    const forKey = layer.getAttribute?.('data-nav-for');
    const on = forKey === '*' || (hasExact && forKey === want);
    layer.setAttribute?.('data-nav-active', on ? '1' : '0');
  }
  root.querySelector?.('.ews-nav')?.setAttribute?.('data-nav-current', want);
}

export function applyScrollEndPad(root) {
  if (!root?.querySelectorAll) return [];
  const applied = [];
  for (const screen of root.querySelectorAll('.ews-screen')) {
    if (!screen?.style?.setProperty || typeof screen.querySelectorAll !== 'function') continue;
    const pins = [...screen.querySelectorAll('.ews-screen-pins [data-node-name]')];
    let pad = 0;
    for (const pin of pins) {
      if (!isBottomPinFix(pin.getAttribute?.('data-node-name'))) continue;
      const height = Number(pin.getBoundingClientRect?.().height) || 0;
      if (height > pad) pad = height;
    }
    screen.style.setProperty('--ews-scroll-end-pad', `${pad}px`);
    applied.push({ key: screen.getAttribute?.('data-screen') || null, pad });
  }
  return applied;
}

function carouselOf(target) {
  return target?.closest?.(CAROUSEL_SEL) || null;
}

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

export function designRootFontPx(designWidth) {
  return Number(designWidth) * (ROOT_FONT_VW / 100);
}

export function canvasScale({ innerWidth, innerHeight, designWidth }) {
  const root = rootFontPx({ innerWidth, innerHeight });
  const designRoot = designRootFontPx(designWidth);
  if (!(root > 0) || !(designRoot > 0)) return 1;
  return root / designRoot;
}

export function bleedObjectPosition(device) {
  return device === 'mobile' ? 'center top' : 'center center';
}

export function contentAlignForBleedNames(names) {
  const list = (names || []).map((name) => String(name || '').trim().toLowerCase());
  if (list.some((name) => name === 'kv' || name === 'img/kv' || name.startsWith('kv/') || /(^|\/)kv$/.test(name))) {
    return 'start';
  }
  return 'center';
}

export function worldOffsetY({ viewportHeight, scaledHeight, align = 'center' } = {}) {
  const extra = Number(viewportHeight) - Number(scaledHeight);
  if (!(extra > 0.5)) return 0;
  if (align === 'end') return extra;
  if (align === 'start') return 0;
  return extra / 2;
}

// Keep the content span [top, bottom] (design px) above the viewport-pinned bottom bar.
// Content top stays where the canvas scale puts it (under the top nav); if the span still
// does not fit, only this screen's content canvas shrinks. Pins, nav and bleed keep `scale`.
export function fitContentAboveBar({ viewportHeight, scale, y = 0, top, bottom, barH }) {
  const s = Number(scale) || 1;
  const h = Number(viewportHeight);
  if (!(h > 0) || !(barH > 0) || !Number.isFinite(top) || !(bottom > top)) return { scale: s, y };
  const limit = h - barH * s;
  if (y + bottom * s <= limit + 0.5) return { scale: s, y };
  const room = limit - top * s;
  if (room >= (bottom - top) * s) return { scale: s, y: limit - bottom * s };
  const fitted = s * Math.max(0.5, room / ((bottom - top) * s));
  return { scale: fitted, y: top * (s - fitted) };
}

export function applyWorldOffsets(root, { innerHeight } = {}) {
  if (!root?.style || typeof root.querySelectorAll !== 'function') return [];
  const scale = Number.parseFloat(root.style.getPropertyValue('--ews-scale')) || 1;
  const height = Number(innerHeight);
  const applied = [];
  for (const screen of root.querySelectorAll('.ews-screen')) {
    if (!screen?.style || typeof screen.style.getPropertyValue !== 'function' || typeof screen.style.setProperty !== 'function') continue;
    const contentH = Number.parseFloat(screen.style.getPropertyValue('--ews-content-h')) || 0;
    const align = screen.getAttribute('data-content-align') || 'center';
    let y = worldOffsetY({
      viewportHeight: height,
      scaledHeight: contentH * scale,
      align,
    });
    const fit = fitContentAboveBar({
      viewportHeight: height,
      scale,
      y,
      top: Number(screen.getAttribute('data-content-top')),
      bottom: Number(screen.getAttribute('data-content-bottom')),
      barH: Number(screen.getAttribute('data-bar-h')),
    });
    y = fit.y;
    screen.style.setProperty('--ews-world-y', `${y}px`);
    screen.style.setProperty('--ews-world-scale', String(fit.scale));
    applied.push({ key: screen.getAttribute('data-screen'), align, y, worldScale: fit.scale, scaledHeight: contentH * fit.scale });
  }
  return applied;
}

export function applyViewportMetrics(root, { innerWidth, innerHeight } = {}) {
  if (!root?.style) return null;
  const width = Number(innerWidth) || 0;
  const height = Number(innerHeight) || 0;
  const device = deviceOf(width);
  const inlineDesign = Number.parseFloat(root.style.getPropertyValue('--ews-design-w'));
  const computedDesign = typeof getComputedStyle === 'function'
    ? Number.parseFloat(getComputedStyle(root).getPropertyValue('--ews-design-w'))
    : NaN;
  const design = (inlineDesign > 0 && inlineDesign)
    || (computedDesign > 0 && computedDesign)
    || (device === 'mobile' ? MOBILE_MAX_WIDTH : 1920);
  const rootPx = rootFontPx({ innerWidth: width, innerHeight: height });
  const designRoot = designRootFontPx(design);
  const scale = canvasScale({ innerWidth: width, innerHeight: height, designWidth: design });
  const bleed = bleedObjectPosition(device);
  root.style.setProperty('--ews-screen-h', `${height}px`);
  root.style.setProperty('--ews-root-font', `${rootPx}px`);
  root.style.setProperty('--ews-scale', String(scale));
  root.style.setProperty('--ews-design-root', `${designRoot}px`);
  root.style.setProperty('--ews-bleed-position', bleed);
  root.style.setProperty('--ews-nav-fade', `${NAV_FADE_MS}ms`);
  root.style.setProperty('--ews-nav-fade-easing', NAV_FADE_EASING);
  root.setAttribute('data-device', device);
  return { device, scale, rootPx, designRoot, bleed, designWidth: design };
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
  enablePageInteraction = false,
  screenScrollMode = 'page',
  initialScreen = null,
  windowRef = typeof window !== 'undefined' ? window : null,
} = {}) {
  const keys = [...screens, ...(footer ? ['footer'] : [])];
  const state = {
    index: Math.max(0, keys.indexOf(initialScreen)),
    locked: 0,
    device: deviceOf(windowRef?.innerWidth || 1440),
    height: windowRef?.innerHeight || 800,
    lastFlip: 0,
    transitioning: false,
  };
  let pointer = null;
  let transitionTimer = null;
  let wheelAcc = 0;
  let wheelAccAt = 0;
  const wholePage = screenScrollMode === 'page';
  root?.setAttribute?.('data-screen-scroll-mode', wholePage ? 'page' : 'content');

  function trackEl() {
    return root?.querySelector?.('.ews-track') || null;
  }

  function setTrackOffset(index, { animate = true } = {}) {
    const track = trackEl();
    if (!track?.style) return;
    const y = -(Number(index) || 0) * (Number(state.height) || 0);
    const next = `translateY(${y}px)`;
    if (!animate) {
      const prev = track.style.transition;
      track.style.transition = 'none';
      track.style.transform = next;
      void track.offsetHeight;
      track.style.transition = prev || '';
      return;
    }
    track.style.transform = next;
  }

  function beginTransition() {
    state.transitioning = true;
    if (transitionTimer) clearTimeout(transitionTimer);
    transitionTimer = setTimeout(() => {
      state.transitioning = false;
      transitionTimer = null;
    }, SCREEN_TRANSITION_MS);
  }

  function screenEls() {
    if (!root?.querySelectorAll) return [];
    return [...root.querySelectorAll('.ews-screen, .ews-footer')];
  }

  function hostViewport() {
    const frame = typeof root?.closest === 'function' ? root.closest('.frame') : null;
    if (frame && frame.clientWidth > 0 && frame.clientHeight > 0) {
      return { innerWidth: frame.clientWidth, innerHeight: frame.clientHeight };
    }
    return {
      innerWidth: windowRef?.innerWidth || 1440,
      innerHeight: windowRef?.innerHeight || 800,
    };
  }

  function applyMetrics() {
    if (!root || !root.style) return;
    const { innerWidth, innerHeight } = hostViewport();
    const metrics = applyViewportMetrics(root, { innerWidth, innerHeight });
    applyWorldOffsets(root, { innerHeight });
    applyScrollEndPad(root);
    for (const canvas of root.querySelectorAll?.('.ews-foreground-canvas') || []) {
      const w = Number(canvas.getAttribute('data-cover-w'));
      const h = Number(canvas.getAttribute('data-cover-h'));
      if (!(w > 0 && h > 0)) continue;
      const scale = innerHeight / h;
      const right = canvas.getAttribute('data-edge') === 'right';
      Object.assign(canvas.style, { width: w + 'px', height: h + 'px', left: (right ? innerWidth - w * scale : 0) + 'px', top: '0px', transform: 'scale(' + scale + ')', clipPath: right ? 'inset(0 0 0 50%)' : 'inset(0 50% 0 0)' });
    }
    applyTranslationLayout(root, root.getAttribute?.('data-locale'), root.getAttribute?.('data-source-locale'));
    state.device = metrics?.device || deviceOf(innerWidth);
    state.height = innerHeight;
    if (typeof onDevicePixel === 'function') onDevicePixel(state.device);
  }

  function currentKey() {
    return keys[state.index] || keys[0];
  }

  function goTo(key, { animate = true } = {}) {
    if (state.locked > 0) return { ok: false, reason: 'locked', key: currentKey() };
    const next = keys.indexOf(key);
    if (next < 0) return { ok: false, reason: `unknown screen ${key}` };
    const prev = currentKey();
    if (prev !== key && typeof onLeave === 'function') onLeave(prev);
    state.index = next;
    state.lastFlip = Date.now();
    if (prev !== key && animate) beginTransition();
    syncTopNav(root, key);
    setTrackOffset(next, { animate: animate && prev !== key });
    if (typeof onEnter === 'function') onEnter(key);
    return { ok: true, key };
  }

  function move(delta) {
    const now = Date.now();
    if (state.transitioning) return { ok: false, reason: 'animating', key: currentKey() };
    if (now - state.lastFlip < WHEEL_THROTTLE_MS) return { ok: false, reason: 'throttled', key: currentKey() };
    const next = Math.max(0, Math.min(keys.length - 1, state.index + delta));
    if (next === state.index) return { ok: true, key: currentKey() };
    return goTo(keys[next]);
  }

  function onWheel(event) {
    if (root?.contains && event.target && !root.contains(event.target)) return;
    if (state.locked > 0 || state.transitioning) {
      event.preventDefault?.();
      wheelAcc = 0;
      return;
    }
    const deltaY = event.deltaY || 0;
    const deltaX = event.deltaX || 0;
    if (Math.abs(deltaX) >= Math.abs(deltaY) && carouselOf(event.target)) {
      if (!enablePageInteraction) event.preventDefault?.();
      wheelAcc = 0;
      return;
    }
    if (deltaY === 0) return;
    if (wholePage) {
      event.preventDefault?.();
      move(deltaY > 0 ? 1 : -1);
      return;
    }
    const scroller = event.target?.closest?.('.ews-screen-scroll');
    if (scroller && !shouldAdvanceFromScroll({
      deltaY,
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      locked: false,
      axis: 'y',
    })) {
      wheelAcc = 0;
      return;
    }
    event.preventDefault?.();
    const now = Date.now();
    if (now - wheelAccAt > WHEEL_INTENT_RESET_MS) wheelAcc = 0;
    wheelAcc += deltaY;
    wheelAccAt = now;
    if (Math.abs(wheelAcc) < WHEEL_INTENT_PX) return;
    const dir = wheelAcc > 0 ? 1 : -1;
    wheelAcc = 0;
    move(dir);
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
    if (root?.contains && event.target && !root.contains(event.target)) return;
    const point = event.touches?.[0] || event;
    if (!Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) return;
    const carousel = carouselOf(event.target);
    pointer = { x: point.clientX, y: point.clientY, t: Date.now(), id: event.pointerId, target: event.target, carousel, scrollLeft: carousel?.scrollLeft || 0 };
  }
  function onPointerUp(event) {
    if (event.pointerType === 'touch') return;
    if (!pointer) return;
    const start = pointer;
    if (wholePage && trackEl()?.style) { trackEl().style.transition = ''; setTrackOffset(state.index); }
    const point = event.changedTouches?.[0] || event;
    pointer = null;
    if (!Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) return;
    const dx = point.clientX - start.x;
    const dy = point.clientY - start.y;
    if (state.locked > 0) return;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) >= SWIPE_THRESHOLD) {
      // Paged switches own their drag (paged-switch-runtime transform track).
      const paged = start.carousel?.classList?.contains?.('ews-paged-viewport');
      if (start.carousel && enablePageInteraction && !paged) {
        const width = start.carousel.clientWidth;
        const index = Math.round(start.scrollLeft / width) + (dx < 0 ? 1 : -1);
        start.carousel.scrollLeft = Math.max(0, Math.min(start.carousel.scrollWidth - width, index * width));
      }
      return;
    }
    if (Math.abs(dy) < SCREEN_SWIPE_THRESHOLD) return;
    if (wholePage) {
      setTrackOffset(state.index);
      const distance = Math.max(0, Math.abs(dy) - SCREEN_SWIPE_THRESHOLD);
      if (distance >= state.height * 0.5 || (distance >= SCREEN_SWIPE_THRESHOLD && Date.now() - start.t < 300)) move(dy < 0 ? 1 : -1);
      return;
    }
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
      if (wholePage) {
        event.preventDefault?.();
        if (state.locked > 0 || state.transitioning || Math.abs(dy) <= SCREEN_SWIPE_THRESHOLD) return;
        const drag = dy - Math.sign(dy) * SCREEN_SWIPE_THRESHOLD;
        const y = Math.max(-(keys.length - 1) * state.height, Math.min(0, -state.index * state.height + drag));
        const track = trackEl();
        if (track?.style) { track.style.transition = 'none'; track.style.transform = 'translateY(' + y + 'px)'; }
        return;
      }
      const scroller = pointer.target?.closest?.('.ews-screen-scroll');
      if (!scroller || shouldAdvanceFromScroll({ deltaY: -dy, scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, locked: false, axis: 'y' })) event.preventDefault?.();
    }
  }

  function cancelPointer(event) {
    if (event?.pointerType === 'touch') return;
    pointer = null;
    if (wholePage) { if (trackEl()?.style) trackEl().style.transition = ''; setTrackOffset(state.index); }
  }

  function resize() {
    const key = currentKey();
    applyMetrics();
    syncTopNav(root, key);
    setTrackOffset(keys.indexOf(key), { animate: false });
  }

  applyMetrics();
  syncTopNav(root, currentKey());
  setTrackOffset(state.index, { animate: false });
  let frameObserver = null;
  const frame = typeof root?.closest === 'function' ? root.closest('.frame') : null;
  const Observer = windowRef?.ResizeObserver || globalThis.ResizeObserver;
  if (frame && typeof Observer === 'function') {
    frameObserver = new Observer(() => resize());
    frameObserver.observe(frame);
  }
  // Text layout skips [hidden] subtrees (they measure 0). Variant layers, modals and
  // dropmenu layers that become visible later must be laid out again, or their
  // translations keep the raw designed box (wrapped / clipped).
  let revealObserver = null;
  let relayoutQueued = false;
  const Mutation = windowRef?.MutationObserver || globalThis.MutationObserver;
  if (root && typeof Mutation === 'function') {
    revealObserver = new Mutation((records) => {
      if (relayoutQueued) return;
      if (!records.some((r) => r.target?.hidden === false)) return;
      relayoutQueued = true;
      queueMicrotask(() => {
        relayoutQueued = false;
        applyTranslationLayout(root, root.getAttribute?.('data-locale'), root.getAttribute?.('data-source-locale'));
      });
    });
    revealObserver.observe(root, { attributes: true, attributeFilter: ['hidden'], subtree: true });
  }
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
      if (transitionTimer) {
        clearTimeout(transitionTimer);
        transitionTimer = null;
      }
      state.transitioning = false;
      frameObserver?.disconnect?.();
      frameObserver = null;
      revealObserver?.disconnect?.();
      revealObserver = null;
    },
    getState() {
      return {
        screen: currentKey(),
        index: state.index,
        locked: state.locked,
        device: state.device,
        height: state.height,
        transitioning: state.transitioning,
      };
    },
  };
}
