import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  copyReferencedFonts,
  copyReferencedLocalFiles,
  leftoverLiveAssetRefs,
  mergeAssetDir,
  replaceableAssetFileName,
  sanitizeCapturedHtml,
  withinProject,
} from '../freeze/capture-static-html.mjs';
import {
  applyConfirmedCopyOverlay,
  applyConfirmedFashionBoxOverlay,
  CONFIRMED_FASHIONBOX_FILE,
  CONFIRMED_FASHIONBOX_SRC,
  CONFIRMED_PRIZE_PC_FILE,
  CONFIRMED_PRIZE_PC_SRC,
  CONFIRMED_DATE_PC_FILE,
  CONFIRMED_DATE_PC_SRC,
  CONFIRMED_DATE_MOBILE_FILE,
  CONFIRMED_DATE_MOBILE_SRC,
  CONFIRMED_DATE_PC_NODIV_FILE,
  CONFIRMED_DATE_PC_NODIV_SRC,
  CONFIRMED_DATE_MOBILE_NODIV_FILE,
  CONFIRMED_DATE_MOBILE_NODIV_SRC,
  stripConfirmedSec10Bullets,
} from '../freeze/confirmed-deploy-overlay.mjs';
import {
  LOCALE_PAGES,
  freezePagesForDemo,
  localeFromHtmlLang,
  normalizeLocale,
  reservationModalsToKeep,
  reservationModalsToStrip,
  shouldStripLanguageSwitcher,
} from '../freeze/static-locale.mjs';
import { writeOpsShell, writeReplaceableIndex, removeDeliverySidecars } from '../freeze/freeze-ops.mjs';

const RUNTIME = 'function applyAdaptive(){ document.documentElement.setAttribute("data-plat", "pc"); }';
const STATIC_RUNTIME = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../freeze/static-runtime.js'), 'utf8');

function sampleHtml({ locale = 'cn', extra = '' } = {}) {
  const langMenu = '<div class="fx-named" data-name="dropmenu/多语言" data-dropmenu-name="多语言"><span>语言</span></div>';
  const modals = [
    'pc_cn预约弹窗',
    'pc_tw预约弹窗',
    'pc_en预约弹窗',
    'pc_kr预约弹窗',
    'mobile_cn预约弹窗',
    'mobile_tw预约弹窗',
    'mobile_en预约弹窗',
    'mobile_kr预约弹窗',
  ].map((name) => `<div class="fx-named-modal" data-modal-name="${name}">${name}</div>`).join('');
  return `<!doctype html><html lang="zh-CN"><body>
<img data-asset="模块2玩法截图" data-asset-platform="pc" data-asset-lang="${locale}" src="data:image/png;base64,aaaa">
<img data-debug="drop-me" src="./keep.png">
${langMenu}
${modals}
${extra}
</body></html>`;
}

test('LOCALE_PAGES all capture the live index.html with lang/region', () => {
  assert.equal(LOCALE_PAGES.length, 4);
  for (const page of LOCALE_PAGES) {
    assert.equal(page.source, 'index.html');
    assert.match(page.out, /\.static\.html$/);
  }
  assert.deepEqual(LOCALE_PAGES.map((page) => [page.locale, page.lang, page.region]), [
    ['cn', 'zh-CN', 'cn'],
    ['tw', 'zh-TW', 'global'],
    ['en', 'en', 'global'],
    ['ko', 'ko', 'global'],
  ]);
});

test('this landing freeze adds Japanese from spec.matrix.langs; generic default stays four pages', () => {
  assert.equal(freezePagesForDemo('').length, 4);
  const dir = mkdtempSync(join(tmpdir(), 'torchlight-freeze-ja-'));
  writeFileSync(join(dir, 'spec.json'), JSON.stringify({
    matrix: { langs: ['zh-CN', 'zh-TW', 'en', 'ja', 'ko'] },
  }));
  const pages = freezePagesForDemo(dir);
  assert.deepEqual(pages.map((page) => [page.locale, page.lang, page.region, page.out]), [
    ['cn', 'zh-CN', 'cn', 'cn.static.html'],
    ['tw', 'zh-TW', 'global', 'tw.static.html'],
    ['en', 'en', 'global', 'en.static.html'],
    ['ja', 'ja', 'global', 'ja.static.html'],
    ['ko', 'ko', 'global', 'ko.static.html'],
  ]);
  assert.equal(normalizeLocale('ja'), 'ja');
  assert.equal(normalizeLocale('jp'), 'ja');
  assert.equal(localeFromHtmlLang('ja'), 'ja');
  const jaKeep = reservationModalsToKeep('ja');
  assert.equal(jaKeep.some((name) => name.includes('_en预约')), false);
  assert.deepEqual(reservationModalsToKeep('ja', ['pc_jp预约弹窗']), ['pc_jp预约弹窗']);
  assert.equal(shouldStripLanguageSwitcher('ja'), false);
});

test('sanitize keeps replaceable data-asset attrs and drops unused data-*', () => {
  const html = sanitizeCapturedHtml(sampleHtml({ locale: 'cn' }), RUNTIME, 'cn');
  assert.match(html, /data-asset="模块2玩法截图"/);
  assert.match(html, /data-asset-platform="pc"/);
  assert.match(html, /data-asset-lang="cn"/);
  assert.doesNotMatch(html, /data-debug=/);
});

test('sanitize keeps covering-plate tail attrs for freeze runtime', () => {
  const html = sanitizeCapturedHtml(sampleHtml({
    locale: 'cn',
    extra: '<div data-name="bg/mobile" data-hero-visual-plane="bg-tail" data-hero-visual-clip="1334" data-hero-bg-follow="after-hero-slices" data-hero-bg-follow-y="-138"></div>',
  }), STATIC_RUNTIME, 'cn');
  assert.match(html, /data-hero-visual-plane="bg-tail"/);
  assert.match(html, /data-hero-visual-clip="1334"/);
  assert.match(html, /data-hero-bg-follow="after-hero-slices"/);
  assert.match(html, /data-hero-bg-follow-y="-138"/);
});

test('sanitize keeps unbound and missing copy marks', () => {
  const html = sanitizeCapturedHtml(sampleHtml({
    locale: 'en',
    extra: '<div class="fx-t" data-node="copy-a" data-copy-unbound="en">source</div><div class="fx-t" data-node="copy-b" data-copy-missing="en"></div><div data-debug="drop-me"></div>',
  }), RUNTIME, 'en');
  assert.match(html, /data-copy-unbound="en"/);
  assert.match(html, /data-copy-missing="en"/);
  assert.doesNotMatch(html, /data-debug=/);
});

test('sanitize keeps switch and carousel protocol attrs for stop-2 freeze', () => {
  const html = sanitizeCapturedHtml(sampleHtml({
    locale: 'en',
    extra: '<div data-switch="hero" data-switch-owner="true" data-motion-carousel="1" data-swpage="0" data-modal-return="pc_en预约弹窗" data-skipped-al-source="1119:4715" data-source-top="12"></div>',
  }), RUNTIME, 'en');
  assert.match(html, /data-switch="hero"/);
  assert.match(html, /data-switch-owner="true"/);
  assert.match(html, /data-motion-carousel="1"/);
  assert.match(html, /data-swpage="0"/);
  assert.match(html, /data-modal-return="pc_en预约弹窗"/);
  assert.match(html, /data-skipped-al-source="1119:4715"/);
  assert.match(html, /data-source-top="12"/);
});

test('CN freeze strips language switcher; overseas keeps own reservation modal', () => {
  assert.equal(shouldStripLanguageSwitcher('cn'), true);
  assert.equal(shouldStripLanguageSwitcher('tw'), false);
  const cn = sanitizeCapturedHtml(sampleHtml({ locale: 'cn' }), RUNTIME, 'cn');
  assert.doesNotMatch(cn, /dropmenu\/多语言/);
  for (const name of reservationModalsToKeep('cn')) {
    assert.equal(cn.includes(`data-modal-name="${name}"`), true, name);
  }
  for (const name of reservationModalsToStrip('cn')) {
    assert.equal(cn.includes(`data-modal-name="${name}"`), false, name);
  }

  const tw = sanitizeCapturedHtml(sampleHtml({ locale: 'tw' }), RUNTIME, 'tw');
  assert.match(tw, /dropmenu\/多语言/);
  for (const name of reservationModalsToKeep('tw')) {
    assert.equal(tw.includes(`data-modal-name="${name}"`), true, name);
  }
  assert.doesNotMatch(tw, /pc_en预约弹窗/);
  assert.doesNotMatch(tw, /pc_kr预约弹窗/);

  const ko = sanitizeCapturedHtml(sampleHtml({ locale: 'ko' }), RUNTIME, 'ko');
  for (const name of reservationModalsToKeep('ko')) {
    assert.equal(ko.includes(`data-modal-name="${name}"`), true, name);
    assert.match(name, /_kr预约/);
  }

  const ja = sanitizeCapturedHtml(sampleHtml({ locale: 'ja' }), RUNTIME, 'ja');
  assert.match(ja, /dropmenu\/多语言/);
  for (const name of reservationModalsToKeep('ja')) {
    assert.equal(ja.includes(`data-modal-name="${name}"`), true, name);
    assert.match(name, /_en预约/);
  }
  assert.doesNotMatch(ja, /pc_cn预约弹窗/);
  assert.doesNotMatch(ja, /pc_kr预约弹窗/);
});

test('overseas freeze physically deletes unreachable CN age and language option', () => {
  const html = sanitizeCapturedHtml(sampleHtml({
    locale: 'en',
    extra: '<div class="fx-named-modal" data-modal-name="pc_cn适龄提示弹窗">适龄</div><div data-name="简体中文">简体中文</div><img data-name="img/按钮背景" alt="img/按钮背景" src="./keep.png">',
  }), RUNTIME, 'en');
  assert.doesNotMatch(html, /pc_cn适龄提示弹窗/);
  assert.doesNotMatch(html, /data-name="简体中文"/);
  assert.match(html, /alt=""/);
});

test('leftover live asset refs in CSS fail closed', () => {
  const html = '<style>.x{background:url(assets/1119-2985.webp)}</style><img src="./static-assets/ok.webp">';
  assert.deepEqual(leftoverLiveAssetRefs(html), ['assets/1119-2985.webp']);
});

test('replaceable files keep assetKey in the name; empty index is legal', () => {
  assert.equal(
    replaceableAssetFileName({ assetKey: '模块2玩法截图', platform: 'pc', lang: 'zh-CN', ext: 'png', digest: 'deadbeef' }),
    'replaceable-模块2玩法截图-pc-zh-CN.png',
  );
  assert.equal(
    replaceableAssetFileName({ assetKey: '', platform: 'mobile', lang: 'en', ext: 'webp', digest: 'abc123' }),
    'img-abc123.webp',
  );

  const dir = mkdtempSync(join(tmpdir(), 'torchlight-freeze-empty-'));
  writeFileSync(join(dir, 'cn.static.html'), '<!doctype html><title>cn</title>\n');
  writeFileSync(join(dir, 'tw.static.html'), '<!doctype html><title>tw</title>\n');
  writeFileSync(join(dir, 'en.static.html'), '<!doctype html><title>en</title>\n');
  writeFileSync(join(dir, 'ko.static.html'), '<!doctype html><title>ko</title>\n');
  const empty = writeReplaceableIndex(dir);
  assert.equal(empty.count, 0);
  assert.deepEqual(empty.byRegion, {});
  assert.equal(existsSync(join(dir, 'cn', 'replaceable-index.json')), false);
  assert.equal(existsSync(join(dir, 'global', 'replaceable-index.json')), false);
});

test('delivery directory does not keep the QA shell or review indexes', () => {
  const demo = mkdtempSync(join(tmpdir(), 'torchlight-delivery-'));
  const frozen = join(demo, 'frozen');
  const review = join(demo, 'review');
  mkdirSync(frozen, { recursive: true });
  writeFileSync(join(frozen, 'en.static.html'), '<!doctype html><title>en</title>');
  writeFileSync(join(frozen, 'index.html'), 'old shell');
  writeFileSync(join(frozen, 'freeze-manifest.json'), '{}');
  mkdirSync(join(frozen, 'global'), { recursive: true });
  writeFileSync(join(frozen, 'global', 'replaceable-index.json'), '{}');
  removeDeliverySidecars(frozen);
  const shell = writeOpsShell(review, { interaction: false, pageHref: '../frozen/' });
  assert.equal(existsSync(join(frozen, 'index.html')), false);
  assert.equal(existsSync(join(frozen, 'freeze-manifest.json')), false);
  assert.equal(existsSync(join(frozen, 'global', 'replaceable-index.json')), false);
  assert.match(readFileSync(shell, 'utf8'), /\.\.\/frozen\/en\.static\.html/);
});

test('frozen index is the main QA shell wrapping locale static pages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'torchlight-ops-'));
  mkdirSync(dir, { recursive: true });
  const stop1 = writeOpsShell(dir, { interaction: false });
  const html1 = readFileSync(stop1, 'utf8');
  assert.match(html1, /data-ops-interaction="0"/);
  assert.match(html1, /id="qa-truth"/);
  assert.match(html1, /id="qa-devices"/);
  assert.match(html1, /id="qa-design-policy"/);
  assert.match(html1, /figma-acceptance-harness|qa-language-select|FIGMA_CHROME_BEGIN/);
  assert.match(html1, /qa-frozen-frame/);
  assert.match(html1, /\.\/cn\.static\.html/);
  assert.match(html1, /\.\/tw\.static\.html/);
  assert.match(html1, /\.\/en\.static\.html/);
  assert.match(html1, /\.\/ko\.static\.html/);
  assert.match(html1, /"label":"CN"/);
  assert.match(html1, /"label":"Global"/);
  assert.match(html1, /row2\.appendChild\(grp\(region\.label/);
  assert.doesNotMatch(html1, /html\[data-ops-interaction="0"\] iframe\.qa-frozen-frame \{ pointer-events: none; \}/);
  assert.doesNotMatch(html1, /data-ops-lang=/);
  const demoBlock = html1.slice(html1.indexOf('window.__qaDemo'), html1.indexOf('/* FIGMA_CHROME_BEGIN'));
  assert.match(demoBlock, /iframe\.qa-frozen-frame/);
  assert.match(demoBlock, /region === 'cn'/);
  assert.match(demoBlock, /armFrozenDoc/);
  assert.match(demoBlock, /frame\.style\.overflowY = 'hidden'/);
  assert.match(html1, /function lockRegionLang\(\)/);
  assert.match(html1, /S\.prefs\.region === 'cn' && it\.v !== 'zh-CN'/);
  assert.match(html1, /S\.prefs\.region === 'global' && it\.v === 'zh-CN'/);
  assert.match(html1, /function frozenFrame\(\)/);
  assert.match(html1, /data-qa-commenting/);
  assert.match(html1, /overflow: hidden !important/);
  assert.doesNotMatch(demoBlock, /__figmaRender/);
  assert.doesNotMatch(html1, /FIGMA_RENDER_BEGIN/);
  assert.doesNotMatch(html1, /templates\/figma-render\.js/);
  assert.match(html1, /FIGMA_CHROME_BEGIN \*\/\n\/\* figma-chrome\.js/);
  assert.match(html1, /qa-language-select/);
  assert.match(html1, /figma-acceptance-harness/);
  assert.match(html1, /简体中文/);
  assert.match(html1, /繁體中文/);
  assert.match(html1, /English/);
  assert.match(html1, /한국어/);
  assert.doesNotMatch(html1, /\.\/ja\.static\.html/);
  assert.doesNotMatch(html1, /"v":"ja"/);
  assert.doesNotMatch(html1, /data-ops-region=/);

  writeOpsShell(dir, {
    interaction: false,
    pages: freezePagesForDemo((() => {
      const landing = mkdtempSync(join(tmpdir(), 'torchlight-ops-ja-'));
      writeFileSync(join(landing, 'spec.json'), JSON.stringify({
        matrix: { langs: ['zh-CN', 'zh-TW', 'en', 'ja', 'ko'] },
      }));
      return landing;
    })()),
  });
  const htmlJa = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.match(htmlJa, /\.\/ja\.static\.html/);
  assert.match(htmlJa, /"v":"ja"/);
  assert.match(htmlJa, /"label":"日本語"/);

  writeOpsShell(dir, { interaction: true });
  const html2 = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.match(html2, /data-ops-interaction="1"/);
  assert.match(html2, /qa-language-select|FIGMA_CHROME_BEGIN/);
  assert.match(html2, /"label":"CN"/);
  assert.match(html2, /"label":"Global"/);
});

test('copyReferencedFonts keeps Apple local() and copies relative font files', async () => {
  const source = mkdtempSync(join(tmpdir(), 'torchlight-fonts-src-'));
  const staging = mkdtempSync(join(tmpdir(), 'torchlight-fonts-stage-'));
  mkdirSync(join(source, 'assets', 'fonts'), { recursive: true });
  writeFileSync(join(source, 'assets', 'fonts', 'NotoSansSC-VF.ttf'), 'font-bytes');
  const html = `<style>
@font-face{font-family:"FX Apple SD Gothic Neo";src:local("Apple SD Gothic Neo Regular");font-weight:100 900}
@font-face{font-family:"Noto Sans SC";src:url("assets/fonts/NotoSansSC-VF.ttf") format("truetype")}
</style>`;
  const result = await copyReferencedFonts({
    html,
    sourceDir: source,
    stagingAssets: staging,
    assetsHref: './static-assets/',
  });
  assert.match(result.html, /src:local\("Apple SD Gothic Neo Regular"\)/);
  assert.match(result.html, /url\("\.\/static-assets\/font-NotoSansSC-VF\.ttf"\)/);
  assert.equal(existsSync(join(staging, 'font-NotoSansSC-VF.ttf')), true);
  assert.deepEqual(result.copied, ['font-NotoSansSC-VF.ttf']);
});

test('confirmed overlay strips EN/KO sec10 bullets and leaves CN/TW/JA alone', () => {
  const prev = process.env.TORCHLIGHT_CONFIRMED_OVERLAY;
  process.env.TORCHLIGHT_CONFIRMED_OVERLAY = '1';
  try {
  const extra = [
    '<div>• Built-in Pactspirit effect lookup</div>',
    '<div>• Improved Compass Placement</div>',
    '<div>• Auto Memory Crafting</div>',
    '<div>• Faster loot drops</div>',
    '<div>• 정령 적용 여부 확인 페이지 내장</div>',
    '<div>• 나침반 배치 편의성 개선</div>',
    '<div>• 추억 자동 제작</div>',
    '<div>• 드롭 속도 증가</div>',
    '<div>• Keep other bullets</div>',
  ].join('');
  const en = sanitizeCapturedHtml(sampleHtml({ locale: 'en', extra }), RUNTIME, 'en');
  assert.match(en, />Built-in Pactspirit effect lookup</);
  assert.match(en, />Improved Compass Placement</);
  assert.match(en, />Auto Memory Crafting</);
  assert.match(en, />Faster loot drops</);
  assert.doesNotMatch(en, /• Built-in Pactspirit/);
  assert.match(en, />• Keep other bullets</);
  const ko = sanitizeCapturedHtml(sampleHtml({ locale: 'ko', extra }), RUNTIME, 'ko');
  assert.match(ko, />정령 적용 여부 확인 페이지 내장</);
  assert.doesNotMatch(ko, /• 정령 적용 여부 확인 페이지 내장/);
  const cn = sanitizeCapturedHtml(sampleHtml({ locale: 'cn', extra }), RUNTIME, 'cn');
  assert.match(cn, /• Built-in Pactspirit effect lookup/);
  const ja = sanitizeCapturedHtml(sampleHtml({ locale: 'ja', extra }), RUNTIME, 'ja');
  assert.match(ja, /• Built-in Pactspirit effect lookup/);
  assert.equal(
    stripConfirmedSec10Bullets('• Built-in Pactspirit effect lookup', 'en'),
    'Built-in Pactspirit effect lookup',
  );
  } finally {
    if (prev == null) delete process.env.TORCHLIGHT_CONFIRMED_OVERLAY;
    else process.env.TORCHLIGHT_CONFIRMED_OVERLAY = prev;
  }
});

test('confirmed overlay replaces the FashionBox prize slice after freeze copy', async () => {
  const staging = mkdtempSync(join(tmpdir(), 'torchlight-fashionbox-'));
  writeFileSync(join(staging, CONFIRMED_FASHIONBOX_FILE), 'old-chest');
  const html = `<img data-node="1187:1742" data-name="img/奖品素材" src="./static-assets/${CONFIRMED_FASHIONBOX_FILE}">`;
  const result = await applyConfirmedFashionBoxOverlay({
    html,
    stagingAssets: staging,
    assetsHref: './static-assets/',
  });
  assert.equal(result.replaced, true);
  const overlay = readFileSync(CONFIRMED_FASHIONBOX_SRC);
  const written = readFileSync(join(staging, CONFIRMED_FASHIONBOX_FILE));
  assert.equal(Buffer.compare(overlay, written), 0);
  const skipped = await applyConfirmedFashionBoxOverlay({
    html: '<img src="./static-assets/1187-1753.webp">',
    stagingAssets: staging,
    assetsHref: './static-assets/',
  });
  assert.equal(skipped.replaced, false);
});

test('merge skips unreferenced leftover two-line date plates on Global freeze', async () => {
  const staging = mkdtempSync(join(tmpdir(), 'torchlight-date-stage-'));
  const assets = mkdtempSync(join(tmpdir(), 'torchlight-date-assets-'));
  writeFileSync(join(staging, '1187-1770.webp'), 'global-two-line-leftover');
  writeFileSync(join(staging, CONFIRMED_DATE_MOBILE_FILE), readFileSync(CONFIRMED_DATE_MOBILE_SRC));
  writeFileSync(join(assets, '1187-1770.webp'), 'cn-two-line');
  const html = `<img src="./static-assets/${CONFIRMED_DATE_MOBILE_FILE}">`;
  const merged = await mergeAssetDir(staging, assets, { html });
  assert.equal(readFileSync(join(assets, '1187-1770.webp'), 'utf8'), 'cn-two-line');
  assert.equal(
    Buffer.compare(readFileSync(join(assets, CONFIRMED_DATE_MOBILE_FILE)), readFileSync(CONFIRMED_DATE_MOBILE_SRC)),
    0,
  );
  assert.equal(merged.copied >= 1, true);
});

test('confirmed FashionBox overlay may replace the shared freeze asset', async () => {
  const staging = mkdtempSync(join(tmpdir(), 'torchlight-overlay-stage-'));
  const assets = mkdtempSync(join(tmpdir(), 'torchlight-overlay-assets-'));
  writeFileSync(join(staging, CONFIRMED_FASHIONBOX_FILE), readFileSync(CONFIRMED_FASHIONBOX_SRC));
  writeFileSync(join(assets, CONFIRMED_FASHIONBOX_FILE), 'old-chest');
  await assert.rejects(
    () => mergeAssetDir(staging, assets),
    /ASSET_COLLISION/,
  );
  const merged = await mergeAssetDir(staging, assets, { overlayFiles: [CONFIRMED_FASHIONBOX_FILE] });
  assert.equal(merged.replaced, 1);
  assert.equal(
    Buffer.compare(readFileSync(join(assets, CONFIRMED_FASHIONBOX_FILE)), readFileSync(CONFIRMED_FASHIONBOX_SRC)),
    0,
  );
});

test('copyReferencedLocalFiles copies live assets paths into frozen assets', async () => {
  const source = mkdtempSync(join(tmpdir(), 'torchlight-files-src-'));
  const staging = mkdtempSync(join(tmpdir(), 'torchlight-files-stage-'));
  mkdirSync(join(source, 'assets'), { recursive: true });
  mkdirSync(join(source, 'content-package', 'assets'), { recursive: true });
  writeFileSync(join(source, 'assets', '1119-3005.png'), 'png');
  writeFileSync(join(source, 'content-package', 'assets', '1119-3656.webp'), 'webp');
  const html = '<img src="assets/1119-3005.png"><img src="content-package/assets/1119-3656.webp?v=1">';
  const result = await copyReferencedLocalFiles({
    html,
    sourceDir: source,
    stagingAssets: staging,
    assetsHref: './static-assets/',
    kind: 'file',
  });
  assert.match(result.html, /src="\.\/static-assets\/1119-3005\.png"/);
  assert.match(result.html, /src="\.\/static-assets\/1119-3656\.webp"/);
  assert.equal(existsSync(join(staging, '1119-3005.png')), true);
  assert.equal(existsSync(join(staging, '1119-3656.webp')), true);
});

test('copyReferencedLocalFiles refuses hrefs that escape sourceDir', async () => {
  const source = mkdtempSync(join(tmpdir(), 'torchlight-files-src-'));
  const staging = mkdtempSync(join(tmpdir(), 'torchlight-files-stage-'));
  await assert.rejects(
    () => copyReferencedLocalFiles({
      html: '<img src="../secret.png">',
      sourceDir: source,
      stagingAssets: staging,
      assetsHref: './static-assets/',
      kind: 'file',
    }),
    /PATH_OUTSIDE_PROJECT/,
  );
  assert.equal(existsSync(join(staging, 'secret.png')), false);
  assert.throws(
    () => withinProject(source, '../secret.png', 'file'),
    /PATH_OUTSIDE_PROJECT/,
  );
});

test('freeze page height locks to bg/pc or bg/mobile board bottom', () => {
  assert.match(STATIC_RUNTIME, /function backgroundBottom\(/);
  assert.match(STATIC_RUNTIME, /function isPageBgBoard\(/);
  assert.match(STATIC_RUNTIME, /function afterHeroChromeOf\(/);
  assert.match(STATIC_RUNTIME, /function chromeBottomOf\(/);
  assert.match(STATIC_RUNTIME, /function laterShiftOf\(hero, slot\)/);
  assert.match(STATIC_RUNTIME, /function pageScrollHeight\(frame, page, laters, slot, chrome, laterShift\)/);
  assert.match(STATIC_RUNTIME, /function capturedPageFrameHeight\(/);
  assert.match(STATIC_RUNTIME, /if \(board > 0 && frameH > 0\) visual = Math\.min\(board, frameH\) \+ extra/);
  assert.match(STATIC_RUNTIME, /function heroSourceHeightOf\(/);
  assert.match(STATIC_RUNTIME, /Do not adopt style.height/);
  assert.doesNotMatch(STATIC_RUNTIME, /if \(painted > visual\) visual = painted/);
  assert.match(STATIC_RUNTIME, /shiftAfterHeroChrome\(laterChrome, laterShift\)/);
  assert.match(STATIC_RUNTIME, /applyStageBoxes\(page, hero, laters, stageW, slot, laterChrome\)/);
  assert.match(STATIC_RUNTIME, /laterShiftOf\(hero, slot\)/);
  assert.match(STATIC_RUNTIME, /var hostsBg = false;/);
  assert.match(STATIC_RUNTIME, /boards\[b\]\.style\.overflow = 'visible'/);
  assert.match(STATIC_RUNTIME, /function applyCoveringPlateTail\(/);
  assert.match(STATIC_RUNTIME, /tail\.setAttribute\('data-hero-bg-capture-top', String\(captured\)\)/);
  assert.match(STATIC_RUNTIME, /tail\.style\.top = \(captureTop \+ extra\) \+ 'px'/);
  assert.doesNotMatch(STATIC_RUNTIME, /desktopTails/);
  assert.match(STATIC_RUNTIME, /data-hero-visual-plane', 'bg-tail'/);
  assert.match(STATIC_RUNTIME, /page\.style\.overflowY = 'hidden'/);
  assert.doesNotMatch(STATIC_RUNTIME, /function pageScrollHeight\(laters, slot\)/);
  assert.doesNotMatch(STATIC_RUNTIME, /Math\.min\(board, painted\)/);
  assert.doesNotMatch(STATIC_RUNTIME, /function backgroundPaintedHeight\(/);
});
test('freeze mobile sheet anchors its bottom and the long bg follows a taller phone', () => {
  assert.match(STATIC_RUNTIME, /center bottom-anchor/);
  assert.match(STATIC_RUNTIME, /data-hero-capture-slot/);
  assert.match(STATIC_RUNTIME, /data-hero-bg-follow-y/);
  assert.match(STATIC_RUNTIME, /mobileSheet && bgExtra > 0\.5 && bgSourceH > 0/);
  assert.match(STATIC_RUNTIME, /function followPageContentClip/);
  assert.match(STATIC_RUNTIME, /function installButtonPress/);
  assert.match(STATIC_RUNTIME, /function ensurePlayModals/);
  assert.match(STATIC_RUNTIME, /if \(mobileSheet\) followPageContentClip\(page, laterShift\)/);
  assert.match(STATIC_RUNTIME, /plat === 'mobile' \? 'center 0' : 'center center'/);
});


test('freeze mobile k follows DESIGN viewportW/750 and does not extra-cover later bg', () => {
  assert.match(STATIC_RUNTIME, /if \(dw <= 750 \|\| w <= MOBILE_MAX\) return w \/ 750;/);
  assert.doesNotMatch(STATIC_RUNTIME, /Math\.min\(1, w \/ 750\)/);
  assert.doesNotMatch(STATIC_RUNTIME, /function applyPageBgCover\(/);
  assert.doesNotMatch(STATIC_RUNTIME, /function applyLaterBgCover\(/);
  assert.doesNotMatch(STATIC_RUNTIME, /applyPageBgCover\(page, stageW\)/);
  assert.doesNotMatch(STATIC_RUNTIME, /applyLaterBgCover\(laters\[lu\], stageW\)/);
});

test('stop 1 freeze runtime blocks modals and button highlight until interaction is on', () => {
  const allow = STATIC_RUNTIME.slice(STATIC_RUNTIME.indexOf('function stop1AllowsClick'), STATIC_RUNTIME.indexOf('function installStop1Shield'));
  assert.match(allow, /\u5207\u6362\u8bed\u8a00/);
  assert.doesNotMatch(allow, /\u64ad\u653e/);
  assert.doesNotMatch(allow, /fx-named-modal/);
  assert.match(STATIC_RUNTIME, /data-ops-interaction'\) !== '1'/);
  assert.match(STATIC_RUNTIME, /if \(interactionMode === '1'\) paintCurrentLanguageHighlight\(\)/);
  assert.match(STATIC_RUNTIME, /html\[data-ops-interaction="1"\] button:hover/);
  const shell = readFileSync(new URL('../freeze/freeze-ops.mjs', import.meta.url), 'utf8');
  const lang = shell.slice(shell.indexOf('function isLanguageSwitchEvent'), shell.indexOf('var block = function'));
  assert.match(lang, /\u5207\u6362\u8bed\u8a00/);
  assert.doesNotMatch(lang, /\u64ad\u653e/);
  assert.doesNotMatch(lang, /fx-named-modal/);
});

test('stop-2 freeze runtime keeps language jump, keyboard, 48px swipe, and hidden-tree modal close', () => {
  assert.match(STATIC_RUNTIME, /function jumpFrozenLocale\(/);
  assert.match(STATIC_RUNTIME, /function paintCurrentLanguageHighlight\(/);
  assert.match(STATIC_RUNTIME, /var unselected = named\.indexOf\('未选中背景'\) >= 0;/);
  assert.match(STATIC_RUNTIME, /on \? unselected : \(named\.indexOf\('选中背景'\) >= 0 && !unselected\)/);
  assert.match(STATIC_RUNTIME, /paintCurrentLanguageHighlight\(\);/);
  assert.match(STATIC_RUNTIME, /日本語\|日文/);
  assert.match(STATIC_RUNTIME, /ja\.static\.html/);
  assert.match(STATIC_RUNTIME, /function applySwitch\(/);
  assert.match(STATIC_RUNTIME, /function restackSkippedVerticalHug\(/);
  assert.match(STATIC_RUNTIME, /function closeOpenModals\(/);
  assert.match(STATIC_RUNTIME, /function installSwitchSwipe\(/);
  assert.match(STATIC_RUNTIME, /function scheduleImages\(/);
  assert.match(STATIC_RUNTIME, /Math\.abs\(state\.dx\) < 48/);
  assert.doesNotMatch(STATIC_RUNTIME, /Math\.abs\(state\.dx\) < 24/);
  assert.match(STATIC_RUNTIME, /ev\.key !== 'Enter'/);
  assert.match(STATIC_RUNTIME, /mobileSheet \|\| scaledH > h \+ 1/);
  assert.match(STATIC_RUNTIME, /if \(!onFrame\) \{\s*closeOpenModals\(frame\);/s);
});

test('freeze clusterKind treats landing download buttons as first-screen CTA', () => {
  assert.match(STATIC_RUNTIME, /function clusterKind\(/);
  assert.match(STATIC_RUNTIME, /windows\|window\|steam/);
  assert.match(STATIC_RUNTIME, /btn\\\/\(\?:cn\|tw\|en\|jp\|kr\)立即/);
  assert.match(STATIC_RUNTIME, /btn\\\/\(\?:cn\|tw\|en\|jp\|kr\)预约按钮/);
  assert.doesNotMatch(STATIC_RUNTIME, /\/立即\(\?:下载\|預約\|预约\)\/\.test\(name\)/);
});

test('confirmed overlay matches prize badge, empty date slot, TW more, and crystal caption', () => {
  const sample = [
    '<div data-node="1187:990" style="top: 71.9874px; left: 31.6319px; font-size: 22.3px; font-weight: 600; line-height: 22.3px;">传奇战斗</div>',
    '<div data-node="1187:1748" style="top: 30.9464px; left: 17.4991px; font-size: 16px; font-weight: 600; line-height: 16px;">传奇战斗</div>',
    '<div data-node="1187:898" style="display: block;">全新賽季 10月16日 10:00</div>',
    '<div data-node="1187:899" style="display: block;">ghost</div>',
    '<div data-node="1187:1776" style="display: block;">SEASON LAUNCH: Oct 15, 7 PM PDT</div>',
    '<div data-node="1187:1777" style="display: block;">ghost</div>',
    '<div data-node="1187:974" data-btn-name="查看更多"><div data-node="I1187:974;1187:1141">看更多</div></div>',
    '<div data-node="1187:1860"><div data-node="I1187:1860;1187:1988">看更多</div></div>',
    '<div data-node="1187:1008"><div data-node="I1187:1008;1187:1135">看更多</div></div>',
    '<div data-node="1187:1761" style="font-weight: 600;">契灵结晶- 战斗×10</div>',
    '<div data-node="1187:1752" style="font-weight: 600; top: 123px;">触媒自选包</div>',
    '<div data-node="1187:1765" style="left: 319px; font-weight: 600;">赛季福利</div>',
    '<div data-node="1187:1742" data-node-box="77.141,1294.381,132.859,102.619" style="width: 132.859px; height: 102.619px;"><img style="left: -0.88px; top: -19.88px; width: 162px; height: 151px; object-fit: none;"></div>',
    '<div data-node="1187:1416" style="font-size: 31px; font-weight: 400; line-height: 34px;">Complete objectives</div>',
    '<div data-node="1187:1432" style="font-size: 31px; font-weight: 400; line-height: 34px;">Join season events</div>',
    '<div data-node="I1187:909;1187:1022" style="font-size: 58.31px; font-weight: 400; line-height: 58.31px;">ユーガの新特性</div>',
    '<div data-node="1187:926" style="font-size: 41.65px; font-weight: 400; line-height: 41.65px;">クロックワークコア</div>',
    '<div data-node="1187:896" style="font-size: 34px; font-weight: 700; line-height: 40.8px;">ログインで伝説ペット獲得！ストーリークリアで「自走反応媒介」贈呈！</div>',
    '<div data-node="1187:1779" style="font-size: 19px; font-weight: 500; line-height: 22.8px;">ログインで伝説ペット獲得！ストーリークリアで「自走反応媒介」贈呈！</div>',
    '<div data-node="1187:2288" style="font-size: 10px; font-weight: 600; line-height: 24px;">完成目標即可領取「基礎觸媒多選箱」！</div>',
    '<div data-node="1187:2302" style="font-size: 10px; font-weight: 600; line-height: 12px;">參與賽季系列活動</div>',
    '<div data-node="1187:1763" data-hero-cluster="bottom" style="height: 2.22e-05px; left: 56px;"></div>',
    '<div data-node="1187:1766" data-hero-cluster="bottom" style="height: 2.22e-05px; left: 440px;"></div>',
    '<div data-node="1187:886" style="height: 260px; overflow: hidden;"><img src="./static-assets/1187-886.webp"></div>',
    '<div data-node="1187:1770" style="height: 354px; overflow: hidden;"><img src="./static-assets/1187-1770.webp"></div>',
    '<div data-node="I1187:1830;1187:1897" style="top: 46.5469px; font-weight: 600;">全新时装</div>',
    '<div data-node="I1187:909;1187:1022" style="top: 144px; font-weight: 600;">尤加新特性「最终之人」</div>',
    '<div data-node="I1187:1824;1187:2266;1187:1897" style="top: 46.5469px; font-size: 26px; font-weight: 400; line-height: 31.98px; font-family: Noto Sans;">赛季福利</div>',
    '<div data-node="I1187:2280;1187:1897" style="top: 46.5469px; font-size: 26px; font-weight: 600; line-height: 31.98px;">赛季福利</div>',
    '<div data-node="I1187:2294;1187:1897" style="top: 46.5469px; font-size: 26px; font-weight: 600; line-height: 31.98px;">赛季福利</div>',
    '<div data-node="I1187:938;1187:1392;1187:1022" style="top: 144px; font-size: 70px; font-weight: 400; line-height: 86.1px; font-family: Noto Sans;">赛季福利</div>',
    '<div data-node="I1187:1408;1187:1022" style="top: 144px; font-size: 70px; font-weight: 600; line-height: 86.1px;">赛季福利</div>',
    '<div data-node="I1187:1424;1187:1022" style="top: 144px; font-size: 70px; font-weight: 600; line-height: 86.1px;">赛季福利</div>',
    '<div data-node="1187:1845" style="font-weight: 600;">避难所视觉升级；</div>',
    '<div data-node="1187:1849" style="font-weight: 600;">异界体验优化打宝更便捷；</div>',
    '<div data-node="1187:1853" style="font-weight: 600;">交易行查价&amp;快速购买优化；</div>',
    '<div data-node="1187:1857" style="font-weight: 600;">新赛季契灵被动生效，无需切换；</div>',
    '<div data-node="1187:959">契灵生效查询页内置。</div>',
  ].join('');
  const tw = applyConfirmedCopyOverlay(sample, 'tw');
  assert.match(tw, />傳奇掉落</);
  assert.doesNotMatch(tw, />传奇战斗</);
  assert.match(tw, /data-node="1187:899"[^>]*aria-hidden="true"/);
  assert.match(tw, /data-node="1187:899"[^>]*display: none/);
  assert.match(tw, />查看更多</);
  assert.doesNotMatch(tw, />看更多</);
  assert.doesNotMatch(tw, /查查看更多/);
  assert.match(tw, /data-btn-name="查看更多"/);
  assert.match(tw, />契靈結晶-戰鬥×30</);
  assert.match(tw, /data-node="1187:1761"[^>]*text-wrap-style: balance/);
  assert.match(tw, /data-node="1187:1761"[^>]*overflow-wrap: anywhere/);
  assert.match(tw, />賽季福利</);
  assert.match(tw, /data-node="1187:1765"[^>]*left: 375px/);
  assert.match(tw, /data-node="1187:1416"[^>]*font-size: 50px/);
  assert.match(tw, /data-node="1187:1432"[^>]*font-size: 50px/);
  assert.match(tw, /data-node="1187:1432"[^>]*line-height: 56.35px/);
  assert.match(tw, /data-node="1187:2288"[^>]*font-size: 20px/);
  assert.match(tw, /data-node="1187:2302"[^>]*font-size: 20px/);
  assert.match(tw, /data-node="1187:2302"[^>]*line-height: 24px/);
  assert.match(tw, /data-confirmed-date-slot="single-center"/);
  assert.match(tw, /data-node="1187:886"[^>]*data-confirmed-date-plate="oneline"/);
  assert.match(tw, /data-node="1187:1770"[^>]*data-confirmed-date-plate="oneline"/);
  assert.match(tw, /1187-886-oneline\.webp/);
  assert.match(tw, /1187-1770-oneline\.webp/);
  assert.doesNotMatch(tw, /data-confirmed-date-cover=/);
  assert.doesNotMatch(tw, /data-node="1187:886"[^>]*clip-path/);
  assert.doesNotMatch(tw, /data-node="1187:1770"[^>]*clip-path/);
  assert.match(tw, /data-node="1187:1742"[^>]*width: 136.102px/);
  assert.match(tw, /data-node="1187:1742"[^>]*>[\s\S]*?left: 0px/);
  assert.match(tw, /data-node="I1187:2280;1187:1897"[^>]*>賽季福利</);
  assert.match(tw, /data-node="I1187:2294;1187:1897"[^>]*>賽季福利</);
  assert.match(tw, /data-node="I1187:938;1187:1392;1187:1022"[^>]*>賽季福利</);
  assert.match(tw, /data-node="I1187:1408;1187:1022"[^>]*>賽季福利</);
  assert.match(tw, /data-node="I1187:1424;1187:1022"[^>]*>賽季福利</);
  assert.match(tw, /data-node="I1187:1830;1187:1897"[^>]*top: 46.5469px/);
  assert.match(tw, /data-node="I1187:909;1187:1022"[^>]*top: 144px/);
  assert.match(tw, /data-node="I1187:2280;1187:1897"[^>]*top: 46.5469px/);
  assert.match(tw, /data-node="I1187:1408;1187:1022"[^>]*top: 144px/);
  assert.match(tw, /data-node="I1187:2280;1187:1897"[^>]*font-weight: 600/);
  assert.match(tw, /data-node="I1187:1408;1187:1022"[^>]*font-weight: 600/);
  assert.match(tw, /data-node="1187:1845"[^>]*>契靈生效查詢頁內置</);
  assert.match(tw, /data-node="1187:1849"[^>]*>羅盤放置體驗優化</);
  assert.match(tw, /data-node="1187:1853"[^>]*>追憶自動打造</);
  assert.match(tw, /data-node="1187:1857"[^>]*>掉落速度加快</);
  assert.doesNotMatch(tw, /data-node="1187:1845"[^>]*>[^<]*[；。]/);
  assert.doesNotMatch(tw, /避难所视觉升级/);
  const en = applyConfirmedCopyOverlay(sample, 'en');
  assert.match(en, /data-node="1187:896"[^>]*font-size: 34px/);
  assert.match(en, /data-node="1187:1779"[^>]*font-size: 19px/);
  assert.match(en, />Legendary</);
  assert.match(en, /data-node="1187:1777"[^>]*aria-hidden="true"/);
  assert.match(en, />Pactspirit Crystal - Battle x30</);
  assert.match(en, /data-node="1187:1761"[^>]*font-weight: 400/);
  assert.match(en, /data-node="1187:1761"[^>]*word-break: keep-all/);
  assert.match(en, /data-node="1187:1752"[^>]*white-space: pre/);
  assert.match(en, /data-node="1187:1752"[^>]*line-height: 22.54px/);
  assert.match(en, />Activation Medium\n Selection Pack</);
  assert.match(en, /data-node="1187:1416"[^>]*font-size: 50px/);
  assert.match(en, /data-node="1187:1432"[^>]*text-wrap-style: balance/);
  assert.match(en, /data-node="1187:2288"[^>]*font-size: 20px/);
  assert.match(en, /data-node="1187:2302"[^>]*font-size: 20px/);
  assert.match(en, /data-node="1187:1763"[^>]*height: 3px/);
  assert.match(en, /data-node="1187:1763"[^>]*clip-path: inset\(0px 50.9062px 0px 0px\)/);
  assert.match(en, /data-node="1187:1766"[^>]*clip-path: inset\(0px 0px 0px 50.9062px\)/);
  assert.match(en, /data-node="1187:886"[^>]*data-confirmed-date-plate="twoline-nodiv"/);
  assert.match(en, /1187-886-twoline-nodiv\.webp/);
  assert.doesNotMatch(en, /1187-886-oneline\.webp/);
  assert.match(en, /data-node="1187:1770"[^>]*data-confirmed-date-plate="twoline-nodiv"/);
  assert.match(en, /1187-1770-twoline-nodiv\.webp/);
  assert.doesNotMatch(en, /1187-1770-oneline\.webp/);
  assert.match(en, /data-node="I1187:2280;1187:1897"[^>]*>Season Rewards</);
  assert.match(en, /data-node="I1187:2294;1187:1897"[^>]*>Season Rewards</);
  assert.match(en, /data-node="I1187:938;1187:1392;1187:1022"[^>]*>Season Rewards</);
  assert.match(en, /data-node="I1187:1408;1187:1022"[^>]*>Season Rewards</);
  assert.match(en, /data-node="I1187:1424;1187:1022"[^>]*>Season Rewards</);
  assert.match(en, /data-node="I1187:1830;1187:1897"[^>]*top: 46.5469px/);
  assert.match(en, /data-node="I1187:909;1187:1022"[^>]*top: 144px/);
  assert.match(en, /data-node="I1187:2280;1187:1897"[^>]*top: 46.5469px/);
  assert.match(en, /data-node="I1187:1408;1187:1022"[^>]*top: 144px/);
  assert.match(en, /data-node="I1187:2280;1187:1897"[^>]*font-weight: 400/);
  assert.match(en, /data-node="I1187:2294;1187:1897"[^>]*font-weight: 400/);
  assert.match(en, /data-node="I1187:1408;1187:1022"[^>]*font-weight: 400/);
  assert.match(en, /data-node="I1187:1424;1187:1022"[^>]*font-weight: 400/);
  assert.match(en, /data-node="I1187:938;1187:1392;1187:1022"[^>]*font-weight: 400/);
  assert.match(en, /data-node="I1187:1408;1187:1022"[^>]*font-size: 70px/);
  assert.match(en, /data-node="I1187:2280;1187:1897"[^>]*font-size: 26px/);
  assert.match(en, /data-node="1187:990"[^>]*font-size: 19.3px/);
  assert.match(en, /data-node="1187:1748"[^>]*font-size: 9px/);
  assert.match(en, /data-node="1187:990"[^>]*top: 71.9874px/);
  assert.match(en, /data-node="1187:1748"[^>]*top: 30.9464px/);
  assert.match(en, /data-node="1187:1845"[^>]*>Built-in Pactspirit effect lookup</);
  assert.match(en, /data-node="1187:1849"[^>]*>Improved Compass Placement</);
  assert.match(en, /data-node="1187:1853"[^>]*>Auto Memory Crafting</);
  assert.match(en, /data-node="1187:1857"[^>]*>Faster loot drops</);
  assert.doesNotMatch(en, /data-node="1187:1845"[^>]*>[^<]*[；。]/);
  assert.doesNotMatch(en, /避难所视觉升级/);
  assert.match(en, /data-node="1187:1845"[^>]*font-weight: 400/);
  const ko = applyConfirmedCopyOverlay(sample, 'ko');
  assert.match(ko, /data-node="1187:1416"[^>]*font-size: 50px/);
  assert.match(ko, /data-node="1187:1432"[^>]*font-size: 50px/);
  assert.match(ko, /data-node="1187:1432"[^>]*white-space: pre/);
  assert.match(ko, /data-node="1187:1432"[^>]*word-break: keep-all/);
  assert.match(ko, />시즌 시리즈 이벤트 참여 시 레전드 전투 정령 30회 소환권, 레어 시즌 드롭 정령, \n레어 드롭 정령 승급 휘장/);
  assert.match(ko, /data-node="1187:2288"[^>]*font-size: 20px/);
  assert.match(ko, /data-node="1187:2302"[^>]*font-size: 20px/);
  assert.match(ko, /data-node="1187:2302"[^>]*white-space: pre/);
  assert.match(ko, /data-node="1187:2302"[^>]*word-break: keep-all/);
  assert.match(ko, />시즌 시리즈 이벤트 참여 시 레전드 전투 정령 30회 소환권, \n레어 시즌 드롭 정령/);
  assert.match(ko, /data-node="1187:886"[^>]*data-confirmed-date-plate="twoline-nodiv"/);
  assert.match(ko, /1187-886-twoline-nodiv\.webp/);
  assert.match(ko, /data-node="1187:1770"[^>]*data-confirmed-date-plate="twoline-nodiv"/);
  assert.match(ko, /1187-1770-twoline-nodiv\.webp/);
  assert.match(ko, /data-node="I1187:2280;1187:1897"[^>]*>시즌 혜택</);
  assert.match(ko, /data-node="I1187:2294;1187:1897"[^>]*>시즌 혜택</);
  assert.match(ko, /data-node="I1187:938;1187:1392;1187:1022"[^>]*>시즌 혜택</);
  assert.match(ko, /data-node="I1187:1408;1187:1022"[^>]*>시즌 혜택</);
  assert.match(ko, /data-node="I1187:1424;1187:1022"[^>]*>시즌 혜택</);
  assert.match(ko, /data-node="I1187:2280;1187:1897"[^>]*font-weight: 400/);
  assert.match(ko, /data-node="I1187:1408;1187:1022"[^>]*font-weight: 400/);
  assert.match(ko, /data-node="1187:1845"[^>]*>정령 적용 여부 확인 페이지 내장</);
  assert.match(ko, /data-node="1187:1849"[^>]*>나침반 배치 편의성 개선</);
  assert.match(ko, /data-node="1187:1853"[^>]*>추억 자동 제작</);
  assert.match(ko, /data-node="1187:1857"[^>]*>드롭 속도 증가</);
  assert.doesNotMatch(ko, /data-node="1187:1845"[^>]*>[^<]*[；。]/);
  assert.match(ko, /data-node="1187:990"[^>]*font-size: 21.3px/);
  assert.match(ko, /data-node="1187:1748"[^>]*font-size: 11px/);
  assert.doesNotMatch(ko, /data-node="1187:1763"[^>]*clip-path/);
  assert.doesNotMatch(ko, /data-node="1187:1766"[^>]*clip-path/);
  const ja = applyConfirmedCopyOverlay(sample, 'ja');
  assert.match(ja, /data-node="1187:1416"[^>]*font-size: 50px/);
  assert.match(ja, /data-node="1187:1416"[^>]*line-height: 56.35px/);
  assert.match(ja, /data-node="1187:1416"[^>]*font-weight: 400/);
  assert.match(ja, /data-node="1187:1432"[^>]*font-size: 50px/);
  assert.match(ja, /data-node="1187:1432"[^>]*white-space: pre/);
  assert.match(ja, /data-node="1187:1432"[^>]*word-break: keep-all/);
  assert.match(ja, />シーズン一連のイベントに参加すると、伝説戦闘ペット10連ガチャ券、レアなシーズンドロップペット、\nレアなドロップペットのランクアップバッジ/);
  assert.match(ja, /data-node="1187:2288"[^>]*font-size: 20px/);
  assert.match(ja, /data-node="1187:2302"[^>]*font-size: 20px/);
  assert.match(ja, /data-node="1187:2302"[^>]*line-height: 24px/);
  assert.match(ja, /data-node="1187:2302"[^>]*white-space: normal/);
  assert.match(ja, /data-node="1187:2302"[^>]*text-align: center/);
  assert.match(ja, />シーズン一連のイベントに参加すると、伝説戦闘ペット10連ガチャ券、レアなシーズンドロップペット、レアなドロップペットのランクアップバッジ、限定武器外見などの豪華報酬が手に入る！</);
  assert.doesNotMatch(ja, /data-node="1187:2302"[^>]*>[^<]*\n/);
  assert.match(ja, /data-confirmed-date-plate="twoline"/);
  assert.match(ja, />新シーズン 10月16日11:00</);
  assert.doesNotMatch(ja, /data-confirmed-date-slot="single/);
  assert.doesNotMatch(ja, /data-node="1187:899"[^>]*display: none/);
  assert.match(ja, /data-node="I1187:909;1187:1022"[^>]*font-size: 64.5px/);
  assert.match(ja, /data-node="I1187:909;1187:1022"[^>]*font-weight: 400/);
  assert.match(ja, /data-node="1187:926"[^>]*font-size: 47.2px/);
  assert.match(ja, /data-node="1187:926"[^>]*line-height: 53.2px/);
  assert.match(ja, /data-node="1187:896"[^>]*font-size: 31px/);
  assert.match(ja, /data-node="1187:896"[^>]*font-weight: 700/);
  assert.match(ja, /data-node="1187:1779"[^>]*font-size: 19px/);
  assert.match(ja, /data-node="1187:1779"[^>]*font-weight: 500/);
  assert.match(ja, /data-node="I1187:2280;1187:1897"[^>]*>シーズン特典</);
  assert.match(ja, /data-node="I1187:2294;1187:1897"[^>]*>シーズン特典</);
  assert.match(ja, /data-node="I1187:938;1187:1392;1187:1022"[^>]*>シーズン特典</);
  assert.match(ja, /data-node="I1187:1408;1187:1022"[^>]*>シーズン特典</);
  assert.match(ja, /data-node="I1187:1424;1187:1022"[^>]*>シーズン特典</);
  assert.match(ja, /data-node="I1187:2280;1187:1897"[^>]*font-weight: 400/);
  assert.match(ja, /data-node="I1187:1408;1187:1022"[^>]*font-weight: 400/);
  assert.match(ja, /data-node="I1187:1424;1187:1022"[^>]*font-size: 64.5px/);
  assert.match(ja, /data-node="I1187:909;1187:1022"[^>]*top: 144px/);
  assert.match(ja, /data-node="1187:1845"[^>]*>ペットの有効状態が確認できる専用ページをゲーム内に実装</);
  assert.match(ja, /data-node="1187:1849"[^>]*>コントローラー使用時のトレードハウス＆\n異界の操作フローを最適化</);
  assert.match(ja, /data-node="1187:1853"[^>]*>異界の特殊マップモディファイアにカスタムマーク機能を追加</);
  assert.match(ja, /data-node="1187:1857"[^>]*>ドロップスピードの高速化</);
  assert.doesNotMatch(ja, /data-node="1187:1845"[^>]*>[^<]*[；。]/);
  assert.match(ja, /data-node="1187:1845"[^>]*font-weight: 400/);
  assert.match(ja, /data-node="1187:990"[^>]*font-size: 19.3px/);
  assert.match(ja, /data-node="1187:990"[^>]*top: 71.9874px/);
  assert.match(ja, /data-node="1187:990"[^>]*left: 31.6319px/);
  assert.match(ja, /data-node="1187:1748"[^>]*font-size: 10px/);
  assert.match(ja, /data-node="1187:1748"[^>]*top: 30.9464px/);
  assert.match(ja, /data-node="1187:1748"[^>]*left: 17.4991px/);
  assert.match(ja, /data-node="1187:1763"[^>]*height: 3px/);
  assert.match(ja, /data-node="1187:1763"[^>]*clip-path: inset\(0px 38px 0px 0px\)/);
  assert.match(ja, /data-node="1187:1766"[^>]*clip-path: inset\(0px 0px 0px 38px\)/);
  const cn = applyConfirmedCopyOverlay(sample, 'cn');
  assert.match(cn, />传奇掉落</);
  assert.match(cn, />ghost</);
  assert.match(cn, /data-node="1187:1765"[^>]*left: 375px/);
  assert.doesNotMatch(cn, /data-confirmed-date-slot="single/);
  assert.match(cn, /data-confirmed-date-plate="twoline"/);
  assert.match(cn, /1187-1770-twoline\.webp/);
  assert.doesNotMatch(cn, /data-confirmed-date-plate="oneline"/);
  assert.match(cn, /data-node="I1187:2280;1187:1897"[^>]*>赛季福利</);
  assert.match(cn, /data-node="I1187:1408;1187:1022"[^>]*>赛季福利</);
  assert.match(cn, /data-node="I1187:1424;1187:1022"[^>]*>赛季福利</);
  assert.match(cn, /data-node="I1187:1830;1187:1897"[^>]*top: 46.5469px/);
  assert.match(cn, /data-node="I1187:909;1187:1022"[^>]*top: 144px/);
  assert.match(cn, /data-node="I1187:2280;1187:1897"[^>]*font-weight: 600/);
  assert.match(cn, /data-node="I1187:1408;1187:1022"[^>]*font-weight: 600/);
  assert.match(cn, /data-node="1187:1845"[^>]*>避难所视觉升级。</);
  assert.match(cn, /data-node="1187:1849"[^>]*>异界体验优化打宝更便捷。</);
  assert.match(cn, /data-node="1187:1853"[^>]*>交易行查价&amp;快速购买优化。</);
  assert.match(cn, /data-node="1187:1857"[^>]*>新赛季契灵被动生效，无需切换。</);
  assert.match(cn, /data-node="1187:959"[^>]*>契灵生效查询页内置。</);
  assert.match(cn, /data-node="1187:990"[^>]*font-size: 22.3px/);
  assert.match(cn, /data-node="1187:1748"[^>]*font-size: 16px/);
  assert.doesNotMatch(cn, /契靈生效查詢頁內置/);
  assert.doesNotMatch(en, /避难所视觉升级/);
});

test('freeze leftover X keeps authored centered left instead of Figma box.x', () => {
  assert.match(STATIC_RUNTIME, /data-ss14-slg-base-left/);
  assert.match(STATIC_RUNTIME, /parseFloat\(el\.style\.left\)/);
  assert.doesNotMatch(STATIC_RUNTIME, /el\.style\.left = \(box\.x \+ shiftX\) \+ 'px'/);
});

test('freeze cluster Y restacks tagged bottom members even when box.h is 0', () => {
  assert.match(STATIC_RUNTIME, /taggedBottom/);
  assert.match(STATIC_RUNTIME, /!\(box\.h > 0\) && !taggedBottom/);
});

test('confirmed overlay replaces Global date plates with the one-line confirmed stone', async () => {
  const staging = mkdtempSync(join(tmpdir(), 'torchlight-date-plate-'));
  const html = [
    '<div data-node="1187:886"><img src="./static-assets/1187-886.webp"></div>',
    '<div data-node="1187:1770"><img src="./static-assets/1187-1770.webp"></div>',
  ].join('');
  const marked = applyConfirmedCopyOverlay(html, 'tw');
  assert.match(marked, /1187-886-oneline\.webp/);
  assert.match(marked, /1187-1770-oneline\.webp/);
  assert.doesNotMatch(marked, /src="\.\/static-assets\/1187-886\.webp"/);
  writeFileSync(join(staging, '1187-886.webp'), 'old-two-line-pc');
  writeFileSync(join(staging, '1187-1770.webp'), 'old-two-line-mo');
  const tw = await applyConfirmedFashionBoxOverlay({
    html: marked,
    stagingAssets: staging,
    assetsHref: './static-assets/',
    locale: 'tw',
  });
  assert.equal(tw.replaced, true);
  assert.equal(existsSync(join(staging, '1187-886.webp')), false);
  assert.equal(existsSync(join(staging, '1187-1770.webp')), false);
  assert.equal(
    Buffer.compare(readFileSync(CONFIRMED_DATE_PC_SRC), readFileSync(join(staging, CONFIRMED_DATE_PC_FILE))),
    0,
  );
  assert.equal(
    Buffer.compare(readFileSync(CONFIRMED_DATE_MOBILE_SRC), readFileSync(join(staging, CONFIRMED_DATE_MOBILE_FILE))),
    0,
  );
  writeFileSync(join(staging, CONFIRMED_DATE_PC_FILE), 'old-two-line');
  const cn = await applyConfirmedFashionBoxOverlay({
    html,
    stagingAssets: staging,
    assetsHref: './static-assets/',
    locale: 'cn',
  });
  assert.equal(readFileSync(join(staging, CONFIRMED_DATE_PC_FILE), 'utf8'), 'old-two-line');
  assert.equal(cn.files.includes(CONFIRMED_DATE_PC_FILE), false);

  const enHtml = applyConfirmedCopyOverlay(html, 'en');
  assert.match(enHtml, /1187-886-twoline-nodiv\.webp/);
  assert.match(enHtml, /1187-1770-twoline-nodiv\.webp/);
  writeFileSync(join(staging, '1187-886.webp'), 'old-two-line-pc');
  writeFileSync(join(staging, '1187-1770.webp'), 'old-two-line-mo');
  const en = await applyConfirmedFashionBoxOverlay({
    html: enHtml,
    stagingAssets: staging,
    assetsHref: './static-assets/',
    locale: 'en',
  });
  assert.equal(en.replaced, true);
  assert.equal(existsSync(join(staging, CONFIRMED_DATE_PC_NODIV_FILE)), true);
  assert.equal(existsSync(join(staging, CONFIRMED_DATE_MOBILE_NODIV_FILE)), true);
  assert.equal(
    Buffer.compare(readFileSync(CONFIRMED_DATE_PC_NODIV_SRC), readFileSync(join(staging, CONFIRMED_DATE_PC_NODIV_FILE))),
    0,
  );
});

test('confirmed overlay replaces both mobile FashionBox and PC prize slice', async () => {
  const staging = mkdtempSync(join(tmpdir(), 'torchlight-prize-pc-'));
  writeFileSync(join(staging, CONFIRMED_PRIZE_PC_FILE), 'old-gold');
  const html = `<img data-node="1187:986" data-name="img/图片素材" src="./static-assets/${CONFIRMED_PRIZE_PC_FILE}">`;
  const result = await applyConfirmedFashionBoxOverlay({
    html,
    stagingAssets: staging,
    assetsHref: './static-assets/',
  });
  assert.equal(result.replaced, true);
  assert.equal(
    Buffer.compare(readFileSync(CONFIRMED_PRIZE_PC_SRC), readFileSync(join(staging, CONFIRMED_PRIZE_PC_FILE))),
    0,
  );
});

test('freeze restack skips hidden date lines instead of keeping the two-line gap', () => {
  assert.match(STATIC_RUNTIME, /getAttribute\('aria-hidden'\) === 'true'/);
  assert.match(STATIC_RUNTIME, /vertical-hug-single/);
  assert.match(STATIC_RUNTIME, /singleBoxH - singleSourceH/);
});

