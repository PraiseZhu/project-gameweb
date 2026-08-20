import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STATIC_GATE_PROTECTION_SCHEMA,
  captureAcceptedStaticGate,
  replayStaticGateProtection,
} from '../lib/static-gate-protection.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CLI = join(ROOT, 'scripts/static-gate-protection.mjs');

function accepted(platform = 'pc') {
  return captureAcceptedStaticGate({
    platform,
    records: [
      {
        id: 'generic-owner', kind: 'owner',
        source: { nodeRef: 'source-owner-a', box: { x: 0, y: 0, w: 400, h: 120 } },
        chrome: { rect: { x: 10, y: 20, w: 400, h: 120 }, visible: true },
      },
      {
        id: 'generic-asset', kind: 'asset',
        source: { nodeRef: 'source-asset-b', box: { x: 0, y: 160, w: 200, h: 80 } },
        chrome: { rect: { x: 10, y: 180, w: 200, h: 80 }, visible: true, assetKey: 'sha256:asset-a' },
      },
      {
        id: 'generic-text', kind: 'text',
        source: { nodeRef: 'source-text-c', box: { x: 0, y: 280, w: 300, h: 48 } },
        chrome: { rect: { x: 10, y: 300, w: 300, h: 48 }, visible: true, text: 'Initial design label' },
      },
    ],
  });
}

function replayRecords(baseline) {
  return baseline.records.map((record) => ({
    id: record.id,
    kind: record.kind,
    source: {
      ...record.source,
      box: { ...record.source.box },
    },
    chrome: {
      ...record.chrome,
      rect: { ...record.chrome.rect },
    },
  }));
}

test('static gate replay passes after Interaction when accepted initial geometry, asset, and text are unchanged', () => {
  const baseline = accepted('pc');
  const report = replayStaticGateProtection({
    acceptedStatic: baseline,
    module: 'Interaction',
    replay: { platform: 'pc', state: 'initial-static', records: replayRecords(baseline) },
  });
  assert.equal(report.schema, STATIC_GATE_PROTECTION_SCHEMA);
  assert.equal(report.ok, true);
  assert.equal(report.failures.length, 0);
});

test('static gate replay attributes owner geometry and asset/text mutations to later Resize module', () => {
  const baseline = accepted('mobile');
  const records = replayRecords(baseline);
  records[0].chrome.rect.w = 360;
  records[1].chrome.assetKey = 'sha256:asset-b';
  records[2].chrome.text = 'Mutated label';
  const report = replayStaticGateProtection({
    acceptedStatic: baseline,
    module: 'Resize',
    replay: { platform: 'mobile', state: 'initial-static', records },
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.failures.map((item) => item.code).sort(), [
    'accepted-static-asset-mutated',
    'accepted-static-geometry-mutated',
    'accepted-static-text-mutated',
  ]);
  for (const item of report.failures) {
    assert.equal(item.attribution.suspect, 'Resize');
    assert.match(item.attribution.rule, /later module first/);
    assert.equal(item.ledger.source, 'static-gate-protection');
  }
});

test('static gate fails closed for initial-state loss, platform mismatch, missing required record, and visibility loss', () => {
  const baseline = accepted('pad');
  const records = replayRecords(baseline).slice(0, 2);
  records[0].chrome.visible = false;
  const report = replayStaticGateProtection({
    acceptedStatic: baseline,
    module: 'Interaction',
    replay: { platform: 'pc', state: 'later-active-state', records },
  });
  assert.equal(report.ok, false);
  const codes = new Set(report.failures.map((item) => item.code));
  assert.ok(codes.has('static-platform-mismatch'));
  assert.ok(codes.has('static-replay-not-initial-state'));
  assert.ok(codes.has('accepted-static-visibility-lost'));
  assert.ok(codes.has('accepted-static-record-missing'));
});

test('static gate CLI writes machine-readable replay failures for later ledger ingestion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'static-gate-protection-'));
  const baselinePath = join(dir, 'accepted.json');
  const replayPath = join(dir, 'replay.json');
  const out = join(dir, 'report.json');
  const baseline = accepted('pc');
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
  writeFileSync(replayPath, JSON.stringify({
    platform: 'pc', state: 'initial-static',
    records: replayRecords(baseline).map((record, index) => index === 0
      ? { ...record, chrome: { ...record.chrome, rect: { ...record.chrome.rect, h: 90 } } }
      : record),
  }, null, 2));
  const result = spawnSync(process.execPath, [
    CLI, '--accepted-static', baselinePath, '--replay', replayPath,
    '--module', 'Resize', '--out', out,
  ], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.ok(existsSync(out));
  const report = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(report.ok, false);
  assert.equal(report.failures[0].code, 'accepted-static-geometry-mutated');
  assert.equal(report.failures[0].ledger.stage, 'static-protection-replay');
});
