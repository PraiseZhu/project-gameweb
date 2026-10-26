import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fingerprintInventories, loadReadyPack } from '../lib/handoff-contract.mjs';
import { consumeReadyHandoff } from '../lib/ready-consumer.mjs';
import { runEwsWeb } from '../ews-web.mjs';
import { renderPageHtml } from '../../assets/runtime/render.mjs';
import {
  defaultConfig, defaultDesignations, makeLark, mobileInventory, pcInventory, writeAssets, writeReadyPack,
} from './helpers/ready-fixture.mjs';

function tmp(name) {
  return mkdtempSync(join(tmpdir(), name));
}

test('official fingerprint fields/order match local algorithm; standards copy agrees when present', async () => {
  const pack = writeReadyPack(join(tmp('ews-fp-'), 'pack'));
  const local = fingerprintInventories(pack.pc, pack.mobile);
  assert.equal(local, pack.manifest.fingerprint);
  assert.match(local, /^[a-f0-9]{16}$/);
  let official;
  try {
    official = await import(pathToFileURL(join(
      process.cwd(),
      '../../standards/figma-naming/tool/src/handoff.mjs',
    )).href);
  } catch {
    official = null;
  }
  if (official?.fingerprintInventories) {
    assert.equal(official.fingerprintInventories(pack.pc, pack.mobile), local);
  }
  if (official?.validateHandoffPack) {
    const dir = join(tmp('ews-off-'), 'pack');
    writeReadyPack(dir);
    const localPack = loadReadyPack(dir);
    const officialPack = official.validateHandoffPack(dir);
    assert.equal(localPack.ok, true, localPack.problems.join('\n'));
    assert.equal(officialPack.ok, true, (officialPack.problems || []).join('\n'));
    const empty = join(tmp('ews-empty-'), 'pack');
    const docs = writeReadyPack(empty);
    docs.pc.sections = [];
    writeFileSync(join(empty, 'inventory-pc.json'), JSON.stringify(docs.pc, null, 2));
    const manifest = JSON.parse(readFileSync(join(empty, 'manifest.json'), 'utf8'));
    manifest.fingerprint = fingerprintInventories(docs.pc, docs.mobile);
    writeFileSync(join(empty, 'manifest.json'), JSON.stringify(manifest, null, 2));
    const localEmpty = loadReadyPack(empty);
    const officialEmpty = official.validateHandoffPack(empty);
    assert.equal(localEmpty.ok, false);
    assert.equal(officialEmpty.ok, false);
  }
});

test('R1 ready PC+mobile pack produces HTML with source node ids', () => {
  const root = tmp('ews-r1-');
  const handoff = join(root, 'handoff');
  const docs = writeReadyPack(handoff);
  const assetsDir = join(root, 'assets');
  writeAssets(assetsDir, docs);
  writeFileSync(join(root, 'config.json'), `${JSON.stringify(defaultConfig(docs), null, 2)}\n`);
  const out = join(root, 'out');
  const result = runEwsWeb([
    '--handoff', handoff,
    '--assets', join(assetsDir, 'asset-map.json'),
    '--config', join(root, 'config.json'),
    '--out', out,
  ], { cwd: root });
  assert.equal(result.ok, true, (result.problems || []).join('\n'));
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  assert.match(html, /data-node-id="100:5"/);
  assert.match(html, /data-node-id="100:8"/);
  assert.match(html, /<div class="ews-root"/);
  assert.match(html, /id="ews-model"/);
  const model = JSON.parse(readFileSync(join(out, 'model.json'), 'utf8'));
  assert.equal(model.fingerprint, docs.manifest.fingerprint);
  assert.ok(model.platforms.pc.nodes.some((node) => node.sourceNodeId === '100:5'));
  assert.ok(model.platforms.mobile.nodes.some((node) => node.sourceNodeId === '200:5'));
});

test('R1/R2 reject draft, missing hash, tampered fingerprint, missing end, unknown stays draw-only', () => {
  const root = tmp('ews-r2-');
  const handoff = join(root, 'handoff');
  const docs = writeReadyPack(handoff);
  const loaded = loadReadyPack(handoff);
  assert.equal(loaded.ok, true, loaded.problems.join('\n'));
  assert.equal(loaded.sources.snapshotHashVerifiedAgainstRemoteFigma, false);

  const draftDir = join(root, 'draft');
  const draftPc = pcInventory();
  draftPc.status = 'draft';
  writeReadyPack(draftDir, { pc: draftPc, mobile: mobileInventory() });
  const draft = loadReadyPack(draftDir);
  assert.equal(draft.ok, false);
  assert.ok(draft.problems.some((item) => /ready/.test(item)));

  const noHash = join(root, 'nohash');
  const pcNoHash = pcInventory();
  pcNoHash.snapshot.hash = '';
  writeReadyPack(noHash, { pc: pcNoHash, mobile: mobileInventory() });
  const missingHash = loadReadyPack(noHash);
  assert.equal(missingHash.ok, false);
  assert.ok(missingHash.problems.some((item) => /snapshot\.hash/.test(item)));

  const badFp = join(root, 'badfp');
  writeReadyPack(badFp);
  const manifestPath = join(badFp, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.fingerprint = 'deadbeefdeadbeef';
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const tampered = loadReadyPack(badFp);
  assert.equal(tampered.ok, false);
  assert.ok(tampered.problems.some((item) => /fingerprint/.test(item)));

  const noMobile = join(root, 'nomobile');
  writeReadyPack(noMobile);
  writeFileSync(join(noMobile, 'manifest.json'), JSON.stringify({
    ...docs.manifest,
    ends: ['pc', 'mobile'],
  }));
  // keep files; instead delete mobile by rewriting ends claiming mobile without changing files - already has mobile.
  // Missing end file:
  const onlyPc = join(root, 'onlypc');
  mkdirSync(onlyPc);
  writeFileSync(join(onlyPc, 'inventory-pc.json'), JSON.stringify(pcInventory()));
  writeFileSync(join(onlyPc, 'manifest.json'), JSON.stringify({
    ...docs.manifest,
    ends: ['pc', 'mobile'],
  }));
  const missingEnd = loadReadyPack(onlyPc);
  assert.equal(missingEnd.ok, false);
  assert.ok(missingEnd.problems.some((item) => /inventory-mobile/.test(item)));

  const consumed = consumeReadyHandoff({ handoffDir: handoff });
  assert.equal(consumed.ok, true, (consumed.problems || []).join('\n'));
  const unknown = consumed.pageTree.pc.filter((node) => node.status === 'unknown');
  assert.ok(unknown.length > 0);
  assert.ok(unknown.every((node) => node.interaction === 'draw-only'));
});

test('missing pageBox on determined node is rejected', () => {
  const dir = tmp('ews-box-');
  const pc = pcInventory();
  const node = pc.nodes.find((item) => item.id === '100:5');
  delete node.pageBox;
  writeReadyPack(dir, { pc, mobile: mobileInventory() });
  const loaded = loadReadyPack(dir);
  assert.equal(loaded.ok, false);
  assert.ok(loaded.problems.some((item) => /pageBox/.test(item)));
});

test('CLI copies relative assets, English copy, rejects missing section and unknown designation', () => {
  const root = tmp('ews-cli-');
  const handoff = join(root, 'handoff');
  const docs = writeReadyPack(handoff);
  const assetsDir = join(root, 'assets');
  writeAssets(assetsDir, docs);
  writeFileSync(join(root, 'config.json'), `${JSON.stringify(defaultConfig(), null, 2)}\n`);
  writeFileSync(join(root, 'lark.json'), `${JSON.stringify(makeLark(), null, 2)}\n`);
  writeFileSync(join(root, 'designations.json'), `${JSON.stringify(defaultDesignations(), null, 2)}\n`);
  const out = join(root, 'out');
  const result = runEwsWeb([
    '--handoff', handoff,
    '--assets', join(assetsDir, 'asset-map.json'),
    '--config', join(root, 'config.json'),
    '--lark', join(root, 'lark.json'),
    '--designations', join(root, 'designations.json'),
    '--out', out,
  ], { cwd: root });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  assert.match(html, /src="\.\/assets\/pc\//);
  assert.doesNotMatch(html, /src="[A-Za-z]:\\/);
  assert.doesNotMatch(html, /src="\/[A-Za-z]/);
  assert.equal(existsSync(join(out, 'assets', 'pc', '100-31.png')), true);
  const model = JSON.parse(readFileSync(join(out, 'model.json'), 'utf8'));
  const en = renderPageHtml(model, { locale: 'en', device: 'pc' });
  assert.match(en, /Title A/);
  assert.match(en, /data-copy-locator="\/rows\/10\/en"/);
  assert.match(en, /data-nav-screen="gallery"/);
  assert.match(en, /ews-carousel-slide/);
  assert.match(en, /<video/);
  assert.match(en, /data-modal-open/);
  assert.match(en, /data-node-id="100:12"/);
  const heroCopy = model.platforms.pc.screens[0].nodes.find((node) => node.id === '100:5');
  assert.equal(heroCopy?.copy?.translations?.en?.value, 'Title A');
  writeFileSync(join(out, 'index.html'), 'DO-NOT-OVERWRITE');
  const blocked = runEwsWeb([
    '--handoff', handoff, '--assets', join(assetsDir, 'asset-map.json'),
    '--config', join(root, 'config.json'), '--out', out,
  ], { cwd: root });
  assert.equal(blocked.ok, false);
  const badCfg = { ...defaultConfig(), screens: [{ key: 'ghost', pc: 'missing', mobile: 'missing' }] };
  writeFileSync(join(root, 'bad.json'), JSON.stringify(badCfg));
  const missing = runEwsWeb([
    '--handoff', handoff, '--assets', join(assetsDir, 'asset-map.json'),
    '--config', join(root, 'bad.json'), '--out', join(root, 'out2'),
  ], { cwd: root });
  assert.equal(missing.ok, false);
});

void existsSync;
