import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSafeStaticServer } from '../lib/safe-server.mjs';
import { launchChromium } from '../lib/resolve-playwright.mjs';

const repoDir = process.cwd();
const demoDir = resolve(repoDir, 'demos/yise-ss5-preview');
const evidenceDoc = resolve(repoDir, 'docs/phase2-title-line-break-evidence-matrix.md');
const officialRecoveryScrollJson = resolve(
  repoDir,
  'artifacts/phase2-title-official-recovery-20260813/official-title-recovery-scroll-1920x1080.json',
);
const artifactDir = resolve(repoDir, 'artifacts/phase2-title-product-slice-20260813');
const measurementJson = resolve(artifactDir, 'current-stage2-title-product-visual.json');

const languages = ['zh-CN', 'en', 'ja', 'ko', 'zh-TW'];

const productApplicableCells = [
  {
    area: '02-title',
    lang: 'zh-CN',
    nodeId: '12:39103',
    expectedText: 'ss4赛季奖励',
    expectedMissing: 'zh-CN',
    expectedSourceFamily: /Alimama ShuHeiTi/,
    expectedWeight: '700',
    expectedLineCount: 1,
    reason: 'current Stage 2 deliberately uses Figma SS4 source copy for zh-CN acceptance',
  },
  {
    area: '09-title',
    lang: 'zh-CN',
    nodeId: 'I1:820;12:47557',
    expectedText: '源格觉醒',
    expectedMissing: 'zh-CN',
    expectedSourceFamily: /Alimama ShuHeiTi/,
    expectedWeight: '700',
    expectedLineCount: 1,
    reason: 'current Stage 2 has only the Figma source copy bound for this title',
  },
];

const blockedCells = [
  ...['en', 'ja', 'ko', 'zh-TW'].map((lang) => ({
    area: '02-title',
    lang,
    nodeId: '12:39103',
    expectedFallbackText: 'ss4赛季奖励',
    reason: '02 current node is deliberatelyUnbound; official SS5 locale copy must not overwrite Figma SS4 source text',
  })),
  ...['en', 'ja', 'ko', 'zh-TW'].map((lang) => ({
    area: '09-title',
    lang,
    nodeId: 'I1:820;12:47557',
    expectedFallbackText: '源格觉醒',
    reason: '09 official target-language title is evidence-only because Stage 2 has no bound target copy for this node',
  })),
  { area: '03-broad-title-rule', lang: 'all', reason: 'only exact official strings are proven; broad 03 product wrapping remains unsupported' },
  { area: 'mobile-title-wraps', lang: 'all', reason: 'mobile title wraps are evidence-incomplete' },
  { area: 'official-More-geometry', lang: 'all', reason: 'official More geometry is not matched; existing More semantic gate stays Lark + local DOM only' },
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
  await page.evaluate(() => document.fonts?.ready || Promise.resolve());
  await page.evaluate(() => new Promise((resolveRaf) => requestAnimationFrame(() => requestAnimationFrame(resolveRaf))));
}

function cssPx(value) {
  const n = Number.parseFloat(String(value || ''));
  return Number.isFinite(n) ? n : null;
}

async function measureNode(page, nodeId) {
  return page.evaluate((targetNodeId) => {
    const el = Array.from(document.querySelectorAll('.fx-t')).find((candidate) => candidate.getAttribute('data-node') === targetNodeId);
    if (!el) return null;
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = Array.from(range.getClientRects())
      .map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom }))
      .filter((r) => r.width > 0.5 && r.height > 0.5);
    const lines = [];
    for (const rect of rects) {
      if (!lines.some((line) => Math.abs(line.y - rect.y) < 2)) lines.push(rect);
    }
    const box = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      nodeId: targetNodeId,
      text: (el.textContent || '').trim(),
      copyMissing: el.getAttribute('data-copy-missing'),
      rect: { x: box.x, y: box.y, width: box.width, height: box.height, left: box.left, top: box.top, right: box.right, bottom: box.bottom },
      lineCount: lines.length,
      lines,
      computed: {
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        whiteSpace: cs.whiteSpace,
        textAlign: cs.textAlign,
      },
    };
  }, nodeId);
}

function assertOfficialEvidenceStillScoped() {
  assert.equal(existsSync(evidenceDoc), true, 'evidence matrix doc must exist');
  assert.equal(existsSync(officialRecoveryScrollJson), true, 'official desktop recovery artifact must exist');
  const doc = readFileSync(evidenceDoc, 'utf8');
  assert.match(doc, /official SS5 copy does not overwrite current Stage 2 Figma\/zh-CN copy/);
  assert.match(doc, /09 target-language official rows are evidence only/);
  assert.match(doc, /03 can only gate exact matched strings/);
  assert.match(doc, /Mobile title-wrap cells remain evidence-incomplete/);

  const official = JSON.parse(readFileSync(officialRecoveryScrollJson, 'utf8'));
  for (const lang of languages) {
    const result = (official.results || []).find((entry) => entry.lang === lang);
    assert.ok(result, `official recovery must include ${lang}`);
    assert.deepEqual(result.pageErrors || [], [], `official recovery page errors for ${lang}`);
  }
}

test('Phase 2 title product slice has no unsupported product-changing cells', () => {
  assertOfficialEvidenceStillScoped();
  assert.equal(productApplicableCells.length, 2, 'only current-copy-backed zh-CN 02/09 cells are product-applicable now');
  assert.equal(blockedCells.length, 11, 'all target-copy and unsupported wrap cells must remain explicitly blocked');
  for (const cell of blockedCells) {
    assert.ok(cell.reason, `${cell.area} ${cell.lang} must carry a block reason`);
  }
});

test('current Stage 2 desktop 02/09 title product measurements are already within the scoped evidence', async () => {
  mkdirSync(artifactDir, { recursive: true });
  const server = createSafeStaticServer(demoDir);
  const base = await server.listen();
  const { browser } = await launchChromium(demoDir, { headless: true });
  const pageErrors = [];
  const measurements = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('pageerror', (err) => pageErrors.push(String(err?.message ?? err)));
    await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => typeof window.__qa === 'object' && window.__qa !== null, null, { timeout: 30000 });

    for (const lang of languages) {
      await setLanguage(page, lang);
      for (const cell of [...productApplicableCells, ...blockedCells.filter((candidate) => candidate.nodeId && candidate.lang === lang)]) {
        const measurement = await measureNode(page, cell.nodeId);
        assert.ok(measurement, `${cell.area} ${lang} node ${cell.nodeId} must exist`);
        measurements.push({ ...cell, measurement });
      }
    }

    await setLanguage(page, 'zh-CN');
    for (const cell of productApplicableCells) {
      const locator = page.locator(`[data-node="${cell.nodeId}"]`).first();
      await locator.scrollIntoViewIfNeeded();
      await locator.screenshot({ path: resolve(artifactDir, `${cell.area}-${cell.lang}-current.png`) });
    }
  } finally {
    await browser.close();
    await server.close();
  }

  for (const cell of productApplicableCells) {
    const row = measurements.find((entry) => entry.area === cell.area && entry.lang === cell.lang);
    assert.ok(row, `${cell.area} ${cell.lang} measurement must exist`);
    const m = row.measurement;
    assert.equal(m.text, cell.expectedText, `${cell.area} ${cell.lang} must keep source-backed text`);
    assert.equal(m.copyMissing, cell.expectedMissing, `${cell.area} ${cell.lang} copy provenance`);
    assert.equal(m.lineCount, cell.expectedLineCount, `${cell.area} ${cell.lang} line count`);
    assert.match(m.computed.fontFamily, cell.expectedSourceFamily, `${cell.area} ${cell.lang} font family`);
    assert.equal(String(m.computed.fontWeight), cell.expectedWeight, `${cell.area} ${cell.lang} font weight`);
    assert.equal(m.computed.whiteSpace, 'pre', `${cell.area} ${cell.lang} must not use inferred wrapping`);
    assert.ok(cssPx(m.computed.fontSize) > 0, `${cell.area} ${cell.lang} font size must be measurable`);
  }

  for (const cell of blockedCells.filter((candidate) => candidate.nodeId)) {
    const row = measurements.find((entry) => entry.area === cell.area && entry.lang === cell.lang);
    assert.ok(row, `${cell.area} ${cell.lang} blocked measurement must exist`);
    assert.equal(row.measurement.text, cell.expectedFallbackText, `${cell.area} ${cell.lang} must remain source fallback until copy is bound`);
    assert.equal(row.measurement.copyMissing, cell.lang, `${cell.area} ${cell.lang} must expose missing-copy provenance`);
    assert.equal(row.measurement.lineCount, 1, `${cell.area} ${cell.lang} fallback title must remain one line without inferred wrapping`);
    assert.match(row.measurement.computed.fontFamily, /Alimama ShuHeiTi/, `${cell.area} ${cell.lang} fallback must keep source font, not target-locale font`);
  }

  assert.deepEqual(pageErrors, [], 'product title visual gate must not emit page errors');
  const report = {
    viewport: { width: 1920, height: 1080 },
    conclusion: 'no-product-change',
    reason: 'The only product-applicable cells, zh-CN 02 and zh-CN 09, already satisfy the scoped evidence. Target-locale 02/09 and 03/mobile cells remain blocked by copy/evidence policy.',
    productApplicableCells,
    blockedCells,
    measurements,
    pageErrors,
    screenshots: productApplicableCells.map((cell) => resolve(artifactDir, `${cell.area}-${cell.lang}-current.png`)),
  };
  writeFileSync(measurementJson, JSON.stringify(report, null, 2));
  assert.equal(existsSync(measurementJson), true, 'current product visual measurement artifact must be written');
  for (const cell of productApplicableCells) {
    assert.equal(existsSync(resolve(artifactDir, `${cell.area}-${cell.lang}-current.png`)), true, `${cell.area} screenshot must be written`);
  }
});
