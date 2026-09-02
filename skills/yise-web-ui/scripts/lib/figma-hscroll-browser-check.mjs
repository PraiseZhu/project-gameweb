import { createSafeStaticServer } from './safe-server.mjs';
import { launchChromium } from './resolve-playwright.mjs';
import { withQaShell } from './replay.mjs';

const waitFrames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function selectDevice(page, width, height) {
  const selected = await page.evaluate(async ({ width, height }) => {
    const presets = JSON.parse(document.getElementById('qa-devices')?.textContent || 'null');
    const groups = presets?.deviceGroups || [];
    let found = null;
    groups.some((group, gi) => (group.devices || []).some((device, di) => {
      if (device.width === width && device.height === height) { found = { gi, di }; return true; }
      return false;
    }));
    if (!found) return false;
    document.querySelectorAll('.bar .row:first-child .seg button')[found.gi]?.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const portrait = document.querySelector('[data-qa-orientation="portrait"]');
    if (portrait && !portrait.classList.contains('on')) portrait.click();
    const select = document.querySelector('.bar select');
    if (!select) return false;
    select.value = String(found.di);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return true;
  }, { width, height });
  return selected;
}

async function dragHostToEnd(page, index) {
  const selector = `[data-hscroll="x"][data-hscroll-drag="true"]`;
  await page.locator(selector).nth(index).evaluate((host) => {
    const surfaces = [...host.querySelectorAll(':scope > [data-hscroll-surface="true"], :scope > [data-hscroll-overflow-child="true"]')];
    if (surfaces.length) {
      for (const surface of surfaces) {
        const rest = Number(surface.getAttribute('data-hscroll-rest-left'));
        if (Number.isFinite(rest)) surface.style.left = rest + 'px';
        surface.setAttribute('data-hscroll-offset', '0');
      }
    } else {
      host.scrollLeft = 0;
    }
    host.scrollIntoView({ block: 'center', inline: 'nearest' });
  });
  await waitFrames(page);
  const box = await page.locator(selector).nth(index).boundingBox();
  if (!box || box.width <= 4 || box.height <= 4) return { ok: false, reason: 'host-not-visible' };
  const hitTestable = await page.locator(selector).nth(index).evaluate((host) => {
    const rect = host.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return !!hit && host.contains(hit);
  });
  /* Alternate component states may retain their source tree in DOM while an
     active sibling is on top. They are not an operative scroll surface in the
     current state, so report rather than treating an occluded layer as a drag
     failure. */
  if (!hitTestable) return { skipped: true, reason: 'not-hit-testable-current-state' };
  const wheelLeft = await page.locator(selector).nth(index).evaluate((host) => {
    const surfaces = [...host.querySelectorAll(':scope > [data-hscroll-surface="true"], :scope > [data-hscroll-overflow-child="true"]')];
    host.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 }));
    const left = surfaces.length
      ? Math.max(0, ...surfaces.map((surface) => Number(surface.getAttribute('data-hscroll-offset') || 0)))
      : host.scrollLeft;
    if (surfaces.length) {
      for (const surface of surfaces) {
        const rest = Number(surface.getAttribute('data-hscroll-rest-left'));
        if (Number.isFinite(rest)) surface.style.left = rest + 'px';
        surface.setAttribute('data-hscroll-offset', '0');
      }
    } else {
      host.scrollLeft = 0;
    }
    return left;
  });
  for (let attempt = 0; attempt < 40; attempt++) {
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.5, { steps: 6 });
    await page.mouse.up();
    const reached = await page.locator(selector).nth(index).evaluate((host) => {
      const surfaces = [...host.querySelectorAll(':scope > [data-hscroll-surface="true"], :scope > [data-hscroll-overflow-child="true"]')];
      if (surfaces.length) {
        return surfaces.every((surface) => {
          const max = Number(surface.getAttribute('data-hscroll-max') || 0);
          const offset = Number(surface.getAttribute('data-hscroll-offset') || 0);
          return max > 0 && offset >= max - 1;
        });
      }
      return host.scrollLeft >= host.scrollWidth - host.clientWidth - 1;
    });
    if (reached) break;
  }
  return page.locator(selector).nth(index).evaluate((host, wheelLeft) => {
    const surfaces = [...host.querySelectorAll(':scope > [data-hscroll-surface="true"], :scope > [data-hscroll-overflow-child="true"]')];
    const surface = surfaces[0] || null;
    const max = surfaces.length
      ? Math.max(0, ...surfaces.map((track) => Number(track.getAttribute('data-hscroll-max') || 0)))
      : Math.max(0, host.scrollWidth - host.clientWidth);
    const offset = surfaces.length
      ? Math.max(0, ...surfaces.map((track) => Number(track.getAttribute('data-hscroll-offset') || 0)))
      : host.scrollLeft;
    const directChildren = [...host.children];
    const hostRect = host.getBoundingClientRect();
    /* `scrollLeft === max` is not enough. A direct child can be a wide
       source track whose own stale renderBox clip still hides its final item.
       Inspect the actual last rendered source child and confirm its pixels are
       hit-testable inside the viewport. */
    const tracks = directChildren.filter((child) => child.getAttribute('data-hscroll-track') === 'true');
    const contentRoots = tracks.length ? tracks : directChildren;
    const sourceItems = contentRoots.flatMap((root) => [...root.children])
      .filter((child) => {
        const rect = child.getBoundingClientRect();
        return rect.width > 0.5 && rect.height > 0.5;
      })
      .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
    const rightmost = sourceItems[0] || contentRoots.sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];
    const childRect = rightmost?.getBoundingClientRect();
    const visibleLeft = childRect ? Math.max(hostRect.left, childRect.left) : 0;
    const visibleRight = childRect ? Math.min(hostRect.right, childRect.right) : 0;
    const visibleTop = childRect ? Math.max(hostRect.top, childRect.top) : 0;
    const visibleBottom = childRect ? Math.min(hostRect.bottom, childRect.bottom) : 0;
    const hit = childRect && visibleRight > visibleLeft && visibleBottom > visibleTop
      ? document.elementFromPoint((visibleLeft + visibleRight) / 2, (visibleTop + visibleBottom) / 2) : null;
    const itemImage = rightmost?.querySelector('img');
    /* A complex track may layer a label, icon, or ornament above the final
       item background. It is still genuine right-edge content when the hit
       stays inside the source track; a hit on the scroll host means the
       track's pixels were clipped away. */
    const rightmostSourceHitTestable = !!rightmost && !!hit
      && (rightmost.contains(hit) || contentRoots.some((root) => root.contains(hit)));
    const rightmostSourcePainted = rightmostSourceHitTestable
      && (!itemImage || (itemImage.complete && itemImage.naturalWidth > 0 && itemImage.naturalHeight > 0));
    /* Only a renderer-released track has changed its clipping owner. For
       other source-backed scroll surfaces retain the baseline visibility
       assertion; a static snapshot can legitimately place a non-actionable
       overlay above its rightmost child. */
    const contentAtEnd = tracks.length ? rightmostSourcePainted
      : !!childRect && childRect.right > hostRect.left && childRect.left < hostRect.right;
    return {
      node: host.getAttribute('data-node'),
      evidence: host.getAttribute('data-hscroll-evidence'),
      clientWidth: (surface || host).clientWidth,
      scrollWidth: surface ? Number(surface.getAttribute('data-hscroll-max') || 0) + host.clientWidth : host.scrollWidth,
      scrollLeft: offset,
      max,
      reachedEnd: offset >= max - 2.5,
      wheelMoved: wheelLeft > 0,
      releasedTrackCount: tracks.length,
      rightmostSourceNode: rightmost?.getAttribute('data-node') || null,
      rightmostSourceVisible: !!childRect && childRect.right > hostRect.left && childRect.left < hostRect.right,
      rightmostSourceHitTestable,
      rightmostSourcePainted,
      contentAtEnd,
    };
  }, wheelLeft);
}

export async function runHscrollBrowserCheck({ demoDir, timeoutMs = 180000 } = {}) {
  let server = null;
  let browser = null;
  try {
    server = createSafeStaticServer(demoDir);
    const base = await server.listen();
    ({ browser } = await launchChromium(demoDir, { headless: true }));
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error?.message || error)));
    await page.goto(withQaShell(base + '/index.html'), { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForFunction(() => window.__qa && typeof window.__qa.inspect === 'function', null, { timeout: timeoutMs });
    const probes = [];
    for (const expected of [{ width: 390, height: 844 }, { width: 1920, height: 1080 }]) {
      if (!await selectDevice(page, expected.width, expected.height)) {
        probes.push({ expected, ok: false, reason: 'preset-missing' });
        continue;
      }
      const count = await page.locator('[data-hscroll="x"][data-hscroll-drag="true"]').count();
      const hosts = [];
      for (let index = 0; index < count; index++) hosts.push(await dragHostToEnd(page, index));
      const activeHosts = hosts.filter((host) => !host.skipped);
      probes.push({ expected, hosts, ok: activeHosts.length > 0 && activeHosts.every((host) => host.reachedEnd && host.wheelMoved && host.contentAtEnd) });
    }
    const ok = errors.length === 0 && probes.every((probe) => probe.ok);
    console.log(JSON.stringify({ ok, pageErrors: errors, probes }, null, 2));
    return ok;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
    return false;
  } finally {
    try { await browser?.close(); } catch {}
    try { await server?.close(); } catch {}
  }
}

if (process.argv[1] && process.argv[1].endsWith('figma-hscroll-browser-check.mjs')) {
  const i = process.argv.indexOf('--demo');
  const demoDir = i >= 0 ? process.argv[i + 1] : process.cwd();
  process.exit((await runHscrollBrowserCheck({ demoDir })) ? 0 : 1);
}
