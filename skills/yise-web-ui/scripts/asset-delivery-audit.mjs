#!/usr/bin/env node
import { resolve } from 'node:path';
import { runAssetDeliveryAudit } from './lib/asset-delivery-audit.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const demo = arg('--demo');
if (!demo) {
  console.error('usage: node scripts/asset-delivery-audit.mjs --demo <dir> [--out <dir>] [--docs <file>] [--official-site <url>] [--no-official-crawl]');
  process.exit(2);
}

const out = arg('--out');
const docs = arg('--docs');
const officialSite = arg('--official-site', 'https://yise.xd.cn/');
const crawlOfficial = !process.argv.includes('--no-official-crawl');

try {
  const result = await runAssetDeliveryAudit({
    demoDir: resolve(demo),
    outDir: out ? resolve(out) : undefined,
    docsFile: docs ? resolve(docs) : undefined,
    officialSite,
    crawlOfficial,
  });
  console.log(JSON.stringify({
    ok: true,
    outDir: result.outDir,
    docsFile: result.docsFile,
    summary: result.audit.summary,
    browserMeasurement: result.audit.browserMeasurement,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error?.stack || error?.message || error) }, null, 2));
  process.exit(1);
}
