import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { probeSymlinkCapability } from '../lib/runtime-capabilities.mjs';
import { fileURLToPath } from 'node:url';
import {
  acceptStop,
  canStartLaterAxis,
  packAllowedAfterSecondStop,
  presentStop,
} from '../lib/human-review.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CLI = join(ROOT, 'scripts/human-review.mjs');

function demo() {
  return mkdtempSync(join(tmpdir(), 'yise-human-review-'));
}

test('red preview cannot present the first human stop', () => {
  const dir = demo();
  const red = presentStop(dir, 'static-and-translation', { previewOk: false });
  assert.equal(red.ok, false);
  assert.equal(red.reason, 'preview:first-red');
  assert.equal(canStartLaterAxis(dir).ok, false);
});

test('first stop must be accepted before Interaction / Resize, second before Pack', () => {
  const dir = demo();
  assert.equal(canStartLaterAxis(dir).ok, false);
  assert.equal(packAllowedAfterSecondStop(dir).ok, false);

  const presented = presentStop(dir, 'static-and-translation', { previewOk: true });
  assert.equal(presented.ok, true);
  assert.equal(canStartLaterAxis(dir).ok, false);
  assert.match(presented.prompt, /没问题再说继续/);

  const secondTooSoon = presentStop(dir, 'interaction-and-resize', { previewOk: true });
  assert.equal(secondTooSoon.ok, false);
  assert.equal(secondTooSoon.reason, 'first-stop-not-accepted');

  assert.equal(acceptStop(dir, 'static-and-translation').ok, true);
  assert.equal(canStartLaterAxis(dir).ok, true);
  assert.equal(packAllowedAfterSecondStop(dir).ok, false);

  assert.equal(presentStop(dir, 'interaction-and-resize', { previewOk: true }).ok, true);
  assert.equal(acceptStop(dir, 'interaction-and-resize').ok, true);
  assert.equal(packAllowedAfterSecondStop(dir).ok, true);
  const record = JSON.parse(readFileSync(join(dir, 'human-review.json'), 'utf8'));
  assert.equal(record.stops['interaction-and-resize'].accepted, true);
});

test('human-review CLI cannot present or accept; torchlightweb is the signature', () => {
  const dir = demo();
  const presented = spawnSync(process.execPath, [CLI, 'present', '--demo', dir, '--stop', 'static-and-translation', '--preview-ok'], {
    encoding: 'utf8',
  });
  assert.equal(presented.status, 2);
  assert.match(presented.stdout + presented.stderr, /human-review present is locked/);
  presentStop(dir, 'static-and-translation', { previewOk: true });
  const blocked = spawnSync(process.execPath, [CLI, 'accept', '--demo', dir, '--stop', 'static-and-translation'], {
    encoding: 'utf8',
  });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stdout + blocked.stderr, /human-review accept is locked/);
  const record = JSON.parse(readFileSync(join(dir, 'human-review.json'), 'utf8'));
  assert.equal(record.stops['static-and-translation'].accepted, false);
});

test('human-review CLI fail-closes pack-allowed until stop 2 is accepted', () => {
  const dir = demo();
  const blocked = spawnSync(process.execPath, [CLI, 'pack-allowed', '--demo', dir], { encoding: 'utf8' });
  assert.equal(blocked.status, 2);
  presentStop(dir, 'static-and-translation', { previewOk: true });
  acceptStop(dir, 'static-and-translation');
  presentStop(dir, 'interaction-and-resize', { previewOk: true });
  acceptStop(dir, 'interaction-and-resize');
  const allowed = spawnSync(process.execPath, [CLI, 'pack-allowed', '--demo', dir], { encoding: 'utf8' });
  assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
});

test('human-review refuses a symlink marker instead of following it', (t) => {
  const capability = probeSymlinkCapability();
  if (!capability.available) {
    t.skip(`无法创建 symlink（${capability.code}）`);
    return;
  }
  const parent = mkdtempSync(join(tmpdir(), 'yise-human-review-link-'));
  const outside = join(parent, 'outside');
  const dir = join(parent, 'demo');
  mkdirSync(outside);
  mkdirSync(dir);
  writeFileSync(join(outside, 'human-review.json'), JSON.stringify({
    schema: 'yise-human-review/v1',
    stops: {
      'static-and-translation': { presented: true, previewOk: true, accepted: true, acceptedAt: '2026-08-27T00:00:00.000Z' },
      'interaction-and-resize': { presented: true, previewOk: true, accepted: true, acceptedAt: '2026-08-27T00:00:00.000Z' },
    },
  }));
  symlinkSync(join(outside, 'human-review.json'), join(dir, 'human-review.json'));
  assert.equal(packAllowedAfterSecondStop(dir).ok, false);
  const blocked = presentStop(dir, 'static-and-translation', { previewOk: true });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'unsafe-human-review-file');
});
