import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTestBrowserEnv } from './helpers/browser-env.mjs';
import { openBrowserSession } from '../lib/browser-session.mjs';

applyTestBrowserEnv();

const SKILL_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function buildDemo() {
  const root = mkdtempSync(join(tmpdir(), 'ews-tracking-'));
  mkdirSync(join(root, 'runtime'));
  copyFileSync(join(SKILL_ROOT, 'assets/runtime/text-style.mjs'), join(root, 'runtime/text-style.mjs'));
  writeFileSync(join(root, 'index.html'), `<!doctype html><meta charset="utf-8"><body>
<script type="module">import * as ts from './runtime/text-style.mjs'; window.ts = ts; window.ready = true;</script>`);
  return root;
}

// Monospace words: the slot width is measured in-page, so the case does not depend on the font's advance.
// `between` picks a width between the 3-word line at tracking `a` and at tracking `b` (em).
async function fit(page, { locale, between, text = null, hint = false }) {
  return page.evaluate(({ locale, between, text, hint }) => {
    const font = 'font-family:monospace;font-size:20px;line-height:24px;font-weight:400;';
    const probe = (em) => {
      const s = document.createElement('span');
      s.style.cssText = `${font}white-space:nowrap;position:absolute;letter-spacing:${em}em;`;
      s.textContent = 'abcd abcd abcd';
      document.body.append(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return w;
    };
    const slot = (probe(between[0]) + probe(between[1])) / 2;
    document.body.innerHTML = '';
    const rootEl = document.createElement('div');
    rootEl.className = 'ews-root';
    rootEl.setAttribute('data-font-min-scale', '0.6');
    rootEl.setAttribute('data-locale', locale);
    rootEl.innerHTML = `<div class="ews-node" data-layout-h="HUG" data-max-width="${slot}" data-max-height="400"
      style="position:absolute;left:0;top:0;width:${slot}px;height:24px;">
      <div class="ews-node" data-node-id="t" data-figma-type="TEXT" data-autoresize="WIDTH_AND_HEIGHT"
        data-designed-lines="1" data-font-size="20" data-line-height="24"${hint ? ' data-break-hint="1"' : ''}
        style="position:absolute;left:0;top:0;${font}letter-spacing:0px;white-space:nowrap;"></div></div>`;
    document.body.append(rootEl);
    const el = rootEl.querySelector('[data-node-id="t"]');
    el.textContent = text ?? Array(9).fill('abcd').join(' ');
    window.ts.applyLocaleTextLayout(rootEl, locale, 'zh-CN');
    return {
      tracking: el.getAttribute('data-ews-tracking'),
      letterSpacing: el.style.letterSpacing,
      fontSize: el.style.fontSize,
      lines: Math.round(el.offsetHeight / 24),
      overflow: el.getAttribute('data-ews-overflow'),
      wordBreak: el.style.wordBreak,
      textWrap: el.style.getPropertyValue('text-wrap-style'),
      lang: el.getAttribute('lang'),
      firstLine: (() => { const r = document.createRange(); r.selectNodeContents(el); const rects = [...r.getClientRects()]; return rects.length; })(),
    };
  }, { locale, between, text, hint });
}

test('translation fit: tighten tracking last, only when it saves a line, never past -0.04em; source untouched', async () => {
  const s = await openBrowserSession({ skillRoot: SKILL_ROOT, demoDir: buildDemo() });
  try {
    const page = await s.browser.newPage();
    await page.goto(`${s.base}/index.html`);
    await page.waitForFunction(() => window.ready === true);
    assert.equal(await page.evaluate(() => window.ts.LOCALE_TRACKING_MIN_EM), -0.04);

    // 3 words miss the slot by a hair at 0 but fit at -0.01em: 5 lines become 3, font size kept.
    const saved = await fit(page, { locale: 'en', between: [0, -0.01] });
    assert.equal(saved.tracking, '-0.01');
    assert.equal(saved.lines, 3);
    assert.equal(saved.fontSize, '20px');
    assert.equal(saved.overflow, null);

    // A line would need more than -0.04em: tracking is restored, not left half-tightened.
    const tooFar = await fit(page, { locale: 'en', between: [-0.05, -0.06] });
    assert.equal(tooFar.tracking, null);
    assert.equal(tooFar.letterSpacing, '0px');
    assert.equal(tooFar.lines, 5);

    // Agent break point: lines end exactly where the agent put "\n" even when one line would fit the slot.
    const broken = await fit(page, { locale: 'en', between: [0, 0], text: 'abcd\nabcd abcd', hint: true });
    assert.equal(broken.lines, 2);
    assert.equal(broken.tracking, null);

    // Language wrap defaults on wrapped translations.
    const ja = await fit(page, { locale: 'ja', between: [0, -0.01] });
    assert.equal(ja.lang, 'ja');
    const ko = await fit(page, { locale: 'ko', between: [0, -0.01] });
    assert.equal(ko.wordBreak, 'keep-all');
    assert.equal(saved.textWrap, 'pretty');

    // Source locale keeps the designed tracking and box.
    const source = await fit(page, { locale: 'zh-CN', between: [0, -0.01] });
    assert.equal(source.tracking, null);
    assert.equal(source.letterSpacing, '0px');
  } finally {
    await s.close();
  }
});
