import { createSafeStaticServer } from './safe-server.mjs';
import { launchChromium } from './resolve-playwright.mjs';
import { withQaShell } from './replay.mjs';

export async function runHeroBrowserCheck({ demoDir, timeoutMs = 180000 } = {}) {
  let server = null;
  let browser = null;
  try {
    server = createSafeStaticServer(demoDir);
    const base = await server.listen();
    ({ browser } = await launchChromium(demoDir, { headless: true }));
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e?.message || e)));
    await page.goto(withQaShell(base + '/index.html'), { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForFunction(() => window.__qa && typeof window.__qa.inspect === 'function', null, { timeout: timeoutMs });
    await page.waitForTimeout(120);

    const result = await page.evaluate(async () => {
      const presets = JSON.parse(document.getElementById('qa-devices')?.textContent || 'null');
      const groups = presets?.deviceGroups || [];
      const waitFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const probe = async (expected) => {
        const frame = document.querySelector('.frame');
        if (!frame) return { expected, ok: false, reason: 'missing-frame' };
        frame.scrollTop = 0;
        await waitFrames();
        const fr = frame.getBoundingClientRect();
        const later = [...frame.querySelectorAll('[data-hero-slot-role="after-hero"]')];
        const rects = later.map((el) => el.getBoundingClientRect());
        const firstTop = rects.length ? Math.min(...rects.map((r) => r.top - fr.top)) : null;
        const visible = rects.some((r) => r.top < fr.bottom - 0.5 && r.bottom > fr.top + 0.5);
        const vp = window.__qa.inspect().viewport;
        const releaseDistance = Number(frame.getAttribute('data-hero-slot-release-scroll')) || 0;
        const maxScroll = Math.max(0, frame.scrollHeight - frame.clientHeight);
        const lockedAtTop = frame.getAttribute('data-hero-scroll-state') === 'HERO_LOCKED';
        const partialTarget = releaseDistance > 0 ? Math.min(maxScroll, releaseDistance / 2) : 0;
        frame.scrollTop = partialTarget;
        await waitFrames();
        const exitingState = frame.getAttribute('data-hero-scroll-state');
        const partialProgress = Number(frame.getAttribute('data-hero-scroll-progress')) || 0;
        frame.scrollTop = maxScroll;
        await waitFrames();
        const releasedState = frame.getAttribute('data-hero-scroll-state');
        const releaseReached = releaseDistance <= 0 || maxScroll + 1 >= releaseDistance;
        frame.scrollTop = 0;
        await waitFrames();
        const lockedAfterReturn = frame.getAttribute('data-hero-scroll-state') === 'HERO_LOCKED';
        const motionOk = lockedAtTop && lockedAfterReturn && releaseReached
          && (releaseDistance <= 0 || (exitingState === 'HERO_EXITING' && partialProgress > 0 && partialProgress < 1))
          && (releaseDistance <= 0 || releasedState === 'CONTENT_RELEASED');
        return {
          expected,
          actual: { w: vp.w, h: vp.h },
          ok: frame.getAttribute('data-hero-scroll-slot') === 'active'
            && later.length > 0 && !visible && firstTop != null && firstTop >= fr.height - 1 && motionOk,
          firstTop,
          visibleHeight: fr.height,
          laterCount: later.length,
          hero: frame.getAttribute('data-hero-section'),
          renderBase: frame.getAttribute('data-render-base'),
          fallback: frame.getAttribute('data-plat-fallback'),
          motion: {
            stateAtTop: lockedAtTop ? 'HERO_LOCKED' : frame.getAttribute('data-hero-scroll-state'),
            stateAtPartial: exitingState,
            stateAtRelease: releasedState,
            stateAfterReturn: lockedAfterReturn ? 'HERO_LOCKED' : frame.getAttribute('data-hero-scroll-state'),
            releaseDistance,
            maxScroll,
            partialProgress,
            releaseReached,
            ok: motionOk,
          },
        };
      };
      const selectDevice = async (width, height) => {
        let found = null;
        groups.some((g, gi) => (g.devices || []).some((d, di) => {
          if (d.width === width && d.height === height) { found = { gi, di, group: g.key }; return true; }
          return false;
        }));
        if (!found) return { expected: { w: width, h: height }, ok: false, reason: 'preset-missing' };
        const groupButtons = [...document.querySelectorAll('.bar .row:first-child .seg button')];
        groupButtons[found.gi]?.click();
        await waitFrames();
        const portrait = document.querySelector('[data-qa-orientation="portrait"]');
        if (portrait && !portrait.classList.contains('on')) { portrait.click(); await waitFrames(); }
        const select = document.querySelector('.bar select');
        if (!select) return { expected: { w: width, h: height }, ok: false, reason: 'device-select-missing' };
        select.value = String(found.di);
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await waitFrames();
        return probe({ w: width, h: height });
      };
      const out = [];
      out.push(await selectDevice(768, 1024));
      out.push(await selectDevice(1024, 1366));
      out.push(await selectDevice(390, 844));
      window.__qa.resize(1440, 900);
      await waitFrames();
      out.push(await probe({ w: 1440, h: 900 }));
      return out;
    });
    const tablet = result[0] || {};
    const ok = errors.length === 0 && result.length === 4 && result.every((r) => r.ok
      && r.actual?.w === r.expected?.w && r.actual?.h === r.expected?.h)
      && tablet.renderBase === 'pc' && tablet.fallback === 'pad-uses-pc-tree';
    console.log(JSON.stringify({ ok, pageErrors: errors, viewports: result }, null, 2));
    return ok;
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2));
    return false;
  } finally {
    try { await browser?.close(); } catch {}
    try { await server?.close(); } catch {}
  }
}

if (process.argv[1] && process.argv[1].endsWith('figma-hero-browser-check.mjs')) {
  const i = process.argv.indexOf('--demo');
  const demoDir = i >= 0 ? process.argv[i + 1] : process.cwd();
  process.exit((await runHeroBrowserCheck({ demoDir })) ? 0 : 1);
}
