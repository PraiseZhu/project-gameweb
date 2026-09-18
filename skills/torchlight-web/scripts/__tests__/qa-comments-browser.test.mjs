import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { launchChromium } from '../lib/resolve-playwright.mjs';

const skillRoot = resolve(import.meta.dirname, '../..');
const repoRoot = resolve(skillRoot, '../..');
const artifacts = join(repoRoot, '_tmp', 'qa-comments-browser');

// Serve the unchanged production controller over real HTTP. A small renderer
// adapter supplies stable content identities and ordinary context controls.
// No test-only comment callbacks or in-memory storage replacements are used.
function fixture(runtime) {
  return [
    '<!doctype html><meta charset="utf-8"><title>QA 评论行为测试</title>',
    '<style>*{box-sizing:border-box}body{margin:0;background:#10141d;color:#eef2f8;font:15px system-ui}',
    'header{height:84px;padding:12px 24px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}',
    'header select,header button{font:inherit;padding:6px;background:#202939;color:inherit;border:1px solid #64748b}',
    '.stage{position:absolute;left:32px;top:100px;width:1000px;height:560px;overflow:auto;background:#172033}',
    '.canvas{width:920px;min-height:1500px;transform-origin:0 0;padding:64px 40px}',
    '[data-node="section-1"]{background:#1d2e48;padding:28px;width:780px;min-height:400px}',
    '[data-node="card-1"]{background:#273f5e;padding:32px;width:600px;min-height:250px}',
    '[data-node="text-1"]{display:block;width:400px;min-height:70px;font-size:26px;line-height:1.4;margin:0 0 32px}',
    '[data-node="button-1"]{display:block;width:200px;height:44px}',
    '.spacer{height:500px}[data-node="footer-1"]{padding:20px;background:#26475b;width:400px;height:100px}</style>',
    '<header><label>语言 <select id="lang"><option>en</option><option>ja</option></select></label>',
    '<label>地区 <select id="region"><option>global</option><option>jp</option></select></label>',
    '<label>状态 <select id="state"><option>home</option><option>details</option></select></label>',
    '<button id="rebuild">重建内容</button><button id="scale">缩放 0.72</button><span id="comment-tools"></span>',
    '</header><main class="stage" id="stage"></main><script>', runtime,
    "var state={lang:'en',region:'global',state:'home',composition:'pc',grid:false};",
    'var scale=1, comments=null, clicked=0;',
    'function render(){',
    'document.querySelector("#stage").innerHTML=\'<div class="canvas" style="transform:scale(\'+scale+\')"><section data-node="section-1" data-node-name="活动内容区" data-figma-type="FRAME"><article data-node="card-1" data-node-name="奖励卡片" data-figma-type="FRAME"><p data-node="text-1" data-node-name="活动标题" data-figma-type="TEXT">Season rewards \'+state.lang+\' \'+state.region+\'</p><button data-node="button-1" data-node-name="领取奖励" data-figma-type="INSTANCE" onclick="clicked++">领取奖励</button></article></section><div class="spacer"></div><div data-node="footer-1" data-node-name="页尾内容" data-figma-type="FRAME">页面底部的另一块内容</div></div>\';',
    'if(comments)comments.refresh();}',
    "['lang','region','state'].forEach(function(k){document.getElementById(k).onchange=function(e){state[k]=e.target.value;render();};});",
    'document.querySelector("#rebuild").onclick=render;',
    'document.querySelector("#scale").onclick=function(){scale=.72;render();};render();',
    'comments=createQaComments({stage:document.querySelector("#stage"),pageKey:new URL(location.href).searchParams.get("case")||"default",context:function(){return Object.assign({},state);},viewport:function(){return {w:1000,h:560};},navigate:function(c){Object.assign(state,c);["lang","region","state"].forEach(function(k){document.getElementById(k).value=state[k];});render();return true;}});',
    'document.querySelector("#comment-tools").appendChild(comments.toolbar);</script>',
  ].join('\n');
}

async function count(page, selector, expected) {
  await page.waitForFunction(({ selector, expected }) => document.querySelectorAll(selector).length === expected, { selector, expected }, { timeout: 6000 });
}
async function visible(page, selector) {
  await page.locator(selector).waitFor({ state: 'visible', timeout: 6000 });
}
async function enterDraft(page, target = '[data-node="text-1"]', point = { u: .35, v: .3 }) {
  await page.getByRole('button', { name: '评论：点选或框选内容', exact: true }).click();
  const box = await page.locator(target).boundingBox();
  assert.ok(box, 'selected content must be visible');
  await page.mouse.click(box.x + box.width * point.u, box.y + box.height * point.v);
  await visible(page, '.qc-pop textarea');
}
async function publish(page, text, target, point) {
  await enterDraft(page, target, point);
  await page.locator('.qc-pop textarea').fill(text);
  await page.getByRole('button', { name: '发布评论', exact: true }).click();
  await page.locator('.qc-pop textarea').waitFor({ state: 'hidden', timeout: 6000 });
}
async function panel(page) {
  if (!await page.locator('.qc-panel').isVisible()) await page.getByRole('button', { name: /^全部评论 ·/ }).click();
  await visible(page, '.qc-panel');
}
async function assertPinTracks(page, target, u, v) {
  await page.waitForFunction(({ target, u, v }) => {
    const node = document.querySelector(target), pin = document.querySelector('.qc-pin');
    if (!node || !pin) return false;
    const n = node.getBoundingClientRect(), p = pin.getBoundingClientRect();
    return Math.abs(p.x + p.width / 2 - (n.x + n.width * u)) < 2.1
      && Math.abs(p.y + p.height / 2 - (n.y + n.height * v)) < 2.1;
  }, { target, u, v }, { timeout: 6000 });
}

test('QA comments: real storage, content selection, navigation and tab synchronization', { timeout: 180000 }, async (t) => {
  const source = await readFile(join(skillRoot, 'templates/figma-chrome.js'), 'utf8');
  const offset = source.indexOf('function createQaComments(host)');
  assert.notEqual(offset, -1, 'production comment controller must exist');
  const html = fixture(source.slice(offset));
  await mkdir(artifacts, { recursive: true });
  const scratch = await mkdtemp(join(artifacts, 'chrome-'));
  const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  // Playwright creates profiles through Node os.tmpdir(). Both launch process
  // and Chrome child receive a workspace path, never /tmp.
  const previousTmp = process.env.TMPDIR;
  process.env.TMPDIR = scratch;
  let browser;
  const errors = [];
  try {
    ({ browser } = await launchChromium(skillRoot, { headless: true, env: { ...process.env, TMPDIR: scratch }, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] }));
    const context = await browser.newContext({ viewport: { width: 1240, height: 820 } });
    async function pageFor(name, ctx = context) {
      const page = await ctx.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '?case=' + encodeURIComponent(name));
      await visible(page, '.qc-toolbar');
      await page.waitForFunction(() => !document.querySelector('.qc-panel').textContent.includes('正在打开本地评论库'));
      return page;
    }

    await t.test('point selection highlights its target; publication survives reload and text edits', async () => {
      const page = await pageFor('persist');
      await enterDraft(page);
      await visible(page, '.qc-outline');
      await page.locator('.qc-pop textarea').fill('标题内容需要修正');
      await page.getByRole('button', { name: '发布评论', exact: true }).click();
      await count(page, '.qc-pin', 1);
      await assertPinTracks(page, '[data-node="text-1"]', .35, .3);
      await page.reload();
      await count(page, '.qc-pin', 1);
      await page.locator('.qc-pin').click();
      assert.match(await page.locator('.qc-pop').innerText(), /标题内容需要修正/);
      await page.keyboard.press('Escape');
      await page.locator('[data-node="text-1"]').evaluate(n => { n.textContent = 'The corrected title'; });
      await count(page, '.qc-pin', 1);
      await page.close();
    });

    await t.test('the user explicitly enlarges selection to a parent content card', async () => {
      const page = await pageFor('parent');
      await enterDraft(page);
      await page.locator('.qc-pop select').selectOption({ index: 1 });
      await page.waitForFunction(() => {
        const a = document.querySelector('.qc-outline').getBoundingClientRect(), b = document.querySelector('[data-node="card-1"]').getBoundingClientRect();
        return Math.abs(a.x-b.x)<2 && Math.abs(a.y-b.y)<2 && Math.abs(a.width-b.width)<2 && Math.abs(a.height-b.height)<2;
      }, null, { timeout: 6000 });
      await page.locator('.qc-pop textarea').fill('整张奖励卡片的间距需要修改');
      await page.getByRole('button', { name: '发布评论', exact: true }).click();
      await count(page, '.qc-pin', 1);
      await page.locator('.qc-pin').click();
      assert.match(await page.locator('.qc-pop').innerText(), /奖励卡片/);
      await panel(page);
      await page.screenshot({ path: join(artifacts, 'comments-parent-and-list.png') });
      await page.close();
    });

    await t.test('language, region and state isolate pins; all-comments navigation restores their context', async () => {
      const page = await pageFor('combinations');
      await publish(page, 'English global home comment');
      await count(page, '.qc-pin', 1);
      await page.selectOption('#lang', 'ja');
      await count(page, '.qc-pin', 0);
      await publish(page, 'Japanese global home comment');
      await page.selectOption('#region', 'jp');
      await count(page, '.qc-pin', 0);
      await publish(page, 'Japanese JP home comment');
      await page.selectOption('#state', 'details');
      await count(page, '.qc-pin:not([hidden])', 0);
      await panel(page);
      await count(page, '.qc-item', 3);
      await page.locator('.qc-item').filter({ hasText: 'English global home comment' }).click();
      await count(page, '.qc-pin', 1);
      assert.equal(await page.inputValue('#lang'), 'en');
      assert.equal(await page.inputValue('#region'), 'global');
      assert.equal(await page.inputValue('#state'), 'home');
      await visible(page, '.qc-pop');
      await page.close();
    });

    await t.test('resolve hides the pin; restoring from the resolved list brings it back', async () => {
      const page = await pageFor('resolve');
      await publish(page, 'Resolve after fix');
      await count(page, '.qc-pin', 1);
      await page.locator('.qc-pin').click();
      await page.getByRole('button', { name: '✓ 标记已解决', exact: true }).click();
      await count(page, '.qc-pin:not([hidden])', 0);
      await panel(page);
      await count(page, '.qc-item', 0);
      await page.locator('.qc-panel select').nth(1).selectOption('resolved');
      await count(page, '.qc-item', 1);
      await page.locator('.qc-item').click();
      await page.getByRole('button', { name: /恢复评论/ }).click();
      await count(page, '.qc-pin', 1);
      await page.close();
    });

    await t.test('pins follow scaling, scrolling and rebuilt DOM; clipped targets hide their pins', async () => {
      const page = await pageFor('geometry');
      await publish(page, 'Geometry anchor');
      await count(page, '.qc-pin', 1);
      await page.click('#scale');
      await assertPinTracks(page, '[data-node="text-1"]', .35, .3);
      await page.locator('#stage').evaluate(n => { n.scrollTop = 45; n.scrollLeft = 15; });
      await assertPinTracks(page, '[data-node="text-1"]', .35, .3);
      await page.click('#rebuild');
      await assertPinTracks(page, '[data-node="text-1"]', .35, .3);
      await page.locator('#stage').evaluate(n => { n.scrollTop = 700; });
      await count(page, '.qc-pin:not([hidden])', 0);
      await page.locator('#stage').evaluate(n => { n.scrollTop = 0; });
      await count(page, '.qc-pin:not([hidden])', 1);
      await page.close();
    });

    await t.test('ambiguous or deleted identities remain in the list without a wrong pin', async () => {
      const page = await pageFor('identity');
      await publish(page, 'Keep this issue even if content disappears');
      await count(page, '.qc-pin', 1);
      await page.locator('[data-node="text-1"]').evaluate(n => n.parentElement.appendChild(n.cloneNode(true)));
      await count(page, '.qc-pin:not([hidden])', 0);
      await panel(page);
      await count(page, '.qc-item', 1);
      assert.match(await page.locator('.qc-item').innerText(), /多个|重复|歧义|唯一/);
      await page.keyboard.press('Escape');
      await page.click('#rebuild');
      await count(page, '.qc-pin', 1);
      await page.locator('[data-node="text-1"]').evaluate(n => n.remove());
      await count(page, '.qc-pin:not([hidden])', 0);
      await panel(page);
      await count(page, '.qc-item', 1);
      assert.match(await page.locator('.qc-item').innerText(), /删除|替换|找不到|不存在|失效/);
      await page.close();
    });

    await t.test('drag selection confirms the shared content block and suppresses page actions', async () => {
      const page = await pageFor('drag');
      await page.getByRole('button', { name: '评论：点选或框选内容', exact: true }).click();
      const a = await page.locator('[data-node="text-1"]').boundingBox();
      const b = await page.locator('[data-node="button-1"]').boundingBox();
      await page.mouse.move(a.x + 20, a.y + 20);
      await page.mouse.down();
      await page.mouse.move(b.x + 50, b.y + 20, { steps: 8 });
      await page.mouse.up();
      await visible(page, '.qc-pop textarea');
      assert.match(await page.locator('.qc-pop select option:checked').innerText(), /奖励卡片/);
      assert.equal(await page.evaluate(() => clicked), 0);
      await page.keyboard.press('Escape');
      await enterDraft(page, '[data-node="button-1"]');
      assert.equal(await page.evaluate(() => clicked), 0);
      await page.selectOption('#lang', 'ja');
      await page.locator('.qc-pop').waitFor({ state: 'hidden' });
      await page.click('[data-node="button-1"]');
      assert.equal(await page.evaluate(() => clicked), 1);
      await page.close();
    });

    await t.test('an aborted write retains the draft, reports failure and allows a real retry', async () => {
      const page = await pageFor('abort');
      await enterDraft(page);
      await page.locator('.qc-pop textarea').fill('Do not lose this failed draft');
      await page.evaluate(() => {
        const add = IDBObjectStore.prototype.add;
        IDBObjectStore.prototype.add = function (...args) {
          IDBObjectStore.prototype.add = add;
          const request = add.apply(this, args);
          request.addEventListener('success', () => this.transaction.abort());
          return request;
        };
      });
      await page.getByRole('button', { name: '发布评论', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.qc-toast').textContent.includes('未保存'));
      assert.equal(await page.locator('.qc-pop textarea').inputValue(), 'Do not lose this failed draft');
      await count(page, '.qc-pin:not([hidden])', 0);
      await page.getByRole('button', { name: '发布评论', exact: true }).click();
      await count(page, '.qc-pin:not([hidden])', 1);
      await page.reload();
      await count(page, '.qc-pin:not([hidden])', 1);
      await page.close();
    });

    await t.test('unavailable IndexedDB and BroadcastChannel are reported honestly', async () => {
      const noStorage = await browser.newContext();
      await noStorage.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined }));
      const blocked = await pageFor('no-storage', noStorage);
      assert.ok(await blocked.getByRole('button', { name: '评论：点选或框选内容', exact: true }).isDisabled());
      assert.match(await blocked.locator('.qc-panel').innerText(), /不支持 IndexedDB/);
      await noStorage.close();
      const noChannel = await browser.newContext();
      await noChannel.addInitScript(() => Object.defineProperty(window, 'BroadcastChannel', { value: undefined }));
      const local = await pageFor('no-channel', noChannel);
      await publish(local, 'Local storage still works');
      await panel(local);
      assert.match(await local.locator('.qc-panel').innerText(), /不支持标签页即时同步/);
      await noChannel.close();
    });

    await t.test('same-origin tabs synchronize automatically; separate browser contexts do not share storage', async () => {
      const sender = await pageFor('tabs');
      const receiver = await pageFor('tabs');
      await sender.evaluate(() => {
        document.addEventListener('click', e => {
          if (e.target.closest('button')?.textContent === '发布评论') window.lastPublishClick = Date.now();
        }, true);
      });
      const latencies = [];
      for (let i = 0; i < 20; i++) {
        const expected = i + 1;
        // Measure from the sender's actual click event to the receiver's pin
        // mutation, including IndexedDB commit and BroadcastChannel delivery.
        const arrival = receiver.evaluate(expected => new Promise((resolve, reject) => {
          const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('cross-tab pin update timed out')); }, 6000);
          const observer = new MutationObserver(() => {
            const pins = [...document.querySelectorAll('.qc-pin:not([hidden])')];
            if (pins.length === expected && pins.every(pin => pin.style.left && pin.style.top)) {
              clearTimeout(timeout); observer.disconnect(); resolve(Date.now());
            }
          });
          observer.observe(document.querySelector('.qc-root'), { childList: true, attributes: true, subtree: true });
        }), expected);
        await publish(sender, 'Tab propagation ' + expected, '[data-node="card-1"]', { u: .1 + .2 * (i % 5), v: .1 + .24 * Math.floor(i / 5) });
        const receivedAt = await arrival;
        const sentAt = await sender.evaluate(() => window.lastPublishClick);
        latencies.push(receivedAt - sentAt);
        assert.ok(latencies.at(-1) >= 0 && latencies.at(-1) < 6000);
      }
      const sorted = [...latencies].sort((a, b) => a - b);
      console.log('QA_COMMENT_TAB_LATENCY ' + JSON.stringify({ samples: 20, unit: 'ms', p50: sorted[9], p95: sorted[18], min: sorted[0], max: sorted[19], measurements: latencies, scope: 'same-origin same-browser headless pages, publication click to receiver pin DOM; not XD Sites coworker latency' }));
      await receiver.locator('.qc-pin').first().click();
      const resolvingId = await receiver.locator('.qc-pin[aria-expanded=true]').getAttribute('data-comment-id');
      await panel(sender);
      await sender.locator('.qc-item').filter({ hasText: 'Tab propagation 1' }).last().click();
      await sender.getByRole('button', { name: '✓ 标记已解决', exact: true }).click();
      await count(receiver, '.qc-pin:not([hidden])', 19);
      assert.equal(await receiver.locator('.qc-pin').evaluateAll((nodes, id) => nodes.some(n => n.dataset.commentId === id), resolvingId), false);
      await receiver.getByRole('button', { name: /恢复评论/ }).waitFor({ state: 'visible' });
      const otherContext = await browser.newContext({ viewport: { width: 1240, height: 820 } });
      const isolated = await pageFor('tabs', otherContext);
      await panel(isolated);
      await count(isolated, '.qc-item', 0);
      await count(isolated, '.qc-pin', 0);
      await otherContext.close();
      await sender.close();
      await receiver.close();
    });
    assert.deepEqual(errors, [], 'no uncaught browser errors');
    await context.close();
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    if (previousTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmp;
    await rm(scratch, { recursive: true, force: true });
  }
});
