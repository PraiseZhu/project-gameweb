import { mountPage } from './render.mjs';
import { createScreenController, deviceOf } from './ews-screen-runtime.mjs';
import { collectVisibleTextFitProblems, layoutDiagnostics } from './text-style.mjs';
import { isProductView } from './qa-toolbar.mjs';
import { bootQaChrome } from './qa-chrome.mjs';
import { isPageInteractionEnabled, pageInteractionMode } from './page-interaction.mjs';
import { alignPagedForPixel, applyPagedSwitch, mountPagedSwitches, pagedPageOf } from './paged-switch-runtime.mjs';
import { applyVariantSwitch, mountVariantSwitches } from './variant-switch-runtime.mjs';
import { mountDropmenus } from './dropmenu-runtime.mjs';
import { loadLocaleFonts } from './locale-fonts.mjs';
import { installContentProtection } from './content-protection.mjs';
import { syncLanguageCurrent, syncModalNavCurrent } from './nav-current.mjs';

const model = JSON.parse(document.getElementById('ews-model').textContent);
const pageHost = document.getElementById('ews-page-host');
const qaHost = document.getElementById('ews-qa-host');
const product = isProductView(location.search);
const interactionLive = isPageInteractionEnabled(location.search);
document.documentElement.setAttribute('data-page-interaction', pageInteractionMode(location.search));
const LANG_LABEL = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
};

let locale = model.defaultLocale;
let device = deviceOf(window.innerWidth);
let screenKey = model.screens?.[0] || null;
let page = null;
let controller = null;
let paged = null;
let variants = null;
let dropmenus = null;
let protection = null;
let scrollFreeze = null;
let modalLocks = 0;
function syncModalLock() {
  const locked = modalLocks > 0 || Number(controller?.getState?.().locked || 0) > 0;
  document.documentElement.setAttribute('data-ews-lock', locked ? '1' : '0');
}
let host = pageHost;
let viewportSize = { w: window.innerWidth, h: window.innerHeight };
const simulatedListeners = new Map();
const simulatedWindow = {
  get innerWidth() { return viewportSize.w; },
  get innerHeight() { return viewportSize.h; },
  addEventListener(type, fn, opts) {
    if (type === 'resize' || type === 'orientationchange') {
      const list = simulatedListeners.get(type) || [];
      list.push(fn);
      simulatedListeners.set(type, list);
      return;
    }
    window.addEventListener(type, fn, opts);
  },
  removeEventListener(type, fn, opts) {
    if (type === 'resize' || type === 'orientationchange') {
      simulatedListeners.set(type, (simulatedListeners.get(type) || []).filter((item) => item !== fn));
      return;
    }
    window.removeEventListener(type, fn, opts);
  },
  dispatchResize() {
    for (const fn of simulatedListeners.get('resize') || []) fn({});
    for (const fn of simulatedListeners.get('orientationchange') || []) fn({});
  },
};

if (product) {
  document.documentElement.setAttribute('data-ews-product', '1');
  document.documentElement.setAttribute('data-product-view', '1');
  document.documentElement.setAttribute('data-ews-qa', 'hidden-product');
  if (qaHost) {
    qaHost.hidden = true;
    qaHost.setAttribute('data-ews-qa', 'hidden-product');
    qaHost.replaceChildren();
  }
} else {
  document.documentElement.setAttribute('data-ews-qa', 'visible-chrome');
  if (qaHost) {
    qaHost.hidden = true;
    qaHost.setAttribute('data-ews-qa', 'visible-chrome');
  }
}

function pauseVideos(root) {
  for (const video of root.querySelectorAll('video')) {
    try { video.pause(); } catch { /* ignore */ }
  }
}

function playCurrent(root, key) {
  const video = root.querySelector(`[data-screen="${key}"] video`);
  if (video) video.play?.().catch(() => {});
}

function snapshot() {
  const root = host.querySelector('.ews-root');
  const screenEl = root?.querySelector(`[data-screen="${CSS.escape(screenKey)}"]`);
  const scroller = screenEl?.querySelector('.ews-screen-scroll');
  const nodes = [...(screenEl?.querySelectorAll('.ews-screen-world .ews-node') || [])];
  const lastBottom = Math.max(0, ...nodes.map((node) => node.getBoundingClientRect().bottom));
  const screenH = root ? getComputedStyle(root).getPropertyValue('--ews-screen-h').trim() : '';
  const windowRef = product ? window : simulatedWindow;
  return {
    locale,
    device,
    screen: controller?.getState?.().screen || screenKey,
    locked: modalLocks > 0 || Number(controller?.getState?.().locked || 0) > 0,
    fingerprint: model.fingerprint || null,
    innerWidth: windowRef.innerWidth,
    innerHeight: windowRef.innerHeight,
    screenHeightCss: screenH,
    screenHeightPx: Number.parseFloat(screenH) || 0,
    rootDevice: root?.dataset.device || null,
    screenTop: screenEl ? screenEl.getBoundingClientRect().top : null,
    screenHeight: screenEl ? screenEl.getBoundingClientRect().height : 0,
    scrollTop: scroller?.scrollTop ?? 0,
    scrollHeight: scroller?.scrollHeight ?? 0,
    clientHeight: scroller?.clientHeight ?? 0,
    lastContentBottom: lastBottom,
    modalOpen: [...host.querySelectorAll('.ews-modal:not([hidden])')].map((el) => el.getAttribute('data-modal-id')),
    videos: [...host.querySelectorAll('video')].map((video) => ({
      screen: video.closest('[data-screen]')?.getAttribute('data-screen'),
      paused: video.paused,
    })),
    toolbar: document.documentElement.getAttribute('data-ews-qa') || (qaHost ? qaHost.getAttribute('data-ews-qa') : null),
    viewportSource: product ? 'product-window' : 'qa-simulated-frame',
    pageInteraction: document.documentElement.getAttribute('data-page-interaction') || 'inert',
    canvasScale: Number.parseFloat(root?.style?.getPropertyValue('--ews-scale') || '') || null,
    rootFontPx: root ? Number.parseFloat(getComputedStyle(root).fontSize) : null,
    designRootFontPx: Number.parseFloat(root?.style?.getPropertyValue('--ews-design-root') || '') || null,
    bleedPosition: root?.style?.getPropertyValue('--ews-bleed-position')?.trim() || null,
  };
}

function bindCommentSurface(root, frame) {
  if (!frame || !root) return;
  const catalog = [...root.querySelectorAll('.ews-modal[data-modal-name]')].map((layer) => ({
    name: layer.getAttribute('data-modal-name'),
    id: layer.getAttribute('data-modal-id'),
    layer,
  }));
  frame.__fxNamedModals = catalog;
  frame.__fxOpenNamedModal = (entry) => {
    const modal = entry?.layer || root.querySelector(`.ews-modal[data-modal-name="${CSS.escape(entry?.name || '')}"]`);
    if (!modal || !modal.hidden) return;
    modal.hidden = false;
    modal.setAttribute('data-modal-open', 'true');
    modalLocks += 1;
    controller?.setLocked(true);
    syncModalLock();
    pauseVideos(root);
  };
  frame.__fxCloseNamedModal = (entry) => {
    const modal = entry?.layer;
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    modal.removeAttribute('data-modal-open');
    if (modalLocks > 0) {
      controller?.setLocked(false);
      modalLocks -= 1;
    }
    syncModalLock();
  };
  frame.__fxApplySwitch = (switchId, pageIndex) => applyPagedSwitch(root, switchId, pageIndex);
}

function publishApi() {
  window.__ewsStop1 = {
    getState: snapshot,
    goTo(key, opts) {
      const result = controller.goTo(key, opts);
      if (result.ok) screenKey = result.key;
      return result;
    },
    setLocale(next) {
      if (!next || next === locale) return Promise.resolve(locale);
      return remount({ nextLocale: next }).then(() => locale);
    },
    fontsReady() {
      return window.__ewsFontsReady || Promise.resolve();
    },
    auditTextFit() {
      const root = host.querySelector('.ews-root');
      return collectVisibleTextFitProblems(root);
    },
    layoutDiagnostics() {
      const root = host.querySelector('.ews-root');
      return layoutDiagnostics(root);
    },
    alignPagedForPixel() {
      const root = host.querySelector('.ews-root');
      return alignPagedForPixel(root);
    },
  };
}

function freezeComponentScroll(root) {
  const nodes = [...root.querySelectorAll('.ews-carousel, .ews-paged-viewport')];
  const disposers = [];
  for (const el of nodes) {
    const lock = () => {
      if (el.scrollLeft) el.scrollLeft = 0;
    };
    el.addEventListener('scroll', lock);
    el.scrollLeft = 0;
    disposers.push(() => el.removeEventListener('scroll', lock));
  }
  return () => {
    for (const fn of disposers) fn();
  };
}

function inertComponentKeys(root) {
  for (const el of root.querySelectorAll('[data-paged-dot], [data-paged-prev], [data-paged-next], [data-dropmenu="true"], [data-modal-open]:not(.ews-modal), [data-nav-screen], [data-variant-value]')) {
    el.setAttribute('tabindex', '-1');
  }
}

function syncNavCurrent(root, key) {
  if (!root?.querySelectorAll) return;
  syncModalNavCurrent(root, key);
  const want = String(key || '');
  for (const el of root.querySelectorAll('[data-nav-screen]')) {
    const on = el.getAttribute('data-nav-screen') === want;
    el.setAttribute('aria-current', on ? 'page' : 'false');
    el.setAttribute('data-nav-current', on ? '1' : '0');
  }
}

function snapshotComponentState(root) {
  const pagedPages = {};
  for (const viewport of root?.querySelectorAll?.('.ews-paged-viewport[data-paged-switch]') || []) {
    pagedPages[viewport.getAttribute('data-paged-switch')] = pagedPageOf(viewport);
  }
  const variantValues = {};
  for (const host of root?.querySelectorAll?.('[data-variant-switch]') || []) {
    variantValues[host.getAttribute('data-variant-switch')] = host.getAttribute('data-variant');
  }
  return { pagedPages, variantValues };
}

function restoreComponentState(root, snap) {
  if (!snap) return;
  for (const [id, page] of Object.entries(snap.pagedPages || {})) applyPagedSwitch(root, id, page);
  for (const [id, value] of Object.entries(snap.variantValues || {})) applyVariantSwitch(root, id, value);
}

function wire(root, { live }) {
  root.addEventListener('keydown', (event) => {
    if (!live) return;
    if (event.key === 'Escape' && modalLocks > 0) closeModals(root);
    if ((event.key === 'Enter' || event.key === ' ') && event.target.closest('[data-modal-close]')) {
      event.preventDefault();
      closeModals(root);
    }
  });
  root.addEventListener('click', (event) => {
    if (!live) return;
    if (event.target.closest('[data-nav-pending]')) {
      event.preventDefault();
      return;
    }
    const open = event.target.closest('[data-modal-open]');
    if (open && !open.classList.contains('ews-modal')) {
      const id = open.getAttribute('data-modal-open');
      const modal = root.querySelector(`[data-modal-id="${id}"]`);
      if (modal && modal.hidden) {
        modal.hidden = false;
        modal.setAttribute('data-modal-open', 'true');
        modalLocks += 1;
        controller.setLocked(true);
        syncModalLock();
        pauseVideos(root);
        modal.querySelector('button, [data-modal-close], .ews-modal')?.focus?.();
      } else if (modal && !modal.hidden) {
        closeModals(root);
      }
      return;
    }
    const langOpt = event.target.closest('[data-locale]');
    if (langOpt && langOpt.closest('.ews-modal')) {
      const next = langOpt.getAttribute('data-locale');
      event.preventDefault();
      event.stopPropagation();
      closeModals(root);
      if (next && next !== locale) void remount({ nextLocale: next });
      return;
    }
    const nav = event.target.closest('[data-nav-screen]');
    if (nav && !nav.classList.contains('ews-nav')) {
      if (nav.closest('.ews-modal')) closeModals(root);
      const result = controller.goTo(nav.getAttribute('data-nav-screen'));
      if (result.ok) {
        screenKey = result.key;
        syncNavCurrent(root, screenKey);
      }
      return;
    }
    if (event.target.classList.contains('ews-modal-layer')) closeModals(root);
    if (event.target.closest('[data-modal-close]')) closeModals(root);
  });
}

function closeModals(root) {
  for (const modal of root.querySelectorAll('.ews-modal')) {
    modal.hidden = true;
    modal.removeAttribute('data-modal-open');
  }
  while (modalLocks > 0) {
    controller.setLocked(false);
    modalLocks -= 1;
  }
  syncModalLock();
  playCurrent(root, screenKey);
}

function remount({ nextLocale, nextDevice, hostEl, size } = {}) {
  const keep = controller?.getState?.().screen || screenKey;
  const pendingLocale = nextLocale || locale;
  const fontsReady = loadLocaleFonts(model.config?.localeFonts, pendingLocale, {
    sourceLocale: model.defaultLocale,
    fonts: model.assets?.fonts,
  });
  window.__ewsFontsReady = fontsReady;
  const keptComponents = snapshotComponentState(host.querySelector('.ews-root'));
  const openNames = [...host.querySelectorAll('.ews-modal:not([hidden])')].map((element) => {
    const id = element.getAttribute('data-modal-id');
    return model.platforms[device]?.nodes.find((node) => node.id === id)?.name;
  }).filter(Boolean);
  pauseVideos(host);
  controller?.destroy();
  paged?.dispose?.();
  variants?.dispose?.();
  dropmenus?.dispose?.();
  protection?.dispose?.();
  scrollFreeze?.();
  page?.dispose();
  locale = nextLocale || locale;
  device = nextDevice || device;
  if (hostEl) host = hostEl;
  if (size) viewportSize = { w: size.w, h: size.h };
  screenKey = keep;
  modalLocks = 0;
  syncModalLock();
  page = mountPage(host, model, { locale, device, product, screen: keep });
  const root = host.querySelector('.ews-root');
  if (product && root) root.dataset.product = '1';
  const hasFooter = Boolean(model.platforms[device]?.footer?.id);
  const windowRef = product ? window : simulatedWindow;
  controller = createScreenController({
    root,
    screens: model.screens,
    footer: hasFooter,
    initialScreen: keep,
    windowRef,
    enablePageInteraction: interactionLive,
    onEnter(key) {
      screenKey = key;
      playCurrent(root, key);
      syncNavCurrent(root, key);
      window.__qaNoteState?.(key);
    },
    onLeave() {
      pauseVideos(root);
    },
  });
  wire(root, { live: interactionLive });
  paged = mountPagedSwitches(root, { enabled: interactionLive });
  variants = mountVariantSwitches(root, { enabled: interactionLive });
  dropmenus = mountDropmenus(root, {
    enabled: interactionLive,
    onLanguage(next) {
      if (next && next !== locale) void remount({ nextLocale: next });
    },
  });
  if (!interactionLive) {
    inertComponentKeys(root);
    scrollFreeze = freezeComponentScroll(root);
  } else {
    scrollFreeze = null;
  }
  const unlocked = controller.getState().locked;
  if (unlocked) controller.setLocked(false);
  const jumped = controller.goTo(keep, { animate: false });
  if (!jumped.ok) controller.goTo(model.screens[0], { animate: false });
  screenKey = controller.getState().screen;
  restoreComponentState(root, keptComponents);
  syncNavCurrent(root, screenKey);
  syncLanguageCurrent(root, locale);
  for (const name of openNames) {
    const candidates = model.platforms[device]?.nodes.filter((node) => node.role === 'modal' && node.name === name) || [];
    if (candidates.length !== 1) continue;
    const modal = [...root.querySelectorAll('.ews-modal')].find((element) => element.getAttribute('data-modal-id') === candidates[0].id);
    if (!modal) continue;
    modal.hidden = false;
    modal.setAttribute('data-modal-open', 'true');
    modalLocks += 1;
    controller.setLocked(true);
    syncModalLock();
    pauseVideos(root);
    modal.querySelector('[data-modal-close]')?.focus();
  }
  bindCommentSurface(root, host.closest?.('.frame') || host);
  protection = installContentProtection(root);
  publishApi();
  return fontsReady.then(() => locale);
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || modalLocks <= 0) return;
  const current = host.querySelector('.ews-root');
  if (current) closeModals(current);
});

if (product) {
  window.addEventListener('resize', () => {
    const next = deviceOf(window.innerWidth);
    viewportSize = { w: window.innerWidth, h: window.innerHeight };
    if (next !== device) remount({ nextDevice: next });
    else controller?.resize();
  });
  window.addEventListener('orientationchange', () => {
    const next = deviceOf(window.innerWidth);
    viewportSize = { w: window.innerWidth, h: window.innerHeight };
    if (next !== device) remount({ nextDevice: next });
    else controller?.resize();
  });
  remount();
} else {
  const locales = model.locales || [model.defaultLocale || 'zh-CN'];
  const screens = [...(model.screens || [])];
  if (model.platforms?.pc?.footer?.id || model.platforms?.mobile?.footer?.id) screens.push('footer');
  const states = Object.fromEntries(screens.map((id) => [id, { label: id }]));
  window.__qaDemo = {
    name: 'etheria-ews',
    title: 'Etheria-ews',
    summary: {
      what: 'EWS 宣发页 QA 壳：设备、语言、状态、模拟视口、拉伸、实时评论',
      how: 'skills/ews-web 自包含 chrome；产品树按 DESIGN.md innerWidth≤750',
      accept: '?product=1 无 chrome。默认入口可见可操作完整 QA。全绿仅 awaiting-user-review',
    },
    matrix: {
      plat: { label: '平台', options: [{ v: 'desktop', label: 'Desktop' }, { v: 'mobile', label: 'Mobile' }] },
      region: { label: '区域', options: [{ v: 'cn', label: 'CN' }] },
      os: { label: '系统', options: [{ v: 'any', label: 'Any' }] },
      mode: { label: '模式', options: [{ v: 'default', label: 'Default' }] },
      lang: {
        label: '语言',
        options: locales.map((code) => ({ v: code, label: LANG_LABEL[code] || code })),
      },
    },
    defaultPrefs: {
      plat: deviceOf(1920) === 'mobile' ? 'mobile' : 'desktop',
      region: 'cn',
      os: 'any',
      mode: 'default',
      lang: model.defaultLocale || locales[0],
    },
    initialState: screens[0] || 'entry',
    states,
    tabStates: [],
    commentApi: model.config?.commentApi || null,
    commentPageId: model.config?.commentPageId || null,
    scale() {
      const root = document.querySelector('.ews-root');
      const value = Number.parseFloat(root?.style?.getPropertyValue('--ews-scale') || '');
      return Number.isFinite(value) && value > 0 ? value : 1;
    },
    renderApp(ctx) {
      const size = ctx.viewport || viewportSize;
      viewportSize = { w: size.w, h: size.h };
      const nextDevice = deviceOf(size.w);
      const nextLocale = ctx.prefs?.lang || locale;
      remount({
        nextLocale,
        nextDevice,
        hostEl: ctx.frame,
        size,
      });
      if (ctx.state) {
        const jumped = controller.goTo(ctx.state);
        if (jumped.ok) screenKey = jumped.key;
      }
      simulatedWindow.dispatchResize();
    },
  };
  try {
    if (pageHost) {
      pageHost.hidden = true;
      pageHost.setAttribute('aria-hidden', 'true');
    }
    bootQaChrome(window.__qaDemo);
    if (pageHost) pageHost.replaceChildren();
  } catch (err) {
    document.documentElement.setAttribute('data-ews-qa', 'boot-failed');
    if (qaHost) {
      qaHost.hidden = false;
      qaHost.setAttribute('data-ews-qa', 'boot-failed');
      qaHost.textContent = `QA 壳启动失败：${err?.message || err}`;
    }
    throw err;
  }
}
