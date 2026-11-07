import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, readdirSync, symlinkSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import {
  assertFontSourceMap,
  collectPackGlyphs,
  PACK_REPORT_STAGE,
  rewriteTextRefs,
  sidecarPaths,
} from '../pack-demo.mjs';

const cli = resolve('scripts/pack-demo.mjs');

function runPack(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

function miniDemo(dir) {
  const demo = join(dir, 'demo');
  mkdirSync(join(demo, 'runtime'), { recursive: true });
  const model = JSON.stringify({ text: 'pack-sentinel', fontSize: 16 });
  writeFileSync(join(demo, 'index.html'), `<html><script id="ews-model" type="application/json">${model}</script></html>`);
  writeFileSync(join(demo, 'runtime/boot.mjs'), "const model = JSON.parse(document.getElementById('ews-model').textContent);\n");
  writeFileSync(join(demo, 'model.json'), model);
  writeFileSync(join(demo, 'provenance.json'), JSON.stringify({ value: 'demo-provenance' }));
  return { demo, model };
}

function makeJunction(target, link) {
  const r = spawnSync('cmd.exe', ['/c', 'mklink', '/J', link, target], { encoding: 'utf8', windowsHide: true });
  return { ok: r.status === 0, error: (r.stderr || r.stdout || '').trim() };
}

test('pack rejects an existing output without deleting its files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-pack-test-'));
  const demo = join(dir, 'demo');
  const out = join(dir, 'out');
  mkdirSync(demo);
  mkdirSync(out);
  writeFileSync(join(demo, 'index.html'), '<html></html>');
  writeFileSync(join(out, 'keep'), 'keep');
  const r = runPack(['--demo', demo, '--out', out]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /already exists/);
  assert.equal(readFileSync(join(out, 'keep'), 'utf8'), 'keep');
});

test('pack refuses a missing output parent before copying', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-pack-noparent-'));
  const { demo } = miniDemo(dir);
  const out = join(dir, 'missing-parent', 'out');
  const r = runPack(['--demo', demo, '--out', out]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /parent does not exist/);
  assert.equal(existsSync(out), false);
});

test('pack refuses a junction output parent before copying', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-pack-parentlink-'));
  const { demo } = miniDemo(dir);
  const realParent = join(dir, 'real-parent');
  const linkParent = join(dir, 'link-parent');
  const outside = join(dir, 'outside');
  mkdirSync(realParent);
  mkdirSync(outside);
  writeFileSync(join(outside, 'keep.txt'), 'KEEP');
  const linked = makeJunction(realParent, linkParent);
  if (!linked.ok) {
    t.skip(`无法创建 junction（${linked.error}）`);
    return;
  }
  const out = join(linkParent, 'out');
  const r = runPack(['--demo', demo, '--out', out]);
  assert.notEqual(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stderr + r.stdout, /directory link|reparse point|symlink|junction/);
  assert.equal(readFileSync(join(outside, 'keep.txt'), 'utf8'), 'KEEP');
  assert.equal(existsSync(join(outside, 'out')), false);
});

test('pack rejects a budget above 15MiB', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-pack-test-'));
  writeFileSync(join(dir, 'index.html'), '<html></html>');
  const r = runPack(['--demo', dir, '--budget-mb', '16']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /budget/);
});

test('pack rejects an output path inside the demo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-pack-test-'));
  writeFileSync(join(dir, 'index.html'), '<html></html>');
  const r = runPack(['--demo', dir, '--out', join(dir, 'nested')]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /outside demo|cannot contain demo/);
});

test('pack refuses a symlink inside the demo', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-pack-link-'));
  mkdirSync(join(dir, 'demo'));
  writeFileSync(join(dir, 'demo', 'index.html'), '<html></html>');
  writeFileSync(join(dir, 'secret.png'), 'secret');
  try {
    symlinkSync(join(dir, 'secret.png'), join(dir, 'demo', 'leak.png'));
  } catch (error) {
    t.skip(`无法创建 symlink（${error.code || error.message}）`);
    return;
  }
  const r = runPack(['--demo', join(dir, 'demo'), '--out', join(dir, 'out')]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /symlink/);
});

test('path rewrite does not double-replace when dest contains source', () => {
  const html = '<img src="assets/a.webp"><img src="assets/aa.webp">';
  const once = rewriteTextRefs(html, 'assets/a.webp', 'assets/a.pack.webp');
  assert.equal(once, '<img src="assets/a.pack.webp"><img src="assets/aa.webp">');
  const twice = rewriteTextRefs(once, 'assets/a.webp', 'assets/a.pack.webp');
  assert.equal(twice, once);
});

test('collectPackGlyphs keeps locale text from the model, not only visible HTML', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-pack-glyphs-'));
  writeFileSync(join(dir, 'index.html'), '<html><body>OK</body></html>');
  writeFileSync(join(dir, 'model.json'), JSON.stringify({
    platforms: {
      pc: {
        componentSets: [{ variants: [{ nodes: [{ text: { characters: '龍한국어日本語繁體' } }] }] }],
        nodes: [{ text: { characters: '中文' } }],
      },
    },
  }));
  const glyphs = collectPackGlyphs(dir);
  for (const ch of '龍한국어日本語繁體中文') assert.equal(glyphs.has(ch), true, ch);
});

test('pack gzips the embedded model losslessly on a tiny demo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-pack-mini-'));
  const demo = join(dir, 'demo');
  const out = join(dir, 'out');
  mkdirSync(join(demo, 'runtime'), { recursive: true });
  const model = JSON.stringify({ text: '中文 English 日本語 한국어 2026', fontSize: 33.25 });
  writeFileSync(join(demo, 'index.html'), `<html><script id="ews-model" type="application/json">${model}</script></html>`);
  writeFileSync(join(demo, 'runtime/boot.mjs'), "const model = JSON.parse(document.getElementById('ews-model').textContent);\n");
  writeFileSync(join(demo, 'model.json'), model);
  const r = runPack(['--demo', demo, '--out', out]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const gz = readFileSync(join(out, 'model.json.gz'));
  assert.equal(gunzipSync(gz).toString(), model);
  const boot = readFileSync(join(out, 'runtime/boot.mjs'), 'utf8');
  assert.match(boot, /DecompressionStream/);
  assert.match(boot, /boot-failed/);
  assert.equal(readFileSync(join(out, 'index.html'), 'utf8').includes(model), false);
  assert.equal(readFileSync(join(demo, 'model.json'), 'utf8'), model);
  assert.equal(existsSync(join(demo, 'model.json.gz')), false);
});

test('pack accepts a Chinese --out basename', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-pack-zh-'));
  const { demo } = miniDemo(dir);
  const out = join(dir, '编码路径输出-pack');
  const r = runPack(['--demo', demo, '--out', out]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(existsSync(join(out, 'index.html')), true);
  assert.equal(existsSync(join(out, 'model.json.gz')), true);
});

test('pack refuses a preexisting proof directory and leaves the sentinel', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-pack-proof-'));
  const { demo } = miniDemo(dir);
  const out = join(dir, 'out');
  const proof = sidecarPaths(out).proof;
  mkdirSync(proof);
  writeFileSync(join(proof, 'model.json'), 'SENTINEL-PROOF');
  const r = runPack(['--demo', demo, '--out', out]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /sidecar already exists/);
  assert.equal(readFileSync(join(proof, 'model.json'), 'utf8'), 'SENTINEL-PROOF');
  assert.equal(existsSync(out), false);
});

test('pack refuses a preexisting report file and leaves the sentinel', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-pack-report-'));
  const { demo } = miniDemo(dir);
  const out = join(dir, 'out');
  const report = sidecarPaths(out).report;
  writeFileSync(report, 'SENTINEL-REPORT');
  const r = runPack(['--demo', demo, '--out', out]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /sidecar already exists/);
  assert.equal(readFileSync(report, 'utf8'), 'SENTINEL-REPORT');
  assert.equal(existsSync(out), false);
});

test('pack refuses a junction proof sidecar and does not rewrite the outside sentinel', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-pack-junc-'));
  const { demo } = miniDemo(dir);
  const out = join(dir, 'out');
  const outside = join(dir, 'outside-target');
  mkdirSync(outside);
  writeFileSync(join(outside, 'model.json'), 'OUTSIDE-MODEL');
  writeFileSync(join(outside, 'provenance.json'), 'OUTSIDE-PROV');
  const linked = makeJunction(outside, sidecarPaths(out).proof);
  if (!linked.ok) {
    t.skip(`无法创建 junction（${linked.error}）`);
    return;
  }
  const r = runPack(['--demo', demo, '--out', out]);
  assert.notEqual(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stderr + r.stdout, /sidecar already exists|symlink|junction|reparse|directory link/);
  assert.equal(readFileSync(join(outside, 'model.json'), 'utf8'), 'OUTSIDE-MODEL');
  assert.equal(readFileSync(join(outside, 'provenance.json'), 'utf8'), 'OUTSIDE-PROV');
});

test('pack refuses a report path that is a file symlink and leaves the sentinel', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-pack-rlink-'));
  const { demo } = miniDemo(dir);
  const out = join(dir, 'out');
  const outside = join(dir, 'outside-report.json');
  writeFileSync(outside, 'OUTSIDE-REPORT');
  try {
    symlinkSync(outside, sidecarPaths(out).report);
  } catch (error) {
    t.skip(`无法创建 symlink（${error.code || error.message}）`);
    return;
  }
  const r = runPack(['--demo', demo, '--out', out]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /sidecar already exists|symlink|junction|reparse/);
  assert.equal(readFileSync(outside, 'utf8'), 'OUTSIDE-REPORT');
});

test('pack writes proof and report beside a fresh out without touching a sibling sentinel', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-pack-ok-'));
  const { demo } = miniDemo(dir);
  const out = join(dir, 'out');
  const sibling = join(dir, 'keep-outside.json');
  writeFileSync(sibling, 'KEEP');
  const r = runPack(['--demo', demo, '--out', out]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const { proof, proofModel, proofProvenance, report } = sidecarPaths(out);
  assert.equal(existsSync(proof), false);
  assert.equal(existsSync(proofModel), true);
  assert.equal(existsSync(proofProvenance), true);
  assert.equal(existsSync(report), true);
  assert.equal(existsSync(join(out, 'model.json')), false);
  assert.equal(existsSync(join(out, PACK_REPORT_STAGE)), false);
  assert.equal(existsSync(join(out, '.ews-pack-proof')), false);
  const leftoverWork = readdirSync(dir).filter((name) => name.includes('pack-work'));
  assert.equal(leftoverWork.length, 0);
  assert.equal(readFileSync(sibling, 'utf8'), 'KEEP');
});

test('font source map allows same-sha alias and rejects a different source file', () => {
  const beforeOrigins = [
    { cssFamily: '"Noto Sans"', weight: '400', src: 'fonts/a.ttf', sha256: 'aaa' },
    { cssFamily: '"Noto Sans"', weight: '500', src: 'fonts/b.ttf', sha256: 'aaa' },
  ];
  const afterRoot = mkdtempSync(join(tmpdir(), 'ews-font-map-'));
  writeFileSync(join(afterRoot, 'keep.woff2'), 'x');
  assert.doesNotThrow(() => assertFontSourceMap({
    beforeOrigins,
    afterFaces: [
      { family: '"Noto Sans"', weight: '400', src: 'keep.woff2' },
      { family: '"Noto Sans"', weight: '500', src: 'keep.woff2' },
    ],
    afterRoot,
    subsetFiles: [
      { from: 'fonts/a.ttf', to: 'keep.woff2' },
      { from: 'fonts/b.ttf', to: 'keep.woff2' },
    ],
    fontDedup: { aliases: [] },
  }));
  assert.throws(() => assertFontSourceMap({
    beforeOrigins,
    afterFaces: [
      { family: '"Noto Sans"', weight: '400', src: 'keep.woff2' },
      { family: '"Noto Sans"', weight: '500', src: 'keep.woff2' },
    ],
    afterRoot,
    subsetFiles: [{ from: 'fonts/other.ttf', to: 'keep.woff2' }],
    fontDedup: { aliases: [] },
  }), /different source file|no source mapping/);
});

test('font source map rejects an unmapped existing wrong face', () => {
  const afterRoot = mkdtempSync(join(tmpdir(), 'ews-font-wrong-'));
  mkdirSync(join(afterRoot, 'fonts'));
  writeFileSync(join(afterRoot, 'fonts', 'wrong.ttf'), 'WRONG-SOURCE');
  assert.throws(() => assertFontSourceMap({
    beforeOrigins: [{ cssFamily: '"Noto Sans"', weight: '400', src: 'fonts/right.ttf', sha256: 'RIGHT-SHA' }],
    afterFaces: [{ family: '"Noto Sans"', weight: '400', src: 'fonts/wrong.ttf' }],
    afterRoot,
    subsetFiles: [],
    fontDedup: { aliases: [] },
  }), /no source mapping/);
});

test('font source map allows cross-family aliases only when original bytes match', () => {
  const afterRoot = mkdtempSync(join(tmpdir(), 'ews-font-family-'));
  mkdirSync(join(afterRoot, 'fonts'));
  writeFileSync(join(afterRoot, 'fonts', 'same.woff2'), 'same bytes');
  const shared = {
    afterFaces: [
      { family: '"Family A"', weight: '400', src: 'fonts/same.woff2' },
      { family: '"Family B"', weight: '400', src: 'fonts/same.woff2' },
    ],
    afterRoot,
    subsetFiles: [
      { from: 'a.ttf', to: 'fonts/same.woff2' },
      { from: 'b.ttf', to: 'fonts/b.pack.woff2' },
    ],
    fontDedup: { aliases: [{ from: 'fonts/b.pack.woff2', to: 'fonts/same.woff2' }] },
  };
  assert.doesNotThrow(() => assertFontSourceMap({
    beforeOrigins: [
      { cssFamily: '"Family A"', weight: '400', src: 'a.ttf', sha256: 'SAME' },
      { cssFamily: '"Family B"', weight: '400', src: 'b.ttf', sha256: 'SAME' },
    ],
    ...shared,
  }));
  assert.throws(() => assertFontSourceMap({
    beforeOrigins: [
      { cssFamily: '"Family A"', weight: '400', src: 'a.ttf', sha256: 'SAME' },
      { cssFamily: '"Family B"', weight: '400', src: 'b.ttf', sha256: 'OTHER' },
    ],
    ...shared,
  }), /different source file/);
});

test('pack report COPYFILE_EXCL does not replace a dest created at publish', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-pack-report-excl-'));
  const { demo } = miniDemo(dir);
  const out = join(dir, 'out');
  const report = sidecarPaths(out).report;
  const preload = join(dir, 'report-preload.cjs');
  writeFileSync(preload, [
    "const fs=require('node:fs');",
    "const {syncBuiltinESMExports}=require('node:module');",
    'const target=process.env.RACE_REPORT;',
    'const original=fs.copyFileSync.bind(fs);',
    'fs.copyFileSync=function(from,to,...args){',
    '  if (to===target) {',
    "    fs.writeFileSync(to,'RACE-SENTINEL',{flag:'wx'});",
    "    process.stderr.write('REPORT_COLLISION_INJECTED=true\\n');",
    '  }',
    '  return original(from,to,...args);',
    '};',
    'syncBuiltinESMExports();',
    '',
  ].join('\n'));
  const r = spawnSync(process.execPath, ['--require', preload, cli, '--demo', demo, '--out', out], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, RACE_REPORT: report },
  });
  if (!/REPORT_COLLISION_INJECTED=true/.test(r.stderr || '')) {
    t.skip(`report collision not injected (${(r.stderr || r.stdout || '').slice(0, 180)})`);
    return;
  }
  assert.notEqual(r.status, 0, r.stderr + r.stdout);
  assert.equal(readFileSync(report, 'utf8'), 'RACE-SENTINEL');
  assert.equal(existsSync(join(out, PACK_REPORT_STAGE)), false);
  const retry = runPack(['--demo', demo, '--out', out]);
  assert.notEqual(retry.status, 0);
  assert.match(retry.stderr + retry.stdout, /already exists/);
  assert.equal(readFileSync(report, 'utf8'), 'RACE-SENTINEL');
});

test('failed pack removes only its pack-work temps and leaves --out absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-pack-failclean-'));
  const { demo } = miniDemo(dir);
  const out = join(dir, 'out');
  const r = runPack(['--demo', demo, '--out', out, '--budget-mb', '0.0001']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /exceeds 15MB|served folder/);
  assert.equal(existsSync(out), false);
  const leftovers = readdirSync(dir).filter((name) => /pack-work|pack-proof|pack-report/.test(name));
  assert.deepEqual(leftovers, []);
});

test('pack CLI with ancestor junction at start does not write outside', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-pack-ancj-'));
  const { demo } = miniDemo(dir);
  const ancestor = join(dir, 'anchor');
  const parent = join(ancestor, 'parent');
  const outside = join(dir, 'outside');
  mkdirSync(parent, { recursive: true });
  mkdirSync(join(outside, 'parent'), { recursive: true });
  writeFileSync(join(outside, 'keep.txt'), 'KEEP');
  const moved = join(dir, 'moved-anchor');
  renameSync(ancestor, moved);
  const linked = makeJunction(outside, ancestor);
  if (!linked.ok) {
    t.skip(`无法创建 junction（${linked.error}）`);
    return;
  }
  const out = join(parent, 'out');
  const r = runPack(['--demo', demo, '--out', out]);
  assert.notEqual(r.status, 0, r.stderr + r.stdout);
  assert.equal(readFileSync(join(outside, 'keep.txt'), 'utf8'), 'KEEP');
  assert.equal(existsSync(join(outside, 'parent', 'out')), false);
  assert.equal(existsSync(join(outside, 'out.pack-proof.model.json')), false);
});

test('commit copies with replaceDirContents and does not rename the delivery directory', () => {
  const src = readFileSync(cli, 'utf8');
  const commit = src.slice(src.indexOf('function commitDelivery'), src.indexOf('function relKey'));
  assert.match(commit, /replaceDirContents\(workDir, absOut\)/);
  assert.doesNotMatch(commit, /renameSync\(workDir/);
});

test('a 16MiB .ews-pack-proof-budget.bin is counted and fails the 15MB budget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-pack-prefix-'));
  const { demo } = miniDemo(dir);
  const out = join(dir, 'out');
  writeFileSync(join(demo, '.ews-pack-proof-budget.bin'), Buffer.alloc(16 * 1024 * 1024, 0x41));
  const r = runPack(['--demo', demo, '--out', out]);
  assert.notEqual(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stderr + r.stdout, /exceeds 15MB|served folder/);
  assert.equal(existsSync(out), false);
  assert.equal(existsSync(join(out, '.ews-pack-proof-budget.bin')), false);
});

test('exact reserved .ews-pack-proof in the demo fails closed without copying', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-pack-reserved-'));
  const { demo } = miniDemo(dir);
  const out = join(dir, 'out');
  writeFileSync(join(demo, '.ews-pack-proof'), 'nope');
  const r = runPack(['--demo', demo, '--out', out]);
  assert.notEqual(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stderr + r.stdout, /reserved pack path/);
  assert.equal(existsSync(out), false);
});

test('existing pack-backup-<pid> is refused and the sentinel is kept', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-pack-backup-'));
  const { demo } = miniDemo(dir);
  const out = join(dir, 'out');
  const preload = join(dir, 'backup-preload.cjs');
  writeFileSync(preload, [
    "const fs=require('node:fs');",
    "const path=require('node:path');",
    'const out=process.env.EWS_PROBE_OUT;',
    "const backup=out+'.pack-backup-'+process.pid;",
    'fs.mkdirSync(backup);',
    "fs.writeFileSync(path.join(backup,'FOREIGN-SENTINEL.txt'),'KEEP-ME');",
    '',
  ].join('\n'));
  const r = spawnSync(process.execPath, ['--require', preload, cli, '--demo', demo, '--out', out], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, EWS_PROBE_OUT: out },
  });
  const backup = `${out}.pack-backup-${r.pid}`;
  assert.notEqual(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stderr + r.stdout, /pack backup already exists/);
  assert.equal(existsSync(join(backup, 'FOREIGN-SENTINEL.txt')), true);
  assert.equal(readFileSync(join(backup, 'FOREIGN-SENTINEL.txt'), 'utf8'), 'KEEP-ME');
  assert.equal(existsSync(out), false);
});

test('pack restamps boot.mjs?v= after gzip loader injection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-pack-bootv-'));
  const demo = join(dir, 'demo');
  const out = join(dir, 'out');
  mkdirSync(join(demo, 'runtime'), { recursive: true });
  const model = JSON.stringify({ text: 'cache-id', fontSize: 16, runtimeIdentity: 'oldoldoldoldold1' });
  writeFileSync(join(demo, 'index.html'), `<html><link rel="stylesheet" href="./runtime/ews.css?v=oldoldoldoldold1"><script id="ews-model" type="application/json">${model}</script><script type="module" src="./runtime/boot.mjs?v=oldoldoldoldold1"></script></html>`);
  writeFileSync(join(demo, 'runtime/boot.mjs'), "import { x } from './text-style.mjs';\nconst model = JSON.parse(document.getElementById('ews-model').textContent);\n");
  writeFileSync(join(demo, 'runtime/text-style.mjs'), 'export const x = 1;\n');
  writeFileSync(join(demo, 'runtime/ews.css'), 'body{margin:0}');
  writeFileSync(join(demo, 'model.json'), model);
  const frozenQuery = 'oldoldoldoldold1';
  const frozenBoot = createHash('sha256').update(readFileSync(join(demo, 'runtime/boot.mjs'))).digest('hex');
  const r = runPack(['--demo', demo, '--out', out]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  const packedQuery = /boot\.mjs\?v=([^"']+)/.exec(html)?.[1];
  const packedBoot = createHash('sha256').update(readFileSync(join(out, 'runtime/boot.mjs'))).digest('hex');
  const report = JSON.parse(readFileSync(sidecarPaths(out).report, 'utf8'));
  assert.ok(packedQuery);
  assert.notEqual(packedQuery, frozenQuery);
  assert.equal(packedQuery, report.runtimeIdentity);
  assert.match(html, new RegExp(`ews\\.css\\?v=${packedQuery}`));
  assert.notEqual(packedBoot, frozenBoot);
  assert.match(readFileSync(join(out, 'runtime/boot.mjs'), 'utf8'), /DecompressionStream/);
  assert.match(readFileSync(join(out, 'runtime/boot.mjs'), 'utf8'), new RegExp(`text-style\\.mjs\\?v=${packedQuery}`));
});
