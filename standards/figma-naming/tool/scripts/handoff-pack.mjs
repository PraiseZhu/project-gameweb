#!/usr/bin/env node
/**
 * 打做页交接包。默认只要 ready。同事自助：两份 draft 且 completeness 绿时加 --allow-green-draft。
 *   node scripts/handoff-pack.mjs --pc <pc.json> --mobile <mobile.json> --out <dir> [--allow-green-draft]
 *   [--assets-pc <dir>] [--assets-mobile <dir>] [--reference <参考稿.json>]
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadInventoryFile, parseHandoffArgs, validateHandoffPair, writeHandoffPack,
} from "../src/handoff.mjs";

export function runHandoffPack(argv = process.argv.slice(2)) {
  const args = parseHandoffArgs(argv);
  if (!args.pc || !args.mobile) {
    console.error("用法：node scripts/handoff-pack.mjs --pc <pc.json> --mobile <mobile.json> --out <dir> [--allow-green-draft] [--reference <参考稿.json>]");
    process.exit(1);
  }
  const pc = loadInventoryFile(args.pc);
  const mobile = loadInventoryFile(args.mobile);
  const referenceDoc = args.reference ? loadInventoryFile(args.reference).doc : null;
  const gate = validateHandoffPair(pc.doc, mobile.doc, { allowGreenDraft: args.allowGreenDraft, referenceDoc });
  if (!gate.ok) {
    console.error(JSON.stringify({ ok: false, problems: gate.problems }, null, 2));
    process.exit(1);
  }
  const outDir = resolve(args.out || `_tmp/out/handoff-${String(pc.doc.requestedNodeId).replace(/:/g, "-")}`);
  const pack = writeHandoffPack({
    pcPath: pc.path,
    mobilePath: mobile.path,
    pcDoc: pc.doc,
    mobileDoc: mobile.doc,
    kind: gate.kind,
    outDir,
    assetsPc: args.assetsPc,
    assetsMobile: args.assetsMobile,
    referenceDoc,
  });
  console.log(JSON.stringify({
    ok: true,
    kind: pack.manifest.kind,
    fingerprint: pack.manifest.fingerprint,
    outDir: pack.outDir,
    ready: pack.manifest.ready,
    warning: pack.manifest.warning,
  }, null, 2));
  return pack;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runHandoffPack();
