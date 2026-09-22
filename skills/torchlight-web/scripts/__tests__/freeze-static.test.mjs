import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  copyReferencedFonts,
  copyReferencedLocalFiles,
  replaceableAssetFileName,
  sanitizeCapturedHtml,
  withinProject,
} from '../freeze/capture-static-html.mjs';
import {
  LOCALE_PAGES,
  reservationModalsToKeep,
  reservationModalsToStrip,
  shouldStripLanguageSwitcher,
} from '../freeze/static-locale.mjs';
import { writeOpsShell, writeReplaceableIndex } from '../freeze/freeze-ops.mjs';

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

test('sanitize keeps replaceable data-asset attrs and drops unused data-*', () => {
  const html = sanitizeCapturedHtml(sampleHtml({ locale: 'cn' }), RUNTIME, 'cn');
  assert.match(html, /data-asset="模块2玩法截图"/);
  assert.match(html, /data-asset-platform="pc"/);
  assert.match(html, /data-asset-lang="cn"/);
  assert.doesNotMatch(html, /data-debug=/);
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
  assert.deepEqual(empty.payload.assets, {});

  const named = mkdtempSync(join(tmpdir(), 'torchlight-freeze-named-'));
  writeFileSync(join(named, 'cn.static.html'), sampleHtml({ locale: 'zh-CN' }));
  const indexed = writeReplaceableIndex(named);
  assert.equal(indexed.count, 1);
  assert.equal(indexed.payload.assets['模块2玩法截图'].replaceable, true);
  assert.equal(indexed.payload.assets['模块2玩法截图'].files.pc['zh-CN'].src.includes('data:image/png'), true);
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
  assert.match(html1, /frozenShell && S\.prefs\.region === 'cn'/);
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
  assert.doesNotMatch(html1, /data-ops-region=/);

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
  assert.match(STATIC_RUNTIME, /function pageScrollHeight\(frame, page, laters, slot, chrome\)/);
  assert.match(STATIC_RUNTIME, /function capturedPageFrameHeight\(/);
  assert.match(STATIC_RUNTIME, /if \(board > 0 && frameH > 0\) return Math\.min\(board, frameH\)/);
  assert.match(STATIC_RUNTIME, /shiftAfterHeroChrome\(laterChrome, laterShift\)/);
  assert.match(STATIC_RUNTIME, /applyStageBoxes\(page, hero, laters, stageW, slot, laterChrome\)/);
  assert.match(STATIC_RUNTIME, /var hostsBg = false;/);
  assert.match(STATIC_RUNTIME, /page\.style\.overflowY = 'hidden'/);
  assert.doesNotMatch(STATIC_RUNTIME, /function pageScrollHeight\(laters, slot\)/);
  assert.doesNotMatch(STATIC_RUNTIME, /Math\.min\(board, painted\)/);
  assert.doesNotMatch(STATIC_RUNTIME, /function backgroundPaintedHeight\(/);
});

test('freeze page-root bg/pc and bg/mobile cover X only', () => {
  assert.match(STATIC_RUNTIME, /function applyPageBgCover\(/);
  assert.match(STATIC_RUNTIME, /applyPageBgCover\(page, stageW\)/);
  assert.match(STATIC_RUNTIME, /if \(isPageBgBoard\(el\)\) continue;/);
  assert.match(STATIC_RUNTIME, /var cover = Math\.max\(stageW \/ sourceW, 1\)/);
  assert.match(STATIC_RUNTIME, /el\.setAttribute\('data-later-cover-window', 'page-window'\)/);
  assert.match(STATIC_RUNTIME, /el\.setAttribute\('data-later-cover-axis', 'x'\)/);
  const laterCover = STATIC_RUNTIME.slice(STATIC_RUNTIME.indexOf('function applyLaterBgCover('));
  assert.match(laterCover, /Math\.max\(stageW \/ sourceW, boxH \/ sourceH\)/);
  assert.doesNotMatch(
    STATIC_RUNTIME.slice(
      STATIC_RUNTIME.indexOf('function applyPageBgCover('),
      STATIC_RUNTIME.indexOf('function applyLaterBgCover('),
    ),
    /Math\.max\(stageW \/ sourceW, boxH \/ sourceH\)/,
  );
});

