export function runtime() {
  'use strict';
  const root = document.documentElement;
  const config = window.OnePageConfig;
  const query = (selector, node = document) => [...node.querySelectorAll(selector)];
  const get = (id) => document.getElementById(id);
  const devices = query('[data-device]');
  const breakpoint = matchMedia('(max-width: 1024px)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const edit = 'input,textarea,select,[contenteditable]:not([contenteditable="false"])';
  const ignore = edit + ',[data-scrollable],[data-onepage-ignore]';
  const chooseDevice = () => devices.find((node) => node.dataset.device === (breakpoint.matches ? 'mobile' : 'pc')) ?? devices[0];
  const tabs = new Map();
  const carouselState = new Map();
  const tracks = new Map();
  const entrances = new Set();
  let intro;
  let introPlayed = false;
  const listRows = new Map();
  const localized = { 'zh-CN': ['待公布','已复制'], 'zh-TW': ['待公佈','已複製'], en: ['To be announced','Copied'], ja: ['公開予定','コピーしました'], ko: ['공개 예정','복사됨'] };
  const messages = localized[config.language] ?? localized.en;
  let device = chooseDevice();
  let current;
  let overlay;
  let trigger;
  let overlayOutside = [];
  let transition = 0;
  let transitionTimer;
  let statusTimer;
  let wheelTime = -Infinity;
  let wheelSum = 0;
  let wheelUsed = false;
  let start;
  let suppressClick = 0;
  let footerOpen = false;
  let footerUntil = 0;
  let footerMade;
  let heroTicket;
  let playing;
  const heroPlayers = new WeakMap();
  const tabGeometry = new WeakMap();
  const menuMotion = new Map();
  const footer = get('page-footer');
  const visible = (node) => node && !node.closest('[hidden],[inert]');
  const hide = (node, value) => { if (node) { node.hidden = value; node.inert = value; } };
  const screens = () => query('[data-screen]', device).filter((node) => !node.hidden);
  const cssDuration = (property) => {
    const duration = getComputedStyle(root).getPropertyValue(property).trim();
    return (Number.parseFloat(duration) || 0) * (duration.endsWith('ms') ? 1 : 1000);
  };
  const own = (object, key) => object != null && Object.hasOwn(object, key) ? object[key] : undefined;
  function http(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : null;
    } catch { return null; }
  }
  function announce(message) {
    const status = get('site-status');
    status.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.textContent = ''; }, 2500);
  }
  function images(within) {
    for (const image of query('img[data-src]', within)) {
      if (!visible(image)) continue;
      image.loading = image.hasAttribute('data-hero-background') ? 'eager' : 'lazy';
      if (image.hasAttribute('data-hero-background')) image.fetchPriority = 'high';
      const fallback = image.dataset.src;
      const dynamic = http(image.dataset.remoteSrc);
      if (dynamic) image.addEventListener('error', () => {
        if (image.src === dynamic.href) {
          if (fallback) image.src = fallback;
          else image.removeAttribute('src');
        }
      }, { once: true });
      if (!dynamic && !fallback) continue;
      image.src = dynamic?.href ?? fallback;
      image.removeAttribute('data-src');
      image.removeAttribute('data-remote-src');
    }
  }
  function cancelEntrances() {
    for (const animation of entrances) animation.cancel();
    entrances.clear();
  }
  function animateEntry(node, id, keyframes, duration, delay = 0, easing = 'ease') {
    if (!node || !visible(node) || reduced.matches || !node.animate || !duration) return;
    const animation = node.animate(keyframes, { duration, delay, easing, fill:'backwards' });
    animation.id = id;
    entrances.add(animation);
    animation.onfinish = () => { entrances.delete(animation); animation.cancel(); };
    return animation;
  }
  function finishMenuMotion() {
    for (const [node, motion] of menuMotion) {
      motion.cancel();
      if (node !== overlay) hide(node,true);
    }
    menuMotion.clear();
  }
  function beginIntro(screen) {
    const first = !introPlayed;
    const selectedDevice = device;
    const state = { screen, finished:null };
    intro = state;
    if (reduced.matches) {
      state.finished = Promise.resolve(true);
      return;
    }
    state.finished = Promise.allSettled(query('[data-hero-background][src],[data-slogan] img[src]', screen).map((image) => image.decode()))
      .then(() => new Promise((resolve) => requestAnimationFrame(resolve)))
      .then(() => {
        if (intro !== state || current !== screen || device !== selectedDevice || reduced.matches) return false;
        introPlayed = true;
        const shift = getComputedStyle(root).getPropertyValue('--intro-shift').trim();
        const time = cssDuration;
        const move = (from) => [{ opacity:0, translate:from },{ opacity:1, translate:'none' }];
        const animations = [];
        const stage = (elements, name, frames, duration, delay = 0) => {
          for (const element of elements) {
            const animation = animateEntry(element,'c2-intro-' + name,frames,time(duration),delay);
            if (animation) animations.push(animation.finished);
          }
        };
        stage(query('[data-hero-background]',screen),'background',[{opacity:0},{opacity:1}],'--intro-duration');
        if (first) {
          stage(query('[data-intro-nav]',device),'navigation',move('0 calc(-1 * ' + shift + ')'),'--intro-chrome-duration',time('--intro-nav-delay'));
          for (const crystal of query('[data-intro-nav] [data-foreground]',device)) {
            const from = own(directions,crystal.dataset.motionDirection);
            if (from) stage([crystal],'crystal',[{opacity:0,transform:from},{opacity:1,transform:'none'}],'--intro-crystal-duration',time('--intro-crystal-delay'));
          }
          const social = query('[data-action]', device).filter((node)=>{
            const action = own(config.actions,node.id);
            return action?.type==='open-link' && own(config.social,action.key) && http(actionAddress(action.key));
          });
          stage(social,'social',move(shift + ' 0'),'--intro-chrome-duration',time('--intro-social-delay'));
        }
        stage(query('[data-slogan]',screen),'slogan',move('calc(-1 * ' + shift + ') 0'),'--intro-slogan-duration',time(first?'--intro-slogan-delay':'--return-slogan-delay'));
        const floor = Number(getComputedStyle(root).getPropertyValue('--intro-flash-floor'));
        stage(query('[data-slogan-ink]',screen),'flash',[{opacity:1},{opacity:floor,offset:.5},{opacity:1}],'--intro-flash-duration',time(first?'--intro-flash-delay':'--return-flash-delay'));
        const earliest = performance.now() + (first ? time('--hero-duration') : 0);
        return Promise.allSettled(animations).then(() => intro === state && current === screen && !reduced.matches
          ? new Promise((resolve) => setTimeout(() => resolve(intro === state && current === screen && !reduced.matches), Math.max(0,earliest-performance.now()))) : false);
      });
  }
  const directions = { left:'translateX(.18rem)',right:'translateX(-.18rem)',up:'translateY(.18rem)',down:'translateY(-.18rem)' };
  function enter(within, triggerName) {
    if (!within || reduced.matches) return;
    for (const node of [within, ...query('[data-motion]', within)]) {
      if (!visible(node) || node.dataset.motionTrigger !== triggerName || !node.animate) continue;
      const rule = node.dataset.motion;
      const unit = node.dataset.motionUnit;
      const children = [...node.children];
      const batches = unit === 'batches' ? JSON.parse(node.dataset.motionBatches).map((batch)=>batch
        .map((id)=>children.find((child)=>child.id===id || child.dataset.motionRef===id)).filter(visible)).filter((batch)=>batch.length)
        : unit === 'items' ? [...node.children].filter(visible).map((item)=>[item]) : [[node]];
      const frames = {
        'section-title': ['translateY(-.24rem)','--title-duration','cubic-bezier(.16,1,.3,1)'],
        'content-left': ['translateX(-.18rem)','--content-duration','cubic-bezier(.22,.61,.36,1)'],
        'first-screen': ['none','--intro-duration','ease'],
        'cards-center': ['none','--cards-duration','cubic-bezier(.16,1,.3,1)'],
      };
      const direction = own(directions,node.dataset.motionDirection);
      if (rule === 'foreground-crystal' && within === current && current === screens()[0] && node.closest('[data-intro-nav]')) continue;
      if (direction) frames['foreground-crystal'] = [direction,'--foreground-duration','ease'];
      if (!own(frames, rule)) continue;
      const [base, timeVariable, easing] = frames[rule];
      const duration = cssDuration(timeVariable);
      const positions = device.dataset.device === 'mobile' ? [[0],[.14,-.14],[.14,-.14,0],[.14,-.14,.14,-.14]] : [[0],[.35,-.35],[.6,0,-.6],[.75,.25,-.25,-.75]];
      const distances = positions[batches.length - 1];
      batches.forEach((batch, index) => batch.forEach((item) => {
        const delay = rule === 'cards-center' ? 0 : index * cssDuration(rule==='foreground-crystal' ? '--foreground-stagger' : '--stagger');
        const transform = rule === 'cards-center' && distances ? 'translateX(' + distances[index] + 'rem)' : base;
        if (rule === 'content-left') {
          animateEntry(item,'c2-content-travel',[{transform},{transform:'none'}],duration,delay,easing);
          animateEntry(item,'c2-content-opacity',[{opacity:0},{opacity:1}],duration,delay,'ease-in-out');
        } else animateEntry(item,'c2-' + rule,[{transform,opacity:0},{transform:'none',opacity:1}],duration,delay,easing);
      }));
    }
  }
  function stopVideo() {
    heroTicket = undefined;
    if (!playing) return;
    const previous = playing;
    playing = null;
    previous.controller?.pause?.();
    hide(previous.mount, true);
    query('[data-slogan]', previous.screen).forEach((node) => hide(node, false));
  }
  function prepareVideo() {
    if (!current || current !== screens()[0] || device.dataset.device !== 'pc' || breakpoint.matches || reduced.matches || footerOpen) return;
    const screen = current;
    const mount = screen.querySelector('[data-hero-video]');
    const src = http(config.components?.backgroundVideo?.src);
    if (!mount || !src || typeof window.createBackgroundVideo !== 'function' || heroPlayers.get(mount)?.failed || playing?.mount === mount) return;
    const ticket = Symbol();
    heroTicket = ticket;
    const startPlayback = () => {
      if (heroTicket !== ticket) return;
      if (current !== screen || reduced.matches || breakpoint.matches || footerOpen) return;
      let player = heroPlayers.get(mount);
      if (!player) {
        player = { mount, screen, failed:false };
        heroPlayers.set(mount, player);
        mount.dataset.src = src.href;
        mount.addEventListener('playing', () => {
          if (playing !== player || current !== screen || reduced.matches || breakpoint.matches || player.failed) return;
          hide(mount, false);
          query('[data-slogan]', screen).forEach((node) => hide(node, true));
        }, { capture: true });
        mount.addEventListener('error', () => {
          player.failed = true;
          if (playing === player) stopVideo();
        }, { capture: true });
      }
      const attempt = Symbol();
      player.attempt = attempt;
      playing = player;
      const failed = () => {
        if (player.attempt !== attempt) return;
        player.failed = true;
        if (playing === player) stopVideo();
      };
      try {
        if (!player.created) {
          player.controller = window.createBackgroundVideo(mount, { ...config.components.backgroundVideo.options, src: src.href });
          player.created = true;
        }
        const video = mount.querySelector('video');
        Promise.resolve(player.controller?.play ? player.controller.play() : video?.play()).catch(failed);
      } catch { failed(); }
    };
    intro?.finished.then((ready) => { if (ready && heroTicket === ticket) startPlayback(); });
  }
  function closeOverlay(restore = true) {
    if (!overlay) return;
    const previous = overlay;
    if (previous.hasAttribute('data-menu')) {
      trigger?.setAttribute('aria-expanded', 'false');
      previous.inert = true;
      const opacity = getComputedStyle(previous).opacity;
      menuMotion.get(previous)?.cancel();
      menuMotion.delete(previous);
      if (!reduced.matches && previous.animate && restore) {
        const motion = previous.animate([{ opacity }, { opacity: 0 }], { duration: cssDuration('--panel-duration'), fill:'both' });
        menuMotion.set(previous, motion);
        motion.onfinish = () => { if (overlay !== previous) hide(previous, true); menuMotion.delete(previous); motion.cancel(); };
      } else hide(previous, true);
    } else {
      if (previous.matches(':popover-open')) previous.hidePopover();
      previous.removeAttribute('popover');
      hide(previous, true);
    }
    for (const node of overlayOutside) node.inert = false;
    overlayOutside = [];
    overlay = null;
    root.classList.remove('is-locked');
    if (restore && visible(trigger)) trigger.focus({ preventScroll: true });
    trigger = null;
  }
  function openOverlay(node, opener) {
    if (!node || !node.closest('[data-device]') || node.closest('[data-device]') !== device) return;
    if (overlay === node) return;
    closeOverlay(false);
    overlay = node;
    trigger = opener;
    const menu = overlay.hasAttribute('data-menu');
    const opacity = overlay.hidden ? '0' : getComputedStyle(overlay).opacity;
    menuMotion.get(overlay)?.cancel();
    menuMotion.delete(overlay);
    hide(overlay, false);
    if (!menu && overlay.showPopover) {
      overlay.setAttribute('popover','manual');
      overlay.showPopover();
    }
    if (menu) {
      trigger.setAttribute('aria-expanded', 'true');
      if (!reduced.matches && overlay.animate) {
        const target = overlay;
        const motion = target.animate([{ opacity }, { opacity:1 }], { duration:cssDuration('--panel-duration') });
        menuMotion.set(target,motion);
        motion.onfinish = () => menuMotion.delete(target);
      }
    }
    for (let branch = overlay; !menu && branch && branch !== device; branch = branch.parentElement) {
      for (const node of branch.parentElement.children) {
        if (node !== branch && !node.inert) { node.inert = true; overlayOutside.push(node); }
      }
    }
    root.classList.add('is-locked');
    images(overlay);
    (query('button,input,a[href],[tabindex="0"]', overlay).find(visible) ?? overlay).focus({ preventScroll: true });
  }
  function moveFooter(open) {
    if (!footer) return false;
    if (open && !footerMade) return false;
    footerOpen = open;
    footerUntil = performance.now() + (reduced.matches ? 0 : cssDuration('--footer-duration'));
    hide(footer, !open);
    footer.setAttribute('aria-hidden', String(!open));
    root.classList.toggle('is-footer-open', open);
    if (open) { cancelEntrances(); stopVideo(); footer.focus({ preventScroll: true }); }
    else current?.focus({ preventScroll: true });
    return true;
  }
  function present(screen, animate = false) {
    if (screen !== current) { intro = undefined; finishTracks(); cancelEntrances(); }
    if (screen !== current) stopVideo();
    if (footerOpen) moveFooter(false);
    const previous = current;
    current = screen;
    for (const section of query('[data-screen]')) {
      const active = section === current;
      section.classList.toggle('is-current', active);
      section.inert = !active;
      section.setAttribute('aria-hidden', String(!active));
    }
    for (const fixed of query('[data-fixed-from]',device)) hide(fixed, !current || Number(current.dataset.screen) < Number(fixed.dataset.fixedFrom));
    for (const button of query('[data-action]')) {
      const action = own(config.actions, button.id);
      if (action?.type !== 'go-section') continue;
      const target = get(action.targets[0]);
      if (!target) continue;
      hide(button, target.hidden);
      button.classList.toggle('is-selected', target === current);
      if (target === current) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
    clearTimeout(transitionTimer);
    transition = animate && previous && previous !== current ? performance.now() + cssDuration('--screen-duration') : 0;
    if (transition) transitionTimer = setTimeout(() => { transition = 0; }, cssDuration('--screen-duration'));
    if (current) {
      images(current);
      images(device);
      if (animate) enter(current, 'section-enter');
      if (current === screens()[0] && !intro) beginIntro(current);
      if (footer && current === screens().at(-1)) {
        current.append(footer);
        current.classList.add('has-site-footer');
        if (!footerMade && typeof window.createSiteFooter === 'function') {
          try { window.createSiteFooter(footer, { ...config.components?.footer, language: config.language }); footerMade = true; }
          catch { footerMade = false; }
        }
      }
    }
    prepareVideo();
  }
  function step(delta, arrow = false, absolute) {
    if (overlay || Math.max(transition, footerUntil) > performance.now()) return;
    if (footerOpen) { if (delta < 0 || absolute != null) moveFooter(false); return; }
    const active = screens();
    const index = active.indexOf(current);
    if (absolute == null && delta > 0 && !arrow && index === active.length - 1 && moveFooter(true)) return;
    const next = absolute ?? (arrow && index === active.length - 1 ? 0 : index + delta);
    if (active[next] && active[next] !== current) present(active[next], true);
  }
  function renderTabs(animate = false) {
    const groups = new Map();
    for (const button of query('[data-tab-group]', device)) {
      const key = button.dataset.tabGroup;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(button);
    }
    for (const [key, buttons] of groups) {
      const currentTab = buttons.find((button) => button.dataset.contentKey === tabs.get(key)) ?? buttons[0];
      const previous = buttons.find((button) => button.getAttribute('aria-selected') === 'true');
      tabs.set(key, currentTab.dataset.contentKey);
      for (const button of buttons) {
        const active = currentTab === button;
        button.classList.toggle('is-selected', active);
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
        hide(get(button.dataset.tabTarget), !active);
      }
      const selectedArt = currentTab.querySelector('[data-selected-art]');
      if (animate && previous && previous !== currentTab && selectedArt && !reduced.matches
        && buttons.every((button) => button.dataset.selectedImage && button.dataset.selectedImage === currentTab.dataset.selectedImage)) {
        const previousArt = previous.querySelector('[data-selected-art]');
        const old = tabGeometry.get(previousArt) ?? previousArt.getBoundingClientRect();
        const next = selectedArt.getBoundingClientRect();
        const dx = old.x - next.x;
        const dy = old.y - next.y;
        selectedArt.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' },
          { transform: 'translate(' + Math.sign(-dx) * 0.12 + 'rem,' + Math.sign(-dy) * 0.12 + 'rem)', offset: 0.78 },
          { transform: 'none' }], { duration: cssDuration('--slide-duration'), easing: 'ease-out' });
      }
      if (selectedArt) tabGeometry.set(selectedArt, selectedArt.getBoundingClientRect());
      if (animate && previous !== currentTab) enter(get(currentTab.dataset.tabTarget), 'tab-change');
    }
    if (current) images(current);
  }
  function findFor(kind, owner) {
    return query('[data-' + kind + '-for]', device).filter((node) => node.getAttribute('data-' + kind + '-for') === owner);
  }
  function finishTracks() {
    for (const finish of tracks.values()) finish();
  }
  function animateTrack(container, host, outgoing, incoming, direction) {
    const duration = cssDuration('--track-duration');
    if (!duration || reduced.matches || !visible(container) || !host?.animate || !outgoing.length || !incoming.length) return;
    const box = host.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const layout = getComputedStyle(host);
    const layer = document.createElement('div');
    layer.className = 'carousel-viewport';
    layer.dataset.movingViewport = '';
    const track = document.createElement('div');
    track.className = 'carousel-track';
    track.dataset.movingTrack = String(direction);
    layer.append(track);
    const slots = [];
    function frame(items, inactive) {
      const panel = document.createElement('div');
      panel.className = 'carousel-page';
      panel.inert = inactive;
      if (inactive) panel.setAttribute('aria-hidden', 'true');
      for (const property of ['display','grid-template-columns','grid-template-rows','grid-auto-flow','flex-wrap','flex-direction','gap','align-items','align-content','padding']) {
        panel.style.setProperty(property, layout.getPropertyValue(property));
      }
      for (const item of items) {
        const slot = document.createComment('carousel-item');
        item.before(slot);
        slots.push({ item, slot, inactive });
        item.hidden = false;
        item.inert = inactive;
        panel.append(item);
      }
      return panel;
    }
    const previous = frame(outgoing, true);
    const next = frame(incoming, false);
    track.append(...(direction > 0 ? [previous, next] : [next, previous]));
    host.append(layer);
    const motion = track.animate(direction > 0
      ? [{ transform:'translateX(0)' }, { transform:'translateX(-100%)' }]
      : [{ transform:'translateX(-100%)' }, { transform:'translateX(0)' }], { duration, easing:'ease', fill:'both' });
    function finish() {
      if (tracks.get(container) !== finish) return;
      tracks.delete(container);
      motion.cancel();
      for (const { item, slot, inactive } of slots) {
        hide(item, inactive);
        slot.replaceWith(item);
      }
      layer.remove();
    }
    tracks.set(container, finish);
    motion.onfinish = finish;
  }
  function carousel(container, move = 0, page) {
    if (!container) return;
    tracks.get(container)?.();
    const paging = own(config.bindings, container.id)?.pagination;
    if (!paging) return;
    const list = paging.list && get(paging.list);
    if (list) list.dataset.carouselItems = '';
    const panels = list ? [...list.children].filter((node) => node.tagName !== 'TEMPLATE' && node.hasAttribute('data-carousel-item'))
      : (paging.panels ?? []).map(get).filter(Boolean);
    const key = container.dataset.carousel;
    const size = list ? paging.perPage : 1;
    if (!(size >= 1)) return;
    const count = Math.ceil(panels.length / size);
    const state = carouselState.get(key);
    const itemKey = (node) => node.dataset.itemKey ?? node.id;
    const anchor = state ? panels.findIndex((node) => itemKey(node) === state.anchor) : -1;
    const old = anchor < 0 ? 0 : Math.floor(anchor / size);
    const index = count ? ((page ?? old + move) % count + count) % count : 0;
    const first = panels[index * size];
    if (first && (!state || move || page != null || anchor < 0)) carouselState.set(key, { anchor: itemKey(first) });
    panels.forEach((panel, position) => hide(panel, Math.floor(position / size) !== index));
    findFor('empty', list?.id ?? container.id).concat(list ? findFor('empty', container.id) : []).forEach((node) => hide(node, count !== 0 || list && !listRows.has(list.id)));
    for (const pager of findFor('pager', container.id)) {
      hide(pager, !count);
      const currentPage = String(index + 1).padStart(2, '0');
      const totalPages = String(count).padStart(2, '0');
      const values = query('[data-page-value]', pager);
      if (values.length) values.forEach((node) => { node.textContent = node.dataset.pageValue === 'page-current' ? currentPage : totalPages; });
      else pager.textContent = currentPage + '/' + totalPages;
    }
    for (const indicator of findFor('ind', container.id)) {
      hide(indicator, count <= 1);
      indicator.replaceChildren();
      if (count <= 1) continue;
      for (let target = 0; target < count; target++) {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.dataset.carouselPage = String(target);
        dot.dataset.carouselTarget = container.id;
        dot.setAttribute('aria-label', String(target + 1) + '/' + count);
        dot.setAttribute('aria-pressed', String(target === index));
        indicator.append(dot);
      }
    }
    for (const control of query('[data-action]', device)) {
      const action = own(config.actions, control.id);
      if (['next-page','previous-page'].includes(action?.type) && action.targets.includes(container.id)) hide(control, count <= 1);
    }
    if (visible(container)) images(container);
    if (index !== old && (move || page != null)) {
      cancelEntrances();
      const host = list ?? (panels.every((panel) => panel.parentElement === first.parentElement) ? first.parentElement : container);
      animateTrack(container, host, panels.slice(old * size, (old + 1) * size), panels.slice(index * size, (index + 1) * size), Math.sign(move || index - old));
      for (const item of panels.slice(index * size, (index + 1) * size)) enter(item, 'page-change');
    }
  }
  function setVariant(node, value) {
    const faces = [...node.children].filter((child) => child.hasAttribute('data-variant-value'));
    if (!faces.some((child) => child.dataset.variantValue === value)) return;
    node.dataset.state = value;
    for (const child of faces) hide(child, child.dataset.variantValue !== value);
    if (visible(node)) images(node);
  }
  const allCarousels = () => query('[data-carousel]', device).forEach((node) => {
    if (!query('[data-tab-group]', device).some((tab) => tab.dataset.tabGroup === node.dataset.carousel)) carousel(node);
  });
  function align(resize = false) {
    finishTracks();
    if (resize && current) cancelEntrances();
    const next = chooseDevice();
    const screenKey = current?.dataset.screen;
    const changed = device !== next;
    const recoverFocus = changed && device.contains(document.activeElement);
    if (changed) { closeOverlay(false); finishMenuMotion(); if (footerOpen) moveFooter(false); footerUntil = 0; }
    device = next;
    for (const panel of devices) hide(panel, panel !== device);
    root.classList.add('is-aligning');
    renderTabs();
    allCarousels();
    if (changed || !overlay && !footerOpen) present(screens().find((node) => node.dataset.screen === screenKey) ?? screens()[0]);
    if (recoverFocus) current?.focus({preventScroll:true});
    images(device);
    root.getBoundingClientRect();
    root.classList.remove('is-aligning');
    root.style.setProperty('--viewport-height', Math.min(innerHeight, window.visualViewport?.height ?? innerHeight) + 'px');
  }
  function actionAddress(key) {
    const language = own(config.languageUrls, key);
    const social = own(config.social, key);
    if (language !== undefined) return language;
    if (social && typeof social === 'object') {
      if (social.platform === 'wechat' || social.regions?.length && !social.regions.includes(config.language)) return null;
      return social.url;
    }
    return own(config.links, key);
  }
  function openLink(url, tell) {
    const target = http(url);
    if (target) window.open(target.href, '_blank', 'noopener,noreferrer');
    else if (tell) announce(messages[0]);
  }
  document.addEventListener('click', (event) => {
    if (performance.now() < suppressClick && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    const node = event.target;
    if (overlay && node === overlay && overlay.hasAttribute('data-dismiss-backdrop')) { closeOverlay(); return; }
    if (overlay?.hasAttribute('data-dismiss-outside') && !overlay.contains(node) && !trigger?.contains(node)) {
      closeOverlay();
    }
    const button = node.closest('[data-action],[data-tab-group],[data-carousel-page],[data-dynamic-link]');
    if (!visible(button) || overlay && !overlay.contains(button) && button !== trigger) return;
    if (button.hasAttribute('data-tab-group')) {
      if (tabs.get(button.dataset.tabGroup) !== button.dataset.contentKey) { cancelEntrances(); tabs.set(button.dataset.tabGroup, button.dataset.contentKey); renderTabs(true); }
      return;
    }
    if (button.hasAttribute('data-carousel-page')) {
      const target = get(button.dataset.carouselTarget);
      carousel(target, 0, Number(button.dataset.carouselPage));
      findFor('ind', target.id).flatMap((node) => query('[data-carousel-page]', node)).find((node) => node.dataset.carouselPage === button.dataset.carouselPage)?.focus();
      return;
    }
    if (button.hasAttribute('data-dynamic-link')) { openLink(button.dataset.dynamicLink, true); return; }
    const action = own(config.actions, button.dataset.originalAction ?? button.id);
    if (!action) return;
    const targets = action.targets.map(get).filter(Boolean);
    switch (action.type) {
      case 'go-section': { const index = screens().indexOf(targets[0]); if (index >= 0) step(0, false, index); break; }
      case 'next-section': step(1, true); break;
      case 'next-page': case 'previous-page': targets.forEach((target) => carousel(target, action.type === 'next-page' ? 1 : -1)); break;
      case 'open-modal': case 'open-menu': openOverlay(targets[0], button); break;
      case 'close-modal': case 'close-menu': if (targets.includes(overlay)) closeOverlay(); break;
      case 'toggle-menu': if (targets.includes(overlay)) closeOverlay(); else openOverlay(targets[0], button); break;
      case 'open-link':
        if (overlay?.hasAttribute('data-menu') && http(actionAddress(action.key))) closeOverlay();
        openLink(actionAddress(action.key), false);
        break;
      case 'copy-text': navigator.clipboard?.writeText(action.value).then(() => announce(messages[1]), () => {}); break;
      case 'show-target': case 'hide-target': targets.forEach((target) => hide(target, action.type === 'hide-target')); images(device); break;
      case 'set-state': targets.forEach((target) => setVariant(target, action.value)); break;
    }
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { if (overlay) closeOverlay(); else if (footerOpen) moveFooter(false); return; }
    if (overlay) {
      if (event.key === 'Tab') {
        const controls = query('button,a[href],input,textarea,select,[tabindex="0"]', overlay).filter(visible);
        const edge = event.shiftKey ? controls[0] : controls.at(-1);
        if (!edge || !controls.includes(document.activeElement) || document.activeElement === edge) {
          event.preventDefault();
          ((event.shiftKey ? controls.at(-1) : controls[0]) ?? overlay).focus();
        }
      }
      return;
    }
    const tab = event.target.closest('[data-tab-group]');
    if (tab && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) {
      const group = query('[data-tab-group]', device).filter((button) => button.dataset.tabGroup === tab.dataset.tabGroup);
      const index = group.indexOf(tab);
      const diff = ['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1;
      const next = event.key === 'Home' ? group[0] : event.key === 'End' ? group.at(-1) : group[(index + diff + group.length) % group.length];
      event.preventDefault(); next.click(); next.focus(); return;
    }
    if (event.repeat || event.target.closest(ignore) || event.altKey || event.ctrlKey || event.metaKey) return;
    if (['ArrowDown','ArrowUp','PageDown','PageUp','Home','End'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'Home' || event.key === 'End') step(0, false, event.key === 'Home' ? 0 : screens().length - 1);
      else step(['ArrowDown','PageDown'].includes(event.key) ? 1 : -1);
    }
  });
  document.addEventListener('wheel', (event) => {
    if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || event.target.closest(ignore) || overlay) return;
    if (footerOpen && footer?.contains(event.target) && (event.deltaY > 0 || footer.scrollTop > 0)) return;
    event.preventDefault();
    const now = performance.now();
    if (now - wheelTime >= 220) { wheelUsed = false; wheelSum = 0; }
    wheelTime = now;
    wheelSum += event.deltaY * ([1, 16, innerHeight][event.deltaMode] ?? 1);
    if (!wheelUsed && Math.abs(wheelSum) >= 28) { wheelUsed = true; step(Math.sign(wheelSum)); }
  }, { passive: false });
  document.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0 || event.target.closest(ignore) || overlay) return;
    start = { id: event.pointerId, x: event.clientX, y: event.clientY, touch: event.pointerType === 'touch',
      carousel: event.target.closest('[data-carousel]'), interactive: event.target.closest('a,button,[role="button"]') };
  });
  document.addEventListener('pointercancel', () => { start = undefined; });
  document.addEventListener('pointerup', (event) => {
    if (!start || start.id !== event.pointerId) return;
    const origin = start;
    start = undefined;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) return;
    suppressClick = performance.now() + 350;
    if (Math.abs(dx) >= 40 && Math.abs(dx) > 1.25 * Math.abs(dy) && origin.carousel) carousel(origin.carousel, -Math.sign(dx));
    else if (Math.abs(dy) >= (footerOpen && origin.touch ? 30 : 64) && Math.abs(dy) > 1.25 * Math.abs(dx) && (origin.touch || !origin.interactive)) step(-Math.sign(dy));
  });
  for (const type of ['contextmenu','copy','cut','selectstart','dragstart']) document.addEventListener(type, (event) => {
    if (!event.target.closest?.(edit + ',[data-copy]')) event.preventDefault();
  });
  function dataValue(rootValue, path, row, listKey) {
    return (path ?? []).reduce((value, token) => typeof token === 'object' ? (token.itemOf === listKey || token.slotOf === listKey ? row : undefined) : own(value, token), rootValue);
  }
  function locale(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const key = ({ 'zh-CN':'zh_CN', 'zh-TW':'zh_TW', en:'en_US', ja:'ja_JP', ko:'ko_KR' }[config.language] ?? config.language);
      return own(value, key);
    }
    return value;
  }
  function fill(node, bindings, data, row, listKey) {
    const field = bindings?.field;
    if (field) {
      const raw = dataValue(data, field.path, row, listKey);
      const value = locale(raw);
      if (field.target === 'component-input') {
        if (raw !== undefined) node.textContent = String(raw);
      } else if (field.target === 'text') {
        if (typeof value === 'string' || typeof value === 'number') node.textContent = String(value);
        else if (value == null && raw != null) hide(node, true);
      } else if (field.target === 'link') node.dataset.dynamicLink = http(value)?.href ?? '';
      else if (field.target === 'image') {
        const image = node.querySelector('img');
        const url = http(value);
        if (image && url) {
          const fallback = image.dataset.src || image.getAttribute('src');
          image.dataset.src = fallback || '';
          image.dataset.remoteSrc = url.href;
        }
      }
    }
    if (bindings?.show) {
      const show = dataValue(data, bindings.show.path, row, listKey);
      if (typeof show === 'boolean') node.hidden = !show;
    }
    if (bindings?.state) {
      const state = bindings.state;
      const value = own(state.mapping?.values, dataValue(data, state.path, row, listKey));
      if (value != null) setVariant(node, String(value));
    }
  }
  function validateInputs(data) {
    for (const binding of Object.values(config.bindings)) {
      const field = binding.fields?.field;
      if (field?.target !== 'component-input') continue;
      if (field.receiver !== 'text-content' || field.valueShape !== 'scalar') throw new Error('component-input receiver');
      function visit(value, position) {
        if (value === undefined) return;
        if (position === field.path.length) {
          if (!field.valueTypes.includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) throw new Error('component-input value');
          return;
        }
        const token = field.path[position];
        if (typeof token !== 'object') return visit(own(value, token), position + 1);
        if (!Array.isArray(value)) throw new Error('component-input collection');
        if (token.itemOf) value.forEach((item) => visit(item, position + 1));
        else if (token.slotOf) visit(token.key != null ? value.find((item) => dataValue(item, token.field) === token.key) : value[token.index], position + 1);
      }
      visit(data, 0);
    }
  }
  function populate(data) {
    for (const [id, binding] of Object.entries(config.bindings)) {
      const node = get(id);
      if (!node) continue;
      fill(node, binding.fields, data);
      if (!['list','slots'].includes(binding.data?.kind)) continue;
      const rows = dataValue(data, binding.data.path);
      if (!Array.isArray(rows)) continue;
      const template = [...node.children].find((child) => child.hasAttribute('data-item-template'));
      const slots = binding.data.kind === 'slots' && binding.data.slots
        ? binding.data.slots.map(get).filter((child) => child && node.contains(child))
        : [...node.children].filter((child) => child.hasAttribute('data-carousel-item'));
      if (binding.data.kind === 'slots') {
        slots.forEach((slot, index) => {
          const fields = [slot, ...query('[id]', slot)];
          const token = fields.map((item) => own(config.bindings, item.id)?.fields?.field?.path.find((part) => part?.slotOf === node.dataset.nodeKey)).find(Boolean);
          const row = token?.key != null ? rows.find((value) => dataValue(value, token.field) === token.key) : rows[token?.index ?? index];
          fields.forEach((item) => {
            const declaration = own(config.bindings, item.id)?.fields;
            if (row == null && binding.data.missing === 'pending' && declaration?.field?.target === 'text') item.textContent = messages[0];
            else if (row != null) fill(item, declaration, data, row, node.dataset.nodeKey);
          });
        });
      } else if (template) {
        listRows.set(id, rows);
        slots.forEach((slot) => slot.remove());
        rows.forEach((row, index) => {
          const fragment = template.content.cloneNode(true);
          const item = fragment.firstElementChild;
          item.dataset.itemKey = String(index);
          for (const element of [item, ...query('[id]', item)]) {
            const original = element.id;
            if (!original) continue;
            if (element.hasAttribute('data-action')) element.dataset.originalAction = original;
            element.dataset.motionRef = original;
            fill(element, own(config.bindings, original)?.fields, data, row, node.dataset.nodeKey);
            element.id = original + '-' + index;
          }
          node.append(fragment);
        });
      }
    }
    align();
  }
  async function readData() {
    const address = http(config.dataUrl);
    root.dataset.dataState = address ? 'loading' : 'unpublished';
    if (!address) return;
    address.searchParams.set('_t', String(Date.now()));
    try {
      const response = await fetch(address, { credentials: 'omit', cache: 'no-cache' });
      if (response.status === 404) { root.dataset.dataState = 'unpublished'; return; }
      if (!response.ok) throw new Error('HTTP');
      const data = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('JSON');
      validateInputs(data);
      populate(data);
      root.dataset.dataState = 'ready';
    } catch { root.dataset.dataState = 'unavailable'; }
  }
  root.classList.remove('no-js');
  root.classList.add('is-enhanced');
  align();
  window.addEventListener('resize', () => align(true));
  window.visualViewport?.addEventListener('resize', () => align(true));
  reduced.addEventListener('change', () => {
    if (reduced.matches) { finishTracks(); finishMenuMotion(); cancelEntrances(); stopVideo(); }
  });
  readData();
}
