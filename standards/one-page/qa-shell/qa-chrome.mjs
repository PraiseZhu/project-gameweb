import { createQaComments, framePoint, locateComment } from './qa-comments.mjs';

export function qaFitScale(availW, availH, viewW, viewH, fit = true) {
  if (!fit) return 1;
  if (!(availW > 1) || !(availH > 1) || !(viewW > 0) || !(viewH > 0)) return null;
  const scale = Math.min(1, availW / viewW, availH / viewH);
  return Number.isFinite(scale) && scale > 0 ? scale : null;
}

function escapeProduct(frame, key) {
  const body = frame.contentDocument?.body;
  if (body) body.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', { key, bubbles:true, cancelable:true }));
}

export function bootQaChrome(config, presets) {
  const ids = ['devices','states','previous','next','return','simulation','status','review','stage','canvas','product','picker',
    'comment','comments','location','locate','clear','notes','export'];
  const fields = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  const { stage, canvas, product:frame, picker } = fields;
  const allowedEnds = new Set(config.nodes.filter((node) => node.role === 'sec').map((node) => node.end));
  const devices = presets.deviceGroups.flatMap(({ devices }) => devices.filter(({ width }) => allowedEnds.has(width > 1024 ? 'pc' : 'mobile')));
  config.nodes = new Map(config.nodes.map((node) => [node.domId, node]));
  function option(select, value, text) { select.add(new Option(text, value)); }
  devices.forEach(({ name, width, height }, index) => option(fields.devices, index, name + ' · ' + width + '×' + height));
  config.states.forEach(({ id, label }) => option(fields.states, id, label));
  let productFocus;
  function focusProduct() {
    frame.contentWindow?.focus();
    if (productFocus?.isConnected && !productFocus.closest('[hidden],[inert]')) productFocus.focus({ preventScroll:true });
    else if (frame.contentDocument?.body) {
      frame.contentDocument.body.tabIndex = -1;
      frame.contentDocument.body.focus({ preventScroll:true });
    }
  }
  const comments = createQaComments({ fields, config, focus:focusProduct });
  function setPicking(active) { picker.hidden = !active; fields.locate.setAttribute('aria-pressed', String(active)); }
  function size() {
    const { width, height } = devices[Number(fields.devices.value)];
    const scale = qaFitScale(stage.clientWidth, stage.clientHeight, width, height);
    if (!scale) return;
    Object.assign(canvas.style, { width:width * scale + 'px', height:height * scale + 'px' });
    Object.assign(frame.style, { width:width + 'px', height:height + 'px', transform:'scale(' + scale + ')' });
  }
  function load() {
    const state = fields.states.value;
    const mocked = state !== 'real';
    fields.simulation.hidden = !mocked;
    fields.simulation.textContent = mocked ? '模拟数据 · ' + fields.states.selectedOptions[0].textContent + '（不是正式数据）' : '';
    comments.setLocation(null);
    setPicking(false);
    frame.src = '/product/' + state + '/' + config.entry;
  }
  function changeScreen(key) {
    const doc = frame.contentDocument;
    if (doc?.querySelector('[data-overlay]:not([hidden]):not([inert]),html.is-footer-open')) escapeProduct(frame, 'Escape');
    escapeProduct(frame, key);
    focusProduct();
  }
  function handleEscape(event, fromProduct) {
    if (event.key !== 'Escape') return;
    if (!picker.hidden) setPicking(false);
    if (!fromProduct) escapeProduct(frame, 'Escape');
    focusProduct();
  }
  frame.addEventListener('load', () => {
    productFocus = undefined;
    frame.contentDocument?.addEventListener('focusin', (event) => { productFocus = event.target; });
    frame.contentDocument?.addEventListener('keydown', (event) => {
      if (event.isTrusted) handleEscape(event, true);
    });
  });
  document.addEventListener('keydown', (event) => handleEscape(event, false));
  fields.locate.addEventListener('click', () => { setPicking(picker.hidden); if (!picker.hidden) picker.focus(); });
  picker.addEventListener('click', (event) => {
    const point = event.detail ? framePoint(frame, event.clientX, event.clientY) : null;
    comments.setLocation(locateComment(frame, point, config));
    setPicking(false);
    fields.comment.focus();
  });
  fields.devices.addEventListener('change', () => { comments.setLocation(null); size(); });
  fields.states.addEventListener('change', load);
  fields.previous.addEventListener('click', () => changeScreen('PageUp'));
  fields.next.addEventListener('click', () => changeScreen('PageDown'));
  fields.return.addEventListener('click', focusProduct);
  fields.review.hidden = fields.status.hidden = false;
  fields.status.textContent = '基础语言 ' + config.language + ' · 验收指纹 ' + config.fingerprint;
  new ResizeObserver(size).observe(stage);
  size();
  load();
}
