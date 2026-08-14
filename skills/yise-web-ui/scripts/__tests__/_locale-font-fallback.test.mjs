import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';
import { resolve } from 'node:path';

/* 缺译文本字体回退回归（2026-08-12）。
   规则：采用真实译文 → 走 locale 字体路由；缺译回退显示源 Figma 原文（多为中文）
   → 必须保留源 Figma family/weight，不得按当前 locale 路由（否则用拉丁/日文字体
   渲染中文字形，回退字体与源 Alimama ShuHeiTi 视觉不一致，09 标题即此错）。
   通用、不看文案/node id。 */
const demoDir = resolve(process.cwd(), 'demos/yise-ss5-preview');
const server = createSafeStaticServer(demoDir);
const base = await server.listen();
const { browser } = await launchChromium(demoDir, { headless: true });
const checks = [];
const rec = (n, ok, d) => { checks.push({ n, ok }); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  ' + d : '')); };

const setLang = (l) => {
  const sels = Array.from(document.querySelectorAll('select'));
  for (const s of sels) { const opt = Array.from(s.options).find(o => o.value === l); if (opt) { s.value = opt.value; s.dispatchEvent(new Event('change', { bubbles: true })); return; } }
};

// 收集：缺译且显示中文的文本的字体（应含源家族，不应是 locale 路由）
const scanMissing = () => {
  const out = [];
  document.querySelectorAll('.fx-t[data-copy-missing]').forEach((t) => {
    const str = (t.textContent || '').trim();
    if (!/[\u4e00-\u9fff]/.test(str)) return;
    const fam = getComputedStyle(t).fontFamily;
    const sourceFam = /Alimama|FontquanXinYiGuanHeiTi/i.test(fam);
    out.push({
      str: str.slice(0, 12),
      family: fam.split(',')[0],
      sourceFam,
      fallback: t.getAttribute('data-font-source-fallback'),
      wronglyRouted: t.hasAttribute('data-font-routed'),
    });
  });
  return out;
};

// 收集：采用翻译（非缺译）的文本是否仍走 locale 路由
const scanAdopted = () => {
  const out = [];
  document.querySelectorAll('.fx-t[data-font-routed]').forEach((t) => {
    if (t.hasAttribute('data-copy-missing')) return;
    const str = (t.textContent || '').trim();
    if (!str) return;
    out.push({ str: str.slice(0, 14), family: getComputedStyle(t).fontFamily.split(',')[0] });
  });
  return out;
};

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const perrs = [];
  page.on('pageerror', (e) => perrs.push(String(e && e.message || e).slice(0, 120)));
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => typeof window.__qa === 'object' && window.__qa !== null, null, { timeout: 30000 });
  const raf2 = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await raf2(); await raf2();

  // ── 非 zh-CN：缺译中文文本必须保留源字体，不路由到 locale 字体 ──
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    await page.evaluate(setLang, lang);
    await raf2(); await raf2(); await raf2();
    const rows = await page.evaluate(scanMissing);
    const wrong = rows.filter(r => !r.sourceFam || r.wronglyRouted);
    rec(lang + ' 缺译中文文本保留源字体（Alimama/Fontquan），不路由 locale', rows.length > 0 && wrong.length === 0,
      'total=' + rows.length + ' wrong=' + wrong.length + (wrong.length ? ' ' + JSON.stringify(wrong[0]) : ''));
    const noFallbackAttr = rows.filter(r => !r.fallback);
    rec(lang + ' 缺译中文文本打 source-fallback 留痕', noFallbackAttr.length === 0, 'missing-attr=' + noFallbackAttr.length);
  }

  // ── 采用翻译的文本仍正确走 locale 路由（不被回退破坏）──
  for (const lang of ['en', 'ja']) {
    await page.evaluate(setLang, lang);
    await raf2(); await raf2(); await raf2();
    const rows = await page.evaluate(scanAdopted);
    const expectFam = lang === 'en' ? /Noto Sans|Bebas/i : /Noto Sans JP/i;
    const wrong = rows.filter(r => !expectFam.test(r.family));
    rec(lang + ' 采用翻译文本仍走 locale 路由', rows.length > 0 && wrong.length === 0,
      'total=' + rows.length + ' wrong=' + wrong.length + (wrong.length ? ' ' + JSON.stringify(wrong[0]) : ''));
  }

  // ── zh-CN 源语言：不应有 source-fallback 误标 ──
  await page.evaluate(setLang, 'zh-CN');
  await raf2(); await raf2();
  const zhFallback = await page.evaluate(() => document.querySelectorAll('.fx-t[data-font-source-fallback]').length);
  rec('zh-CN 无 source-fallback 误标（源语言恒等）', zhFallback === 0, 'count=' + zhFallback);

  rec('无 pageerror', perrs.length === 0, perrs.join(';').slice(0, 120));

  const fails = checks.filter((c) => !c.ok).length;
  console.log('\n结果: ' + (checks.length - fails) + '/' + checks.length + ' PASS');
  process.exit(fails ? 1 : 0);
} finally { await browser.close(); await server.close(); }
