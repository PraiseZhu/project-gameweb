import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyTestBrowserEnv, browserTestOptions } from './helpers/browser-env.mjs';
import { buildSyntheticDemo } from './helpers/build-demo.mjs';
import { runProductViewport, assertContentAlign } from '../product-viewport.mjs';
import { viewportPlanFromPack } from '../lib/viewport-plan.mjs';
import { loadReadyPack } from '../lib/handoff-contract.mjs';
import { isProductView } from '../../assets/runtime/qa-toolbar.mjs';

applyTestBrowserEnv();

test('viewport alignment accepts bottom-bar fitting but still rejects misplaced content', () => {
  const metrics = {
    key: 'schedule', innerH: 844, screenTop: 0, worldTop: 75.515625,
    worldH: 866.864868, contentH: 1624, canvasScale: 1,
    contentTop: 162, contentBottom: 1346, barH: 50,
    alignAttr: 'center', bleedNames: [], pinBottom: 844, navTop: 0,
  };
  const valid = [];
  assertContentAlign(valid, 'mobile', metrics);
  assert.deepEqual(valid, []);
  const invalid = [];
  assertContentAlign(invalid, 'mobile', { ...metrics, worldTop: 0 });
  assert.ok(invalid.some((line) => line.includes('worldTop=0')));
});

test('product query hides toolbar; other views do not', () => {
  assert.equal(isProductView('?product=1'), true);
  assert.equal(isProductView('product=1'), true);
  assert.equal(isProductView('product=true'), true);
  assert.equal(isProductView(''), false);
  assert.equal(isProductView('?foo=1'), false);
});

test('viewport plan uses inventory sec/ keys; footer only when declared', () => {
  const { out, handoff } = buildSyntheticDemo('ews-plan-');
  const pack = loadReadyPack(handoff);
  const model = JSON.parse(readFileSync(`${out}/model.json`, 'utf8'));
  const pc = viewportPlanFromPack({ model, pack, device: 'pc' });
  assert.equal(pc.ok, true, pc.problems.join('\n'));
  assert.deepEqual(pc.screens.map((row) => row.key), ['hero', 'gallery']);
  assert.equal(pc.footer?.sectionId, '100:12');
  assert.ok(!pc.keys.includes('hero') || pc.screens[0].sectionId === '100:2');

  const uncovered = JSON.parse(JSON.stringify(model));
  uncovered.platforms.pc.footer = null;
  const missing = viewportPlanFromPack({ model: uncovered, pack, device: 'pc' });
  assert.equal(missing.hasFooter, false);
  assert.match(missing.problems.join('\n'), /100:12/);

  const noFooter = JSON.parse(JSON.stringify(model));
  noFooter.platforms.pc.footer = null;
  noFooter.platforms.pc.screens = [
    ...noFooter.platforms.pc.screens,
    { key: 'tail', sectionId: '100:12' },
  ];
  const optional = viewportPlanFromPack({ model: noFooter, pack, device: 'pc' });
  assert.equal(optional.ok, true, optional.problems.join('\n'));
  assert.equal(optional.hasFooter, false);
  assert.deepEqual(optional.keys, ['hero', 'gallery', 'tail']);
});

test('product-viewport source does not hardcode hero/gallery/footer keys', () => {
  const src = readFileSync(fileURLToPath(new URL('../product-viewport.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(src, /goTo\('gallery'\)/);
  assert.doesNotMatch(src, /goTo\('hero'\)/);
  assert.doesNotMatch(src, /page\.click\('\[data-modal-open\]'\)/);
  assert.doesNotMatch(src, /data-screen="gallery"/);
  assert.doesNotMatch(src, /data-screen="hero"/);
  assert.doesNotMatch(src, /createElement\(/);
  assert.doesNotMatch(src, /insertAdjacentHTML/);
  assert.match(src, /determined modal-trigger/);
  assert.match(src, /uniqueModalTargets/);
  assert.match(src, /product=1&interaction=1/);
  assert.match(src, /静态态/);
  assert.doesNotMatch(src, /key: 'Escape'/);
  assert.doesNotMatch(src, /sizerH \+ 2 < height/);
  assert.doesNotMatch(src, /whiteRatio/);
  assert.doesNotMatch(src, /r > 245/);
  assert.match(src, /width: 998/);
  assert.match(src, /height: 844/);
  assert.match(src, /width: 1107/);
  assert.match(src, /height: 810/);
  assert.match(src, /naturalWidth/);
  assert.match(src, /coveringCount/);
  assert.match(src, /worldOffsetY/);
  assert.match(src, /assertScreensContentAlign/);
  assert.match(src, /assertShortScreenReach/);
  assert.match(src, /auditTextFit/);
  assert.match(src, /语言自称/);
  assert.match(src, /shortReach/);
  assert.match(src, /pointerEvents/);
  assert.match(src, /LANG_SELF_LABELS/);
  assert.doesNotMatch(src, /name: 'pc-998'[^\n]*lite: true/);
  assert.doesNotMatch(src, /name: 'pc-751'[^\n]*lite: true/);
  assert.match(src, /name: 'pc-1107'[^\n]*lite: true/);
  assert.match(src, /name: 'pc-1440-fit'[^\n]*lite: true/);
});

test('missing demo is red without skip', async () => {
  const result = await runProductViewport(['--demo', '/no-such-demo', '--handoff', '/no-such-handoff']);
  assert.equal(result.ok, false);
});

test('synthetic 390/1440/750/751/short product viewport is live or fail-closed', browserTestOptions({ timeout: 180000 }), async () => {
  const { out, handoff } = buildSyntheticDemo('ews-product-');
  const result = await runProductViewport([
    '--demo', out,
    '--handoff', handoff,
    '--artifacts', `${out}/artifacts/stop1`,
  ], { cwd: out });
  if (result.ok) {
    assert.equal(result.cases.length, 10);
    assert.equal(result.cases.find((row) => row.name === 'mobile-390').expectDevice, 'mobile');
    assert.equal(result.cases.find((row) => row.name === 'pc-751').expectDevice, 'pc');
    assert.equal(result.cases.find((row) => row.name === 'pc-998').expectDevice, 'pc');
    assert.equal(result.cases.find((row) => row.name === 'pc-1107').width, 1107);
    assert.equal(result.cases.find((row) => row.name === 'pc-1440-fit').height, 810);
    assert.equal(result.resizes.length, 8);
    assert.deepEqual(result.plans.pc.screens, ['hero', 'gallery']);
    assert.equal(result.plans.pc.footer, '100:12');
    assert.deepEqual(result.cases.find((row) => row.name === 'pc-1440').screens, ['hero', 'gallery']);
    return;
  }
  const text = (result.problems || []).join('\n');
  assert.match(text, /无法启动 Chromium|缺少仓内 stop1|ready pack|交接/);
});
