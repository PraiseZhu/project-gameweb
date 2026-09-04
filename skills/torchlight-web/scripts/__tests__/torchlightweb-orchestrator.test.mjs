import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseTorchlightwebArgs,
  readTorchlightwebMachine,
  runTorchlightweb,
  torchlightwebMachinePath,
} from '../lib/torchlightweb-machine.mjs';
import {
  greenLaterAxesProbeFixture,
  inertControlLooksClickable,
  laterAxesProbeRecordIsGreen,
  LATER_AXES_PROBE_SCHEMA,
} from '../lib/later-axes-probe.mjs';
import { mintOrchestratorTicket, consumeOrchestratorTicket } from '../lib/orchestrator-ticket.mjs';
import { parseChildJson } from '../torchlightweb.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CLI = join(ROOT, 'scripts/torchlightweb.mjs');
const HTML_CLI = join(ROOT, 'scripts/figma-html-from-handoff.mjs');
const PACK_CLI = join(ROOT, 'scripts/pack-demo.mjs');
const PROBE_CLI = join(ROOT, 'scripts/lib/later-axes-probe.mjs');

function demoDir() {
  const dir = mkdtempSync(join(tmpdir(), 'torchlightweb-orch-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>probe</title>\n');
  return dir;
}

function greenMain() {
  return {
    ok: true,
    fingerprint: 'fp-test',
    productView: { url: 'file:///tmp/index.html?product=1', command: 'open' },
  };
}

function writeGreenProbe(demo) {
  writeFileSync(join(demo, 'later-axes-probe.json'), `${JSON.stringify(greenLaterAxesProbeFixture({ demoDir: demo }), null, 2)}\n`);
}

test('parseChildJson keeps the first complete object even when later braces are truncated', () => {
  const payload = { ok: false, problems: ['inventory-static-gate red'], inventoryStaticGate: { ok: false, problems: ['399:42189: missing-sliceExport-box'] } };
  const pretty = JSON.stringify(payload, null, 2);
  assert.deepEqual(parseChildJson(pretty), payload);
  assert.deepEqual(parseChildJson(`${pretty}\n{"truncated`), payload);
  assert.equal(parseChildJson('{ "ok": false, "problems": ["missing-sliceExport-box"'), null);
});

test('torchlightweb refuses showcase / skip-preview / extra flags', () => {
  const demo = demoDir();
  for (const flag of ['--showcase', '--workflow', '--skip-preview', '--url', '--allow-green-draft']) {
    const parsed = parseTorchlightwebArgs(['--demo', demo, flag, 'x']);
    assert.equal(parsed.ok, false, flag);
    assert.match(parsed.error, /forbidden-flag|unknown-flag/);
  }
  const extra = parseTorchlightwebArgs(['--demo', demo, '--extra', '1']);
  assert.equal(extra.ok, false);
  assert.equal(extra.error, 'unknown-flag:--extra');
});

test('missing ready pack stops and does not invent showcase', async () => {
  const demo = demoDir();
  const result = await runTorchlightweb({
    command: 'start',
    demoDir: demo,
    buildMain: () => { throw new Error('must not build without pack'); },
    packDemo: () => { throw new Error('must not pack'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'missing-ready-pack');
  assert.equal(result.phase, 'need-ready-pack');
  assert.match(result.nextHumanStep, /禁止 figma-showcase/);
  const machine = JSON.parse(readFileSync(torchlightwebMachinePath(demo), 'utf8'));
  assert.equal(machine.phase, 'need-ready-pack');
});

test('refuses continue until accepted', async () => {
  const demo = demoDir();
  const handoff = join(demo, 'handoff');
  let packed = false;
  const start = await runTorchlightweb({
    command: 'start',
    demoDir: demo,
    handoffDir: handoff,
    now: '2026-09-03T00:00:00.000Z',
    buildMain: greenMain,
    packDemo: () => { packed = true; return { ok: true }; },
  });
  assert.equal(start.ok, true, start.error);
  assert.equal(start.phase, 'wait-stop-1');
  const review = JSON.parse(readFileSync(join(demo, 'human-review.json'), 'utf8'));
  assert.equal(review.stops['static-and-translation'].presented, true);
  assert.equal(review.stops['static-and-translation'].accepted, false);

  const skipped = await runTorchlightweb({
    command: 'continue',
    demoDir: demo,
    now: '2026-09-03T00:01:00.000Z',
    buildMain: greenMain,
    packDemo: () => { packed = true; return { ok: true }; },
    probeLaterAxes: () => { throw new Error('must not probe before accept'); },
  });
  assert.equal(skipped.ok, false);
  assert.equal(skipped.error, 'first-stop-not-accepted');
  assert.equal(skipped.phase, 'wait-stop-1');
  assert.equal(packed, false);
  assert.equal(JSON.parse(readFileSync(join(demo, 'human-review.json'), 'utf8')).stops['static-and-translation'].accepted, false);
});

test('accept then continue probes later axes and does not jump to stop 2 until probe is green', async () => {
  const demo = demoDir();
  const handoff = join(demo, 'handoff');
  let packed = false;
  let probed = 0;
  await runTorchlightweb({
    command: 'start',
    demoDir: demo,
    handoffDir: handoff,
    now: '2026-09-03T00:00:00.000Z',
    buildMain: greenMain,
    packDemo: () => { packed = true; return { ok: true }; },
  });
  const accepted = await runTorchlightweb({
    command: 'accept',
    demoDir: demo,
    now: '2026-09-03T00:01:00.000Z',
    buildMain: greenMain,
    packDemo: () => { packed = true; return { ok: true }; },
  });
  assert.equal(accepted.ok, true, accepted.error);
  assert.equal(accepted.phase, 'wait-stop-1');
  assert.equal(JSON.parse(readFileSync(join(demo, 'human-review.json'), 'utf8')).stops['static-and-translation'].accepted, true);

  const redProbe = await runTorchlightweb({
    command: 'continue',
    demoDir: demo,
    now: '2026-09-03T00:02:00.000Z',
    buildMain: greenMain,
    packDemo: () => { packed = true; return { ok: true }; },
    probeLaterAxes: async () => {
      probed += 1;
      return { ok: false, problems: ['composition red'] };
    },
  });
  assert.equal(redProbe.ok, false);
  assert.equal(redProbe.error, 'later-axes-red');
  assert.equal(redProbe.phase, 'later-axes');
  assert.equal(redProbe.laterAxes.interaction, 'red');
  assert.equal(packed, false);

  const greenProbe = await runTorchlightweb({
    command: 'continue',
    demoDir: demo,
    now: '2026-09-03T00:03:00.000Z',
    buildMain: greenMain,
    packDemo: () => { packed = true; return { ok: true }; },
    probeLaterAxes: async () => {
      probed += 1;
      writeGreenProbe(demo);
      return { ok: true, problems: [] };
    },
  });
  assert.equal(greenProbe.ok, true, greenProbe.error);
  assert.equal(greenProbe.phase, 'wait-stop-2');
  assert.equal(greenProbe.laterAxes.interaction, 'probed');
  assert.match(greenProbe.productView?.url || '', /\?product=1$/);
  assert.match(greenProbe.productView?.command || '', /open /);
  assert.equal(JSON.parse(readFileSync(join(demo, 'human-review.json'), 'utf8')).stops['interaction-and-resize'].accepted, false);
  assert.equal(packed, false);
  assert.equal(probed, 2);

  const skipPack = await runTorchlightweb({
    command: 'continue',
    demoDir: demo,
    now: '2026-09-03T00:04:00.000Z',
    buildMain: greenMain,
    packDemo: () => { packed = true; return { ok: true }; },
  });
  assert.equal(skipPack.ok, false);
  assert.equal(skipPack.error, 'second-stop-not-accepted');
  assert.equal(packed, false);

  const accept2 = await runTorchlightweb({
    command: 'accept',
    demoDir: demo,
    now: '2026-09-03T00:05:00.000Z',
    buildMain: greenMain,
    packDemo: () => { packed = true; return { ok: true }; },
  });
  assert.equal(accept2.ok, true, accept2.error);

  const done = await runTorchlightweb({
    command: 'continue',
    demoDir: demo,
    now: '2026-09-03T00:06:00.000Z',
    buildMain: greenMain,
    packDemo: () => { packed = true; return { ok: true, bytesAfter: 1 }; },
  });
  assert.equal(done.ok, true, done.error);
  assert.equal(done.phase, 'done');
  assert.equal(packed, true);
  assert.equal(existsSync(join(demo, 'resize-acceptance.json')), false);
  assert.equal(existsSync(join(demo, 'torchlightweb-machine.json')), false);
  assert.equal(readTorchlightwebMachine(demo).phase, 'done');
});

test('empty later-axes samples and self-exempted inert controls are not green', () => {
  assert.equal(laterAxesProbeRecordIsGreen({
    schema: LATER_AXES_PROBE_SCHEMA,
    ok: true,
    probed: true,
    samples: [],
    problems: [],
  }), false);
  assert.equal(laterAxesProbeRecordIsGreen(greenLaterAxesProbeFixture()), true);
  const missingFont = greenLaterAxesProbeFixture();
  delete missingFont.samples[0].measuredOfficialRootPx;
  assert.equal(laterAxesProbeRecordIsGreen(missingFont), false);
  const stale = greenLaterAxesProbeFixture();
  stale.demoDigest = '1'.repeat(64);
  assert.equal(laterAxesProbeRecordIsGreen(stale, { demoDir: demoDir() }), false);
  assert.equal(inertControlLooksClickable({
    cursor: 'pointer',
    pointerEvents: 'auto',
    wiredAttrs: {},
  }), true);
  assert.equal(inertControlLooksClickable({
    cursor: 'default',
    pointerEvents: 'auto',
    wiredAttrs: { go: 'sec/1' },
  }), true);
  assert.equal(inertControlLooksClickable({
    cursor: 'default',
    pointerEvents: 'none',
    wiredAttrs: { go: 'sec/1' },
  }), false);
});

test('empty later-axes samples cannot present stop 2 or pack', async () => {
  const demo = demoDir();
  const handoff = join(demo, 'handoff');
  let packed = false;
  await runTorchlightweb({
    command: 'start',
    demoDir: demo,
    handoffDir: handoff,
    now: '2026-09-03T00:00:00.000Z',
    buildMain: greenMain,
    packDemo: () => { packed = true; return { ok: true }; },
  });
  await runTorchlightweb({ command: 'accept', demoDir: demo, now: '2026-09-03T00:01:00.000Z' });
  const empty = await runTorchlightweb({
    command: 'continue',
    demoDir: demo,
    now: '2026-09-03T00:02:00.000Z',
    packDemo: () => { packed = true; return { ok: true }; },
    probeLaterAxes: async () => {
      writeFileSync(join(demo, 'later-axes-probe.json'), JSON.stringify({
        schema: LATER_AXES_PROBE_SCHEMA,
        ok: true,
        probed: true,
        samples: [],
        problems: [],
      }));
      return { ok: true, problems: [] };
    },
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.error, 'later-axes-red');
  assert.equal(empty.phase, 'later-axes');
  assert.equal(JSON.parse(readFileSync(join(demo, 'human-review.json'), 'utf8')).stops['interaction-and-resize'].presented, false);
  assert.equal(packed, false);

  writeGreenProbe(demo);
  const presented = await runTorchlightweb({
    command: 'continue',
    demoDir: demo,
    now: '2026-09-03T00:03:00.000Z',
    packDemo: () => { packed = true; return { ok: true }; },
    probeLaterAxes: async () => ({ ok: true, problems: [] }),
  });
  assert.equal(presented.ok, true, presented.error);
  await runTorchlightweb({ command: 'accept', demoDir: demo, now: '2026-09-03T00:04:00.000Z' });
  writeFileSync(join(demo, 'later-axes-probe.json'), JSON.stringify({
    schema: LATER_AXES_PROBE_SCHEMA,
    ok: true,
    probed: true,
    samples: [],
    problems: [],
  }));
  const packedResult = await runTorchlightweb({
    command: 'continue',
    demoDir: demo,
    now: '2026-09-03T00:05:00.000Z',
    packDemo: () => { packed = true; return { ok: true }; },
  });
  assert.equal(packedResult.ok, false);
  assert.equal(packedResult.error, 'later-axes-not-probed');
  assert.equal(packed, false);
});

test('machine-written resize-acceptance.json cannot authorize pack', async () => {
  const demo = demoDir();
  const handoff = join(demo, 'handoff');
  await runTorchlightweb({
    command: 'start',
    demoDir: demo,
    handoffDir: handoff,
    now: '2026-09-03T00:00:00.000Z',
    buildMain: greenMain,
    packDemo: () => ({ ok: true }),
  });
  await runTorchlightweb({ command: 'accept', demoDir: demo, now: '2026-09-03T00:01:00.000Z' });
  await runTorchlightweb({
    command: 'continue',
    demoDir: demo,
    now: '2026-09-03T00:02:00.000Z',
    probeLaterAxes: async () => {
      writeGreenProbe(demo);
      return { ok: true, problems: [] };
    },
  });
  await runTorchlightweb({ command: 'accept', demoDir: demo, now: '2026-09-03T00:03:00.000Z' });
  writeFileSync(join(demo, 'resize-acceptance.json'), JSON.stringify({
    schema: 'yise-resize-acceptance/v1',
    status: 'accepted',
    via: 'torchlightweb-machine',
  }));
  const packed = await runTorchlightweb({
    command: 'continue',
    demoDir: demo,
    now: '2026-09-03T00:04:00.000Z',
    packDemo: () => ({ ok: true }),
  });
  assert.equal(packed.ok, false);
  assert.equal(packed.error, 'machine-resize-acceptance-forbidden');
});

test('start on wait-stop-2 rebuilds Main and returns to wait-stop-1 without packing', async () => {
  const demo = demoDir();
  const handoff = join(demo, 'handoff');
  let packed = false;
  let builds = 0;
  await runTorchlightweb({
    command: 'start',
    demoDir: demo,
    handoffDir: handoff,
    now: '2026-09-03T00:00:00.000Z',
    buildMain: () => { builds += 1; return greenMain(); },
    packDemo: () => { packed = true; return { ok: true }; },
  });
  await runTorchlightweb({ command: 'accept', demoDir: demo, now: '2026-09-03T00:01:00.000Z' });
  await runTorchlightweb({
    command: 'continue',
    demoDir: demo,
    now: '2026-09-03T00:02:00.000Z',
    probeLaterAxes: async () => {
      writeGreenProbe(demo);
      return { ok: true, problems: [] };
    },
  });
  assert.equal(JSON.parse(readFileSync(torchlightwebMachinePath(demo), 'utf8')).phase, 'wait-stop-2');
  const rebuilt = await runTorchlightweb({
    command: 'start',
    demoDir: demo,
    handoffDir: handoff,
    now: '2026-09-03T00:03:00.000Z',
    buildMain: () => { builds += 1; return greenMain(); },
    packDemo: () => { packed = true; return { ok: true }; },
  });
  assert.equal(rebuilt.ok, true, rebuilt.error);
  assert.equal(rebuilt.phase, 'wait-stop-1');
  assert.equal(builds, 2);
  assert.equal(packed, false);
  const review = JSON.parse(readFileSync(join(demo, 'human-review.json'), 'utf8'));
  assert.equal(review.stops['static-and-translation'].presented, true);
  assert.equal(review.stops['static-and-translation'].accepted, false);
  assert.equal(review.stops['interaction-and-resize'].presented, false);
  assert.equal(review.stops['interaction-and-resize'].accepted, false);
});

test('direct html-from-handoff, later-axes probe, and pack-demo CLIs are locked without a ticket, even with env var', () => {
  const html = spawnSync(process.execPath, [HTML_CLI, '--handoff', '/tmp', '--demo', '/tmp'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, TORCHLIGHTWEB_ORCHESTRATOR: '1' },
    timeout: 15000,
  });
  assert.notEqual(html.status, 0);
  assert.match(html.stdout + html.stderr, /html-from-handoff CLI is locked/);

  const probe = spawnSync(process.execPath, [PROBE_CLI, '--demo', '/tmp'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, TORCHLIGHTWEB_ORCHESTRATOR: '1' },
    timeout: 15000,
  });
  assert.notEqual(probe.status, 0);
  assert.match(probe.stdout + probe.stderr, /later-axes-probe CLI is locked/);

  const pack = spawnSync(process.execPath, [PACK_CLI, '--demo', '/tmp'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, TORCHLIGHTWEB_ORCHESTRATOR: '1' },
    timeout: 15000,
  });
  assert.notEqual(pack.status, 0);
  assert.match(pack.stdout + pack.stderr, /pack-demo CLI is locked/);
});

test('orchestrator tickets are one-shot and refuse env-only unlock', () => {
  const ticket = mintOrchestratorTicket({ script: 'scripts/pack-demo.mjs', parentPid: process.ppid });
  const first = consumeOrchestratorTicket({
    script: 'scripts/pack-demo.mjs',
    argv: [process.execPath, PACK_CLI],
    env: ticket.env,
  });
  assert.equal(first.ok, true, first.error);
  const second = consumeOrchestratorTicket({
    script: 'scripts/pack-demo.mjs',
    argv: [process.execPath, PACK_CLI],
    env: ticket.env,
  });
  assert.equal(second.ok, false);
  assert.equal(second.error, 'unknown-orchestrator-ticket');
});

test('accept / continue / status refuse --handoff so the pack cannot change mid-flow', () => {
  const demo = demoDir();
  for (const command of ['accept', 'continue', 'status']) {
    const parsed = parseTorchlightwebArgs([command, '--demo', demo, '--handoff', join(demo, 'other')]);
    assert.equal(parsed.ok, false, command);
    assert.equal(parsed.error, 'handoff-only-on-start');
  }
});

test('torchlightweb CLI rejects unknown commands and missing demo', () => {
  const unknown = spawnSync(process.execPath, [CLI, 'skip-review', '--demo', demoDir()], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stdout, /unknown-command:skip-review/);

  const missing = spawnSync(process.execPath, [CLI, 'status'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(missing.status, 2);
  assert.match(missing.stdout, /missing-demo/);
});

test('SKILL / README / package lock torchlightweb as the only orchestrator', () => {
  const skill = readFileSync(join(ROOT, 'SKILL.md'), 'utf8');
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const cli = readFileSync(join(ROOT, 'scripts/torchlightweb.mjs'), 'utf8');
  assert.equal(pkg.scripts.torchlightweb, 'node scripts/torchlightweb.mjs');
  assert.equal(pkg.scripts['later-axes:probe'], undefined);
  assert.equal(pkg.scripts['human:review'], undefined);
  assert.equal(pkg.scripts['pack:demo'], undefined);
  assert.match(skill, /npm run torchlightweb -- --handoff/);
  assert.match(skill, /npm run torchlightweb -- accept --demo/);
  assert.match(skill, /禁止 `figma-showcase`/);
  assert.doesNotMatch(skill, /才允许 `figma-showcase` 九步/);
  assert.match(readme, /npm run torchlightweb -- --handoff/);
  assert.match(readme, /禁止 `figma-showcase` 九步/);
  assert.match(readme, /非 torchlightweb/);
  assert.doesNotMatch(readme, /The nine steps below/);
  assert.doesNotMatch(readme, /npm run figma:onboard -- --url/);
  assert.doesNotMatch(cli, /buildHtmlFromHandoff\(/);
  assert.doesNotMatch(cli, /TORCHLIGHTWEB_ORCHESTRATOR=1/);
  assert.match(cli, /scripts\/lib\/later-axes-probe\.mjs/);
});
