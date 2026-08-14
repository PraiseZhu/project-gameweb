import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';
import { resolve } from 'node:path';

/* More 按钮 / 左导航 / 日语语义换行 证据门回归（2026-08-12）。
   - More 按钮（node 1:849）：全语言有官方 Lark 译文，必须采用、无缺译。
   - 左导航「新源器/rta/体验优化」：Lark 表未收录（copy.byNode 无行），
     是证据缺口，按铁律不猜译 —— 保留 Figma 原文 + data-copy-missing，
     并已登记进 copy-designations.pendingOperations。
   - 日语 02/03 卡片标题语义换行（node 14:51265/14:51271）：
     源自用户批准的官方日语视觉参考，必须按批准断行渲染成两行。 */
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

const moreText = () => {
  const t = Array.from(document.querySelectorAll('.fx-t')).find(x => (x.getAttribute('data-node') || '') === '1:849');
  return t ? { str: (t.textContent || '').trim(), missing: t.getAttribute('data-copy-missing') } : null;
};

const navMissing = () => {
  const out = [];
  document.querySelectorAll('.fx-t[data-text-role="nav"][data-copy-missing]').forEach((t) => {
    out.push({ str: (t.textContent || '').trim(), parentId: t.getAttribute('data-text-parent-id') });
  });
  return out;
};

const semanticNode = (nid) => {
  const t = Array.from(document.querySelectorAll('.fx-t')).find(x => (x.getAttribute('data-node') || '') === nid);
  if (!t) return null;
  return {
    str: t.textContent || '',
    breakLines: t.getAttribute('data-semantic-break-lines'),
    layoutPolicy: t.getAttribute('data-text-layout-policy'),
    whiteSpace: getComputedStyle(t).whiteSpace,
  };
};

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const perrs = [];
  page.on('pageerror', (e) => perrs.push(String(e && e.message || e).slice(0, 120)));
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => typeof window.__qa === 'object' && window.__qa !== null, null, { timeout: 30000 });
  const raf2 = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await raf2(); await raf2();

  // ── More 按钮：全语言采用官方译文，无缺译 ──
  const expectMore = { 'zh-CN': '更多', 'en': 'More', 'ja': 'さらに', 'ko': '더 보기', 'zh-TW': '更多' };
  for (const lang of Object.keys(expectMore)) {
    await page.evaluate(setLang, lang);
    await raf2(); await raf2(); await raf2();
    const m = await page.evaluate(moreText);
    rec('More 按钮 ' + lang + ' 采用官方译文「' + expectMore[lang] + '」无缺译',
      m && m.str === expectMore[lang] && !m.missing, m ? ('got「' + m.str + '」missing=' + m.missing) : 'node not found');
  }

  // ── 左导航缺译项：保留原文 + data-copy-missing（不猜译）──
  for (const lang of ['zh-CN', 'en', 'ja']) {
    await page.evaluate(setLang, lang);
    await raf2(); await raf2(); await raf2();
    const rows = await page.evaluate(navMissing);
    const strs = rows.map(r => r.str);
    // 三个缺译项必须仍在缺译状态（保留原文，未被猜译成别的）
    const expected = ['新源器', 'rta', '体验优化'];
    const allPresent = expected.every(e => strs.includes(e));
    rec('左导航缺译项 ' + lang + ' 保留原文+缺译标记（未猜译）', allPresent,
      'missing=[' + strs.join(',') + ']');
  }

  // ── 日语语义换行：node 14:51265/14:51271 按批准断行 ──
  await page.evaluate(setLang, 'ja');
  await raf2(); await raf2(); await raf2();
  const s1 = await page.evaluate(semanticNode, '14:51265');
  const s2 = await page.evaluate(semanticNode, '14:51271');
  rec('ja 14:51265 语义换行为 2 行（シーズン開始・\\nドロップ2倍特典）',
    s1 && s1.breakLines === '2' && s1.str.includes('\n') && s1.layoutPolicy === 'semantic-explicit-break',
    s1 ? ('breaks=' + s1.breakLines + ' ws=' + s1.whiteSpace) : 'node not found');
  rec('ja 14:51271 语义换行为 2 行（クリスタル\\n初回購入2倍ボーナス）',
    s2 && s2.breakLines === '2' && s2.str.includes('\n') && s2.layoutPolicy === 'semantic-explicit-break',
    s2 ? ('breaks=' + s2.breakLines + ' ws=' + s2.whiteSpace) : 'node not found');

  rec('无 pageerror', perrs.length === 0, perrs.join(';').slice(0, 120));

  const fails = checks.filter((c) => !c.ok).length;
  console.log('\n结果: ' + (checks.length - fails) + '/' + checks.length + ' PASS');
  process.exit(fails ? 1 : 0);
} finally { await browser.close(); await server.close(); }
