import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const INIT = join(ROOT, 'scripts/init.mjs');
const ONBOARD = join(ROOT, 'scripts/onboard.mjs');
const PREVIEW = join(ROOT, 'scripts/preview-first.mjs');
const HAS_BROWSER_DEPS = (() => {
  const res = spawnSync(process.execPath, ['-e', "import('./scripts/lib/resolve-playwright.mjs').then(m=>m.resolveModule('playwright', process.cwd())).catch(()=>import('./scripts/lib/resolve-playwright.mjs').then(m=>m.resolveModule('playwright-core', process.cwd()))).then(()=>process.exit(0),()=>process.exit(1))"], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    timeout: 30000,
  });
  return res.status === 0;
})();

function run(script, args, opts = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...(opts.env || {}) },
    timeout: opts.timeout || 120000,
  });
}

function tempDemo(name = 'first-visible-demo') {
  return join(mkdtempSync(join(tmpdir(), 'yise-first-visible-')), name);
}

function minimalTruth() {
  return {
    meta: { source: 'test-fixture' },
    sections: {
      '1:1': {
        meta: { x: 0, y: 0, width: 3840, height: 2160 },
        nodes: [
          {
            id: '1:2',
            name: 'source visible rect',
            type: 'RECTANGLE',
            box: { x: 100, y: 120, w: 320, h: 180 },
            style: { fills: [{ type: 'SOLID', color: '#ff3366', opacity: 1 }] },
            provenance: { source: 'test-fixture', locator: 'sections.1:1.nodes.0' }
          }
        ]
      }
    }
  };
}

test('figma:onboard accepts URL/token with optional missing translation as warning', () => {
  const res = run(ONBOARD, [
    '--check',
    '--url', 'https://www.figma.com/design/ABC123456789/Test?node-id=1-2',
    '--token-env', 'TEST_FIGMA_TOKEN'
  ], { env: { TEST_FIGMA_TOKEN: 'redacted-token' } });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.figma.fileKey, 'ABC123456789');
  assert.equal(out.figma.nodeId, '1-2');
  assert.equal(out.token.value, '<redacted>');
  assert.equal(out.translation.status, 'not-supplied');
  assert.ok(out.warnings.some((w) => w.code === 'translation-missing-single-language-preview'));
  const namingWarning = out.warnings.find((w) => w.code === 'figma-naming-v2.8-compatibility');
  assert.ok(namingWarning, 'onboard must expose current figma-naming v2.8 compatibility framing');
  assert.equal(namingWarning.standard, 'standards/figma-naming v2.8 / A-v1.6');
  assert.equal(namingWarning.compatibilityUntil, '2026-11-12');
  assert.equal(namingWarning.severity, 'warning');
  assert.match(namingWarning.message, /unprefixed TEXT is editable copy/);
  assert.match(namingWarning.message, /TEXT named img\/bg\/kv is a visual asset\/slice/);
  assert.match(namingWarning.message, /txt is not a standard prefix/);
  assert.match(namingWarning.message, /swpage is not required/);
  assert.match(namingWarning.message, /IMG\/Sec\/img-with-spaces/);
  assert.match(namingWarning.message, /full-width slash\/backslash/);
  assert.match(namingWarning.message, /unlabelled nodes must not be inferred as img\/switch/);
});

test('figma:onboard blocks missing translation only for multi-locale acceptance', () => {
  const res = run(ONBOARD, [
    '--check',
    '--url', 'https://www.figma.com/design/ABC123456789/Test?node-id=1-2',
    '--token-env', 'TEST_FIGMA_TOKEN',
    '--multi-locale'
  ], { env: { TEST_FIGMA_TOKEN: 'redacted-token' } });
  assert.notEqual(res.status, 0);
  const out = JSON.parse(res.stderr);
  assert.ok(out.errors.some((e) => e.code === 'translation-required-for-multi-locale'));
});

test('fresh figma init creates renderer-connected shell and embedded devices', () => {
  const dir = tempDemo();
  const res = run(INIT, ['--dir', dir, '--name', 'first-visible']);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.ok(existsSync(join(dir, 'fixtures/device-presets.json')));
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.match(html, /id="qa-devices"/);
  assert.match(html, /FIGMA_RENDER_BEGIN/);
  assert.match(html, /FIGMA_CHROME_BEGIN/);
  assert.match(html, /__figmaRender\.renderApp/);
  assert.doesNotMatch(html, /state=\$\{ctx\.state\}/);
});

test('figma:preview:first proves a visible Figma-derived source node when browser deps are installed', { timeout: 180000 }, (t) => {
  if (!HAS_BROWSER_DEPS) {
    t.skip('playwright/playwright-core is not installed in this public checkout; figma:preview:first remains the real browser command when dependencies are present');
    return;
  }
  const dir = tempDemo();
  const init = run(INIT, ['--dir', dir, '--name', 'first-visible-preview']);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  writeFileSync(join(dir, 'truth.json'), JSON.stringify(minimalTruth(), null, 2));
  let html = readFileSync(join(dir, 'index.html'), 'utf8');
  html = html.replace(/(<script id="qa-truth" type="application\/json">)([\s\S]*?)(<\/script>)/,
    '$1' + JSON.stringify(minimalTruth()).replaceAll('</script', '<\\/script') + '$3');
  writeFileSync(join(dir, 'index.html'), html);
  const res = run(PREVIEW, ['--demo', dir], { timeout: 180000 });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, true);
  assert.ok(out.result.visibleSourceNodes > 0);
  assert.equal(out.result.placeholder, false);
  assert.ok(existsSync(out.screenshot));
});
