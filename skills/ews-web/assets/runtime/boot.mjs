import { mountPage } from './render.mjs';
import { createScreenController, deviceOf } from './ews-screen-runtime.mjs';

const model = JSON.parse(document.getElementById('ews-model').textContent);
const host = document.body;
let locale = model.defaultLocale;
let device = deviceOf(window.innerWidth);
let screenKey = model.screens?.[0] || 'hero';
let page = null;
let controller = null;
let modalLocks = 0;

function pauseVideos(root) {
  for (const video of root.querySelectorAll('video')) {
    try { video.pause(); } catch { /* ignore */ }
  }
}

function playCurrent(root, key) {
  const video = root.querySelector(`[data-screen="${key}"] video`);
  if (video) video.play?.().catch(() => {});
}

function wire(root) {
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modalLocks > 0) closeModals(root);
    if ((event.key === 'Enter' || event.key === ' ') && event.target.closest('[data-modal-close]')) {
      event.preventDefault();
      closeModals(root);
    }
  });
  root.querySelector('.ews-lang-switch')?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-locale]');
    if (!btn) return;
    remount({ nextLocale: btn.getAttribute('data-locale') });
  });
  root.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-nav-screen]');
    if (nav) {
      const result = controller.goTo(nav.getAttribute('data-nav-screen'));
      if (result.ok) screenKey = result.key;
      return;
    }
    const open = event.target.closest('[data-modal-open]');
    if (open) {
      const id = open.getAttribute('data-modal-open');
      const modal = root.querySelector(`[data-modal-id="${id}"]`);
      if (modal && modal.hidden) {
        modal.hidden = false;
        modalLocks += 1;
        controller.setLocked(true);
        pauseVideos(root);
        modal.querySelector('button, [data-modal-close], .ews-modal')?.focus?.();
      }
      return;
    }
    const close = event.target.closest('[data-modal-close], .ews-modal-layer');
    if (close && event.target.classList.contains('ews-modal-layer')) {
      closeModals(root);
    }
    if (event.target.closest('[data-modal-close]')) {
      closeModals(root);
    }
  });
}

function closeModals(root) {
  for (const modal of root.querySelectorAll('.ews-modal')) modal.hidden = true;
  while (modalLocks > 0) {
    controller.setLocked(false);
    modalLocks -= 1;
  }
  playCurrent(root, screenKey);
}

function remount({ nextLocale, nextDevice } = {}) {
  const keep = controller?.getState?.().screen || screenKey;
  const openNames = [...host.querySelectorAll('.ews-modal:not([hidden])')].map((element) => {
    const id = element.getAttribute('data-modal-id');
    return model.platforms[device]?.nodes.find((node) => node.id === id)?.name;
  }).filter(Boolean);
  pauseVideos(host);
  controller?.destroy();
  page?.dispose();
  locale = nextLocale || locale;
  device = nextDevice || device;
  screenKey = keep;
  modalLocks = 0;
  page = mountPage(host, model, { locale, device });
  const root = host.querySelector('.ews-root');
  controller = createScreenController({
    root,
    screens: model.screens,
    footer: true,
    windowRef: window,
    onEnter(key) {
      screenKey = key;
      playCurrent(root, key);
    },
    onLeave() {
      pauseVideos(root);
    },
  });
  wire(root);
  const unlocked = controller.getState().locked;
  if (unlocked) controller.setLocked(false);
  const jumped = controller.goTo(keep);
  if (!jumped.ok) controller.goTo(model.screens[0]);
  screenKey = controller.getState().screen;
  for (const name of openNames) {
    const candidates = model.platforms[device]?.nodes.filter((node) => node.role === 'modal' && node.name === name) || [];
    if (candidates.length !== 1) continue;
    const modal = [...root.querySelectorAll('.ews-modal')].find((element) => element.getAttribute('data-modal-id') === candidates[0].id);
    if (!modal) continue;
    modal.hidden = false;
    modalLocks += 1;
    controller.setLocked(true);
    pauseVideos(root);
    modal.querySelector('[data-modal-close]')?.focus();
  }
}

window.addEventListener('resize', () => {
  const next = deviceOf(window.innerWidth);
  if (next !== device) remount({ nextDevice: next });
  else controller?.resize();
});
window.addEventListener('orientationchange', () => {
  const next = deviceOf(window.innerWidth);
  if (next !== device) remount({ nextDevice: next });
  else controller?.resize();
});

remount();
