import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/* HUG 文本固有宽度跨语言回归（共享根因：水平 HUG owner 必须用渲染后字形固有宽，
   而非钉死 Figma zh-CN 快照的文本框宽）。
   覆盖两个共享同一根因的案例：
     ① 标题装饰组（HORIZONTAL HUG owner + FILL text track + ≥2 固定装饰兄弟）：
        译文变宽 → owner 用 max-content 扩展、装饰按源 itemSpacing 跟随推开；
     ② 黄色觉醒徽章（character-skill-label 紧凑徽章 + HUG owner content-sized）：
        译文变宽 → 黄底 host 扩展、文字始终被包住、居中不错位。
   全程用真实 Chrome 量设计坐标（除 frame fitScale × stage zoom），不看节点 id/文案特例。 */
const demoDir = resolve(process.cwd(), 'demos/yise-ss5-preview');
const artDir = resolve(process.cwd(), 'artifacts/hug-intrinsic');
mkdirSync(artDir, { recursive: true });
const server = createSafeStaticServer(demoDir);
const base = await server.listen();
const { browser } = await launchChromium(demoDir, { headless: true });
const checks = [];
const rec = (n, ok, d) => { checks.push({ n, ok }); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  ' + d : '')); };

// 设计坐标测量：除 frame fitScale x 各祖先 stage zoom 连乘（已内联进各 measure 函数）。

const measureTitleGroup = () => {
  const frame = document.querySelector('.frame');
  const fr = frame.getBoundingClientRect();
  const designW = parseFloat(frame.style.width);
  const frameFit = designW > 0 ? fr.width / designW : 1;
  const host = document.querySelector('[data-auto-layout-hug-fill-fixed-siblings]');
  if (!host) return { why: 'no title-ornament host' };
  let zz = 1, cc = host;
  while (cc && cc !== document.body) { const z2 = parseFloat(cc.style.zoom); if (z2) zz *= z2; cc = cc.parentElement; }
  const e = frameFit * zz;
  const track = host.querySelector('[data-auto-layout-hug-fill-text-track]');
  const hr = host.getBoundingClientRect();
  const tr = track ? track.getBoundingClientRect() : null;
  return {
    hostDesignW: +(hr.width / e).toFixed(1),
    hostMinW: parseFloat(host.style.minWidth) || 0,
    hostStyleW: host.style.width,
    trackDesignW: tr ? +(tr.width / e).toFixed(1) : null,
    trackWhiteSpace: track ? getComputedStyle(track).whiteSpace : null,
    trackLineCount: track ? Math.round((tr.height / e) / (parseFloat(getComputedStyle(track).lineHeight) || 1)) : null,
  };
};

const measureBadge = () => {
  const frame = document.querySelector('.frame');
  const fr = frame.getBoundingClientRect();
  const designW = parseFloat(frame.style.width);
  const frameFit = designW > 0 ? fr.width / designW : 1;
  const t = document.querySelector('.fx-t[data-text-owner-background-sync="padding-flex-centered"]');
  if (!t) return { why: 'no badge' };
  let zz = 1, cc = t;
  while (cc && cc !== document.body) { const z2 = parseFloat(cc.style.zoom); if (z2) zz *= z2; cc = cc.parentElement; }
  const e = frameFit * zz;
  const host = t.parentElement;
  const hr = host.getBoundingClientRect();
  const tr = t.getBoundingClientRect();
  const contained = tr.left >= hr.left - 1 && tr.right <= hr.right + 1 && tr.top >= hr.top - 1 && tr.bottom <= hr.bottom + 1;
  return {
    hostDesignW: +(hr.width / e).toFixed(1),
    hostStyleW: host.style.width,
    hostMinW: parseFloat(host.style.minWidth) || 0,
    textDesignW: +(tr.width / e).toFixed(1),
    contained,
    lineCount: Math.round((tr.height / e) / (parseFloat(getComputedStyle(t).lineHeight) || 1)),
  };
};

const setLang = (l) => {
  const sels = Array.from(document.querySelectorAll('select'));
  for (const s of sels) { const opt = Array.from(s.options).find(o => o.value === l); if (opt) { s.value = opt.value; s.dispatchEvent(new Event('change', { bubbles: true })); return true; } }
  return false;
};

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const perrs = [];
  page.on('pageerror', (e) => perrs.push(String(e && e.message || e).slice(0, 120)));
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => typeof window.__qa === 'object' && window.__qa !== null, null, { timeout: 30000 });
  await page.evaluate(() => typeof window.__fxAssetsReady === 'function' ? window.__fxAssetsReady() : Promise.resolve()).catch(() => {});
  const raf2 = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await raf2(); await raf2();

  // ── ① 标题装饰组跨语言 ──
  const titleByLang = {};
  for (const lang of ['zh-CN', 'en', 'ko']) {
    await page.evaluate(setLang, lang);
    await raf2(); await raf2(); await raf2();
    titleByLang[lang] = await page.evaluate(measureTitleGroup);
  }
  const zh = titleByLang['zh-CN'], en = titleByLang['en'], ko = titleByLang['ko'];
  rec('标题组 zh-CN 用 max-content + 单行 pre', zh.hostStyleW === 'max-content' && zh.trackWhiteSpace === 'pre' && zh.trackLineCount === 1,
    'host=' + zh.hostDesignW + ' ws=' + zh.trackWhiteSpace + ' lines=' + zh.trackLineCount);
  // 更长的语言 host 应扩展（en/ko 译文通常比 zh 长）
  rec('标题组 owner 随更长语言扩展（en > zh）', en.hostDesignW > zh.hostDesignW, 'zh=' + zh.hostDesignW + ' en=' + en.hostDesignW);
  rec('标题组 owner 随更长语言扩展（ko > zh）', ko.hostDesignW > zh.hostDesignW, 'zh=' + zh.hostDesignW + ' ko=' + ko.hostDesignW);
  // 关键：更长语言下 FILL track 不被压回源宽换行（仍单行、pre）
  rec('标题组长语言 FILL track 保持单行 pre（不被钉回源宽换行）', en.trackLineCount === 1 && en.trackWhiteSpace === 'pre',
    'en lines=' + en.trackLineCount + ' ws=' + en.trackWhiteSpace);

  // ── ② 黄色觉醒徽章跨语言 ──
  const badgeByLang = {};
  for (const lang of ['zh-CN', 'ja', 'ko']) {
    await page.evaluate(setLang, lang);
    await raf2(); await raf2(); await raf2();
    badgeByLang[lang] = await page.evaluate(measureBadge);
  }
  const bZh = badgeByLang['zh-CN'], bKo = badgeByLang['ko'];
  rec('徽章 host 用 max-content（弹性）', bZh.hostStyleW === 'max-content', 'hostStyleW=' + bZh.hostStyleW);
  rec('徽章文字始终被黄底包住（zh-CN）', bZh.contained === true, 'hostW=' + bZh.hostDesignW + ' textW=' + bZh.textDesignW);
  rec('徽章文字始终被黄底包住（ko）', bKo.contained === true, 'hostW=' + bKo.hostDesignW + ' textW=' + bKo.textDesignW);
  rec('徽章 ko host 随更长文案扩展（> zh）', bKo.hostDesignW > bZh.hostDesignW, 'zh=' + bZh.hostDesignW + ' ko=' + bKo.hostDesignW);

  // ── ③ 边界：注入超长文案，host 仍弹性包住 ──
  const injected = await page.evaluate(() => {
    const frame = document.querySelector('.frame');
    const fr = frame.getBoundingClientRect();
    const designW = parseFloat(frame.style.width);
    const frameFit = designW > 0 ? fr.width / designW : 1;
    const t = document.querySelector('.fx-t[data-text-owner-background-sync="padding-flex-centered"]');
    if (!t) return { why: 'no badge' };
    let z = 1, cur = t;
    while (cur && cur !== document.body) { const zz = parseFloat(cur.style.zoom); if (zz) z *= zz; cur = cur.parentElement; }
    const eff = frameFit * z;
    const host = t.parentElement;
    const beforeW = host.getBoundingClientRect().width / eff;
    t.textContent = 'Awakened Fully Complete';
    return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const hr = host.getBoundingClientRect();
      const tr = t.getBoundingClientRect();
      const contained = tr.left >= hr.left - 1 && tr.right <= hr.right + 1 && tr.top >= hr.top - 1 && tr.bottom <= hr.bottom + 1;
      res({ beforeW: +beforeW.toFixed(1), afterW: +(hr.width / eff).toFixed(1), contained });
    })));
  });
  rec('注入超长文案 host 弹性扩展且包住文字', injected.afterW > injected.beforeW && injected.contained === true,
    'before=' + injected.beforeW + ' after=' + injected.afterW + ' contained=' + injected.contained);

  // ── ④ 穷尽扫描：五语言下所有徽章文字必须被黄底包住（无溢出/错位）──
  for (const lang of ['zh-CN', 'en', 'ja', 'ko', 'zh-TW']) {
    await page.evaluate(setLang, lang);
    await raf2(); await raf2(); await raf2();
    const rows = await page.evaluate(() => {
      const frame = document.querySelector('.frame');
      const fr = frame.getBoundingClientRect();
      const designW = parseFloat(frame.style.width);
      const frameFit = designW > 0 ? fr.width / designW : 1;
      const out = [];
      document.querySelectorAll('.fx-t[data-text-owner-background-sync="padding-flex-centered"]').forEach((t) => {
        let z = 1, cur = t;
        while (cur && cur !== document.body) { const zz = parseFloat(cur.style.zoom); if (zz) z *= zz; cur = cur.parentElement; }
        const eff = frameFit * z;
        const host = t.parentElement;
        const hr = host.getBoundingClientRect();
        const tr = t.getBoundingClientRect();
        if (hr.width === 0) return;
        const oR = (tr.right - hr.right) / eff, oB = (tr.bottom - hr.bottom) / eff;
        out.push({ bad: oR > 1 || oB > 1, oR: +oR.toFixed(1), oB: +oB.toFixed(1) });
      });
      return out;
    });
    const bad = rows.filter(r => r.bad);
    rec('徽章穷尽扫描 ' + lang + '：全部文字被黄底包住（0 溢出）', rows.length > 0 && bad.length === 0,
      'total=' + rows.length + ' bad=' + bad.length + (bad.length ? ' ' + JSON.stringify(bad) : ''));
  }

  rec('无 pageerror', perrs.length === 0, perrs.join(';').slice(0, 120));

  const fails = checks.filter((c) => !c.ok).length;
  console.log('\n结果: ' + (checks.length - fails) + '/' + checks.length + ' PASS');
  process.exit(fails ? 1 : 0);
} finally { await browser.close(); await server.close(); }
