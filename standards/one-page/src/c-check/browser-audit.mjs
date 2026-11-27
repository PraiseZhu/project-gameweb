import { createSafeStaticServer } from '../../../stop1-figma-pixel/tool/src/safe-server.mjs';
import { launchChromium } from '../../../stop1-figma-pixel/tool/src/resolve-playwright.mjs';
import { observed, finding, usesData } from './static-audit.mjs';
import { auditDataPresentation, dataValue } from './data-presentation.mjs';
import { hasHiddenPaginationEvidence } from './pixel-scope.mjs';
import { auditPaging } from './pagination-audit.mjs';

const sizes = {
  pc: [[1280,720],[1366,768],[1440,810],[1440,900],[1840,1000],[1920,1080],[2560,1440],[2560,1080],[2560,720]],
  mobile: [[320,568],[375,667],[375,812],[390,844],[812,375],[844,390],[690,829],[768,1024],[1024,768]],
};

export async function readyForCapture(page, selector) {
  await page.waitForFunction((target) => {
    const section = document.querySelector(target);
    return section?.classList.contains('is-current') && document.fonts.status === 'loaded'
      && !document.getAnimations().some((animation) => animation.pending || animation.playState === 'running');
  }, selector);
  return page.evaluate(async () => {
    const visible = (node) => node.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    const images = [...document.images].filter((image) => visible(image) && image.getBoundingClientRect().width > 0);
    await document.fonts.ready;
    await Promise.all(images.map((image) => image.decode()));
    return { images: images.map((image) => new URL(image.currentSrc).pathname), fonts: [...document.fonts].filter((font) => font.status === 'loaded').map((font) => ({ family: font.family, weight: font.weight })) };
  });
}

async function liveTextProof(page, context, screen, meta) {
  if (!screen.textMasks?.length) return [];
  const session = await context.newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument');
    const result = [];
    for (const mask of screen.textMasks) {
      const trace = meta.nodes.find((row) => row.domId === mask.domId && row.end === screen.end && row.module === screen.nodeId);
      if (!trace?.text?.trim() || trace.asset || ['bg','kv'].includes(trace.role)) throw new Error('遮罩对象不是选定屏的 live 文本');
      const selector = idSelector(mask.domId);
      const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
      const measured = await page.locator(selector).evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const box = range.getBoundingClientRect();
        const style = getComputedStyle(node);
        const copy = style.fontFamily.split(',')[0].replace(/["']/g, '').trim();
        const loaded = [...document.fonts].some((face) => face.family === copy && face.status === 'loaded' && face.weight.split(' ').includes(style.fontWeight));
        return { text: node.textContent.trim(), visible: node.checkVisibility(), overflow: node.scrollWidth > node.clientWidth + 1,
          font: copy, weight: style.fontWeight, loaded, rect: [Math.floor(box.x), Math.floor(box.y), Math.ceil(box.right) - Math.floor(box.x), Math.ceil(box.bottom) - Math.floor(box.y)] };
      });
      if (!measured.visible || measured.overflow || !measured.loaded || measured.text !== trace.text.trim()
        || !fonts.length || fonts.some((font) => !font.isCustomFont) || JSON.stringify(measured.rect) !== JSON.stringify(mask.rect)) {
        throw new Error('同版文字、真实字体或设计几何未通过，不遮罩：' + mask.domId + '，实测框 ' + JSON.stringify(measured.rect));
      }
      result.push({ domId: mask.domId, rect: mask.rect, measured, fonts });
    }
    return result;
  } finally { await session.detach(); }
}

export async function hitTarget(page, selector) {
  return page.locator(selector).evaluate((node) => {
    const box = node.getBoundingClientRect();
    const x = (Math.max(box.left, 0) + Math.min(box.right, innerWidth)) / 2;
    const y = (Math.max(box.top, 0) + Math.min(box.bottom, innerHeight)) / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, hit: hit?.id || hit?.tagName || null, ok: node.contains(hit) && !node.closest('[inert],[hidden]') };
  });
}

const screenSelector = (end) => '[data-device="' + end + '"] [data-screen]';
const idSelector = (id) => '#' + id;

async function showScreen(page, end, id) {
  await page.locator('body').evaluate((body) => { document.activeElement?.blur(); body.focus(); });
  await page.keyboard.press('Home');
  const screens = await page.locator(screenSelector(end)).evaluateAll((nodes) => nodes.map((node) => node.id));
  const order = screens.indexOf(id);
  if (order < 0) throw new Error('找不到外置追溯指定的屏：' + id);
  for (let index = 0; index < order; index++) {
    await readyForCapture(page, idSelector(screens[index]));
    await page.keyboard.press('PageDown');
  }
  await readyForCapture(page, idSelector(id));
}

async function enterScreenState(page, { end, domId, selectedTabs, activation }) {
  await showScreen(page, end, domId);
  const section = page.locator(idSelector(domId));
  for (const id of selectedTabs) {
    const tab = section.locator(idSelector(id));
    if (await tab.count() !== 1) throw Error('所需 TAB 不在目标屏');
    if (id !== activation?.trigger && await tab.getAttribute('aria-selected') === 'true') continue;
    const hit = await hitTarget(page, idSelector(id));
    if (!hit.ok) throw Error('无法命中目标屏所需 TAB');
    await page.mouse.click(hit.x, hit.y);
    if (await tab.getAttribute('aria-selected') !== 'true') throw Error('目标屏所需 TAB 未激活');
  }
  if (activation) await page.waitForFunction(({ trigger, panel }) => document.getElementById(trigger)?.getAttribute('aria-selected') === 'true'
    && !document.getElementById(panel)?.closest('[hidden],[inert]'), activation);
  const ready = await readyForCapture(page, idSelector(domId));
  const actual = await section.locator('[role=tab][aria-selected=true]').evaluateAll((nodes) => nodes.map((node) => node.id).sort());
  if (JSON.stringify(actual) !== JSON.stringify([...selectedTabs].sort())) throw Error('实际选中的 TAB 与绑定状态不符');
  return ready;
}

const enterPagingState = (page, { screen, selectedTabs }) => enterScreenState(page, { ...screen, selectedTabs });

async function contentChecks(page, meta, end) {
  return page.evaluate(({ nodes, end }) => {
    const inTemplates = (root) => [...root.querySelectorAll('template')].flatMap((template) => [...template.content.querySelectorAll('[id]')]);
    const elements = [...document.querySelectorAll('[id]'), ...inTemplates(document)];
    const index = new Map();
    for (const node of elements) index.set(node.id, [...(index.get(node.id) ?? []), node]);
    return nodes.filter((row) => row.end === end).map((row) => {
      const found = index.get(row.domId) ?? [];
      const node = found[0];
      const copy = node?.querySelector('.copy-text') ?? node;
      const text = row.text === null || row.text === undefined || copy?.textContent?.trim() === row.text.trim()
        || [...(node?.childNodes ?? [])].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim() === row.text.trim());
      const screen = node?.closest('[data-screen]');
      const module = nodes.find((entry) => entry.end === end && entry.role === 'sec' && entry.nodeId === row.module);
      const location = !module || screen?.id === module.domId || !node?.isConnected;
      const image = !row.asset || [...(node?.children ?? [])].some((child) => child.matches('img')
        && (child.getAttribute('data-src') === row.asset || child.getAttribute('src') === row.asset));
      const device = node && (!node.isConnected || node.closest('[data-device]')?.dataset.device === end);
      return { id: row.domId, matches: found.length, text, location, image, device };
    });
  }, { nodes: meta.nodes, end });
}

async function interactionChecks(page, meta, end, screen, config, add) {
  const active = async (id) => await page.locator(idSelector(id)).count() === 1 && await page.locator(idSelector(id)).evaluate((node) =>
    node.checkVisibility() && !node.closest('[inert],[hidden]'));
  const click = async (id) => {
    const hit = await hitTarget(page, idSelector(id));
    if (hit.ok) await page.mouse.click(hit.x, hit.y);
    return hit.ok;
  };
  for (const row of meta.tabBindings.filter((entry) => entry.end === end)) {
    const find = (ref) => meta.nodes.find((node) => node.end === end && node.scope === ref.scope && node.nodeId === ref.id);
    const tab = find(row.tab);
    const panel = find(row.panel);
    if (!tab || !panel || tab.module !== screen.nodeId) continue;
    if (!await active(tab.domId)) {
      add('D08', tab.domId + ':activation', false, 'TAB 在适用屏不可操作');
      continue;
    }
    const tabNode = page.locator(idSelector(tab.domId));
    const clicked = await click(tab.domId);
    const selected = await tabNode.getAttribute('aria-selected');
    const target = await active(panel.domId);
    const inactivePanels = await tabNode.evaluate((node) => {
      const group = node.closest('[data-device]');
      const otherTargets = [...group.querySelectorAll('[role=tab]')].filter((other) => other !== node
        && other.dataset.tabGroup === node.dataset.tabGroup && other.dataset.contentKey !== node.dataset.contentKey);
      return otherTargets.every((other) => {
        const panel = document.getElementById(other.getAttribute('aria-controls'));
        return panel && panel.hidden && panel.inert && !panel.checkVisibility();
      });
    });
    await tabNode.focus();
    await page.keyboard.press('ArrowRight');
    const keyboard = await tabNode.evaluate((node) => {
      const group = [...document.querySelectorAll('[data-tab-group]')].filter((item) => item.dataset.tabGroup === node.dataset.tabGroup
        && item.checkVisibility() && !item.closest('[inert],[hidden]'));
      const next = group[(group.indexOf(node) + 1) % group.length];
      return next === document.activeElement && next?.getAttribute('aria-selected') === 'true';
    });
    add('D08', tab.domId + ':activation', clicked && selected === 'true' && target && keyboard && inactivePanels,
      { clicked, selected, target, keyboard, inactivePanels });
  }
  for (const [id, action] of Object.entries(config?.actions ?? {})) {
    if (!['open-modal', 'open-menu', 'toggle-menu', 'go-section', 'next-section', 'show-target', 'hide-target', 'set-state', 'copy-text', 'open-link'].includes(action.type)) continue;
    const control = page.locator(idSelector(id));
    if (!await control.count()) continue;
    const owner = await control.evaluate((node) => ({ end: node.closest('[data-device]')?.dataset.device,
      screen: node.closest('[data-screen]')?.id, panels: [...document.querySelectorAll('[role=tabpanel]')].filter((panel) => panel.contains(node)).map((panel) => panel.id) }));
    if (owner.end !== end || owner.screen && owner.screen !== screen.domId) continue;
    for (const panel of owner.panels) {
      const trigger = page.locator('[data-device="' + end + '"] [role=tab][aria-controls="' + panel + '"]').first();
      if (await trigger.count() && await active(await trigger.getAttribute('id'))) await click(await trigger.getAttribute('id'));
    }
    if (!await active(id)) continue;
    const order = await page.locator(screenSelector(end)).evaluateAll((nodes) => nodes.filter((node) => !node.hidden).map((node) => node.id));
    const overlayAction = ['open-modal', 'open-menu', 'toggle-menu'].includes(action.type);
    const hiddenBefore = !overlayAction || await page.locator(idSelector(action.targets[0])).evaluate((node) => node.hidden && node.inert);
    if (action.type === 'copy-text') {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.evaluate(() => navigator.clipboard.writeText('c3-before-copy'));
    }
    if (action.type === 'open-link') await page.evaluate(() => window.c3Opened.splice(0));
    const clicked = await click(id);
    if (action.type === 'copy-text') {
      const copied = clicked && await page.waitForFunction(async (value) => await navigator.clipboard.readText() === String(value), action.value,
        { timeout: 1500 }).then(() => true, () => false);
      add('D12', id + ':copy-control', copied, { actionId: id, clipboardMatches: copied });
      continue;
    }
    if (action.type === 'open-link') {
      const social = config.social?.[action.key];
      const expected = Object.hasOwn(config.languageUrls ?? {}, action.key) ? config.languageUrls[action.key]
        : social && typeof social === 'object' ? (social.platform === 'wechat' || social.regions?.length && !social.regions.includes(config.language) ? null : social.url)
        : config.links[action.key];
      const opened = await page.evaluate(() => window.c3Opened.splice(0));
      add('D10', screen.domId + ':link:' + id, clicked && (expected ? opened.length === 1 && opened[0].url === new URL(expected).href
        && opened[0].target === '_blank' && opened[0].features?.includes('noopener') : opened.length === 0), { actionId: id, count: opened.length });
      continue;
    }
    if (['show-target', 'hide-target', 'set-state'].includes(action.type)) {
      const actual = await page.evaluate(({ targets, type }) => targets.map((target) => {
        const node = document.getElementById(target);
        return !node ? null : type === 'set-state' ? node.dataset.state : node.hidden;
      }), action);
      const expected = action.type === 'set-state' ? String(action.value) : action.type === 'hide-target';
      add('D08', screen.domId + ':' + id + ':state', clicked && actual.length > 0 && actual.every((value) => value === expected), { actionId: id, actual, expected });
      continue;
    }
    const targetId = action.type === 'next-section' ? order[(order.indexOf(screen.domId) + 1) % order.length] : action.targets[0];
    const target = page.locator(idSelector(targetId));
    if (['go-section','next-section'].includes(action.type)) {
      const selected = await target.count() === 1 && await target.evaluate((node) => node.classList.contains('is-current'));
      add('D08', screen.domId + ':' + id + ':navigation', clicked && selected, { actionId: id, selected, targetId });
      if (selected && screen.domId !== targetId) await showScreen(page, end, screen.domId);
      continue;
    }
    const opened = await active(targetId);
    const focus = opened && await target.evaluate((node) => node.contains(document.activeElement));
    await page.keyboard.press('Tab');
    const trapped = opened && await target.evaluate((node) => node.contains(document.activeElement));
    const closers = Object.entries(config.actions).filter(([, row]) => ['close-modal','close-menu'].includes(row.type) && row.targets.includes(targetId));
    for (const [closer] of closers) {
      const activation = await active(closer) && await click(closer);
      const shut = !await active(targetId);
      add('D08', screen.domId + ':' + closer + ':close', activation && shut, { actionId: closer, activation, shut });
      if (shut) await click(id);
    }
    await page.keyboard.press('Escape');
    const closed = !await active(targetId);
    const restored = await page.evaluate((key) => document.activeElement?.id === key, id);
    add('D08', screen.domId + ':' + id + ':overlay', hiddenBefore && clicked && opened && focus && trapped && closed && restored,
      { actionId: id, targetId, hiddenBefore, opened, focus, trapped, closed, restored });
  }
  for (const [id, row] of Object.entries(config?.bindings ?? {})) {
    if (!row.pagination || !await active(id)) continue;
    if (meta.tabBindings.some((tab) => tab.end === end && meta.nodes.some((node) => node.domId === id && node.nodeId === tab.switch.id))) continue;
    const paging = row.pagination;
    const panels = paging.list
      ? await page.locator(idSelector(paging.list) + ' > [data-carousel-item]').evaluateAll((nodes) => nodes.map((node) => node.id))
      : paging.panels ?? [];
    const size = paging.list ? paging.perPage : 1;
    const visiblePanels = async () => {
      const found = [];
      for (const panel of panels) if (await active(panel)) found.push(panel);
      return found;
    };
    const count = Math.ceil(panels.length / size);
    if (count > 1) {
      const hit = await hitTarget(page, idSelector(id));
      const initial = await visiblePanels();
      const index = Math.floor(panels.indexOf(initial[0]) / size);
      const direction = hit.x >= 65 ? -1 : 1;
      const offset = -direction;
      const expectedIndex = (index + count + offset) % count;
      const expected = panels.slice(expectedIndex * size, (expectedIndex + 1) * size);
      if (hit.ok) {
        await page.mouse.move(hit.x, hit.y);
        await page.mouse.down();
        await page.mouse.move(hit.x + direction * 60, hit.y, { steps: 4 });
        await page.mouse.up();
      }
      const after = await visiblePanels();
      add('D08', screen.domId + ':' + id + ':drag', hit.ok && JSON.stringify(after) === JSON.stringify(expected), { hit, expected, after });
    }
  }
}

export async function auditBrowser({ root, meta, config, manifest, samples, referenceCases, capture }) {
  const server = createSafeStaticServer(root);
  const results = [];
  const screenshots = [];
  let browser;
  const add = (check, target, ok, detail) => results.push(observed(check, target, ok, detail));
  try {
    const origin = await server.listen();
    ({ browser } = await launchChromium(null, { headless: true }));
    const errors = [];
    const setup = async (viewport, options = {}, sample, probe) => {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: 'block', ...options });
      const requests = [];
      const failedImages = new Map();
      const responseGate = Promise.withResolvers();
      if (probe) await context.addInitScript((probe) => {
        window.c3Opened = [];
        window.open = (url, target, features) => { window.c3Opened.push({ url, target, features }); return null; };
        if (probe !== true) Object.defineProperty(window, 'OnePageConfig', { configurable: true, set(value) {
          if (probe.link) {
            for (const key of Object.keys(value.links)) value.links[key] = probe.link;
            for (const key of Object.keys(value.languageUrls)) value.languageUrls[key] = probe.link;
            for (const social of Object.values(value.social)) if (social && typeof social === 'object') social.url = probe.link;
          }
          if (probe.video) {
            value.components.backgroundVideo.src = location.origin + '/__c3_video__';
            const calls = window.c3Video = { create: 0, play: 0, pause: 0 };
            window.createBackgroundVideo = (mount) => {
              calls.create++;
              return { play() { calls.play++; mount.dispatchEvent(new Event('playing')); }, pause() { calls.pause++; } };
            };
          }
          Object.defineProperty(window, 'OnePageConfig', { value, configurable: true });
        } });
      }, probe);
      if (sample) await context.addInitScript((enabled) => {
        Object.defineProperty(window, 'OnePageConfig', { configurable: true, set(value) {
          value.dataUrl = enabled ? location.origin + '/__c3_sample__' : null;
          Object.defineProperty(window, 'OnePageConfig', { value, writable: true, configurable: true });
        } });
      }, sample.state !== 'missing');
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin) {
          if (sample && request.resourceType() === 'image') failedImages.set(url.href, (failedImages.get(url.href) ?? 0) + 1);
          return route.abort();
        }
        if (url.pathname === '/__c3_sample__' && sample) {
          requests.push({ method: request.method(), cookie: Boolean(request.headers().cookie) });
          await responseGate.promise;
          return route.fulfill({ status: sample.state === '404' ? 404 : sample.state === 'failure' ? 503 : 200, json: sample.data });
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push({ kind: 'pageerror', message: error.message }));
      page.on('console', (message) => {
        if (message.type() === 'error' && !(sample && (message.location().url.startsWith(origin + '/__c3_sample__?')
            || failedImages.has(message.location().url)))) errors.push({ kind: 'console', message: message.text() });
      });
      const response = await page.goto(origin + '/' + meta.baseLanguage + '.html', { waitUntil: 'load' });
      if (!response?.ok()) throw new Error('基础语言 HTML 未正常返回');
      return { page, context, requests, failedImages, releaseResponse: responseGate.resolve };
    };
    for (const end of meta.ends) {
      for (const [width, height] of sizes[end]) {
        const { page, context } = await setup({ width, height }, { reducedMotion: 'reduce' });
        try {
          const tested = [];
          for (const screen of meta.nodes.filter((row) => row.end === end && row.role === 'sec')) {
            await showScreen(page, end, screen.domId);
            const fact = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
              ends: [...document.querySelectorAll('[data-device]')].filter((node) => node.checkVisibility()).map((node) => node.dataset.device) }));
            tested.push({ screen: screen.domId, fact, ok: fact.width === width && fact.height === height && fact.documentWidth <= width
              && fact.ends.length === 1 && fact.ends[0] === end });
          }
          add('D07', end + ':' + width + 'x' + height, tested.length > 0 && tested.every((row) => row.ok), tested);
        } finally { await context.close(); }
      }
      const [width, height] = sizes[end][0];
      const { page: staticPage, context: staticContext } = await setup({ width, height }, { javaScriptEnabled: false });
      try {
        const fact = await staticPage.locator(screenSelector(end)).evaluateAll((nodes) => nodes.map((node) => ({ id: node.id,
          screenVisible: node.checkVisibility(), images: [...node.querySelectorAll('img')].map((image) => ({ source: image.getAttribute('src'),
            visible: image.checkVisibility({ visibilityProperty: true }), loaded: image.complete && image.naturalWidth > 0 })) })));
        add('D01', end + ':no-js', fact.length > 0 && fact.every((screen) => screen.screenVisible
          && screen.images.every((image) => image.source ? image.loaded : !image.visible)), fact);
        const checks = await contentChecks(staticPage, meta, end);
        for (const row of checks) add('D02', row.id, row.matches === 1 && row.text && row.location && row.image && row.device, row);
        const ids = await staticPage.locator('[id]').evaluateAll((nodes) => nodes.map((node) => node.id));
        add('D03', end + ':unique-ids', new Set(ids).size === ids.length, { total: ids.length, unique: new Set(ids).size });
        const css = await staticPage.evaluate((end) => {
          const paths = [...document.styleSheets].map((sheet) => new URL(sheet.href).pathname);
          const invalid = [];
          const visit = (rules, path) => {
            for (const rule of rules) {
              if (rule.style && rule.selectorText) {
                const properties = ['animation-duration','transition-duration','color','font-family'];
                for (const prop of properties) {
                  const value = rule.style.getPropertyValue(prop).trim();
                  if (value && !/^(?:var\(|inherit$|initial$|unset$|currentcolor$|transparent$|0s$)/i.test(value)) invalid.push({ path, selector: rule.selectorText, prop });
                }
              }
              if (rule.cssRules) visit(rule.cssRules, path);
            }
          };
          for (const sheet of document.styleSheets) visit(sheet.cssRules, new URL(sheet.href).pathname);
          return { paths, invalid, styleNodes: document.querySelectorAll('style,[style]').length,
            device: document.querySelector('[data-device="' + end + '"]')?.dataset.device };
        }, end);
        add('D03', end + ':css', css.invalid.length === 0 && css.styleNodes === 0
          && JSON.stringify(css.paths) === JSON.stringify(['/css/styles.css','/css/mobile.css','/css/locales.css']), css);
      } finally { await staticContext.close(); }

      const initialRequests = server.requestedPaths().length;
      const { page, context } = await setup({ width, height }, { reducedMotion: 'reduce' }, undefined, true);
      try {
        const screens = meta.nodes.filter((row) => row.end === end && row.role === 'sec');
        const session = await context.newCDPSession(page);
        await session.send('DOM.enable');
        await session.send('CSS.enable');
        for (const screen of screens) {
          await showScreen(page, end, screen.domId);
          const selector = idSelector(screen.domId);
          const state = await readyForCapture(page, selector);
          if (screen === screens[0]) {
            const first = meta.nodes.filter((row) => row.end === end && (!row.module || row.module === screen.nodeId)).map((row) => row.asset);
            const later = meta.nodes.filter((row) => row.asset && (row.end !== end || (row.module && row.module !== screen.nodeId)) && !first.includes(row.asset)).map((row) => row.asset);
            const premature = server.requestedPaths().slice(initialRequests).filter(({ path }) => later.includes(path));
            const hero = await page.locator('[data-device="' + end + '"] .is-current img[data-hero-background]').evaluateAll((images) => images.map((image) => ({
              url: image.currentSrc ? new URL(image.currentSrc).pathname : null, priority: image.fetchPriority, loading: image.loading, loaded: image.complete && image.naturalWidth > 0 })));
            add('D11', end + ':initial-network', premature.length === 0 && hero.every((image) => image.url && image.priority === 'high' && image.loading === 'eager' && image.loaded),
              { premature, hero, images: state.images });
          }
          add('D11', screen.domId + ':reduced', await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches
            && [...document.querySelectorAll('video')].every((video) => video.paused)), state);
          const targets = await page.locator('[data-device="' + end + '"] :is(button,a[href])').evaluateAll((nodes) => nodes
            .filter((node) => node.checkVisibility() && !node.closest('[inert],[hidden]') && node.getBoundingClientRect().width > 0)
            .map((node) => node.id).filter(Boolean));
          for (const id of targets) {
            const hit = await hitTarget(page, idSelector(id));
            add('D08', screen.domId + ':hit:' + id, hit.ok, hit);
          }
          const text = await page.locator(selector + ' .copy').evaluateAll((nodes) => nodes.filter((node) => node.checkVisibility()).map((node) => {
            const style = getComputedStyle(node);
            const font = style.fontFamily.split(',')[0].replace(/["']/g, '').trim();
            return { id: node.id, width: node.clientWidth, scroll: node.scrollWidth, weight: style.fontWeight, font,
              loaded: [...document.fonts].some((face) => {
                const [lower, upper = lower] = face.weight.split(' ').map(Number);
                return face.family === font && face.status === 'loaded' && Number(style.fontWeight) >= lower && Number(style.fontWeight) <= upper;
              }) };
          }));
          const dom = await session.send('DOM.getDocument');
          for (const row of text) {
            const query = await session.send('DOM.querySelector', { nodeId: dom.root.nodeId, selector: idSelector(row.id) });
            const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId: query.nodeId });
            add('D05', row.id, row.loaded && row.scroll <= row.width + 1 && fonts.length > 0 && fonts.every((font) => font.isCustomFont), { ...row, fonts });
          }
          if (text.length) {
            const neutral = await page.locator(selector).evaluate((screen) => {
              const watched = [...screen.querySelectorAll('img.cover,[data-foreground]')].filter((node) => node.checkVisibility());
              const copy = [...screen.querySelectorAll('.copy')].filter((node) => node.checkVisibility());
              const textNodes = copy.flatMap((node) => {
                const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
                const nodes = [];
                for (let text = walker.nextNode(); text; text = walker.nextNode()) nodes.push([text, text.nodeValue]);
                return nodes;
              });
              const measure = () => watched.map((node) => {
                const { x, y, width, height } = node.getBoundingClientRect();
                return [x, y, width, height];
              });
              const before = measure();
              let empty;
              try {
                for (const [node] of textNodes) node.nodeValue = '';
                empty = measure();
              } finally { for (const [node, value] of textNodes) node.nodeValue = value; }
              const restored = measure();
              return { compared: watched.length, before, empty, restored,
                unchanged: JSON.stringify(before) === JSON.stringify(empty) && JSON.stringify(before) === JSON.stringify(restored) };
            });
            results.push(neutral.compared ? observed('D05', screen.domId + ':text-geometry', neutral.unchanged, neutral)
              : finding('D05', screen.domId + ':text-geometry', 'n_a', '本屏未声明底图或盖层，不适用文字推动它们的检查'));
          }
          await interactionChecks(page, meta, end, screen, config, add);
        }
        await auditPaging(page, { meta, config, end, enter: (state) => enterPagingState(page,state), hitTarget, add });
        const protectedEvents = await page.evaluate(() => {
          const content = document.querySelector('.is-current');
          const targets = [content, ...document.querySelectorAll('input,textarea,[contenteditable],[data-copy]')];
          return targets.flatMap((target, index) => ['selectstart','copy','cut','dragstart','contextmenu'].map((type) => {
            const event = new Event(type, { bubbles: true, cancelable: true });
            target.dispatchEvent(event);
            return { id: target.id, type, expected: index === 0, prevented: event.defaultPrevented };
          }));
        });
        add('D12', end + ':protection', protectedEvents.every(({ prevented, expected }) => prevented === expected), protectedEvents);
        const protectedStyle = await page.locator('.is-current').evaluate((node) => ({ selection: getComputedStyle(node).userSelect,
          images: [...node.querySelectorAll('img')].map((image) => ({ drag: getComputedStyle(image).webkitUserDrag, draggable: image.draggable })) }));
        add('D12', end + ':selection-drag', protectedStyle.selection === 'none' && protectedStyle.images.every((image) => image.drag === 'none'), protectedStyle);
        const runtime = await page.evaluate(() => ({ initialized: document.documentElement.classList.contains('is-enhanced'),
          missingComponents: !document.querySelector('#page-footer:not([hidden]),video[src]'),
          footerMount: Boolean(document.querySelector('#page-footer.page-footer-mount[inert][aria-hidden=true][tabindex="-1"]')),
          trackingNotRequested: !performance.getEntriesByType('resource').some(({ name }) => /tracking(?:-boot)?\.js$/.test(name)),
          videoNotRequested: !performance.getEntriesByType('resource').some(({ name }) => /background-video\.umd\.js$/.test(name)) }));
        add('D10', end + ':offline-defaults', runtime.initialized && runtime.missingComponents && runtime.footerMount
          && runtime.trackingNotRequested && runtime.videoNotRequested, runtime);
        const editable = page.locator('[data-device="' + end + '"] :is(input:not([type]),input[type=text],textarea,[contenteditable=true])');
        if (!await editable.count()) results.push(finding('D12', end + ':editable', 'n_a', '当前端成品无声明的编辑控件；独立运行时夹具不作成品证据'));
        for (let index = 0; index < await editable.count(); index++) {
          const field = editable.nth(index);
          if (!await field.isVisible() || !await field.isEditable()) continue;
          await context.grantPermissions(['clipboard-read', 'clipboard-write']);
          await field.fill('c3-edit');
          await field.press('ControlOrMeta+a');
          await field.press('ControlOrMeta+c');
          const copied = await page.evaluate(() => navigator.clipboard.readText());
          await field.press('ControlOrMeta+x');
          const empty = await field.evaluate((node) => (node.value ?? node.textContent) === '');
          await field.press('ControlOrMeta+v');
          const pasted = await field.evaluate((node) => node.value ?? node.textContent);
          add('D12', end + ':editable:' + index, copied === 'c3-edit' && empty && pasted === 'c3-edit', { copied: copied === 'c3-edit', empty, pasted: pasted === 'c3-edit' });
        }
        const assetEntries = manifest.assets.filter((row) => row.end === end);
        const decodes = await page.evaluate(async (entries) => Promise.all(entries.map(async ({ path, format, width, height, original, hasAlpha, lossless }) => {
          try {
            const response = await fetch(path);
            const asset = await response.blob();
            const correctFormat = ({ svg: 'image/svg+xml', webp: 'image/webp' })[format] === asset.type.split(';')[0];
            const url = URL.createObjectURL(asset);
            try {
              const image = new Image();
              image.src = url;
              await image.decode();
              let pixels = null;
              let originalOk = true;
              if (original) {
                const response = await fetch(original.path);
                const source = await response.blob();
                const before = await createImageBitmap(source);
                const canvas = new OffscreenCanvas(before.width, before.height);
                const context = canvas.getContext('2d');
                context.drawImage(before, 0, 0);
                const input = context.getImageData(0, 0, before.width, before.height).data;
                context.clearRect(0, 0, before.width, before.height);
                context.drawImage(image, 0, 0);
                const output = context.getImageData(0, 0, before.width, before.height).data;
                let alpha = false;
                let alphaChanged = false;
                let differing = 0;
                for (let offset = 0; offset < input.length; offset++) {
                  if (input[offset] !== output[offset]) {
                    differing++;
                    if (offset % 4 === 3) alphaChanged = true;
                  }
                  if (offset % 4 === 3 && input[offset] !== 255) alpha = true;
                }
                originalOk = response.ok && source.type === 'image/png' && before.width === image.naturalWidth
                  && before.height === image.naturalHeight && alpha === hasAlpha && !alphaChanged && (!lossless || differing === 0);
                pixels = { alpha, alphaChanged, differing };
                before.close();
              }
              return { path, ok: response.ok && correctFormat && (width === undefined || width === image.naturalWidth)
                && (height === undefined || height === image.naturalHeight) && originalOk, width: image.naturalWidth, height: image.naturalHeight, pixels };
            } finally { URL.revokeObjectURL(url); }
          } catch { return { path, ok: false }; }
        })), assetEntries);
        for (const row of decodes) add('D06', end + ':' + row.path, row.ok, row);
      } finally { await context.close(); }
      const linkActions = Object.entries(config?.actions ?? {}).filter(([id, action]) => action.type === 'open-link'
        && meta.nodes.some((row) => row.end === end && row.domId === id));
      if (linkActions.length) {
        for (const link of [origin + '/__c3_external__', 'mailto:c3@example.invalid']) {
          const { page: linkPage, context: linkContext } = await setup({ width, height }, { reducedMotion: 'reduce' }, undefined, { link });
          try {
            for (const [id, action] of linkActions) {
              const source = meta.nodes.find((row) => row.end === end && row.domId === id);
              const screen = meta.nodes.find((row) => row.end === end && row.role === 'sec' && row.nodeId === source.module);
              if (screen) await showScreen(linkPage, end, screen.domId);
              const node = linkPage.locator(idSelector(id));
              if (!await node.isVisible() || await node.evaluate((element) => Boolean(element.closest('[inert],[hidden]')))) continue;
              const hit = await hitTarget(linkPage, idSelector(id));
              const oldCount = await linkPage.evaluate(() => window.c3Opened.length);
              if (hit.ok) await linkPage.mouse.click(hit.x, hit.y);
              const opens = await linkPage.evaluate((index) => window.c3Opened.slice(index), oldCount);
              const isHttp = link.startsWith(origin);
              const social = config.social?.[action.key];
              const blocked = !Object.hasOwn(config.languageUrls ?? {}, action.key) && social
                && (social.platform === 'wechat' || social.regions?.length && !social.regions.includes(config.language));
              const expected = isHttp && !blocked ? 1 : 0;
              add('D10', id + ':' + (isHttp ? 'stub-http' : 'blocked-protocol'), hit.ok && opens.length === expected
                && (!expected || opens[0].target === '_blank' && opens[0].url === link && opens[0].features.includes('noopener')),
              { expected, actual: opens.length });
            }
          } finally { await linkContext.close(); }
        }
      }
      if (usesData(config) && samples?.length) {
        const baseline = new Map();
        const donor = samples.find((row) => row.id === 'success-full');
        const imageCases = donor ? meta.nodes.filter((row) => row.end === end).flatMap((row) => {
          const field = config.bindings[row.domId]?.fields?.field;
          if (field?.target !== 'image' || typeof dataValue(donor.data, field.path) !== 'string' || !field.path.length) return [];
          const data = structuredClone(donor.data);
          const parent = dataValue(data, field.path.slice(0, -1));
          const key = field.path.at(-1);
          if (!parent || !Object.hasOwn(parent, key)) return [];
          parent[key] = 'https://onepage-c3.invalid/' + row.domId + '.webp';
          return [{ ...donor, id: 'offline-' + row.domId, data }];
        }) : [];
        for (const sample of [...samples].sort((left, right) => Number(right.state === 'missing') - Number(left.state === 'missing'))
          .concat({ id: 'request-404', state: '404', data: {}, testData: true }, imageCases)) {
          if (sample.testData !== true || (sample.coverage?.ends && !(end in sample.coverage.ends))) continue;
          const { page: dataPage, context: dataContext, requests, failedImages, releaseResponse } = await setup({ width, height }, { hasTouch: true }, sample);
          try {
            const initial = await dataPage.evaluate(() => document.documentElement.dataset.dataState);
            releaseResponse();
            await dataPage.waitForFunction(() => ['unpublished', 'unavailable', 'ready'].includes(document.documentElement.dataset.dataState));
            const fact = await dataPage.evaluate((bindings) => ({ state: document.documentElement.dataset.dataState,
              lists: Object.entries(bindings).filter(([, row]) => row.data?.kind === 'list').map(([id, row]) => ({ id, path: row.data.path,
                items: document.getElementById(id)?.querySelectorAll(':scope > [data-carousel-item]').length })),
              fields: Object.entries(bindings).flatMap(([id, row]) => {
                const node = document.getElementById(id);
                if (!node) return [];
                const slots = row.data?.slots ?? [];
                return [{ id, text: node.textContent, hidden: node.hidden, state: node.dataset.state,
                  childElements: node.childElementCount, slots: slots.filter((target) => node.contains(document.getElementById(target))) }];
              }) }), config.bindings);
            const expected = ['missing', '404'].includes(sample.state) ? 'unpublished' : sample.state === 'failure' || sample.expected === 'reject' ? 'unavailable' : 'ready';
            const lists = fact.lists.filter(({ id }) => meta.nodes.some((node) => node.end === end && node.domId === id));
            const valueAt = (path) => Array.isArray(path) && path.every((key) => typeof key === 'string' || typeof key === 'number')
              ? path.reduce((value, key) => value != null && Object.hasOwn(value, key) ? value[key] : undefined, sample.data) : undefined;
            const expectedListCount = (path) => valueAt(path)?.length;
            const configured = fact.fields.every((actual) => {
              const row = config.bindings[actual.id];
              const text = row.fields?.field;
              const show = valueAt(row.fields?.show?.path);
              const state = row.fields?.state?.mapping?.values?.[valueAt(row.fields?.state?.path)];
              let value = valueAt(text?.path);
              if (value && typeof value === 'object' && text?.target === 'text') value = value[({ cn: 'zh_CN', tw: 'zh_TW', en: 'en_US', jp: 'ja_JP', kr: 'ko_KR' })[meta.baseLanguage]];
              return (typeof show !== 'boolean' || actual.hidden === !show) && (state == null || actual.state === String(state))
                && (!['text', 'component-input'].includes(text?.target) || value == null || (actual.text === String(value) && actual.childElements === 0));
            });
            if (sample.state === 'missing') for (const field of fact.fields) baseline.set(field.id, field);
            const defaults = expected === 'ready' || baseline.size === fact.fields.length
              && fact.fields.every((row) => JSON.stringify(row) === JSON.stringify(baseline.get(row.id)));
            const fixedSlots = fact.fields.filter((field) => config.bindings[field.id].data?.kind === 'slots').every((field) => {
              const declared = config.bindings[field.id].data.slots ?? [];
              return declared.length === field.slots.length && declared.every((slot) => field.slots.includes(slot));
            });
            add('D09', end + ':' + sample.id, fact.state === expected && requests.length === (sample.state === 'missing' ? 0 : 1)
              && initial === (sample.state === 'missing' ? 'unpublished' : 'loading') && defaults && fixedSlots
              && requests.every((request) => request.method === 'GET' && !request.cookie)
              && (expected !== 'ready' || configured && lists.every((list) => expectedListCount(list.path) === undefined || list.items === expectedListCount(list.path))),
            { initial, state: fact.state, expected, requests, lists, defaults, fixedSlots, checkedFields: fact.fields.length });
            await auditPaging(dataPage, { meta, config, end, sampleId: sample.id, enter: (state) => enterPagingState(dataPage,state), hitTarget, add });
            await showScreen(dataPage, end, meta.nodes.find((row) => row.end === end && row.role === 'sec').domId);
            if (expected === 'ready' && fact.state === 'ready') {
              await auditDataPresentation({ page: dataPage, context: dataContext, end, config, sample, add });
              for (const target of meta.nodes.filter((row) => row.end === end && config.bindings[row.domId]?.fields?.field?.target === 'image')) {
                const value = dataValue(sample.data, config.bindings[target.domId].fields.field.path);
                const language = ({ cn:'zh_CN', tw:'zh_TW', en:'en_US', jp:'ja_JP', kr:'ko_KR' })[meta.baseLanguage];
                const address = typeof value === 'string' ? value : value?.[language];
                let url;
                try { url = new URL(address); } catch { continue; }
                if (!['http:', 'https:'].includes(url.protocol) || url.origin === origin) continue;
                const screen = meta.nodes.find((row) => row.end === end && row.role === 'sec' && row.nodeId === target.module);
                if (screen) await showScreen(dataPage, end, screen.domId);
                const image = dataPage.locator(idSelector(target.domId) + ' > img').first();
                if (!await image.count()) continue;
                const fallback = await dataPage.waitForFunction(({ id, asset, expectedOrigin }) => {
                  const image = document.getElementById(id)?.querySelector('img');
                  if (!image) return false;
                  return asset ? image.complete && image.naturalWidth > 0 && image.src === new URL(asset, expectedOrigin).href
                    : !image.hasAttribute('src') && !image.hasAttribute('data-remote-src');
                }, { id: target.domId, asset: target.asset, expectedOrigin: origin }, { timeout: 1500 }).then(() => true, () => false);
                const attempts = failedImages.get(url.href) ?? 0;
                add('D11', target.domId + ':fallback:' + sample.id, fallback && attempts === 1,
                  { fallback, attempts, expectedFallback: Boolean(target.asset) });
              }
            }
          } finally { releaseResponse(); await dataContext.close(); }
        }
      }
    }
    if (meta.ends.length === 2) {
      const { page, context } = await setup({ width: 1024, height: 768 }, { reducedMotion: 'reduce' });
      try {
        await page.keyboard.press('End');
        const selected = () => page.locator('.is-current').evaluateAll((nodes) => nodes.filter((node) => node.checkVisibility()).map((node) => ({
          screen: node.dataset.screen, end: node.closest('[data-device]').dataset.device,
          content: [...node.querySelectorAll('[role=tab][aria-selected=true]')].filter((tab) => tab.checkVisibility()).map((tab) => tab.dataset.contentKey).sort(),
          overlays: [...node.closest('[data-device]').querySelectorAll('[data-overlay]:not([hidden])')].length })));
        const before = await selected();
        await page.setViewportSize({ width: 1025, height: 768 });
        await page.waitForFunction(() => document.querySelector('[data-device=pc] .is-current')?.checkVisibility());
        const desktop = await selected();
        await page.setViewportSize({ width: 1024, height: 768 });
        await page.waitForFunction(() => document.querySelector('[data-device=mobile] .is-current')?.checkVisibility());
        const after = await selected();
        add('D07', 'breakpoint-roundtrip', before.length === 1 && after.length === 1 && desktop.length === 1
          && before[0].screen === desktop[0].screen && before[0].screen === after[0].screen
          && JSON.stringify(before[0].content) === JSON.stringify(after[0].content) && after[0].overlays === 0 && desktop[0].overlays === 0,
        { before, desktop, after });
        const pairedSwitch = async (end) => {
          await page.setViewportSize({ width: end === 'pc' ? 1025 : 1024, height: 768 });
          await page.waitForFunction((target) => document.querySelector('[data-device="' + target + '"] .is-current')?.checkVisibility(), end);
        };
        const pairedTabs = await page.locator('[data-device="mobile"] [role=tab]').evaluateAll((nodes) => nodes.flatMap((tab) => {
          const peer = [...document.querySelectorAll('[data-device="pc"] [role=tab]')].find((candidate) =>
            candidate.dataset.tabGroup === tab.dataset.tabGroup && candidate.dataset.contentKey === tab.dataset.contentKey);
          return peer && tab.closest('[data-screen]') ? [{ tab: tab.id, peer: peer.id, screen: tab.closest('[data-screen]').id }] : [];
        }));
        for (const row of pairedTabs) {
          await showScreen(page, 'mobile', row.screen);
          const hit = await hitTarget(page, idSelector(row.tab));
          if (hit.ok) await page.mouse.click(hit.x, hit.y);
          const selectedMobile = () => page.locator(idSelector(row.tab)).getAttribute('aria-selected');
          const initial = await selectedMobile();
          await pairedSwitch('pc');
          const peer = await page.locator(idSelector(row.peer)).getAttribute('aria-selected');
          await pairedSwitch('mobile');
          const restored = await selectedMobile();
          add('D07', row.tab + ':tab-roundtrip', hit.ok && [initial, peer, restored].every((value) => value === 'true'), { hit, initial, peer, restored });
        }
        for (const [id, action] of Object.entries(config?.actions ?? {})) {
          if (!['open-modal','open-menu','toggle-menu'].includes(action.type)) continue;
          const trigger = page.locator('[data-device="mobile"] ' + idSelector(id));
          if (!await trigger.count()) continue;
          const screen = await trigger.evaluate((node) => node.closest('[data-screen]')?.id);
          if (screen) await showScreen(page, 'mobile', screen);
          if (!await trigger.isVisible() || await trigger.evaluate((node) => Boolean(node.closest('[inert],[hidden]')))) continue;
          const hit = await hitTarget(page, idSelector(id));
          if (hit.ok) await page.mouse.click(hit.x, hit.y);
          const overlay = page.locator(idSelector(action.targets[0]));
          const opened = await overlay.isVisible();
          await pairedSwitch('pc');
          const locked = await page.evaluate(() => document.documentElement.classList.contains('is-locked'));
          await pairedSwitch('mobile');
          const restored = !await overlay.isVisible();
          add('D07', id + ':overlay-roundtrip', hit.ok && opened && !locked && restored, { opened, locked, restored });
        }
      } finally { await context.close(); }
    }
    const desktopScreens = meta.nodes.filter((row) => row.end === 'pc' && row.role === 'sec');
    if (desktopScreens.length > 1) {
      const { page, context } = await setup({ width: 1280, height: 720 }, {}, undefined, { video: true });
      try {
        const hero = desktopScreens[0].domId;
        const next = desktopScreens[1].domId;
        const mount = idSelector(hero) + ' [data-hero-video]';
        const videoFacts = () => page.evaluate((selector) => ({ ...window.c3Video, hidden: document.querySelector(selector)?.hidden }), mount);
        await page.waitForFunction(() => window.c3Video.play === 1);
        const first = await videoFacts();
        await showScreen(page, 'pc', next);
        const exited = await videoFacts();
        await showScreen(page, 'pc', hero);
        await page.waitForFunction(() => window.c3Video.play === 2);
        const reentered = await videoFacts();
        await page.locator(mount).dispatchEvent('error');
        const failed = await videoFacts();
        await showScreen(page, 'pc', next);
        await showScreen(page, 'pc', hero);
        const returned = await videoFacts();
        add('D11', 'video-stub-lifecycle', first.create === 1 && first.hidden === false && exited.pause === 1 && exited.hidden
          && reentered.create === 1 && reentered.hidden === false && failed.pause === 2 && failed.hidden && returned.play === 2 && returned.hidden,
        { first, exited, reentered, failed, returned, stub: '本地挂载协议替身，非正式视频' });
      } catch (error) {
        results.push(finding('D11', 'video-stub-lifecycle', 'not_run', error.message));
      } finally { await context.close(); }
    }
    for (const reference of referenceCases) {
      const { page, context } = await setup(reference.viewport);
      try {
        const ready = await enterScreenState(page, reference);
        for (const domId of reference.requiredLocal) {
          if (reference.local.some((item) => item.domId === domId)) continue;
          const control = page.locator(idSelector(domId));
          const action = config?.actions?.[domId];
          if (!hasHiddenPaginationEvidence(results, { end:reference.end, screen:reference.domId, caseId:reference.caseId }, domId, action)
            || await control.count() !== 1 || !await control.evaluate((node) => node.hidden && node.inert && !node.checkVisibility())) {
            results.push(finding('D04', domId + ':' + reference.caseId + ':local', 'not_run', '缺当前可见关键模块的完整局部参考框'));
          }
        }
        const liveText = await liveTextProof(page, context, reference, meta);
        for (const target of reference.local) {
          const bounds = await page.locator(idSelector(target.domId)).boundingBox();
          if (!bounds || [bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height].some((value, index) =>
            Math.abs(value - target.edges[index]) > 0.1)) throw new Error('实景局部目标与权威设计框不符：' + target.domId);
        }
        for (const approval of reference.approved ?? []) {
          const art = page.locator(idSelector(approval.domId) + ' > .art');
          const measured = await art.boundingBox();
          if (!measured || [measured.x, measured.y, measured.x + measured.width, measured.y + measured.height]
            .some((value, index) => Math.abs(value - approval.edges[index]) > 0.1)
            || Number(await art.evaluate((node) => getComputedStyle(node).opacity)) !== approval.value) {
            throw new Error('设计确认区与当前目标范围或样式不符：' + approval.domId);
          }
          add('D04', reference.domId + ':' + reference.caseId + ':' + approval.domId + ':designer-confirmed', true, approval);
        }
        const png = await page.screenshot({ animations: 'allow', scale: 'css' });
        screenshots.push(...await capture(reference, png, { ...ready, chromium: browser.version(), liveText }));
      } catch (error) {
        results.push(finding('D04', reference.domId + ':' + reference.caseId, 'not_run', error.message));
      } finally { await context.close(); }
    }
    const missing = server.requestedPaths().filter(({ status }) => status >= 400);
    add('D01', 'runtime', errors.length === 0 && missing.length === 0, { errors, missing });
    return { results, screenshots, environment: { chromium: browser.version() } };
  } finally {
    await browser?.close();
    await server.close();
  }
}
