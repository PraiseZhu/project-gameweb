import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyTestBrowserEnv, browserTestOptions } from './helpers/browser-env.mjs';
import { buildSyntheticDemo } from './helpers/build-demo.mjs';
import { waitEwsBoot, resolveStop1BrowserTools } from '../lib/browser-session.mjs';
import { createCommentStore, createQaCommentsHarness } from './helpers/qa-comments-mock.mjs';

applyTestBrowserEnv();

const skillRoot = fileURLToPath(new URL('../..', import.meta.url));

function pageId(name) {
  return `ews-qc-${name}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function publish(page, text, node = '100:5') {
  await page.getByRole('button', { name: '评论：点选或框选内容' }).click();
  const box = await page.locator(`.frame [data-node="${node}"]`).first().boundingBox();
  assert.ok(box, `missing ${node}`);
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.45);
  const input = page.locator('.qc-pop textarea[aria-label="评论内容"]');
  await input.waitFor({ state: 'visible', timeout: 8000 });
  await input.fill(text);
  await page.getByRole('button', { name: '发布评论', exact: true }).click();
  await page.getByRole('button', { name: '回复这条评论', exact: true }).waitFor({ state: 'visible', timeout: 8000 });
}

async function openList(page) {
  const panel = page.locator('.qc-panel');
  if (!await panel.isVisible()) await page.getByRole('button', { name: /^全部评论/ }).click();
  await panel.waitFor({ state: 'visible' });
}

test('generated QA page comments: CLI config, CRUD, isolation, mock share, retry', browserTestOptions({ timeout: 240000 }), async (t) => {
  const tools = resolveStop1BrowserTools(skillRoot);
  assert.equal(tools.ok, true, (tools.problems || []).join('\n'));
  const { launchChromium } = await import(pathToFileURL(tools.playwrightPath).href);
  let launched;
  try {
    launched = await launchChromium(skillRoot, {
      headless: true,
      args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
    });
  } catch (err) {
    assert.fail(`无法启动 Chromium（不得 skip）：${err.message}`);
  }
  const browser = launched.browser;
  const store = createCommentStore();
  const cases = new Map();

  async function livePage(name, extra = {}) {
    const id = extra.pageId || pageId(name);
    const built = buildSyntheticDemo(`ews-qc-${name}-`, {
      args: extra.local
        ? ['--comment-page-id', id]
        : ['--comment-api', extra.commentApi || '/api/qa-comments', '--comment-page-id', id],
    });
    cases.set(id, extra.case || {});
    const harness = createQaCommentsHarness({ demoDir: built.out, store, cases });
    const base = await harness.listen();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitEwsBoot(page);
    await page.waitForSelector('.qc-toolbar', { timeout: 10000 });
    await page.waitForFunction(() => {
      const note = document.querySelector('.qc-panel .qc-note');
      return note && !/正在打开/.test(note.textContent || '');
    }, { timeout: 10000 });
    return { id, built, harness, base, context, page, errors };
  }

  try {
    await t.test('query commentApi keeps tenant, overwrites pageKey, drops fragment, still shares', async () => {
      const id = pageId('query');
      const live = await livePage('query', {
        pageId: id,
        commentApi: '/api/qa-comments?tenant=a&pageKey=wrong#frag',
      });
      try {
        const demoApi = await live.page.evaluate(() => window.__qaDemo?.commentApi || '');
        assert.equal(demoApi.includes('#'), false);
        assert.match(demoApi, /tenant=a/);
        await publish(live.page, '带 query 的共享评论');
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline && !live.harness.captured.some((row) => row.method === 'POST')) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const seen = live.harness.captured.filter((row) => row.pathname.replace(/\/$/, '') === '/api/qa-comments');
        assert.ok(seen.some((row) => row.method === 'GET'), 'missing GET');
        assert.ok(seen.some((row) => row.method === 'POST'), 'missing POST');
        for (const row of seen) {
          assert.equal(row.search.tenant, 'a', JSON.stringify(row));
          assert.equal(row.search.pageKey, id, JSON.stringify(row));
          assert.equal(row.hash, '');
          assert.equal(row.href.includes('#'), false);
          assert.equal(/\?.*\?/.test(row.href), false);
        }
        const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const pageB = await other.newPage();
        await pageB.goto(`${live.base}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitEwsBoot(pageB);
        await pageB.waitForSelector('.qc-toolbar');
        await openList(pageB);
        await pageB.waitForFunction(() => /带 query 的共享评论/.test(document.querySelector('.qc-list')?.innerText || ''), { timeout: 12000 });
        const bSeen = live.harness.captured.filter((row) => row.method === 'GET' && row.search.pageKey === id);
        assert.ok(bSeen.every((row) => row.search.tenant === 'a' && row.hash === ''));
        await other.close();
      } finally {
        await live.context.close();
        await live.harness.close();
      }
    });

    await t.test('CLI commentApi reaches live __qaDemo', browserTestOptions(), async () => {
      const live = await livePage('cfg');
      try {
        const demo = await live.page.evaluate(() => ({
          api: window.__qaDemo?.commentApi || null,
          pageId: window.__qaDemo?.commentPageId || null,
        }));
        assert.equal(demo.api, '/api/qa-comments');
        assert.equal(demo.pageId, live.id);
      } finally {
        await live.context.close();
        await live.harness.close();
      }
    });

    await t.test('create, locate, reply, resolve, restore, lang/state/device isolation', async () => {
      const live = await livePage('crud');
      const { page } = live;
      try {
        await publish(page, '标题要对齐');
        await page.waitForSelector('.qc-pin', { timeout: 8000 });
        const pin = page.locator('.qc-pin').first();
        const title = page.locator('.frame [data-node="100:5"]').first();
        const pinBox = await pin.boundingBox();
        const titleBox = await title.boundingBox();
        assert.ok(pinBox && titleBox);
        assert.ok(Math.abs((pinBox.x + pinBox.width / 2) - (titleBox.x + titleBox.width * 0.4)) < titleBox.width);
        assert.ok(Math.abs((pinBox.y + pinBox.height / 2) - (titleBox.y + titleBox.height * 0.45)) < titleBox.height);

        await page.getByRole('button', { name: '回复这条评论' }).click();
        await page.locator('.qc-pop textarea[aria-label="补充评论"]').fill('补充一句');
        await page.getByRole('button', { name: '发布补充' }).click();
        await page.waitForFunction(() => /补充一句/.test(document.querySelector('.qc-pop')?.innerText || ''), { timeout: 8000 });

        await page.evaluate(() => window.__qa.setPref('lang', 'en'));
        await waitEwsBoot(page);
        await page.waitForFunction(() => document.querySelectorAll('.qc-pin').length === 0, { timeout: 8000 });
        await openList(page);
        await page.locator('[aria-label="评论范围"]').selectOption('current');
        await page.waitForFunction(() => /此范围暂无评论/.test(document.querySelector('.qc-list')?.innerText || ''), { timeout: 8000 });
        await page.locator('[aria-label="评论范围"]').selectOption('all');
        await page.locator('.qc-item').first().click();
        await page.waitForFunction(() => window.__qa?.prefs()?.lang === 'zh-CN', { timeout: 8000 });
        await page.waitForSelector('.qc-pin', { timeout: 8000 });

        await page.evaluate(() => window.__qa.goto('gallery'));
        await page.waitForFunction(() => document.querySelectorAll('.qc-pin').length === 0, { timeout: 8000 });
        await page.evaluate(() => window.__qa.goto('hero'));
        await page.waitForSelector('.qc-pin', { timeout: 8000 });

        await page.evaluate(() => window.__qa.resize(390, 844));
        await waitEwsBoot(page);
        await page.waitForFunction(() => document.querySelectorAll('.qc-pin').length === 0, { timeout: 8000 });
        await page.evaluate(() => window.__qa.resize(1920, 1080));
        await waitEwsBoot(page);
        await page.waitForSelector('.qc-pin', { timeout: 8000 });

        await page.locator('.qc-pin').first().click();
        await page.getByRole('button', { name: '标记已解决' }).click();
        await page.waitForFunction(() => document.querySelectorAll('.qc-pin').length === 0, { timeout: 8000 });
        await openList(page);
        await page.locator('[aria-label="解决状态"]').selectOption('resolved');
        await page.locator('.qc-item').first().click();
        await page.getByRole('button', { name: '恢复为未解决' }).click();
        await page.waitForSelector('.qc-pin', { timeout: 8000 });
      } finally {
        await live.context.close();
        await live.harness.close();
      }
    });

    await t.test('second browser context sees create via mock GET poll', browserTestOptions(), async () => {
      const live = await livePage('share');
      try {
        await publish(live.page, '跨上下文同步');
        const other = await live.context.browser().newContext({ viewport: { width: 1440, height: 900 } });
        const pageB = await other.newPage();
        await pageB.goto(`${live.base}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitEwsBoot(pageB);
        await pageB.waitForSelector('.qc-toolbar');
        await pageB.waitForFunction(() => [...document.querySelectorAll('.qc-pin')].length >= 1
          || /跨上下文同步/.test(document.body.innerText), { timeout: 12000 });
        await openList(pageB);
        const text = await pageB.locator('.qc-list').innerText();
        assert.match(text, /跨上下文同步/);
        await other.close();
      } finally {
        await live.context.close();
        await live.harness.close();
      }
    });

    await t.test('503 stays queued across refresh then resumes', browserTestOptions(), async () => {
      const id = pageId('retry503');
      const live = await livePage('retry503', { pageId: id, case: { status: 503 } });
      try {
        await publish(live.page, '失败后续传');
        await openList(live.page);
        await live.page.locator('[aria-label="解决状态"]').selectOption('pending');
        await live.page.waitForFunction(() => /待同步/.test(document.querySelector('.qc-list')?.innerText || ''), { timeout: 8000 });
        await live.page.reload({ waitUntil: 'domcontentloaded' });
        await waitEwsBoot(live.page);
        await live.page.waitForSelector('.qc-toolbar');
        await openList(live.page);
        await live.page.locator('[aria-label="解决状态"]').selectOption('pending');
        await live.page.waitForFunction(() => /待同步|失败后续传/.test(document.querySelector('.qc-panel')?.innerText || ''), { timeout: 8000 });
        cases.get(id).status = null;
        const item = live.page.locator('.qc-item').first();
        if (await item.count()) await item.click();
        const retry = live.page.getByRole('button', { name: '立即重试同步' });
        if (await retry.count()) await retry.click();
        await live.page.waitForFunction(() => /已同步/.test(document.querySelector('.qc-pop')?.innerText || document.querySelector('.qc-panel')?.innerText || ''), { timeout: 20000 });
      } finally {
        await live.context.close();
        await live.harness.close();
      }
    });

    await t.test('401 pauses until 立即重试同步', browserTestOptions(), async () => {
      const id = pageId('retry401');
      const live = await livePage('retry401', { pageId: id, case: { status: 401 } });
      try {
        await publish(live.page, '权限失效');
        await live.page.getByRole('button', { name: '立即重试同步' }).waitFor({ state: 'visible', timeout: 8000 });
        cases.get(id).status = null;
        await live.page.getByRole('button', { name: '立即重试同步' }).click();
        await live.page.waitForFunction(() => /已同步/.test(document.querySelector('.qc-pop')?.innerText || ''), { timeout: 15000 });
      } finally {
        await live.context.close();
        await live.harness.close();
      }
    });
  } finally {
    try { await browser.close(); } catch { /* ignore */ }
  }
});
