import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* 最终响应式/设备验收（2026-08-12）。
   覆盖 PC / iPhone / Android / iPad / 折叠屏 preset + 直拉对比 + 拖拽跟随。
   断言：iPad 用窄桌面 composition（不塌成竖列）；mobile 不塌陷；整页不全局横滚
   （仅组件级 overflow）；无 pageerror。 */
const demoDir = resolve(process.cwd(), 'demos/yise-ss5-preview');
const artDir = resolve(process.cwd(), 'artifacts/responsive-acceptance');
mkdirSync(artDir, { recursive: true });
const server = createSafeStaticServer(demoDir);
const base = await server.listen();
const { browser } = await launchChromium(demoDir, { headless: true });
const checks = [];
const rec = (n, ok, d) => { checks.push({ n, ok }); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  ' + d : '')); };

const setLang = (l) => {
  const sels = Array.from(document.querySelectorAll('select'));
  for (const s of sels) { const opt = Array.from(s.options).find(o => o.value === l); if (opt) { s.value = opt.value; s.dispatchEvent(new Event('change', { bubbles: true })); return; } }
};

// 测量：整页是否全局横滚 + 内容是否塌陷 + 平台 + 关键几何
const measure = () => {
  const frame = document.querySelector('.frame');
  const fr = frame.getBoundingClientRect();
  const designW = parseFloat(frame.style.width);
  const frameFit = designW > 0 ? fr.width / designW : 1;
  // 整页横滚：frame.scrollWidth > frame.clientWidth 即横向溢出
  const globalHscroll = frame.scrollWidth > frame.clientWidth + 1;
  // 内容塌陷检测：最宽内容元素宽（设计坐标）是否远小于 frame 宽（竖条化）
  let maxContentW = 0;
  document.querySelectorAll('.fx-stage').forEach((st) => {
    let z = 1, cur = st;
    while (cur && cur !== document.body) { const zz = parseFloat(cur.style.zoom); if (zz) z *= zz; cur = cur.parentElement; }
    const eff = frameFit * z;
    const w = st.getBoundingClientRect().width / eff;
    if (w > maxContentW) maxContentW = w;
  });
  return {
    viewport: window.__qa.inspect().viewport,
    plat: window.__qa.prefs().plat,
    globalHscroll,
    frameScrollW: frame.scrollWidth, frameClientW: frame.clientWidth,
    maxContentW: Math.round(maxContentW),
    frameDesignW: designW,
    scrollTop: frame.scrollTop,
    scrollHeight: frame.scrollHeight,
  };
};

const presets = [
  { name: 'PC-1920', w: 1920, h: 1080, expectPlat: 'pc' },
  { name: 'iPhone-390', w: 390, h: 844, expectPlat: 'mobile' },
  { name: 'Android-412', w: 412, h: 915, expectPlat: 'mobile' },
  { name: 'iPad-768', w: 768, h: 1024, expectPlat: 'pad' },
  { name: 'Fold-344', w: 344, h: 882, expectPlat: 'mobile' },
];

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const perrs = [];
  page.on('pageerror', (e) => perrs.push(String(e && e.message || e).slice(0, 120)));
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => typeof window.__qa === 'object' && window.__qa !== null, null, { timeout: 30000 });
  const raf2 = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await raf2(); await raf2();

  const results = {};
  for (const p of presets) {
    await page.evaluate((dim) => window.__qa.resize(dim.w, dim.h), { w: p.w, h: p.h });
    await raf2(); await raf2(); await raf2();
    const m = await page.evaluate(measure);
    results[p.name] = m;
    // 截图（滚到顶部）
    await page.evaluate(() => { document.querySelector('.frame').scrollTop = 0; });
    await raf2();
    await page.screenshot({ path: artDir + '/' + p.name + '.png' }).catch(() => {});
    // 断言
    rec(p.name + ' 平台=' + p.expectPlat, m.plat === p.expectPlat, 'got=' + m.plat + '@' + m.viewport.w);
    rec(p.name + ' 整页无全局横滚', !m.globalHscroll, 'scrollW=' + m.frameScrollW + ' clientW=' + m.frameClientW);
    rec(p.name + ' 内容未塌陷（最宽内容>=frame宽的40%）', m.maxContentW >= m.frameDesignW * 0.4,
      'maxContentW=' + m.maxContentW + ' frameW=' + m.frameDesignW);
  }

  // iPad 特殊断言：必须走窄桌面 composition（不是 mobile stack）。
  // 证据：iPad-768 的 maxContentW 应接近桌面布局的内容宽（>=500 设计px），而非 mobile 竖条。
  const ipad = results['iPad-768'];
  const iphone = results['iPhone-390'];
  rec('iPad-768 用窄桌面 composition（内容宽明显大于 mobile 竖条）',
    ipad.maxContentW >= 500 && ipad.maxContentW > iphone.maxContentW * 1.2,
    'ipad=' + ipad.maxContentW + ' iphone=' + iphone.maxContentW);

  // ── 拖拽跟随（renderer 变更后）：PC 拖到 iPad 尺寸，指针按住时无右侧裁剪 ──
  await page.evaluate(() => window.__qa.resize(1920, 1080));
  await raf2(); await raf2();
  const handle = await page.evaluate(() => {
    const h = document.querySelector('[data-qa-edge-resize]');
    if (!h) return null;
    const r = h.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (handle) {
    const fitScale = await page.evaluate(() => window.__qa.inspect().viewFitScale || 1);
    const targetW = 768;
    const sd = (targetW - 1920) * fitScale;
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(handle.x + (sd * i) / 10, handle.y); await page.waitForTimeout(18); }
    await raf2();
    const mid = await page.evaluate(() => {
      const frame = document.querySelector('.frame');
      const fr = frame.getBoundingClientRect();
      const designW = parseFloat(frame.style.width);
      const fs = designW > 0 ? fr.width / designW : 1;
      let contentRight = 0;
      document.querySelectorAll('.fx-stage').forEach((st) => {
        const r = st.getBoundingClientRect();
        if (r.width > 0) contentRight = Math.max(contentRight, (r.right - fr.left) / fs);
      });
      return { vp: window.__qa.inspect().viewport.w, contentRight: +contentRight.toFixed(1), designW, overflow: +(contentRight - designW).toFixed(1) };
    });
    await page.screenshot({ path: artDir + '/drag-mid-768.png' }).catch(() => {});
    await page.mouse.up();
    await raf2(); await raf2();
    rec('拖拽到 768 中间态内容无右侧裁剪', mid.overflow <= 4, 'overflow=' + mid.overflow + ' contentRight=' + mid.contentRight + ' designW=' + mid.designW);
  } else {
    rec('存在拖拽把手', false, 'missing');
  }

  rec('无 pageerror', perrs.length === 0, perrs.join(';').slice(0, 120));

  writeFileSync(artDir + '/results.json', JSON.stringify(results, null, 2));
  const fails = checks.filter((c) => !c.ok).length;
  console.log('\n结果: ' + (checks.length - fails) + '/' + checks.length + ' PASS');
  console.log('证据目录: ' + artDir);
  process.exit(fails ? 1 : 0);
} finally { await browser.close(); await server.close(); }
