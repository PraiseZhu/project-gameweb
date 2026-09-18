import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { launchChromium } from '../lib/resolve-playwright.mjs';
import { DESIGN_POLICY } from '../lib/design-policy.generated.mjs';

const skillRoot = resolve(import.meta.dirname, '../..');
const repoRoot = resolve(skillRoot, '../..');
const artifacts = join(repoRoot, '_tmp', 'qa-comments-browser');

const inlineSafe = (source) => source.replace(/<\/script/gi, '<\\/script');

function fixture({ chrome, devices, policy }) {
  const truth = {
    design: { fileVersion: 'qa-comments-shell-fixture' },
    platforms: { pc: true, mobile: true },
  };
  const config = [
    'window.__qaDemo = {',
    "  name: 'qa-comments-shell-fixture',",
    "  title: 'QA 评论壳集成示例',",
    "  summary: { what: '完整壳评论集成测试', how: '真实 data-node PC／mobile 树', accept: '浏览器内验证评论导航' },",
    '  matrix: {',
    "    plat: { label: '端', options: [{ v: 'desktop', label: '桌面' }, { v: 'mobile', label: '移动' }] },",
    "    region: { label: '区域', options: [{ v: 'global', label: 'Global' }, { v: 'cn', label: '中国大陆' }] },",
    "    os: { label: '系统', options: [{ v: 'mac', label: 'macOS' }] },",
    "    mode: { label: '主题', options: [{ v: 'light', label: '浅色' }] },",
    "    lang: { label: '语言', options: [{ v: 'en', label: 'English' }, { v: 'ja', label: '日本語' }] },",
    '  },',
    "  defaultPrefs: { plat: 'desktop', region: 'global', os: 'mac', mode: 'light', lang: 'en' },",
    "  initialState: 'home',",
    "  states: { home: { label: '首页' }, details: { label: '详情' } },",
    '  tabStates: [],',
    '  renderApp: function (ctx) {',
    "    var mobile = ctx.prefs.plat === 'mobile';",
    "    var copy = ctx.prefs.lang === 'ja' ? (mobile ? 'モバイルの確認コメント' : 'デスクトップの確認コメント') : (mobile ? 'Mobile review target' : 'Desktop review target');",
    "    var root = document.createElement('main');",
    "    root.className = 'shell-fixture ' + (mobile ? 'shell-mobile' : 'shell-pc');",
    "    root.innerHTML = mobile ? '<section data-node=\\\"mobile-shell\\\" data-node-name=\\\"移动页面\\\"><article data-node=\\\"mobile-card\\\" data-node-name=\\\"移动卡片\\\"><p data-node=\\\"mobile-copy\\\" data-node-name=\\\"移动文案\\\">' + copy + '</p><button data-node=\\\"mobile-action\\\" data-node-name=\\\"移动按钮\\\">继续</button></article></section>' : '<section data-node=\\\"pc-shell\\\" data-node-name=\\\"桌面页面\\\"><article data-node=\\\"pc-card\\\" data-node-name=\\\"桌面卡片\\\"><p data-node=\\\"pc-copy\\\" data-node-name=\\\"桌面文案\\\">' + copy + '</p><button data-node=\\\"pc-action\\\" data-node-name=\\\"桌面按钮\\\">Continue</button></article></section>';",
    '    ctx.frame.replaceChildren(root);',
    '  },',
    '};',
  ].join('\n');
  return [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>QA 评论壳集成示例</title>',
    '<style>body{margin:0;background:#111827;color:#e5e7eb;font:16px/1.5 system-ui,sans-serif}.shell-fixture{min-height:1100px;padding:72px 56px;background:linear-gradient(145deg,#172554,#0f172a)}.shell-fixture section{padding:36px;background:#1e3a5f;border:2px solid #60a5fa;border-radius:16px;min-height:420px}.shell-fixture article{padding:34px;background:#264b73;border-radius:12px;min-height:260px}.shell-fixture p{display:block;width:520px;min-height:78px;margin:0 0 48px;font-size:30px;line-height:1.35}.shell-fixture button{width:220px;height:48px;font:inherit;color:#fff;background:#2563eb;border:0;border-radius:8px}.shell-mobile{padding:34px 22px}.shell-mobile section{padding:22px;min-height:700px}.shell-mobile article{padding:22px;min-height:420px}.shell-mobile p{width:260px;font-size:24px}</style>',
    '<script id="qa-truth" type="application/json">', JSON.stringify(truth).replace(/<\/script/gi, '<\\/script'), '</script>',
    '<script id="qa-devices" type="application/json">', devices, '</script>',
    '<script id="qa-design-policy" type="application/json">', JSON.stringify(policy), '</script>',
    '<script>window.__designPolicy=', JSON.stringify(policy), ';</script>',
    '<script>', config, '</script>',
    '</head><body></body><script>', inlineSafe(chrome), '</script></html>',
  ].join('');
}

async function waitReady(page) {
  await page.waitForFunction(() => typeof window.__qa === 'object' && document.querySelector('.qc-toolbar'));
  await page.waitForFunction(() => !document.querySelector('.qc-panel')?.textContent.includes('正在打开本地评论库'));
}

async function visiblePins(page, expected) {
  await page.waitForFunction((n) => document.querySelectorAll('.qc-pin:not([hidden])').length === n, expected, { timeout: 6000 });
}

async function publish(page, text = '壳评论集成检查') {
  await page.getByRole('button', { name: '评论：点选或框选内容', exact: true }).click();
  const target = page.locator('[data-node="pc-copy"]');
  const box = await target.boundingBox();
  assert.ok(box, 'PC data-node should be visible before publishing');
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.35);
  await page.locator('.qc-pop textarea').waitFor({ state: 'visible', timeout: 6000 });
  await page.locator('.qc-pop textarea').fill(text);
  await page.getByRole('button', { name: '发布评论', exact: true }).click();
  await page.locator('.qc-pop textarea').waitFor({ state: 'hidden', timeout: 6000 });
}

async function openList(page) {
  const list = page.locator('.qc-panel');
  if (!await list.isVisible()) await page.getByRole('button', { name: /^全部评论 ·/ }).click();
  await list.waitFor({ state: 'visible', timeout: 6000 });
}

test('QA comments: complete figma shell integration across language, composition, tiling and view gates', { timeout: 180000 }, async () => {
  const [chrome, devices] = await Promise.all([
    readFile(join(skillRoot, 'templates/figma-chrome.js'), 'utf8'),
    readFile(join(skillRoot, 'templates/figma-harness-kit-device-presets.json'), 'utf8'),
  ]);
  const html = fixture({ chrome, devices, policy: DESIGN_POLICY });
  await mkdir(artifacts, { recursive: true });
  const exampleHtml = join(artifacts, 'qa-comments-shell-example.html');
  const examplePng = join(artifacts, 'qa-comments-shell-example.png');
  await writeFile(exampleHtml, html);

  const scratch = await mkdtemp(join(artifacts, 'shell-chrome-'));
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const previousTmp = process.env.TMPDIR;
  process.env.TMPDIR = scratch;
  let browser;
  const errors = [];
  try {
    ({ browser } = await launchChromium(skillRoot, {
      headless: true,
      env: { ...process.env, TMPDIR: scratch },
      args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
    }));

    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base + '?case=complete-shell', { waitUntil: 'load' });
    await waitReady(page);
    assert.equal(await page.getByRole('button', { name: '评论：点选或框选内容', exact: true }).count(), 1);

    await page.evaluate(() => window.__qa.resize(1440, 900));
    await page.waitForFunction(() => window.__qa.inspect().viewport.w === 1440 && window.__qa.inspect().viewport.h === 900);
    await publish(page, 'PC 壳评论：请检查桌面文案');
    await visiblePins(page, 1);

    await page.evaluate(() => window.__qa.setPref('lang', 'ja'));
    await visiblePins(page, 0);
    await page.evaluate(() => window.__qa.setPref('lang', 'en'));
    await visiblePins(page, 1);

    await page.evaluate(() => window.__qa.resize(390, 844));
    await page.waitForFunction(() => window.__qa.inspect().viewport.w === 390 && window.__qa.inspect().viewport.h === 844);
    await page.waitForSelector('[data-node="mobile-copy"]');
    await visiblePins(page, 0);

    await openList(page);
    await page.locator('.qc-item').filter({ hasText: 'PC 壳评论' }).click();
    await page.waitForFunction(() => window.__qa.inspect().viewport.w === 1440 && window.__qa.inspect().viewport.h === 900);
    await page.waitForSelector('[data-node="pc-copy"]');
    await visiblePins(page, 1);

    const tile = page.locator('[data-qa-state-tile]');
    await tile.check();
    await page.waitForFunction(() => document.querySelector('.stage').classList.contains('tiled'));
    await page.getByRole('button', { name: '评论：点选或框选内容', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.qc-toast')?.textContent.includes('请先关闭'));
    assert.equal(await page.locator('.qc-pop textarea').count(), 0, '平铺模式必须明确阻止创建评论');

    await openList(page);
    await page.locator('.qc-item').filter({ hasText: 'PC 壳评论' }).click();
    await page.waitForFunction(() => !document.querySelector('[data-qa-state-tile]').checked);
    await page.waitForFunction(() => window.__qa.inspect().viewport.w === 1440 && window.__qa.inspect().viewport.h === 900);
    await visiblePins(page, 1);
    await openList(page);
    await page.waitForFunction(() => document.querySelector('.qc-toast')?.hidden === true, null, { timeout: 6000 });
    await page.screenshot({ path: examplePng, fullPage: true });
    await page.close();

    for (const suffix of ['?product=1&case=product-view', '?inventory-static-gate=1&case=static-gate']) {
      const gated = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      gated.on('pageerror', (error) => errors.push(error.message));
      await gated.goto(base + suffix, { waitUntil: 'load' });
      await gated.waitForFunction(() => document.querySelector('.frame'));
      assert.equal(await gated.locator('.qc-toolbar').count(), 0, suffix + ' must not inject comment UI');
      assert.equal(await gated.getByRole('button', { name: '评论：点选或框选内容', exact: true }).count(), 0);
      await gated.close();
    }

    assert.deepEqual(errors, [], 'complete shell fixture must have no uncaught browser errors');
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
    if (previousTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmp;
    await rm(scratch, { recursive: true, force: true });
  }
});
