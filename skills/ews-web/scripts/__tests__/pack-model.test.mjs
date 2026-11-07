import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { compressEmbeddedModel, MODEL_LOADER_NEEDLE } from '../lib/pack-model.mjs';

function fixture(modelText, boot = MODEL_LOADER_NEEDLE) {
  const root = mkdtempSync(join(tmpdir(), 'ews-model-'));
  mkdirSync(join(root, 'runtime'));
  writeFileSync(join(root, 'index.html'), `<script id="ews-model" type="application/json">${modelText}</script>`);
  writeFileSync(join(root, 'runtime/boot.mjs'), `${boot}\n`);
  return root;
}

test('compressed model preserves locale strings and typography exactly', () => {
  const data = JSON.stringify({ text: '中文 English 日本語 한국어 2026', fontSize: 33.25, weight: 700 });
  const root = fixture(data);
  const r = compressEmbeddedModel(root);
  assert.equal(r.lossless, true);
  assert.equal(gunzipSync(readFileSync(join(root, 'model.json.gz'))).toString(), data);
  const boot = readFileSync(join(root, 'runtime/boot.mjs'), 'utf8');
  assert.match(boot, /DecompressionStream/);
  assert.match(boot, /boot-failed/);
  assert.match(boot, /packed model HTTP/);
});

test('corrupt gzip is not treated as lossless', () => {
  const data = JSON.stringify({ ok: true });
  const root = fixture(data);
  compressEmbeddedModel(root);
  const gz = readFileSync(join(root, 'model.json.gz'));
  writeFileSync(join(root, 'model.json.gz'), gz.subarray(0, 8));
  assert.throws(() => gunzipSync(readFileSync(join(root, 'model.json.gz'))));
});

test('unsupported loader needle fails closed', () => {
  const root = fixture('{"a":1}', 'const model = {};');
  assert.throws(() => compressEmbeddedModel(root), /unsupported EWS model loader/);
});
