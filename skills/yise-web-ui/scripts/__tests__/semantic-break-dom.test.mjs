// semantic-break-dom.test.mjs — 已批准日语语义换行的「当前 DOM + 截图」回归。【通用 Skill 层】
//
// 背景：fixture 存在 / 单测通过 ≠ 验收通过。本测试在**当前 index.html** 的真实 Chromium DOM 里
// 断言两条已批准的 ja 换行确实渲染（pre-wrap + \n 两行 + approved provenance + 可见），
// 并留截图证据。缺 demo / playwright / Chrome 时 fail-closed 跳过（记为环境前置，不伪造通过）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(here, '..', '..');
const DEMO = process.env.QA_DEMO_DIR || join(SKILL, 'demos', 'yise-ss5-preview');
const MODULE_ROOT = process.env.QA_HIFI_MODULE_ROOT || null; // 装了 playwright-core 的项目
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOT_DIR = process.env.QA_ARTIFACT_ROOT || join(SKILL, 'artifacts');

const INDEX = join(DEMO, 'index.html');
const HAS_DEMO = existsSync(INDEX);
const HAS_PW = !!MODULE_ROOT && existsSync(join(MODULE_ROOT, 'node_modules', 'playwright-core'));
const HAS_CHROME = existsSync(CHROME);
const CAN_RUN = HAS_DEMO && HAS_PW && HAS_CHROME;
if (!CAN_RUN) {
  console.log('[skip] semantic-break-dom: 需要 当前 index.html（QA_DEMO_DIR）+ playwright-core（QA_HIFI_MODULE_ROOT）+ 本机 Chrome（CHROME_PATH）；三者缺一即 fail-closed 跳过，不伪造 DOM 证据。'
    + ` demo=${HAS_DEMO} pw=${HAS_PW} chrome=${HAS_CHROME}`);
}

const WANT = [
  { needle: 'シーズン開始・', line2: 'ドロップ2倍特典' },
  { needle: 'クリスタル', line2: '初回購入2倍ボーナス' },
];

test('当前 DOM 渲染两条已批准 ja 语义换行（pre-wrap 两行 + approved provenance + 可见）+ 截图证据', { skip: !CAN_RUN }, async () => {
  const pw = await import(pathToFileURL(join(MODULE_ROOT, 'node_modules', 'playwright-core', 'index.mjs')).href);
  const ss = await import(pathToFileURL(join(SKILL, 'scripts', 'lib', 'safe-server.mjs')).href);
  const server = ss.createSafeStaticServer(DEMO);
  const base = await server.listen();
  const browser = await pw.chromium.launch({ executablePath: CHROME, headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base.replace(/\/$/, '') + '/index.html', { waitUntil: 'load', timeout: 60000 });
    await page.evaluate(() => { if (window.__qa && window.__qa.setPref) window.__qa.setPref('lang', 'ja'); });
    await page.waitForTimeout(900);
    const els = await page.evaluate(() => Array.from(document.querySelectorAll('[data-semantic-break-lines]')).map((el) => ({
      text: el.textContent || '',
      lines: el.getAttribute('data-semantic-break-lines'),
      prov: el.getAttribute('data-semantic-break-provenance'),
      whiteSpace: getComputedStyle(el).whiteSpace,
      visible: el.offsetHeight > 0,
    })));
    for (const w of WANT) {
      const hit = els.find((e) => e.text.includes(w.needle));
      assert.ok(hit, `当前 DOM 缺已批准换行元素（含「${w.needle}」）——semanticLayout 未落到渲染层`);
      assert.equal(hit.lines, '2', `「${w.needle}」应为两行`);
      assert.ok(hit.text.includes('\n') && hit.text.includes(w.line2), `「${w.needle}」应在「${w.line2}」前断行`);
      assert.equal(hit.whiteSpace, 'pre-wrap', `「${w.needle}」whiteSpace 应为 pre-wrap`);
      assert.equal(hit.prov, 'user-provided-official-visual-reference', `「${w.needle}」provenance 应为已批准视觉参考`);
      assert.ok(hit.visible, `「${w.needle}」应可见`);
    }
    // 截图证据（当前 DOM，而非历史图）
    mkdirSync(SHOT_DIR, { recursive: true });
    const first = await page.$('[data-semantic-break-lines]');
    if (first) { await first.scrollIntoViewIfNeeded(); await page.waitForTimeout(300); }
    await page.screenshot({ path: join(SHOT_DIR, 'ja-semantic-break-dom.png') });
    assert.deepEqual(errors, [], '页面不应有 pageerror');
  } finally {
    await browser.close();
    try { await server.close(); } catch {}
  }
});
