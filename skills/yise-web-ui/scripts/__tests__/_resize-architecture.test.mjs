import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';
import { resolve } from 'node:path';

/* resize 架构回归：拖拽轻路径（DOM 变更数大降）+ 滚动锚点保持 + 跨断点强制完整 render。 */
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
  page.on('pageerror', (e) => perrs.push(String(e && e.message || e).slice(0, 120)));
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => typeof window.__qa === 'object' && window.__qa !== null, null, { timeout: 30000 });
  await page.evaluate(() => typeof window.__fxAssetsReady === 'function' ? window.__fxAssetsReady() : Promise.resolve()).catch(() => {});
  await raf2(page);

  // ── 1) 拖拽轻路径：统计 pointermove 全程 DOM 变更数 ──
  await page.evaluate(() => {
    window.__perf = { dom: 0 };
    const mo = new MutationObserver((m) => { window.__perf.dom += m.length; });
    mo.observe(document.querySelector('.stage'), { childList: true, subtree: true, attributes: true });
  });
  const box = await page.evaluate(() => { const h = document.querySelector('[data-qa-edge-resize]'); const r = h.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const fitScale = await page.evaluate(() => window.__qa.inspect().viewFitScale || 1);
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  const sd = (1600 - 1920) * fitScale;
  for (let i = 1; i <= 15; i++) { await page.mouse.move(box.x + (sd * i) / 15, box.y); await page.waitForTimeout(16); }
  const domDuringDrag = await page.evaluate(() => window.__perf.dom);
  await page.mouse.up();
  await raf2(page); await raf2(page);
  const finalW = await page.evaluate(() => window.__qa.inspect().viewport.w);
  // 轻路径下拖拽中 DOM 变更应远小于全量重建（全量一次约 27000/20≈1350/步，15步≈2万）
  rec('拖拽轻路径：拖拽中 DOM 变更数大降（< 3000）', domDuringDrag < 3000, 'dragDOM=' + domDuringDrag);
  rec('拖拽松手后最终宽=1600（精确 render 落定）', Math.abs(finalW - 1600) <= 6, 'finalW=' + finalW);

  // ── 2) 滚动锚点保持：先滚到中部，完整 render（松手）后比例保持 ──
  // 先拖回 1920 稳定
  await page.evaluate(() => window.__qa.resize(1920, 1080));
  await raf2(page); await raf2(page);
  const anchorTest = await page.evaluate(async () => {
    const frame = document.querySelector('.frame');
    const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // 滚到 40% 处
    frame.scrollTop = Math.round(frame.scrollHeight * 0.4);
    await raf2();
    const beforeRatio = frame.scrollTop / frame.scrollHeight;
    return { beforeRatio, beforeScrollH: frame.scrollHeight };
  });
  // 触发一次完整 render（resize 改宽度 → 非拖拽路径，完整 render + 锚点恢复）
  await page.evaluate(() => window.__qa.resize(1680, 1080));
  await raf2(page); await raf2(page); await raf2(page);
  const afterAnchor = await page.evaluate(() => {
    const frame = document.querySelector('.frame');
    return { ratio: frame.scrollTop / frame.scrollHeight, scrollTop: frame.scrollTop, scrollH: frame.scrollHeight };
  });
  const drift = Math.abs(afterAnchor.ratio - anchorTest.beforeRatio);
  rec('滚动锚点保持：完整 render 后滚动比例漂移 ≤ 8%', drift <= 0.08, 'before=' + anchorTest.beforeRatio.toFixed(3) + ' after=' + afterAnchor.ratio.toFixed(3) + ' drift=' + drift.toFixed(3));

  // ── 3) 跨断点强制完整 render：从 desktop(1440) 拖到 mobile(390) 结构切换 ──
  await page.evaluate(() => window.__qa.resize(1440, 900));
  await raf2(page); await raf2(page);
  const bpBefore = await page.evaluate(() => window.__qa.prefs().plat);
  // 用 resize 直接跨断点（离散完整 render）
  await page.evaluate(() => window.__qa.resize(390, 844));
  await raf2(page); await raf2(page);
  const bpAfter = await page.evaluate(() => ({ plat: window.__qa.prefs().plat, w: window.__qa.inspect().viewport.w }));
  rec('跨断点 desktop→mobile 结构切换', bpBefore === 'pc' && bpAfter.plat === 'mobile' && bpAfter.w === 390, 'before=' + bpBefore + ' after=' + bpAfter.plat + '@' + bpAfter.w);

  rec('无 pageerror', perrs.length === 0, perrs.join(';').slice(0, 120));

  const fails = checks.filter((c) => !c.ok).length;
  console.log('\n结果: ' + (checks.length - fails) + '/' + checks.length + ' PASS');
  process.exit(fails ? 1 : 0);
} finally { await browser.close(); await server.close(); }
