#!/usr/bin/env node
/**
 * 校验成对真稿清单能不能交出。
 *   node scripts/handoff-validate.mjs --pc <pc.json> --mobile <mobile.json> [--allow-green-draft] [--reference <参考稿.json>]
 */
import { fileURLToPath } from "node:url";
import { loadInventoryFile, parseHandoffArgs, validateHandoffPair } from "../src/handoff.mjs";

export function runHandoffValidate(argv = process.argv.slice(2)) {
  const args = parseHandoffArgs(argv);
  if (!args.pc || !args.mobile) {
    console.error("用法：node scripts/handoff-validate.mjs --pc <pc.json> --mobile <mobile.json> [--allow-green-draft] [--reference <参考稿.json>]");
    process.exit(1);
  }
  const pc = loadInventoryFile(args.pc);
  const mobile = loadInventoryFile(args.mobile);
  const referenceDoc = args.reference ? loadInventoryFile(args.reference).doc : null;
  const result = validateHandoffPair(pc.doc, mobile.doc, { allowGreenDraft: args.allowGreenDraft, referenceDoc });
  console.log(JSON.stringify({
    ok: result.ok,
    kind: result.kind,
    pc: pc.path,
    mobile: mobile.path,
    problems: result.problems,
  }, null, 2));
  if (!result.ok) process.exit(1);
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runHandoffValidate();
