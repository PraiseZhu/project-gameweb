#!/usr/bin/env node
import { runAssetDeliveryAudit, parseArgs } from './lib/asset-delivery-audit.mjs';

try {
  const args = parseArgs(process.argv);
  const result = await runAssetDeliveryAudit(args);
  console.log(JSON.stringify({
    ok: true,
    outDir: result.outDir,
    docsFile: result.docsFile,
    summary: result.audit.summary,
    browserMeasurement: result.audit.browserMeasurement,
    crawlOfficial: args.crawlOfficial,
    officialFetched: result.audit.officialFetched.length,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error?.stack || error?.message || error) }, null, 2));
  process.exit(1);
}
