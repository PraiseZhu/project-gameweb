import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/* 拖拽内容跟随回归（2026-08-11 用户实测 bug：拖到一半右侧内容被裁）。
   断言：指针**仍按住**拖拽中，页面主层内容实时跟随 frame 宽缩放，
   内容右缘始终落在 frame 可视区内（无右侧裁剪），且不触发 DOM 重建。 */
const demoDir = resolve(process.cwd(), 'demos/yise-ss5-preview');
const artDir = resolve(process.cwd(), 'artifacts/drag-follow');
mkdirSync(artDir, { recursive: true });
const server = createSafeStaticServer(demoDir);
const base = await server.listen();
const { browser } = await launchChromium(demoDir, { headless: true });
const checks = [];
const rec = (n, ok, d) => { checks.push({ n, ok }); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  ' + d : '')); };

// 测量：frame 带 transform:scale(fitScale)，getBoundingClientRect 是屏幕坐标，
// 除以 fitScale 还原为设计 CSS 像素，与 frame 的设计宽（style.width）同坐标系比较。
const measure = () => {
  const frame = document.querySelector('.frame');
  if (!frame) return { ok: false, why: 'no frame' };
  const fr = frame.getBoundingClientRect();
  const designW = parseFloat(frame.style.width) || frame.clientWidth;
  const fs = designW > 0 ? (fr.width / designW) : 1;   // frame 的屏幕缩放系数
  const stages = Array.from(frame.querySelectorAll('.fx-stage'));
  if (!stages.length) return { ok: false, why: 'no stage' };
  let contentRight = 0;
  for (const st of stages) {
    const r = st.getBoundingClientRect();
    if (r.width > 0) contentRight = Math.max(contentRight, (r.right - fr.left) / fs);
  }
  return {
    ok: true,
    designW,
    fitScale: +fs.toFixed(4),
    contentRight: +contentRight.toFixed(1),
    overflow: +(contentRight - designW).toFixed(1),  // >0 表示内容超出 frame 右缘（被裁）
    scrollTop: frame.scrollTop,
  };
};

// 在多个中间宽度采样，验证拖拽全程内容都跟随、无裁剪
async function sampleAt(page, targetW, tag) {
  await page.evaluate((tw) => {
    // 直接驱动 resize 到中间态，但保持 dragActive（不触发松手的完整 render 之外的额外动作）
    window.__qa.resize(tw, window.__qa.inspect().viewport.h);
  }, targetW);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const vp = await page.evaluate(() => window.__qa.inspect().viewport.w);
  const m = await page.evaluate(measure);
  return { vp, m, tag };
}

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const perrs = [];
  page.on('pageerror', (e) => perrs.push(String(e && e.message || e).slice(0, 160)));
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => typeof window.__qa === 'object' && window.__qa !== null, null, { timeout: 30000 });
  await page.evaluate(() => typeof window.__fxAssetsReady === 'function' ? window.__fxAssetsReady() : Promise.resolve()).catch(() => {});
  const raf2 = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await raf2(); await raf2();

  const startW = await page.evaluate(() => window.__qa.inspect().viewport.w);
  rec('起点为 PC 模式（宽>=1200）', startW >= 1200, 'startW=' + startW);
  await page.screenshot({ path: artDir + '/before-' + startW + '.png' }).catch(() => {});

  const handle = await page.evaluate(() => {
    const h = document.querySelector('[data-qa-edge-resize]');
    if (!h) return null;
    const r = h.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  rec('存在右缘拖拽把手', !!handle, handle ? ('x=' + handle.x.toFixed(0)) : 'missing');
  const fitScale = await page.evaluate(() => window.__qa.inspect().viewFitScale || 1);

  const targetW = 967;
  const sd = (targetW - startW) * fitScale;
  await page.evaluate(() => {
    window.__dragPerf = { dom: 0 };
    const mo = new MutationObserver((m) => { window.__dragPerf.dom += m.length; });
    mo.observe(document.querySelector('.stage'), { childList: true, subtree: true, attributes: true });
  });

  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(handle.x + (sd * i) / steps, handle.y);
    await page.waitForTimeout(20);
  }
  await raf2();

  const midVp = await page.evaluate(() => window.__qa.inspect().viewport.w);
  const mid = await page.evaluate(measure);
  const domDuring = await page.evaluate(() => window.__dragPerf.dom);
  await page.screenshot({ path: artDir + '/during-pointerdown-' + Math.round(midVp) + '.png' }).catch(() => {});

  rec('拖拽中（指针按住）frame 宽已更新到 ~967', Math.abs(midVp - targetW) <= 30, 'midVp=' + midVp);
  rec('拖拽中内容右缘 ≤ frame 内容区右缘（无右侧裁剪）', mid.ok && mid.overflow <= 4,
    mid.ok ? ('overflow=' + mid.overflow.toFixed(1) + 'px contentRight=' + mid.contentRight.toFixed(0) + ' designW=' + mid.designW.toFixed(0)) : ('why=' + mid.why));
  rec('拖拽中内容宽跟随 frame（内容右缘≈内容区宽）', mid.ok && Math.abs(mid.contentRight - mid.designW) <= 40,
    mid.ok ? ('contentRight=' + mid.contentRight.toFixed(1) + ' designW=' + mid.designW.toFixed(1)) : '');
  rec('拖拽中 DOM 变更数低（轻路径，< 3000）', domDuring < 3000, 'dom=' + domDuring);

  // 同档内多个中间宽度采样：全程无裁剪（同断点档内拖 967→1200→800）
  const sameTier = await sampleAt(page, 1200, 'w1200');
  const sameTier2 = await sampleAt(page, 800, 'w800');
  rec('同档内拖到 1200 无裁剪', sameTier.m.ok && sameTier.m.overflow <= 4, 'overflow=' + (sameTier.m.ok ? sameTier.m.overflow.toFixed(1) : sameTier.m.why));
  rec('同档内拖到 800 无裁剪', sameTier2.m.ok && sameTier2.m.overflow <= 4, 'overflow=' + (sameTier2.m.ok ? sameTier2.m.overflow.toFixed(1) : sameTier2.m.why));

  // 松手：完整 render，终态精确
  await page.mouse.up();
  await raf2(); await raf2(); await raf2();
  const endVp = await page.evaluate(() => window.__qa.inspect().viewport.w);
  const end = await page.evaluate(measure);
  await page.screenshot({ path: artDir + '/after-pointerup-' + Math.round(endVp) + '.png' }).catch(() => {});
  rec('松手后终态宽=800', Math.abs(endVp - 800) <= 6, 'endVp=' + endVp);
  rec('松手后内容右缘 ≤ frame 内容区右缘（精确终态无裁剪）', end.ok && end.overflow <= 4,
    end.ok ? ('overflow=' + end.overflow.toFixed(1) + 'px') : ('why=' + end.why));

  rec('无 pageerror', perrs.length === 0, perrs.join(';').slice(0, 160));

  const fails = checks.filter((c) => !c.ok).length;
  console.log('\n结果: ' + (checks.length - fails) + '/' + checks.length + ' PASS');
  console.log('证据目录: ' + artDir);
  process.exit(fails ? 1 : 0);
} finally { await browser.close(); await server.close(); }
