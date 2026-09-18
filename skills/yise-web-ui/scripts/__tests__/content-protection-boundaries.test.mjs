import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchChromium, loadPlaywrightApi } from '../lib/resolve-playwright.mjs';

const skillRoot = fileURLToPath(new URL('../../', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const read = name => readFileSync(join(skillRoot, 'templates', name), 'utf8');
const userSelect = el => {
  const style = getComputedStyle(el);
  return style.userSelect || style.getPropertyValue('-webkit-user-select');
};
const runtime = read('figma-render.js').match(/\/\* CONTENT_PROTECTION_BEGIN \*\/[\s\S]*?\/\* CONTENT_PROTECTION_END \*\//)[0];
const baseline = read('demo-shell.html').match(/<!-- CONTENT_PROTECTION_BASELINE_BEGIN -->[\s\S]*?<!-- CONTENT_PROTECTION_BASELINE_END -->/)[0];
const sample = '<p id="text">Protected words here</p><img id="image" width="80" height="60" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2260%22%3E%3Crect width=%2280%22 height=%2260%22 fill=%22red%22/%3E%3C/svg%3E"><input id="input" value="editable">';
const doc = (body = sample, script = runtime, extra = '') => '<!doctype html><html><head>' + extra + '</head><body>' + body + '<script nonce="protection-test">' + script + '</script></body></html>';

// No provider-specific clipboard permission assumptions: this suite also runs
// in WebKit and Firefox. Actual clipboard round trips remain in Chromium suite.
test('component, nested documents, CSP, disabled JS and file URL boundaries', { timeout: 120000 }, async t => {
  const engine = process.env.CONTENT_PROTECTION_ENGINE || 'chromium';
  assert.ok(['chromium', 'firefox', 'webkit'].includes(engine), 'unknown engine must fail');
  let browser;
  try {
    if (engine === 'chromium') ({ browser } = await launchChromium(skillRoot, { headless: true }));
    else {
      const { api } = await loadPlaywrightApi(skillRoot);
      browser = await api[engine].launch({ headless: true });
    }
  } catch (error) {
    if (process.env.CONTENT_PROTECTION_REQUIRED === '1') throw error;
    t.skip('requested browser missing: ' + engine);
    return;
  }
  console.log('browser_engine=' + engine + ' browser_version=' + browser.version());
  const out = join(repoRoot, '_tmp/content-protection/boundaries');
  mkdirSync(out, { recursive: true });
  const temp = mkdtempSync(join(out, 'run-'));
  // Actual init output, only the missing product bundle is a declared fixture.
  const init = spawnSync(process.execPath, [join(skillRoot, 'scripts/init.mjs'), '--dir', join(temp, 'component'), '--name', 'protection-component', '--mode', 'component', '--entry', 'src/Fixture.tsx'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(init.status, 0, init.stderr);
  const componentOriginal = readFileSync(join(temp, 'component/index.html'), 'utf8');
  const component = componentOriginal.replace('<script id="qa-truth" type="application/json"></script>', '<script id="qa-truth" type="application/json">{"themeVars":{}}</script>');
  const bundle = 'Object.assign(window.__qaDemo,{states:{entry:{driver:"inject"}},mount(ctx){ctx.root.innerHTML=' + JSON.stringify(sample) + '},inject(){}});';
  const child = doc(sample, '');
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://local').pathname;
    if (path === '/component/assets/component.bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle); return; }
    if (path === '/component/assets/component.css') { res.setHeader('Content-Type', 'text/css'); res.end(''); return; }
    res.setHeader('Content-Type', 'text/html');
    if (path === '/csp') res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; script-src 'nonce-protection-test'; style-src 'nonce-protection-test'");
    if (path === '/csp-blocked') res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; script-src 'none'; style-src 'unsafe-inline'");
    if (path === '/csp-style-blocked') res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; script-src 'nonce-protection-test'; style-src 'none'");
    if (path === '/negative') { res.end(doc(sample, '')); return; }
    if (path === '/child') { res.end(child); return; }
    if (path === '/component/index.html') { res.end(component); return; }
    res.end(doc(sample, runtime, path === '/disabled' || path === '/csp-blocked' ? baseline : ''));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const run = async (name, action, contextOptions = {}) => {
    await t.test(name, async () => {
      const context = await browser.newContext(contextOptions);
      const page = await context.newPage();
      page.setDefaultTimeout(7000);
      await context.tracing.start({ screenshots: true, snapshots: true });
      try { await action(page); }
      catch (error) {
        await page.screenshot({ path: join(temp, name + '-' + engine + '.png') }).catch(() => {});
        await context.tracing.stop({ path: join(temp, name + '-' + engine + '.zip') }).catch(() => {});
        throw error;
      } finally { await context.close(); }
    });
  };
  const protectedText = async (scope, selector = '#text') => {
    await scope.locator(selector).dblclick();
    assert.equal(await scope.locator(selector).evaluate(el => String((el.getRootNode().getSelection?.() || el.ownerDocument.getSelection()) || '')), '');
  };
  const nativeActions = async page => {
    await page.evaluate(() => {
      window.nativeActions = [];
      for (const type of ['contextmenu', 'dragstart']) document.addEventListener(type, event => {
        if (event.target.id === 'image') window.nativeActions.push({ type, trusted: event.isTrusted, cancelled: event.defaultPrevented });
      });
    });
    await page.waitForFunction(() => document.querySelector('#image').naturalWidth > 0);
    const box = await page.locator('#image').boundingBox();
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + 35, { steps: 20 });
    await page.mouse.up();
    await page.locator('#image').click({ button: 'right', position: { x: 20, y: 20 } });
    await page.keyboard.press('Escape');
    return page.evaluate(() => window.nativeActions);
  };
  try {
    await run('component-shell', async page => {
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(origin + '/component/index.html');
      await page.waitForFunction(() => document.querySelector('#image')?.draggable === false);
      await protectedText(page);
      assert.equal(await page.locator('.qa-title').evaluate(userSelect), 'none');
      await page.locator('#input').fill('changed');
      await page.locator('[data-qa-pref="lang:en"]').click();
      assert.equal(await page.locator('#input').inputValue(), 'changed');
      assert.deepEqual(errors, []);
      assert.equal(await page.locator('style[data-content-protection-style]').count(), 1);
      const events = await nativeActions(page);
      assert.ok(!events.some(e => e.type === 'dragstart' && !e.cancelled));
      assert.ok(events.some(e => e.type === 'contextmenu' && e.trusted && e.cancelled));
    });
    await run('open-shadow-dom', async page => {
      await page.goto(origin);
      await page.evaluate(sample => {
        const host = document.createElement('section'); host.id = 'shadow';
        host.attachShadow({ mode: 'open' }).innerHTML = sample;
        document.body.append(host);
      }, sample);
      await page.waitForFunction(() => document.querySelector('#shadow').shadowRoot.querySelector('#image').draggable === false);
      await protectedText(page, '#shadow #text');
      await page.locator('#shadow #input').fill('shadow editable');
      assert.equal(await page.locator('#shadow #input').inputValue(), 'shadow editable');
      await page.evaluate(sample => {
        const host = document.createElement('section'); host.id = 'late-shadow'; document.body.append(host);
        host.attachShadow({ mode: 'open' }).innerHTML = sample;
      }, sample);
      await protectedText(page, '#late-shadow #text');
    });
    await run('same-origin-iframe-navigation', async page => {
      await page.goto(origin);
      await page.evaluate(url => { const f = document.createElement('iframe'); f.id = 'child-frame'; f.src = url; document.body.append(f); }, origin + '/child');
      const frame = page.frameLocator('#child-frame');
      await page.waitForFunction(() => document.querySelector('iframe').contentDocument?.querySelector('#image')?.draggable === false);
      await protectedText(frame);
      await frame.locator('#input').fill('frame editable');
      await page.locator('#child-frame').evaluate(el => { el.src += '?navigate=1'; });
      await page.waitForFunction(() => document.querySelector('iframe').contentDocument?.querySelector('#image')?.draggable === false);
      await protectedText(frame);
    });
    await run('opaque-iframe-explicitly-unverified', async page => {
      await page.goto(origin);
      await page.evaluate(() => { const f = document.createElement('iframe'); f.sandbox = ''; f.srcdoc = '<p>opaque</p>'; document.body.append(f); });
      await page.waitForFunction(() => document.querySelector('iframe').dataset.contentProtectionFrame === 'unverified');
      assert.equal(await page.locator('iframe').getAttribute('data-content-protection-frame'), 'unverified');
    });
    await run('strict-csp-nonce', async page => {
      await page.goto(origin + '/csp');
      await protectedText(page);
      assert.equal(await page.locator('style[data-content-protection-style]').evaluate(el => el.nonce), 'protection-test');
      assert.equal(await page.locator('#text').evaluate(userSelect), 'none');
    });
    await run('disabled-js-static-selection-only', async page => {
      await page.goto(origin + '/disabled');
      assert.equal(await page.locator('#text').evaluate(userSelect), 'none');
      assert.equal(await page.locator('html').getAttribute('data-content-protection'), null, 'no JS cannot promise event cancellation');
    }, { javaScriptEnabled: false });
    await run('csp-blocked-runtime-is-not-protected', async page => {
      await page.goto(origin + '/csp-blocked');
      assert.equal(await page.locator('html').getAttribute('data-content-protection'), null);
      assert.equal(await page.locator('#text').evaluate(userSelect), 'none');
    });
    await run('csp-style-blocked-runtime-is-partial', async page => {
      await page.goto(origin + '/csp-style-blocked');
      assert.equal(await page.locator('html').getAttribute('data-content-protection'), 'partial');
      assert.equal(await page.locator('style[data-content-protection-style]').evaluate(el => el.sheet === null), true);
      assert.equal(await page.locator('#image').evaluate(el => el.draggable), false);
    });
    await run('unprotected-native-action-control', async page => {
      await page.goto(origin + '/negative');
      const events = await nativeActions(page);
      for (const type of ['dragstart', 'contextmenu']) assert.ok(events.some(e => e.type === type && e.trusted && !e.cancelled), type + ' must work in the negative control');
    });
    await run('offline-file-url', async page => {
      const file = join(temp, 'offline.html'); writeFileSync(file, doc(sample, runtime, baseline));
      await page.goto(pathToFileURL(file).href);
      await protectedText(page);
      assert.equal(await page.locator('#image').evaluate(el => el.draggable), false);
    });
    await run('disabled-fieldset-and-live-body-replacement', async page => {
      await page.goto(origin);
      await page.evaluate(() => {
        const f = document.createElement('fieldset'); f.disabled = true; f.innerHTML = '<input id="disabled-child" value="locked">'; document.body.append(f);
      });
      assert.equal(await page.locator('#disabled-child').evaluate(el => !el.dispatchEvent(new Event('copy', { bubbles: true, cancelable: true }))), true);
      await page.evaluate(sample => { const body = document.createElement('body'); body.innerHTML = sample; document.body.replaceWith(body); }, sample);
      await page.waitForFunction(() => document.querySelector('#image').draggable === false);
      await protectedText(page);
    });
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
