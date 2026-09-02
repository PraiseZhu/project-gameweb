// replay-pref-resolution.test.mjs — 偏好切换的候选/回退解析(2026-08-14 GPT-5.4 review fix)。
//
// 覆盖三处行为:
//   ① 页面提供了可见 os/mode 真实按钮 → applyCase 点真实入口,setPref 不被调用;
//   ② 页面没有真实控件 → applyCase 回退 __qa.setPref;连 setPref 也没有 → 报错;
//   ③ 页面同时存在隐藏 select 与可见语言按钮 → clickPref 优先按钮,不卡死在隐藏 select;
//      (对照:只有可见 select 时回退 selectOption 仍正常 —— SS5 现状路径)。
// 集成用例需要真 playwright(产品仓 node_modules),无 QA_HIFI_MODULE_ROOT 时 skip;
// 源码契约断言不 skip,任何环境都锁住「按钮优先、select 回退、setPref 兜底」的次序。

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';
import { applyCase, clickPref } from '../lib/replay.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const REPLAY = join(ROOT, 'scripts/lib/replay.mjs');
const MODULE_ROOT = process.env.QA_HIFI_MODULE_ROOT;
const NEEDS_BROWSER = '需要真 playwright(产品仓 node_modules)';

/* 最小自证页面:__qa 五要素 + 可选 setPref + 按 needs 注入的控件。 */
const PAGE_TEMPLATE = ({ controls = '', setPrefImpl = true }) => `<!doctype html><html><body>
${controls}
<script>
window.__setPrefCalls = 0;
window.__clicked = Object.create(null);
window.__qa = {
  current: () => 'id',
  goto: (id) => { if (id !== 'id') throw new Error('unknown'); },
  prefs: () => ({ plat: window.__p.plat, region: window.__p.region, os: window.__p.os, mode: window.__p.mode, lang: window.__p.lang }),
  scale: () => 1,
  ${setPrefImpl ? `setPref: (k, v) => { window.__setPrefCalls++; if (k === 'os' || k === 'mode' || k === 'lang') window.__p[k] = v; },` : ''}
};
window.__p = { plat: 'desk', region: 'cn', os: 'ios', mode: 'light', lang: 'zh-CN' };
</script></body></html>`;

async function openPage(bodyHtml) {
  const dir = mkdtempSync(join(tmpdir(), 'qa-replay-pref-'));
  writeFileSync(join(dir, 'index.html'), bodyHtml);
  const server = createSafeStaticServer(dir);
  const base = await server.listen();
  const { browser } = await launchChromium(dir, { headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__qa === 'object' && typeof window.__qa.current === 'function', undefined, { timeout: 5000 });
  return { page, server, browser };
}

async function closeAll({ page, server, browser }) {
  try { await page.close(); } catch {}
  try { await browser.close(); } catch {}
  try { await server.close(); } catch {}
}

/* ==================== ① 可见 os 按钮优先于 setPref ==================== */

test('applyCase os:页面有可见按钮 → 点真实入口,setPref 不被调用(集成)', async (t) => {
  if (!MODULE_ROOT) return t.skip(NEEDS_BROWSER);
  const controls = `
<button id="os-android" data-qa-pref="os:android">Android</button>
<script>
document.getElementById('os-android').addEventListener('click', () => { window.__p.os = 'android'; window.__clicked.osAndroid = true; });
</script>`;
  const ctx = await openPage(PAGE_TEMPLATE({ controls }));
  try {
    await applyCase(ctx.page, { prefs: { os: 'android' } });
    const state = await ctx.page.evaluate(() => ({ os: window.__p.os, clicked: window.__clicked.osAndroid === true, setPrefCalls: window.__setPrefCalls }));
    assert.equal(state.os, 'android');
    assert.equal(state.clicked, true, '可见按钮必须被真实点击');
    assert.equal(state.setPrefCalls, 0, '存在可见入口时不许绕过 DOM 直写 setPref');
  } finally { await closeAll(ctx); }
});

test('applyCase mode:可见主题按钮同样优先点入口(集成)', async (t) => {
  if (!MODULE_ROOT) return t.skip(NEEDS_BROWSER);
  const controls = `
<button data-pref-key="mode" data-pref-value="dark">Dark</button>
<script>
document.querySelector('[data-pref-key="mode"]').addEventListener('click', () => { window.__p.mode = 'dark'; });
</script>`;
  const ctx = await openPage(PAGE_TEMPLATE({ controls }));
  try {
    await applyCase(ctx.page, { prefs: { mode: 'dark' } });
    const state = await ctx.page.evaluate(() => ({ mode: window.__p.mode, setPrefCalls: window.__setPrefCalls }));
    assert.equal(state.mode, 'dark');
    assert.equal(state.setPrefCalls, 0);
  } finally { await closeAll(ctx); }
});

/* ==================== ② 无可见控件 → setPref 回退 / 都没有 → 报错 ==================== */

test('applyCase os:无可见控件 → 回退 __qa.setPref 正常(集成)', async (t) => {
  if (!MODULE_ROOT) return t.skip(NEEDS_BROWSER);
  const ctx = await openPage(PAGE_TEMPLATE({}));
  try {
    await applyCase(ctx.page, { prefs: { os: 'android' } });
    const state = await ctx.page.evaluate(() => ({ os: window.__p.os, setPrefCalls: window.__setPrefCalls }));
    assert.equal(state.os, 'android');
    assert.equal(state.setPrefCalls, 1);
  } finally { await closeAll(ctx); }
});

test('applyCase os:无可见控件且无 setPref → 明确报错(集成)', async (t) => {
  if (!MODULE_ROOT) return t.skip(NEEDS_BROWSER);
  const ctx = await openPage(PAGE_TEMPLATE({ setPrefImpl: false }));
  try {
    await assert.rejects(
      applyCase(ctx.page, { prefs: { os: 'android' } }),
      /无法设置无视觉维度 os=android.*setPref 未实现/,
    );
  } finally { await closeAll(ctx); }
});

/* ==================== ③ 隐藏 select + 可见按钮 / 只有可见 select ==================== */

test('clickPref lang:隐藏 select + 可见按钮 → 点按钮,不卡死在隐藏 select(集成)', async (t) => {
  if (!MODULE_ROOT) return t.skip(NEEDS_BROWSER);
  const controls = `
<select data-qa-pref-key="lang" style="display:none"><option value="en">EN</option></select>
<button data-qa-pref="lang:en">English</button>
<script>
document.querySelector('[data-qa-pref="lang:en"]').addEventListener('click', () => { window.__p.lang = 'en'; window.__clicked.langBtn = true; });
</script>`;
  const ctx = await openPage(PAGE_TEMPLATE({ controls }));
  try {
    await clickPref(ctx.page, 'lang', 'en');
    const state = await ctx.page.evaluate(() => ({ lang: window.__p.lang, clicked: window.__clicked.langBtn === true }));
    assert.equal(state.lang, 'en');
    assert.equal(state.clicked, true, '必须走可见按钮而非隐藏 select');
  } finally { await closeAll(ctx); }
});

test('clickPref lang:只有可见 select → selectOption 回退照常(SS5 现状路径,集成)', async (t) => {
  if (!MODULE_ROOT) return t.skip(NEEDS_BROWSER);
  const controls = `
<select data-qa-pref-key="lang" onchange="window.__p.lang = this.value"><option value="zh-CN">中文</option><option value="en">EN</option></select>`;
  const ctx = await openPage(PAGE_TEMPLATE({ controls }));
  try {
    await clickPref(ctx.page, 'lang', 'en');
    const state = await ctx.page.evaluate(() => ({ lang: window.__p.lang }));
    assert.equal(state.lang, 'en');
  } finally { await closeAll(ctx); }
});

test('clickPref:隐藏 select 且无可见按钮 → 明确报错而非静默(集成)', async (t) => {
  if (!MODULE_ROOT) return t.skip(NEEDS_BROWSER);
  const controls = `
<select data-qa-pref-key="lang" style="display:none"><option value="en">EN</option></select>`;
  const ctx = await openPage(PAGE_TEMPLATE({ controls }));
  try {
    await assert.rejects(clickPref(ctx.page, 'lang', 'en'), /无法通过可交互 DOM 入口切换偏好 lang=en/);
  } finally { await closeAll(ctx); }
});

/* ==================== 源码契约(不 skip) ==================== */

test('源码契约:按钮候选 → select 回退 → setPref 兜底的次序写死在 replay.mjs', () => {
  const src = readFileSync(REPLAY, 'utf8');
  /* tryPrefViaDom 内部:firstActionable(按钮候选) 必须先于 select 分支 */
  const dom = src.slice(src.indexOf('async function tryPrefViaDom'));
  assert.ok(dom.indexOf('firstActionable(page, prefCandidates(key, value))') < dom.indexOf('select[data-qa-pref-key='), '按钮候选必须排在 select 之前');
  assert.match(dom, /if \(!\(await isRenderable\(select\)\)\) return false;/, '回退 select 必须先过可见/可交互校验(隐藏 select 直接判无入口)');
  /* applyCase os/mode:DOM 优先,setPref 是回退而不是唯一通道 */
  const osLoop = src.slice(src.indexOf("for (const key of ['os', 'mode'])"));
  assert.ok(osLoop.indexOf('await tryPrefViaDom(page, key, value)') < osLoop.indexOf('window.__qa.setPref'), 'setPref 必须是 DOM 入口之后的回退');
  assert.match(osLoop, /setPref 未实现/, '两者都没有时必须点名 setPref 缺失的报错');
  /* clickPref 不再直接 selectOption(不经过可见性校验的直写路径必须消失) */
  const clickPrefSrc = src.slice(src.indexOf('export async function clickPref'));
  assert.ok(!/selectOption/.test(clickPrefSrc.split('export async function applyCase')[0]), 'clickPref 本体不得残留未经可见性校验的 selectOption');
});
