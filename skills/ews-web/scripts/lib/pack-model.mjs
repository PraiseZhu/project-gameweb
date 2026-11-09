import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

export const MODEL_LOADER_NEEDLE = "const model = JSON.parse(document.getElementById('ews-model').textContent);";

export const MODEL_LOADER = `const modelElement = document.getElementById('ews-model');
try {
  const modelResponse = await fetch(new URL('../model.json.gz', import.meta.url));
  if (!modelResponse.ok) throw new Error('packed model HTTP ' + modelResponse.status);
  if (typeof DecompressionStream !== 'function') throw new Error('DecompressionStream missing');
  const modelStream = modelResponse.body.pipeThrough(new DecompressionStream('gzip'));
  const packedModelText = await new Response(modelStream).text();
  JSON.parse(packedModelText);
  modelElement.textContent = packedModelText;
  document.documentElement.removeAttribute('data-ews-qa-pending');
} catch (error) {
  document.documentElement.setAttribute('data-ews-qa', 'boot-failed');
  document.documentElement.removeAttribute('data-ews-qa-pending');
  throw error;
}
const model = JSON.parse(modelElement.textContent);`;

export function compressEmbeddedModel(root) {
  const index = join(root, 'index.html');
  const boot = join(root, 'runtime/boot.mjs');
  const html = readFileSync(index, 'utf8');
  const re = /<script([^>]*id=["']ews-model["'][^>]*)>([\s\S]*?)<\/script>/i;
  const match = html.match(re);
  if (!match) throw new Error('missing embedded EWS model');
  const data = Buffer.from(match[2]);
  JSON.parse(data.toString());
  const gzip = gzipSync(data, { level: 9 });
  if (!gunzipSync(gzip).equals(data)) throw new Error('model compression is not lossless');
  const source = readFileSync(boot, 'utf8');
  if (!source.includes(MODEL_LOADER_NEEDLE)) throw new Error('unsupported EWS model loader');
  if (source.includes(MODEL_LOADER_NEEDLE) && source.split(MODEL_LOADER_NEEDLE).length !== 2) {
    throw new Error('EWS model loader needle is not unique');
  }
  writeFileSync(join(root, 'model.json.gz'), gzip);
  writeFileSync(boot, source.replace(MODEL_LOADER_NEEDLE, MODEL_LOADER));
  writeFileSync(index, html.replace(re, (_, attrs) => `<script${attrs}></script>`));
  return { bytesBefore: data.length, bytesAfter: gzip.length, lossless: true };
}
