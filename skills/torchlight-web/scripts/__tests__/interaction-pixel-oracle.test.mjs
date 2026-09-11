import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LANG_BTN_FILL,
  LANG_OPTION_PAGES,
  backgroundMatchesFill,
  catalogEvidenceOk,
  catalogGoMatchesPlat,
  dropmenuOverlapEvidenceOk,
  catalogOpenedGoMatches,
  languageOptionVerdict,
  laterAxesPixelEvidenceComplete,
  mobileModalSheetVerdict,
  pcModalCloseVerdict,
  pcModalSheetVerdict,
} from '../lib/interaction-pixel-oracle.mjs';
import { greenLaterAxesProbeFixture, laterAxesProbeEvidenceComplete, scoreOpenerCatalog } from '../lib/later-axes-probe.mjs';

function option(text, state) {
  const fill = LANG_BTN_FILL[state];
  return {
    text,
    visibleCount: 1,
    state,
    fillSource: state,
    ownerBg: `linear-gradient(0deg, ${fill.cssRgb} 0%, ${fill.cssRgbEnd} 100%)`,
  };
}

test('backgroundMatchesFill reads rgb triples, not a single cssRgb substring', () => {
  const highlight = `linear-gradient(180deg, ${LANG_BTN_FILL.highlight.cssRgb} 0%, ${LANG_BTN_FILL.highlight.cssRgbEnd} 100%)`;
  assert.equal(backgroundMatchesFill(highlight, 'highlight'), true);
  assert.equal(backgroundMatchesFill(highlight, 'normal'), false);
  const mixed = `linear-gradient(180deg, ${LANG_BTN_FILL.highlight.cssRgb} 0%, ${LANG_BTN_FILL.normal.cssRgb} 100%)`;
  assert.equal(backgroundMatchesFill(mixed, 'highlight'), false);
  assert.equal(backgroundMatchesFill('img/选中背景', 'highlight'), true);
  assert.equal(backgroundMatchesFill('img/选中背景', 'normal'), false);
  assert.equal(backgroundMatchesFill('img/未选中背景', 'normal'), true);
});

test('language verdict requires authored fill pixels, not only state attrs', () => {
  const rows = [
    option('English', 'highlight'),
    option('繁體中文', 'normal'),
    option('简体中文', 'normal'),
    option('한국어', 'normal'),
  ];
  assert.equal(languageOptionVerdict(rows, 'en').ok, true);
  const fakeAttr = rows.map((row) => (
    row.text === 'English'
      ? { ...row, ownerBg: `linear-gradient(0deg, ${LANG_BTN_FILL.normal.cssRgb} 0%, ${LANG_BTN_FILL.normal.cssRgbEnd} 100%)` }
      : row
  ));
  const failed = languageOptionVerdict(fakeAttr, 'en');
  assert.equal(failed.ok, false);
  assert.ok(failed.problems.some((item) => item.startsWith('fill-pixel:English')));
  assert.equal(languageOptionVerdict(rows, 'zh-TW').ok, false);
  const tw = [
    option('English', 'normal'),
    option('繁體中文', 'highlight'),
    option('简体中文', 'normal'),
    option('한국어', 'normal'),
  ];
  assert.equal(languageOptionVerdict(tw, 'zh-TW').ok, true);
});

test('pc modal verdict centers the 3840x2160 sheet and keeps panel y=199', () => {
  const ok = pcModalSheetVerdict({
    sheetCx: 100,
    sheetCy: 100,
    viewCx: 100,
    viewCy: 100,
    panelTopRatio: 199 / 2160,
    panelBox: '0,199,3840,1340',
  });
  assert.equal(ok.ok, true);
  const innerCentered = pcModalSheetVerdict({
    sheetCx: 100,
    sheetCy: 140,
    viewCx: 100,
    viewCy: 100,
    panelTopRatio: 0.2,
    panelBox: '0,199,3840,1340',
  });
  assert.equal(innerCentered.ok, false);
  assert.ok(innerCentered.problems.includes('sheet-y-not-centered'));
});

test('later-axes green fixture now carries pixel evidence', () => {
  const fixture = greenLaterAxesProbeFixture();
  assert.equal(laterAxesPixelEvidenceComplete(fixture), true);
  assert.equal(laterAxesProbeEvidenceComplete(fixture), true);
  assert.equal(fixture.pixel.languages.length, LANG_OPTION_PAGES.length);
  const noPixel = { ...fixture, pixel: undefined };
  assert.equal(laterAxesProbeEvidenceComplete(noPixel), false);
  const omittedSkip = {
    ...fixture,
    pixel: {
      ...fixture.pixel,
      languages: fixture.pixel.languages.map((row) => {
        const next = { ...row };
        delete next.skipped;
        return next;
      }),
    },
  };
  assert.equal(laterAxesPixelEvidenceComplete(omittedSkip), false);
});

test('skip, missing fields, and unmeasured modal cannot go green', () => {
  const fixture = greenLaterAxesProbeFixture();
  assert.equal(laterAxesPixelEvidenceComplete({
    ...fixture,
    pixel: {
      ...fixture.pixel,
      languages: fixture.pixel.languages.map((row, index) => (
        index === 0 ? { ...row, ok: true, skipped: true, measured: true } : row
      )),
    },
  }), false);
  assert.equal(laterAxesPixelEvidenceComplete({
    ...fixture,
    pixel: { ...fixture.pixel, modal: { ok: true, skipped: true } },
  }), false);
  assert.equal(laterAxesPixelEvidenceComplete({
    ...fixture,
    pixel: { ...fixture.pixel, stalePrefs: undefined },
  }), false);
  assert.equal(laterAxesPixelEvidenceComplete({
    ...fixture,
    pixel: { ...fixture.pixel, mobile: undefined },
  }), false);
  assert.equal(laterAxesPixelEvidenceComplete({
    ...fixture,
    pixel: { ...fixture.pixel, modal: { ok: true, measured: true, skipped: false, close: undefined } },
  }), false);
  assert.equal(laterAxesPixelEvidenceComplete({
    ...fixture,
    pixel: { ...fixture.pixel, modal: { ...fixture.pixel.modal, lang: 'en' } },
  }), false);
  assert.equal(laterAxesPixelEvidenceComplete({
    ...fixture,
    pixel: { ...fixture.pixel, mobile: { ...fixture.pixel.mobile, go: 'modal/pc适龄提示' } },
  }), false);
  const noLang = { ...fixture.pixel.modal };
  delete noLang.lang;
  assert.equal(laterAxesPixelEvidenceComplete({
    ...fixture,
    pixel: { ...fixture.pixel, modal: noLang },
  }), false);
  assert.equal(laterAxesPixelEvidenceComplete({
    ...fixture,
    pixel: { ...fixture.pixel, pcCatalog: undefined },
  }), false);
  assert.equal(catalogEvidenceOk({
    ok: true, measured: true, skipped: false,
    openers: [{ go: 'modal/pc适龄提示', ok: true, measured: true, skipped: false, opened: false, closed: true }],
    inert: { ok: true, measured: true, skipped: false, openedModal: false },
  }), false);
  assert.equal(catalogEvidenceOk({
    ok: true, measured: true, skipped: false, plat: 'pc',
    openers: [{ go: 'modal/pc适龄提示', ok: true, measured: true, skipped: false, opened: true, closed: true }],
    inert: { ok: true, measured: true, skipped: false, openedModal: true },
  }, { plat: 'pc' }), false);
  assert.equal(catalogEvidenceOk({
    ok: true, measured: true, skipped: false, plat: 'pc',
    openers: [{ go: 'modal/mobile适龄提示', ok: true, measured: true, skipped: false, opened: true, closed: true }],
    inert: { ok: true, measured: true, skipped: false, openedModal: false, clicked: 1 },
  }, { plat: 'pc' }), false);
  assert.equal(catalogOpenedGoMatches('modal/pc适龄提示', 'pc适龄提示'), true);
  assert.equal(catalogOpenedGoMatches('modal/pc适龄提示', 'modal/pc适龄提示'), true);
  assert.equal(catalogOpenedGoMatches('modal/pc适龄提示', 'pc_cn订阅赛季日程'), false);
  assert.equal(catalogEvidenceOk({
    ok: true, measured: true, skipped: false, plat: 'pc',
    openers: [{
      go: 'modal/pc适龄提示',
      openedGo: 'pc_cn订阅赛季日程',
      ok: true, measured: true, skipped: false, opened: true, closed: true,
    }],
    inert: { ok: true, measured: true, skipped: false, openedModal: false, clicked: 1 },
  }, { plat: 'pc' }), false);
  assert.equal(catalogEvidenceOk({
    ok: true, measured: true, skipped: false, plat: 'pc',
    openers: [{
      go: 'modal/pc适龄提示',
      openedGo: 'pc适龄提示',
      ok: true, measured: true, skipped: false, opened: true, closed: true,
    }],
    inert: { ok: true, measured: true, skipped: false, openedModal: false, clicked: 1 },
  }, { plat: 'pc' }), true);
  const wrong = scoreOpenerCatalog({
    plat: 'pc',
    openers: [{ go: 'modal/pc适龄提示', opened: true, closed: true, openedGo: 'pc_cn订阅赛季日程' }],
    inert: { openedModal: false, clicked: 1 },
  }, 'pc');
  assert.equal(wrong.ok, false);
  assert.equal(wrong.openers[0].matched, false);
  assert.ok(wrong.problems.some((item) => item.startsWith('pc-opener-opened-wrong:')));
  const matched = scoreOpenerCatalog({
    plat: 'pc',
    openers: [{ go: 'modal/pc适龄提示', opened: true, closed: true, openedGo: 'pc适龄提示' }],
    inert: { openedModal: false, clicked: 1 },
  }, 'pc');
  assert.equal(matched.ok, true);
  assert.equal(matched.openers[0].matched, true);
});

test('mobile overflow sheet and missing close fail closed', () => {
  const overflow = mobileModalSheetVerdict({
    hostW: 390, hostH: 844, hostLeft: 0, hostTop: 0, modalW: 500, modalH: 844, modalLeft: 0, modalTop: 0,
    hasClose: true, closedAfterClose: true, hasNamedScroll: true, scrollbarHidden: true,
  });
  assert.equal(overflow.ok, false);
  assert.ok(overflow.problems.includes('mobile-modal-wider-than-sheet'));
  const noClose = mobileModalSheetVerdict({
    hostW: 390, hostH: 844, hostLeft: 0, hostTop: 0, modalW: 390, modalH: 844, modalLeft: 0, modalTop: 0,
    hasClose: false, closedAfterClose: false, hasNamedScroll: true, scrollbarHidden: false,
  });
  assert.equal(noClose.ok, false);
  assert.ok(noClose.problems.includes('mobile-close-missing'));
  assert.ok(noClose.problems.includes('mobile-scrollbar-visible'));
  const pcClose = pcModalCloseVerdict({ hasClose: true, closedAfterClose: false, hasNamedScroll: true, scrollbarHidden: false });
  assert.equal(pcClose.ok, false);
  assert.ok(pcClose.problems.includes('pc-close-did-not-close'));
  const pcOk = pcModalCloseVerdict({ hasClose: true, closedAfterClose: true, hasNamedScroll: true, scrollbarHidden: true });
  assert.equal(pcOk.ok, true);
  const mobileOk = mobileModalSheetVerdict({
    hostW: 390, hostH: 844, hostLeft: 0, hostTop: 0, modalW: 390, modalH: 844, modalLeft: 0, modalTop: 0,
    hasClose: true, closedAfterClose: true, hasNamedScroll: true, scrollbarHidden: true,
  });
  assert.equal(mobileOk.ok, true);
  const outside = mobileModalSheetVerdict({
    hostW: 390, hostH: 844, hostLeft: 0, hostTop: 0, modalW: 390, modalH: 844, modalLeft: -500, modalTop: 900,
    hasClose: true, closedAfterClose: true, hasNamedScroll: true, scrollbarHidden: true,
  });
  assert.equal(outside.ok, false);
  assert.ok(outside.problems.includes('mobile-modal-outside-sheet'));
  const missingOrigin = mobileModalSheetVerdict({
    hostW: 390, hostH: 844, modalW: 390, modalH: 844,
    hasClose: true, closedAfterClose: true, hasNamedScroll: true, scrollbarHidden: true,
  });
  assert.equal(missingOrigin.ok, false);
  assert.ok(missingOrigin.problems.includes('mobile-modal-origin-missing'));
});

test('opener catalog measures duplicate @go and every inert homepage btn', () => {
  const src = readFileSync(new URL('../lib/later-axes-probe.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /seen\.has\(go\)/);
  assert.doesNotMatch(src, /下载\|播放\|预约\|日历/);
  assert.doesNotMatch(src, /inertCandidates\.slice\(0, 8\)/);
  const dup = scoreOpenerCatalog({
    plat: 'pc',
    openers: [
      { go: 'modal/pc适龄提示', node: 'a', opened: true, closed: true, openedGo: 'pc适龄提示' },
      { go: 'modal/pc适龄提示', node: 'b', opened: false, closed: true, openedGo: null },
    ],
    inert: { openedModal: false, clicked: 2, visible: 2 },
  }, 'pc');
  assert.equal(dup.ok, false);
  assert.equal(dup.openers.length, 2);
  assert.ok(dup.problems.some((item) => item.includes('modal/pc适龄提示@b')));
  const inertPartial = scoreOpenerCatalog({
    plat: 'mobile',
    openers: [{ go: 'modal/mobile适龄提示', opened: true, closed: true, openedGo: 'mobile适龄提示' }],
    inert: { openedModal: false, clicked: 1, visible: 3 },
  }, 'mobile');
  assert.equal(inertPartial.ok, false);
  assert.ok(inertPartial.problems.includes('mobile-inert-unmeasured'));
});

test('unprefixed same-platform homepage @go stays in the opener catalog', () => {
  const src = readFileSync(new URL('../lib/later-axes-probe.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /wantedPlat === 'pc' && \(!\/\(\?:\\^|\\\/\)\(\?:modal\\\/\)\?pc\/i\.test\(go\)/);
  assert.doesNotMatch(src, /wantedPlat === 'mobile' && !\/mobile\/i\.test\(go\)/);
  assert.match(src, /Visible homepage @go is in-scope/);
  assert.equal(catalogGoMatchesPlat('modal/视频弹窗', 'pc'), true);
  assert.equal(catalogGoMatchesPlat('modal/顶部导航-1624尺寸', 'mobile'), true);
  assert.equal(catalogGoMatchesPlat('modal/多语言按钮弹窗', 'mobile'), true);
  assert.equal(catalogGoMatchesPlat('modal/pc适龄提示', 'pc'), true);
  assert.equal(catalogGoMatchesPlat('modal/mobile适龄提示', 'pc'), false);
  assert.equal(catalogGoMatchesPlat('modal/pc适龄提示', 'mobile'), false);
  assert.equal(catalogGoMatchesPlat('modal/视频弹窗', 'pc', { mountedNames: ['视频弹窗', 'pc适龄提示'] }), true);
  assert.equal(catalogGoMatchesPlat('modal/订阅赛季日程', 'pc', { mountedNames: ['视频弹窗'] }), false);
  const video = catalogEvidenceOk({
    ok: true, measured: true, skipped: false, plat: 'pc',
    mountedNames: ['视频弹窗', 'pc适龄提示'],
    openers: [{
      go: 'modal/视频弹窗',
      openedGo: '视频弹窗',
      ok: true, measured: true, skipped: false, opened: true, closed: true,
    }],
    inert: { ok: true, measured: true, skipped: false, openedModal: false, clicked: 1 },
  }, { plat: 'pc' });
  assert.equal(video, true);
  const scored = scoreOpenerCatalog({
    plat: 'pc',
    mountedNames: ['视频弹窗'],
    openers: [{ go: 'modal/视频弹窗', opened: true, closed: true, openedGo: '视频弹窗' }],
    inert: { openedModal: false, clicked: 1, visible: 1 },
  }, 'pc');
  assert.equal(scored.ok, true);
  assert.equal(scored.openers[0].matched, true);
});

test('open dropmenu without option fill and missing calendar copy fail closed', () => {
  const unfilled = scoreOpenerCatalog({
    plat: 'mobile',
    openers: [{
      go: 'modal/mobile订阅赛季日程',
      opened: true,
      closed: true,
      openedGo: 'mobile订阅赛季日程',
      dropmenus: [{ name: '切换地区', invalid: false, toggled: true, coversConsent: false, optionFill: false }],
    }],
    inert: { openedModal: false, clicked: 1, visible: 1 },
  }, 'mobile');
  assert.equal(unfilled.ok, false);
  assert.ok(unfilled.problems.some((item) => item.includes('dropmenu-option-unfilled')));
  const missingCopy = scoreOpenerCatalog({
    plat: 'pc',
    openers: [{
      go: 'modal/pc_cn订阅赛季日程',
      lang: 'en',
      opened: true,
      closed: true,
      openedGo: 'pc_cn订阅赛季日程',
      calendarLang: { wanted: 'en', got: 'cn', matched: false, copyMissing: 1 },
      calendarCopy: [{ node: '721:8525', lang: 'en', missing: true }],
    }],
    inert: { openedModal: false, clicked: 1, visible: 1 },
  }, 'pc');
  assert.equal(missingCopy.ok, false);
  assert.ok(missingCopy.problems.some((item) => item.includes('calendar-lang')));
  assert.equal(catalogEvidenceOk({
    ok: true, measured: true, skipped: false, plat: 'pc',
    openers: [{
      go: 'modal/pc适龄提示',
      openedGo: 'pc适龄提示',
      ok: true, measured: true, skipped: false, opened: true, closed: true,
      dropmenus: [{ invalid: false, toggled: true, coversConsent: false, optionFill: false }],
    }],
    inert: { ok: true, measured: true, skipped: false, openedModal: false, clicked: 1 },
  }, { plat: 'pc' }), false);
  const noRegionOptions = scoreOpenerCatalog({
    plat: 'mobile',
    openers: [{
      go: 'modal/mobile订阅赛季日程',
      opened: true,
      closed: true,
      openedGo: 'mobile订阅赛季日程',
      dropmenus: [{ name: '切换地区', invalid: false, toggled: true, coversConsent: false, optionFill: null }],
    }],
    inert: { openedModal: false, clicked: 1, visible: 1 },
  }, 'mobile');
  assert.equal(noRegionOptions.ok, true);
  const unboundCarnival = scoreOpenerCatalog({
    plat: 'pc',
    openers: [{
      go: 'modal/pc_cn订阅赛季日程',
      lang: 'en',
      opened: true,
      closed: true,
      openedGo: 'pc_cn订阅赛季日程',
      calendarLang: { wanted: 'en', got: 'en', matched: true, copyMissing: 0 },
      calendarCopy: [],
    }],
    inert: { openedModal: false, clicked: 1, visible: 1 },
  }, 'pc');
  assert.equal(unboundCarnival.ok, true);
  const calendarNoShell = scoreOpenerCatalog({
    plat: 'pc',
    openers: [{
      go: 'modal/pc_cn订阅赛季日程',
      lang: 'en',
      opened: true,
      closed: true,
      openedGo: 'pc_cn订阅赛季日程',
      calendarLang: { wanted: 'en', got: '', matched: false, copyMissing: 0 },
    }],
    inert: { openedModal: false, clicked: 1, visible: 1 },
  }, 'pc');
  assert.equal(calendarNoShell.ok, false);
  assert.ok(calendarNoShell.problems.some((item) => item.includes('calendar-lang')));
});

test('sourceOverlap skip needs evidence; catalog ok follows dropProblems', () => {
  const region = {
    go: 'modal/mobile订阅赛季日程',
    opened: true,
    closed: true,
    openedGo: 'mobile订阅赛季日程',
  };
  const skipped = scoreOpenerCatalog({
    plat: 'mobile',
    openers: [{
      ...region,
      dropmenus: [{
        name: '切换地区',
        invalid: false,
        toggled: true,
        coversConsent: false,
        hostGrew: true,
        sourceOverlap: true,
        sourceOverlapEvidence: { dropmenuNode: '949:6505', consentNode: '949:6494' },
        optionFill: null,
      }],
    }],
    inert: { openedModal: false, clicked: 1, visible: 1 },
  }, 'mobile');
  assert.equal(skipped.ok, true, JSON.stringify(skipped.problems));
  assert.equal(skipped.openers[0].ok, true);
  assert.equal(skipped.problems.length, 0);

  const unproven = scoreOpenerCatalog({
    plat: 'mobile',
    openers: [{
      ...region,
      dropmenus: [{
        name: '切换地区',
        invalid: false,
        toggled: true,
        coversConsent: false,
        hostGrew: true,
        sourceOverlap: true,
        optionFill: null,
      }],
    }],
    inert: { openedModal: false, clicked: 1, visible: 1 },
  }, 'mobile');
  assert.equal(unproven.ok, false);
  assert.equal(unproven.openers[0].ok, false);
  assert.ok(unproven.problems.some((item) => item.includes('dropmenu-source-overlap-unproven')));

  const rendererCover = scoreOpenerCatalog({
    plat: 'mobile',
    openers: [{
      ...region,
      dropmenus: [{
        name: '切换地区',
        invalid: false,
        toggled: true,
        coversConsent: true,
        sourceOverlap: false,
        optionFill: null,
      }],
    }],
    inert: { openedModal: false, clicked: 1, visible: 1 },
  }, 'mobile');
  assert.equal(rendererCover.ok, false);
  assert.equal(rendererCover.openers[0].ok, false);
  assert.ok(rendererCover.problems.some((item) => item.includes('dropmenu-covers-consent')));

  const catalogBase = {
    ok: true, measured: true, skipped: false, plat: 'mobile',
    inert: { ok: true, measured: true, skipped: false, openedModal: false, clicked: 1 },
  };
  const openerBase = {
    go: 'modal/mobile订阅赛季日程',
    openedGo: 'mobile订阅赛季日程',
    ok: true, measured: true, skipped: false, opened: true, closed: true,
  };
  assert.equal(dropmenuOverlapEvidenceOk({ sourceOverlapEvidence: { dropmenuNode: '949:6505', consentNode: '949:6494' } }), true);
  assert.equal(dropmenuOverlapEvidenceOk({ sourceOverlapEvidence: { dropmenuNode: '949:6505' } }), false);
  assert.equal(catalogEvidenceOk({
    ...catalogBase,
    openers: [{
      ...openerBase,
      dropmenus: [{
        invalid: false, toggled: true, coversConsent: false, sourceOverlap: true,
        sourceOverlapEvidence: { dropmenuNode: '949:6505', consentNode: '949:6494' },
        optionFill: null,
      }],
    }],
  }, { plat: 'mobile' }), true);
  assert.equal(catalogEvidenceOk({
    ...catalogBase,
    openers: [{
      ...openerBase,
      dropmenus: [{
        invalid: false, toggled: true, coversConsent: false, sourceOverlap: true, optionFill: null,
      }],
    }],
  }, { plat: 'mobile' }), false, 'sourceOverlap 无证据不得抬绿');
});

test('later-axes opens an already-on region dropmenu before sampling option fill', () => {
  const src = readFileSync(new URL('../lib/later-axes-probe.mjs', import.meta.url), 'utf8');
  assert.match(src, /Inventory default may already be on/);
  assert.match(src, /if \(before !== 'on'\) realClick\(menu\)/);
  assert.match(src, /backgroundImage/);
  assert.match(src, /fillImage/);
  assert.match(src, /fillNodes\.map\(fillImage\)\.find\(Boolean\)/);
  assert.match(src, /closest\('\[hidden\], \[aria-hidden="true"\]'\)/);
  assert.match(src, /querySelectorAll\('\[data-btn-name="切换语言"\]'\)\]\.filter/);
  assert.match(src, /matched: Boolean\(calendarShell\) && got === wanted && copyOk/);
  assert.doesNotMatch(src, /got === wanted \|\| !calendarShell/);
  assert.match(src, /optionBtns\.length \? optionBtns\.every\(optionFillOf\) : null/);
  assert.match(src, /linear-gradient\(0deg, \$\{color\} 0%, \$\{color\} 100%\)/);
  assert.match(src, /path, svg, img/);
  assert.match(src, /data-btn-variant-layer="true"/);
  assert.match(src, /child\.tagName === 'IMG' && child\.getAttribute\('src'\)/);
  assert.match(src, /img\\\/\(\?:选中背景\|未选中背景\)/);
});

test('language remount contract checks every requested language against live menu state', () => {
  const src = readFileSync(new URL('../lib/later-axes-probe.mjs', import.meta.url), 'utf8');
  const render = readFileSync(new URL('../../templates/figma-render.js', import.meta.url), 'utf8');
  assert.match(src, /setPref\('lang', row\.lang\)/);
  assert.match(src, /await waitMs\(page, 200\)/);
  assert.match(src, /collectLanguageOptions\(page\)/);
  assert.match(src, /stalePrefs/);
  assert.match(render, /frame\.__fxRenderPrefs/);
  assert.match(src, /menu/);
  assert.deepEqual(LANG_OPTION_PAGES.map((row) => row.lang), ['en', 'zh-TW', 'zh-CN', 'ko']);
});

test('modal verdict locks PC 3840x2160 center and panel y=199, mobile 390 bounds', () => {
  assert.equal(pcModalSheetVerdict({ sheetCx: 1920, sheetCy: 1080, viewCx: 1920, viewCy: 1080, panelTopRatio: 199 / 2160, panelBox: '0,199,3840,1340' }).ok, true);
  assert.equal(pcModalSheetVerdict({ sheetCx: 1910, sheetCy: 1080, viewCx: 1920, viewCy: 1080, panelTopRatio: 199 / 2160, panelBox: '0,199,3840,1340' }).ok, false);
  assert.equal(pcModalSheetVerdict({ sheetCx: 1920, sheetCy: 1080, viewCx: 1920, viewCy: 1080, panelTopRatio: 230 / 2160, panelBox: '0,230,3840,1340' }).ok, false);
  const base = { hostW: 390, hostH: 844, hostLeft: 0, hostTop: 0, modalH: 844, modalTop: 0, hasClose: true, closedAfterClose: true, hasNamedScroll: false, scrollbarHidden: true };
  for (const bad of [{ modalW: 392, modalLeft: 0 }, { modalW: 390, modalLeft: -2 }, { modalW: 390, modalLeft: 3 }]) assert.equal(mobileModalSheetVerdict({ ...base, ...bad }).ok, false);
});

test('homepage opener catalog is fail-closed for empty, skipped, unmeasured, unopened, and wrong target', () => {
  assert.equal(scoreOpenerCatalog({ plat: 'pc', openers: [], inert: {} }, 'pc').ok, false);
  for (const row of [
    { measured: false, skipped: false, opened: true, closed: true, openedGo: 'x' },
    { measured: true, skipped: true, opened: true, closed: true, openedGo: 'x' },
    { measured: true, skipped: false, opened: false, closed: false, openedGo: '' },
    { measured: true, skipped: false, opened: true, closed: true, openedGo: 'other' },
  ]) assert.equal(scoreOpenerCatalog({ plat: 'pc', openers: [{ go: 'modal/pc适龄提示', ...row }], inert: {} }, 'pc').ok, false);
});

test('language remount and mobile pin read live frame prefs, not first-paint closures', () => {
  const render = readFileSync(new URL('../../templates/figma-render.js', import.meta.url), 'utf8');
  assert.match(render, /frame\.__fxRenderPrefs = \{/);
  assert.match(render, /frame\.setAttribute\('data-fx-base', __base\)/);
  assert.match(render, /const liveBase = frame\.getAttribute\('data-fx-base'\) \|\| __base/);
  assert.match(render, /new Set\(dropmenuLangHits\(raw\)\)/);
  assert.match(render, /Do not __plain the map first/);
  assert.match(render, /Page instances may omit componentProperties/);
  assert.match(render, /const fromName = onOffToken\(dropmenuVariantToken\(__u\(selected && selected\.name\), axis\)\)/);
  assert.match(render, /frame\.__fxSyncLanguageDropmenuHighlight/);
  assert.match(render, /Page instances may uniformly scale the COMPONENT/);
  assert.match(render, /const paintedH = Number\(rootBox\.h\) \* instanceScale/);
  assert.match(render, /uniformScale \? Number\(rootBox\.h\) : paintedH/);
  const interaction = readFileSync(new URL('../../docs/interaction-skill.md', import.meta.url), 'utf8');
  assert.match(interaction, /written at the start of every `renderApp`/);
});
