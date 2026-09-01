#!/usr/bin/env node
/**
 * 打做页交接包。稿上有哪一端就装哪一端，两端都给时仍打成对包。
 *   node scripts/handoff-pack.mjs --pc <pc.json> --mobile <mobile.json> --out <dir>
 *   node scripts/handoff-pack.mjs --pc <pc.json> --out <dir>
 *   [--reference <参考稿.json>] 切图 PNG 不进包。
 * 未规范 green-draft 请到 projects/project-unnamed-inventory。
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadInventoryFile, parseHandoffArgs, validateHandoffPair, writeHandoffPack,
} from "../src/handoff.mjs";

export function runHandoffPack(argv = process.argv.slice(2)) {
  const args = parseHandoffArgs(argv);
  if (!args.pc && !args.mobile) {
    console.error("用法：node scripts/handoff-pack.mjs --pc <pc.json> [--mobile <mobile.json>] --out <dir>\n也可只给 --mobile。切图 PNG 不进交接包，不要传 --assets-pc / --assets-mobile。");
    process.exit(1);
  }
  const pc = args.pc ? loadInventoryFile(args.pc) : { path: null, doc: null };
  const mobile = args.mobile ? loadInventoryFile(args.mobile) : { path: null, doc: null };
  if (args.allowGreenDraft) {
    console.error(JSON.stringify({
      ok: false,
      problems: ["本仓只打 ready 交接包。green-draft / 判断包写回请到 projects/project-unnamed-inventory"],
    }, null, 2));
    process.exit(1);
  }
  if (args.packedAssets) {
    console.error(JSON.stringify({
      ok: false,
      problems: ["切图 PNG 不进交接包。清单只写 sliceExport；做页按 node id 自己导出。"],
    }, null, 2));
    process.exit(1);
  }
  const referenceDoc = args.reference ? loadInventoryFile(args.reference).doc : null;
  const gate = validateHandoffPair(pc.doc, mobile.doc, {
    allowGreenDraft: false,
    referenceDoc,
  });
  if (!gate.ok) {
    console.error(JSON.stringify({ ok: false, problems: gate.problems }, null, 2));
    process.exit(1);
  }
  const seedId = (pc.doc || mobile.doc).requestedNodeId;
  const outDir = resolve(args.out || `_tmp/out/handoff-${String(seedId).replace(/:/g, "-")}`);
  const pack = writeHandoffPack({
    pcPath: pc.path,
    mobilePath: mobile.path,
    pcDoc: pc.doc,
    mobileDoc: mobile.doc,
    kind: gate.kind,
    outDir,
    packedAssets: args.packedAssets,
    referenceDoc,
  });
  console.log(JSON.stringify({
    ok: true,
    kind: pack.manifest.kind,
    fingerprint: pack.manifest.fingerprint,
    ends: pack.manifest.ends,
    outDir: pack.outDir,
    ready: pack.manifest.ready,
    warning: pack.manifest.warning,
  }, null, 2));
  return pack;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runHandoffPack();
