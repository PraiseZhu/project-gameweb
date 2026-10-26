import { applyImageLanguage } from './image-language.mjs';

function escapeText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fillCss(fills) {
  const layers = [];
  for (const fill of fills || []) {
    if (!fill || fill.visible === false) continue;
    if (fill.type === 'SOLID' && fill.color) {
      const { r = 0, g = 0, b = 0, a = 1 } = fill.color;
      if (![r, g, b, a].every(Number.isFinite)) throw new TypeError('fill RGBA 必须是有限数值');
      const alpha = Math.max(0, Math.min(1, Number(a)));
      const to = (n) => (n > 1 ? Math.round(n) : Math.round(Number(n) * 255));
      layers.push(`rgba(${to(r)},${to(g)},${to(b)},${alpha})`);
    }
  }
  if (!layers.length) return '';
  return `background:${layers[0]};`;
}

function copyValue(node, locale) {
  const translations = node.copy?.translations || {};
  if (Object.keys(translations).length) {
    const leaf = translations[locale];
    if (leaf && leaf.value != null) return { text: String(leaf.value), locator: leaf.locator || '', missing: false };
    return { text: '', locator: '', missing: true };
  }
  return { text: String(node.text?.characters || node.characters || ''), locator: '', missing: false };
}

function assetUrl(node, imageView, assets) {
  const hit = (imageView?.tree?.instances || []).find((item) => item.id === node.id);
  if (hit?.assetRef) {
    const rec = assets?.[hit.componentId] || assets?.[node.id];
    return rec?.url || rec?.relative || (String(hit.assetRef).startsWith('.') || String(hit.assetRef).startsWith('assets/') ? hit.assetRef : rec?.url) || rec?.url;
  }
  const rec = assets?.[node.id] || (node.componentId && assets?.[node.componentId]);
  return rec?.url || rec?.relative || null;
}

function ownerAncestor(node, byId) {
  let current = node;
  const seen = new Set();
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    current = byId.get(String(current.parentId));
    if (!current) break;
    if (current.role === 'img' || current.role === 'bg' || current.role === 'kv') return current;
  }
  return null;
}

function localBox(node, parent) {
  const box = node.pageBox;
  if (!box) return null;
  if (!parent?.pageBox) return box;
  return {
    x: box.x - parent.pageBox.x,
    y: box.y - parent.pageBox.y,
    w: box.w,
    h: box.h,
  };
}

function boxStyle(box, rotation) {
  if (!box) return '';
  const rot = Number(rotation) || 0;
  return `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;${rot ? `transform:rotate(${rot}deg);` : ''}`;
}

function contentHeight(nodes, fallback) {
  let max = fallback || 0;
  for (const node of nodes || []) {
    const box = node.pageBox;
    if (box) max = Math.max(max, box.y + box.h);
  }
  return max;
}

function renderNode(node, ctx) {
  const { locale, assets, imageView, byId, carousel, navigation, videos, modals, parent } = ctx;
  const role = node.role || '';
  const interaction = node.interaction === 'eligible' ? 'eligible' : 'draw-only';
  const box = localBox(node, parent);
  const style = `${boxStyle(box, node.rotation)}${fillCss(node.fills)}${node.clipsContent ? 'overflow:hidden;' : ''}`;
  const nav = navigation[node.id];
  const modalId = modals[node.id];
  const extra = [
    node.status === 'determined' && node.role === 'btn' && node.name === 'btn/close' ? ' data-modal-close="" role="button" tabindex="0" aria-label="Close"' : '',
    nav ? ` data-nav-screen="${escapeText(nav)}"` : '',
    modalId ? ` data-modal-open="${escapeText(modalId)}"` : '',
    node.replaceable || node.assetKey ? ` data-asset="${escapeText(node.assetKey || node.id)}" data-asset-key="${escapeText(node.assetKey || '')}"` : '',
  ].join('');
  const children = ctx.childrenOf(node.id);
  const suppressImage = Boolean(ownerAncestor(node, byId) && (role === 'img' || role === 'bg' || role === 'kv'));

  if (carousel.owners.has(node.id)) {
    const slides = carousel.slides.get(node.id) || [];
    const slideHtml = slides.map((slideId) => {
      const slide = byId.get(slideId);
      if (!slide) return '';
      return `<div class="ews-carousel-slide" data-node-id="${escapeText(slideId)}">${renderNode(slide, { ...ctx, parent: { pageBox: slide.pageBox } })}</div>`;
    }).join('');
    return `<div class="ews-node ews-carousel" data-node-id="${escapeText(node.id)}" data-role="${escapeText(role)}" data-interaction="${interaction}" style="${style}"${extra}>${slideHtml}</div>`;
  }
  if (videos[node.id]) {
    return `<div class="ews-node" data-node-id="${escapeText(node.id)}" data-role="${escapeText(role)}" data-interaction="${interaction}" style="${style}"${extra}><video data-node-id="${escapeText(node.id)}" src="${escapeText(videos[node.id])}" playsinline controls></video></div>`;
  }
  if (!suppressImage && (role === 'img' || role === 'kv' || role === 'bg')) {
    const src = assetUrl(node, imageView, assets);
    const img = src
      ? `<img alt="" data-node-id="${escapeText(node.id)}" src="${escapeText(src)}">`
      : `<div class="ews-fail" data-missing-asset="${escapeText(node.id)}">missing ${escapeText(node.id)}</div>`;
    return `<div class="ews-node" data-node-id="${escapeText(node.id)}" data-role="${escapeText(role)}" data-interaction="${interaction}"${extra} style="${style}">${img}</div>`;
  }
  if (String(node.type || '').toUpperCase() === 'TEXT' || role === 'copy') {
    const copied = copyValue(node, locale);
    const miss = copied.missing ? ' data-missing-locale="1" class="ews-node ews-fail"' : ' class="ews-node"';
    const fontSize = Number(node.text?.fontSize) || 16;
    return `<div${miss} data-node-id="${escapeText(node.id)}" data-role="${escapeText(role || 'copy')}" data-interaction="${interaction}" data-copy-locator="${escapeText(copied.locator)}" style="${style}font-family:${escapeText(node.text?.fontFamily || 'sans-serif')};font-weight:${Number(node.text?.fontWeight) || 400};font-size:${fontSize}px;line-height:${node.text?.lineHeightPercent ? node.text.lineHeightPercent / 100 : 1.2};">${escapeText(copied.text)}</div>`;
  }
  const inner = children
    .filter((child) => !carousel.slideSet.has(child.id))
    .map((child) => renderNode(child, { ...ctx, parent: node }))
    .join('');
  return `<div class="ews-node" data-node-id="${escapeText(node.id)}" data-role="${escapeText(role)}" data-status="${escapeText(node.status)}" data-interaction="${interaction}" style="${style}"${extra}>${inner}</div>`;
}

function wiring(model, end) {
  const carousel = { owners: new Set(), slides: new Map(), slideSet: new Set() };
  for (const item of model.config?.carousels || []) {
    const owner = String(item.ownerId?.[end] || item.ownerId || '');
    const slides = (item.slides?.[end] || item.slides || []).map(String);
    if (owner) {
      carousel.owners.add(owner);
      carousel.slides.set(owner, slides);
      slides.forEach((id) => carousel.slideSet.add(id));
    }
  }
  const navigation = {};
  for (const [id, key] of Object.entries(model.config?.navigation || {})) navigation[id] = key;
  const videos = {};
  for (const [id, src] of Object.entries(model.config?.videos || {})) {
    videos[id] = src.startsWith('.') || src.startsWith('assets/') || src.startsWith('media/') ? `./${src.replace(/^\.\//, '')}` : src;
  }
  const modals = { ...(model.config?.modals || {}) };
  return { carousel, navigation, videos, modals };
}

function fontFaceCss(model) {
  const fonts = model.assets?.fonts || [];
  return fonts.map((font) => `@font-face{font-family:${JSON.stringify(font.family)};font-weight:${font.weight || 400};src:url(${JSON.stringify(font.url || `./${font.relative}`)}) format('${font.format || 'woff2'}');}`).join('');
}

export function renderPageHtml(model, { locale, device } = {}) {
  const lang = locale || model.defaultLocale || 'zh-CN';
  const end = device || (model.platforms.pc ? 'pc' : 'mobile');
  const platform = model.platforms[end];
  if (!platform) {
    return `<div class="ews-fail" data-missing-device="${escapeText(end)}">device ${escapeText(end)} unavailable</div>`;
  }
  const imageView = platform.imageViews?.[lang];
  const assets = model.assets?.[end] || platform.assets || {};
  const byId = new Map((platform.nodes || []).map((node) => [String(node.id), node]));
  const childrenOf = (id) => (platform.nodes || []).filter((node) => String(node.parentId) === String(id))
    .sort((a, b) => String(a.orderKey).localeCompare(String(b.orderKey)));
  const wired = wiring(model, end);
  const ctx = { locale: lang, assets, imageView, byId, childrenOf, parent: null, ...wired };
  const designW = platform.designWidth || (end === 'mobile' ? 750 : 1920);
  const htmlScreens = (platform.screens || []).map((screen) => {
    const section = byId.get(String(screen.sectionId));
    const height = contentHeight(screen.nodes, section?.pageBox?.h || 0) - (section?.pageBox?.y || 0);
    const inner = section
      ? renderNode(section, { ...ctx, parent: { pageBox: section.pageBox || { x: 0, y: 0, w: designW, h: 0 } } })
      : '';
    return `<section class="ews-screen" data-screen="${escapeText(screen.key)}" data-section-id="${escapeText(screen.sectionId)}" style="--ews-content-h:${Math.max(height, 1)}px;--ews-design-w:${designW}px;"><div class="ews-screen-scroll"><div class="ews-screen-sizer"><div class="ews-screen-world">${inner}</div></div></div></section>`;
  }).join('');
  const navNodes = (platform.nodes || []).filter((node) => node.role === 'fix').map((node) => renderNode(node, { ...ctx, parent: { pageBox: { x: 0, y: 0, w: designW, h: 0 } } })).join('');
  const footer = platform.footer;
  let footerHtml = '';
  if (footer?.id) {
    const footerNode = byId.get(String(footer.id));
    const height = contentHeight(footer.nodes, footerNode?.pageBox?.h || 0) - (footerNode?.pageBox?.y || 0);
    const tree = renderNode(footerNode, { ...ctx, parent: { pageBox: footerNode?.pageBox || { x: 0, y: 0 } } });
    footerHtml = `<footer class="ews-footer" data-screen="footer" data-node-id="${escapeText(footer.id)}" style="--ews-content-h:${Math.max(height, 1)}px;--ews-design-w:${designW}px;"><div class="ews-screen-scroll"><div class="ews-screen-sizer"><div class="ews-screen-world">${tree}</div></div></div></footer>`;
  }
  const modalHtml = (platform.modals || []).map((modal) => {
    const id = modal.id;
    const nodes = modal.nodes || [];
    const root = nodes.find((node) => node.id === id) || { id, pageBox: modal.pageBox, role: 'modal', status: 'determined' };
    const mapped = { ...root, id };
    if (!byId.has(String(id))) byId.set(String(id), mapped);
    for (const node of nodes) if (!byId.has(String(node.id))) byId.set(String(node.id), { ...node, id: String(node.id) });
    return `<div class="ews-modal" data-modal-id="${escapeText(id)}" hidden>${renderNode(byId.get(String(id)), { ...ctx, parent: { pageBox: { x: 0, y: 0 } } })}</div>`;
  }).join('');
  const langBtns = (model.locales || []).map((code) => `<button type="button" data-locale="${escapeText(code)}"${code === lang ? ' aria-current="true"' : ''}>${escapeText(code)}</button>`).join('');
  const backgrounds = (platform.pageBackgrounds || []).map((node) => renderNode(node, ctx)).join('');
  const fail = (imageView && imageView.ok === false)
    ? `<div class="ews-fail" data-fail-visible="1">${escapeText((imageView.failVisible || []).map((item) => item.reason).join('\n'))}</div>`
    : '';
  return `<div class="ews-root" data-device="${escapeText(end)}" data-locale="${escapeText(lang)}" data-fingerprint="${escapeText(model.fingerprint || '')}" style="--ews-design-w:${designW}px;">
  <style>${fontFaceCss(model)}</style>
  <div class="ews-page-backgrounds">${backgrounds}</div>
  <div class="ews-lang-switch">${langBtns}</div>
  <nav class="ews-nav">${navNodes}</nav>
  <div class="ews-track">${htmlScreens}</div>
  ${footerHtml}
  <div class="ews-modal-layer">${modalHtml}</div>
  ${fail}
</div>`;
}

export function documentHtml(model, { locale, device } = {}) {
  const body = renderPageHtml(model, { locale, device });
  const json = JSON.stringify(model).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="${escapeText(locale || model.defaultLocale || 'zh-CN')}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>EWS</title>
  <link rel="stylesheet" href="./runtime/ews.css">
</head>
<body>
${body}
<script type="application/json" id="ews-model">${json}</script>
<script type="module" src="./runtime/boot.mjs"></script>
</body>
</html>
`;
}

export function mountPage(root, model, { locale, device } = {}) {
  if (typeof document === 'undefined') {
    return { dispose() {}, activateScreen() {}, setLocale() {}, setDevice() {}, getState() { return { locale, device }; } };
  }
  const state = { locale: locale || model.defaultLocale, device: device || 'pc' };
  const paint = () => {
    root.innerHTML = renderPageHtml(model, state);
  };
  paint();
  return {
    dispose() { root.innerHTML = ''; },
    activateScreen(key) {
      const el = root.querySelector(`[data-screen="${key}"]`);
      if (el) el.scrollIntoView({ block: 'start' });
    },
    setLocale(next) {
      state.locale = next;
      paint();
    },
    setDevice(next) {
      state.device = next;
      paint();
    },
    getState() { return { ...state }; },
  };
}

void applyImageLanguage;
