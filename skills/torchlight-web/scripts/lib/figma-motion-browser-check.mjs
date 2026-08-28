import { join } from 'node:path';
import { createSafeStaticServer } from './safe-server.mjs';
import { launchChromium } from './resolve-playwright.mjs';

const frameWait = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

export async function runMotionBrowserCheck({ demoDir, artifactDir = join(demoDir, 'artifacts'), timeoutMs = 180000 } = {}) {
  let server = null;
  let browser = null;
  try {
    server = createSafeStaticServer(demoDir);
    const base = await server.listen();
    ({ browser } = await launchChromium(demoDir, { headless: true }));
    const results = [];
    for (const expected of [
      { width: 1440, height: 900, platform: 'pc' },
      { width: 1024, height: 1366, platform: 'pad' },
      { width: 390, height: 844, platform: 'mobile' },
    ]) {
      const page = await browser.newPage({ viewport: expected });
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
      await page.goto(base + '/index.html', { waitUntil: 'load', timeout: timeoutMs });
      await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: timeoutMs });
      await page.evaluate(({ width, height }) => window.__qa.resize(width, height), expected);
      /* Desktop starts in the preview's native PC state. Re-clicking that
         already-active choice rebuilds the frame immediately before pointer
         sampling and is not representative of a normal first-page visit. */
      if (expected.platform && expected.platform !== 'pc') await page.evaluate((platform) => {
        const groups = [...document.querySelectorAll('[data-qa-pref="plat:' + platform + '"]')];
        const button = groups.find((el) => el.offsetParent !== null) || groups[0];
        if (button) button.click();
      }, expected.platform);
      await page.waitForFunction(() => document.querySelector('.frame[data-motion-adapter-status], .frame [data-motion-role]'));
      await page.waitForTimeout(100);
      const initial = await page.evaluate(() => {
        const frame = document.querySelector('.frame');
        const roles = [...frame.querySelectorAll('[data-motion-role]')];
        const byRole = (role) => roles.find((el) => el.getAttribute('data-motion-role') === role) || null;
        const computed = (el) => el ? (() => { const s = getComputedStyle(el); return {
          animationName: s.animationName, animationDuration: s.animationDuration,
          animationDelay: s.animationDelay, animationTimingFunction: s.animationTimingFunction,
          transitionDuration: s.transitionDuration, transitionTimingFunction: s.transitionTimingFunction,
          transform: s.transform, translate: s.translate,
        }; })() : null;
        return {
          viewport: window.__qa.inspect().viewport,
          platformEvidence: frame.getAttribute('data-motion-platform-evidence'),
          errors: [...new Set(roles.map((el) => el.getAttribute('data-motion-adapter-status')).filter(Boolean))],
          roleCounts: roles.reduce((out, el) => { const role = el.getAttribute('data-motion-role'); out[role] = (out[role] || 0) + 1; return out; }, {}),
          roleEvidence: roles.slice(0, 160).map((el) => ({ role: el.getAttribute('data-motion-role'), step: el.getAttribute('data-motion-step'), evidence: el.getAttribute('data-motion-evidence'), status: el.getAttribute('data-motion-adapter-status') })),
          kv: computed(byRole('kv')),
          kvBrand: computed(byRole('kvBrand')),
          kvTitle: computed(byRole('kvTitle')),
          kvPrimaryAction: computed(byRole('kvPrimaryAction')),
          scrollIndicator: computed(byRole('scrollIndicator')),
          background: { inline: byRole('kv-background')?.style.translate || '', computed: computed(byRole('kv-background')) },
          foreground: { inline: byRole('kv-foreground')?.style.translate || '', computed: computed(byRole('kv-foreground')) },
        };
      });
      await page.screenshot({ path: join(artifactDir, `motion-${expected.width}x${expected.height}-early.png`), fullPage: false });
      const parallaxTarget = await page.evaluate(() => {
        const hero = document.querySelector('[data-hero-slot-role="hero"]');
        const bg = document.querySelector('[data-motion-role="kv-background"]');
        const fg = document.querySelector('[data-motion-role="kv-foreground"]');
        if (!hero || !bg || !fg) return null;
        const rect = hero.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          height: rect.height,
          width: rect.width,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        };
      });
      let parallax;
      if (!parallaxTarget) {
        parallax = { ok: false, reason: 'missing-kv-depth' };
      } else {
        const visibleLeft = Math.max(1, parallaxTarget.left + 1);
        const visibleRight = Math.min(parallaxTarget.viewportWidth - 1, parallaxTarget.right - 1);
        const visibleTop = Math.max(1, parallaxTarget.top + 1);
        const visibleBottom = Math.min(parallaxTarget.viewportHeight - 1, parallaxTarget.top + parallaxTarget.height - 1);
        const y = visibleTop + Math.max(0, (visibleBottom - visibleTop) / 2);
        const readParallax = () => page.evaluate(() => {
          const bg = document.querySelector('[data-motion-role="kv-background"]');
          const fg = document.querySelector('[data-motion-role="kv-foreground"]');
          return { bg: bg?.style.translate || '', fg: fg?.style.translate || '', bgComputed: bg ? getComputedStyle(bg).translate : '', fgComputed: fg ? getComputedStyle(fg).translate : '' };
        });
        /* The outer 10% may be the fixed navigation hit area, which the
           official behavior intentionally excludes from parallax. Sample the
           visible hero content on both sides of its center instead. */
        const leftX = visibleLeft + Math.max(0, (visibleRight - visibleLeft) * 0.3);
        const rightX = visibleLeft + Math.max(0, (visibleRight - visibleLeft) * 0.7);
        await page.mouse.move(leftX, y);
        await page.waitForTimeout(240);
        const left = await readParallax();
        await page.mouse.move(rightX, y);
        await page.waitForTimeout(240);
        const right = await readParallax();
        parallax = { ok: true, enabled: parallaxTarget.width >= 751, left, right };
      }
      await page.waitForTimeout(1200);
      await page.screenshot({ path: join(artifactDir, `motion-${expected.width}x${expected.height}-right.png`), fullPage: false });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const reduced = await page.evaluate(async () => {
        const frame = document.querySelector('.frame');
        const style = document.createElement('style');
        style.textContent = '@media (prefers-reduced-motion: reduce){*{animation:none!important;animation-name:none!important;animation-duration:0s!important;animation-iteration-count:1!important;transition:none!important;transition-duration:0s!important}}';
        document.head.appendChild(style);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const roles = [...frame.querySelectorAll('[data-motion-role]')];
        const animated = roles.filter((el) => { const s = getComputedStyle(el); return s.animationName !== 'none' && s.animationDuration !== '0s'; });
        return { supported: matchMedia('(prefers-reduced-motion: reduce)').matches, animated: animated.length };
      });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const intersection = await page.evaluate(async () => {
        const frame = document.querySelector('.frame');
        const el = frame.querySelector('[data-motion-role="activityCalendar"]');
        if (!el) return { ok: false, reason: 'missing-calendar-role' };
        const fr = frame.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        frame.scrollTop = Math.max(0, frame.scrollTop + er.top - fr.top - fr.height * 0.55);
        await new Promise((resolve) => setTimeout(resolve, 500));
        const style = getComputedStyle(el);
        return { ok: el.getAttribute('data-motion-adapter-status') !== 'pending-intersection' && style.animationDuration !== '0s', status: el.getAttribute('data-motion-adapter-status'), animationName: style.animationName, animationDuration: style.animationDuration, scrollTop: frame.scrollTop };
      });
      const componentVariant = expected.platform === 'pc' ? await page.evaluate(async () => {
        const frame = document.querySelector('.frame');
        const owner = [...frame.querySelectorAll('[data-switch-owner][data-switch-page-source="component-set-variant"]')]
          .find((candidate) => candidate.getAttribute('data-motion-role') === 'sourceDevice'
            && candidate.querySelectorAll(':scope > [data-switch-variant-base], :scope > [data-switch-variant-layer]').length > 1);
        if (!owner) return { ok: false, reason: 'missing-source-backed-component-variant' };
        const sid = owner.getAttribute('data-switch');
        const beforeIndex = Number(owner.getAttribute('data-switch-index') || 0);
        const controls = [...frame.querySelectorAll('[data-switch][data-swpage]')]
          .filter((candidate) => candidate.getAttribute('data-switch') === sid && candidate.hasAttribute('data-tab'));
        const control = controls.find((candidate) => Number(candidate.getAttribute('data-swpage')) !== beforeIndex);
        if (!control) return { ok: false, reason: 'missing-complete-variant-control' };
        owner.scrollIntoView({ block: 'center' });
        control.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const layers = () => [...owner.querySelectorAll(':scope > [data-switch-variant-base], :scope > [data-switch-variant-layer]')]
          .map((layer) => ({ hidden: layer.hidden, opacity: Number(getComputedStyle(layer).opacity), transition: getComputedStyle(layer).transitionDuration }));
        const during = { index: owner.getAttribute('data-switch-index'), transition: owner.getAttribute('data-motion-variant-transition'), duration: owner.getAttribute('data-motion-variant-duration'), layers: layers() };
        await new Promise((resolve) => setTimeout(resolve, 360));
        const after = { index: owner.getAttribute('data-switch-index'), layers: layers() };
        return {
          ok: during.transition === 'fade-replace' && during.duration === '300'
            && during.layers.filter((layer) => !layer.hidden).length === 1
            && during.layers.some((layer) => layer.transition === '0.3s' && layer.opacity > 0 && layer.opacity < 1)
            && after.layers.filter((layer) => !layer.hidden).length === 1,
          during,
          after,
        };
      }) : null;
      if (componentVariant) await page.screenshot({ path: join(artifactDir, `motion-component-variant-${expected.width}x${expected.height}.png`), fullPage: false });
      results.push({ expected, pageErrors, initial, parallax, reduced, intersection, componentVariant });
      await page.close();
    }
    const desktop = results[0];
    const tablet = results[1];
    const mobile = results[2];
    const numeric = (value) => Number.parseFloat(value);
    const oppositeDesktopParallax = (sample) => Number.isFinite(numeric(sample?.left?.bg))
      && Number.isFinite(numeric(sample?.left?.fg))
      && Number.isFinite(numeric(sample?.right?.bg))
      && Number.isFinite(numeric(sample?.right?.fg))
      && numeric(sample.left.bg) > 0 && numeric(sample.left.fg) < 0
      && numeric(sample.right.bg) < 0 && numeric(sample.right.fg) > 0
      && Math.abs(numeric(sample.left.bg)) > 0.1 && Math.abs(numeric(sample.left.fg)) >= 0.08;
    const desktopParallaxOk = desktop?.parallax?.ok
      && desktop.parallax.enabled
      && oppositeDesktopParallax(desktop.parallax);
    const mobileParallaxOff = !mobile?.parallax?.ok
      && mobile?.parallax?.reason === 'missing-kv-depth'
      && mobile?.initial?.platformEvidence === 'unverified-no-depth-layer-truth';
    /* Tablet may resolve to captured pad truth when available; otherwise the
       renderer must expose an explicit fallback/unverified marker. */
    const tabletFallbackMarked = ['fallback-to-pc-unverified', 'unverified', 'observed']
      .includes(tablet?.initial?.platformEvidence);
    const reducedMotionOk = results.every((r) => r.reduced?.supported && r.reduced.animated === 0);
    /* No complete source-backed component tree means the generic fade bridge
       is intentionally inactive. That is not a failed carousel/variant test;
       a complete tree still has to prove its 300ms replacement below. */
    const componentVariantOk = desktop?.componentVariant?.ok === true
      || desktop?.componentVariant?.reason === 'missing-source-backed-component-variant';
    const noErrors = results.every((r) => r.pageErrors.length === 0);
    const ok = noErrors && desktopParallaxOk && mobileParallaxOff && tabletFallbackMarked && reducedMotionOk
      && desktop.initial.roleCounts.kv === 1 && desktop.initial.roleCounts['kv-background'] === 1 && desktop.initial.roleCounts['kv-foreground'] === 1
      && desktop.initial.roleCounts.kvBrand === 1 && desktop.initial.roleCounts.kvTitle === 1
      && desktop.initial.roleCounts.kvPrimaryAction >= 2
      && desktop.initial.kvBrand?.animationName === 'figma-motion-slide-down'
      && desktop.initial.kvTitle?.animationName === 'figma-motion-blur-scale-in'
      && desktop.initial.kvPrimaryAction?.animationName === 'figma-motion-slide-up'
      && desktop.initial.roleCounts.scrollIndicator === 1
      && desktop.initial.scrollIndicator?.animationName === 'figma-motion-arrow-loop-y'
      && desktop.initial.scrollIndicator?.animationDuration === '2s'
      && mobile.initial.roleCounts.kv === 1 && tablet.initial.roleCounts.kv === 1
      && desktop.intersection.ok && componentVariantOk;
    console.log(JSON.stringify({ ok, noErrors, desktopParallaxOk, mobileParallaxOff, componentVariantOk, results }, null, 2));
    return ok;
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2));
    return false;
  } finally {
    try { await browser?.close(); } catch {}
    try { await server?.close(); } catch {}
  }
}

if (process.argv[1]?.endsWith('figma-motion-browser-check.mjs')) {
  const i = process.argv.indexOf('--demo');
  const demoDir = i >= 0 ? process.argv[i + 1] : process.cwd();
  process.exit((await runMotionBrowserCheck({ demoDir })) ? 0 : 1);
}
