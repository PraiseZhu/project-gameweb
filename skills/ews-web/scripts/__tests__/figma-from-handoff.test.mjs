import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprintInventories } from '../lib/handoff-contract.mjs';
import { consumeReadyHandoff } from '../lib/ready-consumer.mjs';
import { unknownEvidence, runFromHandoff } from '../lib/from-handoff.mjs';
import { mobileInventory, pcInventory, writeReadyPack } from './helpers/ready-fixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = join(HERE, '../..');
const CLI = join(SKILL_ROOT, 'scripts/figma-from-handoff.mjs');

function tmp(name) {
  return mkdtempSync(join(tmpdir(), name));
}

function listHtml(root) {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, name.name);
      if (name.isDirectory()) walk(abs);
      else if (name.name.endsWith('.html')) out.push(abs);
    }
  };
  walk(root);
  return out;
}

test('dual-end ready pack is edible, unknown stays unwired, no HTML is written', () => {
  const dir = join(tmp('ews-from-dual-'), 'handoff');
  writeReadyPack(dir);
  const before = listHtml(dir);
  const result = runFromHandoff(dir);
  assert.equal(result.ok, true, (result.problems || []).join('\n'));
  assert.equal(result.kind, 'ready');
  assert.equal(result.ready, true);
  assert.equal(result.consume.pc.unknownNotWired, true);
  assert.equal(result.consume.mobile.unknownNotWired, true);
  assert.ok(result.consume.pc.unknownCount > 0);
  assert.ok(result.consume.mobile.unknownCount > 0);
  assert.deepEqual(result.consume.pc.wiredUnknownIds, []);
  assert.deepEqual(result.consume.mobile.wiredUnknownIds, []);
  const consumed = consumeReadyHandoff({ handoffDir: dir });
  const unknown = consumed.pageTree.pc.filter((node) => node.status === 'unknown');
  assert.ok(unknown.length > 0);
  assert.ok(unknown.every((node) => node.interaction === 'draw-only'));
  assert.deepEqual(listHtml(dir), before);
  assert.equal(existsSync(join(dir, 'index.html')), false);
});

test('single packed end is checked; missing end is null', () => {
  const pcDir = join(tmp('ews-from-pc-'), 'handoff');
  writeReadyPack(pcDir, { pc: pcInventory(), mobile: null });
  const pcResult = runFromHandoff(pcDir);
  assert.equal(pcResult.ok, true, (pcResult.problems || []).join('\n'));
  assert.deepEqual(pcResult.ends, ['pc']);
  assert.equal(pcResult.consume.pc.unknownNotWired, true);
  assert.equal(pcResult.consume.mobile, null);
  assert.equal(Object.hasOwn(pcResult, 'unknownNotWired'), false);

  const moDir = join(tmp('ews-from-mo-'), 'handoff');
  writeReadyPack(moDir, { pc: null, mobile: mobileInventory() });
  const moResult = runFromHandoff(moDir);
  assert.equal(moResult.ok, true, (moResult.problems || []).join('\n'));
  assert.deepEqual(moResult.ends, ['mobile']);
  assert.equal(moResult.consume.pc, null);
  assert.equal(moResult.consume.mobile.unknownNotWired, true);
});

test('illegal, fingerprint, and structure errors are non-zero and write no HTML', () => {
  const root = tmp('ews-from-bad-');
  const missing = runFromHandoff(join(root, 'no-such'));
  assert.equal(missing.ok, false);
  assert.equal(missing.ready, false);
  assert.equal(missing.consume.pc, null);
  assert.equal(missing.consume.mobile, null);

  const draftDir = join(root, 'draft');
  const draftPc = pcInventory();
  draftPc.status = 'draft';
  writeReadyPack(draftDir, { pc: draftPc, mobile: mobileInventory() });
  const draft = runFromHandoff(draftDir);
  assert.equal(draft.ok, false);
  assert.equal(draft.kind, null);
  assert.equal(draft.ready, false);
  assert.ok(draft.problems.some((item) => /ready/.test(item)));

  const badFp = join(root, 'badfp');
  writeReadyPack(badFp);
  const manifestPath = join(badFp, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.fingerprint = 'deadbeefdeadbeef';
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const tampered = runFromHandoff(badFp);
  assert.equal(tampered.ok, false);
  assert.ok(tampered.problems.some((item) => /fingerprint/.test(item)));
  assert.equal(tampered.consume.pc, null);

  const boxDir = join(root, 'box');
  const pc = pcInventory();
  delete pc.nodes.find((item) => item.id === '100:5').pageBox;
  writeReadyPack(boxDir, { pc, mobile: mobileInventory() });
  const structured = runFromHandoff(boxDir);
  assert.equal(structured.ok, false);
  assert.ok(structured.problems.some((item) => /pageBox|structure|completeness/.test(item)));
  assert.equal(existsSync(join(boxDir, 'index.html')), false);
  assert.equal(listHtml(root).length, 0);
});

test('library variant envelope without pageBox is still edible', () => {
  const dir = join(tmp('ews-from-libvar-'), 'handoff');
  const pc = pcInventory();
  const variant = pc.attachments.componentSets[0].variants[0];
  delete variant.pageBox;
  delete variant.parentBox;
  delete variant.rotation;
  delete variant.scope;
  delete variant.parentId;
  writeReadyPack(dir, { pc, mobile: mobileInventory() });
  const result = runFromHandoff(dir);
  assert.equal(result.ok, true, (result.problems || []).join('\n'));
  assert.equal(result.kind, 'ready');
});

test('unknownNotWired is evidence, not an unconditional stamp', () => {
  const consumed = {
    ends: ['pc'],
    pageTree: {
      pc: [
        { id: 'u1', status: 'unknown', interaction: 'eligible' },
        { id: 'ok', status: 'determined', interaction: 'eligible' },
      ],
    },
    unknown: [{ platform: 'pc', id: 'u1', interaction: 'draw-only', wired: false }],
  };
  const evidence = unknownEvidence(consumed, 'pc');
  assert.equal(evidence.unknownNotWired, false);
  assert.deepEqual(evidence.wiredUnknownIds, ['u1']);
  assert.equal(unknownEvidence(consumed, 'mobile'), null);

  const clean = {
    ends: ['pc'],
    pageTree: { pc: [{ id: 'u2', status: 'unknown', interaction: 'draw-only' }] },
    unknown: [{ platform: 'pc', id: 'u2', interaction: 'draw-only', wired: false }],
  };
  assert.equal(unknownEvidence(clean, 'pc').unknownNotWired, true);
});

test('CLI prints consume fields and stays independent of sibling skills', () => {
  const dir = join(tmp('ews-from-cli-'), 'handoff');
  const docs = writeReadyPack(dir);
  const spawned = spawnSync(process.execPath, [CLI, dir], { encoding: 'utf8', cwd: SKILL_ROOT });
  assert.equal(spawned.status, 0, spawned.stderr || spawned.stdout);
  const printed = JSON.parse(spawned.stdout);
  assert.equal(printed.ok, true);
  assert.equal(printed.kind, 'ready');
  assert.equal(printed.ready, true);
  assert.equal(printed.fingerprint, docs.manifest.fingerprint);
  assert.equal(printed.fingerprint, fingerprintInventories(docs.pc, docs.mobile));
  assert.equal(printed.consume.pc.unknownNotWired, true);
  assert.equal(printed.consume.mobile.unknownNotWired, true);
  assert.equal(Object.hasOwn(printed, 'unknownNotWired'), false);
  assert.equal(existsSync(join(dir, 'index.html')), false);

  const failed = spawnSync(process.execPath, [CLI], { encoding: 'utf8', cwd: SKILL_ROOT });
  assert.notEqual(failed.status, 0);
  const src = readFileSync(CLI, 'utf8') + readFileSync(join(SKILL_ROOT, 'scripts/lib/from-handoff.mjs'), 'utf8');
  assert.doesNotMatch(src, /yise-web-ui|torchlight-web/);
});

void mkdirSync;
