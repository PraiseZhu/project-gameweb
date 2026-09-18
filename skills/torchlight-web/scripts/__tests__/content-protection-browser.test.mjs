import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { launchChromium } from '../lib/resolve-playwright.mjs';
import { DESIGN_POLICY } from '../lib/design-policy.generated.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (name) => readFileSync(new URL('../../templates/' + name, import.meta.url), 'utf8');
const safe = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');
const html = read('demo-shell.html')
  .replaceAll('{{NAME}}', 'content-protection-test').replaceAll('{{PR}}', '0')
  .replace('{{QA_DEVICES}}', () => read('figma-harness-kit-device-presets.json'))
  .replace('<script id="qa-truth" type="application/json"></script>', '<script id="qa-truth" type="application/json">' + safe({ sections: {} }) + '</script>')
  .replace('<script id="qa-design-policy" type="application/json">{}</script>', '<script id="qa-design-policy" type="application/json">' + safe(DESIGN_POLICY) + '</script>')
  .replace('{{FIGMA_RENDER}}', () => read('figma-render.js').replaceAll('</script', '<\\/script'))
  .replace('{{FIGMA_CHROME}}', () => read('figma-chrome.js').replaceAll('</script', '<\\/script'));

const generatedHtml = process.env.CONTENT_PROTECTION_GENERATED_DIR
  ? readFileSync(process.env.CONTENT_PROTECTION_GENERATED_DIR + '/torchlight-web/index.html', 'utf8') : html;
// init emits an empty truth slot. Supply only fixture data, preserving the
// generated renderer/chrome bytes; this is not a real design-page acceptance.
const testHtml = generatedHtml.replace('<script id="qa-truth" type="application/json"></script>', '<script id="qa-truth" type="application/json">{"sections":{}}</script>');
const unprotectedHtml = testHtml.replace(/<!-- CONTENT_PROTECTION_BASELINE_BEGIN -->[\s\S]*?<!-- CONTENT_PROTECTION_BASELINE_END -->/, '').replace(/\/\* CONTENT_PROTECTION_BEGIN \*\/[\s\S]*?\/\* CONTENT_PROTECTION_END \*\//, '');

async function mountProbe(page, protectedMode = true) {
  await page.evaluate(() => {
    document.querySelector('#protection-probe')?.remove();
    const probe = document.createElement('section');
    probe.id = 'protection-probe';
    probe.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:white;color:black;font:16px Arial;padding:12px;overflow:auto;';
    probe.innerHTML = '<p id="protected-text">Protected promotional text for selection testing</p>'
      + '<img id="protected-image" width="80" height="60" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2260%22%3E%3Crect width=%2280%22 height=%2260%22 fill=%22red%22/%3E%3C/svg%3E">'
      + '<div id="protected-background" style="height:30px;background-image:linear-gradient(red,blue)">Background artwork</div>'
      + '<svg id="protected-svg" width="30" height="30"><rect width="30" height="30" fill="red"/></svg>'
      + '<input id="editable-input" value="editable input"><textarea id="editable-textarea">editable text</textarea>'
      + '<div id="editable-rich" data-content-protection-editable="true" contenteditable="true"><span>editable rich text</span></div>'
      + '<input id="readonly-input" readonly value="read only secret"><input id="disabled-input" disabled value="disabled text">'
      + '<div id="unapproved-editor" contenteditable="true">unapproved text</div>'
      + '<div id="media-editor" data-content-protection-editable="true" contenteditable="true"><span id="editor-label">editor text</span><span id="locked-label" contenteditable="false">locked text</span><img id="editor-image" width="30" height="30"></div>'
      + '<button id="copy-action">Copy code</button><button id="click-action">Click</button>'
      + '<div id="scroll-probe" style="height:60px;overflow:auto"><div style="height:600px">Scroll</div></div>';
    document.body.appendChild(probe);
    document.querySelector('#click-action').onclick = () => { window.protectionClicked = true; };
    document.querySelector('#copy-action').onclick = async () => {
      await navigator.clipboard.writeText('EXPLICIT-CODE');
      window.protectionCopied = true;
    };
  });
  if (protectedMode) await page.waitForFunction(() => document.querySelector('#protected-image').draggable === false);
}

// Real mouse input must generate trusted browser events. The negative control
// proves the same gesture can start a native image drag when guards are removed.
async function nativeImageActions(page) {
  await page.evaluate(() => {
    window.nativeImageEvents = [];
    if (window.recordNativeImageEvent) document.removeEventListener('dragstart', window.recordNativeImageEvent);
    if (window.recordNativeImageEvent) document.removeEventListener('contextmenu', window.recordNativeImageEvent);
    window.recordNativeImageEvent = event => {
      if (event.target.id === 'protected-image') window.nativeImageEvents.push({
        type: event.type, trusted: event.isTrusted, cancelled: event.defaultPrevented,
      });
    };
    document.addEventListener('dragstart', window.recordNativeImageEvent);
    document.addEventListener('contextmenu', window.recordNativeImageEvent);
    getSelection().removeAllRanges();
  });
  await page.waitForFunction(() => document.querySelector('#protected-image').naturalWidth > 0);
  const rect = await page.locator('#protected-image').boundingBox();
  await page.mouse.move(rect.x + 20, rect.y + 20);
  await page.mouse.down();
  await page.mouse.move(rect.x + 150, rect.y + 35, { steps: 20 });
  await page.mouse.up();
  await page.locator('#protected-image').click({ button: 'right', position: { x: 20, y: 20 } });
  await page.keyboard.press('Escape');
  return page.evaluate(() => window.nativeImageEvents);
}

test('real product and QA shells protect content, retain editing and survive remounts', { timeout: 120000 }, async (t) => {
  let browser;
  try { ({ browser } = await launchChromium(root, { headless: true })); }
  catch (error) {
    if (process.env.CONTENT_PROTECTION_REQUIRED === '1') throw error;
    t.skip('浏览器未就绪；独立云端内容保护闸门会将此情况判为失败');
    return;
  }
  const server = createServer((_req, res) => { if (_req.url === '/missing.png') { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(_req.url.startsWith('/negative') ? unprotectedHtml : testHtml); });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const product of [false, true]) for (const width of [390, 1440]) for (const interaction of [false, true]) {
      await t.test((product ? 'product' : 'QA') + ' ' + width + ' interaction=' + interaction, async () => {
        const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
        const evidenceDir = fileURLToPath(new URL('../../../../_tmp/content-protection/failures/torchlight-web/', import.meta.url));
        mkdirSync(evidenceDir, { recursive: true });
        const key = (product ? 'product' : 'qa') + '-' + width + '-' + interaction;
        let page;
        await context.tracing.start({ screenshots: true, snapshots: true });
        try {
          page = await context.newPage();
          page.setDefaultTimeout(8000);
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          await page.goto(origin + '/?product=' + Number(product) + '&interaction=' + Number(interaction));
          await page.waitForFunction(() => document.documentElement.getAttribute('data-content-protection') === 'v1');
          assert.deepEqual(errors, [], 'shell must boot without errors');
          assert.ok(await page.locator('.frame').count(), 'real shell must mount');
          if (!product) assert.equal(await page.evaluate(() => typeof window.__qa.resize), 'function');
          await mountProbe(page);
          await page.locator('#protected-text').dblclick({ position: { x: 30, y: 8 } });
          assert.equal(await page.evaluate(() => String(getSelection())), '', 'double-click must not select');
          const box = await page.locator('#protected-text').boundingBox();
          await page.mouse.move(box.x + 2, box.y + 8);
          await page.mouse.down();
          await page.mouse.move(box.x + Math.min(box.width - 2, 250), box.y + 8, { steps: 12 });
          await page.mouse.up();
          assert.equal(await page.evaluate(() => String(getSelection())), '', 'mouse dragging must not select');
          await page.evaluate(() => {
            window.keyboardCopyEvents = [];
            document.addEventListener('copy', event => window.keyboardCopyEvents.push({
              trusted: event.isTrusted, cancelled: event.defaultPrevented,
            }), { capture: false, once: false });
          });
          await page.locator('#protected-text').click();
          await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
          assert.equal(await page.evaluate(() => String(getSelection())), '', 'keyboard select-all must not select protected text');
          await page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C');
          assert.ok(await page.evaluate(() => window.keyboardCopyEvents.some(event => event.trusted && event.cancelled)), 'keyboard copy must be cancelled');
          const outcomes = await page.evaluate(() => {
            const fire = (selector, type) => !document.querySelector(selector).dispatchEvent(new Event(type, { bubbles: true, cancelable: true, composed: true }));
            return {
              protected: ['selectstart', 'copy', 'cut', 'dragstart', 'contextmenu'].map(type => fire('#protected-text', type)),
              artwork: ['#protected-image', '#protected-svg', '#protected-background'].map(selector => fire(selector, 'contextmenu')),
              editable: ['#editable-input', '#editable-textarea', '#editable-rich span'].flatMap(selector => ['selectstart', 'copy', 'cut', 'contextmenu'].map(type => fire(selector, type))),
              css: getComputedStyle(document.querySelector('#protected-text')).userSelect,
              inputCss: getComputedStyle(document.querySelector('#editable-input')).userSelect,
            };
          });
          assert.ok(outcomes.protected.every(Boolean));
          assert.ok(outcomes.artwork.every(Boolean));
          assert.ok(outcomes.editable.every(value => !value), 'editing must not be cancelled');
          assert.equal(outcomes.css, 'none');
          assert.equal(outcomes.inputCss, 'text');
          const protectedNative = await nativeImageActions(page);
          assert.ok(!protectedNative.some(event => event.type === 'dragstart' && !event.cancelled), 'native image dragging must not start');
          assert.ok(protectedNative.some(event => event.type === 'contextmenu' && event.trusted && event.cancelled), 'real right click must be cancelled');
          await page.locator('#editable-input').fill('changed');
          assert.equal(await page.locator('#editable-input').inputValue(), 'changed');
          const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
          await page.keyboard.press(modifier + '+A');
          await page.keyboard.press(modifier + '+C');
          assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'changed', 'input copy works');
          await page.keyboard.press('ArrowLeft');
          await page.keyboard.press('Shift+ArrowRight');
          assert.equal(await page.locator('#editable-input').evaluate(el => el.selectionEnd - el.selectionStart), 1);
          await page.keyboard.press(modifier + '+A');
          await page.keyboard.press(modifier + '+X');
          assert.equal(await page.locator('#editable-input').inputValue(), '', 'input cut works');
          const boundaries = await page.evaluate(() => {
            getSelection().removeAllRanges();
            const blocked = selector => ['selectstart', 'copy', 'cut', 'dragstart', 'contextmenu'].every(type => !document.querySelector(selector).dispatchEvent(new Event(type, { bubbles: true, cancelable: true })));
            const locked = ['#readonly-input', '#disabled-input', '#unapproved-editor', '#locked-label', '#editor-image'].map(blocked);
            const editor = document.querySelector('#media-editor');
            const range = document.createRange();
            range.selectNodeContents(editor);
            getSelection().addRange(range);
            const mixed = ['copy', 'cut', 'dragstart'].every(type => !editor.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })));
            getSelection().removeAllRanges();
            return { locked, mixed };
          });
          assert.ok(boundaries.locked.every(Boolean), 'readonly, disabled, unapproved editor and media stay protected');
          assert.equal(boundaries.mixed, true, 'rich text cannot copy or drag embedded artwork');
          await page.locator('#click-action').click();
          assert.equal(await page.evaluate(() => window.protectionClicked), true);
          await page.locator('#copy-action').click();
          await page.waitForFunction(() => window.protectionCopied);
          assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'EXPLICIT-CODE');
          await page.locator('#scroll-probe').hover();
          await page.mouse.wheel(0, 180);
          await page.waitForFunction(() => document.querySelector('#scroll-probe').scrollTop > 0);
          await page.evaluate(() => { document.querySelector('#protected-image').draggable = true; });
          await page.waitForFunction(() => !document.querySelector('#protected-image').draggable);
          await page.evaluate(() => {
            document.querySelector('#protection-probe').remove();
            if (typeof window.__qa?.resize === 'function') window.__qa.resize(390, 844);
            else window.dispatchEvent(new Event('resize'));
          });
          await mountProbe(page);
          assert.equal(await page.locator('style[data-content-protection-style]').count(), 1, 'remount must not duplicate guards');
          // Exercise boundary widths and language-driven shell rerenders. No
          // geometry or business interaction is invented for the fixture.
          for (const w of [750, 751, 1126, 1127, 1920, 1921]) {
            await page.setViewportSize({ width: w, height: 500 });
            await page.evaluate(w => {
              window.__qa?.setPref?.('lang', 'en');
              window.__qa?.resize?.(w, 500);
            }, w);
            assert.equal(await page.locator('style[data-content-protection-style]').count(), 1);
            assert.equal(await page.locator('#protected-image').evaluate(el => el.draggable), false);
          }
          await page.setViewportSize({ width, height: 900 });
          // A native top-layer dialog and failed image load must not bypass
          // document-level guards, or block the close button.
          await page.evaluate(() => {
            const dialog = document.createElement('dialog');
            dialog.id = 'protected-dialog';
            dialog.innerHTML = '<p id="dialog-text">new language text</p><img id="dialog-image" src="/missing.png"><button id="dialog-close">Close</button>';
            document.body.append(dialog);
            dialog.querySelector('button').onclick = () => dialog.close();
            dialog.showModal();
          });
          await page.waitForFunction(() => !document.querySelector('#dialog-image').draggable);
          await page.locator('#dialog-text').dblclick();
          assert.equal(await page.evaluate(() => String(getSelection())), '');
          assert.equal(await page.locator('#dialog-image').evaluate(el => !el.dispatchEvent(new Event('contextmenu', { bubbles: true, cancelable: true }))), true);
          await page.locator('#dialog-close').click();
          assert.equal(await page.locator('#protected-dialog').evaluate(el => el.open), false);

          assert.deepEqual(errors, []);
          // Separate unprotected fixture is the positive control for native
          // gestures. Production has no teardown switch or test hook.
          await page.goto(origin + '/negative?product=' + Number(product) + '&interaction=' + Number(interaction));
          await mountProbe(page, false);
          const negative = await nativeImageActions(page);
          for (const type of ['dragstart', 'contextmenu']) assert.ok(negative.some(event => event.type === type && event.trusted && !event.cancelled), type + ' negative control');
        } catch (error) {
          await page?.screenshot({ path: evidenceDir + key + '.png' }).catch(() => {});
          await context.tracing.stop({ path: evidenceDir + key + '.zip' }).catch(() => {});
          throw error;
        } finally {
          await context.tracing.stop().catch(() => {});
          await context.close();
        }
      });
    }
  } finally {
    await browser.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
});
