import assert from 'node:assert/strict';
import { test } from 'node:test';
import { launchChromium } from '../../stop1-figma-pixel/tool/src/resolve-playwright.mjs';
import { hitTarget } from '../src/c-check/browser-audit.mjs';
import { runRepairLoop } from '../src/c-check/repair-loop.mjs';
import { summarizeChecks } from '../src/c-check/evidence.mjs';
import { runtime } from '../src/c-page-runtime.mjs';

test('C3 返修使用全量结果：无改善立即停，最多两轮，不自动放行', async () => {
  const runs = [];
  const audit = async (ids, round) => { runs.push(round); return { problems: ids.map((id) => ({ id })) }; };
  const stuck = await runRepairLoop({ initial: ['pixel'], audit, repair: async () => ['pixel'] });
  assert.equal(stuck.reason, 'no-improvement');
  assert.deepEqual(runs.splice(0), [0, 1]);
  const capped = await runRepairLoop({ initial: ['pixel', 'text', 'image'], audit, repair: async ({ input }) => input.slice(0, -1) });
  assert.equal(capped.status, 'needs-human-decision');
  assert.deepEqual(capped.choices, ['continue-fix', 'manual-waiver-with-reason']);
  assert.deepEqual(runs.splice(0), [0, 1, 2]);
  const fixed = await runRepairLoop({ initial: ['pixel'], audit, repair: async () => [] });
  assert.equal(fixed.status, 'pass');
  assert.deepEqual(runs, [0, 1]);
  const repeated = await runRepairLoop({ initial: ['pixel', 'text', 'image'], audit, repair: async ({ input }) => input.slice(0, -1) });
  assert.equal(repeated.reason, 'same-problem');
});

test('C3 同类部分通过仍为未完成；失败优先且空覆盖不能通过', () => {
  const coverage = summarizeChecks([
    { id: 'D04:screen-a', check: 'D04', status: 'pass' },
    { id: 'D04:screen-b', check: 'D04', status: 'not_run' },
    { id: 'D08:action-a', check: 'D08', status: 'fail' },
    { id: 'D08:action-b', check: 'D08', status: 'not_run' },
  ]);
  assert.equal(coverage.D04.status, 'not_run');
  assert.deepEqual(coverage.D04.evidence, ['D04:screen-a', 'D04:screen-b']);
  assert.equal(coverage.D08.status, 'fail');
  assert.equal(coverage.D13.status, 'not_run');
});

test('C3 Chromium：真实坐标识别透明层截获点击', { skip: process.env.ONEPAGE_C3_BROWSER !== '1' }, async () => {
  const { browser } = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 200 } });
    await page.setContent('<button id="action" style="position:absolute;inset:20px auto auto 20px;width:120px;height:50px">Open</button>');
    const open = await hitTarget(page, '#action');
    assert.deepEqual(open, { x: 80, y: 45, hit: 'action', ok: true });
    await page.evaluate(() => {
      const layer = document.createElement('div');
      layer.id = 'transparent-layer';
      layer.style.cssText = 'position:fixed;inset:0;opacity:0';
      document.body.append(layer);
    });
    const covered = await hitTarget(page, '#action');
    assert.deepEqual(covered, { x: 80, y: 45, hit: 'transparent-layer', ok: false });
  } finally { await browser.close(); }
});

test('C3 Chromium 隔离运行时：三类编辑控件键盘编辑和剪贴板，正文键盘保护',
  { skip: process.env.ONEPAGE_C3_BROWSER !== '1' }, async () => {
    const { browser } = await launchChromium();
    try {
      const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
      const page = await context.newPage();
      const origin = 'http://127.0.0.1:43219';
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route(origin + '/', (route) => route.fulfill({ contentType: 'text/html', body:
        '<!doctype html><style>body{user-select:none}input,textarea,[contenteditable]{user-select:text}</style>'
        + '<main data-device="pc"><section data-screen="1" tabindex="-1"><p id="copy" tabindex="0">protected body</p>'
        + '<input id="input"><textarea id="textarea"></textarea><div id="edit" contenteditable="true"></div></section></main>'
        + '<script>window.OnePageConfig={language:"en",bindings:{},actions:{},components:{}};(' + runtime.toString() + ')();</script>' }));
      await page.goto(origin);
      const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
      for (const id of ['input', 'textarea', 'edit']) {
        const field = page.locator('#' + id);
        await field.focus();
        await page.keyboard.type('typed-' + id);
        const get = () => field.evaluate((node) => node.value ?? node.textContent);
        assert.equal(await get(), 'typed-' + id);
        await field.press('ControlOrMeta+a');
        await field.press('ControlOrMeta+c');
        await page.waitForFunction(async (value) => await navigator.clipboard.readText() === value, 'typed-' + id);
        await page.evaluate(() => navigator.clipboard.writeText('before-cut'));
        await field.press('ControlOrMeta+x');
        assert.equal(await get(), '');
        assert.equal(await clipboard(), 'typed-' + id);
        await field.press('ControlOrMeta+v');
        assert.equal(await get(), 'typed-' + id);
      }
      await page.evaluate(async () => {
        await navigator.clipboard.writeText('protected-clipboard');
        const node = document.getElementById('copy');
        node.focus();
        const range = document.createRange();
        range.selectNodeContents(node);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      });
      await page.keyboard.press('ControlOrMeta+c');
      await page.keyboard.press('ControlOrMeta+x');
      assert.equal(await clipboard(), 'protected-clipboard');
      assert.equal(await page.locator('#copy').textContent(), 'protected body');
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
