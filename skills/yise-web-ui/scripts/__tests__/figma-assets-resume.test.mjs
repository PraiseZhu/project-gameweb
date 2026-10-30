import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { bindAssetDeliveryFile, decideAssetResume } from '../lib/figma-asset-resume.mjs';
import { pickSliceNodes } from '../lib/figma-slice-nodes.mjs';

const script = fileURLToPath(new URL('../figma-assets.mjs', import.meta.url));
const geometry = {
  designSize: '8x8',
  exportScale: 1,
  exportBounds: 'box',
  exportBox: null,
  pixelSize: '8x8',
};
const record = {
  pngSha256: 'abc',
  sha256: 'webp',
  webpFile: 'assets/1-2.webp',
  designSize: '8x8',
  exportScale: 1,
  exportBounds: 'box',
  exportBox: null,
  pixelSize: '8x8',
};

function decision(overrides = {}) {
  return decideAssetResume({
    designVersion: 'v1',
    previousVersion: 'v1',
    record,
    pngSha256: 'abc',
    webpSha256: 'webp',
    geometry,
    ...overrides,
  });
}

test('resume requires the same source version, png sha, and export geometry', () => {
  assert.equal(decision().resumePng, true);
  assert.equal(decision().resumeWebp, true);
  const nextVersion = decision({ designVersion: 'v2' });
  assert.equal(nextVersion.resumePng, false);
  assert.ok(nextVersion.reasons.includes('design-version-mismatch'));
  const moved = decision({ geometry: { ...geometry, pixelSize: '7x8' } });
  assert.equal(moved.resumePng, false);
  assert.ok(moved.reasons.includes('pixel-size-mismatch'));
  const scaled = decision({ geometry: { ...geometry, exportScale: 0.5 } });
  assert.equal(scaled.resumePng, false);
  assert.ok(scaled.reasons.includes('export-scale-mismatch'));
});

test('untrusted webp falls back to the verified png path', () => {
  const rec = {
    file: 'assets/1-2.webp',
    pngFile: 'assets/1-2.png',
    pngSha256: 'png-sha',
    sha256: 'webp-sha',
    webpFile: 'assets/1-2.webp',
    webp: { bytes: 10 },
  };
  const png = bindAssetDeliveryFile(rec, { trustedWebp: new Set(), pngBytes: 42 });
  assert.equal(png.file, 'assets/1-2.png');
  assert.equal(png.webpFile, undefined);
  assert.equal(png.webp, undefined);
  assert.equal(png.sha256, 'png-sha');
  assert.equal(png.bytes, 42);
  const trusted = bindAssetDeliveryFile(rec, { trustedWebp: new Set(['assets/1-2.webp']) });
  assert.equal(trusted.file, 'assets/1-2.webp');
  assert.equal(trusted.webpFile, 'assets/1-2.webp');
});

test('a changed png does not keep an old webp, and missing provenance does not resume', () => {
  const changedPng = decision({ pngSha256: 'new-png' });
  assert.equal(changedPng.resumePng, false);
  assert.equal(changedPng.resumeWebp, false);
  assert.ok(changedPng.reasons.includes('png-sha-mismatch'));
  const oldWebp = decision({ webpSha256: 'stale-webp' });
  assert.equal(oldWebp.resumePng, true);
  assert.equal(oldWebp.resumeWebp, false);
  const noVersion = decision({ designVersion: null, previousVersion: null });
  assert.equal(noVersion.resumePng, false);
  assert.ok(noVersion.reasons.includes('missing-design-version'));
  const noRecord = decision({ record: null });
  assert.equal(noRecord.resumePng, false);
  assert.ok(noRecord.reasons.includes('missing-manifest-record'));
});

function pngBuffer() {
  const png = new PNG({ width: 8, height: 8 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 10;
    png.data[i + 1] = 20;
    png.data[i + 2] = 30;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

function writeDemo(version, mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'asset-resume-'));
  const node = {
    id: '1:2',
    type: 'RECTANGLE',
    name: 'img/box',
    box: { x: 0, y: 0, w: 8, h: 8 },
    style: { fills: [{ type: 'SOLID', visible: true }] },
  };
  const picks = pickSliceNodes({ sections: { 'sec:1': { nodes: [node] } } });
  assert.equal(picks.length, 1);
  const pick = picks[0];
  const buf = pngBuffer();
  const sha = createHash('sha256').update(buf).digest('hex');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', '1-2.png'), buf);
  writeFileSync(join(dir, 'spec.json'), JSON.stringify({ figma: { fileKey: 'not-real', exportScale: 1 } }));
  writeFileSync(join(dir, 'truth.json'), JSON.stringify({
    design: { fileVersion: version },
    sections: { 'sec:1': { nodes: [node] } },
  }));
  const asset = {
    file: 'assets/1-2.png',
    pngFile: 'assets/1-2.png',
    pngSha256: sha,
    sha256: sha,
    bytes: buf.length,
    name: 'img/box',
    designSize: pick.w + 'x' + pick.h,
    exportScale: 1,
    pixelSize: '8x8',
    exportBounds: pick.exportBounds,
    exportBox: pick.exportBox || undefined,
  };
  if (mutate) mutate(asset, sha);
  const manifest = { designVersion: 'v1', assets: { '1:2': asset } };
  writeFileSync(join(dir, 'assets-manifest.json'), JSON.stringify(manifest));
  return { dir, before: readFileSync(join(dir, 'assets-manifest.json'), 'utf8') };
}

function runResume(dir) {
  const env = { ...process.env };
  delete env.FIGMA_TOKEN;
  delete env.FIGMA_ACCESS_TOKEN;
  return spawnSync(process.execPath, [script, '--demo', dir, '--resume', '--no-webp'], {
    env,
    encoding: 'utf8',
  });
}

test('a new designVersion with the same node id does not keep the old cache when no token exists', () => {
  const { dir, before } = writeDemo('v2');
  const result = runResume(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /FIGMA_TOKEN/);
  assert.equal(readFileSync(join(dir, 'assets-manifest.json'), 'utf8'), before);
});

test('the same version and geometry can resume without a token', () => {
  const { dir } = writeDemo('v1');
  const result = runResume(dir);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const out = JSON.parse(result.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.resumed, 1);
  const saved = JSON.parse(readFileSync(join(dir, 'assets-manifest.json'), 'utf8'));
  assert.equal(saved.designVersion, 'v1');
  assert.equal(saved.assets['1:2'].resumed, true);
});

test('resume without a trusted webp writes png into manifest and qa-assets', () => {
  const { dir } = writeDemo('v1', (asset) => {
    asset.file = 'assets/1-2.webp';
    asset.webpFile = 'assets/1-2.webp';
    asset.sha256 = 'stale-webp';
  });
  writeFileSync(join(dir, 'index.html'), '<html><body><script id="qa-assets" type="application/json">{}</script></body></html>');
  const result = runResume(dir);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const saved = JSON.parse(readFileSync(join(dir, 'assets-manifest.json'), 'utf8'));
  assert.equal(saved.assets['1:2'].file, 'assets/1-2.png');
  assert.equal(saved.assets['1:2'].webpFile, undefined);
  const pngBytes = readFileSync(join(dir, 'assets', '1-2.png')).length;
  assert.equal(saved.assets['1:2'].bytes, pngBytes);
  assert.equal(saved.totalBytes, pngBytes);
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.match(html, /assets\/1-2\.png/);
  assert.doesNotMatch(html, /assets\/1-2\.webp/);
});

test('same version with changed export geometry fails closed instead of reusing the png', () => {
  const { dir, before } = writeDemo('v1', (asset) => { asset.pixelSize = '4x4'; });
  const result = runResume(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /FIGMA_TOKEN/);
  assert.equal(readFileSync(join(dir, 'assets-manifest.json'), 'utf8'), before);
});


function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function solidPng(red, green, blue) {
  const png = new PNG({ width: 8, height: 8 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = red;
    png.data[i + 1] = green;
    png.data[i + 2] = blue;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

function writeTwoNodeDemo({ truthVersion, manifestVersion } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'asset-only-'));
  const specs = [
    { id: '1:2', name: 'img/a', rgb: [10, 20, 30] },
    { id: '3:4', name: 'img/b', rgb: [40, 50, 60] },
  ];
  const nodes = specs.map((spec) => {
    const node = {
      id: spec.id,
      type: 'RECTANGLE',
      name: spec.name,
      box: { x: 0, y: 0, w: 8, h: 8 },
      style: { fills: [{ type: 'SOLID', visible: true }] },
    };
    const buf = solidPng(spec.rgb[0], spec.rgb[1], spec.rgb[2]);
    return { id: spec.id, name: spec.name, node, buf, sha: sha256(buf) };
  });
  const picks = pickSliceNodes({ sections: { 'sec:1': { nodes: nodes.map((item) => item.node) } } });
  assert.equal(picks.length, 2);
  mkdirSync(join(dir, 'assets'));
  const assets = {};
  const pngPaths = {};
  for (const item of nodes) {
    const rel = 'assets/' + item.id.replace(/[:;]/g, '-') + '.png';
    writeFileSync(join(dir, rel), item.buf);
    pngPaths[item.id] = join(dir, rel);
    const pick = picks.find((entry) => entry.nodeId === item.id);
    assets[item.id] = {
      file: rel,
      pngFile: rel,
      pngSha256: item.sha,
      sha256: item.sha,
      bytes: item.buf.length,
      name: item.name,
      designSize: pick.w + 'x' + pick.h,
      exportScale: 1,
      pixelSize: '8x8',
      exportBounds: pick.exportBounds,
      exportBox: pick.exportBox || undefined,
    };
  }
  writeFileSync(join(dir, 'spec.json'), JSON.stringify({ figma: { fileKey: 'not-real', exportScale: 1 } }));
  const truth = {
    design: {},
    sections: { 'sec:1': { nodes: nodes.map((item) => item.node) } },
  };
  if (truthVersion !== undefined) truth.design.fileVersion = truthVersion;
  writeFileSync(join(dir, 'truth.json'), JSON.stringify(truth));
  const manifest = { assets };
  if (manifestVersion !== undefined) manifest.designVersion = manifestVersion;
  const manifestText = JSON.stringify(manifest);
  writeFileSync(join(dir, 'assets-manifest.json'), manifestText);
  return { dir, manifestText, pngPaths, nodes };
}

function runOnly(dir, args) {
  const env = { ...process.env };
  delete env.FIGMA_TOKEN;
  delete env.FIGMA_ACCESS_TOKEN;
  return spawnSync(process.execPath, [script, '--demo', dir].concat(args), {
    env,
    encoding: 'utf8',
  });
}

function assertFilesUntouched(snap) {
  assert.equal(readFileSync(join(snap.dir, 'assets-manifest.json'), 'utf8'), snap.manifestText);
  for (const item of snap.nodes) {
    assert.equal(sha256(readFileSync(snap.pngPaths[item.id])), item.sha);
  }
}

test('cross-version --only refuses before relabeling the untouched asset', () => {
  const snap = writeTwoNodeDemo({ truthVersion: 'v2', manifestVersion: 'v1' });
  const result = runOnly(snap.dir, ['--only', '1:2', '--resume', '--no-webp']);
  assert.notEqual(result.status, 0);
  const output = result.stderr + result.stdout;
  assert.match(output, /full export without --only/);
  assert.doesNotMatch(output, /FIGMA_TOKEN/);
  assertFilesUntouched(snap);
  const saved = JSON.parse(readFileSync(join(snap.dir, 'assets-manifest.json'), 'utf8'));
  assert.equal(saved.designVersion, 'v1');
  assert.equal(saved.assets['1:2'].pngSha256, snap.nodes[0].sha);
  assert.equal(saved.assets['3:4'].pngSha256, snap.nodes[1].sha);
});

test('same-version --only resumes the selected asset and keeps the other record', () => {
  const snap = writeTwoNodeDemo({ truthVersion: 'v1', manifestVersion: 'v1' });
  const result = runOnly(snap.dir, ['--only', '1:2', '--resume', '--no-webp']);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const saved = JSON.parse(readFileSync(join(snap.dir, 'assets-manifest.json'), 'utf8'));
  assert.equal(saved.designVersion, 'v1');
  assert.equal(saved.assets['1:2'].resumed, true);
  assert.equal(saved.assets['1:2'].pngSha256, snap.nodes[0].sha);
  assert.equal(saved.assets['3:4'].pngSha256, snap.nodes[1].sha);
  assert.notEqual(saved.assets['3:4'].resumed, true);
  for (const item of snap.nodes) {
    assert.equal(sha256(readFileSync(snap.pngPaths[item.id])), item.sha);
  }
});

test('--only with a missing designVersion fails closed and leaves both files unchanged', () => {
  const cases = [
    writeTwoNodeDemo({ truthVersion: 'v2' }),
    writeTwoNodeDemo({ manifestVersion: 'v1' }),
  ];
  for (const snap of cases) {
    const result = runOnly(snap.dir, ['--only', '1:2', '--resume', '--no-webp']);
    assert.notEqual(result.status, 0);
    const output = result.stderr + result.stdout;
    assert.match(output, /designVersion is missing/);
    assert.match(output, /full export without --only/);
    assert.doesNotMatch(output, /FIGMA_TOKEN/);
    assertFilesUntouched(snap);
  }
});

function duplicateNodes() {
  return [
    { id: '1:2', type: 'RECTANGLE', name: 'img/a', box: { x: 0, y: 0, w: 8, h: 8 }, style: { fills: [{ type: 'SOLID', visible: true }] } },
    { id: '3:4', type: 'RECTANGLE', name: 'img/b', box: { x: 0, y: 0, w: 8, h: 8 }, style: { fills: [{ type: 'SOLID', visible: true }] } },
  ];
}

function pickGeo(nodes, id) {
  const pick = pickSliceNodes({ sections: { 'sec:1': { nodes } } }).find((entry) => entry.nodeId === id);
  return {
    designSize: pick.w + 'x' + pick.h,
    exportScale: 1,
    pixelSize: '8x8',
    exportBounds: pick.exportBounds,
    exportBox: pick.exportBox || undefined,
  };
}

function writeDuplicatePngDemo({ aliasWebpRel, aliasWebpBytes } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'asset-alias-'));
  const buf = pngBuffer();
  const sha = sha256(buf);
  const nodes = duplicateNodes();
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', '1-2.png'), buf);
  writeFileSync(join(dir, 'assets', '3-4.png'), buf);
  writeFileSync(join(dir, 'spec.json'), JSON.stringify({ figma: { fileKey: 'not-real', exportScale: 1 } }));
  writeFileSync(join(dir, 'truth.json'), JSON.stringify({
    design: { fileVersion: 'v1' },
    sections: { 'sec:1': { nodes } },
  }));
  writeFileSync(join(dir, 'index.html'), '<html><body><script id="qa-assets" type="application/json">{}</script></body></html>');
  const rec = (id, extra = {}) => ({
    file: extra.file,
    pngFile: `assets/${id.replace(':', '-')}.png`,
    pngSha256: sha,
    sha256: extra.sha256 || sha,
    bytes: extra.bytes || buf.length,
    name: id === '1:2' ? 'img/a' : 'img/b',
    ...pickGeo(nodes, id),
    ...extra,
  });
  writeFileSync(join(dir, 'assets-manifest.json'), JSON.stringify({
    designVersion: 'v1',
    assets: {
      '3:4': rec('3:4', { file: aliasWebpRel, webpFile: aliasWebpRel, sha256: 'stale-alias', bytes: aliasWebpBytes ?? 9999 }),
      '1:2': rec('1:2', { file: 'assets/1-2.webp', webpFile: 'assets/1-2.webp', sha256: 'stale-selected', bytes: 8888 }),
    },
  }));
  return { dir, pngBytes: buf.length, sha };
}

test('--only resume does not inherit an untrusted alias webp', () => {
  const { dir, pngBytes } = writeDuplicatePngDemo({ aliasWebpRel: 'assets/missing.webp', aliasWebpBytes: 9999 });
  const result = runOnly(dir, ['--only', '1:2', '--resume']);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const saved = JSON.parse(readFileSync(join(dir, 'assets-manifest.json'), 'utf8'));
  const selected = saved.assets['1:2'];
  assert.notEqual(selected.file, 'assets/missing.webp');
  assert.notEqual(selected.webpFile, 'assets/missing.webp');
  if (selected.webpFile) {
    assert.equal(existsSync(join(dir, selected.webpFile)), true);
  } else {
    assert.equal(selected.file, 'assets/1-2.png');
    assert.equal(selected.bytes, pngBytes);
  }
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /missing\.webp/);
});

test('--only resume still aliases when the source webp is trusted this run', () => {
  const buf = pngBuffer();
  const sha = sha256(buf);
  const dir = mkdtempSync(join(tmpdir(), 'asset-alias-ok-'));
  const nodes = duplicateNodes().reverse();
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', '1-2.png'), buf);
  writeFileSync(join(dir, 'assets', '3-4.png'), buf);
  const webpBytes = Buffer.from('webp-ok');
  writeFileSync(join(dir, 'assets', '3-4.webp'), webpBytes);
  writeFileSync(join(dir, 'spec.json'), JSON.stringify({ figma: { fileKey: 'not-real', exportScale: 1 } }));
  writeFileSync(join(dir, 'truth.json'), JSON.stringify({
    design: { fileVersion: 'v1' },
    sections: { 'sec:1': { nodes } },
  }));
  writeFileSync(join(dir, 'index.html'), '<html><body><script id="qa-assets" type="application/json">{}</script></body></html>');
  const rec = (id, extra) => ({
    file: extra.file,
    pngFile: `assets/${id.replace(':', '-')}.png`,
    pngSha256: sha,
    sha256: extra.sha256,
    bytes: extra.bytes,
    webpFile: extra.webpFile,
    name: id === '3:4' ? 'img/b' : 'img/a',
    ...pickGeo(nodes, id),
  });
  writeFileSync(join(dir, 'assets-manifest.json'), JSON.stringify({
    designVersion: 'v1',
    assets: {
      '3:4': rec('3:4', { file: 'assets/3-4.webp', webpFile: 'assets/3-4.webp', sha256: sha256(webpBytes), bytes: webpBytes.length }),
      '1:2': rec('1:2', { file: 'assets/1-2.webp', webpFile: 'assets/1-2.webp', sha256: 'stale-selected', bytes: 8888 }),
    },
  }));
  const result = runOnly(dir, ['--only', '3:4,1:2', '--resume']);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const saved = JSON.parse(readFileSync(join(dir, 'assets-manifest.json'), 'utf8'));
  assert.equal(saved.assets['3:4'].file, 'assets/3-4.webp');
  assert.equal(saved.assets['1:2'].file, 'assets/3-4.webp');
  assert.equal(saved.assets['1:2'].webpFile, 'assets/3-4.webp');
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.match(html, /assets\/3-4\.webp/);
});
