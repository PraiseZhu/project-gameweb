import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runComponentPreflight } from '../lib/component-preflight.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CLI = join(ROOT, 'scripts/component-preflight.mjs');

function fixtureInput() {
  const clippingAncestor = { id: 'generic-card-mask', overflow: 'hidden', rect: { x: 0, y: 0, w: 260, h: 120 } };
  return {
    schema: 'component-preflight/input-v1',
    platforms: [
      {
        label: 'desktop',
        components: [
          {
            id: 'generic-source-width-card',
            name: 'Generic source-width owner',
            tolerancePx: 2,
            source: { box: { x: 0, y: 0, w: 320, h: 96 }, preserveWidth: true },
            chrome: { rect: { x: 0, y: 0, w: 248, h: 96 }, style: { width: '248px' } },
          },
          {
            id: 'generic-max-content-text',
            name: 'Generic unauthorized max-content text',
            source: { box: { x: 0, y: 120, w: 280, h: 80 } },
            chrome: { rect: { x: 0, y: 120, w: 620, h: 80 }, style: { width: 'max-content' } },
            expect: { allowMaxContent: false },
          },
        ],
      },
      {
        label: 'mobile',
        components: [
          {
            id: 'generic-step-fit-copy',
            name: 'Generic unauthorized step-fit copy',
            source: { box: { x: 0, y: 0, w: 220, h: 64 }, textAutoResize: 'HEIGHT' },
            chrome: { rect: { x: 0, y: 0, w: 220, h: 64 }, fitScale: 82, style: { width: '220px' } },
          },
          {
            id: 'generic-hug-owner',
            name: 'Generic HUG owner growth',
            tolerancePx: 2,
            source: { box: { x: 0, y: 80, w: 240, h: 72 }, hug: { axis: 'vertical', sourceSize: 72, minGrowthPx: 44 } },
            chrome: { rect: { x: 0, y: 80, w: 240, h: 88 }, style: { height: '88px' } },
          },
          {
            id: 'generic-clipped-required-text',
            name: 'Generic clipped required text',
            tolerancePx: 2,
            source: { box: { x: 0, y: 180, w: 260, h: 90 }, requiredText: true },
            chrome: {
              rect: { x: 0, y: 180, w: 260, h: 90 },
              text: { required: true, visible: true, scrollHeight: 190, clientHeight: 90, visibleRatio: 0.55 },
              clipAncestors: [clippingAncestor],
              style: { overflow: 'visible' },
            },
          },
          {
            id: 'generic-authorized-fixed-label',
            name: 'Generic authorized fixed label',
            source: { box: { x: 0, y: 300, w: 160, h: 40 }, clipsContent: true },
            chrome: { rect: { x: 0, y: 300, w: 160, h: 40 }, fitScale: 90, style: { width: '160px' } },
            expect: { allowStepFit: true },
          },
        ],
      },
    ],
  };
}

test('component preflight reports structured source-vs-Chrome failures across platform labels', () => {
  const report = runComponentPreflight(fixtureInput());
  assert.equal(report.ok, false);
  assert.equal(report.summary.platforms, 2);
  assert.equal(report.summary.components, 6);
  assert.equal(report.summary.failures, 5);
  for (const code of [
    'source-width-loss',
    'unauthorized-max-content',
    'unauthorized-step-fit',
    'insufficient-hug-growth',
    'hidden-required-text-due-to-clip-ancestor',
  ]) {
    assert.equal(report.summary.byCode[code], 1, `missing ${code}`);
  }
  assert.deepEqual(report.platforms.map((p) => p.label), ['desktop', 'mobile']);
  for (const failure of report.failures) {
    assert.equal(failure.rootCauseFamily, 'source-width-hug-owner-text-growth-crop-consumption');
    assert.equal(failure.stage, 'renderer');
    assert.equal(failure.source, 'component-preflight');
    assert.equal(failure.ledger.rootCauseFamily, failure.rootCauseFamily);
    assert.ok(failure.ledger.message.includes('source width') || failure.message.length > 0);
    assert.ok(!/\b1:\d+\b|\bI\d+:/.test(failure.componentId), 'test fixture must not use product/Figma node ids');
  }
});

test('component preflight stays green for authorized max-content and step-fit', () => {
  const report = runComponentPreflight({
    platforms: [{
      label: 'pad',
      components: [{
        id: 'generic-authorized-hug',
        source: { box: { x: 0, y: 0, w: 100, h: 40 }, allowMaxContent: true, clipsContent: true },
        chrome: { rect: { x: 0, y: 0, w: 100, h: 40 }, style: { width: 'max-content' }, fitScale: 92 },
        expect: { preserveSourceWidth: false, allowStepFit: true },
      }],
    }],
  });
  assert.equal(report.ok, true);
  assert.equal(report.summary.failures, 0);
});

test('component-preflight CLI writes structured report and exits non-zero on failures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'component-preflight-'));
  const input = join(dir, 'input.json');
  const out = join(dir, 'report.json');
  writeFileSync(input, JSON.stringify(fixtureInput(), null, 2));
  const res = spawnSync(process.execPath, [CLI, '--input', input, '--out', out], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.ok(existsSync(out));
  const report = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(report.ok, false);
  assert.equal(report.summary.failures, 5);
  assert.ok(report.failures.every((failure) => failure.ledger && failure.ledger.source === 'component-preflight'));
});
