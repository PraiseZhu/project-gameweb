import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';
import { runSourceGeometryBrowserCheck } from '../lib/figma-source-geometry-browser-check.mjs';

const repoDir = process.cwd();
const demoDir = resolve(repoDir, 'demos/yise-ss5-preview');
const evidenceDoc = resolve(repoDir, 'docs/phase2-title-line-break-evidence-matrix.md');
const localeLimitJson = resolve(repoDir, 'artifacts/official-kv-nav-20260812-stage2-locale-limit/summary.json');
const officialRecoveryJson = resolve(repoDir, 'artifacts/phase2-title-official-recovery-20260813/official-title-recovery-1920x1080.json');
const officialRecoveryScrollJson = resolve(repoDir, 'artifacts/phase2-title-official-recovery-20260813/official-title-recovery-scroll-1920x1080.json');
const officialMobileRecoveryJson = resolve(repoDir, 'artifacts/phase2-title-official-mobile-recovery-20260813/official-title-mobile-360x800-750x1600.json');
const titleArtifactDir = resolve(repoDir, 'artifacts/phase2-title-container-20260812');
const titleGeometryDir = resolve(titleArtifactDir, 'title-geometry');
const titleVisualJson = resolve(titleArtifactDir, 'current-title-container-visual-gate.json');

const provenDesktopGeometryProbes = [
  {
    name: '02-title-container',
    sectionId: '1:467',
    nodeIds: ['12:39102', '12:39103'],
    tolerance: { position: 10, size: 16 },
  },
  {
    name: '09-title-container',
    sectionId: '1:747',
    nodeIds: ['I1:820;12:47553', 'I1:820;12:47555', 'I1:820;12:47556', 'I1:820;12:47557'],
    tolerance: { position: 12, size: 16 },
  },
  {
    name: 'more-button-container',
    sectionId: '1:821',
    nodeIds: ['1:848', '1:849', '1:850'],
    tolerance: { position: 8, size: 12 },
  },
];

const languages = ['zh-CN', 'en', 'ja', 'ko', 'zh-TW'];
const hardGateCells = [
  { area: '02-title', lang: 'zh-CN', nodeId: '12:39103', text: 'ss4赛季奖励', lineCount: 1, missing: 'zh-CN' },
  { area: '09-title', lang: 'zh-CN', nodeId: 'I1:820;12:47557', text: '源格觉醒', lineCount: 1, missing: 'zh-CN' },
  { area: '09-title-fallback', lang: 'en', nodeId: 'I1:820;12:47557', text: '源格觉醒', lineCount: 1, missing: 'en', onlyFallbackGate: true },
  { area: '09-title-fallback', lang: 'ja', nodeId: 'I1:820;12:47557', text: '源格觉醒', lineCount: 1, missing: 'ja', onlyFallbackGate: true },
  { area: '09-title-fallback', lang: 'ko', nodeId: 'I1:820;12:47557', text: '源格觉醒', lineCount: 1, missing: 'ko', onlyFallbackGate: true },
  { area: '09-title-fallback', lang: 'zh-TW', nodeId: 'I1:820;12:47557', text: '源格觉醒', lineCount: 1, missing: 'zh-TW', onlyFallbackGate: true },
  { area: 'More', lang: 'zh-CN', nodeId: '1:849', text: '更多', lineCount: 1, missing: null },
  { area: 'More', lang: 'en', nodeId: '1:849', text: 'More', lineCount: 1, missing: null },
  { area: 'More', lang: 'ja', nodeId: '1:849', text: 'さらに', lineCount: 1, missing: null },
  { area: 'More', lang: 'ko', nodeId: '1:849', text: '더 보기', lineCount: 1, missing: null },
  { area: 'More', lang: 'zh-TW', nodeId: '1:849', text: '更多', lineCount: 1, missing: null },
];

const incompleteCells = [
  ...['en', 'ja', 'ko', 'zh-TW'].map((lang) => ({
    area: '03-broad-title-rule',
    lang,
    viewport: 'desktop',
    status: 'evidence-incomplete',
    blocksProductWrapChange: true,
    reason: 'only exact matched 03 official strings are proven; broad section rules remain unsupported',
  })),
  {
    area: '03-broad-title-rule',
    lang: 'all',
    viewport: 'mobile',
    status: 'evidence-incomplete',
    blocksProductWrapChange: true,
    reason: 'mobile evidence covers only exact matched strings at 360x800 and 750x1600',
  },
  ...['09-title', 'More'].map((area) => ({
    area,
    lang: 'all',
    viewport: 'mobile',
    status: 'evidence-incomplete',
    blocksProductWrapChange: true,
    reason: 'mobile official DOM evidence was hidden, ambiguous, or not reliably found',
  })),
];

const officialRoutes = Object.freeze({
  'zh-CN': 'https://etheria.xd.com/?language=zh_CN',
  en: 'https://etheria.xd.com/?language=en_US',
  ja: 'https://etheria.xd.com/?language=ja_JP',
  ko: 'https://etheria.xd.com/?language=ko_KR',
  'zh-TW': 'https://etheria.xd.com/?language=zh_TW',
});

const official02RewardTitleFacts = [
  { lang: 'zh-CN', title: 'SS5 赛季奖励', lineCount: 1, fontSize: 30, fontWeight: '700', width: 324, height: 36 },
  { lang: 'en', title: 'SS5 Seasonal Rewards', lineCount: 1, fontSize: 30, fontWeight: '400', width: 324, height: 36 },
  { lang: 'ja', title: 'SS5シーズン報酬', lineCount: 1, fontSize: 24.9984, fontWeight: '700', width: 324, height: 30 },
  { lang: 'ko', title: 'SS5 시즌 보상', lineCount: 1, fontSize: 30, fontWeight: '700', width: 324, height: 36 },
  { lang: 'zh-TW', title: 'SS5 賽季獎勵', lineCount: 1, fontSize: 24.9984, fontWeight: '700', width: 324, height: 30 },
];

const official09AwakenedFacts = [
  { lang: 'zh-CN', title: '新觉醒', lineCount: 1, fontSize: 20 },
  { lang: 'en', title: 'NEW AWAKENED SR', lineCount: 1, fontSize: 20 },
  { lang: 'ja', title: '新覚醒', lineCount: 1, fontSize: 20 },
  { lang: 'ko', title: '신규 각성 SR', lineCount: 1, fontSize: 20 },
  { lang: 'zh-TW', title: '新覺醒', lineCount: 1, fontSize: 20 },
];

const official03PartialFacts = [
  { lang: 'zh-CN', title: '新赛季启程庆典', lineCount: 1 },
  { lang: 'zh-CN', title: 'SS5 赛季奖励', lineCount: 1 },
  { lang: 'zh-CN', title: '热浪音乐庆典', lineCount: 1 },
  { lang: 'en', title: 'New Season Celebration', lineCount: 1 },
  { lang: 'en', title: 'SS5 Seasonal Rewards', lineCount: 1 },
  { lang: 'en', title: 'PYRO GALA', lineCount: 1 },
  { lang: 'ja', title: '新シーズンカーニバルイベント', lineCount: 2 },
  { lang: 'ja', title: 'SS5シーズン報酬', lineCount: 1 },
  { lang: 'ja', title: 'サマービートフェスティバル', lineCount: 1 },
  { lang: 'ko', title: '신규 시즌 기념 이벤트', lineCount: 1 },
  { lang: 'ko', title: 'SS5 시즌 보상', lineCount: 1 },
  { lang: 'ko', title: '서머 뮤직 페스티벌', lineCount: 1 },
  { lang: 'zh-TW', title: '新賽季啟程慶典', lineCount: 1 },
  { lang: 'zh-TW', title: 'SS5 賽季獎勵', lineCount: 1 },
  { lang: 'zh-TW', title: '熱浪音樂慶典', lineCount: 1 },
];

const provedTitleVisualCells = [
  {
    area: '02-title',
    lang: 'zh-CN',
    textNodeId: '12:39103',
    slotNodeId: '12:39102',
    expectedText: 'ss4赛季奖励',
    minInkToSlotWidth: 0.45,
    maxInkToSlotWidth: 0.72,
    maxCenterDriftPx: 10,
  },
  {
    area: '09-title',
    lang: 'zh-CN',
    textNodeId: 'I1:820;12:47557',
    slotNodeId: 'I1:820;12:47557',
    leftOrnamentNodeId: 'I1:820;12:47555',
    rightOrnamentNodeId: 'I1:820;12:47556',
    expectedText: '源格觉醒',
    minInkToSlotWidth: 0.92,
    maxInkToSlotWidth: 1.08,
    maxCenterDriftPx: 10,
    requireDecorativeOverlap: true,
  },
  {
    area: 'More',
    lang: 'zh-CN',
    textNodeId: '1:849',
    slotNodeId: '1:848',
    rightOrnamentNodeId: '1:850',
    expectedText: '更多',
    minInkToSlotWidth: 0.44,
    maxInkToSlotWidth: 0.70,
    maxCenterDriftPx: null,
    maxRightGapPx: 8,
  },
];

async function setLanguage(page, lang) {
  const ok = await page.evaluate((target) => {
    const selects = Array.from(document.querySelectorAll('select'));
    for (const select of selects) {
      const option = Array.from(select.options).find((candidate) => candidate.value === target);
      if (!option) continue;
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }, lang);
  assert.equal(ok, true, `language selector must expose ${lang}`);
  await page.evaluate(() => new Promise((resolveRaf) => requestAnimationFrame(() => requestAnimationFrame(resolveRaf))));
  await page.evaluate(() => new Promise((resolveRaf) => requestAnimationFrame(() => requestAnimationFrame(resolveRaf))));
}

function loadOfficialRecovery() {
  assert.equal(existsSync(officialRecoveryJson), true, 'fresh official recovery artifact is required');
  assert.equal(existsSync(officialRecoveryScrollJson), true, 'fresh scroll official recovery artifact is required');
  return {
    first: JSON.parse(readFileSync(officialRecoveryJson, 'utf8')),
    scroll: JSON.parse(readFileSync(officialRecoveryScrollJson, 'utf8')),
  };
}

function findOfficialMeasurement(bundle, lang, title) {
  const result = (bundle.results || []).find((entry) => entry.lang === lang);
  if (!result) return null;
  const row = (result.measurements || []).find((entry) => entry.title === title);
  if (!row) return null;
  const best = (row.rows || []).find((entry) => entry.visible && entry.lineCount > 0)
    || (row.rows || []).find((entry) => entry.lineCount > 0)
    || null;
  return { result, row, best };
}

function cssPx(value) {
  const n = Number.parseFloat(String(value || ''));
  return Number.isFinite(n) ? n : null;
}

test('Phase 2 title evidence matrix exists and blocks unsupported inferred line-break claims', () => {
  assert.equal(existsSync(evidenceDoc), true, 'formal evidence matrix doc is required');
  const doc = readFileSync(evidenceDoc, 'utf8');
  assert.match(doc, /etheria\.xd\.com\/\?language=zh_CN/);
  assert.match(doc, /official-title-recovery-scroll-1920x1080\.json/);
  assert.match(doc, /evidence-incomplete/);
  assert.match(doc, /must not become product wrap rules/);
  assert.match(doc, /partial-hard-gate/);
  assert.match(doc, /official-evidence-only/);
  assert.match(doc, /official SS5 copy does not overwrite current Stage 2 Figma\/zh-CN copy/);
  assert.match(doc, /broad 03 section\/card-title claim remains blocked/);

  const localeLimit = JSON.parse(readFileSync(localeLimitJson, 'utf8'));
  assert.equal(localeLimit.liveLocaleProbe.outcome, 'locale-blind');
  assert.equal(localeLimit.liveLocaleProbe.observedDocumentLang, 'zh-CN');

  const incompleteByKey = new Map(incompleteCells.map((cell) => [`${cell.viewport}:${cell.area}:${cell.lang}`, cell]));
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    for (const area of ['03-broad-title-rule']) {
      const cell = incompleteByKey.get(`desktop:${area}:${lang}`);
      assert.equal(cell?.status, 'evidence-incomplete', `${area} ${lang} must remain evidence-incomplete`);
      assert.equal(cell?.blocksProductWrapChange, true, `${area} ${lang} must block inferred product changes`);
    }
  }
  for (const area of ['03-broad-title-rule', '09-title', 'More']) {
    const cell = incompleteByKey.get(`mobile:${area}:all`);
    assert.equal(cell?.status, 'evidence-incomplete', `${area} mobile must remain evidence-incomplete`);
    assert.equal(cell?.blocksProductWrapChange, true, `${area} mobile must block inferred product changes`);
  }

  const invalidVerifiedCells = incompleteCells.filter((cell) => cell.status === 'hard-gate' || cell.verified === true);
  assert.deepEqual(invalidVerifiedCells, [], 'incomplete cells cannot be marked verified');
});

test('recovered official desktop route artifacts prove only scoped 02, 03, and 09 title facts', () => {
  const { first, scroll } = loadOfficialRecovery();
  for (const [lang, route] of Object.entries(officialRoutes)) {
    const firstResult = (first.results || []).find((entry) => entry.lang === lang);
    const scrollResult = (scroll.results || []).find((entry) => entry.lang === lang);
    assert.equal(firstResult?.url, route, `${lang} first official route`);
    assert.equal(scrollResult?.url, route, `${lang} scroll official route`);
    assert.deepEqual(firstResult?.pageErrors || [], [], `${lang} first official page errors`);
    assert.deepEqual(scrollResult?.pageErrors || [], [], `${lang} scroll official page errors`);
  }

  for (const fact of official02RewardTitleFacts) {
    const measurement = findOfficialMeasurement(scroll, fact.lang, fact.title);
    assert.ok(measurement?.best, `02 official fact must exist: ${fact.lang} ${fact.title}`);
    assert.equal(measurement.best.lineCount, fact.lineCount, `02 line count ${fact.lang}`);
    assert.ok(Math.abs(Number(measurement.best.elementRect?.width) - fact.width) <= 1, `02 width ${fact.lang}`);
    assert.ok(Math.abs(Number(measurement.best.elementRect?.height) - fact.height) <= 2, `02 height ${fact.lang}`);
    assert.ok(Math.abs(cssPx(measurement.best.computed?.fontSize) - fact.fontSize) <= 0.05, `02 font size ${fact.lang}`);
    assert.equal(String(measurement.best.computed?.fontWeight), fact.fontWeight, `02 font weight ${fact.lang}`);
  }

  for (const fact of official09AwakenedFacts) {
    const measurement = findOfficialMeasurement(scroll, fact.lang, fact.title);
    assert.ok(measurement?.best, `09 official evidence must exist: ${fact.lang} ${fact.title}`);
    assert.equal(measurement.best.lineCount, fact.lineCount, `09 line count ${fact.lang}`);
    assert.ok(Math.abs(cssPx(measurement.best.computed?.fontSize) - fact.fontSize) <= 0.05, `09 font size ${fact.lang}`);
  }

  for (const fact of official03PartialFacts) {
    const measurement = findOfficialMeasurement(first, fact.lang, fact.title);
    assert.ok(measurement?.best, `03 partial official fact must exist: ${fact.lang} ${fact.title}`);
    assert.equal(measurement.best.lineCount, fact.lineCount, `03 partial line count ${fact.lang} ${fact.title}`);
  }

  const byLang = new Map();
  for (const fact of official03PartialFacts) {
    if (!byLang.has(fact.lang)) byLang.set(fact.lang, []);
    byLang.get(fact.lang).push(fact);
  }
  for (const [lang, facts] of byLang) {
    assert.equal(facts.length, 3, `03 partial facts are intentionally scoped to three matched strings for ${lang}`);
  }
});


test('official mobile route artifacts prove only scoped 02 and exact 03 title facts', () => {
  assert.equal(existsSync(officialMobileRecoveryJson), true, 'fresh official mobile recovery artifact is required');
  const mobile = JSON.parse(readFileSync(officialMobileRecoveryJson, 'utf8'));
  const mobileViewports = ['360x800', '750x1600'];
  const facts = [
    { area: '02', lang: 'zh-CN', title: 'SS5 赛季奖励' },
    { area: '02', lang: 'en', title: 'SS5 Seasonal Rewards' },
    { area: '02', lang: 'ja', title: 'SS5シーズン報酬' },
    { area: '02', lang: 'ko', title: 'SS5 시즌 보상' },
    { area: '02', lang: 'zh-TW', title: 'SS5 賽季獎勵' },
    { area: '03', lang: 'zh-CN', title: '新赛季启程庆典' },
    { area: '03', lang: 'zh-CN', title: 'SS5 赛季奖励' },
    { area: '03', lang: 'zh-CN', title: '热浪音乐庆典' },
    { area: '03', lang: 'en', title: 'New Season Celebration' },
    { area: '03', lang: 'en', title: 'SS5 Seasonal Rewards' },
    { area: '03', lang: 'en', title: 'PYRO GALA' },
    { area: '03', lang: 'ja', title: '新シーズンカーニバルイベント' },
    { area: '03', lang: 'ja', title: 'SS5シーズン報酬' },
    { area: '03', lang: 'ja', title: 'サマービートフェスティバル' },
    { area: '03', lang: 'ko', title: '신규 시즌 기념 이벤트' },
    { area: '03', lang: 'ko', title: 'SS5 시즌 보상' },
    { area: '03', lang: 'ko', title: '서머 뮤직 페스티벌' },
    { area: '03', lang: 'zh-TW', title: '新賽季啟程慶典' },
    { area: '03', lang: 'zh-TW', title: 'SS5 賽季獎勵' },
    { area: '03', lang: 'zh-TW', title: '熱浪音樂慶典' },
  ];

  assert.deepEqual((mobile.viewports || []).map((vp) => vp.label), mobileViewports);
  for (const [lang, route] of Object.entries(officialRoutes)) {
    for (const viewport of mobileViewports) {
      const result = (mobile.results || []).find((entry) => entry.lang === lang && entry.viewport?.label === viewport);
      assert.ok(result, 'mobile result must exist for ' + lang + ' ' + viewport);
      assert.equal(result.url, route, 'mobile official route ' + lang + ' ' + viewport);
      assert.deepEqual(result.pageErrors || [], [], 'mobile official page errors ' + lang + ' ' + viewport);
    }
  }

  for (const fact of facts) {
    for (const viewport of mobileViewports) {
      const result = (mobile.results || []).find((entry) => entry.lang === fact.lang && entry.viewport?.label === viewport);
      const measurement = (result?.measurements || []).find((entry) => entry.area === fact.area && entry.title === fact.title);
      assert.ok(measurement?.best, 'mobile fact must exist: ' + fact.lang + ' ' + viewport + ' ' + fact.area + ' ' + fact.title);
      assert.equal(measurement.best.visible, true, 'mobile fact must be visible: ' + fact.lang + ' ' + viewport + ' ' + fact.title);
      assert.equal(measurement.best.lineCount, 1, 'mobile fact one-line: ' + fact.lang + ' ' + viewport + ' ' + fact.title);
      assert.equal(measurement.best.manualBreak, false, 'mobile fact must not be manual-break: ' + fact.lang + ' ' + viewport + ' ' + fact.title);
      assert.ok(Number.parseFloat(measurement.best.computed?.fontSize) > 0, 'mobile fact font size exists');
      assert.ok(measurement.screenshot && measurement.screenshot.includes('phase2-title-official-mobile-recovery-20260813'), 'mobile screenshot path is recorded');
    }
  }

  const visible09 = (mobile.results || []).flatMap((result) =>
    (result.measurements || []).filter((entry) => entry.area === '09' && entry.best?.visible && entry.best?.lineCount > 0)
  );
  assert.deepEqual(visible09, [], '09 mobile remains blocked: only hidden/offscreen zero-size matches were captured');

  const visibleMore = (mobile.results || []).flatMap((result) =>
    (result.measurements || [])
      .filter((entry) => entry.area === 'More' && entry.best?.visible && entry.best?.lineCount > 0)
      .map((entry) => ({ lang: result.lang, viewport: result.viewport?.label, title: entry.title, lineCount: entry.best.lineCount }))
  );
  assert.deepEqual(
    visibleMore.filter((entry) => !(entry.lang === 'ja' && entry.lineCount === 4)),
    [],
    'More mobile remains blocked except the recorded ambiguous Japanese off-target multi-line match'
  );
});

test('unsupported broad 03, official More, and mobile title claims stay fail-closed', () => {
  const doc = readFileSync(evidenceDoc, 'utf8');
  assert.match(doc, /03 broad section\/card-title rule[\s\S]*evidence-incomplete/);
  assert.match(doc, /Only exact matched strings listed above are proven/);
  assert.match(doc, /More official-site geometry[\s\S]*evidence-incomplete/);
  assert.match(doc, /03 broad section\/card-title rule[\s\S]*mobile[\s\S]*evidence-incomplete/);
  assert.match(doc, /09 official awakened title[\s\S]*mobile[\s\S]*evidence-incomplete/);
  assert.match(doc, /More official-site geometry[\s\S]*mobile[\s\S]*evidence-incomplete/);

  const rows = doc.split(/\r?\n/).filter((line) => line.trim().startsWith('|'));
  const broad03Rows = rows.filter((line) => line.includes('03 broad section/card-title rule'));
  const mobileRows = rows.filter((line) => line.includes('mobile') && (line.includes('03 broad section/card-title rule') || line.includes('09 official awakened title') || line.includes('More official-site geometry')));
  assert.ok(broad03Rows.length >= 1, 'broad 03 blocked row must exist');
  assert.ok(mobileRows.length >= 1, 'mobile blocked row must exist');
  const illegalBroad03HardGate = broad03Rows.some((line) => /\|\s*hard-gate\s*\|/.test(line) || /\|\s*partial-hard-gate\s*\|/.test(line));
  const illegalMobileHardGate = mobileRows.some((line) => /\|\s*hard-gate\s*\|/.test(line) || /\|\s*partial-hard-gate\s*\|/.test(line));
  assert.equal(illegalBroad03HardGate, false, 'broad 03 cannot be hard-gated');
  assert.equal(illegalMobileHardGate, false, 'mobile title wraps cannot be hard-gated');
});

test('current desktop DOM satisfies only proved Phase 2 title line-break gates', async () => {
  const server = createSafeStaticServer(demoDir);
  const base = await server.listen();
  const { browser } = await launchChromium(demoDir, { headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err?.message ?? err)));
    await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => typeof window.__qa === 'object' && window.__qa !== null, null, { timeout: 30000 });
    await page.evaluate(() => new Promise((resolveRaf) => requestAnimationFrame(() => requestAnimationFrame(resolveRaf))));

    const measurements = [];
    for (const lang of languages) {
      await setLanguage(page, lang);
      for (const gate of hardGateCells.filter((candidate) => candidate.lang === lang)) {
        const measurement = await page.evaluate((nodeId) => {
          const el = Array.from(document.querySelectorAll('.fx-t')).find((candidate) => candidate.getAttribute('data-node') === nodeId);
          if (!el) return null;
          const range = document.createRange();
          range.selectNodeContents(el);
          const rects = Array.from(range.getClientRects())
            .map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }))
            .filter((r) => r.width > 0.5 && r.height > 0.5);
          const lines = [];
          for (const rect of rects) {
            if (!lines.some((line) => Math.abs(line.y - rect.y) < 2)) lines.push(rect);
          }
          const box = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return {
            text: el.textContent ?? '',
            lineCount: lines.length,
            lines,
            rect: { x: box.x, y: box.y, width: box.width, height: box.height },
            missing: el.getAttribute('data-copy-missing'),
            fontFamily: cs.fontFamily,
            fontSize: cs.fontSize,
            fontWeight: cs.fontWeight,
            lineHeight: cs.lineHeight,
            whiteSpace: cs.whiteSpace,
          };
        }, gate.nodeId);
        measurements.push({ gate, measurement });
      }
    }

    for (const { gate, measurement } of measurements) {
      assert.ok(measurement, `${gate.area} ${gate.lang} node ${gate.nodeId} must exist`);
      assert.equal(measurement.text.trim(), gate.text, `${gate.area} ${gate.lang} text`);
      assert.equal(measurement.lineCount, gate.lineCount, `${gate.area} ${gate.lang} line count`);
      assert.equal(measurement.missing, gate.missing, `${gate.area} ${gate.lang} copy-missing evidence`);
      assert.equal(measurement.whiteSpace, 'pre', `${gate.area} ${gate.lang} must not use inferred wrapping`);
    }

    const fallbackTitleGates = measurements.filter(({ gate }) => gate.onlyFallbackGate);
    assert.equal(fallbackTitleGates.length, 4);
    for (const { measurement } of fallbackTitleGates) {
      assert.match(measurement.fontFamily, /Alimama ShuHeiTi/, '09 non-Chinese fallback keeps source title font');
    }

    const moreGates = measurements.filter(({ gate }) => gate.area === 'More');
    assert.equal(moreGates.length, 5);
    for (const { measurement } of moreGates) {
      assert.equal(measurement.missing, null, 'More uses supplied translation, not fallback');
    }

    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
    await server.close();
  }
});

test('proven 02/09/More title containers stay source-backed in screenshot geometry', async () => {
  mkdirSync(titleGeometryDir, { recursive: true });
  const server = createSafeStaticServer(demoDir);
  const base = await server.listen();
  const { browser } = await launchChromium(demoDir, { headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => typeof window.__qa === 'object' && window.__qa !== null, null, { timeout: 30000 });
    await page.evaluate(() => new Promise((resolveRaf) => requestAnimationFrame(() => requestAnimationFrame(resolveRaf))));
    await page.screenshot({ path: resolve(titleGeometryDir, 'current-1920x1080.png'), fullPage: false });
  } finally {
    await browser.close();
    await server.close();
  }
  const report = await runSourceGeometryBrowserCheck({
    demoDir,
    viewport: { w: 1920, h: 1080 },
    probes: provenDesktopGeometryProbes,
  });

  assert.equal(report.ok, true, JSON.stringify(report.probes, null, 2));
  for (const probe of report.probes) {
    assert.equal(probe.failures.length, 0, `${probe.name} must stay source-backed`);
  }
  assert.deepEqual(report.pageErrors || [], [], 'screenshot geometry gate must not emit page errors');
  assert.ok(existsSync(resolve(titleGeometryDir, 'current-1920x1080.png')), 'current screenshot evidence should be created');
});

test('proven title ink, slots, and ornaments keep screenshot-level relationships', async () => {
  mkdirSync(titleArtifactDir, { recursive: true });
  const server = createSafeStaticServer(demoDir);
  const base = await server.listen();
  const { browser } = await launchChromium(demoDir, { headless: true });
  const pageErrors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('pageerror', (err) => pageErrors.push(String(err?.message ?? err)));
    await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => typeof window.__qa === 'object' && window.__qa !== null, null, { timeout: 30000 });
    await setLanguage(page, 'zh-CN');
    await page.evaluate(() => document.fonts?.ready || Promise.resolve());
    await page.evaluate(() => new Promise((resolveRaf) => requestAnimationFrame(() => requestAnimationFrame(resolveRaf))));

    const measurements = await page.evaluate((cells) => {
      const rectOf = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      const inkOf = (el) => {
        if (!el) return null;
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = Array.from(range.getClientRects())
          .map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom }))
          .filter((r) => r.width > 0.5 && r.height > 0.5);
        if (!rects.length) return null;
        const left = Math.min(...rects.map((r) => r.left));
        const top = Math.min(...rects.map((r) => r.top));
        const right = Math.max(...rects.map((r) => r.right));
        const bottom = Math.max(...rects.map((r) => r.bottom));
        return { x: left, y: top, width: right - left, height: bottom - top, left, top, right, bottom, lineCount: rects.length, rects };
      };
      const byNode = (nodeId) => nodeId ? document.querySelector('[data-node="' + CSS.escape(nodeId) + '"]') : null;
      return cells.map((cell) => {
        const textEl = byNode(cell.textNodeId);
        const slotEl = byNode(cell.slotNodeId);
        const leftEl = byNode(cell.leftOrnamentNodeId);
        const rightEl = byNode(cell.rightOrnmentNodeId || cell.rightOrnamentNodeId);
        const textRect = rectOf(textEl);
        const slotRect = rectOf(slotEl);
        const inkRect = inkOf(textEl);
        const leftRect = rectOf(leftEl);
        const rightRect = rectOf(rightEl);
        const slotCenter = slotRect ? slotRect.left + slotRect.width / 2 : null;
        const inkCenter = inkRect ? inkRect.left + inkRect.width / 2 : null;
        return {
          area: cell.area,
          lang: cell.lang,
          textNodeId: cell.textNodeId,
          text: textEl?.textContent?.trim() ?? null,
          copyMissing: textEl?.getAttribute('data-copy-missing'),
          textRect,
          slotRect,
          inkRect,
          leftRect,
          rightRect,
          inkToSlotWidth: slotRect && inkRect ? inkRect.width / slotRect.width : null,
          centerDriftPx: slotCenter != null && inkCenter != null ? inkCenter - slotCenter : null,
          leftGapPx: leftRect && inkRect ? inkRect.left - leftRect.right : null,
          rightGapPx: rightRect && inkRect ? rightRect.left - inkRect.right : null,
          leftOverlapPx: leftRect && inkRect ? Math.min(leftRect.right, inkRect.right) - Math.max(leftRect.left, inkRect.left) : null,
          rightOverlapPx: rightRect && inkRect ? Math.min(rightRect.right, inkRect.right) - Math.max(rightRect.left, inkRect.left) : null,
        };
      });
    }, provedTitleVisualCells);

    writeFileSync(titleVisualJson, JSON.stringify({ viewport: { w: 1920, h: 1080 }, measurements, pageErrors }, null, 2));

    for (const cell of provedTitleVisualCells) {
      const measurement = measurements.find((candidate) => candidate.area === cell.area && candidate.lang === cell.lang);
      assert.ok(measurement, cell.area + ' measurement must exist');
      assert.equal(measurement.text, cell.expectedText, cell.area + ' text must stay source-backed');
      assert.ok(measurement.slotRect, cell.area + ' slot rect must exist');
      assert.ok(measurement.inkRect, cell.area + ' ink rect must exist');
      assert.ok(
        measurement.inkToSlotWidth >= cell.minInkToSlotWidth && measurement.inkToSlotWidth <= cell.maxInkToSlotWidth,
        cell.area + ' ink/slot width ratio ' + measurement.inkToSlotWidth + ' outside source-backed range'
      );
      if (cell.maxCenterDriftPx != null) {
        assert.ok(
          Math.abs(measurement.centerDriftPx) <= cell.maxCenterDriftPx,
          cell.area + ' ink center drift ' + measurement.centerDriftPx + 'px exceeds tolerance'
        );
      }
      if (cell.leftOrnamentNodeId && cell.rightOrnamentNodeId) {
        assert.ok(measurement.leftRect, cell.area + ' left ornament must exist');
        assert.ok(measurement.rightRect, cell.area + ' right ornament must exist');
        if (cell.requireDecorativeOverlap) {
          assert.ok(measurement.leftOverlapPx > 0, cell.area + ' left ornament should remain a painted title backdrop');
          assert.ok(measurement.rightOverlapPx > 0, cell.area + ' right ornament should remain a painted title backdrop');
        } else if (cell.ornamentGapTolerancePx != null) {
          assert.ok(
            Math.abs(measurement.leftGapPx - measurement.rightGapPx) <= cell.ornamentGapTolerancePx,
            cell.area + ' left/right ornament gaps drift: ' + measurement.leftGapPx + ' vs ' + measurement.rightGapPx
          );
        }
      }
      if (cell.rightOrnamentNodeId && !cell.leftOrnamentNodeId) {
        assert.ok(measurement.rightRect, cell.area + ' right ornament must exist');
        assert.ok(measurement.rightGapPx >= 0, cell.area + ' right ornament must remain after text');
        if (cell.maxRightGapPx != null) {
          assert.ok(
            measurement.rightGapPx <= cell.maxRightGapPx,
            cell.area + ' text/right ornament gap ' + measurement.rightGapPx + 'px exceeds source-backed tolerance'
          );
        }
      }
    }
    assert.deepEqual(pageErrors, []);
    assert.ok(existsSync(titleVisualJson), 'title visual relationship artifact should be created');
  } finally {
    await browser.close();
    await server.close();
  }
});



