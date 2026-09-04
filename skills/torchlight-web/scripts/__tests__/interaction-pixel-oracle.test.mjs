import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LANG_BTN_FILL,
  LANG_OPTION_PAGES,
  catalogEvidenceOk,
  catalogGoMatchesPlat,
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
