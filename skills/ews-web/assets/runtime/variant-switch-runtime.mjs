import { PAGED_FLICK_VELOCITY, releaseVelocity } from './paged-switch-runtime.mjs';

function cssEscape(value) {
  const raw = String(value);
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(raw);
  return raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function applyVariantSwitch(root, switchId, value) {
  if (!root?.querySelector) return null;
  const host = root.querySelector(`[data-variant-switch="${cssEscape(String(switchId))}"]`);
  if (!host) return null;
  const next = String(value || '');
  const layers = [...host.querySelectorAll(':scope > [data-variant-layer]')];
  if (!layers.some((layer) => layer.getAttribute('data-variant-layer') === next)) return host.getAttribute('data-variant');
  host.setAttribute('data-variant', next);
  for (const layer of layers) {
    const on = layer.getAttribute('data-variant-layer') === next;
    layer.hidden = !on;
    layer.setAttribute('data-variant-active', on ? '1' : '0');
  }
  for (const btn of host.querySelectorAll('[data-variant-value]')) {
    const on = btn.getAttribute('data-variant-value') === next;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('data-variant-current', on ? '1' : '0');
  }
  return next;
}

// Official 决赛赛果 / 赛区晋级图 (yise.xd.cn/esports/ews2025) are plain Swiper slides:
// both panels stay opaque and sit side by side while the track moves 300ms ease, clipped
// at the content window, so during a drag or a turn you see both panels at once. The tab
// bar does not slide; it just shows the new state. Only the mobile region tabs (effect
// fade) crossfade. Turn rule: 30px threshold, half a width, or a quick / fast release
// (official longSwipesRatio 1 made slow phone swipes snap back).
export const VARIANT_DRAG_THRESHOLD_PX = 30;
export const VARIANT_SWIPE_RATIO = 0.5;
export const VARIANT_FLICK_MS = 300;
export const VARIANT_TRANSITION_MS = 300;

function layersOf(host) {
  return [...host.querySelectorAll(':scope > [data-variant-layer]')];
}

// Slide parts = the largest subtrees without a variant button. Tab bars / buttons are
// chrome; wrappers holding both are descended into.
function markSlideParts(container) {
  const kids = [...container.children].filter((child) => child.classList?.contains('ews-node'));
  // Buttons sit directly here: this level is the tab bar itself (mobile region tabs).
  if (kids.some((child) => child.hasAttribute('data-variant-value'))) {
    for (const child of kids) child.setAttribute('data-variant-chrome', '1');
    return;
  }
  for (const child of kids) {
    const isButton = child.hasAttribute('data-variant-value');
    const holdsButton = !!child.querySelector?.('[data-variant-value]');
    // Indicator dots stay put; each variant layer already paints its own selected dot.
    // A wrapper holding dots and content (cloned variant root) is descended into.
    const dots = dotsKind(child);
    if (dots === 'only' && !holdsButton) child.setAttribute('data-variant-chrome', '1');
    else if (dots === 'mixed' && !holdsButton) markSlideParts(child);
    else if (!isButton && !holdsButton) child.setAttribute('data-variant-slide', '1');
    else if (isButton || ['tab', 'btn'].includes(child.getAttribute('data-role'))) child.setAttribute('data-variant-chrome', '1');
    else markSlideParts(child);
  }
}

const isDotNode = (el) => /^ind\//.test(el.getAttribute?.('data-node-name') || '');

// 'only' = indicator dots (and their frame), 'mixed' = dots plus content, null = no dots.
function dotsKind(el) {
  if (isDotNode(el)) return 'only';
  if (!el.querySelector?.('[data-node-name^="ind/"]')) return null;
  const leaves = [...el.querySelectorAll('.ews-node')].filter((n) => !n.querySelector('.ews-node'));
  const content = leaves.some((n) => {
    for (let cur = n; cur && cur !== el; cur = cur.parentElement) if (isDotNode(cur)) return false;
    return true;
  });
  return content ? 'mixed' : 'only';
}

function markChrome(host) {
  for (const layer of layersOf(host)) markSlideParts(layer);
}

function isTabOnly(host) {
  return !host.querySelector('[data-variant-slide]');
}

// Host-local layout box (unscaled px) of an element inside the host.
function hostBox(el, host) {
  let x = 0;
  let node = el;
  while (node && node !== host) {
    x += node.offsetLeft || 0;
    node = node.offsetParent;
    if (node && !host.contains(node)) break;
  }
  return { l: x, r: x + (el.offsetWidth || 0) };
}

// Window = union of every layer's slide parts; it is both the clip and the slide distance.
function measureWindow(host) {
  const parts = [...host.querySelectorAll('[data-variant-slide]')];
  const shown = [];
  for (const layer of layersOf(host)) {
    if (layer.hidden) { layer.hidden = false; shown.push(layer); }
  }
  let l = Infinity;
  let r = -Infinity;
  for (const part of parts) {
    const box = hostBox(part, host);
    part.style.setProperty('--ews-part-l', `${box.l}px`);
    part.style.setProperty('--ews-part-r', `${box.r}px`);
    l = Math.min(l, box.l);
    r = Math.max(r, box.r);
  }
  for (const layer of shown) layer.hidden = true;
  if (!(r > l)) return 0;
  host.style.setProperty('--ews-vw-l', `${l}px`);
  host.style.setProperty('--ews-vw-r', `${r}px`);
  return r - l;
}

function setLayerMotion(layer, { x = 0, opacity = null, animate = true, peer = false } = {}) {
  layer.setAttribute('data-variant-motion', animate ? 'animate' : 'still');
  layer.style.setProperty('--ews-variant-x', `${x}px`);
  if (opacity == null) layer.style.removeProperty('opacity');
  else layer.style.opacity = String(opacity);
  if (peer) layer.setAttribute('data-variant-peer', '1');
  else layer.removeAttribute('data-variant-peer');
}

function clearLayerMotion(layer) {
  layer.removeAttribute('data-variant-motion');
  layer.removeAttribute('data-variant-peer');
  layer.style.removeProperty('--ews-variant-x');
  layer.style.removeProperty('opacity');
}

// Tab-only switch (mobile 赛区标签): the region content is a sibling frame outside the
// switch (official 赛区晋级图 is its own slide carousel driven by the tabs). That sibling
// slides beside a copy of the outgoing content and can be dragged to change region.
function linkedPanels(host) {
  if (host.__ewsLinked) return host.__ewsLinked;
  const parent = host.parentElement;
  host.__ewsLinked = isTabOnly(host) && parent
    ? [...parent.children].filter((el) => el !== host && el.classList?.contains('ews-node')
      && !el.querySelector('[data-variant-value]') && !el.hasAttribute('data-variant-switch'))
    : [];
  for (const panel of host.__ewsLinked) panel.setAttribute('data-variant-linked', '1');
  return host.__ewsLinked;
}

function slideWidth(host) {
  if (linkedPanels(host).length) return Math.max(...linkedPanels(host).map((p) => p.offsetWidth || 0));
  return measureWindow(host) || host.offsetWidth || 0;
}

function setPanelMotion(el, { x = 0, animate = true } = {}) {
  el.setAttribute('data-variant-motion', animate ? 'animate' : 'still');
  el.style.setProperty('--ews-variant-x', `${x}px`);
}

function clearPanelMotion(el) {
  el.removeAttribute('data-variant-motion');
  el.style.removeProperty('--ews-variant-x');
}

function ghostOf(panel) {
  const ghost = panel.cloneNode(true);
  ghost.setAttribute('data-variant-ghost', '1');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.removeAttribute('data-variant-linked');
  ghost.style.pointerEvents = 'none';
  // Keep node ids unique: probes and copy binding key on data-node-id.
  for (const el of [ghost, ...ghost.querySelectorAll('[data-node-id]')]) {
    el.setAttribute('data-ghost-node-id', el.getAttribute('data-node-id') || '');
    el.removeAttribute('data-node-id');
  }
  panel.after(ghost);
  return ghost;
}

function slidePanels(host, dir, fromX) {
  const panels = linkedPanels(host);
  if (!panels.length) return;
  for (const old of host.__ewsGhosts || []) old.remove();
  const width = slideWidth(host);
  const ghosts = panels.map((panel) => {
    clearPanelMotion(panel);
    const ghost = ghostOf(panel);
    setPanelMotion(ghost, { x: fromX, animate: false });
    setPanelMotion(panel, { x: dir * width + fromX, animate: false });
    return ghost;
  });
  host.__ewsGhosts = ghosts;
  void host.offsetWidth;
  for (const ghost of ghosts) setPanelMotion(ghost, { x: -dir * width });
  for (const panel of panels) setPanelMotion(panel, { x: 0 });
}

function settlePanels(host) {
  for (const ghost of host.__ewsGhosts || []) ghost.remove();
  host.__ewsGhosts = null;
  for (const panel of linkedPanels(host)) clearPanelMotion(panel);
}

export function variantReleaseTarget({ index, count, dx, width, ms, velocity = 0 }) {
  const moved = Math.abs(dx);
  if (!(width > 0) || moved < VARIANT_DRAG_THRESHOLD_PX) return index;
  const flung = Math.abs(velocity) >= PAGED_FLICK_VELOCITY && Math.sign(velocity) === Math.sign(dx);
  const turn = moved >= width * VARIANT_SWIPE_RATIO || ms < VARIANT_FLICK_MS || flung;
  if (!turn) return index;
  return Math.max(0, Math.min(count - 1, index + (dx < 0 ? 1 : -1)));
}

function finishLater(host, fn) {
  clearTimeout(host.__ewsVariantTimer);
  host.__ewsVariantTimer = setTimeout(fn, VARIANT_TRANSITION_MS + 20);
}

function animateVariantSwitch(root, host, value, { fromX = 0 } = {}) {
  const layers = layersOf(host);
  const prevValue = host.getAttribute('data-variant');
  const from = layers.find((l) => l.getAttribute('data-variant-layer') === prevValue);
  const to = layers.find((l) => l.getAttribute('data-variant-layer') === String(value));
  if (!to) return prevValue;
  clearTimeout(host.__ewsVariantTimer);
  const tabOnly = isTabOnly(host);
  for (const layer of layers) if (layer !== from && layer !== to) { clearLayerMotion(layer); layer.hidden = layer.getAttribute('data-variant-layer') !== String(value); }
  if (!from || from === to) {
    if (from && !tabOnly) setLayerMotion(from, { x: 0 });
    for (const panel of linkedPanels(host)) setPanelMotion(panel, { x: 0 });
    finishLater(host, () => {
      for (const layer of layers) clearLayerMotion(layer);
      settlePanels(host);
    });
    return applyVariantSwitch(root, host.getAttribute('data-variant-switch'), value);
  }
  const dir = layers.indexOf(to) > layers.indexOf(from) ? 1 : -1;
  if (tabOnly) {
    // Mobile region tabs: official effect=fade; the linked content slides.
    slidePanels(host, dir, fromX);
    setLayerMotion(to, { opacity: 0, animate: false });
    applyVariantSwitch(root, host.getAttribute('data-variant-switch'), value);
    from.hidden = false;
    setLayerMotion(from, { opacity: 1, animate: false });
    void host.offsetWidth;
    setLayerMotion(from, { opacity: 0 });
    setLayerMotion(to, { opacity: 1 });
  } else {
    const width = slideWidth(host);
    // Incoming panel sits one window away, opaque, its tab bar hidden (peer) so only the
    // new tab state shows; the outgoing panel keeps its content but drops its tab bar.
    setLayerMotion(to, { x: dir * width + fromX, animate: false });
    applyVariantSwitch(root, host.getAttribute('data-variant-switch'), value);
    from.hidden = false;
    setLayerMotion(from, { x: fromX, animate: false, peer: true });
    void host.offsetWidth;
    setLayerMotion(from, { x: -dir * width, peer: true });
    setLayerMotion(to, { x: 0 });
  }
  finishLater(host, () => {
    if (host.getAttribute('data-variant') !== from.getAttribute('data-variant-layer')) from.hidden = true;
    clearLayerMotion(from);
    clearLayerMotion(to);
    settlePanels(host);
  });
  return String(value);
}

function mountVariantDrag(root, host) {
  if (typeof host.addEventListener !== 'function') return () => {};
  let start = null;
  let suppressClick = false;
  let peek = null;
  const current = () => layersOf(host).find((l) => l.getAttribute('data-variant-layer') === host.getAttribute('data-variant'));
  const scaleOf = () => {
    const visual = host.getBoundingClientRect?.().width || 0;
    const layout = host.offsetWidth || 0;
    return visual > 0 && layout > 0 ? visual / layout : 1;
  };
  const hidePeek = () => {
    if (!peek) return;
    clearLayerMotion(peek);
    if (peek.getAttribute('data-variant-layer') !== host.getAttribute('data-variant')) peek.hidden = true;
    peek = null;
  };
  const onDown = (event) => {
    if (event.button != null && event.button !== 0) return;
    // Suppress only the compatibility click belonging to the previous drag.
    // Touch drags may emit no click; a fresh press must always be clickable.
    suppressClick = false;
    start = { x: event.clientX, y: event.clientY, t: Date.now(), id: event.pointerId, dragging: false, scale: scaleOf(), el: event.currentTarget || host, samples: [{ t: Date.now(), x: event.clientX }] };
  };
  const onMove = (event) => {
    if (!start || event.pointerId !== start.id) return;
    start.samples.push({ t: Date.now(), x: event.clientX });
    if (start.samples.length > 12) start.samples.shift();
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.dragging) {
      if (Math.abs(dx) < VARIANT_DRAG_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy)) {
        if (Math.abs(dy) > VARIANT_DRAG_THRESHOLD_PX) start = null;
        return;
      }
      start.dragging = true;
      clearTimeout(host.__ewsVariantTimer);
      start.el.setPointerCapture?.(event.pointerId);
    }
    const layers = layersOf(host);
    const layer = current();
    const index = layers.indexOf(layer);
    let offset = dx / start.scale;
    // Finite (loop=false, resistanceRatio 0): no pull past the first/last variant.
    if (index <= 0) offset = Math.min(0, offset);
    if (index >= layers.length - 1) offset = Math.max(0, offset);
    const panels = linkedPanels(host);
    if (panels.length) {
      // The neighbour region rides alongside like a Swiper slide (a copy of the linked
      // content, one width away); on release slidePanels takes over from the same spot.
      const width = slideWidth(host);
      if (!host.__ewsGhosts) host.__ewsGhosts = panels.map((panel) => ghostOf(panel));
      const side = offset < 0 ? width : -width;
      panels.forEach((panel, i) => {
        setPanelMotion(panel, { x: offset, animate: false });
        setPanelMotion(host.__ewsGhosts[i], { x: offset + side, animate: false });
      });
    } else if (layer) {
      setLayerMotion(layer, { x: offset, animate: false });
      // The neighbour in the drag direction rides alongside, opaque, like a Swiper slide.
      const next = offset < 0 ? layers[index + 1] : offset > 0 ? layers[index - 1] : null;
      if (peek && peek !== next) hidePeek();
      if (next) {
        const width = slideWidth(host);
        next.hidden = false;
        setLayerMotion(next, { x: offset + (offset < 0 ? width : -width), animate: false, peer: true });
        peek = next;
      }
    }
    event.preventDefault?.();
  };
  const onUp = (event) => {
    if (!start || event.pointerId !== start.id) return;
    const was = start;
    start = null;
    if (!was.dragging) return;
    suppressClick = true;
    const layers = layersOf(host);
    const layer = current();
    const index = layers.indexOf(layer);
    const width = slideWidth(host);
    let dx = (event.clientX - was.x) / was.scale;
    if (index <= 0) dx = Math.min(0, dx);
    if (index >= layers.length - 1) dx = Math.max(0, dx);
    const target = variantReleaseTarget({ index, count: layers.length, dx, width, ms: Date.now() - was.t, velocity: releaseVelocity([...was.samples, { t: Date.now(), x: event.clientX }]) });
    if (target === index) {
      if (layer && !isTabOnly(host)) setLayerMotion(layer, { x: 0 });
      if (peek) setLayerMotion(peek, { x: dx < 0 ? width : -width, peer: true });
      for (const panel of linkedPanels(host)) setPanelMotion(panel, { x: 0 });
      for (const ghost of host.__ewsGhosts || []) setPanelMotion(ghost, { x: dx < 0 ? width : -width });
      const leftPeek = peek;
      peek = null;
      finishLater(host, () => {
        if (layer) clearLayerMotion(layer);
        if (leftPeek) { clearLayerMotion(leftPeek); leftPeek.hidden = leftPeek.getAttribute('data-variant-layer') !== host.getAttribute('data-variant'); }
        settlePanels(host);
      });
      return;
    }
    peek = null;
    animateVariantSwitch(root, host, layers[target].getAttribute('data-variant-layer'), { fromX: dx });
  };
  const onCancel = () => {
    if (!start) return;
    const was = start;
    start = null;
    if (!was.dragging) return;
    const layer = current();
    if (layer && !isTabOnly(host)) setLayerMotion(layer, { x: 0 });
    hidePeek();
    for (const panel of linkedPanels(host)) setPanelMotion(panel, { x: 0 });
    finishLater(host, () => settlePanels(host));
  };
  const onClickCapture = (event) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault?.();
    event.stopPropagation?.();
  };
  const targets = [host, ...linkedPanels(host)];
  for (const el of targets) {
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('click', onClickCapture, true);
  }
  return () => {
    clearTimeout(host.__ewsVariantTimer);
    settlePanels(host);
    for (const el of targets) {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('click', onClickCapture, true);
    }
  };
}

export function mountVariantSwitches(root, { enabled = false } = {}) {
  if (!root?.querySelectorAll) return { dispose() {}, apply() { return null; } };
  for (const host of root.querySelectorAll('[data-variant-switch]')) {
    applyVariantSwitch(root, host.getAttribute('data-variant-switch'), host.getAttribute('data-variant'));
  }
  if (!enabled) {
    return {
      dispose() {},
      apply(switchId, value) {
        return applyVariantSwitch(root, switchId, value);
      },
    };
  }
  const onClick = (event) => {
    const btn = event.target.closest?.('[data-variant-value]');
    if (!btn || !root.contains(btn)) return;
    const host = btn.closest('[data-variant-switch]');
    if (!host) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    animateVariantSwitch(root, host, btn.getAttribute('data-variant-value'));
  };
  root.addEventListener('click', onClick);
  const drags = [];
  for (const host of root.querySelectorAll('[data-variant-switch]')) {
    markChrome(host);
    host.setAttribute('data-variant-live', '1');
    drags.push(mountVariantDrag(root, host));
  }
  return {
    dispose() {
      root.removeEventListener('click', onClick);
      for (const fn of drags) fn();
    },
    apply(switchId, value) {
      return applyVariantSwitch(root, switchId, value);
    },
  };
}
