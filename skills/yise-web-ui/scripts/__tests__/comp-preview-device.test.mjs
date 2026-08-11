import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CHECK = join(ROOT, 'scripts/device-presets-check.mjs');

const presets = {
  breakpoints: [
    { key: 'mobile', min: 0, max: 750 },
    { key: 'tablet', min: 751, max: 1023 },
    { key: 'desktop', min: 1024, max: null },
  ],
  deviceGroups: [
    { key: 'PC', freeResize: true, defaultIndex: 0, devices: [{ name: 'Desktop', width: 1920, height: 1080, dpr: 1 }] },
    { key: 'iPhone', freeResize: false, defaultIndex: 0, devices: [{ name: 'iPhone', width: 390, height: 844, dpr: 3 }] },
  ],
};

function writeDemo({ indexPresets = presets, upstream = 'fixtures/upstream.json', includeTabletTodo = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'qa-device-presets-'));
  mkdirSync(join(dir, 'fixtures'), { recursive: true });
  writeFileSync(join(dir, 'fixtures/device-presets.json'), JSON.stringify(presets, null, 2));
  if (upstream === 'fixtures/upstream.json') writeFileSync(join(dir, 'fixtures/upstream.json'), JSON.stringify(presets, null, 2));
  writeFileSync(join(dir, 'spec.json'), JSON.stringify({
    meta: { name: 'd', summary: { what: 'w', how: 'h', accept: 'a' } },
    matrix: { platforms: ['pc', 'pad', 'mobile'], regions: ['cn'], systems: ['any'], themes: ['default'], langs: ['zh-CN'] },
    states: [{ id: 'default', via: [{ expect: 'default' }] }],
    verify: { cases: [], noClip: [] },
    bindings: [],
    figma: { frames: { pc: { id: '1:1' }, mobile: { id: '1:2' } } },
    adaptation: includeTabletTodo ? { knownDeviations: [{ item: 'tablet', resolution: 'TODO: confirm dedicated tablet design or fallback' }] } : {},
    devicePresets: { local: 'fixtures/device-presets.json', upstream },
  }, null, 2));
  writeFileSync(join(dir, 'index.html'),
    '<!doctype html><script id="qa-devices" type="application/json">'
      + JSON.stringify(indexPresets)
      + '</script>');
  return dir;
}

function run(dir) {
  return spawnSync(process.execPath, [CHECK, '--demo', dir, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
  });
}

test('device-presets-check fails when index.html embedded presets drift from fixtures copy', () => {
  const dir = writeDemo({
    indexPresets: {
      ...presets,
      deviceGroups: presets.deviceGroups.map((g) => g.key === 'iPhone' ? { ...g, devices: [] } : g),
    },
  });
  const res = run(dir);
  assert.notEqual(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stderr, /qa-devices|fixtures\/device-presets\.json/);
});

test('device-presets-check allows missing upstream only after index and local copy match', () => {
  const dir = writeDemo({ upstream: 'fixtures/missing-upstream.json' });
  const res = run(dir);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.status, 'unchecked');
  assert.deepEqual(out.indexSummary, { groups: 2, devices: 2, breakpoints: 3 });
  assert.equal(out.adaptationChecks.ok, true);
});

test('device-presets-check requires tablet fallback/TODO when no tablet frame exists', () => {
  const dir = writeDemo({ includeTabletTodo: false });
  const res = run(dir);
  assert.notEqual(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stderr, /tablet.*fallback\/TODO/);
});
