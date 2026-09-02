import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { externalizeQaTruthIfOverLimit } from '../lib/html-volume.mjs';
import { playwrightBrowserSkipMessage, probePlaywrightCapability } from '../lib/runtime-capabilities.mjs';
import { parsePreviewJson } from '../figma-html-from-handoff.mjs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const INIT = join(ROOT, 'scripts/init.mjs');
const ONBOARD = join(ROOT, 'scripts/onboard.mjs');
const PREVIEW = join(ROOT, 'scripts/preview-first.mjs');
const PLAYWRIGHT_PROBE = probePlaywrightCapability(ROOT);
const HAS_BROWSER_DEPS = PLAYWRIGHT_PROBE.available;
const BROWSER_SKIP = playwrightBrowserSkipMessage(PLAYWRIGHT_PROBE);

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
            box: { x: 100, y: 120, w: 900, h: 260 },
            style: { fills: [{ type: 'SOLID', color: '#ff3366', opacity: 1 }] },
            provenance: { source: 'test-fixture', locator: 'sections.1:1.nodes.0' }
          },
          {
            id: '1:3',
            name: 'source visible title',
            type: 'TEXT',
            box: { x: 120, y: 420, w: 880, h: 120 },
            text: { characters: 'REAL FIGMA SHOWCASE', fontSize: 72, fills: [{ type: 'SOLID', color: '#ffffff', opacity: 1 }] },
            style: { fills: [{ type: 'SOLID', color: '#ffffff', opacity: 1 }] },
            provenance: { source: 'test-fixture', locator: 'sections.1:1.nodes.1' }
          },
          {
            id: '1:4',
            name: 'source visible cta',
            type: 'RECTANGLE',
            box: { x: 120, y: 580, w: 520, h: 140 },
            style: { fills: [{ type: 'SOLID', color: '#3366ff', opacity: 1 }] },
            provenance: { source: 'test-fixture', locator: 'sections.1:1.nodes.2' }
          }
        ]
      }
    }
  };
}

function blankFlatTruth() {
  return {
    meta: { source: 'test-fixture' },
    sections: {
      '1:1': {
        meta: { x: 0, y: 0, width: 3840, height: 2160 },
        nodes: [
          {
            id: '1:blank',
            name: 'one flat blank source image',
            type: 'RECTANGLE',
            box: { x: 0, y: 0, w: 3840, h: 2160 },
            style: { fills: [{ type: 'SOLID', color: '#101010', opacity: 1 }] },
            provenance: { source: 'test-fixture', locator: 'sections.1:1.nodes.0' }
          }
        ]
      }
    }
  };
}

function embedTruth(dir, truth) {
  writeFileSync(join(dir, 'truth.json'), JSON.stringify(truth, null, 2));
  let html = readFileSync(join(dir, 'index.html'), 'utf8');
  html = html.replace(/(<script id="qa-truth" type="application\/json">)([\s\S]*?)(<\/script>)/,
    '$1' + JSON.stringify(truth).replaceAll('</script', '<\\/script') + '$3');
  writeFileSync(join(dir, 'index.html'), html);
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

test('figma-showcase workflow is explicit, Figma-only, and does not claim mobile by default', () => {
  const dir = tempDemo('showcase-demo');
  const res = run(INIT, ['--dir', dir, '--name', 'figma-showcase-demo', '--workflow', 'figma-showcase']);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const out = JSON.parse(res.stdout);
  assert.equal(out.workflow, 'figma-showcase');
  assert.ok(out.next.some((line) => /preview-first/.test(line) && /product-view/.test(line)));
  const spec = JSON.parse(readFileSync(join(dir, 'spec.json'), 'utf8'));
  assert.equal(spec.workflow.id, 'figma-showcase');
  assert.equal(spec.workflow.requires.productRepo, false);
  assert.equal(spec.workflow.requires.trueSandbox, false);
  assert.equal(spec.workflow.requires.pullRequest, false);
  assert.deepEqual(spec.matrix.platforms, ['desktop']);
  assert.deepEqual(spec.verify.cases.map((c) => c.prefs.plat), ['desktop', 'desktop']);
  assert.ok(spec.workflow.claimedCapabilities.mobileSourcePlatform === 'not-claimed');
});

test('figma:preview:first proves a visible Figma-derived source node when browser deps are installed', { timeout: 180000 }, (t) => {
  if (!HAS_BROWSER_DEPS) {
    t.skip(BROWSER_SKIP);
    return;
  }
  const dir = tempDemo();
  const init = run(INIT, ['--dir', dir, '--name', 'first-visible-preview']);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  embedTruth(dir, minimalTruth());
  const res = run(PREVIEW, ['--demo', dir], { timeout: 180000 });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const out = parsePreviewJson(res.stdout);
  assert.equal(out?.ok, true, res.stderr || res.stdout);
  assert.ok(out.result.visibleSourceNodes > 0);
  assert.ok(out.result.meaningfulSourceNodes >= 2);
  assert.ok(out.result.meaningfulCoverage >= 0.02);
  assert.equal(out.result.placeholder, false);
  assert.equal(out.evidenceLevel, 'candidate');
  assert.match(out.productView.url, /product=1/);
  assert.match(out.humanView.url, /index\.html$/);
  assert.doesNotMatch(out.humanView.url, /product=1/);
  assert.equal(out.result.hasQa, false, 'preview-first must inspect product view, not QA shell');
  assert.ok(out.unclaimedCapabilities.includes('mobileSourcePlatform'));
  assert.ok(existsSync(out.screenshot));
});

test('figma:preview:first rejects one flat source region over a blank page', { timeout: 180000 }, (t) => {
  if (!HAS_BROWSER_DEPS) {
    t.skip(BROWSER_SKIP);
    return;
  }
  const dir = tempDemo('blank-page-demo');
  const init = run(INIT, ['--dir', dir, '--name', 'blank-page-demo', '--workflow', 'figma-showcase']);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  embedTruth(dir, blankFlatTruth());
  const res = run(PREVIEW, ['--demo', dir], { timeout: 180000 });
  assert.equal(res.status, 2, res.stderr || res.stdout);
  const out = parsePreviewJson(res.stdout) || parsePreviewJson(res.stderr);
  assert.equal(out?.ok, false, res.stderr || res.stdout);
  assert.equal(out.evidenceLevel, 'none');
  assert.ok(out.contractFailures.some((msg) => /meaningful source nodes|single flat source region/.test(msg)), out.contractFailures.join('\n'));
  /* 红路径不发货：URL 与命令都必须为 null（#66 契约），不能再断言 product=1 链接。 */
  assert.equal(out.productView.url, null);
  assert.equal(out.productView.command, null);
  assert.equal(out.productView.blocked, true);
  assert.ok(existsSync(out.screenshot));
});

test('figma:preview:first serves external truth over HTTP and fails file:// (issue #61)', { timeout: 180000 }, (t) => {
  if (!HAS_BROWSER_DEPS) {
    t.skip(BROWSER_SKIP);
    return;
  }
  const dir = tempDemo('external-truth-demo');
  const init = run(INIT, ['--dir', dir, '--name', 'external-truth-demo', '--workflow', 'figma-showcase']);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  embedTruth(dir, minimalTruth());
  const volume = externalizeQaTruthIfOverLimit(dir, { limitBytes: 40 });
  assert.equal(volume.action, 'externalized');
  assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /data-src="truth.json"/);

  const httpRes = run(PREVIEW, ['--demo', dir], { timeout: 180000 });
  assert.equal(httpRes.status, 0, httpRes.stderr || httpRes.stdout);
  const httpOut = parsePreviewJson(httpRes.stdout);
  assert.equal(httpOut?.ok, true, httpRes.stderr || httpRes.stdout);
  assert.equal(httpOut.protocol, 'http');
  assert.equal(httpOut.externalTruth, true);
  assert.match(httpOut.checkUrl, /^http:\/\/127\.0\.0\.1:\d+\/index\.html\?product=1/);
  assert.match(httpOut.productView.url, /^file:/);
  assert.match(httpOut.productView.url, /product=1/);
  assert.match(httpOut.humanView.url, /^file:/);
  assert.doesNotMatch(httpOut.humanView.url, /product=1/);

  const fileRes = run(PREVIEW, ['--demo', dir, '--protocol', 'file'], { timeout: 180000 });
  assert.equal(fileRes.status, 2, fileRes.stderr || fileRes.stdout);
  const fileOut = parsePreviewJson(fileRes.stdout) || parsePreviewJson(fileRes.stderr);
  assert.equal(fileOut?.ok, false, fileRes.stderr || fileRes.stdout);
  assert.equal(fileOut.protocol, 'file');
  assert.ok((fileOut.contractFailures || []).some((msg) => /file:\/\//.test(msg) || /data-src/.test(msg)), (fileOut.contractFailures || []).join('\n'));
  assert.equal(fileOut.checkUrl, undefined, 'file:// external truth must fail before launching a browser');
});
