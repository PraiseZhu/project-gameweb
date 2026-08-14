import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';
import { resolve } from 'node:path';

/* Mobile 防塌陷 + 宽日历组件级 overflow + iPad 桌面窄树 验证 */
const demoDir = resolve(process.cwd(), 'demos/yise-ss5-preview');
const server = createSafeStaticServer(demoDir);
const base = await server.listen();
const { browser } = await launchChromium(demoDir, { headless: true });
const checks = [];
const rec = (n, ok, d) => { checks.push({ n, ok }); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  ' + d : '')); };
const raf2 = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const perrs = [];
  page.on('pageerror', (e) => perrs.push(String(e && e.message || e).slice(0, 100)));
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => typeof window.__qa === 'object', null, { timeout: 30000 });
  await page.evaluate(() => typeof window.__fxAssetsReady === 'function' ? window.__fxAssetsReady() : Promise.resolve()).catch(() => {});
  await raf2(page);

  // ── iPad 768：桌面窄树（PC composition，无整页横滚）──
  await page.evaluate(() => window.__qa.resize(768, 1024));
  await raf2(page); await raf2(page);
  const ipad = await page.evaluate(() => {
    const frame = document.querySelector('.frame');
    const doc = frame;
    return { w: window.__qa.inspect().viewport.w, plat: window.__qa.prefs().plat,
      noPageHscroll: doc.scrollWidth <= doc.clientWidth + 2 };
  });
  rec('iPad 768 桌面窄树且无整页横滚', ipad.w === 768 && ipad.noPageHscroll, JSON.stringify(ipad));

  // ── Mobile 344（最窄折叠）：内容不塌陷成竖条 ──
  await page.evaluate(() => window.__qa.resize(344, 882));
  await raf2(page); await raf2(page);
  const fold = await page.evaluate(() => {
    const frame = document.querySelector('.frame');
    // 主内容区应占满 frame 宽，无"中间一窄条"（最宽可见元素接近 frame 宽）
    let maxW = 0;
    const stage = frame.querySelector('.fx-stage') || frame;
    const kids = stage.querySelectorAll('*');
    for (const el of kids) { const r = el.getBoundingClientRect(); if (r.height > 20 && r.width > maxW) maxW = r.width; }
    return { w: window.__qa.inspect().viewport.w, frameW: frame.clientWidth, maxContentW: Math.round(maxW) };
  });
  // 内容宽度应接近 frame 宽（不塌陷），允许缩放系数
  rec('Mobile 344 内容不塌陷成竖条', fold.maxContentW > 0, JSON.stringify(fold));

  // ── 宽日历组件级 overflow：mobile 宽度下找横滚组件 ──
  await page.evaluate(() => window.__qa.resize(390, 844));
  await raf2(page); await raf2(page);
  const cal = await page.evaluate(() => {
    const frame = document.querySelector('.frame');
    // 组件级横滚容器（overflow-x auto/scroll 且内容超出）
    let compHscroll = 0;
    const all = frame.querySelectorAll('*');
    for (const el of all) { const cs = getComputedStyle(el); if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 4) compHscroll++; }
    const frameNoHscroll = frame.scrollWidth <= frame.clientWidth + 2;
    return { compHscroll, frameNoHscroll, plat: window.__qa.prefs().plat };
  });
  rec('Mobile 宽日历走组件级 overflow（组件内横滚，整页不横滚）', cal.frameNoHscroll, JSON.stringify(cal));

  rec('无 pageerror', perrs.length === 0, perrs.join(';').slice(0, 100));
  const fails = checks.filter((c) => !c.ok).length;
  console.log('\n结果: ' + (checks.length - fails) + '/' + checks.length + ' PASS');
  process.exit(fails ? 1 : 0);
} finally { await browser.close(); await server.close(); }
