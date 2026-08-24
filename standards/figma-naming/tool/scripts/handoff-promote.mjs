#!/usr/bin/env node
/**
 * 主人确认判断完成后，把成对 draft 写成 ready 再打包。
 *   node scripts/handoff-promote.mjs --pc <pc.json> --mobile <mobile.json> --confirm "判断已完成" --out <dir> [--reference <参考稿.json>]
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadInventoryFile, parseHandoffArgs, validateHandoffPair, writePromotedPair, writeHandoffPack,
} from "../src/handoff.mjs";

export function runHandoffPromote(argv = process.argv.slice(2)) {
  const args = parseHandoffArgs(argv);
  if (!args.pc || !args.mobile || !args.confirm) {
    console.error("用法：node scripts/handoff-promote.mjs --pc <pc.json> --mobile <mobile.json> --confirm \"判断已完成\" --out <dir> [--reference <参考稿.json>]");
    process.exit(1);
  }
  const pc = loadInventoryFile(args.pc);
  const mobile = loadInventoryFile(args.mobile);
  const referenceDoc = args.reference ? loadInventoryFile(args.reference).doc : null;
  if (pc.doc.status !== "draft" || mobile.doc.status !== "draft") {
    console.error(JSON.stringify({ ok: false, problems: ["promote 只收成对 draft"] }, null, 2));
    process.exit(1);
  }
  const gate = validateHandoffPair(pc.doc, mobile.doc, { allowGreenDraft: true, referenceDoc });
  if (!gate.ok) {
    console.error(JSON.stringify({ ok: false, problems: gate.problems }, null, 2));
    process.exit(1);
  }
  const outDir = resolve(args.out || `_tmp/out/ready-${String(pc.doc.requestedNodeId).replace(/:/g, "-")}`);
  const promoted = writePromotedPair({
    pcPath: pc.path,
    mobilePath: mobile.path,
    pcDoc: pc.doc,
    mobileDoc: mobile.doc,
    outDir,
    confirm: args.confirm,
  });
  const pack = writeHandoffPack({
    pcPath: promoted.pcOut,
    mobilePath: promoted.mobileOut,
    pcDoc: promoted.pcDoc,
    mobileDoc: promoted.mobileDoc,
    kind: "ready",
    outDir,
    assetsPc: args.assetsPc,
    assetsMobile: args.assetsMobile,
    referenceDoc,
  });
  console.log(JSON.stringify({
    ok: true,
    kind: "ready",
    fingerprint: pack.manifest.fingerprint,
    outDir: pack.outDir,
    confirm: promoted.receipt.confirm,
  }, null, 2));
  return pack;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runHandoffPromote();
