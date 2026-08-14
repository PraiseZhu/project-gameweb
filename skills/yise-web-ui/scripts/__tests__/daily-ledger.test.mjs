import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildDailyReport,
  chinaDate,
  classifyIssue,
  compareWithPrevious,
  dedupeIssues,
  renderMarkdown,
  safeReadJson,
} from '../daily-ledger.mjs';

test('daily ledger classifies font fallback as renderer font routing', () => {
  const classified = classifyIssue({ source: 'reward-card', key: '12:48635', message: 'reward-code-font-mismatch: Bebas Neue fell back to Alimama' });
  assert.equal(classified.stage, 'renderer');
  assert.equal(classified.rootCauseFamily, 'font-routing-or-loaded-face-mismatch');
});

test('daily ledger classifies render bounds and baked descendants as asset routing', () => {
  const classified = classifyIssue({ source: 'chrome-browser', key: 'asset', message: 'render-bound asset has 3 baked descendants and CSS blur filter' });
  assert.equal(classified.stage, 'asset');
  assert.equal(classified.rootCauseFamily, 'asset-export-or-baked-layer-routing');
});

test('daily ledger classifies source-width/HUG/text-growth/crop defects as reusable first-build family', () => {
  const classified = classifyIssue({
    source: 'component-preflight',
    key: 'mobile-card',
    message: 'source width mismatch: HUG owner did not grow with text growth, crop consumption clipped the phone-card',
  });
  assert.equal(classified.stage, 'renderer');
  assert.equal(classified.rootCauseFamily, 'source-width-hug-owner-text-growth-crop-consumption');
  assert.match(classified.nextStep, /跨平台组件 preflight/);
  assert.match(classified.nextStep, /source owner 宽度/);
  assert.match(classified.nextStep, /Chrome rect/);
});

test('daily markdown explains why first-build review missed source-width/HUG crop defects', () => {
  const dir = mkdtempSync(join(tmpdir(), 'daily-ledger-source-width-'));
  try {
    const report = buildDailyReport({
      demoDir: dir,
      date: '2026-08-14',
      files: { verify: join(dir, 'none.json'), pixel: join(dir, 'none-pixel.json'), liveDiff: join(dir, 'none-live.json') },
      commandRuns: [{ id: 'component-preflight', command: 'node preflight', exitCode: 1, stdout: 'FAIL source width / HUG owner / text growth / crop consumption mismatch', stderr: '' }],
    });
    assert.ok(report.rootCauses.some((root) => root.family === 'source-width-hug-owner-text-growth-crop-consumption'));
    const md = renderMarkdown(report);
    assert.match(md, /首构建只抽了可见首屏\/单平台截图/);
    assert.match(md, /每个原生 Figma 平台树/);
    assert.match(md, /source owner 宽度/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('daily ledger deduplicates repeated normalized failures but keeps occurrence count', () => {
  const entries = dedupeIssues([
    { source: 'command', key: 'a', message: 'asset 1:953 has CSS blur(0.4px)', stage: 'asset', rootCauseFamily: 'asset-export-or-baked-layer-routing', nextStep: 'fix', severity: 'blocking', evidence: {} },
    { source: 'command', key: 'b', message: 'asset 1:953 has CSS blur(0.5px)', stage: 'asset', rootCauseFamily: 'asset-export-or-baked-layer-routing', nextStep: 'fix', severity: 'blocking', evidence: {} },
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].occurrences, 2);
});

test('daily ledger gathers existing reports without interpreting reportOnly as a pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'daily-ledger-'));
  try {
    const verify = join(dir, 'report.json');
    const pixel = join(dir, 'report-pixel.json');
    const live = join(dir, 'live-diff-report.json');
    writeFileSync(verify, JSON.stringify({ ok: false, gateX: { pass: false, failures: [{ error: 'reward-code-font-mismatch' }] } }));
    writeFileSync(pixel, JSON.stringify({ ok: false, reportOnly: true, threshold: 0.005, results: [{ key: 'sec3-pc', status: 'WARN', diffRatio: 0.02 }] }));
    writeFileSync(live, JSON.stringify({ headline: { significant: ['[1:472] fontSize +20%'] } }));
    const report = buildDailyReport({ demoDir: dir, date: '2026-08-07', files: { verify, pixel, liveDiff: live } });
    assert.equal(report.summary.total, 4);
    assert.equal(report.summary.blocking, 1);
    assert.equal(report.summary.warnings, 3);
    assert.ok(report.issues.some((entry) => entry.rootCauseFamily === 'font-routing-or-loaded-face-mismatch'));
    assert.match(renderMarkdown(report), /reportOnly/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('daily ledger reads Asia Shanghai dates and invalid JSON honestly', () => {
  assert.equal(chinaDate(new Date('2026-08-07T16:30:00.000Z')), '2026-08-08');
  const dir = mkdtempSync(join(tmpdir(), 'daily-ledger-json-'));
  try {
    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '{');
    assert.equal(safeReadJson(broken).present, true);
    assert.ok(safeReadJson(broken).error);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test('daily ledger compares root-cause families against the previous day', () => {
  const dir = mkdtempSync(join(tmpdir(), 'daily-ledger-delta-'));
  try {
    writeFileSync(join(dir, '2026-08-06.json'), JSON.stringify({
      rootCauses: [
        { family: 'font-routing-or-loaded-face-mismatch', stage: 'renderer', count: 1 },
        { family: 'old-family', stage: 'asset', count: 1 },
      ],
    }));
    const delta = compareWithPrevious({ rootCauses: [
      { family: 'font-routing-or-loaded-face-mismatch', stage: 'renderer', count: 2 },
      { family: 'new-family', stage: 'verify/tooling', count: 1 },
    ] }, dir, '2026-08-07');
    assert.deepEqual(delta.newFamilies, ['new-family']);
    assert.deepEqual(delta.repeatedFamilies, ['font-routing-or-loaded-face-mismatch']);
    assert.deepEqual(delta.resolvedFamilies, ['old-family']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('daily ledger ignores explicit none assertions in failed command output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'daily-ledger-none-'));
  try {
    const report = buildDailyReport({
      demoDir: dir,
      date: '2026-08-07',
      files: { verify: join(dir, 'none.json'), pixel: join(dir, 'none-pixel.json'), liveDiff: join(dir, 'none-live.json') },
      commandRuns: [{ id: 'smoke', command: 'node smoke', exitCode: 1, stdout: 'missing page assets=none\nFAIL coordinates', stderr: '' }],
    });
    assert.equal(report.issues.length, 1);
    assert.match(report.issues[0].message, /FAIL coordinates/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
