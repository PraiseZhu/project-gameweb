import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTestBrowserEnv, browserTestOptions } from './helpers/browser-env.mjs';
import { openBrowserSession, waitEwsBoot } from '../lib/browser-session.mjs';
import { runEwsWeb } from '../ews-web.mjs';
import {
  defaultConfig,
  defaultDesignations,
  makeLark,
  mobileInventory,
  pcInventory,
  writeAssets,
  writeReadyPack,
} from './helpers/ready-fixture.mjs';

applyTestBrowserEnv();

const SKILL_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function buildDemo() {
  const root = mkdtempSync(join(tmpdir(), 'ews-reveal-'));
  const handoff = join(root, 'handoff');
  const docs = writeReadyPack(handoff, { pc: pcInventory(), mobile: mobileInventory() });
  const assetsDir = join(root, 'assets');
  writeAssets(assetsDir, docs);
  writeFileSync(join(root, 'config.json'), `${JSON.stringify(defaultConfig(), null, 2)}\n`);
  writeFileSync(join(root, 'lark.json'), `${JSON.stringify(makeLark(), null, 2)}\n`);
  writeFileSync(join(root, 'designations.json'), `${JSON.stringify(defaultDesignations(), null, 2)}\n`);
  const out = join(root, 'out');
  const built = runEwsWeb([
    '--handoff', handoff,
    '--assets', join(assetsDir, 'asset-map.json'),
    '--config', join(root, 'config.json'),
    '--lark', join(root, 'lark.json'),
    '--designations', join(root, 'designations.json'),
    '--out', out,
  ], { cwd: root });
  if (!built.ok) throw new Error((built.problems || []).join('\n'));
  return out;
}

// Variant layers / modals start [hidden]; text layout skips them. Revealing one must
// re-run the translation layout, otherwise the shown layer keeps raw designed boxes.
test('revealing a hidden subtree re-runs translation text layout', browserTestOptions(), async () => {
  const session = await openBrowserSession({ skillRoot: SKILL_ROOT, demoDir: buildDemo() });
  assert.equal(session.ok, true, (session.problems || []).join('; '));
  try {
    const page = await session.browser.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${session.base}/index.html?product=1&interaction=1`);
    await waitEwsBoot(page);
    await page.evaluate(() => window.__ewsStop1.setLocale('en'));
    await page.waitForTimeout(300);
    const result = await page.evaluate(async () => {
      const text = [...document.querySelectorAll('.ews-screen [data-figma-type="TEXT"]')]
        .find((el) => el.getBoundingClientRect().width > 0 && el.hasAttribute('data-designed-w'));
      if (!text) return { found: false };
      const host = document.createElement('div');
      host.hidden = true;
      const clone = text.cloneNode(true);
      clone.style.width = '1px';
      host.appendChild(clone);
      text.parentElement.appendChild(host);
      await new Promise((r) => setTimeout(r, 30));
      const whileHidden = clone.style.width;
      host.hidden = false;
      await new Promise((r) => setTimeout(r, 30));
      return { found: true, whileHidden, afterReveal: clone.style.width, laidOut: text.style.width };
    });
    assert.equal(result.found, true, 'fixture needs a laid-out text node');
    assert.equal(result.whileHidden, '1px');
    assert.equal(result.afterReveal, result.laidOut);
  } finally {
    await session.close();
  }
});
