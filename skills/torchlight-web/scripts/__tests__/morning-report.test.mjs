import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  renderMorningReport, toMorningCandidate, checkPolicyManifest, loadLedgerStates,
} from '../daily-ledger.mjs';

function mkReport(overrides = {}) {
  return {
    schema: 'figma-daily-ledger/v1', date: '2026-08-11', generatedAt: '2026-08-11T00:00:00Z', demo: 'demo',
    evidenceSources: { commands: [{ id: 'inline', exitCode: 0 }, { id: 'chrome-smoke', exitCode: 1 }] },
    summary: { total: 3, blocking: 1, warnings: 2, byStage: {}, requiresReview: 0 },
    issues: [],
    rootCauses: [],
    reflection: [],
    delta: { comparedTo: '2026-08-10', newFamilies: [], repeatedFamilies: [], resolvedFamilies: [] },
    ...overrides,
  };
}

test('morning report declares v3.1 and renders six sections', () => {
  const md = renderMorningReport(mkReport(), { policy: { ok: true, version: 'v3.1' } });
  assert.match(md, /v3\.1/);
  for (const sec of ['1. 证据', '2. 高价值次日收尾', '3. 观察', '4. owner 决策', '5. 每周复发', '6. 当前 Skill']) {
    assert.match(md, new RegExp(sec.replace(/[.*]/g, '\\$&')));
  }
});

test('morning report routes only fully-gated tighten items to closure section', () => {
  const report = mkReport({
    rootCauses: [
      // 过四门 + 收紧 → 进 §2
      { family: 'ok-tighten', stage: 'renderer', count: 2, channel: 'tighten', attribution: 'confirmed', changeTarget: '改x', criterion: '加判据y', reverify: '复验z', evidence: [{ date: '2026-08-10' }, { date: '2026-08-11' }], nextStep: '改x' },
      // 扩权 → 进 §4，不进 §2
      { family: 'maybe-expansion', stage: 'asset', count: 2, attribution: 'confirmed', changeTarget: '放宽阈值', criterion: 'c', reverify: 'r', evidence: [{ date: '2026-08-10' }, { date: '2026-08-11' }] },
      // 缺归因 → 进 §3 观察
      { family: 'no-attribution', stage: 'verify/tooling', count: 1, changeTarget: '改', criterion: 'c', reverify: 'r' },
    ],
  });
  const md = renderMorningReport(report, { policy: { ok: true, version: 'v3.1' } });
  // §2 含收紧项
  assert.match(md, /## 2[\s\S]*ok-tighten/);
  // 扩权项不进 §2（§2 段落内不含），进 §4
  const sec2 = md.split('## 3')[0];
  assert.ok(!sec2.includes('maybe-expansion'), '扩权项不应出现在收尾候选');
  assert.match(md, /## 4[\s\S]*maybe-expansion/);
  // 缺归因进 §3
  assert.match(md, /## 3[\s\S]*no-attribution/);
});

test('morning report states first-build escape reason and cross-platform component preflight for source-width family', () => {
  const report = mkReport({
    rootCauses: [
      { family: 'source-width-hug-owner-text-growth-crop-consumption', stage: 'renderer', count: 1, nextStep: '执行跨平台组件 preflight：每个原生 Figma 平台树 + fallback/state 对比 source vs Chrome geometry' },
    ],
  });
  const md = renderMorningReport(report, { policy: { ok: true, version: 'v3.1' } });
  assert.match(md, /source-width-hug-owner-text-growth-crop-consumption/);
  assert.match(md, /为什么首构建没拦住/);
  assert.match(md, /首构建只抽了可见首屏\/单平台截图/);
  assert.match(md, /预检处方/);
  assert.match(md, /跨平台组件 preflight/);
  assert.match(md, /source vs Chrome geometry|Chrome 几何|Chrome rect/);
});

test('policy manifest drift fails closed when rules doc hash mismatches', () => {
  const dir = mkdtempSync(join(tmpdir(), 'policy-'));
  try {
    mkdirSync(join(dir, 'evolution'), { recursive: true });
    mkdirSync(join(dir, 'docs'), { recursive: true });
    const docText = '# v3.1 规则\n';
    writeFileSync(join(dir, 'docs', 'ledger-legislation.md'), docText);
    const goodHash = createHash('sha256').update(docText, 'utf8').digest('hex');
    // hash 匹配 → ok
    writeFileSync(join(dir, 'evolution', 'policy-manifest.json'), JSON.stringify({ policyVersion: 'v3.1', rulesDoc: 'docs/ledger-legislation.md', rulesDocSha256: goodHash }));
    assert.equal(checkPolicyManifest(dir).ok, true);
    // hash 漂移 → fail-closed
    writeFileSync(join(dir, 'docs', 'ledger-legislation.md'), docText + '改动');
    const drift = checkPolicyManifest(dir);
    assert.equal(drift.ok, false);
    assert.equal(drift.drift, true);
    // 版本不一致 → fail-closed
    writeFileSync(join(dir, 'docs', 'ledger-legislation.md'), docText);
    writeFileSync(join(dir, 'evolution', 'policy-manifest.json'), JSON.stringify({ policyVersion: 'v9.9', rulesDoc: 'docs/ledger-legislation.md', rulesDocSha256: goodHash }));
    assert.equal(checkPolicyManifest(dir).ok, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ledger states load execState/status/tier per fingerprint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-states-'));
  try {
    mkdirSync(join(dir, 'evolution'), { recursive: true });
    writeFileSync(join(dir, 'evolution', 'ledger.json'), JSON.stringify({ version: 1, entries: [
      { fingerprint: 'fam-a', status: 'open', tier: 'proposal', execState: 'implemented-awaiting-merge' },
    ] }));
    const states = loadLedgerStates(dir);
    assert.equal(states['fam-a'].execState, 'implemented-awaiting-merge');
    assert.equal(states['fam-a'].tier, 'proposal');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('toMorningCandidate defaults attribution to pending and marks legacy notes', () => {
  const c = toMorningCandidate({ family: 'f', stage: 'renderer', count: 1, nextStep: 'ns' }, { 'f': { status: 'landed', noteLegacy: true } });
  assert.equal(c.attribution, 'pending');
  assert.equal(c.noteLegacy, true);
  assert.equal(c.admission.admitted, false);   // pending 归因 + 单实例 → 不过门
});
