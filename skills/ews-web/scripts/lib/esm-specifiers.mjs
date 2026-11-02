#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function prepareSource(text) {
  let source = String(text ?? '').replace(/^\uFEFF/, '');
  if (source.startsWith('#!')) {
    const nl = source.indexOf('\n');
    source = nl === -1 ? '' : source.slice(nl + 1);
  }
  return source;
}

function specifiersOf(source, identifier = 'audit.mjs') {
  if (typeof vm.SourceTextModule !== 'function') {
    throw new Error('SourceTextModule unavailable');
  }
  const module = new vm.SourceTextModule(prepareSource(source), {
    identifier,
    context: vm.createContext(Object.create(null)),
    initializeImportMeta() {},
  });
  if (Array.isArray(module.moduleRequests)) {
    return module.moduleRequests.map((request) => request.specifier);
  }
  return [...(module.dependencySpecifiers || [])];
}

function readInput() {
  const raw = readFileSync(0, 'utf8');
  if (!String(raw).trim()) throw new Error('empty helper input');
  return JSON.parse(raw);
}

function main() {
  try {
    const payload = readInput();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const out = [];
    for (const item of items) {
      const id = String(item?.id || 'inline');
      try {
        out.push({ id, specifiers: specifiersOf(item.source, id) });
      } catch (error) {
        out.push({ id, error: String(error?.message || error) });
      }
    }
    process.stdout.write(`${JSON.stringify({ ok: true, items: out })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: String(error?.message || error) })}\n`);
    process.exitCode = 1;
  }
}

main();
